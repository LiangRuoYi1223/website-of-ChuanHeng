import test from 'node:test'
import assert from 'node:assert/strict'
import { createPublicSession, getPublicSession } from '../src/session/public-session.js'

const TWELVE_HOURS = 43_200_000
const MEMBER_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_ID = '22222222-2222-4222-8222-222222222222'

function authUser(id = MEMBER_ID, role = 'member', extra = {}) {
  return {
    id,
    aud: 'authenticated',
    role: 'authenticated',
    email: `${id}@example.invalid`,
    app_metadata: { provider: 'email', providers: ['email'], role },
    user_metadata: {},
    identities: [],
    created_at: '2026-11-01T00:00:00.000Z',
    updated_at: '2026-11-01T00:00:00.000Z',
    is_anonymous: false,
    ...extra,
  }
}

function authSession(user = authUser()) {
  return {
    access_token: 'test-access-token',
    refresh_token: 'test-refresh-token',
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: 1_900_000_000,
    user,
  }
}

function userResult(user) {
  return { data: { user }, error: null }
}

function sessionResult(session) {
  return { data: { session }, error: null }
}

function deferred() {
  let resolve
  const promise = new Promise((yes) => { resolve = yes })
  return { promise, resolve }
}

async function microtasks() {
  for (let index = 0; index < 20; index += 1) await Promise.resolve()
}

function fakeClock() {
  let current = 1_000_000
  let sequence = 0
  const timers = new Map()
  return {
    now: () => current,
    setTimer(callback, delay = 0) {
      const id = ++sequence
      timers.set(id, { at: current + Math.max(0, delay), callback })
      return id
    },
    clearTimer(id) { timers.delete(id) },
    async advance(milliseconds) {
      const target = current + milliseconds
      for (let count = 0; ; count += 1) {
        assert.ok(count < 1000, 'timer callbacks must not form a zero-delay loop')
        const next = [...timers.entries()]
          .filter(([, timer]) => timer.at <= target)
          .sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0]
        if (!next) break
        const [id, timer] = next
        timers.delete(id)
        current = timer.at
        timer.callback()
        await microtasks()
      }
      current = target
      await microtasks()
    },
  }
}

async function settle(clock) {
  await microtasks()
  await clock.advance(0)
  await microtasks()
  await clock.advance(0)
}

// Only the external SDK and profile read are replaced. Events run synchronously
// so calling the SDK while its auth callback holds the lock fails this boundary.
function fakeClient({ session = authSession(), serverUser = session?.user ?? null, initialEvent = false } = {}) {
  let currentSession = session
  let currentUser = serverUser
  let insideAuthCallback = false
  const listeners = new Set()
  const sessionResponses = []
  const userResponses = []
  const profileResponses = []
  const calls = { getSession: 0, getUser: 0, readProfile: 0, authSubscriptions: 0 }

  function notify(listener, event, nextSession) {
    insideAuthCallback = true
    try { listener(event, nextSession) } finally { insideAuthCallback = false }
  }

  function enqueue(queue, response) {
    queue.push(typeof response === 'function' ? response : () => response)
  }

  const client = {
    auth: {
      onAuthStateChange(listener) {
        calls.authSubscriptions += 1
        listeners.add(listener)
        if (initialEvent) notify(listener, 'INITIAL_SESSION', currentSession)
        return { data: { subscription: { unsubscribe() { listeners.delete(listener) } } } }
      },
      async getSession() {
        assert.equal(insideAuthCallback, false, 'getSession must run after the auth callback returns')
        calls.getSession += 1
        if (sessionResponses.length) return sessionResponses.shift()()
        return sessionResult(currentSession)
      },
      async getUser() {
        assert.equal(insideAuthCallback, false, 'getUser must run after the auth callback returns')
        calls.getUser += 1
        if (userResponses.length) return userResponses.shift()()
        return userResult(currentUser)
      },
    },
  }

  return {
    client,
    calls,
    queueSession(response) { enqueue(sessionResponses, response) },
    queueUser(response) { enqueue(userResponses, response) },
    queueProfile(response) { enqueue(profileResponses, response) },
    setSession(nextSession) { currentSession = nextSession },
    setServerUser(user) { currentUser = user },
    async readProfile(profileClient, userId) {
      assert.equal(insideAuthCallback, false, 'profile reads must run after the auth callback returns')
      assert.equal(profileClient, client)
      assert.ok([MEMBER_ID, OTHER_ID].includes(userId), 'profile reads require the verified account ID')
      calls.readProfile += 1
      if (profileResponses.length) return profileResponses.shift()()
      return { userId, username: userId === MEMBER_ID ? '川衡会员' : '另一会员' }
    },
    emit(event, nextSession) {
      currentSession = nextSession
      for (const listener of listeners) notify(listener, event, nextSession)
    },
  }
}

