import { validRegistrationState } from '../applications/registration.js';
import { PAYMENT_STATUSES } from './status.js';

const MAX_SOURCE = 8 * 1024 * 1024, MAX_OUTPUT = 3 * 1024 * 1024;
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const validPath = path => typeof path === 'string' && path.split('/').length === 3 && uuid(path.split('/')[0]) && uuid(path.split('/')[1]) && path.endsWith('.webp') && uuid(path.split('/')[2].slice(0,-5));
function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
function checkSignal(signal) { if (signal?.aborted) fail('ABORTED', '操作已取消，请重新检查缴费记录。'); }

// SDK Storage calls do not accept an AbortSignal in this pinned version. A late
// completion may leave an unreferenced private object, but can never submit it.
function bounded(operation, signal, timeoutMs = 60000) {
  checkSignal(signal);
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, value) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort); fn(value); };
    const abort = () => { const error = new Error('操作已取消，请重新检查缴费记录。'); error.code = 'ABORTED'; finish(reject, error); };
    const timer = setTimeout(() => { const error = new Error('缴费记录操作超时，请刷新状态后重试。'); error.code = 'PAYMENT_PROOF_TIMEOUT'; finish(reject, error); }, timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    Promise.resolve(operation).then(value => finish(resolve, value), error => finish(reject, error));
    if (signal?.aborted) abort();
  });
}

async function identity(client, expectedUserId, signal) {
  if (!uuid(expectedUserId) || !client?.auth?.getUser) fail('LOGIN_REQUIRED', '请先登录并重新确认当前报名账号。');
  let result;
  try { result = await bounded(client.auth.getUser(), signal, 10000); }
  catch (error) { if (error.code === 'ABORTED') throw error; fail('AUTH_UNAVAILABLE', '暂时无法核实账号，请重新登录后再操作。'); }
  const user = result?.data?.user;
  if (result?.error || !user?.id || user.is_anonymous === true) fail('LOGIN_REQUIRED', '请先登录邮箱账号再提交缴费记录。');
  if (user.id !== expectedUserId) fail('LOGIN_CHANGED', '登录账号已变化，请重新确认当前账号。');
  checkSignal(signal);
  return user;
}

async function processedBytes(response, signal) {
  const reader = response.body?.getReader();
  if (!reader) fail('INVALID_IMAGE_OUTPUT', '图片处理服务返回了无效结果，请稍后重试。');
  const chunks = []; let size = 0;
  const deadline = Date.now() + 60000;
  try {
    while (true) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) fail('PAYMENT_PROOF_TIMEOUT', '缴费记录图片读取超时，请稍后重试。');
      const { done, value } = await bounded(reader.read(), signal, remaining);
      if (done) break;
      size += value.byteLength;
      if (size > MAX_OUTPUT) fail('INVALID_IMAGE_OUTPUT', '处理后的缴费记录仍超过 3 MiB，请选择较小图片。');
      chunks.push(value);
    }
  } catch (error) { try { Promise.resolve(reader.cancel()).catch(() => {}); } catch { /* closed */ } throw error; }
  finally { try { reader.releaseLock(); } catch { /* cancellation */ } }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  if (size < 12 || ![82,73,70,70].every((v,i) => bytes[i] === v) || ![87,69,66,80].every((v,i) => bytes[i+8] === v)) fail('INVALID_IMAGE_OUTPUT', '图片处理服务返回了无效结果，请稍后重试。');
  return bytes;
}

