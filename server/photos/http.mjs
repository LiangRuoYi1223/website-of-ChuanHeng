import { getAuthConfiguration, verifyUser, requireSameOrigin, readBounded, jsonResponse, isLoopbackHost } from '../tracks/http.mjs';
import { TrackError } from '../tracks/parse.mjs';
import { processPhoto, MAX_PHOTO_BYTES, MAX_PHOTO_SOURCE_BYTES } from './processor.mjs';

export { MAX_PHOTO_BYTES, MAX_PHOTO_SOURCE_BYTES };
export const MAX_PHOTO_REQUEST_BYTES = MAX_PHOTO_SOURCE_BYTES + 64 * 1024;

async function readUpload(request, options) {
  const contentType = request.headers.get('content-type') || '';
  if (!/^multipart\/form-data\s*(?:;|$)/i.test(contentType)) throw new TrackError('UNSUPPORTED_MEDIA_TYPE', '请通过文件上传表单提交照片。', 415);
  const length = request.headers.get('content-length');
  if (length !== null) {
    if (!/^\d+$/.test(length)) throw new TrackError('INVALID_UPLOAD', '上传请求长度无效。', 400);
    if (Number(length) > MAX_PHOTO_REQUEST_BYTES) throw new TrackError('REQUEST_TOO_LARGE', '照片上传请求不能超过 20 MiB 加 64 KiB。', 413);
  }
  const controller = new AbortController();
  const requested = Number(options.bodyTimeoutMs);
  const timeoutMs = Number.isFinite(requested) && requested > 0 ? Math.min(requested, 30000) : 30000;
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new TrackError('REQUEST_TIMEOUT', '照片上传超时，请重新选择照片后重试。', 408));
      controller.abort();
    }, timeoutMs);
  });
  let bytes;
  try {
    bytes = await Promise.race([readBounded(request.body, MAX_PHOTO_REQUEST_BYTES, 'REQUEST_TOO_LARGE', '照片上传请求不能超过 20 MiB 加 64 KiB。', 413, controller.signal), deadline]);
  } finally { clearTimeout(timer); }
  let form;
  try { form = await new Request(request.url, { method: 'POST', headers: { 'content-type': contentType }, body: bytes }).formData(); }
  catch { throw new TrackError('INVALID_UPLOAD', '文件上传格式无效，请重新选择照片。', 400); }
  const entries = [...form.entries()];
  const file = entries[0]?.[1];
  if (entries.length !== 1 || entries[0][0] !== 'file' || typeof file !== 'object' || typeof file.name !== 'string' || typeof file.arrayBuffer !== 'function') throw new TrackError('INVALID_UPLOAD', '请仅提交一个名为 file 的照片文件。', 400);
  if (file.size > MAX_PHOTO_SOURCE_BYTES) throw new TrackError('FILE_TOO_LARGE', '照片原图不能超过 20 MiB。', 413);
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new TrackError('UNSUPPORTED_FORMAT', '照片仅支持 JPEG、PNG 或 WebP。', 415);
  return file;
}

/** Preview is a trusted adapter capability, never inferred from request or env.
 * Vite verifies the socket; production must explicitly pass localPreview:false.
 */
export async function handlePhotoRequest(request, env = {}, options = {}) {
  const url = new URL(request.url);
  if (url.pathname !== '/api/photos/process') return null;
  if (request.method !== 'POST') return jsonResponse({ error: { code: 'METHOD_NOT_ALLOWED', message: '此接口仅支持 POST。' } }, 405, { allow: 'POST' });
  try {
    requireSameOrigin(request, url);
    if (!(options.localPreview === true && isLoopbackHost(url.hostname))) {
      const config = getAuthConfiguration(env);
      if (!config) throw new TrackError('SERVICE_UNAVAILABLE', '照片服务尚未完成身份配置，请稍后再试。', 503);
      await verifyUser(request, config, { ...options, allowedRoles: ['admin'], forbiddenMessage: '只有已授权的管理员可以处理照片。' });
    }
    const file = await readUpload(request, options);
    const result = await processPhoto(file, options.images || env.IMAGES, options);
    return new Response(result.bytes, { headers: {
      'content-type': 'image/webp', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
      'x-photo-processed': '1', 'x-photo-original-bytes': String(result.originalBytes), 'x-photo-output-bytes': String(result.bytes.byteLength),
    } });
  } catch (error) {
    const known = error instanceof TrackError;
    return jsonResponse({ error: { code: known ? error.code : 'INTERNAL_ERROR', message: known ? error.message : '暂时无法处理照片，请稍后重试。' } }, known ? error.status : 500);
  }
}