function subject(options) {
  const clock = fakeClock()
  const fake = fakeClient(options)
  const store = createPublicSession(fake.client, {
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
    readProfile: fake.readProfile,
  })
  return { clock, fake, store }
}

async function confirmedMember(options) {
  const fixture = subject(options)
  const stop = fixture.store.subscribe(() => {})
  await settle(fixture.clock)
  assert.equal(fixture.store.getSnapshot().status, 'authenticated')
  assert.equal(fixture.store.getSnapshot().username, '川衡会员')
  return { ...fixture, stop }
}

function assertNoIdentity(store) {
  assert.equal(store.getSnapshot().user, null)
  assert.ok(!store.getSnapshot().username)
}

test('getPublicSession shares one store for the same client and isolates distinct clients', () => {
  const first = fakeClient().client
  const second = fakeClient().client
  assert.equal(getPublicSession(first), getPublicSession(first))
  assert.notEqual(getPublicSession(first), getPublicSession(second))
})

test('initial auth events defer SDK work and only the server user and profile establish the visible identity', async () => {
  const forgedSession = authSession(authUser(MEMBER_ID, 'admin', {
    user_metadata: { role: 'admin', username: 'metadata-name' },
  }))
  const { clock, fake, store } = subject({
    session: forgedSession,
    serverUser: authUser(),
    initialEvent: true,
  })
  const pending = deferred()
  fake.queueUser(pending.promise)
  const stop = store.subscribe(() => {})
  await settle(clock)

  assert.equal(store.getSnapshot().status, 'checking')
  assertNoIdentity(store)
  assert.equal(fake.calls.getSession, 1)
  assert.equal(fake.calls.getUser, 1)
  assert.equal(fake.calls.readProfile, 0)

  pending.resolve(userResult(authUser()))
  await settle(clock)
  assert.equal(store.getSnapshot().status, 'authenticated')
  assert.equal(store.getSnapshot().user.id, MEMBER_ID)
  assert.equal(store.getSnapshot().user.app_metadata.role, 'member')
  assert.equal(store.getSnapshot().username, '川衡会员')
  assert.equal(fake.calls.readProfile, 1)
  stop()
})

test('desktop and mobile subscribers share one confirmation and one profile read', async () => {
  const { clock, fake, store } = subject()
  const pending = deferred()
  fake.queueUser(pending.promise)
  const desktop = []
  const mobile = []
  const stopDesktop = store.subscribe(() => desktop.push(store.getSnapshot().status))
  const stopMobile = store.subscribe(() => mobile.push(store.getSnapshot().status))
  await settle(clock)
  assert.equal(fake.calls.getSession, 1)
  assert.equal(fake.calls.getUser, 1)

  pending.resolve(userResult(authUser()))
  await settle(clock)
  assert.equal(store.getSnapshot().username, '川衡会员')
  assert.ok(desktop.includes('authenticated'))
  assert.ok(mobile.includes('authenticated'))
  assert.equal(fake.calls.readProfile, 1)
  assert.equal(fake.calls.authSubscriptions, 1)

  stopDesktop()
  const desktopNotifications = desktop.length
  fake.emit('SIGNED_OUT', null)
  assert.equal(desktop.length, desktopNotifications)
  assert.equal(mobile.at(-1), 'anonymous')
  stopMobile()
})

