import assert from 'node:assert/strict';
import test from 'node:test';
import {readMemberProfile,saveMemberProfile,readMemberHistory} from '../src/members/profile.js';
import {validateRegistrationDetails,saveRegistrationDetails,submitActivityApplication} from '../src/applications/registration.js';
const user={id:'member'};
const profile={userId:'member',username:'同行者',realName:'',phone:'',updatedAt:'2026-11-01T00:00:00.123456Z'};
const details={realName:'测试姓名',idNumber:'11010519491231002x',phone:'13800138000',consent:true};
const state={capacity:5,activeCount:1,confirmedCount:1,waitlistCount:0,canWithdraw:true,application:{id:'app',userId:'member',status:'active',paymentStatus:'unpaid',selectionStatus:'confirmed',position:1}};
function client(data=profile,id='member'){const calls=[];return {calls,auth:{getUser:async()=>({data:{user:{id}}})},rpc:async(name,args)=>{calls.push({name,args});return {data}}};}
test('profile reads omit email and writes preserve exact optimistic timestamp and expected UUID',async()=>{const c=client({...profile,email:'secret'});assert.deepEqual(await readMemberProfile(c,'member'),profile);await saveMemberProfile(c,profile,{expectedUserId:'member'});assert.deepEqual(c.calls[1].args,{p_username:'同行者',p_real_name:'',p_phone:'',p_expected_updated_at:profile.updatedAt,p_expected_user_id:'member'});});
test('profile and history reject changed identities and wrong owners',async()=>{await assert.rejects(()=>readMemberProfile(client(profile,'other'),'member'));await assert.rejects(()=>readMemberProfile(client({...profile,userId:'other'}),'member'));assert.deepEqual(await readMemberHistory(client({viewerId:'member',activities:[]}),'member'),[]);await assert.rejects(()=>readMemberHistory(client({viewerId:'other',activities:[]}),'member'));});
test('registration validates birthday checksum mobile and explicit consent and normalizes x',()=>{assert.equal(validateRegistrationDetails(details).idNumber,'11010519491231002X');for(const d of [{consent:false},{idNumber:'11010519490231002X'},{idNumber:'110105194912310021'},{phone:'123'},{realName:''}]) assert.throws(()=>validateRegistrationDetails({...details,...d}));});
test('supplement uses its own atomic RPC without register/requeue',async()=>{const c=client(state);assert.deepEqual(await saveRegistrationDetails(c,'activity',{expectedUserId:'member',...details}),state);assert.equal(c.calls.length,1);assert.equal(c.calls[0].name,'save_activity_registration_details');assert.deepEqual(c.calls[0].args,{p_activity_id:'activity',p_expected_user_id:'member',p_real_name:'测试姓名',p_id_number:'11010519491231002X',p_phone:'13800138000',p_consent:true});});
test('registration requires all activity details before making any RPC',async()=>{const c=client(state);const now=Date.now(),activity={id:'activity',published:true,registrationCapacity:5,registrationOpen:true,registrationStart:new Date(now-10000).toISOString(),registrationDeadline:new Date(now+10000).toISOString(),dateStart:new Date(now+20000).toISOString(),dateEnd:new Date(now+30000).toISOString()};await assert.rejects(()=>submitActivityApplication(c,activity,{expectedUserId:'member'}));assert.equal(c.calls.length,0);await submitActivityApplication(c,activity,{expectedUserId:'member',...details});assert.equal(c.calls[0].args.p_consent,true);});

test('member identity failures distinguish missing login from changed account',async()=>{
 await assert.rejects(()=>readMemberProfile(client(profile,'other'),'member'),error=>error.code==='LOGIN_CHANGED');
 const missing=client();missing.auth.getUser=async()=>({data:{user:null},error:{name:'AuthSessionMissingError'}});
 await assert.rejects(()=>readMemberProfile(missing,'member'),error=>error.code==='LOGIN_REQUIRED');
});
