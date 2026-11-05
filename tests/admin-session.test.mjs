import test from 'node:test'
import assert from 'node:assert/strict'
import { createAdminSession, getAdminSession } from '../src/session/admin-session.js'

const TWELVE_HOURS = 43_200_000
const ADMIN_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_ID = '22222222-2222-4222-8222-222222222222'

function authUser(id = ADMIN_ID, role = 'admin', extra = {}) {
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

function deferred() {
  let resolve
  let reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function userResult(user) {
  return { data: { user }, error: null }
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

// These doubles replace only the external Supabase auth boundary. Auth events
// run synchronously, like the SDK callback, so an awaited auth call inside that
// callback is caught instead of silently passing a possible lock deadlock.
function fakeClient({ session = authSession(), serverUser = session?.user ?? null, initialEvent = false } = {}) {
  let currentSession = session
  let currentUser = serverUser
  let insideAuthCallback = false
  const listeners = new Set()
  const userResponses = []
  const sessionResponses = []
  const calls = { getSession: 0, getUser: 0 }

  function notify(listener, event, nextSession) {
    insideAuthCallback = true
    try { listener(event, nextSession) } finally { insideAuthCallback = false }
  }

  const client = {
    auth: {
      onAuthStateChange(listener) {
        listeners.add(listener)
        if (initialEvent) notify(listener, 'INITIAL_SESSION', currentSession)
        return { data: { subscription: { unsubscribe() { listeners.delete(listener) } } } }
      },
      async getSession() {
        assert.equal(insideAuthCallback, false, 'getSession must run after the auth callback returns')
        calls.getSession += 1
        if (sessionResponses.length) return sessionResponses.shift()()
        return { data: { session: currentSession }, error: null }
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
    queueUser(response) { userResponses.push(typeof response === 'function' ? response : () => response) },
    queueSession(response) { sessionResponses.push(typeof response === 'function' ? response : () => response) },
    setServerUser(user) { currentUser = user },
    emit(event, nextSession) {
      currentSession = nextSession
      for (const listener of listeners) notify(listener, event, nextSession)
    },
  }
}

function subject(options) {
  const clock = fakeClock()
  const fake = fakeClient(options)
  const store = createAdminSession(fake.client, {
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  })
  return { clock, fake, store }
}

async function confirmedAdmin() {
  const fixture = subject()
  const stop = fixture.store.subscribe(() => {})
  await settle(fixture.clock)
  assert.equal(fixture.store.getSnapshot().status, 'admin')
  return { ...fixture, stop }
}

test('initial auth callbacks defer SDK reads and session metadata cannot grant administrator access', async () => {
  const serverMember = authUser(ADMIN_ID, 'member', { user_metadata: { role: 'admin' } })
  const { clock, fake, store } = subject({ serverUser: serverMember, initialEvent: true })
  const stop = store.subscribe(() => {})
  await settle(clock)

  assert.equal(fake.calls.getSession, 1)
  assert.equal(fake.calls.getUser, 1)
  assert.equal(store.getSnapshot().status, 'forbidden')
  stop()
})

test('concurrent subscribers share one server confirmation and observe the confirmed administrator', async () => {
  const { clock, fake, store } = subject()
  const pending = deferred()
  fake.queueUser(pending.promise)
  const first = []
  const second = []
  const stopFirst = store.subscribe(() => first.push(store.getSnapshot().status))
  const stopSecond = store.subscribe(() => second.push(store.getSnapshot().status))
  await settle(clock)

  assert.equal(store.getSnapshot().status, 'checking')
  assert.equal(fake.calls.getSession, 1)
  assert.equal(fake.calls.getUser, 1)
  pending.resolve(userResult(authUser()))
  await settle(clock)
  assert.equal(store.getSnapshot().status, 'admin')
  assert.equal(store.getSnapshot().user.id, ADMIN_ID)
  assert.ok(first.includes('admin'))
  assert.ok(second.includes('admin'))

  stopFirst()
  const firstNotifications = first.length
  fake.emit('SIGNED_OUT', null)
  assert.equal(first.length, firstNotifications)
  assert.equal(second.at(-1), 'anonymous')
  stopSecond()
})

test('getAdminSession shares a store only for the same client in the current module instance', () => {
  const first = fakeClient().client
  const second = fakeClient().client
  assert.equal(getAdminSession(first), getAdminSession(first))
  assert.notEqual(getAdminSession(first), getAdminSession(second))
})

test('same administrator sign-in and token events reuse confirmation without clearing visible access', async () => {
  const { clock, fake, store, stop } = await confirmedAdmin()
  const transitions = []
  const stopObserver = store.subscribe(() => transitions.push(store.getSnapshot().status))

  for (const event of ['SIGNED_IN', 'INITIAL_SESSION', 'TOKEN_REFRESHED']) {
    fake.emit(event, authSession())
    assert.equal(store.getSnapshot().status, 'admin')
    await settle(clock)
  }

  assert.equal(fake.calls.getUser, 1)
  assert.ok(transitions.every((status) => status === 'admin'))
  stopObserver()
  stop()
})

test('the twelve-hour deadline is fixed despite token refreshes and refresh keeps existing access visible', async () => {
  const { clock, fake, store, stop } = await confirmedAdmin()
  const pending = deferred()
  fake.queueUser(pending.promise)

  await clock.advance(11 * 60 * 60 * 1000)
  fake.emit('TOKEN_REFRESHED', authSession())
  await settle(clock)
  await clock.advance(60 * 60 * 1000 - 1)
  assert.equal(fake.calls.getUser, 1)
  await clock.advance(1)
  await settle(clock)
  assert.equal(fake.calls.getUser, 2)
  assert.equal(store.getSnapshot().status, 'admin')

  pending.resolve(userResult(authUser()))
  await settle(clock)
  await clock.advance(TWELVE_HOURS - 1)
  assert.equal(fake.calls.getUser, 2)
  stop()
})

test('unsubscribed stores stop timed checks but reuse a valid confirmation on return', async () => {
  const { clock, fake, store, stop } = await confirmedAdmin()
  stop()
  await clock.advance(6 * 60 * 60 * 1000)
  const stopAgain = store.subscribe(() => {})
  await settle(clock)
  assert.equal(store.getSnapshot().status, 'admin')
  assert.equal(fake.calls.getUser, 1)

  stopAgain()
  await clock.advance(6 * 60 * 60 * 1000 + 1)
  assert.equal(fake.calls.getUser, 1)
  const pending = deferred()
  fake.queueUser(pending.promise)
  const stopExpired = store.subscribe(() => {})
  await settle(clock)
  assert.equal(fake.calls.getUser, 2)
  pending.resolve(userResult(authUser()))
  await settle(clock)
  assert.equal(store.getSnapshot().status, 'admin')
  stopExpired()
  fake.emit('SIGNED_OUT', null)
  assert.equal(store.getSnapshot().status, 'anonymous', 'auth changes are still observed outside the admin page')
})

test('sign-out immediately removes access and a pending confirmation cannot restore it', async () => {
  const { clock, fake, store, stop } = await confirmedAdmin()
  const pending = deferred()
  fake.queueUser(pending.promise)
  fake.emit('USER_UPDATED', authSession())
  await settle(clock)

  fake.emit('SIGNED_OUT', null)
  assert.equal(store.getSnapshot().status, 'anonymous')
  assert.equal(store.getSnapshot().user, null)
  pending.resolve(userResult(authUser()))
  await settle(clock)
  assert.equal(store.getSnapshot().status, 'anonymous')
  stop()
})

test('an empty auth session revokes cached access and returning requires a fresh server confirmation', async () => {
  const { clock, fake, store, stop } = await confirmedAdmin()
  fake.emit('TOKEN_REFRESHED', null)
  assert.equal(store.getSnapshot().status, 'anonymous')
  assert.equal(store.getSnapshot().user, null)

  const pending = deferred()
  fake.queueUser(pending.promise)
  fake.emit('SIGNED_IN', authSession())
  assert.notEqual(store.getSnapshot().status, 'admin')
  await settle(clock)
  assert.equal(fake.calls.getUser, 2)
  pending.resolve(userResult(authUser()))
  await settle(clock)
  assert.equal(store.getSnapshot().status, 'admin')
  stop()
})

test('switching accounts discards old access and ignores a late confirmation for the previous account', async () => {
  const { clock, fake, store, stop } = await confirmedAdmin()
  const oldRequest = deferred()
  const newRequest = deferred()
  fake.queueUser(oldRequest.promise)
  fake.queueUser(newRequest.promise)
  fake.emit('USER_UPDATED', authSession())
  await settle(clock)

  fake.emit('SIGNED_IN', authSession(authUser(OTHER_ID)))
  assert.notEqual(store.getSnapshot().status, 'admin')
  assert.equal(store.getSnapshot().user, null)
  await settle(clock)
  assert.equal(fake.calls.getUser, 3)
  newRequest.resolve(userResult(authUser(OTHER_ID)))
  await settle(clock)
  assert.equal(store.getSnapshot().user.id, OTHER_ID)

  oldRequest.resolve(userResult(authUser()))
  await settle(clock)
  assert.equal(store.getSnapshot().status, 'admin')
  assert.equal(store.getSnapshot().user.id, OTHER_ID)
  stop()
})

test('same-id role loss or anonymous conversion revokes access and invalidates older verification results', async () => {
  for (const revokedUser of [authUser(ADMIN_ID, 'member'), authUser(ADMIN_ID, 'admin', { is_anonymous: true })]) {
    const { clock, fake, store, stop } = await confirmedAdmin()
    const pending = deferred()
    fake.queueUser(pending.promise)
    fake.emit('USER_UPDATED', authSession())
    await settle(clock)
    assert.equal(fake.calls.getUser, 2)

    fake.emit('TOKEN_REFRESHED', authSession(revokedUser))
    assert.notEqual(store.getSnapshot().status, 'admin')
    pending.resolve(userResult(authUser()))
    await settle(clock)
    assert.notEqual(store.getSnapshot().status, 'admin')
    stop()
  }
})

test('USER_UPDATED rechecks in the background, deduplicates overlapping checks, and applies server demotion', async () => {
  const { clock, fake, store, stop } = await confirmedAdmin()
  const pending = deferred()
  fake.queueUser(pending.promise)
  fake.emit('USER_UPDATED', authSession())
  assert.equal(store.getSnapshot().status, 'admin')
  await settle(clock)
  fake.emit('USER_UPDATED', authSession())
  fake.emit('TOKEN_REFRESHED', authSession())
  await settle(clock)
  assert.equal(fake.calls.getUser, 2)
  assert.equal(store.getSnapshot().status, 'admin')

  pending.resolve(userResult(authUser(ADMIN_ID, 'member')))
  await settle(clock)
  assert.equal(store.getSnapshot().status, 'forbidden')
  stop()
})

test('a background network failure clears access and a later sign-in cannot reuse the failed cache', async () => {
  const { clock, fake, store, stop } = await confirmedAdmin()
  fake.queueUser(() => Promise.reject(new Error('network unavailable')))
  await clock.advance(TWELVE_HOURS)
  await settle(clock)
  assert.equal(store.getSnapshot().status, 'error')
  assert.equal(store.getSnapshot().user, null)
  assert.ok(store.getSnapshot().error)

  const pending = deferred()
  fake.queueUser(pending.promise)
  fake.emit('SIGNED_IN', authSession())
  assert.notEqual(store.getSnapshot().status, 'admin')
  await settle(clock)
  assert.equal(fake.calls.getUser, 3)
  pending.resolve(userResult(authUser()))
  await settle(clock)
  assert.equal(store.getSnapshot().status, 'admin')
  stop()
})

test('a getSession failure produces an error without attempting a server user confirmation', async () => {
  const { clock, fake, store } = subject()
  fake.queueSession({ data: { session: null }, error: new Error('session unavailable') })
  const stop = store.subscribe(() => {})
  await settle(clock)
  assert.equal(store.getSnapshot().status, 'error')
  assert.equal(store.getSnapshot().user, null)
  assert.ok(store.getSnapshot().error)
  assert.equal(fake.calls.getUser, 0)
  stop()
})

test('server user confirmation times out at fifteen seconds and ignores a late administrator result', async () => {
  const { clock, fake, store } = subject()
  const pending = deferred()
  fake.queueUser(pending.promise)
  const stop = store.subscribe(() => {})
  await settle(clock)
  await clock.advance(14_999)
  assert.equal(store.getSnapshot().status, 'checking')
  await clock.advance(1)
  await settle(clock)
  assert.equal(store.getSnapshot().status, 'error')
  assert.equal(store.getSnapshot().user, null)
  assert.ok(store.getSnapshot().error)

  pending.resolve(userResult(authUser()))
  await settle(clock)
  assert.equal(store.getSnapshot().status, 'error')
  assert.equal(store.getSnapshot().user, null)
  stop()
})

test('initial session retrieval also times out and its late result cannot start a user check', async () => {
  const { clock, fake, store } = subject()
  const pending = deferred()
  fake.queueSession(pending.promise)
  const stop = store.subscribe(() => {})
  await settle(clock)
  await clock.advance(15_000)
  await settle(clock)
  assert.equal(store.getSnapshot().status, 'error')
  assert.equal(store.getSnapshot().user, null)

  pending.resolve({ data: { session: authSession() }, error: null })
  await settle(clock)
  assert.equal(store.getSnapshot().status, 'error')
  assert.equal(fake.calls.getUser, 0)
  stop()
})