test('same-account initial, sign-in, and token events preserve the displayed member without repeated auth or profile reads', async () => {
  const { clock, fake, store, stop } = await confirmedMember()
  const statuses = []
  const stopObserver = store.subscribe(() => statuses.push(store.getSnapshot().status))
  for (const event of ['INITIAL_SESSION', 'SIGNED_IN', 'TOKEN_REFRESHED']) {
    fake.emit(event, authSession())
    assert.equal(store.getSnapshot().status, 'authenticated')
    assert.equal(store.getSnapshot().username, '川衡会员')
    await settle(clock)
  }
  assert.equal(fake.calls.getSession, 1)
  assert.equal(fake.calls.getUser, 1)
  assert.equal(fake.calls.readProfile, 1)
  assert.ok(statuses.every((status) => status === 'authenticated'))
  stopObserver()
  stop()
})

test('an already-verified stale administrator claim does not repeat verification or extend the member deadline', async () => {
  const staleSession = authSession(authUser(MEMBER_ID, 'admin'))
  const { clock, fake, store, stop } = await confirmedMember({
    session: staleSession,
    serverUser: authUser(),
  })
  assert.equal(store.getSnapshot().user.app_metadata.role, 'member')
  await clock.advance(11 * 60 * 60 * 1000)

  for (let index = 0; index < 2; index += 1) {
    store.recover()
    await settle(clock)
    fake.emit('SIGNED_IN', staleSession)
    await settle(clock)
    fake.emit('TOKEN_REFRESHED', staleSession)
    await settle(clock)
    assert.equal(store.getSnapshot().status, 'authenticated')
    assert.equal(store.getSnapshot().user.app_metadata.role, 'member')
    assert.equal(store.getSnapshot().username, '川衡会员')
    assert.equal(fake.calls.getUser, 1, 'the server-confirmed member must not recheck an unchanged session role claim')
    assert.equal(fake.calls.readProfile, 1)
  }

  const pending = deferred()
  fake.queueUser(pending.promise)
  await clock.advance(60 * 60 * 1000 - 1)
  assert.equal(fake.calls.getUser, 1)
  await clock.advance(1)
  await settle(clock)
  assert.equal(fake.calls.getUser, 2, 'repeated stale claims must not postpone the original twelve-hour deadline')
  assert.equal(store.getSnapshot().user.app_metadata.role, 'member')
  pending.resolve(userResult(authUser()))
  await settle(clock)
  assert.equal(store.getSnapshot().user.app_metadata.role, 'member')
  stop()
})

test('the twelve-hour identity deadline is fixed despite token events and username refreshes', async () => {
  const { clock, fake, store, stop } = await confirmedMember()
  await clock.advance(11 * 60 * 60 * 1000)
  fake.emit('TOKEN_REFRESHED', authSession())
  fake.queueProfile({ userId: MEMBER_ID, username: '改名会员' })
  store.refreshProfile()
  await settle(clock)
  assert.equal(store.getSnapshot().username, '改名会员')
  assert.equal(fake.calls.getUser, 1)

  const pending = deferred()
  fake.queueUser(pending.promise)
  await clock.advance(60 * 60 * 1000 - 1)
  assert.equal(fake.calls.getUser, 1)
  await clock.advance(1)
  await settle(clock)
  assert.equal(fake.calls.getUser, 2)
  assert.equal(store.getSnapshot().status, 'authenticated')
  assert.equal(store.getSnapshot().username, '改名会员')
  pending.resolve(userResult(authUser()))
  await settle(clock)
  await clock.advance(TWELVE_HOURS - 1)
  assert.equal(fake.calls.getUser, 2)
  stop()
})

test('last unsubscribe pauses timed checks, resubscribe reuses a valid deadline, and the tab still observes sign-out', async () => {
  const { clock, fake, store, stop } = await confirmedMember()
  stop()
  await clock.advance(6 * 60 * 60 * 1000)
  const stopAgain = store.subscribe(() => {})
  await settle(clock)
  assert.equal(store.getSnapshot().username, '川衡会员')
  assert.equal(fake.calls.getUser, 1)
  stopAgain()

  await clock.advance(6 * 60 * 60 * 1000 + 1)
  assert.equal(fake.calls.getUser, 1)
  const pending = deferred()
  fake.queueUser(pending.promise)
  const stopExpired = store.subscribe(() => {})
  await settle(clock)
  assert.equal(fake.calls.getUser, 2)
  assert.equal(fake.calls.authSubscriptions, 1)
  pending.resolve(userResult(authUser()))
  await settle(clock)
  stopExpired()

  fake.emit('SIGNED_OUT', null)
  assert.equal(store.getSnapshot().status, 'anonymous')
  assertNoIdentity(store)
})

