import { scheduleInstant } from './schedule.js';

function historyInstant(value) {
  const instant = scheduleInstant(value);
  if (!Number.isFinite(instant)) return NaN;
  const [, hour, minute, second = '0'] = /T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(value);
  return Number(hour) < 24 && Number(minute) < 60 && Number(second) < 60 ? instant : NaN;
}

export function selectHistoryActivities(activities, now = Date.now()) {
  if (!Array.isArray(activities) || !Number.isFinite(now)) return [];

  return activities.filter(activity => {
    if (!activity || activity.showInHistory !== true || activity.published !== true || activity.isDemo || activity.localDraft || activity.archived) return false;
    if (typeof activity.id !== 'string' || !activity.id.trim() || typeof activity.title !== 'string' || !activity.title.trim()) return false;
    const start = historyInstant(activity.dateStart), end = historyInstant(activity.dateEnd);
    return Number.isFinite(start) && Number.isFinite(end) && end > start && end <= now;
  }).sort((first, second) => historyInstant(second.dateStart) - historyInstant(first.dateStart) || (first.id < second.id ? -1 : first.id > second.id ? 1 : 0));
}
