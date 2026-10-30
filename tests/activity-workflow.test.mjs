import assert from 'node:assert/strict';
import test from 'node:test';
import * as workflow from '../src/tracks/activity-workflow.js';
const { applyActivityTrack, findDuplicateRoutes, resolveDuplicateRoutes, deleteContentWithLinks } = workflow;

const created = '2026-10-31T03:00:00.000Z';
const track = (distanceM = 2500, ascentM = null) => ({ version: 1, name: 'Test track', stats: { distanceM, ascentM }, geojson: { type: 'Feature', geometry: { type: 'MultiLineString', coordinates: [[[114, 22, 5], [114.1, 22.1, 6]]] } } });
const activity = (id, extra = {}) => ({ id, kind: 'activity', published: false, created_at: created, payload: { title: `Activity ${id}`, routeName: 'Shared trail', track: track(), isDemo: false, ...extra } });
const route = (id, title, extra = {}) => ({ id, kind: 'route', published: true, created_at: created, payload: { title, track: track(), isDemo: false, ...extra } });
const row = (rows, id) => rows.find(item => item.id === id);
const automatic = (rows, id) => rows.find(item => item.kind === 'route' && item.payload.generatedFromActivityId === id);
const rejected = (callback, code) => assert.throws(callback, error => error.code === code && error.message.length > 0);
const options = { actorId: 'admin-1', now: '2026-10-31T04:00:00Z' };

test('an activity with a track gets its own linked route and real track metrics without input mutation', () => {
  const input = [route('manual', 'Shared trail')];
  const record = activity('a', { location: '深圳', province: '广东', city: '深圳', distance: 999, ascent: 999 });
  record.published = true;
  const snapshot = structuredClone({ input, record });
  const result = applyActivityTrack(input, record);
  const generated = automatic(result, 'a');
  assert.equal(result.length, 3);
  assert.equal(generated.payload.title, 'Shared trail');
  assert.equal(generated.payload.distance, 2.5);
  assert.equal(generated.payload.ascent, null);
  assert.deepEqual(generated.payload.coordinates, [114, 22]);
  assert.deepEqual(generated.payload.track, record.payload.track);
  assert.equal(generated.payload.location, '深圳');
  assert.equal(generated.payload.province, '广东');
  assert.equal(generated.payload.city, '深圳');
  assert.equal(generated.payload.isDemo, false);
  assert.equal(generated.payload.verified, false);
  assert.equal(generated.published, true);
  assert.equal(row(result, 'a').payload.routeId, generated.id);
  assert.equal(row(result, 'a').payload.routeLinkSource, 'activity-track');
  assert.deepEqual(row(result, 'manual'), input[0], 'a matching title must never overwrite an independent route');
  assert.deepEqual({ input, record }, snapshot);
});

test('repeat saving updates one generated route; different activities with the same title remain separate candidates', () => {
  let result = applyActivityTrack([], activity('a'));
  const generatedId = automatic(result, 'a').id;
  result = applyActivityTrack(result, activity('a', { track: track(7500, 125), location: '广州' }));
  assert.equal(result.filter(item => item.kind === 'route').length, 1);
  assert.equal(automatic(result, 'a').id, generatedId);
  assert.equal(automatic(result, 'a').payload.distance, 7.5);
  assert.equal(automatic(result, 'a').payload.ascent, 125);
  result = applyActivityTrack(result, activity('b'));
  assert.equal(result.filter(item => item.kind === 'route').length, 2);
  assert.notEqual(row(result, 'a').payload.routeId, row(result, 'b').payload.routeId);
  assert.equal(findDuplicateRoutes(result).length, 1);
});

