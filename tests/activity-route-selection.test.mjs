import assert from 'node:assert/strict';
import test from 'node:test';
import { applyActivityRoute } from '../src/tracks/activity-route-selection.js';
import { deleteContentWithLinks } from '../src/tracks/activity-workflow.js';
const now = '2026-10-31T10:00:00.000Z';
const track = (distanceM = 2500, ascentM = null) => ({ stats: { distanceM, ascentM }, geojson: { type: 'Feature', geometry: { type: 'MultiLineString', coordinates: [[[114, 22], [114.1, 22.1]]] } } });
const route = (id = 'r', extra = {}) => ({ id, kind: 'route', published: true, payload: { title: '真实路线', track: track(), isDemo: false, ...extra } });
const activity = (id = 'a', extra = {}) => ({ id, kind: 'activity', published: false, payload: { title: '活动', routeId: 'r', dateStart: '2026-10-01T00:00:00Z', dateEnd: '2026-10-02T00:00:00Z', ...extra } });
const row = (rows, id = 'a') => rows.find(item => item.id === id);
const save = (rows, record) => applyActivityRoute(rows, record, { now });
const rejects = (fn, code) => assert.throws(fn, error => error.code === code);

test('two activities reuse one route without route writes or input mutation; only trusted fields enter snapshot', () => {
  const rows = [route('r', { province: '广东', city: '深圳', location: '深圳', distance: 999, ascent: 999, generatedFromActivityId: 'old', secret: 'excluded' })];
  const record = activity('a', { coordinates: [0, 0], distance: 999 });
  const before = structuredClone({ rows, record });
  const first = save(rows, record); const next = save(first, activity('b'));
  assert.deepEqual({ rows, record }, before);
  assert.equal(next.length, 3); assert.deepEqual(row(next, 'r'), rows[0]);
  const payload = row(next).payload;
  assert.equal(payload.routeSnapshot.sourceRouteId, 'r'); assert.equal(payload.routeSnapshot.selectedAt, now);
  assert.equal(payload.routeSnapshot.secret, undefined); assert.equal(payload.routeSnapshot.generatedFromActivityId, undefined);
  assert.equal(payload.distance, 2.5); assert.equal(payload.ascent, null); assert.deepEqual(payload.coordinates, [114, 22]);
  assert.equal(payload.province, '广东'); assert.equal(payload.organizer, 'chuanheng'); assert.equal(payload.includeFootprint, true);
  next[0].payload.track.stats.distanceM = 99999;
  assert.equal(row(next).payload.routeSnapshot.track.stats.distanceM, 2500); assert.deepEqual(rows, before.rows);
});

test('same reference freezes trusted snapshot when route changed or submitted snapshot is tampered', () => {
  const rows = save([route()], activity()); const original = structuredClone(row(rows).payload.routeSnapshot);
  rows[0].payload.track = track(9999, 600);
  const edit = structuredClone(row(rows)); edit.payload.title = '编辑'; edit.payload.routeSnapshot.track = track(1, 1); edit.routeExpectedPayload = { stale: true };
  const result = save(rows, edit);
  assert.deepEqual(row(result).payload.routeSnapshot, original); assert.equal(row(result).payload.distance, 2.5);
});

test('changing reference refreshes snapshot and explicit clear removes all derived route metadata', () => {
  let rows = save([route(), route('new', { track: track(6000, 77) })], activity());
  const changed = structuredClone(row(rows)); changed.payload.routeId = 'new';
  rows = save(rows, changed); assert.equal(row(rows).payload.distance, 6); assert.equal(row(rows).payload.routeSnapshot.sourceRouteId, 'new');
  const clear = structuredClone(row(rows)); clear.payload.routeId = '';
  const payload = row(save(rows, clear)).payload;
  for (const key of ['routeSnapshot', 'routeId', 'coordinates', 'distance', 'ascent', 'province', 'city', 'location']) assert.equal(Object.hasOwn(payload, key), false, key);
  assert.equal(payload.includeFootprint, false); assert.equal(payload.footprintEligible, false);
});

test('new selections reject missing, archived, demo, unusable track and stale expected route payload atomically', () => {
  for (const [rows, code] of [[[], 'ROUTE_NOT_FOUND'], [[route('r', { archived: true })], 'ROUTE_ARCHIVED'], [[route('r', { isDemo: true })], 'DEMO_ROUTE'], [[route('r', { track: { stats: { distanceM: 2000 } } })], 'INVALID_TRACK']]) rejects(() => save(rows, activity()), code);
  const rows = [route()]; const before = structuredClone(rows); const record = activity(); record.routeExpectedPayload = { title: 'stale' };
  rejects(() => save(rows, record), 'STALE_ROUTE'); assert.deepEqual(rows, before);
  record.routeExpectedPayload = structuredClone(rows[0].payload); assert.equal(save(rows, record).length, 2);
});

