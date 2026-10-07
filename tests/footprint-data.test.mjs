import assert from 'node:assert/strict';
import test from 'node:test';
import { aggregateFootprints, selectFootprint } from '../src/features/footprint-data.ts';
import { findCity } from '../src/features/map-data/cities.ts';

function activity(id, overrides = {}) {
  return {
    id, title: `活动 ${id}`, category: '徒步', kind: 'upcoming', date: '2026-10-18',
    cityCode: '440300', routeName: '梧桐山徒步', location: '', difficulty: '', summary: '',
    description: '', image: '', signupUrl: '', qrImage: '', status: 'published', isDemo: false,
    ...overrides,
  };
}

test('same-city activities share one coordinate and retain every activity', () => {
  const records = [activity('a'), activity('b', { routeName: '大南山徒步', date: '2026-11-01' })];
  const [point] = aggregateFootprints(records);
  const city = findCity('440300');
  assert.equal(aggregateFootprints(records).length, 1);
  assert.equal(point.id, city.code);
  assert.equal(point.longitude, city.longitude);
  assert.equal(point.latitude, city.latitude);
  assert.deepEqual(point.activities.map(item => item.id), ['a', 'b']);
  assert.deepEqual(point.activities.map(item => item.routeName), ['梧桐山徒步', '大南山徒步']);
});

test('completed cities are green-state and upcoming cities are blue-state', () => {
  const points = aggregateFootprints([
    activity('completed', { kind: 'past', cityCode: '440200' }),
    activity('future', { cityCode: '510100' }),
  ]);
  assert.equal(points.find(point => point.id === '440200').status, 'past');
  assert.equal(points.find(point => point.id === '510100').status, 'upcoming');
});

test('mixed cities prioritize the upcoming blue-state and list both types', () => {
  const [point] = aggregateFootprints([
    activity('completed', { kind: 'past' }), activity('future'),
  ]);
  assert.equal(point.status, 'upcoming');
  assert.equal(point.upcomingCount, 1);
  assert.equal(point.completedCount, 1);
  assert.deepEqual(point.activities.map(item => item.id), ['future', 'completed']);
});

test('activity type determines map status without silently inferring completion from dates', () => {
  const [point] = aggregateFootprints([activity('old-date', { kind: 'upcoming', date: '2020-01-01' })]);
  assert.equal(point.status, 'upcoming');
  assert.equal(point.completedCount, 0);
});

test('draft, absent, and unknown cities cannot create map markers', () => {
  assert.deepEqual(aggregateFootprints([
    activity('draft', { status: 'draft' }),
    activity('unassigned', { cityCode: undefined, location: '深圳市' }),
    activity('unknown', { cityCode: '999999' }),
  ]), []);
  assert.deepEqual(aggregateFootprints([]), []);
});

test('demo points are activity-bound and mixed real/demo cities preserve per-activity labels', () => {
  const demo = activity('demo', { isDemo: true });
  const [demoPoint] = aggregateFootprints([demo]);
  assert.equal(demoPoint.demoOnly, true);
  assert.equal(demoPoint.activities[0].isDemo, true);
  const [mixedPoint] = aggregateFootprints([demo, activity('real', { kind: 'past' })]);
  assert.equal(mixedPoint.demoOnly, false);
  assert.equal(mixedPoint.activities.filter(item => item.isDemo).length, 1);
  assert.deepEqual(aggregateFootprints([]), []);
});

test('removing, unpublishing, or relocating the selected city safely selects a remaining city', () => {
  const initial = [activity('a'), activity('b', { cityCode: '510100' })];
  const points = aggregateFootprints(initial);
  assert.equal(selectFootprint(points, '440300').id, '440300');
  assert.equal(selectFootprint(aggregateFootprints(initial.slice(1)), '440300').id, '510100');
  assert.equal(selectFootprint(aggregateFootprints([activity('a', { status: 'draft' }), initial[1]]), '440300').id, '510100');
  const relocated = aggregateFootprints([activity('a', { cityCode: '510100' }), initial[1]]);
  assert.equal(selectFootprint(relocated, '440300').id, '510100');
  assert.equal(relocated[0].activities.length, 2);
  assert.equal(selectFootprint([], '440300'), undefined);
});
