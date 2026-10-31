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
  if (activity.status === '已结束') return { isPublic, open: false, reason: '本次活动已结束。' };
  if (activity.registrationOpen !== true) return { isPublic, open: false, reason: '报名尚未开放，请关注正式活动通知。' };
  const deadline = Date.parse(activity.registrationDeadline || '');
  if (!Number.isFinite(deadline)) return { isPublic, open: false, reason: '报名时间尚未确认，请关注正式活动通知。' };
  if (deadline <= now) return { isPublic, open: false, reason: '报名已截止。' };
  return { isPublic, open: true, reason: '' };
}

export async function readOwnApplication(client, activityId, userId) {
  if (!client || !activityId || !userId) fail('SERVICE_UNAVAILABLE', '报名服务暂时不可用，请稍后重试。');
  const { data, error } = await client.from('applications').select('id,created_at').eq('activity_id', activityId).eq('user_id', userId).maybeSingle();
  if (error) fail('READ_FAILED', '暂时无法确认报名记录，请重试后再提交。');
  if (data && (typeof data.id !== 'string' || !data.id)) fail('READ_FAILED', '报名服务返回了不完整的记录，请稍后重试。');
  return data || null;
}

export async function submitActivityApplication(client, activity, { expectedUserId } = {}) {
  const availability = registrationAvailability(activity);
  if (!availability.open) fail('REGISTRATION_CLOSED', availability.reason);
  if (!client) fail('SERVICE_UNAVAILABLE', '报名服务暂时不可用，请稍后重试。');
  const { data: identity, error: identityError } = await client.auth.getUser();
  if (identityError && identityError.name !== 'AuthSessionMissingError' && identityError.code !== 'session_not_found') fail('AUTH_UNAVAILABLE', '暂时无法核实登录状态，请稍后重试。');
  const user = identity?.user;
  if (!user?.id || user.is_anonymous === true) fail('LOGIN_REQUIRED', '请先登录邮箱账号，再提交活动报名。');
  if (expectedUserId && expectedUserId !== user.id) fail('LOGIN_CHANGED', '登录账号已变化，请重新确认当前账号后再报名。');
  // Ownership is verified again by applications_owner_insert. The browser never
  // selects another account or writes any application approval/status fields.
  const { data, error } = await client.from('applications').insert({ activity_id: activity.id, user_id: user.id, payload: {} }).select('id,created_at').single();
  if (error?.code === '23505') {
    const existing = await readOwnApplication(client, activity.id, user.id);
    if (existing) return { ...existing, alreadySubmitted: true };
  }
  if (error || typeof data?.id !== 'string' || !data.id) fail('SUBMIT_FAILED', '报名未完成。活动可能已截止或尚未开放，请刷新活动后重试。');
  return { ...data, alreadySubmitted: false };
}
