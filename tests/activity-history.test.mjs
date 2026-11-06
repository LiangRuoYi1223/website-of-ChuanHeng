import assert from 'node:assert/strict';
import test from 'node:test';
import { selectHistoryActivities } from '../src/activities/history.js';

const now = Date.parse('2026-11-06T12:00:00Z');
const activity = (id, overrides = {}) => ({
  id, title: `合成活动${id}`, published: true, showInHistory: true,
  dateStart: '2026-11-01T00:00:00Z', dateEnd: '2026-11-01T10:00:00Z', ...overrides,
});

test('only explicitly selected and published real activities become history', () => {
  const approved = activity('approved');
  const excluded = [
    { showInHistory: false }, { showInHistory: undefined }, { showInHistory: 'true' }, { showInHistory: 1 },
    { published: false }, { published: undefined }, { published: 'true' }, { published: 1 },
    { isDemo: true }, { localDraft: true }, { archived: true },
  ].map((change, index) => activity(`excluded-${index}`, change));
  assert.deepEqual(selectHistoryActivities([approved, ...excluded], now), [approved]);
});

test('history requires a complete real schedule and waits for the actual end instant', () => {
  const finished = activity('finished', { dateStart: '2026-11-06T10:00:00Z', dateEnd: '2026-11-06T12:00:00Z' });
  const excluded = [
    { dateStart: undefined }, { dateEnd: undefined }, { dateStart: '' }, { dateEnd: '' },
    { dateStart: '2026-11-01' }, { dateEnd: '2026-11-01' },
    { dateStart: '2026-11-01T00:00:00' }, { dateEnd: '2026-11-01T10:00:00' },
    { dateStart: '2026-02-30T00:00:00Z' }, { dateEnd: '2026-02-30T10:00:00Z' },
    { dateStart: '2026-11-01T25:00:00Z' }, { dateEnd: '2026-11-01T24:00:00Z' },
    { dateStart: '2026-11-01T00:60:00Z' }, { dateEnd: '2026-11-01T10:00:60Z' },
    { dateEnd: '2026-11-01T00:00:00Z' }, { dateEnd: '2026-10-31T23:59:59Z' },
    { dateStart: '2026-11-06T10:00:00Z', dateEnd: '2026-11-06T12:00:01Z', status: '已结束' },
    { dateStart: '', dateEnd: '', date: '协会往年活动', status: '已结束' },
  ].map((change, index) => activity(`excluded-${index}`, change));
  assert.deepEqual(selectHistoryActivities([finished, ...excluded], now), [finished]);
});

test('history accepts explicit timezone offsets and sorts by the actual start instant', () => {
  const earlier = activity('earlier', { dateStart: '2026-11-02T10:00:00+08:00', dateEnd: '2026-11-02T11:00:00+08:00' });
  const later = activity('later', { dateStart: '2026-11-02T03:00:00Z', dateEnd: '2026-11-02T04:00:00Z' });
  assert.deepEqual(selectHistoryActivities([earlier, later], now), [later, earlier]);
});

test('equal start instants use a stable id order without reordering or mutating input', () => {
  const first = Object.freeze(activity('a'));
  const second = Object.freeze(activity('b'));
  const older = Object.freeze(activity('older', { dateStart: '2026-10-01T00:00:00Z', dateEnd: '2026-10-01T10:00:00Z' }));
  const input = Object.freeze([second, older, first]);
  assert.deepEqual(selectHistoryActivities(input, now), [first, second, older]);
  assert.deepEqual(input, [second, older, first]);
});

test('invalid records and missing identifiers or titles cannot create history links', () => {
  const excluded = [null, undefined, false, 0, '', [], {}, ...[
    { id: '' }, { id: ' ' }, { id: null }, { id: 123 },
    { title: '' }, { title: '  ' }, { title: null }, { title: {} },
  ].map((change, index) => activity(`excluded-${index}`, change))];
  assert.deepEqual(selectHistoryActivities(excluded, now), []);
  for (const input of [undefined, null, {}, 'not an array', 0]) assert.deepEqual(selectHistoryActivities(input, now), []);
});

test('history uses the current time by default and rejects an invalid reference time', () => {
  const finished = activity('finished', { dateStart: '2001-01-01T00:00:00Z', dateEnd: '2001-01-01T10:00:00Z' });
  const future = activity('future', { dateStart: '2099-01-01T00:00:00Z', dateEnd: '2099-01-01T10:00:00Z' });
  assert.deepEqual(selectHistoryActivities([future, finished]), [finished]);
  for (const invalid of [NaN, Infinity, -Infinity, null, '2026-11-06']) assert.deepEqual(selectHistoryActivities([finished], invalid), []);
});