test('sign-out clears the name immediately and late identity or profile responses cannot restore it', async () => {
  const { clock, fake, store, stop } = await confirmedMember()
  const pendingIdentity = deferred()
  const pendingProfile = deferred()
  fake.queueUser(pendingIdentity.promise)
  fake.queueProfile(pendingProfile.promise)
  fake.emit('USER_UPDATED', authSession())
  store.refreshProfile()
  await settle(clock)
  const priorEpoch = store.getSnapshot().epoch

  fake.emit('SIGNED_OUT', null)
  assert.equal(store.getSnapshot().status, 'anonymous')
  assertNoIdentity(store)
  assert.ok(store.getSnapshot().epoch > priorEpoch)
  pendingIdentity.resolve(userResult(authUser()))
  pendingProfile.resolve({ userId: MEMBER_ID, username: '迟到姓名' })
  await settle(clock)
  assert.equal(store.getSnapshot().status, 'anonymous')
  assertNoIdentity(store)
  stop()
})

test('switching accounts removes the old name synchronously and ignores late work for the old account', async () => {
  const { clock, fake, store, stop } = await confirmedMember()
  const oldIdentity = deferred()
  const oldProfile = deferred()
  const newIdentity = deferred()
  fake.queueUser(oldIdentity.promise)
  fake.queueUser(newIdentity.promise)
  fake.queueProfile(oldProfile.promise)
  fake.emit('USER_UPDATED', authSession())
  store.refreshProfile()
  await settle(clock)
  const oldEpoch = store.getSnapshot().epoch

  fake.emit('SIGNED_IN', authSession(authUser(OTHER_ID)))
  assert.notEqual(store.getSnapshot().status, 'authenticated')
  assertNoIdentity(store)
  assert.ok(store.getSnapshot().epoch > oldEpoch)
  await settle(clock)
  newIdentity.resolve(userResult(authUser(OTHER_ID)))
  await settle(clock)
  assert.equal(store.getSnapshot().status, 'authenticated')
  assert.equal(store.getSnapshot().user.id, OTHER_ID)
  assert.equal(store.getSnapshot().username, '另一会员')

  oldIdentity.resolve(userResult(authUser()))
  oldProfile.resolve({ userId: MEMBER_ID, username: '旧账号迟到姓名' })
  await settle(clock)
  assert.equal(store.getSnapshot().user.id, OTHER_ID)
  assert.equal(store.getSnapshot().username, '另一会员')
  stop()
})

test('empty sessions and anonymous conversion revoke a member immediately and invalidate older verification', async () => {
  for (const revokedSession of [null, authSession(authUser(MEMBER_ID, 'member', { is_anonymous: true }))]) {
    const { clock, fake, store, stop } = await confirmedMember()
    const pending = deferred()
    fake.queueUser(pending.promise)
    fake.emit('USER_UPDATED', authSession())
    await settle(clock)
    fake.emit('TOKEN_REFRESHED', revokedSession)
    assert.equal(store.getSnapshot().status, 'anonymous')
    assertNoIdentity(store)

    pending.resolve(userResult(authUser()))
    await settle(clock)
    assert.equal(store.getSnapshot().status, 'anonymous')
    assertNoIdentity(store)
    stop()
  }
})

