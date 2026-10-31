import { effectiveActivityStatus, scheduleInstant } from '../activities/schedule.js';

const fail = (code, message) => { const error = new Error(message); error.code = code; throw error; };

export function safeInternalReturn(value) {
  if (typeof value !== 'string' || value.length > 2048 || !value.startsWith('/')) return null;
  try {
    const decoded = decodeURIComponent(value);
    if (decoded.startsWith('//') || /[\\\x00-\x1f\x7f]/.test(decoded)) return null;
    const parsed = new URL(value, 'https://internal.invalid');
    if (parsed.origin !== 'https://internal.invalid' || parsed.pathname === '/login' || parsed.pathname.startsWith('/login/')) return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch { return null; }
}

export function registrationAvailability(activity, now = Date.now()) {
  const isPublic = Boolean(activity?.id && activity.published === true && activity.isDemo !== true && !activity.localDraft && !activity.archived);
  if (!isPublic) return { isPublic: false, open: false, reason: activity?.isDemo ? '设计示例不接受真实报名。' : '草稿或未公开活动不接受报名。' };
  const status = effectiveActivityStatus(activity, now);
  if (status === '已结束') return { isPublic, open: false, reason: '本次活动已结束。' };
  if (status === '进行中') return { isPublic, open: false, reason: '活动已开始，报名已关闭。' };
  if (activity.registrationOpen !== true) return { isPublic, open: false, reason: '报名尚未开放，请关注正式活动通知。' };
  const opening = scheduleInstant(activity.registrationStart), deadline = scheduleInstant(activity.registrationDeadline);
  const start = scheduleInstant(activity.dateStart), end = scheduleInstant(activity.dateEnd);
  if (![opening, deadline, start, end].every(Number.isFinite) || opening >= deadline || deadline > start || start >= end) return { isPublic, open: false, reason: '报名时间尚未确认，请关注正式活动通知。' };
  if (now < opening) return { isPublic, open: false, reason: '尚未到报名开启时间。' };
  if (deadline <= now) return { isPublic, open: false, reason: '报名已截止。' };
  if (!Number.isInteger(activity.registrationCapacity) || activity.registrationCapacity < 1 || activity.registrationCapacity > 100000) return { isPublic, open: false, reason: '活动名额尚未确认，请关注正式活动通知。' };
  return { isPublic, open: true, reason: '' };
}

async function verifyIdentity(client, expectedUserId) {
  if (!client?.auth?.getUser || !client?.rpc) fail('SERVICE_UNAVAILABLE', '报名服务暂时不可用，请稍后重试。');
  let identity, error;
  try { const result = await client.auth.getUser(); identity = result.data; error = result.error; }
  catch { fail('AUTH_UNAVAILABLE', '暂时无法核实登录状态，请稍后重试。'); }
  if (error && error.name !== 'AuthSessionMissingError' && error.code !== 'session_not_found') fail('AUTH_UNAVAILABLE', '暂时无法核实登录状态，请稍后重试。');
  const user = identity?.user;
  if (!user?.id || user.is_anonymous === true) fail('LOGIN_REQUIRED', '请先登录邮箱账号，再提交活动报名。');
  if (expectedUserId && user.id !== expectedUserId) fail('LOGIN_CHANGED', '登录账号已变化，请重新确认当前账号后再报名。');
  return user;
}

function validState(state, userId) {
  const count = value => Number.isInteger(value) && value >= 0;
  if (!state || !(state.capacity === null || (Number.isInteger(state.capacity) && state.capacity > 0 && state.capacity <= 100000)) || !['activeCount','confirmedCount','waitlistCount'].every(key => count(state[key])) || typeof state.canWithdraw !== 'boolean') return false;
  const app = state.application;
  return app === null || Boolean(app && typeof app.id === 'string' && app.id && app.userId === userId && ['active','withdrawn'].includes(app.status) && ['paid','unpaid'].includes(app.paymentStatus) && ['confirmed','waitlisted','withdrawn','unconfirmed'].includes(app.selectionStatus) && (app.position === null || (Number.isInteger(app.position) && app.position > 0)));
}

async function requestState(client, rpc, activityId, userId, message) {
  if (!activityId) fail('SERVICE_UNAVAILABLE', '报名服务暂时不可用，请稍后重试。');
  let result;
  const args = { p_activity_id: activityId };
  if (rpc === 'register_activity' || rpc === 'withdraw_activity_registration') args.p_expected_user_id = userId;
  try { result = await client.rpc(rpc, args); }
  catch { fail('REGISTRATION_FAILED', message); }
  if (result?.error || !validState(result?.data, userId)) fail('REGISTRATION_FAILED', message);
  const expectedStatus = rpc === 'register_activity' ? 'active' : rpc === 'withdraw_activity_registration' ? 'withdrawn' : null;
  if (expectedStatus && result.data.application?.status !== expectedStatus) fail('REGISTRATION_FAILED', message);
  return result.data;
}

export async function readActivityRegistration(client, activityId, expectedUserId) {
  const user = await verifyIdentity(client, expectedUserId);
  return requestState(client, 'get_activity_registration', activityId, user.id, '暂时无法确认报名记录，请重试后再提交。');
}

// Kept for callers that only need the member's own application.
export async function readOwnApplication(client, activityId, userId) {
  return (await readActivityRegistration(client, activityId, userId)).application;
}

export async function submitActivityApplication(client, activity, { expectedUserId } = {}) {
  const user = await verifyIdentity(client, expectedUserId);
  const availability = registrationAvailability(activity);
  if (!availability.open) fail('REGISTRATION_CLOSED', availability.reason);
  return requestState(client, 'register_activity', activity.id, user.id, '报名未完成。活动可能已截止或尚未开放，请重新检查后重试。');
}

export async function withdrawActivityRegistration(client, activityId, { expectedUserId } = {}) {
  const user = await verifyIdentity(client, expectedUserId);
  return requestState(client, 'withdraw_activity_registration', activityId, user.id, '退出未完成。活动可能已开始，请重新检查后重试。');
}
