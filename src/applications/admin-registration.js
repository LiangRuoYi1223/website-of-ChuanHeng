import { PAYMENT_STATUSES } from '../payments/status.js';
const fail = (code, message) => { const error = new Error(message); error.code = code; throw error; };
function validateState(data) {
  if (!data || typeof data.viewerId !== 'string' || !data.viewerId || !(data.capacity === null || Number.isInteger(data.capacity) && data.capacity > 0) || !['activeCount', 'confirmedCount', 'waitlistCount'].every(key => Number.isInteger(data[key]) && data[key] >= 0) || !Array.isArray(data.applications) || !Array.isArray(data.events)) fail('INVALID_RESPONSE', '报名服务返回的数据不完整，请重新加载。');
  for (const row of data.applications) if (!row?.id || !['active', 'withdrawn'].includes(row.status) || !PAYMENT_STATUSES.includes(row.paymentStatus)) fail('INVALID_RESPONSE', '报名服务返回的数据不完整，请重新加载。');
  for (const row of data.applications) {
    if (Object.hasOwn(row, 'paymentProofs') && (!Array.isArray(row.paymentProofs) || row.paymentProofs.some(proof => !proof || typeof proof.id !== 'string' || !proof.id || typeof proof.objectPath !== 'string' || !proof.objectPath || typeof proof.submittedAt !== 'string' || !Number.isFinite(Date.parse(proof.submittedAt))))) fail('INVALID_RESPONSE', '缴费记录信息不完整，请重新加载。');
    if (Object.hasOwn(row, 'currentPaymentProofId') && row.currentPaymentProofId !== null && (typeof row.currentPaymentProofId !== 'string' || !row.paymentProofs?.some(proof => proof.id === row.currentPaymentProofId))) fail('INVALID_RESPONSE', '当前缴费记录信息不完整，请重新加载。');
  }
  return data;
}
async function request(client, name, args) {
  if (!client?.rpc) fail('SERVICE_UNAVAILABLE', '报名管理服务暂时不可用，请稍后重新加载。');
  let result;
  try { result = await client.rpc(name, args); } catch { fail('REQUEST_FAILED', '请求未完成，请重新加载核实状态。'); }
  if (result?.error) fail(result.error.code || 'REQUEST_FAILED', name === 'set_activity_registration_payment' ? '缴费状态未能更新，记录可能已由其他管理员修改。请重新加载后核对。' : '无法读取报名名单，请确认管理员登录状态后重新加载。');
  return validateState(result?.data);
}
export function readActivityRegistrations(client, activityId) {
  if (!activityId) return Promise.reject(new Error('缺少活动信息，请关闭后重试。'));
  return request(client, 'get_activity_registrations', { p_activity_id: activityId });
}
export async function setApplicationPayment(client, { applicationId, paymentStatus, expectedPaymentStatus, expectedUserId, expectedProofId = null }) {
  if (!applicationId || !PAYMENT_STATUSES.includes(paymentStatus) || !PAYMENT_STATUSES.includes(expectedPaymentStatus) || expectedProofId !== null && (typeof expectedProofId !== 'string' || !expectedProofId)) fail('INVALID_PAYMENT', '缴费状态无效，请重新加载。');
  if (!expectedUserId || !client?.auth?.getUser) fail('IDENTITY_REQUIRED', '无法核实名单所属管理员，请重新加载。');
  let identity;
  try { identity = await client.auth.getUser(); } catch { fail('AUTH_UNAVAILABLE', '暂时无法核实管理员身份，请重新加载后再操作。'); }
  const user = identity?.data?.user;
  if (identity?.error || !user?.id || user.is_anonymous === true || user.app_metadata?.role !== 'admin' || user.id !== expectedUserId) fail('IDENTITY_CHANGED', '管理员登录状态已变化，请重新加载名单后再操作。');
  const data = await request(client, 'set_activity_registration_payment', { p_application_id: applicationId, p_payment_status: paymentStatus, p_expected_payment_status: expectedPaymentStatus, p_expected_user_id: user.id, p_expected_proof_id: expectedProofId });
  if (data.viewerId !== expectedUserId) fail('IDENTITY_CHANGED', '管理员登录状态已变化，请重新加载名单核实结果。');
  return data;
}
