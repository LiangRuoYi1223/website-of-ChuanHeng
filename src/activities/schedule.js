const fail = message => { throw new Error(message); };

export function scheduleInstant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return NaN;
  const calendar = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== value.slice(0, 10)) return NaN;
  return Date.parse(value);
}

export function toLocalDateTime(value) {
  const instant = scheduleInstant(value);
  if (!Number.isFinite(instant)) return '';
  const date = new Date(instant);
  return new Date(instant - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

function localInstant(value, label) {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  const date = new Date(value);
  if (!match || !Number.isFinite(date.getTime()) || [date.getFullYear(), date.getMonth() + 1, date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds()].some((part, index) => part !== Number(match[index + 1] || 0))) fail(`${label}无效，请选择有效的日期与时间。`);
  return date.toISOString();
}

export function readActivitySchedule(form, { published = false, legacy = false } = {}) {
  const fields = { dateStart: '活动开始时间', dateEnd: '活动结束时间', registrationStart: '报名开启时间', registrationDeadline: '报名截止时间' };
  const result = Object.fromEntries(Object.entries(fields).map(([field, label]) => [field, localInstant(String(form.get(field) || '').trim(), label)]));
  result.registrationOpen = form.get('registrationOpen') === 'on';
  if (published && !legacy && (!result.dateStart || !result.dateEnd)) fail('发布活动需要填写活动开始和结束时间。');
  if (result.dateStart && result.dateEnd && Date.parse(result.dateEnd) <= Date.parse(result.dateStart)) fail('活动结束时间必须晚于开始时间。');
  if (result.registrationStart && result.registrationDeadline && Date.parse(result.registrationStart) >= Date.parse(result.registrationDeadline)) fail('报名开启时间必须早于报名截止时间。');
  if (result.registrationDeadline && result.dateStart && Date.parse(result.registrationDeadline) > Date.parse(result.dateStart)) fail('报名截止时间不能晚于活动开始时间。');
  if (result.registrationOpen && Object.keys(fields).some(field => !result[field])) fail('开启报名需要填写完整的报名开启、截止及活动开始、结束时间。');
  return result;
}

export function effectiveActivityStatus(activity, now = Date.now()) {
  if (activity?.status === '已结束') return '已结束';
  const start = scheduleInstant(activity?.dateStart), end = scheduleInstant(activity?.dateEnd);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return activity?.status || '即将开始';
  if (now >= end) return '已结束';
  if (now >= start) return '进行中';
  const opening = scheduleInstant(activity.registrationStart), deadline = scheduleInstant(activity.registrationDeadline);
  if (activity.registrationOpen === true && opening < deadline && deadline <= start && now >= opening && now < deadline) return '报名中';
  return '即将开始';
}

export function formatActivityTime(value) {
  if (!Number.isFinite(scheduleInstant(value))) return '待公布';
  return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(value));
}

export function activityDateLabel(activity) {
  if (Number.isFinite(scheduleInstant(activity?.dateStart))) {
    const start = formatActivityTime(activity.dateStart);
    return Number.isFinite(scheduleInstant(activity.dateEnd)) ? `${start} — ${formatActivityTime(activity.dateEnd)}` : start;
  }
  return activity?.date || activity?.dateStart || '日期待公布';
}