test('local track references and summaries propagate without loading or copying IndexedDB geometry', () => {
  const record = activity('a', { track: undefined, trackLocalId: 'track-123', trackSummary: { name: 'Local track', stats: { distanceM: 3400, ascentM: 55 }, coordinates: [113, 23] } });
  const result = applyActivityTrack([], record);
  const generated = automatic(result, 'a');
  assert.equal(generated.payload.trackLocalId, 'track-123');
  assert.ok(!Object.hasOwn(generated.payload, 'track'));
  assert.deepEqual(generated.payload.trackSummary, record.payload.trackSummary);
  assert.deepEqual(generated.payload.coordinates, [113, 23]);
  assert.equal(generated.payload.distance, 3.4);
  assert.equal(generated.payload.ascent, 55);
});

test('automatic names prefer explicit names, then inline/local file names, then the activity title', () => {
  const namedTrack = { ...track(), name: '  File ridge  ' };
  const scenarios = [
    [{ routeName: '  Admin ridge  ', track: namedTrack }, 'Admin ridge'],
    [{ routeName: '  ', track: namedTrack }, 'File ridge'],
    [{ routeName: undefined, track: undefined, trackLocalId: 'idb-ridge', trackSummary: { name: '  Local ridge  ', stats: { distanceM: 1000, ascentM: null } } }, 'Local ridge'],
    [{ routeName: '', track: { ...track(), name: '' }, trackSummary: { name: 'Summary ridge' } }, 'Summary ridge'],
    [{ routeName: '', track: { ...track(), name: '  ' }, trackSummary: { name: null }, title: '  Activity fallback  ' }, 'Activity fallback'],
  ];
  for (const [payload, expected] of scenarios) {
    const result = applyActivityTrack([], activity('a', payload));
    assert.equal(automatic(result, 'a').payload.title, expected);
  }
});

test('different activities importing the same file route name surface one duplicate group without overwriting either route', () => {
  let result = applyActivityTrack([], activity('a', { title: 'First outing', routeName: '', track: { ...track(), name: '  雪山环线  ' } }));
  result = applyActivityTrack(result, activity('b', { title: 'Second outing', routeName: undefined, track: { ...track(8000), name: '雪山环线' } }));
  const groups = findDuplicateRoutes(result);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].title, '雪山环线');
  assert.deepEqual(groups[0].routes.map(item => item.payload.generatedFromActivityId).sort(), ['a', 'b']);
  assert.equal(automatic(result, 'a').payload.distance, 2.5);
  assert.equal(automatic(result, 'b').payload.distance, 8);
  assert.notEqual(row(result, 'a').payload.routeId, row(result, 'b').payload.routeId);
});

test('track removal clears only derived activity location/link and archives its unused route without deleting it', () => {
  const original = applyActivityTrack([], activity('a', { includeFootprint: true, location: '手填地点', coordinates: [114, 22], province: '广东', city: '深圳' }));
  const nextActivity = structuredClone(row(original, 'a'));
  delete nextActivity.payload.track;
  const result = applyActivityTrack(original, nextActivity);
  const removed = row(result, 'a');
  const archived = automatic(result, 'a');
  assert.equal(removed.payload.includeFootprint, false);
  assert.equal(removed.payload.footprintEligible, false);
  assert.ok(!Object.hasOwn(removed.payload, 'coordinates'));
  assert.ok(!Object.hasOwn(removed.payload, 'routeId'));
  assert.equal(removed.payload.location, '手填地点');
  assert.equal(archived.payload.archived, true);
  assert.equal(archived.payload.archivedReason, 'activity-track-removed');
  assert.equal(archived.published, false);
  assert.deepEqual(archived.payload.track, automatic(original, 'a').payload.track);
  assert.equal(result.length, original.length);
});

test('removing an activity track does not archive or alter a route still linked by another activity', () => {
  const original = applyActivityTrack([], activity('a'));
  const shared = automatic(original, 'a');
  original.push({ id: 'b', kind: 'activity', published: true, payload: { title: 'Other activity', routeId: shared.id, track: track(9000, 20) } });
  const record = structuredClone(row(original, 'a'));
  delete record.payload.track;
  const result = applyActivityTrack(original, record);
  assert.deepEqual(row(result, shared.id), shared);
  assert.deepEqual(row(result, 'b'), row(original, 'b'));
});

