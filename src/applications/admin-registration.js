import { PAYMENT_STATUSES } from '../payments/status.js';
const fail = (code, message) => { const error = new Error(message); error.code = code; throw error; };
function validateState(data) {
  if (!data || typeof data.viewerId !== 'string' || !data.viewerId || !(data.capacity === null || Number.isInteger(data.capacity) && data.capacity > 0) || !['activeCount', 'confirmedCount', 'waitlistCount'].every(key => Number.isInteger(data[key]) && data[key] >= 0) || !Array.isArray(data.applications)) fail('INVALID_RESPONSE', '报名服务返回的数据不完整，请重新加载。');
  const sealed = ['cleaning','verifying','completed'].includes(data.retention?.status) || Boolean(data.retention?.dueAt && Date.parse(data.retention.dueAt) <= Date.now());
  for (const row of data.applications) {
    if (!row?.id || !['active', 'withdrawn'].includes(row.status) || !PAYMENT_STATUSES.includes(row.paymentStatus)) fail('INVALID_RESPONSE', '报名服务返回的数据不完整，请重新加载。');
    if (Object.hasOwn(row, 'paymentProofs') && (!Array.isArray(row.paymentProofs) || row.paymentProofs.some(proof => !proof || typeof proof.id !== 'string' || !proof.id || typeof proof.objectPath !== 'string' || !proof.objectPath || typeof proof.submittedAt !== 'string' || !Number.isFinite(Date.parse(proof.submittedAt))))) fail('INVALID_RESPONSE', '缴费记录信息不完整，请重新加载。');
    if (Object.hasOwn(row, 'currentPaymentProofId') && row.currentPaymentProofId !== null && (typeof row.currentPaymentProofId !== 'string' || !row.proofsPurgedAt && !sealed && !row.paymentProofs?.some(proof => proof.id === row.currentPaymentProofId))) fail('INVALID_RESPONSE', '当前缴费记录信息不完整，请重新加载。');
  }
  // Do not retain legacy website-readable audit records even from an older response.
  const { events, ...state } = data;
  return state;
}
async function request(client, name, args, validate = validateState) {
  if (!client?.rpc) fail('SERVICE_UNAVAILABLE', '报名管理服务暂时不可用，请稍后重新加载。');
  let result;
  try { result = await client.rpc(name, args); } catch { fail('REQUEST_FAILED', '请求未完成，请重新加载核实状态。'); }
  if (result?.error) fail(result.error.code || 'REQUEST_FAILED', '操作未完成，身份、资料或状态可能已变化。请重新加载后核对。');
  return validate(result?.data);
}
export async function verifyRegistrationAdmin(client, expectedUserId) {
  if (!expectedUserId || !client?.auth?.getUser) fail('IDENTITY_REQUIRED', '无法核实名单所属管理员，请重新加载。');
  let identity;
  try { identity = await client.auth.getUser(); } catch { fail('AUTH_UNAVAILABLE', '暂时无法核实管理员身份，请重新加载后再操作。'); }
  if(identity?.error && !['bad_jwt','user_not_found','session_not_found','refresh_token_not_found','refresh_token_already_used'].includes(identity.error.code) && ![401,403].includes(identity.error.status)) fail('AUTH_UNAVAILABLE', '暂时无法核实管理员身份，请稍后重新加载。');
  const user = identity?.data?.user;
  if (identity?.error || !user?.id || user.is_anonymous === true || user.app_metadata?.role !== 'admin' || user.id !== expectedUserId) fail('IDENTITY_CHANGED', '管理员登录状态已变化，请重新加载名单后再操作。');
  return user.id;
}
export const isAdminIdentityError = error => ['IDENTITY_CHANGED','IDENTITY_REQUIRED','PGRST301','PGRST302','bad_jwt','user_not_found'].includes(error?.code);
function sameViewer(data, id) { if (data.viewerId !== id) fail('IDENTITY_CHANGED', '管理员登录状态已变化，请重新加载名单核实结果。'); return data; }
export function readActivityRegistrations(client, activityId) {
  if (!activityId) return Promise.reject(new Error('缺少活动信息，请关闭后重试。'));
  return request(client, 'get_activity_registrations', { p_activity_id: activityId });
}
export async function setApplicationPayment(client, { applicationId, paymentStatus, expectedPaymentStatus, expectedUserId, expectedProofId = null }) {
  if (!applicationId || !PAYMENT_STATUSES.includes(paymentStatus) || !PAYMENT_STATUSES.includes(expectedPaymentStatus) || expectedProofId !== null && (typeof expectedProofId !== 'string' || !expectedProofId)) fail('INVALID_PAYMENT', '缴费状态无效，请重新加载。');
  await verifyRegistrationAdmin(client, expectedUserId);
  return sameViewer(await request(client, 'set_activity_registration_payment', { p_application_id: applicationId, p_payment_status: paymentStatus, p_expected_payment_status: expectedPaymentStatus, p_expected_user_id: expectedUserId, p_expected_proof_id: expectedProofId }), expectedUserId);
}
export async function setApplicationInsurance(client, { applicationId, insuranceStatus, expectedInsuranceStatus, expectedUserId, expectedDetailsUpdatedAt }) {
  if (!applicationId || !['insured','uninsured'].includes(insuranceStatus) || !['insured','uninsured'].includes(expectedInsuranceStatus) || expectedDetailsUpdatedAt != null && !Number.isFinite(Date.parse(expectedDetailsUpdatedAt))) fail('INVALID_INSURANCE', '保险资料无效，请重新加载。');
  await verifyRegistrationAdmin(client, expectedUserId);
  return sameViewer(await request(client, 'set_activity_registration_insurance', { p_application_id: applicationId, p_insurance_status: insuranceStatus, p_expected_insurance_status: expectedInsuranceStatus, p_expected_user_id: expectedUserId, p_expected_details_updated_at: expectedDetailsUpdatedAt ?? null }), expectedUserId);
}
function validateConfirmation(data) {
  if (!data?.confirmationId || !data.activityId || !Number.isFinite(Date.parse(data.expiresAt)) || !['applicationCount','detailsCount','proofCount'].every(k=>Number.isInteger(data[k]) && data[k]>=0)) fail('INVALID_RESPONSE', '清理确认信息不完整，请重新发起。');
  return data;
}
function checkExpiry(confirmation) { validateConfirmation(confirmation); if (Date.parse(confirmation.expiresAt) <= Date.now()) fail('CONFIRMATION_EXPIRED', '清理确认已过期，请重新发起。'); }
export async function prepareActivityCleanup(client, { activityId, expectedUserId }) {
  await verifyRegistrationAdmin(client, expectedUserId);
  const result = await request(client, 'prepare_activity_data_cleanup', { p_activity_id: activityId, p_expected_user_id: expectedUserId }, validateConfirmation);
  if (result.activityId !== activityId) fail('INVALID_RESPONSE','清理活动不匹配，请重新发起。');
  return result;
}
async function cleanupStage(client, name, { confirmation, expectedUserId }, final) {
  checkExpiry(confirmation); await verifyRegistrationAdmin(client, expectedUserId); checkExpiry(confirmation);
  const data=await request(client,name,{p_confirmation_id:confirmation.confirmationId,p_expected_user_id:expectedUserId},final?validateState:validateConfirmation);
  if(final) return sameViewer(data,expectedUserId);
  if(data.confirmationId!==confirmation.confirmationId || data.activityId!==confirmation.activityId) fail('INVALID_RESPONSE','清理确认已变化，请重新发起。');
  return data;
}
export const confirmActivityCleanup = (client, options) => cleanupStage(client,'confirm_activity_data_cleanup',options,false);
export const executeActivityCleanup = (client, options) => cleanupStage(client,'execute_activity_data_cleanup',options,true);
export async function readInsuranceExport(client, { activityId, expectedUserId }) {
  await verifyRegistrationAdmin(client,expectedUserId);
  return sameViewer(await request(client,'export_activity_insurance',{p_activity_id:activityId,p_expected_user_id:expectedUserId},data=>{
    if(!data || data.activityId!==activityId || !Array.isArray(data.rows) || data.rows.some(row=>!row.applicationId || !['insured','uninsured'].includes(row.insuranceStatus) || ['realName','idNumber','phone'].some(k=>row[k]!==null && typeof row[k]!=='string'))) fail('INVALID_RESPONSE','导出资料不完整，请重新加载。');
    return data;
  }),expectedUserId);
}