test('same-account role loss hides administrator access immediately while promotion waits for server confirmation', async () => {
  const { clock, fake, store, stop } = await confirmedMember({
    session: authSession(authUser(MEMBER_ID, 'admin')),
  })
  assert.equal(store.getSnapshot().user.app_metadata.role, 'admin')
  const olderVerification = deferred()
  fake.queueUser(olderVerification.promise)
  fake.emit('USER_UPDATED', authSession(authUser(MEMBER_ID, 'admin')))
  await settle(clock)

  const demotion = deferred()
  fake.queueUser(demotion.promise)
  fake.emit('TOKEN_REFRESHED', authSession())
  assert.equal(store.getSnapshot().status, 'authenticated')
  assert.notEqual(store.getSnapshot().user.app_metadata.role, 'admin')
  assert.equal(store.getSnapshot().username, '川衡会员')
  await settle(clock)
  assert.equal(fake.calls.getUser, 3)
  olderVerification.resolve(userResult(authUser(MEMBER_ID, 'admin')))
  await settle(clock)
  assert.notEqual(store.getSnapshot().user.app_metadata.role, 'admin')
  demotion.resolve(userResult(authUser()))
  await settle(clock)

  const promotion = deferred()
  fake.queueUser(promotion.promise)
  fake.emit('SIGNED_IN', authSession(authUser(MEMBER_ID, 'admin')))
  assert.equal(store.getSnapshot().status, 'authenticated')
  assert.notEqual(store.getSnapshot().user.app_metadata.role, 'admin')
  assert.equal(store.getSnapshot().username, '川衡会员')
  await settle(clock)
  assert.equal(fake.calls.getUser, 4)
  promotion.resolve(userResult(authUser(MEMBER_ID, 'admin')))
  await settle(clock)
  assert.equal(store.getSnapshot().user.app_metadata.role, 'admin')
  stop()
})

test('a missing role revokes cached administrator access and invalidates an older administrator verification', async () => {
  const { clock, fake, store, stop } = await confirmedMember({
    session: authSession(authUser(MEMBER_ID, 'admin')),
  })
  const olderVerification = deferred()
  fake.queueUser(olderVerification.promise)
  fake.emit('USER_UPDATED', authSession(authUser(MEMBER_ID, 'admin')))
  await settle(clock)

  const missingRoleUser = authUser(MEMBER_ID, 'member', { app_metadata: {} })
  const currentVerification = deferred()
  fake.queueUser(currentVerification.promise)
  fake.emit('TOKEN_REFRESHED', authSession(missingRoleUser))
  assert.equal(store.getSnapshot().status, 'authenticated')
  assert.notEqual(store.getSnapshot().user.app_metadata.role, 'admin')
  assert.equal(store.getSnapshot().username, '川衡会员')
  await settle(clock)

  olderVerification.resolve(userResult(authUser(MEMBER_ID, 'admin')))
  await settle(clock)
  assert.notEqual(store.getSnapshot().user.app_metadata.role, 'admin')
  currentVerification.resolve(userResult(missingRoleUser))
  await settle(clock)
  assert.equal(store.getSnapshot().status, 'authenticated')
  assert.notEqual(store.getSnapshot().user.app_metadata.role, 'admin')
  stop()
})

test('a later member claim cancels a pending administrator promotion before its server result can arrive', async () => {
  const memberClaims = [authUser(), authUser(MEMBER_ID, 'member', { app_metadata: {} })]
  for (const currentMember of memberClaims) {
    const { clock, fake, store, stop } = await confirmedMember()
    const pendingPromotion = deferred()
    fake.queueUser(pendingPromotion.promise)
    fake.emit('SIGNED_IN', authSession(authUser(MEMBER_ID, 'admin')))
    await settle(clock)
    assert.equal(store.getSnapshot().status, 'authenticated')
    assert.notEqual(store.getSnapshot().user.app_metadata.role, 'admin')
    assert.equal(fake.calls.getUser, 2)

    const memberVerification = deferred()
    fake.queueUser(memberVerification.promise)
    fake.emit('TOKEN_REFRESHED', authSession(currentMember))
    await settle(clock)
    pendingPromotion.resolve(userResult(authUser(MEMBER_ID, 'admin')))
    await settle(clock)
    assert.equal(store.getSnapshot().status, 'authenticated')
    assert.notEqual(store.getSnapshot().user.app_metadata.role, 'admin', 'a superseded promotion result must not restore administrator access')
    assert.equal(store.getSnapshot().username, '川衡会员')
    assert.equal(fake.calls.getUser, 3, 'the changed claim must verify the current member identity')

    memberVerification.resolve(userResult(currentMember))
    await settle(clock)
    assert.equal(store.getSnapshot().status, 'authenticated')
    assert.notEqual(store.getSnapshot().user.app_metadata.role, 'admin')
    stop()
  }
})

