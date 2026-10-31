import { convertTrack, TrackError } from './parse.mjs';
import { locateTrack } from './locate.mjs';

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_REQUEST_BYTES = MAX_FILE_BYTES + 64 * 1024;
const MAX_AUTH_BYTES = 64 * 1024;
const AUTH_TIMEOUT_MS = 5000;
const BODY_TIMEOUT_MS = 30000;

export function jsonResponse(value, status = 200, headers = {}) {
  return new Response(JSON.stringify(value), { status, headers: {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers,
  } });
}

export function trackErrorResponse(error) {
  const known = error instanceof TrackError;
  return jsonResponse({ error: {
    code: known ? error.code : 'INTERNAL_ERROR',
    message: known ? error.message : '暂时无法处理轨迹，请稍后重试。',
  } }, known ? error.status : 500);
}

export function isLoopbackAddress(address) {
  const value = String(address || '').toLowerCase().replace(/^\[|\]$/g, '').replace(/^::ffff:/, '');
  if (value === '::1') return true;
  const octets = value.split('.');
  return octets.length === 4 && octets.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255) && Number(octets[0]) === 127;
}

export function isLoopbackHost(hostname) {
  return String(hostname || '').toLowerCase() === 'localhost' || isLoopbackAddress(hostname);
}

export function getAuthConfiguration(env) {
  const key = String(env?.SUPABASE_PUBLISHABLE_KEY || '').trim();
  const source = String(env?.SUPABASE_URL || '').trim();
  if (!/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return null;
  try {
    const url = new URL(source);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') return null;
    return { url: `${url.origin}/auth/v1/user`, key };
  } catch { return null; }
}

function cancelReader(reader, reason) {
  try { Promise.resolve(reader.cancel(reason)).catch(() => {}); } catch { /* already closed */ }
}

// The byte budget applies while streaming, before multipart or JSON parsing.
// Never trust Content-Length as an allocation size or as evidence of body size.
export async function readBounded(stream, limit, code, message, status = 413, signal) {
  if (!stream) return new Uint8Array();
  const reader = stream.getReader();
  const onAbort = () => cancelReader(reader, 'read deadline exceeded');
  signal?.addEventListener('abort', onAbort, { once: true });
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        cancelReader(reader, 'byte budget exceeded');
        throw new TrackError(code, message, status);
      }
      chunks.push(value);
    }
    const result = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.byteLength; }
    return result;
  } finally {
    signal?.removeEventListener('abort', onAbort);
    try { reader.releaseLock(); } catch { /* caller timeout may still be cancelling a read */ }
  }
}

export async function verifyUser(request, config, options = {}) {
  const bearer = /^Bearer\s+([^\s,]+)$/i.exec(request.headers.get('authorization') || '')?.[1];
  if (!bearer || bearer.length > 8192) throw new TrackError('AUTH_REQUIRED', '请先登录领队或管理员账号。', 401);
  const controller = new AbortController();
  const suppliedTimeout = Number(options.authTimeoutMs);
  const timeoutMs = Number.isFinite(suppliedTimeout) && suppliedTimeout > 0 ? Math.min(suppliedTimeout, AUTH_TIMEOUT_MS) : AUTH_TIMEOUT_MS;
  let timer;
  let authReader;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new TrackError('AUTH_TIMEOUT', '身份验证超时，请稍后重试。', 504));
      controller.abort();
      if (authReader) cancelReader(authReader, 'auth timeout');
    }, timeoutMs);
  });
  try {
    return await Promise.race([timeout, (async () => {
      const response = await (options.fetchImpl || fetch)(config.url, {
        method: 'GET',
        headers: { apikey: config.key, authorization: `Bearer ${bearer}`, accept: 'application/json' },
        // Workers supports manual/follow only; reject 3xx below without forwarding credentials.
        redirect: 'manual',
        signal: controller.signal,
      });
      if (!response.ok || controller.signal.aborted) {
        try { Promise.resolve(response.body?.cancel()).catch(() => {}); } catch { /* already closed */ }
        if (controller.signal.aborted) throw new TrackError('AUTH_TIMEOUT', '身份验证超时，请稍后重试。', 504);
        if (response.status === 401 || response.status === 403) throw new TrackError('INVALID_SESSION', '登录状态已失效，请重新登录。', 401);
        throw new TrackError('AUTH_UNAVAILABLE', '身份服务暂时不可用，请稍后重试。', 503);
      }
      // Keep the response reader available to the deadline, including a stalled
      // response body after headers arrived. The injected fetch need not honor abort.
      const reader = response.body?.getReader();
      authReader = reader;
      let size = 0;
      const chunks = [];
      if (reader) try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > MAX_AUTH_BYTES) {
            cancelReader(reader, 'auth response too large');
            throw new TrackError('AUTH_UNAVAILABLE', '身份服务返回了无效数据，请稍后重试。', 503);
          }
          chunks.push(value);
        }
      } finally { try { reader.releaseLock(); } catch { /* deadline already cancelled */ } }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      let user;
      try { user = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
      catch { throw new TrackError('AUTH_UNAVAILABLE', '身份服务返回了无效数据，请稍后重试。', 503); }
      if (typeof user?.id !== 'string' || !user.id || !(options.allowedRoles || ['leader', 'admin']).includes(user?.app_metadata?.role)) {
        throw new TrackError('FORBIDDEN', options.forbiddenMessage || '只有已授权的领队或管理员可以转换轨迹。', 403);
      }
      return user;
    })()]);
  } catch (error) {
    if (error instanceof TrackError) throw error;
    throw new TrackError('AUTH_UNAVAILABLE', '无法验证登录身份，请稍后重试。', 503);
  } finally { clearTimeout(timer); }
}

