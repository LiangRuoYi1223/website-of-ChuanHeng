import { scheduleInstant } from '../activities/schedule.js';
const valid = value => Number.isFinite(value) && value >= 0;

export function validateManualTrackMetrics(track) {
  const manual=track?.manualMetrics;
  if (manual == null) return;
  if (typeof manual !== 'object' || Array.isArray(manual) || manual.source !== 'administrator' || !Number.isFinite(scheduleInstant(manual.confirmedAt))) throw new Error('人工补充指标缺少有效的管理员来源或确认时间。');
  for (const field of ['distanceM','ascentM']) {
    if (manual[field] == null) continue;
    if (!valid(manual[field])) throw new Error('补充指标须为有效的非负数字。');
    if (valid(track?.stats?.[field])) throw new Error('不能覆盖轨迹自动计算的指标。');
  }
}

/** Raw parser statistics stay intact; administrator supplements fill gaps only. */
export function resolvedTrackMetrics(track) {
  const raw = track?.stats || track || {};
  let manual = {};
  try { validateManualTrackMetrics(track); manual = track?.manualMetrics || {}; } catch { /* Invalid supplements never become public measurements. */ }
  const result = { sources: {} };
  for (const [field, source] of [['distanceM', 'distance'], ['ascentM', 'ascent']]) {
    result[field] = valid(raw[field]) ? raw[field] : valid(manual[field]) ? manual[field] : null;
    result.sources[source] = valid(raw[field]) ? 'track' : valid(manual[field]) ? 'administrator' : 'unavailable';
  }
  return result;
}

export function withManualTrackMetrics(track, values, now = new Date()) {
  const manualMetrics = { source: 'administrator', confirmedAt: new Date(now).toISOString() };
  for (const field of ['distanceM', 'ascentM']) {
    if (values[field] == null) continue;
    if (valid(track?.stats?.[field])) throw new Error('不能覆盖轨迹自动计算的指标。');
    if (!valid(values[field])) throw new Error('补充指标须为有效的非负数字。');
    manualMetrics[field] = values[field];
  }
  return { ...track, manualMetrics };
}
