import assert from 'node:assert/strict';
import test from 'node:test';
import { readActivityRegistrations, setApplicationPayment } from '../src/applications/admin-registration.js';
const state = { viewerId: 'admin-a', capacity: 1, activeCount: 0, confirmedCount: 0, waitlistCount: 0, applications: [] };
const admin = { id: 'admin-a', is_anonymous: false, app_metadata: { role: 'admin' } };
const change = { applicationId: 'application', paymentStatus: 'paid', expectedPaymentStatus: 'unpaid', expectedUserId: 'admin-a' };
test('admin roster reads protected RPC and retains the administrator identity', async () => {
  const client = { async rpc(name, args) { assert.equal(name, 'get_activity_registrations'); assert.deepEqual(args, { p_activity_id: 'activity' }); return { data: state, error: null }; } };
  assert.deepEqual(await readActivityRegistrations(client, 'activity'), state);
});
test('payment verifies the trusted administrator and sends both previous value and expected identity', async () => {
  const client = { auth: { getUser: async () => ({ data: { user: admin } }) }, async rpc(name, args) { assert.equal(name, 'set_activity_registration_payment'); assert.deepEqual(args, { p_application_id: 'application', p_payment_status: 'paid', p_expected_payment_status: 'unpaid', p_expected_user_id: 'admin-a', p_expected_proof_id: null }); return { data: state, error: null }; } };
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


test('pending reports remain readable and review binds the exact displayed proof identity', async () => {
  const proof = { id: 'proof-1', objectPath: 'user/application/proof.webp', submittedAt: '2026-11-01T00:00:00Z' };
  const pending = { ...state, applications: [{ id: 'application', status: 'active', paymentStatus: 'pending', currentPaymentProofId: proof.id, paymentProofs: [proof] }] };
  const client = { auth: { getUser: async () => ({ data: { user: admin } }) }, async rpc(name,args) {
    if(name === 'set_activity_registration_payment') assert.deepEqual(args,{p_application_id:'application',p_payment_status:'paid',p_expected_payment_status:'pending',p_expected_user_id:'admin-a',p_expected_proof_id:'proof-1'});
    return {data:pending};
  } };
  assert.deepEqual(await readActivityRegistrations(client,'activity'),pending);
  assert.deepEqual(await setApplicationPayment(client,{...change,expectedPaymentStatus:'pending',expectedProofId:proof.id}),pending);
});
test('malformed proof metadata is rejected instead of exposing a guessed or public image link', async () => {
  for(const paymentProofs of [null,{},[{id:'proof'}],[{id:'proof',objectPath:'path',submittedAt:'invalid'}]]) {
    const bad={...state,applications:[{id:'application',status:'active',paymentStatus:'unpaid',paymentProofs}]};
    await assert.rejects(()=>readActivityRegistrations({rpc:async()=>({data:bad})},'activity'));
  }
});


test('roster no longer requires or returns website-readable events, and accepts purged proof tombstones', async () => {
  const { events, ...data } = state;
  data.applications = [{ id:'a', status:'active', paymentStatus:'paid', insuranceStatus:'uninsured', paymentProofs:[], currentPaymentProofId:'purged-proof', proofsPurgedAt:'2026-11-01T00:00:00Z' }];
  const result = await readActivityRegistrations({rpc:async()=>({data})},'activity');
  assert.equal(Object.hasOwn(result,'events'),false);
});
test('insurance CAS sends original status and exact microsecond details version', async () => {
 const service = await import('../src/applications/admin-registration.js');
 assert.equal(typeof service.setApplicationInsurance,'function');
 const client={auth:{getUser:async()=>({data:{user:admin}})},rpc:async(name,args)=>{
  assert.equal(name,'set_activity_registration_insurance');assert.deepEqual(args,{p_application_id:'a',p_insurance_status:'insured',p_expected_insurance_status:'uninsured',p_expected_user_id:'admin-a',p_expected_details_updated_at:'2026-11-01T00:00:00.123456Z'});return {data:state};
 }};
 await service.setApplicationInsurance(client,{applicationId:'a',insuranceStatus:'insured',expectedInsuranceStatus:'uninsured',expectedUserId:'admin-a',expectedDetailsUpdatedAt:'2026-11-01T00:00:00.123456Z'});
});
test('cleanup has three separate RPC stages and rejects expired or switched identity confirmations', async()=>{
 const s=await import('../src/applications/admin-registration.js'); assert.equal(typeof s.prepareActivityCleanup,'function');
 const calls=[];const token={confirmationId:'token',activityId:'activity',expiresAt:new Date(Date.now()+60000).toISOString(),applicationCount:2,detailsCount:2,proofCount:3};
 let user=admin;const client={auth:{getUser:async()=>({data:{user}})},rpc:async(name)=>{calls.push(name);return {data:name==='execute_activity_data_cleanup'?state:token};}};
 const prepared=await s.prepareActivityCleanup(client,{activityId:'activity',expectedUserId:'admin-a'});assert.deepEqual(calls,['prepare_activity_data_cleanup']);
 await s.confirmActivityCleanup(client,{confirmation:prepared,expectedUserId:'admin-a'});assert.equal(calls.length,2);
 user={...admin,id:'other'};await assert.rejects(()=>s.executeActivityCleanup(client,{confirmation:prepared,expectedUserId:'admin-a'}));assert.equal(calls.length,2);
 user=admin;await assert.rejects(()=>s.executeActivityCleanup(client,{confirmation:{...token,expiresAt:'2020-01-01'},expectedUserId:'admin-a'}));assert.equal(calls.length,2);
 await s.executeActivityCleanup(client,{confirmation:token,expectedUserId:'admin-a'});assert.equal(calls[2],'execute_activity_data_cleanup');
});

test('export reads only dedicated effective-confirmed server export and checks viewer identity',async()=>{
 const {readInsuranceExport}=await import('../src/applications/admin-registration.js');
 const exported={viewerId:'admin-a',activityId:'activity',title:'Synthetic',exportedAt:'2026-11-01T00:00:00Z',rows:[{applicationId:'selected',realName:'Synthetic',idNumber:'110105194912310021',phone:'13800138000',insuranceStatus:'uninsured',position:1,detailsComplete:true}]};
 const client={auth:{getUser:async()=>({data:{user:admin}})},rpc:async(name,args)=>{assert.equal(name,'export_activity_insurance');assert.deepEqual(args,{p_activity_id:'activity',p_expected_user_id:'admin-a'});return {data:exported}}};
 assert.deepEqual(await readInsuranceExport(client,{activityId:'activity',expectedUserId:'admin-a'}),exported);
 await assert.rejects(()=>readInsuranceExport({...client,rpc:async()=>({data:{...exported,viewerId:'other'}})},{activityId:'activity',expectedUserId:'admin-a'}));
});

test('sealed and expired rosters remain readable while current proof is withheld before actual purge',async()=>{
 for(const retention of [{status:'cleaning'},{status:'verifying'},{status:'waiting',dueAt:'2020-01-01T00:00:00Z'}]){
 const data={...state,retention,applications:[{id:'a',status:'active',paymentStatus:'paid',paymentProofs:[],currentPaymentProofId:'hidden-proof',proofsPurgedAt:null}]};
 await assert.doesNotReject(()=>readActivityRegistrations({rpc:async()=>({data})},'activity'));
 }
});


test('export and insurance expose recognizable identity errors before issuing RPC',async()=>{
 const service=await import('../src/applications/admin-registration.js');assert.equal(typeof service.isAdminIdentityError,'function');
 const client={auth:{getUser:async()=>({data:{user:{...admin,id:'other'}}})},rpc:()=>assert.fail('must not issue RPC')};
 for(const run of [()=>service.readInsuranceExport(client,{activityId:'activity',expectedUserId:'admin-a'}),()=>service.setApplicationInsurance(client,{applicationId:'a',insuranceStatus:'insured',expectedInsuranceStatus:'uninsured',expectedUserId:'admin-a',expectedDetailsUpdatedAt:null})])await assert.rejects(run,error=>service.isAdminIdentityError(error));
 assert.equal(service.isAdminIdentityError({code:'REQUEST_FAILED'}),false);
});


test('temporary identity network failure remains distinguishable from known account change',async()=>{
 const service=await import('../src/applications/admin-registration.js');
 await assert.rejects(()=>service.readInsuranceExport({auth:{getUser:async()=>({error:{code:'offline'}})},rpc:()=>assert.fail('must not issue RPC')},{activityId:'activity',expectedUserId:'admin-a'}),error=>error.code==='AUTH_UNAVAILABLE'&&!service.isAdminIdentityError(error));
});
