const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const rpcNames = new Set(['authorize_activity_cleanup_wake','claim_activity_data_cleanup', 'list_activity_cleanup_objects', 'finish_activity_data_cleanup']);
const safePath = value => typeof value === 'string' && value.endsWith('.webp') && value.split('/').length === 3 && value.slice(0,-5).split('/').every(uuid);
function failure(code) { const error = new Error(code); error.code = code; return error; }
function pathsFrom(values) {
  if (!Array.isArray(values) || values.length > 100 || values.some(value => !safePath(value))) throw failure('INVALID_RESULT');
  return [...new Set(values)];
}

// Authorization lives in the database lease/queue, never in a caller-supplied target.
export async function runCleanupRound(api, { maxBatches = 5, deadlineMs = 40000, now = Date.now, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  const claimed = await api.rpc('claim_activity_data_cleanup', { p_limit: 3 });
  if (!Array.isArray(claimed?.jobs) || claimed.jobs.length > 3) throw failure('INVALID_RESULT');
  const summary = { claimed: claimed.jobs.length, succeeded: 0, failed: 0 };
  const deadline = now() + Math.min(40000, Math.max(1, deadlineMs));
  const batchLimit = Math.min(5, Math.max(1, maxBatches));
  const seen = new Set();
  for (const job of claimed.jobs) {
    if (!uuid(job?.activityId) || !uuid(job?.leaseId) || seen.has(job.activityId) || !['automatic', 'manual'].includes(job.mode) || !['clear', 'confirm'].includes(job.phase)) throw failure('INVALID_RESULT');
    seen.add(job.activityId);
    const lease = { p_activity_id: job.activityId, p_lease_id: job.leaseId };
    try {
      let paths = pathsFrom(job.objectPaths), batches = 0;
      while (paths.length) {
        if (now() >= deadline) throw failure('TIME_LIMIT');
        if (batches++ >= batchLimit) throw failure('BATCH_LIMIT');
        await api.remove(paths);
        const next = await api.rpc('list_activity_cleanup_objects', { ...lease, p_limit: 100 });
        paths = pathsFrom(next?.objectPaths);
      }
      if (job.phase === 'confirm') {
        const earliest = Date.parse(job.verifyNotBefore);
        if (!Number.isFinite(earliest)) throw failure('INVALID_RESULT');
        // Cron may arrive a fraction before the previous round's finish time.
        // Preserve the real 180s gap without skipping the entire next slot.
        const delay = Math.max(0, Math.ceil(earliest - now()) + 5);
        if (delay > 30000 || now() + delay >= deadline) throw failure('TIME_LIMIT');
        if (delay) await wait(delay);
        if (now() < earliest) throw failure('TIME_LIMIT');
      }
      // The database independently checks contacts, all prefixes and elapsed time.
      for (let attempt = 0; attempt < 3; attempt++) {
        const result = await api.rpc('finish_activity_data_cleanup', { ...lease, p_succeeded: true, p_error_code: null });
        if (!result || !['cleaning','verifying','completed','waiting'].includes(result.status) || !Number.isInteger(result.consecutiveEmptyChecks) || result.consecutiveEmptyChecks < 0 || result.consecutiveEmptyChecks > 2) throw failure('INVALID_RESULT');
        if (result.leaseRetained === true) {
          if (job.phase !== 'confirm' || result.status !== 'verifying' || result.consecutiveEmptyChecks !== 1 || !Number.isSafeInteger(result.retryAfterMs) || result.retryAfterMs < 1) throw failure('INVALID_RESULT');
          const delay = result.retryAfterMs + 5;
          if (attempt === 2 || delay > 30000 || now() + delay >= deadline) throw failure('TIME_LIMIT');
          // Relative server time also works if the Edge wall clock is ahead.
          await wait(delay);
          continue;
        }
        if (result.consecutiveEmptyChecks === 0 || job.phase === 'confirm' && result.consecutiveEmptyChecks !== 2) throw failure('INVALID_RESULT');
        break;
      }
      summary.succeeded++;
    } catch (error) {
      summary.failed++;
      const code = ['INVALID_RESULT','TIME_LIMIT','BATCH_LIMIT'].includes(error?.code) ? error.code : 'CLEANUP_FAILED';
      try { await api.rpc('finish_activity_data_cleanup', { ...lease, p_succeeded: false, p_error_code: code }); } catch { /* Lease expiry safely permits a later scheduled retry. */ }
    }
  }
  return summary;
}

async function boundedJson(response) {
  if (!response.ok) { try { await response.body?.cancel(); } catch { /* closed */ } throw failure('BACKEND_FAILED'); }
  const reader = response.body?.getReader();
  if (!reader) throw failure('INVALID_RESULT');
  let size = 0; const chunks = [];
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 128 * 1024) throw failure('INVALID_RESULT'); chunks.push(value); }
    const bytes = new Uint8Array(size); let at = 0;
    for (const chunk of chunks) { bytes.set(chunk, at); at += chunk.byteLength; }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch { try { await reader.cancel(); } catch { /* closed */ } throw failure('INVALID_RESULT'); }
  finally { reader.releaseLock(); }
}

export function createCleanupApi({ url, secretKey, fetchImpl = fetch, timeoutMs = 8000 }) {
  const base = new URL(url);
  if (base.protocol !== 'https:' || base.username || base.password || typeof secretKey !== 'string' || !secretKey) throw failure('CONFIGURATION_MISSING');
  const headers = { apikey: secretKey, 'content-type': 'application/json', accept: 'application/json' };
  // New secret keys are not JWTs. Legacy platform fallback is a JWT.
  if (!secretKey.startsWith('sb_secret_')) headers.authorization = `Bearer ${secretKey}`;
  async function request(path, method, body) {
    const controller = new AbortController(); let timer;
    try {
      return await Promise.race([
        (async () => boundedJson(await fetchImpl(`${base.origin}${path}`, { method, headers, body: JSON.stringify(body), redirect: 'manual', signal: controller.signal })))(),
        new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(failure('BACKEND_TIMEOUT')); }, Math.min(8000, Math.max(1,timeoutMs))); }),
      ]);
    } finally { clearTimeout(timer); }
  }
  return {
    rpc(name, args) { if (!rpcNames.has(name)) return Promise.reject(failure('INVALID_RPC')); return request(`/rest/v1/rpc/${name}`, 'POST', args); },
    remove(paths) { const valid = pathsFrom(paths); if (!valid.length) return Promise.resolve([]); return request('/storage/v1/object/payment-proofs', 'DELETE', { prefixes: valid }); },
  };
}

export async function handleCleanupWake(request, { api } = {}) {
  const response = (value, status = 200, headers = {}) => Response.json(value, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers } });
  if (request.method !== 'POST') return response({ error: 'METHOD_NOT_ALLOWED' }, 405, { allow: 'POST' });
  // Wake is intentionally target-free; only DB-authorized jobs can be claimed.
  try { Promise.resolve(request.body?.cancel()).catch(() => {}); } catch { /* no body */ }
  if (!api) return response({ error: 'SERVICE_UNAVAILABLE' }, 503);
  const token = request.headers.get('x-cleanup-token');
  if (!token || !/^[0-9a-f-]{72}$/i.test(token)) return response({ error: 'AUTH_REQUIRED' }, 401);
  try {
    if (await api.rpc('authorize_activity_cleanup_wake', { p_token: token }) !== true) return response({ error: 'AUTH_REQUIRED' }, 401);
    const summary = await runCleanupRound(api); return response(summary, summary.failed ? 503 : 200);
  }
  catch { return response({ error: 'CLEANUP_RETRY_REQUIRED' }, 503); }
}
