import assert from 'node:assert/strict';
import test from 'node:test';
import { formatActivityDistance, formatActivityAscent, resolveActivityView } from '../src/activities/presentation.js';

test('public distance rounds imported decimals and does not expose missing values as zero', () => {
  for (const [value, expected] of [[12.808831394, '12.81km'], [12, '12km'], [0, '0km'], [1.2, '1.2km']]) assert.equal(formatActivityDistance(value).replace(/\s/g, ''), expected);
  for (const value of [null, undefined, '', ' ', NaN, Infinity, 'unknown']) assert.equal(formatActivityDistance(value), '里程未提供');
});

test('public ascent distinguishes measured zero from unknown elevation and rounds to one decimal', () => {
  for (const [value, expected] of [[0, '0m'], [432.186, '432.2m'], [432, '432m']]) assert.equal(formatActivityAscent(value).replace(/\s/g, ''), expected);
  for (const value of [null, undefined, '', ' ', NaN, Infinity, 'unknown']) assert.equal(formatActivityAscent(value), '海拔未提供');
});

test('frozen route data overrides conflicting legacy own track without replacing activity identity or schedules', () => {
  const frozenTrack = { stats: { distanceM: 12808.831394, ascentM: null }, geojson: { type: 'FeatureCollection', features: [] } };
  const activity = {
    id: 'activity-1', title: '协会本次活动', image: '/uploaded.jpg', customField: 'retain',
    dateStart: '2026-11-01T01:00:00Z', dateEnd: '2026-11-01T09:00:00Z',
    registrationStart: '2026-10-28T01:00:00Z', registrationDeadline: '2026-10-31T12:00:00Z',
    track: { stats: { distanceM: 999000, ascentM: 999 } }, trackLocalId: 'legacy-local',
    distance: 999, ascent: 999, province: '旧省', city: '旧市', location: '旧地点', coordinates: [1, 1],
    routeSnapshot: { title: '路线名称', track: frozenTrack, trackLocalId: 'frozen-local', distance: 12.808831394, ascent: null, province: '四川', city: '成都', location: '冻结地点', coordinates: [104, 30] },
  };
  const before = structuredClone(activity);
  const view = resolveActivityView(activity);
  assert.deepEqual(view.track, frozenTrack);
  assert.equal(view.trackLocalId, 'frozen-local');
  assert.equal(view.distance, 12.808831394); assert.equal(view.ascent, null);
  assert.equal(view.province, '四川'); assert.equal(view.city, '成都'); assert.equal(view.location, '冻结地点'); assert.deepEqual(view.coordinates, [104, 30]);
  for (const field of ['id', 'title', 'image', 'customField', 'dateStart', 'dateEnd', 'registrationStart', 'registrationDeadline']) assert.equal(view[field], activity[field]);
  assert.deepEqual(activity, before);
});

test('snapshot with local geometry keeps its own unknown elevation rather than inheriting legacy ascent', () => {
  const activity = { title: '活动', track: { stats: { distanceM: 99000, ascentM: 350 } }, trackLocalId: 'old', ascent: 350, province: '旧省', city: '旧市', location: '旧地点', coordinates: [1, 1], routeSnapshot: { trackLocalId: 'frozen', trackSummary: { stats: { distanceM: 4500, ascentM: null }, coordinates: [104, 30] }, distance: 4.5, ascent: null } };
  const before = structuredClone(activity); const view = resolveActivityView(activity);
  assert.equal(view.trackLocalId, 'frozen'); assert.equal(view.distance, 4.5); assert.equal(view.ascent, null);
  for (const field of ['track', 'province', 'city', 'location', 'coordinates']) assert.equal(view[field], undefined, `snapshot must not inherit legacy ${field}`);
  assert.deepEqual(activity, before);
});

test('legacy activities without a frozen route retain their own track and display data', () => {
  const activity = { title: '旧活动', track: { stats: { distanceM: 3100, ascentM: 0 } }, distance: 3.1, ascent: 0, city: '成都' };
  const before = structuredClone(activity);
  assert.deepEqual(resolveActivityView(activity), activity); assert.deepEqual(activity, before);
});
