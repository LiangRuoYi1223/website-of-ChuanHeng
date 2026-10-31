import assert from 'node:assert/strict';
import test from 'node:test';
import { readActivityRegistrations, setApplicationPayment } from '../src/applications/admin-registration.js';
const state = { viewerId: 'admin-a', capacity: 1, activeCount: 0, confirmedCount: 0, waitlistCount: 0, applications: [], events: [] };
const admin = { id: 'admin-a', is_anonymous: false, app_metadata: { role: 'admin' } };
const change = { applicationId: 'application', paymentStatus: 'paid', expectedPaymentStatus: 'unpaid', expectedUserId: 'admin-a' };
test('admin roster reads protected RPC and retains the administrator identity', async () => {
  const client = { async rpc(name, args) { assert.equal(name, 'get_activity_registrations'); assert.deepEqual(args, { p_activity_id: 'activity' }); return { data: state, error: null }; } };
  assert.deepEqual(await readActivityRegistrations(client, 'activity'), state);
});
test('payment verifies the trusted administrator and sends both previous value and expected identity', async () => {
  const client = { auth: { getUser: async () => ({ data: { user: admin } }) }, async rpc(name, args) { assert.equal(name, 'set_activity_registration_payment'); assert.deepEqual(args, { p_application_id: 'application', p_payment_status: 'paid', p_expected_payment_status: 'unpaid', p_expected_user_id: 'admin-a' }); return { data: state, error: null }; } };
  assert.deepEqual(await setApplicationPayment(client, change), state);
});
test('changed, anonymous, untrusted or unavailable identities never issue a payment write', async () => {
  for (const user of [null, { ...admin, id: 'admin-b' }, { ...admin, is_anonymous: true }, { id: 'admin-a', user_metadata: { role: 'admin' } }, { ...admin, app_metadata: { role: 'member' } }]) {
    let writes = 0;
    const client = { auth: { getUser: async () => ({ data: { user } }) }, rpc: async () => { writes++; return { data: state }; } };
    await assert.rejects(() => setApplicationPayment(client, change));
    assert.equal(writes, 0);
  }
  const client = { auth: { getUser: async () => ({ error: { code: 'offline' } }) }, rpc: async () => assert.fail('must not write') };
  await assert.rejects(() => setApplicationPayment(client, change));
  await assert.rejects(() => setApplicationPayment({ ...client, auth: { getUser: async () => ({ data: { user: admin } }) } }, { ...change, expectedUserId: undefined }));
});
test('session changing after identity verification is rejected by the RPC rather than claimed successful', async () => {
  let sentIdentity;
  const client = { auth: { getUser: async () => ({ data: { user: admin } }) }, rpc: async (_name, args) => { sentIdentity = args.p_expected_user_id; return { error: { code: '42501' } }; } };
  await assert.rejects(() => setApplicationPayment(client, change));
  assert.equal(sentIdentity, 'admin-a');
});
test('service errors, missing viewer identity and malformed successes never invent state', async () => {
  for (const result of [{ error: { code: '40001' } }, { data: null }, { data: {} }, { data: { ...state, viewerId: undefined } }]) await assert.rejects(() => readActivityRegistrations({ rpc: async () => result }, 'activity'));
  await assert.rejects(() => readActivityRegistrations(null, 'activity'));
  await assert.rejects(() => setApplicationPayment({ rpc: async () => assert.fail('must not write') }, { ...change, paymentStatus: 'automatic' }));
});
