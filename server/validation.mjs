export class HttpError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code; }
}
export const fail = (status, message) => { throw new HttpError(status, message); };

export function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(400, '请求内容必须是 JSON 对象。');
  return value;
}
export function string(value, field, { required = false, max = 20000 } = {}) {
  if (typeof value !== 'string' || value.length > max || (required && !value.trim())) fail(400, `${field}格式不正确${required ? '，且不能为空' : ''}。`);
  return value.trim();
}
export function url(value, field) {
  const input = string(value, field, { max: 2048 });
  if (!input) return '';
  if (/^\/(?:images|uploads)\/[A-Za-z0-9_\-/.]+$/.test(input) && !input.includes('..') && !input.includes('//')) return input;
  try {
    const parsed = new URL(input);
    if (['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password) return parsed.href;
  } catch {}
  fail(400, `${field}必须是 http(s) 链接，或 /images/、/uploads/ 下的安全路径。`);
}
export function revision(value) {
  if (value !== undefined && (!Number.isSafeInteger(value) || value < 1)) fail(400, '内容版本号格式不正确。');
  return value;
}
export function id(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(value)) fail(400, '内容 ID 格式不正确。');
  return value;
}
const textFields = ['clubName', 'school', 'founded', 'intro', 'aboutDescription', 'teamDescription', 'teamTraining', 'teamAchievements', 'signupInstructions', 'contactWechat', 'contactName'];
const urlFields = ['heroActivities', 'heroAbout', 'heroTeam', 'storyHiking', 'storyClimbing', 'officialSignupUrl', 'officialQrImage'];
export function settings(value) {
  const input = object(value), result = {};
  result.logoUrl = url(input.logoUrl ?? '', '社团标志');
  if (input.demoMode !== undefined && typeof input.demoMode !== 'boolean') fail(400, '演示模式标记格式不正确。');
  result.demoMode = input.demoMode ?? true;
  for (const field of textFields) result[field] = string(input[field], field, { required: ['clubName', 'school'].includes(field) });
  for (const field of urlFields) result[field] = url(input[field], field);
  result.contactEmail = string(input.contactEmail, '联系邮箱', { max: 254 });
  if (result.contactEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.contactEmail)) fail(400, '联系邮箱格式不正确。');
  if (!Array.isArray(input.growthSteps) || input.growthSteps.length > 8) fail(400, '成长路径必须是最多 8 个步骤的列表。');
  result.growthSteps = input.growthSteps.map(step => {
    object(step);
    return { title: string(step.title, '步骤标题', { required: true, max: 100 }), description: string(step.description, '步骤说明', { max: 2000 }) };
  });
  result.revision = revision(input.revision);
  return result;
}
function common(input) {
  if (!['draft', 'published'].includes(input.status)) fail(400, '发布状态必须是草稿或已发布。');
  if (typeof input.isDemo !== 'boolean') fail(400, '示例内容标记格式不正确。');
  return { title: string(input.title, '标题', { required: true, max: 200 }), summary: string(input.summary, '摘要', { max: 2000 }), description: string(input.description, '正文'), image: url(input.image, '封面图片'), status: input.status, isDemo: input.isDemo, revision: revision(input.revision) };
}
export function activity(value) {
  const input = object(value), result = common(input);
  if (!['upcoming', 'past'].includes(input.kind)) fail(400, '活动类型格式不正确。');
  result.kind = input.kind;
  const date = string(input.date, '活动日期', { required: true, max: 10 });
  const parsedDate = new Date(`${date}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(+parsedDate) || parsedDate.toISOString().slice(0, 10) !== date) fail(400, '活动日期必须是有效的 YYYY-MM-DD 日期。');
  result.date = date;
  for (const field of ['category', 'location', 'difficulty']) result[field] = string(input[field], field, { max: 200 });
  result.signupUrl = url(input.signupUrl, '报名链接'); result.qrImage = url(input.qrImage, '报名二维码');
  return result;
}
export function project(value) {
  const input = object(value), result = common(input);
  for (const field of ['mountain', 'elevation', 'plannedDate', 'duration']) result[field] = string(input[field], field, { max: 200 });
  for (const field of ['trainingPlan', 'supportNeeds', 'cooperationValue']) result[field] = string(input[field], field);
  return result;
}
export function password(value) {
  if (typeof value !== 'string' || value.length < 12 || value.length > 128) fail(400, '密码须为 12 至 128 个字符。');
  return value;
}
export function username(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9_.-]{3,40}$/.test(value)) fail(400, '账号须为 3 至 40 位字母、数字、点、横线或下划线。');
  return value.toLowerCase();
}
export function role(value) {
  if (!['admin', 'editor'].includes(value)) fail(400, '账号角色格式不正确。');
  return value;
}
