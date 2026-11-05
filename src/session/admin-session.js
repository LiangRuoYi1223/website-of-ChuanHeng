export const ADMIN_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
const VERIFICATION_TIMEOUT_MS = 15_000;
const sessions = new WeakMap();
const recoveryEvents = new Set(['INITIAL_SESSION', 'SIGNED_IN', 'TOKEN_REFRESHED']);
const isAdmin = user => Boolean(user?.id && !user.is_anonymous && user.app_metadata?.role === 'admin');

// This cache controls page presentation only. Business requests still authorize on the server.
// It lives in this JavaScript tab, never in browser storage or another tab.
export function createAdminSession(client, {now = () => Date.now(), setTimer = setTimeout, clearTimer = clearTimeout} = {}) {
  let epoch = 0;
  let snapshot = {status: 'checking', user: null, error: '', epoch};
  let verifiedAt = null;
  let version = 0;
  let started = false;
  let queued = null;
  let running = null;
  let expiryTimer;
  const listeners = new Set();
  const publish = value => { snapshot = {...value, epoch}; for (const listener of [...listeners]) listener(); };
  const fresh = () => verifiedAt !== null && now() >= verifiedAt && now() - verifiedAt < ADMIN_SESSION_TTL_MS;
  const cancelExpiry = () => { clearTimer(expiryTimer); expiryTimer = undefined; };
  const cancelWork = () => {
    if (queued) clearTimer(queued.timer);
    if (running) clearTimer(running.timeout);
    queued = null; running = null;
  };
  function invalidate(value = {status: 'error', user: null, error: '登录身份已变化，请重新登录管理账号。'}) {
    version++; epoch++; verifiedAt = null; cancelWork(); cancelExpiry(); publish(value);
  }
  function armExpiry() {
    cancelExpiry();
    if (!listeners.size || snapshot.status !== 'admin' || verifiedAt === null) return;
    expiryTimer = setTimer(() => requestVerification(snapshot.user.id, true), Math.max(0, ADMIN_SESSION_TTL_MS - (now() - verifiedAt)));
    expiryTimer?.unref?.();
  }
  function requestVerification(expectedId = null, retain = false) {
    if (!listeners.size) return;
    if (running || queued) return;
    const work = {expectedId};
    queued = work;
    // Supabase notifies listeners under its Auth lock. Never call Auth inside that callback.
    work.timer = setTimer(() => { if (queued !== work) return; queued = null; void verify(expectedId, retain); }, 0);
  }
  async function verify(expectedId, retain) {
    const current = ++version;
    const active = () => current === version;
    const work = {expectedId};
    running = work;
    if (!retain) publish({status: 'checking', user: null, error: ''});
    work.timeout = setTimer(() => {
      if (active()) invalidate({status: 'error', user: null, error: '身份核验超时，请检查连接后重新登录。'});
    }, VERIFICATION_TIMEOUT_MS);
    work.timeout?.unref?.();
    try {
      const {data: sessionData, error: sessionError} = await client.auth.getSession();
      if (!active()) return;
      if (sessionError) throw sessionError;
      const sessionUser = sessionData?.session?.user;
      if (!sessionUser?.id || sessionUser.is_anonymous) return invalidate({status: 'anonymous', user: null, error: ''});
      if (expectedId && expectedId !== sessionUser.id) {
        invalidate({status: 'checking', user: null, error: ''});
        requestVerification(sessionUser.id);
        return;
      }
      const {data, error} = await client.auth.getUser();
      if (!active()) return;
      if (error) throw error;
      const user = data?.user;
      if (!user?.id || user.is_anonymous) return invalidate({status: 'anonymous', user: null, error: ''});
      if (user.id !== sessionUser.id) return invalidate();
      if (!isAdmin(user)) return invalidate({status: 'forbidden', user, error: ''});
      verifiedAt = now();
      clearTimer(work.timeout); running = null;
      publish({status: 'admin', user, error: ''});
      armExpiry();
    } catch {
      if (active()) invalidate({status: 'error', user: null, error: '无法向服务器确认登录身份，请检查连接后重新登录。'});
    } finally {
      clearTimer(work.timeout);
      if (running === work) running = null;
    }
  }
  function onAuthStateChange(event, session) {
    const user = session?.user;
    if (event === 'SIGNED_OUT' || !user?.id || user.is_anonymous) return invalidate({status: 'anonymous', user: null, error: ''});
    if (!isAdmin(user)) return invalidate({status: 'forbidden', user, error: ''});
    const sameAdmin = snapshot.status === 'admin' && user.id === snapshot.user.id;
    if (sameAdmin && recoveryEvents.has(event)) {
      if (!fresh()) requestVerification(user.id, true);
      return;
    }
    if (sameAdmin && event === 'USER_UPDATED') {
      if (listeners.size) requestVerification(user.id, true);
      else invalidate({status: 'checking', user: null, error: ''});
      return;
    }
    if (event !== 'USER_UPDATED' && (running?.expectedId === user.id || queued?.expectedId === user.id)) return;
    invalidate({status: 'checking', user: null, error: ''});
    requestVerification(user.id);
  }
  return {
    getSnapshot: () => snapshot,
    invalidate,
    subscribe(listener) {
      listeners.add(listener);
      const initial = !started;
      if (!started) {
        started = true;
        // Keep one listener for the lifetime of this tab, including time spent outside /admin.
        client.auth.onAuthStateChange(onAuthStateChange);
      }
      if (initial && !queued && !running) void verify(null, false);
      else if (snapshot.status === 'admin' && fresh()) armExpiry();
      else requestVerification(snapshot.status === 'admin' ? snapshot.user.id : null, snapshot.status === 'admin');
      return () => { listeners.delete(listener); if (!listeners.size) cancelExpiry(); };
    },
  };
}

export function getAdminSession(client) {
  if (!sessions.has(client)) sessions.set(client, createAdminSession(client));
  return sessions.get(client);
}