export async function uploadPaymentProof(client, file, { activityId, applicationId, expectedUserId, expectedPaymentStatus = 'unpaid', expectedProofId = null, stagedPath, signal, fetchImpl = fetch, randomUUID = () => crypto.randomUUID() } = {}) {
  if (!uuid(activityId) || !uuid(applicationId) || !PAYMENT_STATUSES.includes(expectedPaymentStatus) || (expectedProofId !== null && !uuid(expectedProofId))) fail('INVALID_PROOF', '报名与缴费状态无效，请刷新后重试。');
  if (!stagedPath && (!['image/jpeg', 'image/png', 'image/webp'].includes(file?.type) || !Number.isFinite(file?.size) || file.size <= 0 || file.size > MAX_SOURCE)) fail('INVALID_FILE', '请选择非空且不超过 8 MiB 的 JPEG、PNG 或 WebP 缴费记录图片。');
  if (!stagedPath && expectedPaymentStatus !== 'unpaid') fail('INVALID_PROOF', '当前缴费记录已提交或确认，请刷新状态。');
  const user = await identity(client, expectedUserId, signal);
  if (!client.storage?.from || !client.rpc) fail('SERVICE_UNAVAILABLE', '缴费记录服务暂时不可用，请稍后重试。');
  let path = stagedPath;
  if (path && (!validPath(path) || !path.startsWith(`${user.id}/${applicationId}/`))) fail('INVALID_PROOF', '待确认的缴费记录不属于当前报名，请刷新页面。');
  if (!path) {
    let session;
    try { session = await bounded(client.auth.getSession(), signal, 10000); }
    catch { fail('LOGIN_REQUIRED', '登录状态已失效，请重新登录后上传缴费记录。'); }
    if (session?.error || !session?.data?.session?.access_token || session.data.session.user?.id !== user.id) fail('LOGIN_CHANGED', '登录账号已变化，请重新确认当前账号。');
    const body = new FormData(); body.append('file', file);
    let response;
    try { response = await bounded(fetchImpl(`/api/payments/proofs/process?activityId=${encodeURIComponent(activityId)}&applicationId=${encodeURIComponent(applicationId)}`, { method: 'POST', headers: { Authorization: `Bearer ${session.data.session.access_token}`, 'X-Expected-User-Id': user.id }, body, signal: signal || AbortSignal.timeout(65000), redirect: 'manual' }), signal, 65000); }
    catch (error) { if (error.code === 'ABORTED') throw error; fail('IMAGE_PROCESSING_FAILED', '缴费记录图片处理未完成，请稍后重试。'); }
    if (!response.ok || response.headers.get('x-payment-proof-processed') !== '1' || response.headers.get('content-type')?.split(';')[0] !== 'image/webp') { try { Promise.resolve(response.body?.cancel()).catch(() => {}); } catch { /* closed */ } fail('IMAGE_PROCESSING_FAILED', '缴费记录图片处理未完成，请刷新报名状态后重试。'); }
    const bytes = await processedBytes(response, signal);
    await identity(client, expectedUserId, signal);
    const id = randomUUID(); if (!uuid(id)) fail('INVALID_PROOF', '无法生成缴费记录编号，请重试。');
    path = `${user.id}/${applicationId}/${id}.webp`;
    let upload;
    try { upload = await bounded(client.storage.from('payment-proofs').upload(path, new Blob([bytes], { type: 'image/webp' }), { upsert: false, contentType: 'image/webp', cacheControl: '0' }), signal); }
    catch (error) { if (error.code === 'ABORTED') throw error; fail('UPLOAD_FAILED', '缴费记录图片上传未完成，请重新检查后再试。'); }
    if (upload?.error) fail('UPLOAD_FAILED', '缴费记录图片上传未完成，请重新检查后再试。');
  }
  try {
    await identity(client, expectedUserId, signal);
    const result = await bounded(client.rpc('submit_activity_payment_proof', { p_activity_id: activityId, p_object_path: path, p_expected_user_id: user.id, p_expected_payment_status: expectedPaymentStatus, p_expected_proof_id: expectedProofId }), signal, 15000);
    const state = result?.data;
    if (result?.error || !validRegistrationState(state, user.id) || state.application?.id !== applicationId || !['pending', 'paid'].includes(state.application?.paymentStatus) || state.application.paymentProofs?.[0]?.objectPath !== path) fail('SUBMISSION_FAILED', '缴费记录尚未确认提交，请刷新状态后重试。');
    await identity(client, expectedUserId, signal);
    return state;
  } catch (caught) {
    const error = new Error(caught.code === 'ABORTED' ? caught.message : '缴费记录尚未确认提交，请刷新状态后重试。');
    error.code = caught.code || 'SUBMISSION_FAILED'; error.stagedPath = path; throw error;
  }
}

export async function downloadPaymentProof(client, proof, { expectedUserId, signal } = {}) {
  if (!validPath(proof?.objectPath)) fail('INVALID_PROOF', '缴费记录图片地址无效，请重新加载。');
  const canRead = user => user.id === proof.objectPath.split('/')[0] || user.app_metadata?.role === 'admin';
  const user = await identity(client, expectedUserId, signal);
  if (!canRead(user) || !client.storage?.from) fail('FORBIDDEN', '无法查看这份缴费记录，请重新核实权限。');
  let result;
  try { result = await bounded(client.storage.from('payment-proofs').download(proof.objectPath), signal, 30000); }
  catch (error) { if (error.code === 'ABORTED') throw error; fail('DOWNLOAD_FAILED', '暂时无法读取缴费记录图片，请稍后重试。'); }
  const current = await identity(client, expectedUserId, signal);
  if (!canRead(current)) fail('FORBIDDEN', '登录权限已变化，请重新加载。');
  const blob = result?.data;
  if (result?.error || !(blob instanceof Blob) || blob.type !== 'image/webp' || !blob.size || blob.size > MAX_OUTPUT) fail('DOWNLOAD_FAILED', '暂时无法读取有效的缴费记录图片，请稍后重试。');
  return blob;
}
