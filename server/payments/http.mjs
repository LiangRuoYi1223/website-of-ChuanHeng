import { getAuthConfiguration, verifyAuthenticatedUser, requireSameOrigin, readBounded, jsonResponse } from '../tracks/http.mjs';
import { TrackError } from '../tracks/parse.mjs';
import { processPaymentProof, MAX_PAYMENT_PROOF_SOURCE_BYTES } from './processor.mjs';

export const MAX_PAYMENT_PROOF_REQUEST_BYTES = MAX_PAYMENT_PROOF_SOURCE_BYTES + 64 * 1024;
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

async function registrationState(request, config, activityId, options) {
  const controller = new AbortController();
  const supplied = Number(options.rpcTimeoutMs), timeoutMs = Number.isFinite(supplied) && supplied > 0 ? Math.min(supplied, 5000) : 5000;
  let timer;
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => { reject(new TrackError('PAYMENT_PROOF_TIMEOUT', '报名状态核实超时，请稍后重试。', 504)); controller.abort(); }, timeoutMs); });
  try {
    return await Promise.race([deadline, (async () => {
      const response = await (options.fetchImpl || fetch)(`${new URL(config.url).origin}/rest/v1/rpc/get_activity_registration`, { method: 'POST', headers: { apikey: config.key, authorization: request.headers.get('authorization'), 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify({ p_activity_id: activityId }), redirect: 'manual', signal: controller.signal });
      if (!response.ok) { try { Promise.resolve(response.body?.cancel()).catch(() => {}); } catch { /* closed */ } throw new TrackError('PAYMENT_PROOF_UNAVAILABLE', '暂时无法核实报名状态，请刷新后重试。', 503); }
      const bytes = await readBounded(response.body, 256 * 1024, 'PAYMENT_PROOF_UNAVAILABLE', '报名服务返回了无效数据，请稍后重试。', 503, controller.signal);
      try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
      catch { throw new TrackError('PAYMENT_PROOF_UNAVAILABLE', '报名服务返回了无效数据，请稍后重试。', 503); }
    })()]);
  } catch (error) { if (error instanceof TrackError) throw error; throw new TrackError('PAYMENT_PROOF_UNAVAILABLE', '暂时无法核实报名状态，请刷新后重试。', 503); }
  finally { clearTimeout(timer); }
}

async function readUpload(request, options) {
  const contentType = request.headers.get('content-type') || '';
  if (!/^multipart\/form-data\s*(?:;|$)/i.test(contentType)) throw new TrackError('UNSUPPORTED_MEDIA_TYPE', '请通过上传表单提交缴费记录图片。', 415);
  const length = request.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > MAX_PAYMENT_PROOF_REQUEST_BYTES)) throw new TrackError('REQUEST_TOO_LARGE', '缴费记录上传请求不能超过 8 MiB 加 64 KiB。', 413);
  const controller = new AbortController();
  const supplied = Number(options.bodyTimeoutMs), timeoutMs = Number.isFinite(supplied) && supplied > 0 ? Math.min(supplied, 30000) : 30000;
  let timer;
  const deadline = new Promise((_, reject) => { timer = setTimeout(() => { reject(new TrackError('REQUEST_TIMEOUT', '缴费记录上传超时，请重新选择图片。', 408)); controller.abort(); }, timeoutMs); });
  let bytes;
  try { bytes = await Promise.race([readBounded(request.body, MAX_PAYMENT_PROOF_REQUEST_BYTES, 'REQUEST_TOO_LARGE', '缴费记录上传请求不能超过 8 MiB 加 64 KiB。', 413, controller.signal), deadline]); }
  finally { clearTimeout(timer); }
  let form;
  try { form = await new Request(request.url, { method: 'POST', headers: { 'content-type': contentType }, body: bytes }).formData(); }
  catch { throw new TrackError('INVALID_UPLOAD', '文件上传格式无效，请重新选择图片。', 400); }
  const entries = [...form.entries()], file = entries[0]?.[1];
  if (entries.length !== 1 || entries[0][0] !== 'file' || typeof file !== 'object' || typeof file.name !== 'string' || typeof file.arrayBuffer !== 'function') throw new TrackError('INVALID_UPLOAD', '请仅提交一个名为 file 的缴费记录图片。', 400);
  if (!file.size || file.size > MAX_PAYMENT_PROOF_SOURCE_BYTES) throw new TrackError('FILE_TOO_LARGE', '请选择非空且不超过 8 MiB 的缴费记录图片。', 413);
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new TrackError('UNSUPPORTED_FORMAT', '缴费记录仅支持 JPEG、PNG 或 WebP 图片。', 415);
  return file;
}

export async function handlePaymentProofRequest(request, env = {}, options = {}) {
  const url = new URL(request.url);
  if (url.pathname !== '/api/payments/proofs/process') return null;
  if (request.method !== 'POST') return jsonResponse({ error: { code: 'METHOD_NOT_ALLOWED', message: '此接口仅支持 POST。' } }, 405, { allow: 'POST' });
  try {
    requireSameOrigin(request, url);
    const expectedUserId = request.headers.get('x-expected-user-id'), activityId = url.searchParams.get('activityId'), applicationId = url.searchParams.get('applicationId');
    if (!uuid(expectedUserId) || !uuid(activityId) || !uuid(applicationId)) throw new TrackError('INVALID_IDENTITY', '报名与账号信息无效，请刷新页面后重试。', 400);
    const config = getAuthConfiguration(env);
    if (!config) throw new TrackError('SERVICE_UNAVAILABLE', '缴费记录服务尚未完成配置，请稍后重试。', 503);
    const user = await verifyAuthenticatedUser(request, config, options);
    if (user.id !== expectedUserId) throw new TrackError('IDENTITY_CHANGED', '登录账号已变化，请刷新报名状态后重试。', 409);
    const state = await registrationState(request, config, activityId, options), application = state?.application;
    if (state?.canSubmitPaymentProof === false || application?.id !== applicationId || application?.userId !== user.id || application.status !== 'active' || application.selectionStatus !== 'confirmed' || application.paymentStatus !== 'unpaid') throw new TrackError('PAYMENT_PROOF_NOT_ALLOWED', '仅本人当前入选且未缴费的报名可以提交缴费记录，请刷新核实状态。', 403);
    const file = await readUpload(request, options);
    const result = await processPaymentProof(file, options.images || env.IMAGES, options);
    return new Response(result.bytes, { headers: { 'content-type': 'image/webp', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-payment-proof-processed': '1', 'x-payment-proof-original-bytes': String(result.originalBytes), 'x-payment-proof-output-bytes': String(result.bytes.byteLength) } });
  } catch (error) {
    const known = error instanceof TrackError;
    return jsonResponse({ error: { code: known ? error.code : 'INTERNAL_ERROR', message: known ? error.message : '缴费记录图片暂时无法处理，请稍后重试。' } }, known ? error.status : 500);
  }
}