test('USER_UPDATED verifies in the background and overlapping events share the pending identity check', async () => {
  const { clock, fake, store, stop } = await confirmedMember()
  const pending = deferred()
  fake.queueUser(pending.promise)
  fake.emit('USER_UPDATED', authSession())
  assert.equal(store.getSnapshot().status, 'authenticated')
  assert.equal(store.getSnapshot().username, '川衡会员')
  await settle(clock)
  fake.emit('USER_UPDATED', authSession())
  fake.emit('TOKEN_REFRESHED', authSession())
  await settle(clock)
  assert.equal(fake.calls.getUser, 2)
  assert.equal(store.getSnapshot().username, '川衡会员')

  pending.resolve(userResult(authUser(MEMBER_ID, 'member', { email: 'changed@example.invalid' })))
  await settle(clock)
  assert.equal(store.getSnapshot().status, 'authenticated')
  assert.equal(store.getSnapshot().user.email, 'changed@example.invalid')
  stop()
})

test('recover repairs missed auth events with getSession while a valid same-account confirmation stays cached', async () => {
  const { clock, fake, store, stop } = await confirmedMember()
  store.recover()
  await settle(clock)
  assert.equal(fake.calls.getSession, 2)
  assert.equal(fake.calls.getUser, 1)
  assert.equal(store.getSnapshot().username, '川衡会员')

  fake.setSession(authSession(authUser(OTHER_ID)))
  fake.setServerUser(authUser(OTHER_ID))
  store.recover()
  await settle(clock)
  assert.equal(fake.calls.getUser, 2)
  assert.equal(store.getSnapshot().user.id, OTHER_ID)
  assert.equal(store.getSnapshot().username, '另一会员')

  fake.setSession(null)
  store.recover()
  await settle(clock)
  assert.equal(store.getSnapshot().status, 'anonymous')
  assertNoIdentity(store)

  const lateRecovery = deferred()
  fake.queueSession(lateRecovery.promise)
  store.recover()
  await settle(clock)
  fake.emit('SIGNED_OUT', null)
  lateRecovery.resolve(sessionResult(authSession(authUser(OTHER_ID))))
  await settle(clock)
  assert.equal(store.getSnapshot().status, 'anonymous')
  assertNoIdentity(store)
  stop()
})

test('a timed-out recovery releases its pending slot even after same-account auth events arrive', async () => {
  const { clock, fake, store, stop } = await confirmedMember()
  const stalledRecovery = deferred()
  fake.queueSession(stalledRecovery.promise)
  store.recover()
  await settle(clock)
  assert.equal(fake.calls.getSession, 2)

  fake.emit('TOKEN_REFRESHED', authSession())
  fake.emit('SIGNED_IN', authSession())
  await settle(clock)
  assert.equal(store.getSnapshot().status, 'authenticated')
  assert.equal(store.getSnapshot().username, '川衡会员')
  await clock.advance(15_000)
  await settle(clock)

  fake.setSession(authSession(authUser(OTHER_ID)))
  fake.setServerUser(authUser(OTHER_ID))
  store.recover()
  await settle(clock)
  assert.ok(fake.calls.getSession > 2, 'a stalled recovery must not block later recovery attempts')
  assert.equal(store.getSnapshot().status, 'authenticated')
  assert.equal(store.getSnapshot().user.id, OTHER_ID)
  assert.equal(store.getSnapshot().username, '另一会员')

  fake.setSession(null)
  store.recover()
  await settle(clock)
  assert.equal(store.getSnapshot().status, 'anonymous')
  assertNoIdentity(store)
  stop()
})

