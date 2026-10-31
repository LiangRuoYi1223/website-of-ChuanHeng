import assert from 'node:assert/strict';
import test from 'node:test';
import { activityDateLabel, effectiveActivityStatus, readActivitySchedule, toLocalDateTime } from '../src/activities/schedule.js';

const form = changes => new Map(Object.entries({ dateStart: '2026-11-10T08:30', dateEnd: '2026-11-10T18:00', registrationStart: '2026-11-01T09:00', registrationDeadline: '2026-11-09T20:00', registrationOpen: 'on', ...changes }));
test('activity schedule saves local minute values as ISO instants and retains elapsed registration windows', () => {
  const result = readActivitySchedule(form(), { published: true });
  assert.equal(result.dateStart, new Date(2026, 10, 10, 8, 30).toISOString());
  assert.equal(toLocalDateTime(result.dateEnd), '2026-11-10T18:00');
  assert.equal(result.registrationOpen, true);
  assert.doesNotThrow(() => readActivitySchedule(form({ registrationStart: '2020-01-01T09:00', registrationDeadline: '2020-01-02T09:00' }), { published: true }));
});
test('invalid calendar values and reversed schedule windows are refused before persistence', () => {
  for (const changes of [{ dateStart: '2026-02-30T09:00' }, { dateEnd: 'invalid' }, { dateEnd: '2026-11-10T08:30' }, { registrationStart: '2026-11-09T20:00' }, { registrationDeadline: '2026-11-10T09:00' }, { registrationStart: '' }]) assert.throws(() => readActivitySchedule(form(changes), { published: true }));
});
test('drafts may omit dates while new public activities require a known activity range', () => {
  const empty = new Map();
  assert.equal(readActivitySchedule(empty).dateEnd, null);
  assert.throws(() => readActivitySchedule(empty, { published: true }));
  assert.doesNotThrow(() => readActivitySchedule(empty, { published: true, legacy: true }));
  assert.equal(toLocalDateTime('2026-11-10'), '', 'an unknown time must never become midnight');
  assert.equal(toLocalDateTime('invalid'), '');
});
test('effective status follows registration and activity boundaries without changing source', () => {
  const source = { status: '即将开始', registrationOpen: true, registrationStart: '2026-11-01T01:00:00Z', registrationDeadline: '2026-11-09T12:00:00Z', dateStart: '2026-11-10T00:30:00Z', dateEnd: '2026-11-10T10:00:00Z' };
  const snapshot = structuredClone(source);
  for (const [at, expected] of [['2026-10-31T23:00:00Z', '即将开始'], ['2026-11-01T01:00:00Z', '报名中'], ['2026-11-09T12:00:00Z', '即将开始'], ['2026-11-10T00:30:00Z', '进行中'], ['2026-11-10T10:00:00Z', '已结束']]) assert.equal(effectiveActivityStatus(source, Date.parse(at)), expected);
  assert.deepEqual(source, snapshot);
  assert.equal(effectiveActivityStatus({ status: '已结束', dateStart: '2027-01-01' }), '已结束');
  assert.equal(effectiveActivityStatus({ status: '报名中' }), '报名中');
});
test('public date labels use actual times and keep the old date description when times are unknown', () => {
  assert.match(activityDateLabel({ dateStart: '2026-11-10T00:30:00Z', dateEnd: '2026-11-10T10:00:00Z' }), /2026/);
  assert.equal(activityDateLabel({ date: '协会另行通知' }), '协会另行通知');
  assert.equal(activityDateLabel({}), '日期待公布');
});