test('title grouping normalizes compatibility Unicode, whitespace and case, ignoring blank and archived records', () => {
  const records = [route('a', '  ＲＯＵＴＥ\u3000One  '), route('b', '\ufeffroute\tONE\n'), route('archived', 'route one', { archived: true }), route('blank', ' \t '), { id: 'article', kind: 'article', payload: { title: 'route one' } }];
  const snapshot = structuredClone(records);
  const groups = findDuplicateRoutes(records);
  assert.equal(groups.length, 1);
  assert.equal(groups[0].key, 'route one');
  assert.deepEqual(groups[0].routes.map(item => item.id), ['a', 'b']);
  assert.deepEqual(records, snapshot);
});

test('choosing a winner preserves records/geometry, redirects every activity link and appends an audit record', () => {
  const records = [route('r1', '同一条路线'), route('r2', ' 同一条路线 '), activity('a', { routeId: 'r2' }), activity('b', { routeId: 'r2', track: track(8800, 42) })];
  const before = structuredClone(records);
  const result = resolveDuplicateRoutes(records, ['r2', 'r1'], 'r1', options);
  assert.equal(result.length, records.length);
  assert.equal(row(result, 'r1').published, true);
  assert.deepEqual(row(result, 'r1').payload.track, before[0].payload.track);
  assert.deepEqual(row(result, 'r1').payload.duplicateResolutions, [{ originalIds: ['r1', 'r2'], winnerId: 'r1', actorId: 'admin-1', at: '2026-10-31T04:00:00.000Z' }]);
  const loser = row(result, 'r2');
  assert.equal(loser.payload.archived, true);
  assert.equal(loser.payload.archivedReason, 'duplicate');
  assert.equal(loser.payload.archivedBy, 'admin-1');
  assert.equal(loser.payload.duplicateWinnerId, 'r1');
  assert.equal(loser.published, false);
  assert.deepEqual(loser.payload.track, before[1].payload.track);
  for (const id of ['a', 'b']) {
    assert.equal(row(result, id).payload.routeId, 'r1');
    assert.deepEqual(row(result, id).payload.track, row(before, id).payload.track);
  }
  assert.equal(findDuplicateRoutes(result).length, 0, 'archived losers must not keep appearing in Debug');
  assert.deepEqual(records, before);
});

test('stale, partial or invalid duplicate groups are rejected atomically', () => {
  const cases = [
    [[route('a', 'x'), route('b', 'x'), route('c', 'x')], ['a', 'b'], 'a'],
    [[route('a', 'x'), route('b', 'y')], ['a', 'b'], 'a'],
    [[route('a', 'x'), route('b', 'x', { archived: true })], ['a', 'b'], 'a'],
    [[route('a', 'x'), route('b', 'x')], ['a', 'missing'], 'a'],
  ];
  for (const [records, ids, winner] of cases) {
    const before = structuredClone(records);
    rejected(() => resolveDuplicateRoutes(records, ids, winner, options), 'STALE_DUPLICATE_GROUP');
    assert.deepEqual(records, before);
  }
  const records = [route('a', 'x'), route('b', 'x')];
  for (const [ids, winner] of [[['a'], 'a'], [['a', 'a'], 'a'], [['a', 'b'], 'outside']]) rejected(() => resolveDuplicateRoutes(records, ids, winner, options), 'INVALID_DUPLICATE_SELECTION');
});

test('saving or removing a deduplicated activity never revives its archived automatic route or replaces the winner geometry', () => {
  const a = applyActivityTrack([], activity('a'));
  const b = applyActivityTrack(a, activity('b', { track: track(9000, 600) }));
  const aRoute = automatic(b, 'a'); const bRoute = automatic(b, 'b');
  const resolved = resolveDuplicateRoutes(b, [aRoute.id, bRoute.id], aRoute.id, options);
  const winnerBefore = structuredClone(row(resolved, aRoute.id));
  const updated = applyActivityTrack(resolved, activity('b', { track: track(12000, 700) }));
  assert.equal(row(updated, 'b').payload.routeId, aRoute.id);
  assert.deepEqual(row(updated, aRoute.id), winnerBefore);
  assert.equal(row(updated, bRoute.id).payload.archived, true);
  assert.equal(updated.filter(item => item.kind === 'route').length, 2);
  assert.equal(findDuplicateRoutes(updated).length, 0);
  const removed = structuredClone(row(updated, 'b')); delete removed.payload.track;
  const final = applyActivityTrack(updated, removed);
  assert.ok(!Object.hasOwn(row(final, 'b').payload, 'routeId'));
  assert.deepEqual(row(final, aRoute.id), winnerBefore);
  assert.equal(row(final, bRoute.id).payload.archived, true);
});