test('profile refresh keeps the old name while pending or failed and accepts only the verified account profile', async () => {
  const { clock, fake, store, stop } = await confirmedMember()
  const pending = deferred()
  fake.queueProfile(pending.promise)
  store.refreshProfile()
  await settle(clock)
  assert.equal(store.getSnapshot().status, 'authenticated')
  assert.equal(store.getSnapshot().username, '川衡会员')
  pending.resolve({ userId: MEMBER_ID, username: '新用户名' })
  await settle(clock)
  assert.equal(store.getSnapshot().username, '新用户名')

  fake.queueProfile(() => Promise.reject(new Error('profile unavailable')))
  store.refreshProfile()
  await settle(clock)
  assert.equal(store.getSnapshot().status, 'authenticated')
  assert.equal(store.getSnapshot().username, '新用户名')

  fake.queueProfile({ userId: OTHER_ID, username: '其他人的姓名' })
  store.refreshProfile()
  await settle(clock)
  assert.equal(store.getSnapshot().username, '新用户名')
  assert.equal(fake.calls.getUser, 1)
  stop()
})

test('a late older profile refresh cannot overwrite the username from a newer refresh', async () => {
  const { clock, fake, store, stop } = await confirmedMember()
  const olderProfile = deferred()
  const newerProfile = deferred()
  fake.queueProfile(olderProfile.promise)
  fake.queueProfile(newerProfile.promise)
  store.refreshProfile()
  await settle(clock)
  store.refreshProfile()
  await settle(clock)
  assert.equal(store.getSnapshot().username, '川衡会员')

  newerProfile.resolve({ userId: MEMBER_ID, username: '最新用户名' })
  await settle(clock)
  assert.equal(store.getSnapshot().username, '最新用户名')
  olderProfile.resolve({ userId: MEMBER_ID, username: '过时用户名' })
  await settle(clock)
  assert.equal(store.getSnapshot().username, '最新用户名')
  assert.equal(fake.calls.getUser, 1)
  stop()
})

test('identity failures and invalid server identities never publish the cached session user or metadata name', async () => {
  const cases = [
    { stage: 'session', response: { data: { session: null }, error: new Error('session unavailable') }, status: 'error' },
    { stage: 'user', response: { data: { user: null }, error: new Error('user unavailable') }, status: 'error' },
    { stage: 'user', response: userResult(null) },
    { stage: 'user', response: userResult(authUser(OTHER_ID)) },
    { stage: 'user', response: userResult(authUser(MEMBER_ID, 'member', { is_anonymous: true })) },
  ]
  for (const { stage, response, status } of cases) {
    const { clock, fake, store } = subject({
      session: authSession(authUser(MEMBER_ID, 'admin', { user_metadata: { username: 'unverified' } })),
    })
    if (stage === 'session') fake.queueSession(response)
    else fake.queueUser(response)
    const stop = store.subscribe(() => {})
    await settle(clock)
    if (status) assert.equal(store.getSnapshot().status, status)
    else assert.notEqual(store.getSnapshot().status, 'authenticated')
    assertNoIdentity(store)
    assert.equal(fake.calls.readProfile, 0)
    if (stage === 'session') assert.equal(fake.calls.getUser, 0)
    stop()
  }
})

test('initial session and server-user reads time out at fifteen seconds and late results cannot publish an identity', async () => {
  for (const stage of ['session', 'user']) {
    const { clock, fake, store } = subject()
    const pending = deferred()
    if (stage === 'session') fake.queueSession(pending.promise)
    else fake.queueUser(pending.promise)
    const stop = store.subscribe(() => {})
    await settle(clock)
    await clock.advance(14_999)
    assert.equal(store.getSnapshot().status, 'checking')
    assertNoIdentity(store)
    await clock.advance(1)
    await settle(clock)
    assert.equal(store.getSnapshot().status, 'error')
    assertNoIdentity(store)

    pending.resolve(stage === 'session' ? sessionResult(authSession()) : userResult(authUser()))
    await settle(clock)
    assert.equal(store.getSnapshot().status, 'error')
    assertNoIdentity(store)
    assert.equal(fake.calls.readProfile, 0)
    if (stage === 'session') assert.equal(fake.calls.getUser, 0)
    stop()
  }
})
