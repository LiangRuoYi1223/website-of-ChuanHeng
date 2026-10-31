import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {before,after,beforeEach,afterEach,test} from 'node:test';
const engine=process.env.SQL_TEST_ENGINE==='pg17'?'pglite-pg17':'@electric-sql/pglite';
const {PGlite}=await import(new URL(`../artifacts/sql-validation/node_modules/${engine}/dist/index.js`,import.meta.url));
const root=new URL('../',import.meta.url),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let db,legacy;
const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
const value=async(sql,args=[])=>(await q(sql,args))[0]?.v;
const rpc=(name,args=[])=>value(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) v`,args);
async function as(n,run,extra={},role='authenticated'){
 await db.exec(`set local role ${role}`);await q("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({sub:n?id(n):undefined,email:`member-${n}@example.invalid`,user_metadata:{displayName:`合成会员${n}`},...extra})]);
 await db.exec('savepoint identity_call');try{const result=await run();await db.exec('release savepoint identity_call');return result;}catch(error){await db.exec('rollback to savepoint identity_call;release savepoint identity_call');throw error;}finally{await db.exec('reset role');}
}
async function rejected(run,pattern=/./){await db.exec('savepoint denied');let error;try{await run();}catch(e){error=e;}await db.exec('rollback to savepoint denied;release savepoint denied');assert.ok(error,'request must reject');assert.match(error.message,pattern);}
const admin=fn=>as(900,fn,{app_metadata:{role:'admin'}});
const read=n=>as(n,()=>rpc('get_activity_registration',[id(100)]));
const path=(n,app,serial=200)=>`${id(n)}/${app}/${id(serial)}.webp`;
const submit=(n,objectPath,status='unpaid',proofId=null,expected=id(n))=>as(n,()=>rpc('submit_activity_payment_proof',[id(100),objectPath,expected,status,proofId]));
const setPayment=(app,status,previous,proofId)=>admin(()=>rpc('set_activity_registration_payment',[app,status,previous,id(900),proofId]));
async function object(n,objectPath,metadata={size:1024,mimetype:'image/webp'}){return as(n,()=>q("insert into storage.objects(bucket_id,name,owner_id,owner,metadata) values('payment-proofs',$1,$2,$3,$4)",[objectPath,id(n),id(n),metadata]));}
async function seed(){
 await admin(()=>q("insert into public.content_items(id,kind,published,payload) values($1,'activity',true,$2)",[id(100),{title:'合成缴费活动',registrationCapacity:1,registrationOpen:true,registrationStart:'2020-01-01T00:00:00Z',registrationDeadline:'2099-01-01T00:00:00Z',dateStart:'2099-01-02T00:00:00Z',dateEnd:'2099-01-03T00:00:00Z'}]));
 const a=await as(1,()=>rpc('register_activity',[id(100),id(1),'测试甲','11010519491231002X','13800138000',true]));const b=await as(2,()=>rpc('register_activity',[id(100),id(2),'测试乙','11010519491231002X','13800138000',true]));return{a:a.application,b:b.application};
}
before(async()=>{
 db=new PGlite();await db.exec(`create role service_role;create role anon;create role authenticated;create schema auth;grant usage on schema auth,public to anon,authenticated;
 create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}'::jsonb);
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
 create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
 create schema chuanheng;create table chuanheng.sentinel(v text);insert into chuanheng.sentinel values('untouched');
 create schema storage;grant usage on schema storage to anon,authenticated;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,owner uuid,owner_id text,metadata jsonb,unique(bucket_id,name));
 create function storage.foldername(name text) returns text[] language sql immutable as $$select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1]$$;
 alter table storage.objects enable row level security;grant select,insert,update,delete on storage.objects to anon,authenticated;`);
 const files=(await readdir(new URL('supabase/migrations/',root))).filter(f=>f.endsWith('.sql')).sort();
 for(const file of files){
  if(file.includes('_activity_payment_proofs.sql')){
   await q('insert into auth.users(id) values($1)',[id(77)]);await db.exec('alter table public.content_items disable trigger user;alter table public.applications disable trigger user');
   await q("insert into public.content_items(id,kind,published,payload) values($1,'activity',true,$2)",[id(777),{title:'历史资料',registrationCapacity:10,dateStart:'2099-01-01T00:00:00Z'}]);
   await q("insert into public.applications(activity_id,user_id,payload,created_at,registered_at,payment_status) values($1,$2,$3,'2025-01-01T00:00:00Z','2025-01-02T00:00:00Z','paid')",[id(777),id(77),{retained:'exact'}]);
   await db.exec('alter table public.content_items enable trigger user;alter table public.applications enable trigger user');legacy=(await q('select * from public.applications where user_id=$1',[id(77)]))[0];
  }
  await db.exec(await readFile(new URL(`supabase/migrations/${file}`,root),'utf8'));
 }
 for(const n of [1,2,3,900])await q('insert into auth.users(id) values($1)',[id(n)]);
});
after(async()=>db?.close());beforeEach(async()=>db.exec('begin'));afterEach(async()=>db.exec('rollback'));


test('atomic contacts, profiles, insurance CAS and private logs',async()=>{
 const {a}=await seed();assert.equal(a.detailsComplete,true);assert.equal(a.insuranceStatus,'uninsured');
 assert.equal(await value("select to_regprocedure('public.register_activity(uuid,uuid)')::text v"),null);
 await rejected(()=>as(1,()=>rpc('save_activity_registration_details',[id(100),id(1),'甲','110105194912310021','13800138000',true])),/INVALID/);
 const profile=await as(1,()=>rpc('save_member_profile',['会员甲','甲','13900139000',null,id(1)]));assert.equal(profile.phone,'13900139000');
 await rejected(()=>as(2,()=>rpc('save_member_profile',['x','','',null,id(1)])),/AUTH_CHANGED/);
 await rejected(()=>as(1,()=>rpc('get_member_profile'),{is_anonymous:true}),/AUTH/);
 const insured=await admin(()=>rpc('set_activity_registration_insurance',[a.id,'insured','uninsured',id(900),a.detailsUpdatedAt]));assert.equal(insured.applications[0].insuranceStatus,'insured');assert.equal('events' in insured,false);
 await rejected(()=>admin(()=>rpc('set_activity_registration_insurance',[a.id,'uninsured','uninsured',id(900),a.detailsUpdatedAt])),/STALE/);
 await rejected(()=>as(1,()=>rpc('save_activity_registration_details',[id(100),id(1),'甲','11010519491231002X','13800138000',true])),/INSURED/);
 await rejected(()=>admin(()=>q('select * from public.registration_events')),/permission/);
 const exp=await admin(()=>rpc('export_activity_insurance',[id(100),id(900)]));assert.equal(exp.rows.length,1);assert.equal(exp.rows[0].idNumber,'11010519491231002X');
 const hist=await as(1,()=>rpc('get_member_activity_history'));assert.equal(hist.activities.length,1);assert.ok(!JSON.stringify(hist).includes('13800138000'));
});
test('manual confirmations, tombstones, orphan sweep, two spaced empty rounds and profile retention',async()=>{
 const {a}=await seed();await as(1,()=>rpc('save_member_profile',['甲','','13900139000',null,id(1)]));
 const objectPath=path(1,a.id);await object(1,objectPath);const submitted=await submit(1,objectPath);const proofId=submitted.application.currentPaymentProofId;
 const orphan=path(1,a.id,201);await q("insert into storage.objects(bucket_id,name) values('payment-proofs',$1)",[orphan]);
 const token=await admin(()=>rpc('prepare_activity_data_cleanup',[id(100),id(900)]));
 await rejected(()=>admin(()=>rpc('execute_activity_data_cleanup',[token.confirmationId,id(900)])),/CONFIRM/);
 await admin(()=>rpc('confirm_activity_data_cleanup',[token.confirmationId,id(900)]));await admin(()=>rpc('execute_activity_data_cleanup',[token.confirmationId,id(900)]));
 await rejected(()=>as(1,()=>rpc('save_activity_registration_details',[id(100),id(1),'甲','11010519491231002X','13800138000',true])),/CLOSED/);
 await rejected(()=>admin(()=>rpc('claim_activity_data_cleanup',[10])),/permission/);
 const service=fn=>as(null,fn,{role:'service_role'},'service_role');
 const job=(await service(()=>rpc('claim_activity_data_cleanup',[10]))).jobs[0];assert.equal(job.objectPaths.length,2);
 assert.equal(await value('select count(*)::integer v from private.activity_registration_details'),0);
 assert.equal(await value('select object_path v from public.application_payment_proofs where id=$1',[proofId]),null);
 assert.equal((await read(1)).application.currentPaymentProofId,proofId);
 await q("delete from storage.objects where bucket_id='payment-proofs'");
 const done=await service(()=>rpc('finish_activity_data_cleanup',[id(100),job.leaseId,true,null]));assert.equal(done.consecutiveEmptyChecks,1);assert.equal(await value("select mod(extract(epoch from next_attempt_at)::numeric,180)=0 v from private.activity_data_cleanup where activity_id=$1",[id(100)]),true);
 assert.equal((await service(()=>rpc('claim_activity_data_cleanup',[10]))).jobs.length,0);
 await rejected(()=>service(()=>rpc('finish_activity_data_cleanup',[id(100),job.leaseId,true,null])),/LEASE/);
 await q("update private.activity_data_cleanup set next_attempt_at=clock_timestamp()-interval '1 second',last_round_slot=last_round_slot-1,last_checked_at=last_checked_at-interval '180 seconds' where activity_id=$1",[id(100)]);
 const second=(await service(()=>rpc('claim_activity_data_cleanup',[10]))).jobs[0];await service(()=>rpc('finish_activity_data_cleanup',[id(100),second.leaseId,true,null]));
 const state=await read(1);assert.equal(state.retention.status,'waiting');assert.ok(state.retention.clearedAt);assert.equal((await as(1,()=>rpc('get_member_profile'))).phone,'13900139000');
 const refill=await as(1,()=>rpc('save_activity_registration_details',[id(100),id(1),'甲','11010519491231002X','13800138000',true]));assert.equal(refill.application.detailsComplete,true);
});
const service=fn=>as(null,fn,{role:'service_role'},'service_role');
const claim=()=>service(()=>rpc('claim_activity_data_cleanup',[10]));
const finish=(job,ok=true,code=null)=>service(()=>rpc('finish_activity_data_cleanup',[job.activityId,job.leaseId,ok,code]));
const advance=()=>q("update private.activity_data_cleanup set next_attempt_at=clock_timestamp()-interval '1 second',last_round_slot=last_round_slot-1,last_checked_at=last_checked_at-interval '180 seconds'");
async function endActivity(){await admin(()=>q("update public.content_items set payload=payload||$2 where id=$1",[id(100),{registrationStart:'2020-01-01T00:00:00Z',registrationDeadline:'2020-01-02T00:00:00Z',dateStart:'2020-01-03T00:00:00Z',dateEnd:'2020-01-04T00:00:00Z'}]));}
test('automatic expiry seals reads before executor; date extension cannot reopen; failed and residue rounds never count',async()=>{
 const {a}=await seed();const own=path(1,a.id);await object(1,own);await submit(1,own);
 await endActivity();const sealed=await read(1);assert.equal(sealed.canSubmitPaymentProof,false);assert.equal(sealed.application.detailsComplete,false);assert.deepEqual(sealed.application.paymentProofs,[]);
 await as(1,async()=>{assert.equal((await q("select * from storage.objects where bucket_id='payment-proofs'")).length,0);assert.equal((await q('select * from public.application_payment_proofs')).length,0);});
 await rejected(()=>submit(1,own),/CLOSED/);await rejected(()=>admin(()=>rpc('export_activity_insurance',[id(100),id(900)])),/CLOSED/);
 let job=(await claim()).jobs[0];assert.equal(job.mode,'automatic');let result=await finish(job);assert.equal(result.consecutiveEmptyChecks,0);assert.equal(result.status,'cleaning');
 await admin(()=>q("update public.content_items set payload=payload||$2 where id=$1",[id(100),{dateStart:'2099-01-02T00:00:00Z',dateEnd:'2099-01-03T00:00:00Z'}]));
 await rejected(()=>as(1,()=>rpc('save_activity_registration_details',[id(100),id(1),'甲','11010519491231002X','13800138000',true])),/CLOSED/);
 await q("delete from storage.objects where bucket_id='payment-proofs'");await advance();job=(await claim()).jobs[0];result=await finish(job,false,'BATCH_LIMIT');assert.equal(result.consecutiveEmptyChecks,0);
 await advance();job=(await claim()).jobs[0];result=await finish(job);assert.equal(result.consecutiveEmptyChecks,1);
 await rejected(()=>object(1,path(1,a.id,201)),/CLOSED|policy/);
 // Simulate externally restored residue between rounds; executor must reset the streak.
 await db.exec('alter table storage.objects disable trigger guard_payment_object_retention');await q("insert into storage.objects(bucket_id,name) values('payment-proofs',$1)",[path(1,a.id,202)]);await db.exec('alter table storage.objects enable trigger guard_payment_object_retention');
 await advance();job=(await claim()).jobs[0];assert.equal(job.phase,'clear');await q("delete from storage.objects where bucket_id='payment-proofs'");result=await finish(job);assert.equal(result.consecutiveEmptyChecks,1);
 await advance();job=(await claim()).jobs[0];assert.equal(job.phase,'confirm');result=await finish(job);assert.equal(result.status,'completed');assert.equal((await claim()).jobs.length,0);
 assert.equal((await read(1)).retention.status,'completed');await rejected(()=>admin(()=>rpc('export_activity_insurance',[id(100),id(900)])),/CLOSED/);
});
test('identity, stale versions, invalid data, private tables and least-privilege wrappers',async()=>{
 const {a,b}=await seed();
 for(const args of [['甲','11010519490230002X','13800138000',true],['甲','11010519491231002X','12800138000',true],['甲','11010519491231002X','13800138000',false]])await rejected(()=>as(1,()=>rpc('save_activity_registration_details',[id(100),id(1),...args])),/INVALID/);
 const before=(await read(1)).application;assert.equal(before.detailsUpdatedAt,a.detailsUpdatedAt);assert.equal(before.registeredAt,a.registeredAt);
 await rejected(()=>as(1,()=>rpc('save_activity_registration_details',[id(100),id(2),'甲','11010519491231002X','13800138000',true])),/AUTH_CHANGED/);
 await rejected(()=>admin(()=>rpc('set_activity_registration_insurance',[b.id,'insured','uninsured',id(900),b.detailsUpdatedAt])),/ELIGIBLE/);
 await rejected(()=>admin(()=>rpc('set_activity_registration_insurance',[a.id,'insured','uninsured',id(900),null])),/STALE/);
 const profile=await as(1,()=>rpc('save_member_profile',['甲','','',null,id(1)]));await rejected(()=>as(1,()=>rpc('save_member_profile',['乙','','',null,id(1)])),/STALE/);assert.equal((await as(2,()=>rpc('get_member_profile'))).username,'');
 for(const table of ['private.member_profiles','private.activity_registration_details','private.activity_data_cleanup','private.cleanup_confirmations','public.registration_events'])await rejected(()=>admin(()=>q(`select * from ${table}`)),/permission/);
 for(const name of ['private.register_activity_queue($1,$2)','private.insurance_audit($1,$2,$3)'])await rejected(()=>as(1,()=>q(`select ${name}`,name.includes('queue')?[id(100),id(1)]:[id(100),'insurance_exported',{}])),/permission/);
 assert.ok((await q("select prosecdef from pg_proc where pronamespace='public'::regnamespace")).every(p=>!p.prosecdef));
 const events=JSON.stringify(await q('select details from public.registration_events'));assert.ok(!events.includes('11010519491231002X'));assert.ok(!events.includes('13800138000'));
 assert.equal(await value('select v from chuanheng.sentinel'),'untouched');const current=(await q('select * from public.applications where user_id=$1',[id(77)]))[0];for(const [key,val] of Object.entries(legacy))assert.deepEqual(current[key],val);
});
test('confirmation tokens are account and activity state bound, expiring, single-use; missing end stays explicit',async()=>{
 await seed();const t=await admin(()=>rpc('prepare_activity_data_cleanup',[id(100),id(900)]));
 await rejected(()=>as(1,()=>rpc('confirm_activity_data_cleanup',[t.confirmationId,id(1)]),{app_metadata:{role:'admin'}}),/CONFIRM/);
 await admin(()=>q("update public.content_items set payload=payload||'{\"title\":\"changed\"}'::jsonb where id=$1",[id(100)]));
 await rejected(()=>admin(()=>rpc('confirm_activity_data_cleanup',[t.confirmationId,id(900)])),/CONFIRM/);
 const expired=await admin(()=>rpc('prepare_activity_data_cleanup',[id(100),id(900)]));await q("update private.cleanup_confirmations set expires_at=clock_timestamp()-interval '1 second' where id=$1",[expired.confirmationId]);await rejected(()=>admin(()=>rpc('confirm_activity_data_cleanup',[expired.confirmationId,id(900)])),/CONFIRM/);
 const good=await admin(()=>rpc('prepare_activity_data_cleanup',[id(100),id(900)]));await admin(()=>rpc('confirm_activity_data_cleanup',[good.confirmationId,id(900)]));await admin(()=>rpc('execute_activity_data_cleanup',[good.confirmationId,id(900)]));await rejected(()=>admin(()=>rpc('execute_activity_data_cleanup',[good.confirmationId,id(900)])),/CONFIRM/);
 const legacyState=await as(77,()=>rpc('get_activity_registration',[id(777)]));assert.equal(legacyState.retention.status,'missing_end');assert.equal(legacyState.retention.dueAt,null);
});
test('bounded exact-lease prefix enumeration never includes another activity or other buckets',async()=>{
 const {a}=await seed();
 await admin(()=>q("insert into public.content_items(id,kind,published,payload) select $1,kind,published,payload||'{\"title\":\"second\"}'::jsonb from public.content_items where id=$2",[id(101),id(100)]));
 const b=(await as(1,()=>rpc('register_activity',[id(101),id(1),'乙','11010519491231002X','13800138000',true]))).application;
 const other=path(1,b.id);await object(1,other);
 await q("insert into storage.objects(bucket_id,name) select 'payment-proofs',$1||'/'||$2||'/'||lpad(i::text,36,'0')||'.webp' from generate_series(1,105)i",[id(1),a.id]);
 const t=await admin(()=>rpc('prepare_activity_data_cleanup',[id(100),id(900)]));assert.equal(t.proofCount,105);await admin(()=>rpc('confirm_activity_data_cleanup',[t.confirmationId,id(900)]));await admin(()=>rpc('execute_activity_data_cleanup',[t.confirmationId,id(900)]));
 const job=(await claim()).jobs[0];assert.equal(job.objectPaths.length,100);assert.ok(job.objectPaths.every(x=>x.startsWith(`${id(1)}/${a.id}/`)));
 await rejected(()=>service(()=>rpc('list_activity_cleanup_objects',[id(101),job.leaseId,100])),/LEASE/);
 assert.equal((await service(()=>rpc('list_activity_cleanup_objects',[id(100),job.leaseId,1000]))).objectPaths.length,100);
 await q("delete from storage.objects where bucket_id='payment-proofs' and name=any($1::text[])",[job.objectPaths]);const tail=await service(()=>rpc('list_activity_cleanup_objects',[id(100),job.leaseId,100]));assert.equal(tail.objectPaths.length,5);
 const incomplete=await finish(job);assert.equal(incomplete.status,'cleaning');assert.equal(incomplete.consecutiveEmptyChecks,0);
 assert.equal(await value('select count(*)::integer v from storage.objects where name=$1',[other]),1);assert.equal((await as(1,()=>rpc('get_activity_registration',[id(101)]))).application.detailsComplete,true);
});
test('insured rejoin with unchanged details preserves insurance/version and moves to queue tail; changed details rolls back',async()=>{
 const {a}=await seed();
 await admin(()=>rpc('set_activity_registration_insurance',[a.id,'insured','uninsured',id(900),a.detailsUpdatedAt]));
 await as(1,()=>rpc('withdraw_activity_registration',[id(100),id(1)]));
 const withdrawn=(await read(1)).application;
 const rejoined=await as(1,()=>rpc('register_activity',[id(100),id(1),'测试甲','11010519491231002X','13800138000',true]));
 assert.equal(rejoined.application.status,'active');assert.equal(rejoined.application.position,2);assert.equal(rejoined.application.selectionStatus,'waitlisted');assert.equal(rejoined.application.insuranceStatus,'insured');assert.equal(rejoined.application.detailsUpdatedAt,a.detailsUpdatedAt);assert.ok(rejoined.application.registeredAt>withdrawn.registeredAt);
 await as(1,()=>rpc('withdraw_activity_registration',[id(100),id(1)]));
 const before=(await q('select * from public.applications where id=$1',[a.id]))[0];const events=await value('select count(*)::integer v from public.registration_events');
 for(const values of [['不同姓名','11010519491231002X','13800138000'],['测试甲','110105194912310011','13800138000'],['测试甲','11010519491231002X','13900139000']])await rejected(()=>as(1,()=>rpc('register_activity',[id(100),id(1),...values,true])),/INSURED_DETAILS_LOCKED/);
 assert.deepEqual((await q('select * from public.applications where id=$1',[a.id]))[0],before);assert.equal(await value('select count(*)::integer v from public.registration_events'),events);
});
test('history treats every invalid legacy capacity as unconfirmed without mutating source',async()=>{
 for(const capacity of [undefined,null,'unknown','10',1.5,0,-1,100001,1e30,[],{}]){
  const payload={title:'旧活动',dateStart:'2099-01-01T00:00:00Z',...(capacity===undefined?{}:{registrationCapacity:capacity})};
  await db.exec('alter table public.content_items disable trigger user');await q('update public.content_items set payload=$2 where id=$1',[id(777),payload]);await db.exec('alter table public.content_items enable trigger user');
  const before=(await q('select * from public.content_items where id=$1',[id(777)]))[0];
  const state=await as(77,()=>rpc('get_activity_registration',[id(777)]));assert.equal(state.application.selectionStatus,'unconfirmed');
  const history=await as(77,()=>rpc('get_member_activity_history'));assert.equal(history.activities.length,1);assert.equal(history.activities[0].selectionStatus,'unconfirmed');
  assert.deepEqual((await q('select * from public.content_items where id=$1',[id(777)]))[0],before);
 }
});
test('failed older UUID jobs cannot starve never-claimed due activities',async()=>{
 await seed();await endActivity();
 for(let n=101;n<=106;n++)await admin(()=>q("insert into public.content_items(id,kind,published,payload) select $1,kind,published,payload from public.content_items where id=$2",[id(n),id(100)]));
 const seen=new Set();
 for(let round=0;round<3;round++){
  const jobs=(await service(()=>rpc('claim_activity_data_cleanup',[3]))).jobs;for(const job of jobs){seen.add(job.activityId);await finish(job,false,'storage_error');}
  await q("update private.activity_data_cleanup set next_attempt_at=clock_timestamp()-interval '1 second',last_round_slot=last_round_slot-1,last_checked_at=last_checked_at-interval '180 seconds'");
 }
 assert.ok(seen.has(id(106)),'seventh activity must be claimed despite repeated failures');
});
test('next attempt aligns with next cron slot rather than finish plus 180 seconds',async()=>{
 await seed();await endActivity();const job=(await claim()).jobs[0];await finish(job);
 assert.equal(await value("select mod(extract(epoch from next_attempt_at)::numeric,180)=0 v from private.activity_data_cleanup where activity_id=$1",[id(100)]),true);
});
test('new-slot confirmation exposes actual 180-second boundary; early finish preserves lease and cannot count',async()=>{
 await seed();await endActivity();const first=(await claim()).jobs[0];assert.equal(first.verifyNotBefore,null);await finish(first);
 // Due time alone cannot permit a duplicate claim in the same scheduler slot.
 await q("update private.activity_data_cleanup set next_attempt_at=clock_timestamp()-interval '1 second' where activity_id=$1",[id(100)]);assert.equal((await claim()).jobs.length,0);
 // Simulate the next cron tick arriving five seconds before the previous finish+180.
 await q("update private.activity_data_cleanup set last_round_slot=last_round_slot-1,last_checked_at=clock_timestamp()-interval '175 seconds' where activity_id=$1",[id(100)]);
 const second=(await claim()).jobs[0];assert.equal(second.phase,'confirm');assert.ok(Date.parse(second.verifyNotBefore)>Date.now());
 assert.equal(second.verifyNotBefore,await value("select jsonb_build_object('v',last_checked_at+interval '180 seconds')->>'v' v from private.activity_data_cleanup where activity_id=$1",[id(100)]));
 const before=(await q('select * from private.activity_data_cleanup where activity_id=$1',[id(100)]))[0];
 const early=await finish(second);assert.equal(early.status,'verifying');assert.equal(early.consecutiveEmptyChecks,1);assert.equal(early.nextAttemptAt,second.verifyNotBefore);assert.equal(early.leaseRetained,true);assert.ok(Number.isInteger(early.retryAfterMs)&&early.retryAfterMs>=1&&early.retryAfterMs<=5000,'server remaining delay must be a positive bounded integer');
 assert.deepEqual((await q('select * from private.activity_data_cleanup where activity_id=$1',[id(100)]))[0],before);
 assert.equal((await claim()).jobs.length,0);assert.deepEqual((await service(()=>rpc('list_activity_cleanup_objects',[id(100),second.leaseId,100]))).objectPaths,[]);
 await q("update private.activity_data_cleanup set last_checked_at=clock_timestamp()-interval '181 seconds' where activity_id=$1",[id(100)]);
 const completed=await finish(second);assert.equal(completed.consecutiveEmptyChecks,2);assert.equal(completed.status,'completed');await rejected(()=>finish(second),/LEASE/);
});
test('unfinished and expired leases cannot be reclaimed in their original slot',async()=>{
 await seed();await endActivity();const first=(await claim()).jobs[0];assert.equal((await claim()).jobs.length,0);
 await q("update private.activity_data_cleanup set lease_until=clock_timestamp()-interval '1 second' where activity_id=$1",[id(100)]);
 assert.equal((await claim()).jobs.length,0);await rejected(()=>finish(first),/LEASE/);
 await q('update private.activity_data_cleanup set last_round_slot=last_round_slot-1 where activity_id=$1',[id(100)]);
 const next=(await claim()).jobs[0];assert.notEqual(next.leaseId,first.leaseId);await rejected(()=>finish(first),/LEASE/);assert.equal((await finish(next)).consecutiveEmptyChecks,1);
});