test('local track summary is usable without geometry, with unknown elevation and geography left unknown', () => {
  const rows = [route('r', { track: undefined, trackLocalId: 'local-1', trackSummary: { stats: { distanceM: 4500, ascentM: null }, coordinates: [114, 22] } })];
  const payload = row(save(rows, activity())).payload;
  assert.equal(payload.routeSnapshot.trackLocalId, 'local-1'); assert.equal(Object.hasOwn(payload.routeSnapshot, 'track'), false);
  assert.equal(payload.distance, 4.5); assert.equal(payload.ascent, null); assert.equal(payload.province, undefined); assert.equal(payload.location, undefined);
  rejects(() => save([route('r', { track: undefined, trackLocalId: 'unloaded' })], activity()), 'INVALID_TRACK');
});

test('legacy own track and summary survive ordinary edits exactly; new or modified direct tracks are rejected', () => {
  const legacy = activity('a', { track: track(), trackLocalId: 'legacy-id', trackSummary: { untouched: true } });
  const rows = [route(), legacy]; const edit = structuredClone(legacy); edit.payload.title = '旧活动编辑';
  const result = save(rows, edit);
  for (const key of ['track', 'trackLocalId', 'trackSummary']) assert.deepEqual(row(result).payload[key], legacy.payload[key]);
  assert.equal(row(result).payload.routeSnapshot, undefined); assert.deepEqual(row(result, 'r'), rows[0]);
  const partial = structuredClone(edit); delete partial.payload.track; delete partial.payload.trackLocalId; delete partial.payload.trackSummary;
  assert.deepEqual(row(save(rows, partial)).payload.track, legacy.payload.track);
  edit.payload.track = track(99); rejects(() => save(rows, edit), 'ACTIVITY_TRACK_READ_ONLY');
  rejects(() => save([route()], activity('new', { track: track() })), 'ACTIVITY_TRACK_READ_ONLY');
});

test('real tracks retain footprint permission until their time gate opens; missing tracks never do', () => {
  assert.equal(row(save([route()], activity('a', { dateEnd: '2027-01-01T00:00:00Z', includeFootprint: true }))).payload.includeFootprint, true);
  assert.equal(row(save([], activity('a', { routeId: '', status: '已结束', includeFootprint: true }))).payload.includeFootprint, false);
});

test('deleting snapshot activity preserves source route even if it was formerly automatic; route deletion remains protected', () => {
  const rows = save([route('r', { generatedFromActivityId: 'a' })], activity());
  rejects(() => deleteContentWithLinks(rows, 'r'), 'CONTENT_IN_USE');
  const before = structuredClone(rows); const deleted = deleteContentWithLinks(rows, 'a');
  assert.deepEqual(row(deleted, 'r'), row(rows, 'r')); assert.deepEqual(rows, before);
});


test('legacy geometry stays untouched when selecting and later editing a route snapshot', () => {
  const legacy = activity('a', { routeId: undefined, track: track(8000, 40) });
  const selecting = structuredClone(legacy); selecting.payload.routeId = 'r';
  const rows = save([route(), legacy], selecting);
  assert.deepEqual(row(rows).payload.track, legacy.payload.track);
  assert.equal(row(rows).payload.distance, 2.5);
  const editing = structuredClone(row(rows)); delete editing.payload.track;
  assert.deepEqual(row(save(rows, editing)).payload.track, legacy.payload.track);
});

test('draft with omitted selection preserves historical route; route expected payload comparison ignores key order', () => {
  const routeRecord = route();
  const selecting = activity(); selecting.routeExpectedPayload = Object.fromEntries(Object.entries(routeRecord.payload).reverse());
  let rows = save([routeRecord], selecting);
  assert.equal(Object.hasOwn(row(rows), 'routeExpectedPayload'), false);
  const edit = structuredClone(row(rows)); delete edit.payload.routeId;
  rows = save(rows, edit);
  assert.equal(row(rows).payload.routeId, 'r');
  assert.equal(row(rows).payload.routeSnapshot.selectedAt, now);
  const draft = activity('draft', { routeId: undefined });
  assert.equal(row(save([], draft), 'draft').payload.routeSnapshot, undefined);
});

test('invalid row and content identities fail without modifying supplied records', () => {
  rejects(() => save(null, activity()), 'INVALID_ROWS');
  rejects(() => save([route(), route()], activity()), 'INVALID_ROWS');
  rejects(() => save([], { ...activity(), kind: 'route' }), 'INVALID_ACTIVITY');
  rejects(() => save([], activity('a', { title: '' })), 'INVALID_ACTIVITY');
  rejects(() => save([{ id: 'a', kind: 'article', payload: {} }], activity()), 'ID_CONFLICT');
});

test('legacy activity with no linked route preserves geography when the select submits an empty value', () => {
  const legacy = activity('a', { routeId: undefined, track: track(), coordinates: [114, 22], province: '广东', location: '深圳' });
  const edit = structuredClone(legacy); edit.payload.routeId = '';
  const result = row(save([legacy], edit)).payload;
  assert.deepEqual(result.track, legacy.payload.track);
  assert.deepEqual(result.coordinates, [114, 22]);
  assert.equal(result.province, '广东'); assert.equal(result.includeFootprint, true);
});


