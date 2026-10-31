import assert from 'node:assert/strict';
import test from 'node:test';
import { registrationAvailability, readOwnApplication, submitActivityApplication, safeInternalReturn } from '../src/applications/registration.js';

const activity = overrides => ({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', published: true, isDemo: false, title: '合成测试活动', registrationOpen: true, status: '报名中', registrationStart: new Date(Date.now() - 86400000).toISOString(), registrationDeadline: new Date(Date.now() + 86400000).toISOString(), dateStart: new Date(Date.now() + 2 * 86400000).toISOString(), dateEnd: new Date(Date.now() + 3 * 86400000).toISOString(), ...overrides });
const user = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', email: 'test@example.invalid' };
const application = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', created_at: new Date().toISOString() };
function client({ currentUser = user, existing = null, insertError = null, insertData = application, readError = null } = {}) {
  const calls = [];
  return {
    calls,
    auth: { getUser: async () => ({ data: { user: currentUser }, error: null }) },
    from(table) {
      assert.equal(table, 'applications');
      return {
        select(columns) { const filters = []; const chain = { eq(key, value) { filters.push([key, value]); return chain; }, async maybeSingle() { calls.push({ operation: 'read', columns, filters }); return { data: existing, error: readError }; } }; return chain; },
        insert(payload) { calls.push({ operation: 'insert', payload }); return { select: () => ({ single: async () => ({ data: insertData, error: insertError }) }) }; },
      };
    },
  };
}

test('registration availability refuses samples, drafts, archived and closed activities', () => {
  assert.equal(registrationAvailability(activity()).open, true);
  for (const changes of [{ isDemo: true }, { published: false }, { localDraft: true }, { archived: true }, { status: '已结束' }, { registrationOpen: false }, { registrationDeadline: 'not-a-date' }, { registrationDeadline: new Date(Date.now() - 1000).toISOString() }]) assert.equal(registrationAvailability(activity(changes)).open, false);
});

test('registration enforces opening, cutoff and activity boundaries including malformed legacy data', () => {
  const at = Date.parse('2026-11-02T00:00:00Z');
  const scheduled = activity({ registrationStart: '2026-11-02T00:00:00Z', registrationDeadline: '2026-11-03T00:00:00Z', dateStart: '2026-11-04T00:00:00Z', dateEnd: '2026-11-05T00:00:00Z' });
  assert.equal(registrationAvailability(scheduled, at - 1).open, false);
  assert.equal(registrationAvailability(scheduled, at).open, true);
  assert.equal(registrationAvailability(scheduled, Date.parse(scheduled.registrationDeadline)).open, false);
  for (const changes of [{ registrationStart: undefined }, { registrationStart: 'bad' }, { dateStart: undefined }, { dateEnd: 'bad' }, { registrationStart: scheduled.registrationDeadline }, { registrationDeadline: '2026-11-04T01:00:00Z' }, { dateEnd: scheduled.dateStart }]) assert.equal(registrationAvailability({ ...scheduled, ...changes }, at).open, false);
});

test('application insert obtains identity from Auth and writes only the schema-supported owner payload', async () => {
  const backend = client();
  const result = await submitActivityApplication(backend, activity());
  assert.equal(result.id, application.id);
  const insertion = backend.calls.find(call => call.operation === 'insert');
  assert.deepEqual(insertion.payload, { activity_id: activity().id, user_id: user.id, payload: {} });
});

test('anonymous and no-longer-open applications stop before a database write', async () => {
  const anonymous = client({ currentUser: null });
  await assert.rejects(() => submitActivityApplication(anonymous, activity()), error => error.code === 'LOGIN_REQUIRED');
  assert.equal(anonymous.calls.length, 0);
  const backend = client();
  await assert.rejects(() => submitActivityApplication(backend, activity({ registrationOpen: false })));
  assert.equal(backend.calls.length, 0);
});

test('owner application reads include both activity and verified user filters', async () => {
  const backend = client({ existing: application });
  assert.equal((await readOwnApplication(backend, activity().id, user.id)).id, application.id);
  assert.deepEqual(backend.calls[0].filters, [['activity_id', activity().id], ['user_id', user.id]]);
});

test('a changed verified identity cannot submit under a different account than the user confirmed', async () => {
  const backend = client();
  await assert.rejects(() => submitActivityApplication(backend, activity(), { expectedUserId: 'different-account' }), error => error.code === 'LOGIN_CHANGED');
  assert.equal(backend.calls.length, 0);
});

test('a unique violation is only reported as submitted after the existing owner row is read', async () => {
  const backend = client({ existing: application, insertError: { code: '23505' }, insertData: null });
  const result = await submitActivityApplication(backend, activity());
  assert.equal(result.id, application.id);
  assert.equal(result.alreadySubmitted, true);
  const missing = client({ insertError: { code: '23505' }, insertData: null });
  await assert.rejects(() => submitActivityApplication(missing, activity()));
});

test('permission, network or empty successful responses cannot simulate a submitted application', async () => {
  for (const options of [{ insertError: { code: '42501' }, insertData: null }, { insertData: null }, { insertData: {} }]) await assert.rejects(() => submitActivityApplication(client(options), activity()));
  await assert.rejects(() => readOwnApplication(client({ readError: { code: '42501' } }), activity().id, user.id));
});

test('post-login return paths accept internal activity pages and reject open redirects', () => {
  assert.equal(safeInternalReturn('/activities/test#application'), '/activities/test#application');
  for (const value of ['https://outside.invalid', '//outside.invalid', '/\\outside.invalid', 'javascript:alert(1)', '/login', '/%5cexample.com']) assert.equal(safeInternalReturn(value), null);
});
