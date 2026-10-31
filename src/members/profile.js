const fail = (message, code) => { const error = new Error(message); if (code) error.code = code; throw error; };
export async function verifyMember(client, expectedUserId) {
  let result;
  try { result = await client?.auth?.getUser(); } catch { fail('暂时无法核实登录状态，请重试。'); }
  const user = result?.data?.user;
  if (result?.error?.name === 'AuthSessionMissingError' || result?.error?.code === 'session_not_found') fail('请先登录后重试。', 'LOGIN_REQUIRED');
  if (result?.error) fail('暂时无法核实登录状态，请重试。', 'AUTH_UNAVAILABLE');
  if (!user?.id || user.is_anonymous) fail('请先登录后重试。', 'LOGIN_REQUIRED');
  if (expectedUserId && user.id !== expectedUserId) fail('登录账号已变化，请重新确认当前账号。', 'LOGIN_CHANGED');
  return user;
}
async function request(client, name, args) {
  let result;
  try { result = await client.rpc(name, args); } catch { fail('个人资料服务暂时不可用，请重试。'); }
  if (result?.error) fail('资料未能保存或读取，请刷新后重试。');
  return result?.data;
}
function profile(value, userId) {
  if (!value || value.userId !== userId || !['username','realName','phone'].every(key => typeof value[key] === 'string') || !(value.updatedAt === null || (typeof value.updatedAt === 'string' && Number.isFinite(Date.parse(value.updatedAt))))) fail('个人资料暂时无法确认，请刷新后重试。');
  return {userId, username:value.username,realName:value.realName,phone:value.phone,updatedAt:value.updatedAt};
}
export async function readMemberProfile(client, expectedUserId) {
  const user = await verifyMember(client, expectedUserId);
  return profile(await request(client,'get_member_profile',{}),user.id);
}
export async function saveMemberProfile(client, value, {expectedUserId} = {}) {
  const user = await verifyMember(client, expectedUserId);
  const username = String(value.username || '').trim(), realName = String(value.realName || '').trim(), phone = String(value.phone || '').trim();
  if (username.length > 40 || realName.length > 80 || (phone && !/^1[3-9]\d{9}$/.test(phone))) fail('请检查用户名、真实姓名和中国大陆11位手机号。');
  const saved = await request(client,'save_member_profile',{p_username:username,p_real_name:realName,p_phone:phone,p_expected_updated_at:value.updatedAt ?? null,p_expected_user_id:user.id});
  await verifyMember(client,user.id);
  return profile(saved,user.id);
}
export async function readMemberHistory(client, expectedUserId) {
  const user = await verifyMember(client, expectedUserId);
  const data = await request(client,'get_member_activity_history',{});
  if (data?.viewerId !== user.id || !Array.isArray(data.activities)) fail('活动记录暂时无法确认，请重试。');
  return data.activities;
}
