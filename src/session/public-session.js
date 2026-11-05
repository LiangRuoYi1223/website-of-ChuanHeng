export const PUBLIC_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const TIMEOUT_MS = 15_000;
const sessions = new WeakMap();
const recoveryEvents = new Set(['INITIAL_SESSION', 'SIGNED_IN', 'TOKEN_REFRESHED']);
const member = user => Boolean(user?.id && !user.is_anonymous);
const role = user => user?.app_metadata?.role;

// Navigation needs only a display name. Business profile readers retain their own identity checks.
async function readNavigationProfile(client, expectedUserId) {
  const {data, error} = await client.rpc('get_member_profile', {});
  if (error || data?.userId !== expectedUserId || typeof data.username !== 'string') throw new Error('Username unavailable');
  return {userId: data.userId, username: data.username};
}

export function createPublicSession(client, {now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout, readProfile = readNavigationProfile} = {}) {
  let epoch = 0, version = 0, eventVersion = 0, profileVersion = 0;
  let snapshot = {status: 'checking', user: null, username: '', epoch};
  let verifiedAt = null, started = false, profileLoaded = false, queued = null, running = null, recovery = null, profile = null, expiryTimer, requestedRole = null, verifiedSessionRole = null;
  const listeners = new Set();
  const publish = value => { snapshot = {...value, epoch}; for (const listener of [...listeners]) listener(); };
  const fresh = () => verifiedAt !== null && now() >= verifiedAt && now() - verifiedAt < PUBLIC_SESSION_TTL_MS;
  const clearExpiry = () => { clearTimer(expiryTimer); expiryTimer = undefined; };
  function clearProfile() {
    profileVersion++;
    clearTimer(profile?.timer); clearTimer(profile?.timeout); profile = null;
  }
  function cancelAuth() {
    clearTimer(queued?.timer); clearTimer(running?.timeout); clearTimer(recovery?.timer); clearTimer(recovery?.timeout);
    queued = null; running = null; recovery = null; requestedRole = null;
  }
  function invalidate(status = 'checking') {
    version++; epoch++; verifiedAt = null; verifiedSessionRole = null; profileLoaded = false;
    cancelAuth(); clearProfile(); clearExpiry();
    publish({status, user: null, username: ''});
  }
  function armExpiry() {
    clearExpiry();
    if (!listeners.size || snapshot.status !== 'authenticated' || verifiedAt === null) return;
    expiryTimer = setTimer(() => requestVerification(snapshot.user.id, true), Math.max(0, PUBLIC_SESSION_TTL_MS - (now() - verifiedAt)));
    expiryTimer?.unref?.();
  }
  function refreshProfile() {
    if (!listeners.size || snapshot.status !== 'authenticated' || profile?.queued) return;
    clearProfile();
    const current = profileVersion, identityEpoch = epoch, userId = snapshot.user.id;
    const active = () => current === profileVersion && identityEpoch === epoch && snapshot.status === 'authenticated' && snapshot.user.id === userId;
    const work = {queued: true}; profile = work;
    work.timer = setTimer(async () => {
      if (!active()) return;
      work.queued = false;
      work.timeout = setTimer(() => { if (active()) clearProfile(); }, TIMEOUT_MS);
      work.timeout?.unref?.();
      try {
        const value = await readProfile(client, userId);
        if (active() && value?.userId === userId && typeof value.username === 'string') {
          profileLoaded = true;
          publish({...snapshot, username: value.username});
        }
      } catch { /* A display-name failure does not revoke an already verified login. */ }
      finally { clearTimer(work.timeout); if (profile === work) profile = null; }
    }, 0);
  }
  function requestVerification(expectedId = null, retain = false) {
    if (!listeners.size || queued || running) return;
    const work = {expectedId}; queued = work;
    // All Auth calls happen after the SDK's synchronous notification has released its lock.
    work.timer = setTimer(() => { if (queued !== work) return; queued = null; void verify(expectedId, retain); }, 0);
  }
  async function verify(expectedId, retain) {
    const current = ++version;
    const active = () => current === version;
    const work = {expectedId}; running = work;
    if (!retain) publish({status: 'checking', user: null, username: ''});
    work.timeout = setTimer(() => { if (active()) invalidate('error'); }, TIMEOUT_MS);
    work.timeout?.unref?.();
    try {
      const {data: sessionData, error: sessionError} = await client.auth.getSession();
      if (!active()) return;
      if (sessionError) throw sessionError;
      const sessionUser = sessionData?.session?.user;
      if (!member(sessionUser)) return invalidate('anonymous');
      if (expectedId && sessionUser.id !== expectedId) {
        invalidate(); requestVerification(sessionUser.id); return;
      }
      const {data, error} = await client.auth.getUser();
      if (!active()) return;
      if (error) throw error;
      const user = data?.user;
      if (!member(user)) return invalidate('anonymous');
      if (user.id !== sessionUser.id) return invalidate('error');
      const username = snapshot.user?.id === user.id ? snapshot.username : '';
      clearTimer(work.timeout); running = null; requestedRole = null;
      verifiedAt = now();
      verifiedSessionRole = {value: role(sessionUser)};
      publish({status: 'authenticated', user, username});
      armExpiry(); refreshProfile();
    } catch { if (active()) invalidate('error'); }
    finally { clearTimer(work.timeout); if (running === work) running = null; }
  }
  function handleSession(event, session) {
    const user = session?.user;
    if (event === 'SIGNED_OUT' || !member(user)) return invalidate('anonymous');
    const sameUser = snapshot.status === 'authenticated' && snapshot.user.id === user.id;
    const pendingClaimChanged = requestedRole && requestedRole.value !== role(user);
    // getUser does not update session.user: an unchanged stale claim must not restart verification.
    if (sameUser && !pendingClaimChanged && recoveryEvents.has(event) && fresh() && verifiedSessionRole?.value === role(user)) return;
    if (sameUser && (role(user) !== role(snapshot.user) || pendingClaimChanged)) {
      if (requestedRole && requestedRole.value === role(user) && (queued || running)) return;
      const previous = snapshot;
      version++; epoch++; verifiedAt = null; cancelAuth(); clearProfile(); clearExpiry();
      // Local claims may remove a management link, but may never introduce one.
      const restricted = role(previous.user) === 'admin' ? {...previous.user, app_metadata: {...previous.user.app_metadata, role: role(user)}} : previous.user;
      publish({...previous, user: restricted});
      requestedRole = {value: role(user)};
      requestVerification(user.id, true);
      return;
    }
    if (sameUser && recoveryEvents.has(event)) {
      if (!fresh()) requestVerification(user.id, true);
      return;
    }
    if (sameUser && event === 'USER_UPDATED') {
      if (listeners.size) requestVerification(user.id, true);
      else invalidate();
      return;
    }
    if (event !== 'USER_UPDATED' && (queued?.expectedId === user.id || running?.expectedId === user.id)) return;
    invalidate(); requestVerification(user.id);
  }
  function recover() {
    if (!listeners.size || recovery || queued || running) return;
    const identityEpoch = epoch, events = eventVersion;
    const work = {}; recovery = work;
    const active = () => recovery === work && identityEpoch === epoch && events === eventVersion;
    work.timer = setTimer(async () => {
      if (!active()) { if (recovery === work) recovery = null; return; }
      work.timeout = setTimer(() => {
        const relevant = active();
        if (recovery !== work) return;
        recovery = null;
        if (relevant && (snapshot.status !== 'authenticated' || !fresh())) invalidate('error');
      }, TIMEOUT_MS);
      work.timeout?.unref?.();
      try {
        const {data, error} = await client.auth.getSession();
        if (!active()) return;
        if (error) throw error;
        recovery = null;
        handleSession('SIGNED_IN', data?.session);
      } catch {
        if (active() && (snapshot.status !== 'authenticated' || !fresh())) invalidate('error');
      } finally {
        clearTimer(work.timeout);
        if (recovery === work) recovery = null;
      }
    }, 0);
  }
  return {
    getSnapshot: () => snapshot,
    recover,
    refreshProfile,
    subscribe(listener) {
      listeners.add(listener);
      const initial = !started;
      if (!started) {
        started = true;
        // One tab-lifetime listener also records account changes while public navigation is absent.
        client.auth.onAuthStateChange((event, session) => { eventVersion++; handleSession(event, session); });
      }
      if (initial && !queued && !running) void verify(null, false);
      else if (snapshot.status === 'authenticated' && fresh()) {
        armExpiry();
        if (!profileLoaded && !profile) refreshProfile();
      }
      else requestVerification(snapshot.status === 'authenticated' ? snapshot.user.id : null, snapshot.status === 'authenticated');
      return () => {
        listeners.delete(listener);
        if (!listeners.size) {
          clearExpiry();
          clearTimer(recovery?.timer); clearTimer(recovery?.timeout); recovery = null;
        }
      };
    },
  };
}

export function getPublicSession(client) {
  if (!sessions.has(client)) sessions.set(client, createPublicSession(client));
  return sessions.get(client);
}