test('historical snapshot saves still reject a deleted or archived current route without rewriting history', () => {
  const rows = save([route()], activity()); const historical = structuredClone(row(rows));
  rejects(() => save([historical], historical), 'ROUTE_NOT_FOUND');
  const archived = structuredClone(rows); row(archived, 'r').payload.archived = true;
  const before = structuredClone(archived);
  rejects(() => save(archived, historical), 'ROUTE_ARCHIVED');
  assert.deepEqual(archived, before);
});

test('legacy own track metrics and geography are restored after select, edit and clear, without rewriting raw tracks', () => {
  const ownTrack = track(1000, null);
  ownTrack.geojson.geometry.coordinates = [[[104, 30], [104.1, 30.1]]];
  ownTrack.location = { province: '四川省', city: '成都市', provinceCode: '510000', cityCode: '510100', coordinates: [104, 30], locations: [{ province: '四川省', city: '成都市' }], locationStatus: 'matched' };
  const legacy = activity('a', { routeId: undefined, track: ownTrack, trackSummary: { stats: ownTrack.stats, location: ownTrack.location }, distance: 1, ascent: null, coordinates: [104, 30], province: '四川省', city: '成都市', location: '四川省 成都市' });
  const other = route('r', { track: track(9000, 900), province: '广东省', city: '深圳市', location: '广东省 深圳市', provinceCode: '440000', cityCode: '440300', locationStatus: 'matched' });
  const original = structuredClone({ legacy, other });
  const selecting = structuredClone(legacy); selecting.payload.routeId = 'r';
  let rows = save([other, legacy], selecting);
  assert.equal(row(rows).payload.distance, 9); assert.equal(row(rows).payload.city, '深圳市');
  const editing = structuredClone(row(rows)); editing.payload.title = '改介绍'; rows = save(rows, editing);
  const clearing = structuredClone(row(rows)); clearing.payload.routeId = ''; rows = save(rows, clearing);
  const payload = row(rows).payload;
  assert.equal(payload.distance, 1); assert.equal(payload.ascent, null);
  assert.deepEqual(payload.coordinates, [104, 30]); assert.equal(payload.province, '四川省'); assert.equal(payload.city, '成都市');
  assert.equal(payload.provinceCode, '510000'); assert.equal(payload.cityCode, '510100'); assert.equal(payload.location, '四川省 成都市');
  assert.equal(payload.routeSnapshot, undefined); assert.equal(payload.routeId, undefined);
  assert.deepEqual(payload.track, ownTrack); assert.deepEqual(payload.trackSummary, legacy.payload.trackSummary);
  assert.deepEqual({ legacy, other }, original); assert.equal(payload.includeFootprint, true);
});

test('clearing a selected route never retains snapshot geography when legacy track has unknown place and elevation', () => {
  const ownTrack = track(1000, null); ownTrack.geojson.geometry.coordinates = [[[104, 30], [104.1, 30.1]]];
  const legacy = activity('a', { routeId: undefined, track: ownTrack });
  const selecting = structuredClone(legacy); selecting.payload.routeId = 'r';
  let rows = save([route('r', { province: '广东省', city: '深圳市', location: '广东省 深圳市', provinceCode: '440000', cityCode: '440300', locations: [{ city: '深圳市' }], locationStatus: 'matched' }), legacy], selecting);
  const clearing = structuredClone(row(rows)); clearing.payload.routeId = ''; rows = save(rows, clearing);
  const payload = row(rows).payload;
  assert.equal(payload.distance, 1); assert.equal(payload.ascent, null); assert.deepEqual(payload.coordinates, [104, 30]);
  for (const key of ['province', 'city', 'location', 'provinceCode', 'cityCode', 'locations', 'locationStatus']) assert.equal(Object.hasOwn(payload, key), false, key);
  assert.deepEqual(payload.track, ownTrack);
});

test('clearing a selected route restores local-only legacy summary without reading its IndexedDB geometry', () => {
  const summary = { stats: { distanceM: 1000, ascentM: 10 }, coordinates: [104, 30], location: { province: '四川省', city: '成都市', locationStatus: 'matched' } };
  const legacy = activity('a', { routeId: undefined, trackLocalId: 'old-local', trackSummary: summary });
  const selecting = structuredClone(legacy); selecting.payload.routeId = 'r';
  let rows = save([route('r', { track: track(9000, 900), province: '广东省', city: '深圳市' }), legacy], selecting);
  const clearing = structuredClone(row(rows)); clearing.payload.routeId = ''; rows = save(rows, clearing);
  const payload = row(rows).payload;
  assert.equal(payload.distance, 1); assert.equal(payload.ascent, 10); assert.deepEqual(payload.coordinates, [104, 30]);
  assert.equal(payload.province, '四川省'); assert.equal(payload.city, '成都市'); assert.equal(payload.trackLocalId, 'old-local'); assert.deepEqual(payload.trackSummary, summary);
});