test('a deduplicated chain follows the current winner and broken/cyclic chains fail without creating routes', () => {
  const records = [route('old', 'x', { generatedFromActivityId: 'a', archived: true, archivedReason: 'duplicate', duplicateWinnerId: 'middle' }), route('middle', 'x', { archived: true, archivedReason: 'duplicate', duplicateWinnerId: 'winner' }), route('winner', 'x')];
  assert.equal(row(applyActivityTrack(records, activity('a')), 'a').payload.routeId, 'winner');
  for (const winner of ['missing', 'old']) {
    const broken = structuredClone(records); row(broken, 'middle').payload.duplicateWinnerId = winner;
    const before = structuredClone(broken);
    rejected(() => applyActivityTrack(broken, activity('a')), 'ARCHIVED_ROUTE_UNAVAILABLE');
    assert.deepEqual(broken, before);
  }
});

test('invalid track summaries and ID collisions cannot mutate or overwrite unrelated records', () => {
  rejected(() => applyActivityTrack([], activity('a', { track: undefined, trackLocalId: 'unresolved' })), 'INVALID_TRACK');
  rejected(() => applyActivityTrack([], activity('a', { track: track(-1, 0) })), 'INVALID_TRACK');
  rejected(() => applyActivityTrack([], activity('a', { track: 'invalid' })), 'INVALID_TRACK');
  rejected(() => applyActivityTrack([], activity('a', { title: '   ' })), 'INVALID_ACTIVITY');
  const collision = [{ id: 'a', kind: 'article', payload: { title: 'Preserve' } }];
  const before = structuredClone(collision);
  rejected(() => applyActivityTrack(collision, activity('a')), 'ID_CONFLICT');
  assert.deepEqual(collision, before);
});

test('re-upload after track removal reuses only that activity route while keeping unknown metrics and names honest', () => {
  const original = applyActivityTrack([], activity('a', { routeName: '  ', title: 'Fallback title', coordinates: [0, 91] }));
  assert.equal(automatic(original, 'a').payload.title, 'Test track');
  assert.deepEqual(row(original, 'a').payload.coordinates, [114, 22], 'an invalid supplied location falls back to an actual track point');
  const removing = structuredClone(row(original, 'a')); delete removing.payload.track;
  const archived = applyActivityTrack(original, removing);
  const restored = applyActivityTrack(archived, activity('a', { routeName: 'Fresh title', track: track(8000, null) }));
  assert.equal(automatic(restored, 'a').id, automatic(original, 'a').id);
  assert.equal(automatic(restored, 'a').payload.archived, undefined);
  assert.equal(automatic(restored, 'a').payload.title, 'Fresh title');
  assert.equal(automatic(restored, 'a').payload.ascent, null);
  assert.equal(restored.filter(item => item.kind === 'route').length, 1);
});

test('audit history appends and arbitrary archived routes are never silently restored', () => {
  const history = [{ originalIds: ['older', 'r1'], winnerId: 'r1', actorId: 'previous', at: created }];
  const records = [route('r1', 'x', { duplicateResolutions: history }), route('r2', 'x')];
  const result = resolveDuplicateRoutes(records, ['r1', 'r2'], 'r1', options);
  assert.deepEqual(row(result, 'r1').payload.duplicateResolutions[0], history[0]);
  assert.equal(row(result, 'r1').payload.duplicateResolutions.length, 2);
  rejected(() => applyActivityTrack([route('archived', 'x', { generatedFromActivityId: 'a', archived: true, archivedReason: 'manual' })], activity('a')), 'GENERATED_ROUTE_ARCHIVED');
});

