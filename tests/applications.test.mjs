import assert from 'node:assert/strict';
import test from 'node:test';
import * as service from '../src/applications/registration.js';
const activity = overrides => ({ id: 'activity', published: true, registrationCapacity: 5, registrationOpen: true, registrationStart: new Date(Date.now()-86400000).toISOString(), registrationDeadline: new Date(Date.now()+86400000).toISOString(), dateStart: new Date(Date.now()+172800000).toISOString(), dateEnd: new Date(Date.now()+259200000).toISOString(), ...overrides });
const user = { id: 'member', email: 'member@example.invalid' };
const application = { id: 'application', userId: user.id, createdAt: new Date().toISOString(), registeredAt: new Date().toISOString(), status: 'active', paymentStatus: 'unpaid', position: 10, selectionStatus: 'waitlisted' };
const state = { capacity: 5, activeCount: 10, confirmedCount: 5, waitlistCount: 5, canWithdraw: true, application };
function client({ currentUser=user, data=state, error=null, authError=null, throws=false }={}) { const calls=[]; return { calls, auth: { async getUser() { calls.push('auth'); return {data:{user:currentUser},error:authError}; } }, async rpc(name,args) { calls.push({name,args}); if(throws) throw new Error('private database detail'); return {data,error}; } }; }
test('availability rejects unknown capacity and invalid schedules without inventing legacy data',()=>{
 assert.equal(service.registrationAvailability(activity()).open,true);
 for(const change of [{registrationCapacity:undefined},{registrationCapacity:0},{registrationCapacity:2.5},{isDemo:true},{published:false},{localDraft:true},{archived:true},{registrationOpen:false},{registrationStart:undefined},{dateEnd:'bad'},{registrationDeadline:new Date(Date.now()-1000).toISOString()}]) assert.equal(service.registrationAvailability(activity(change)).open,false);
});
test('read state verifies Auth and requests only the current activity RPC',async()=>{
 const backend=client(); assert.deepEqual(await service.readActivityRegistration(backend,'activity',user.id),state);
 assert.deepEqual(backend.calls,['auth',{name:'get_activity_registration',args:{p_activity_id:'activity'}}]);
 assert.deepEqual(await service.readOwnApplication(client(),'activity',user.id),application);
});
test('submit returns the complete server state and never writes client ranking or identity',async()=>{
 const backend=client(); assert.deepEqual(await service.submitActivityApplication(backend,activity(),{expectedUserId:user.id}),state);
 assert.deepEqual(backend.calls,['auth',{name:'register_activity',args:{p_activity_id:'activity',p_expected_user_id:user.id}}]);
});
test('withdraw preserves server payment and ranking state',async()=>{
 const withdrawn={...state,application:{...application,status:'withdrawn',selectionStatus:'withdrawn',position:null,paymentStatus:'paid'}};
 const backend=client({data:withdrawn}); assert.deepEqual(await service.withdrawActivityRegistration(backend,'activity',{expectedUserId:user.id}),withdrawn);
 assert.equal(backend.calls[1].name,'withdraw_activity_registration');
});
test('all operations reject anonymous or changed verified accounts before RPC',async()=>{
 for(const operation of [b=>service.readActivityRegistration(b,'activity',user.id),b=>service.submitActivityApplication(b,activity(),{expectedUserId:user.id}),b=>service.withdrawActivityRegistration(b,'activity',{expectedUserId:user.id})]) {
  for(const currentUser of [null,{...user,is_anonymous:true},{id:'other'}]) {const backend=client({currentUser}); await assert.rejects(()=>operation(backend)); assert.deepEqual(backend.calls,['auth']);}
 }
});
test('server errors and malformed states never claim success or expose internal detail',async()=>{
 for(const options of [{error:{message:'private database detail'}},{throws:true},{data:null},{data:{}},{data:{...state,application:{...application,paymentStatus:'bogus'}}}]) {
  await assert.rejects(()=>service.submitActivityApplication(client(options),activity()),error=>!error.message.includes('private database detail'));
 }
});
test('unknown capacity still allows reading a saved legacy state',async()=>{
 const legacy={...state,capacity:null,confirmedCount:0,waitlistCount:0,application:{...application,selectionStatus:'unconfirmed',position:null}};
 assert.deepEqual(await service.readActivityRegistration(client({data:legacy}),'activity',user.id),legacy);
});
test('closed registration stops before RPC after checking identity',async()=>{
 const backend=client(); await assert.rejects(()=>service.submitActivityApplication(backend,activity({registrationOpen:false})),e=>e.code==='REGISTRATION_CLOSED'); assert.deepEqual(backend.calls,['auth']);
});
test('post-login paths remain internal',()=>{
 assert.equal(service.safeInternalReturn('/activities/test#application'),'/activities/test#application');
 for(const value of ['https://outside.invalid','//outside.invalid','/\\outside.invalid','/login','/%5cexample.com']) assert.equal(service.safeInternalReturn(value),null);
});
test('mutation responses must contain a personal application with the requested resulting status',async()=>{
 await assert.rejects(()=>service.submitActivityApplication(client({data:{...state,application:null}}),activity()));
 await assert.rejects(()=>service.withdrawActivityRegistration(client(),'activity',{expectedUserId:user.id}));
});
test('registration respects inclusive opening and exclusive deadline at exact boundaries',()=>{
 const scheduled=activity({registrationStart:'2026-11-02T00:00:00Z',registrationDeadline:'2026-11-03T00:00:00Z',dateStart:'2026-11-04T00:00:00Z',dateEnd:'2026-11-05T00:00:00Z'});
 const opening=Date.parse(scheduled.registrationStart);
 assert.equal(service.registrationAvailability(scheduled,opening-1).open,false);
 assert.equal(service.registrationAvailability(scheduled,opening).open,true);
 assert.equal(service.registrationAvailability(scheduled,Date.parse(scheduled.registrationDeadline)).open,false);
 for(const changes of [{registrationStart:scheduled.registrationDeadline},{registrationDeadline:'2026-11-04T01:00:00Z'},{dateEnd:scheduled.dateStart}]) assert.equal(service.registrationAvailability({...scheduled,...changes},opening).open,false);
});

test('withdraw binds the verified identity even if transport session switches before the RPC executes',async()=>{
 const backend=client(); let captured;
 backend.rpc=async(name,args)=>{ captured=args; return {data:null,error:{code:'42501'}}; };
 await assert.rejects(()=>service.withdrawActivityRegistration(backend,'activity',{expectedUserId:user.id}),error=>error.code==='REGISTRATION_FAILED');
 assert.equal(captured.p_expected_user_id,user.id,'server must receive original verified account to reject switched session');
});