export function requireSameOrigin(request, url) {
  if (request.headers.get('origin') !== url.origin || request.headers.get('sec-fetch-site')?.toLowerCase() === 'cross-site') {
    throw new TrackError('INVALID_ORIGIN', '请从本站页面提交轨迹文件。', 403);
  }
}

async function readUpload(request) {
  const contentType = request.headers.get('content-type') || '';
  if (!/^multipart\/form-data\s*(?:;|$)/i.test(contentType)) throw new TrackError('UNSUPPORTED_MEDIA_TYPE', '请通过文件上传表单提交 GPX 或 KML。', 415);
  const rawLength = request.headers.get('content-length');
  if (rawLength !== null) {
    if (!/^\d+$/.test(rawLength)) throw new TrackError('INVALID_UPLOAD', '上传请求长度无效。', 400);
    if (Number(rawLength) > MAX_REQUEST_BYTES) throw new TrackError('REQUEST_TOO_LARGE', '上传请求不能超过 5 MiB 加 64 KiB。', 413);
  }
  let timer;
  const controller = new AbortController();
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new TrackError('REQUEST_TIMEOUT', '上传超时，请重新选择文件后重试。', 408));
      controller.abort();
    }, BODY_TIMEOUT_MS);
  });
  let bytes;
  try { bytes = await Promise.race([readBounded(request.body, MAX_REQUEST_BYTES, 'REQUEST_TOO_LARGE', '上传请求不能超过 5 MiB 加 64 KiB。', 413, controller.signal), deadline]); }
  finally { clearTimeout(timer); }
  let form;
  try { form = await new Request(request.url, { method: 'POST', headers: { 'content-type': contentType }, body: bytes }).formData(); }
  catch { throw new TrackError('INVALID_UPLOAD', '文件上传格式无效，请重新选择文件。', 400); }
  const entries = [...form.entries()];
  const file = entries[0]?.[1];
  if (entries.length !== 1 || entries[0][0] !== 'file' || typeof file !== 'object' || typeof file.name !== 'string' || typeof file.arrayBuffer !== 'function') {
    throw new TrackError('INVALID_UPLOAD', '请仅提交一个名为 file 的轨迹文件。', 400);
  }
  if (!/\.(?:gpx|kml)$/i.test(file.name)) throw new TrackError('UNSUPPORTED_FORMAT', '仅支持 .gpx 或 .kml 文件。', 415);
  if (file.size > MAX_FILE_BYTES) throw new TrackError('FILE_TOO_LARGE', '轨迹文件不能超过 5 MiB。', 413);
  const fileBytes = new Uint8Array(await file.arrayBuffer());
  if (fileBytes.byteLength > MAX_FILE_BYTES) throw new TrackError('FILE_TOO_LARGE', '轨迹文件不能超过 5 MiB。', 413);
  try { new TextDecoder('utf-8', { fatal: true }).decode(fileBytes); }
  catch { throw new TrackError('INVALID_ENCODING', '轨迹文件必须使用有效的 UTF-8 编码。', 400); }
  return { fileBytes, filename: file.name };
}

/** Local-preview permission is a trusted adapter option, never a query/env flag.
 * The Node adapter also checks actual socket addresses before enabling it.
 * The production worker always passes localPreview:false.
 */
export async function handleTrackRequest(request, env = {}, options = {}) {
  const url = new URL(request.url);
  if (url.pathname !== '/api' && !url.pathname.startsWith('/api/')) return null;
  const config = getAuthConfiguration(env);
  const localPreview = options.localPreview === true && isLoopbackHost(url.hostname);
  if (url.pathname === '/api/tracks/status') {
    if (request.method !== 'GET') return jsonResponse({ error: { code: 'METHOD_NOT_ALLOWED', message: '此接口仅支持 GET。' } }, 405, { allow: 'GET' });
    return jsonResponse({ localPreview, configured: Boolean(config) });
  }
  if (url.pathname !== '/api/tracks/convert') return jsonResponse({ error: { code: 'NOT_FOUND', message: '没有找到这个接口。' } }, 404);
  if (request.method !== 'POST') return jsonResponse({ error: { code: 'METHOD_NOT_ALLOWED', message: '此接口仅支持 POST。' } }, 405, { allow: 'POST' });
  try {
    requireSameOrigin(request, url);
    if (!localPreview) {
      if (!config) throw new TrackError('SERVICE_UNAVAILABLE', '轨迹服务尚未完成身份配置，请稍后再试。', 503);
      await verifyUser(request, config, options);
    }
    const { fileBytes, filename } = await readUpload(request);
    const track = convertTrack(fileBytes, { filename });
    track.location = locateTrack(track);
    return jsonResponse({ track });
  } catch (error) { return trackErrorResponse(error); }
}