test('the winning route is frozen even when its original owner activity changes track or publication', () => {
  let records = applyActivityTrack([], activity('a'));
  records = applyActivityTrack(records, activity('b', { track: track(9000, 600) }));
  const winnerId = automatic(records, 'a').id;
  records = resolveDuplicateRoutes(records, [winnerId, automatic(records, 'b').id], winnerId, options);
  const winnerBefore = structuredClone(row(records, winnerId));
  const updatedActivity = activity('a', { track: track(99000, 700), routeName: 'New activity trail name' });
  updatedActivity.published = true;
  const result = applyActivityTrack(records, updatedActivity);
  assert.deepEqual(row(result, winnerId), winnerBefore, 'administratively chosen geometry and metadata must remain unchanged');
  assert.equal(row(result, 'a').payload.track.stats.distanceM, 99000, 'activity retains its own updated track');
  assert.equal(row(result, 'a').payload.routeId, winnerId);
  assert.equal(row(result, 'b').payload.routeId, winnerId);
});

test('removing or deleting the original owner preserves a deduplicated winner even without other activity references', () => {
  let records = applyActivityTrack([], activity('a'));
  const winnerId = automatic(records, 'a').id;
  records.push(route('manual-copy', 'Shared trail'));
  records = resolveDuplicateRoutes(records, [winnerId, 'manual-copy'], winnerId, options);
  const winnerBefore = structuredClone(row(records, winnerId));
  const removing = structuredClone(row(records, 'a')); delete removing.payload.track;
  const removed = applyActivityTrack(records, removing);
  assert.deepEqual(row(removed, winnerId), winnerBefore, 'removal must not unpublish or archive the audited winner');
  const deleted = deleteContentWithLinks(records, 'a');
  assert.equal(row(deleted, 'a'), undefined);
  assert.deepEqual(row(deleted, winnerId), winnerBefore);
  assert.equal(row(deleted, 'manual-copy').payload.duplicateWinnerId, winnerId);
});

test('activity deletion archives its unused automatic route without deleting geometry, and preserves shared routes', () => {
  const original = applyActivityTrack([], activity('a'));
  const source = structuredClone(original);
  const routeId = automatic(original, 'a').id;
  const deleted = deleteContentWithLinks(original, 'a');
  assert.equal(row(deleted, 'a'), undefined);
  assert.equal(row(deleted, routeId).payload.archived, true);
  assert.equal(row(deleted, routeId).published, false);
  assert.deepEqual(row(deleted, routeId).payload.track, row(original, routeId).payload.track);
  assert.deepEqual(original, source);
  const shared = [...original, activity('b', { routeId })];
  assert.deepEqual(row(deleteContentWithLinks(shared, 'a'), routeId), row(shared, routeId));
});

test('route deletion rejects activity links, live owner activities and duplicate-winner references without partial changes', () => {
  for (const records of [
    [route('r', 'x'), activity('a', { routeId: 'r' })],
    [route('r', 'x', { generatedFromActivityId: 'a' }), activity('a')],
    [route('r', 'x'), route('old', 'x', { archived: true, archivedReason: 'duplicate', duplicateWinnerId: 'r' })],
  ]) {
    const before = structuredClone(records);
    rejected(() => deleteContentWithLinks(records, 'r'), 'CONTENT_IN_USE');
    assert.deepEqual(records, before);
  }
  const unrelated = [route('unused', 'x'), { id: 'photo', kind: 'photo', payload: { title: 'Photo' } }];
  assert.deepEqual(deleteContentWithLinks(unrelated, 'unused'), [unrelated[1]]);
  assert.deepEqual(deleteContentWithLinks(unrelated, 'photo'), [unrelated[0]]);
  rejected(() => deleteContentWithLinks(unrelated, 'missing'), 'CONTENT_NOT_FOUND');
});
