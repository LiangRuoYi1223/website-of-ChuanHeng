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

test('proof migration preserves historical data and exposes only a private bounded bucket',async()=>{
 const current=(await q('select * from public.applications where user_id=$1',[id(77)]))[0];for(const [key,val] of Object.entries(legacy))assert.deepEqual(current[key],val);
 assert.equal(current.current_payment_proof_id,null);assert.equal(await value('select v from chuanheng.sentinel'),'untouched');
 const bucket=(await q("select * from storage.buckets where id='payment-proofs'"))[0];assert.equal(bucket.public,false);assert.equal(bucket.file_size_limit,1048576);assert.deepEqual(bucket.allowed_mime_types,['image/webp']);
 assert.equal((await q('select * from public.application_payment_proofs')).length,0);assert.equal((await q('select * from public.registration_events')).length,0);
 for(const signature of ['public.set_activity_registration_payment(uuid,text,text,uuid)','private.set_activity_registration_payment(uuid,text,text,uuid)'])assert.equal(await value('select to_regprocedure($1)::text v',[signature]),null);
 assert.ok((await q("select prosecdef from pg_proc where pronamespace='public'::regnamespace")).every(p=>!p.prosecdef));
});
test('own valid proof atomically becomes pending, is returned only to owner/admin, and appends one unforgeable event',async()=>{
 const {a}=await seed();const objectPath=path(1,a.id);assert.equal((await read(1)).canSubmitPaymentProof,true);assert.equal((await read(2)).canSubmitPaymentProof,false);
 await object(1,objectPath);const result=await submit(1,objectPath);assert.equal(result.application.paymentStatus,'pending');assert.equal(result.canSubmitPaymentProof,false);assert.equal(result.application.paymentProofs.length,1);
 const proof=result.application.paymentProofs[0];assert.equal(proof.objectPath,objectPath);assert.equal(result.application.currentPaymentProofId,proof.id);assert.ok(proof.submittedAt);
 const other=await read(2);assert.deepEqual(other.application.paymentProofs,[]);assert.equal(other.application.currentPaymentProofId,null);
 const all=await admin(()=>rpc('get_activity_registrations',[id(100)]));assert.equal('events' in all,false);const event=(await q("select actor_id as \"actorId\",source,details from public.registration_events where action='payment_proof_submitted'"))[0];assert.equal(event.actorId,id(1));assert.equal(event.source,'self_service');assert.equal(event.details.paymentStatus.before,'unpaid');assert.equal(event.details.paymentStatus.after,'pending');assert.ok(JSON.stringify(event.details).includes(proof.id));assert.ok(JSON.stringify(event.details).includes(objectPath));
 assert.equal(all.applications.find(x=>x.id===a.id).paymentProofs[0].id,proof.id);
 await as(1,async()=>{assert.equal((await q("select * from storage.objects where bucket_id='payment-proofs'")).length,1);assert.equal((await q('select * from public.application_payment_proofs')).length,1);await rejected(()=>q('select * from public.registration_events'),/permission/);});
 await as(2,async()=>{assert.equal((await q("select * from storage.objects where bucket_id='payment-proofs'")).length,0);assert.equal((await q('select * from public.application_payment_proofs')).length,0);});
});
test('missing, foreign, malformed and incorrectly owned objects cannot claim pending',async()=>{
 const {a}=await seed();const own=path(1,a.id);await rejected(()=>submit(1,own),/PROOF|OBJECT/);
 for(const invalid of [`${id(1)}/${a.id}/../x.webp`,`${id(2)}/${a.id}/${id(200)}.webp`,`${id(1)}/${a.id}/not-a-uuid.webp`])await rejected(()=>submit(1,invalid),/PROOF|OBJECT|PATH/);
 await q("insert into storage.objects(bucket_id,name,owner_id,owner,metadata) values('payment-proofs',$1,$2::text,($2::text)::uuid,$3)",[own,id(2),{size:1024,mimetype:'image/webp'}]);await rejected(()=>submit(1,own),/PROOF|OWNER|OBJECT/);await q('delete from storage.objects where name=$1',[own]);
 for(const metadata of [{size:0,mimetype:'image/webp'},{size:1048577,mimetype:'image/webp'},{size:3145729,mimetype:'image/webp'},{size:1024,mimetype:'image/png'},{size:'forged',mimetype:'image/webp'},{}]){
  await object(1,own,metadata);await rejected(()=>submit(1,own),/PROOF|OBJECT|METADATA/);await q('delete from storage.objects where name=$1',[own]);
 }
 assert.equal((await read(1)).application.paymentStatus,'unpaid');assert.equal((await q('select * from public.application_payment_proofs')).length,0);
});
test('legacy owner metadata remains supported and editable user metadata never grants proof access',async()=>{
 const {a}=await seed();const own=path(1,a.id);
 await as(1,()=>q("insert into storage.objects(bucket_id,name,owner,metadata) values('payment-proofs',$1,$2,$3)",[own,id(1),{size:2048,mimetype:'image/webp'}]));
 const state=await submit(1,own);assert.equal(state.application.paymentStatus,'pending');
 await as(2,async()=>{assert.equal((await q("select * from storage.objects where bucket_id='payment-proofs'")).length,0);assert.equal((await q('select * from public.application_payment_proofs')).length,0);await rejected(()=>rpc('set_activity_registration_payment',[a.id,'paid','pending',id(2),state.application.currentPaymentProofId]),/ADMIN/);},{user_metadata:{role:'admin'}});
 await as(1,async()=>{assert.equal((await q("select * from storage.objects where bucket_id='payment-proofs'")).length,0);assert.equal((await q('select * from public.application_payment_proofs')).length,0);},{is_anonymous:true,app_metadata:{role:'admin'}});
});
test('anonymous, changed account, candidate, withdrawn, archived and unpublished submissions are rejected',async()=>{
 const {a,b}=await seed();const own=path(1,a.id);await object(1,own);
 await rejected(()=>submit(1,own,'unpaid',null,id(2)),/AUTH_CHANGED/);
 await as(1,()=>rejected(()=>rpc('submit_activity_payment_proof',[id(100),own,id(1),'unpaid',null]),/AUTH_REQUIRED/),{is_anonymous:true});
 await as(null,()=>rejected(()=>rpc('submit_activity_payment_proof',[id(100),own,null,'unpaid',null]),/permission/),{},'anon');
 await rejected(()=>object(2,path(2,b.id)),/policy/);await rejected(()=>submit(2,own),/PROOF|PATH|ELIGIB|CONFIRMED/);
 await as(1,()=>rpc('withdraw_activity_registration',[id(100),id(1)]));await rejected(()=>submit(1,own),/ELIGIB|CONFIRMED/);assert.equal((await read(1)).canSubmitPaymentProof,false);
 await as(2,()=>rpc('withdraw_activity_registration',[id(100),id(2)]));await as(1,()=>rpc('register_activity',[id(100),id(1),'测试甲','11010519491231002X','13800138000',true]));
 for(const patch of [{archived:true},{isDemo:true}]){await admin(()=>q('update public.content_items set payload=payload||$2 where id=$1',[id(100),patch]));assert.equal((await read(1)).canSubmitPaymentProof,false);await rejected(()=>submit(1,own),/ELIGIB|CONFIRMED/);await admin(()=>q('update public.content_items set payload=payload-$2 where id=$1',[id(100),Object.keys(patch)[0]]));}
 await admin(()=>q('update public.content_items set published=false where id=$1',[id(100)]));await rejected(()=>submit(1,own),/ELIGIB|CONFIRMED/);
});
test('duplicate upload retries stay idempotent after confirmation; paid users cannot downgrade themselves',async()=>{
 const {a}=await seed();const own=path(1,a.id);await object(1,own);const first=await submit(1,own);const proofId=first.application.currentPaymentProofId;
 const eventCount=(await q('select * from public.registration_events')).length;
 assert.equal((await submit(1,own)).application.currentPaymentProofId,proofId);assert.equal((await q('select * from public.registration_events')).length,eventCount);
 await rejected(()=>object(1,path(1,a.id,201)),/policy/);await rejected(()=>submit(1,path(1,a.id,201),'pending',proofId),/ELIGIB|PENDING|STATUS/);
 await setPayment(a.id,'paid','pending',proofId);assert.equal((await submit(1,own)).application.paymentStatus,'paid');assert.equal((await read(1)).canSubmitPaymentProof,false);
 await rejected(()=>object(1,path(1,a.id,202)),/policy/);await as(1,()=>rejected(()=>rpc('set_activity_registration_payment',[a.id,'unpaid','paid',id(1),proofId]),/ADMIN/));
});
test('admin rejection permits another immutable proof and expected proof protects an ABA review',async()=>{
 const {a}=await seed();const oldPath=path(1,a.id);await object(1,oldPath);const first=await submit(1,oldPath);const firstId=first.application.currentPaymentProofId;
 await setPayment(a.id,'unpaid','pending',firstId);const nextPath=path(1,a.id,201);await object(1,nextPath);
 await rejected(()=>submit(1,nextPath,'unpaid',null),/STALE/);const second=await submit(1,nextPath,'unpaid',firstId);const secondId=second.application.currentPaymentProofId;assert.notEqual(secondId,firstId);
 assert.equal(second.application.paymentProofs.length,2);assert.equal(second.application.paymentProofs[0].objectPath,nextPath);
 await rejected(()=>setPayment(a.id,'paid','pending',firstId),/STALE/);await rejected(()=>submit(1,oldPath,'pending',secondId),/STALE|PROOF|STATUS/);
 const confirmed=await setPayment(a.id,'paid','pending',secondId);assert.equal(confirmed.applications.find(x=>x.id===a.id).paymentStatus,'paid');
 const events=await q("select * from public.registration_events where action='payment_changed' order by id");assert.equal(events.length,2);assert.ok(events.every(e=>e.source==='manual'&&e.actor_id===id(900)));
});
test('proof metadata and audit remain append only; restrictive policies defeat broad legacy storage grants',async()=>{
 const {a}=await seed();const own=path(1,a.id);await object(1,own);await submit(1,own);
 await db.exec("create policy overly_broad_old_policy on storage.objects for all to anon,authenticated using(true) with check(true)");
 for(const n of [1,900])await as(n,async()=>{
  for(const table of ['public.application_payment_proofs','public.registration_events']){
   const column=table.endsWith('application_payment_proofs')?'object_path':'actor_label';await rejected(()=>q(`update ${table} set ${column}=${column}`),/permission/);await rejected(()=>q(`delete from ${table}`),/permission/);await rejected(()=>q(`truncate ${table}`),/permission/);
  }
  assert.equal((await q("update storage.objects set name=name where bucket_id='payment-proofs' returning id")).length,0);assert.equal((await q("delete from storage.objects where bucket_id='payment-proofs' returning id")).length,0);
 },n===900?{app_metadata:{role:'admin'}}:{});
 await as(2,async()=>{assert.equal((await q("select * from storage.objects where bucket_id='payment-proofs'")).length,0);await rejected(()=>q("insert into storage.objects(bucket_id,name,owner_id,metadata) values('payment-proofs',$1,$2,$3)",[path(1,a.id,203),id(2),{size:1024,mimetype:'image/webp'}]),/policy/);});
 await as(null,async()=>{assert.equal((await q("select * from storage.objects where bucket_id='payment-proofs'")).length,0);}, {},'anon');
 await admin(async()=>{assert.equal((await q("select * from storage.objects where bucket_id='payment-proofs'")).length,1);await rejected(()=>q("insert into public.application_payment_proofs(application_id,user_id,activity_id,object_path) values($1,$2,$3,$4)",[a.id,id(1),id(100),path(1,a.id,300)]),/permission/);});
 assert.equal((await q('select * from public.application_payment_proofs')).length,1);
});

test('one global QR setting has verified admin access, timestamp/account CAS and immutable change history',async()=>{
 await seed();const initial=await admin(()=>rpc('get_payment_settings'));
 assert.deepEqual(initial,{wechatQrUrl:null,updatedAt:null,updatedBy:null});assert.equal((await read(1)).paymentQrUrl,null);
 for(const extra of [{},{user_metadata:{role:'admin'}}])await as(1,()=>rejected(()=>rpc('get_payment_settings'),/ADMIN/),extra);
 await as(null,()=>rejected(()=>rpc('get_payment_settings'),/permission/),{},'anon');
 await as(900,()=>rejected(()=>rpc('get_payment_settings'),/AUTH/),{is_anonymous:true,app_metadata:{role:'admin'}});
 const objectPath=`${id(900)}/${id(500)}.webp`,url=`https://gftecgpbhiubrkmazlcu.supabase.co/storage/v1/object/public/activity-covers/${objectPath}`;
 await admin(()=>q("insert into storage.objects(bucket_id,name,owner_id,owner,metadata) values('activity-covers',$1,$2,$3,$4)",[objectPath,id(900),id(900),{size:1024,mimetype:'image/webp'}]));
 await as(1,()=>rejected(()=>rpc('save_payment_settings',[url,null,id(1)]),/ADMIN/));
 await admin(()=>rejected(()=>rpc('save_payment_settings',[url,null,id(1)]),/AUTH_CHANGED/));
 const saved=await admin(()=>rpc('save_payment_settings',[url,null,id(900)]));assert.equal(saved.wechatQrUrl,url);assert.equal(saved.updatedBy,id(900));assert.ok(saved.updatedAt);
 await admin(()=>q("update public.content_items set payload=payload||$2 where id=$1",[id(100),{paymentQrUrl:'https://untrusted.invalid/ignored.webp'}]));assert.equal((await read(1)).paymentQrUrl,url);
 await admin(()=>rejected(()=>rpc('save_payment_settings',['',null,id(900)]),/STALE/));
 const cleared=await admin(()=>rpc('save_payment_settings',['',saved.updatedAt,id(900)]));assert.equal(cleared.wechatQrUrl,null);assert.notEqual(cleared.updatedAt,saved.updatedAt);assert.equal((await read(1)).paymentQrUrl,null);
 assert.deepEqual(await admin(()=>rpc('save_payment_settings',[null,cleared.updatedAt,id(900)])),cleared);
 const events=await q('select * from public.payment_settings_events order by id');assert.equal(events.length,2);assert.equal(events[0].before_url,null);assert.equal(events[0].after_url,url);assert.equal(events[1].before_url,url);assert.equal(events[1].after_url,null);assert.ok(events.every(e=>e.actor_id===id(900)));
 assert.equal((await q("select * from storage.objects where bucket_id='activity-covers' and name=$1",[objectPath])).length,1,'clearing a QR never deletes the source object');
 for(const n of [1,900])await as(n,async()=>{
  await rejected(()=>q('update public.payment_settings set wechat_qr_url=null'),/permission/);await rejected(()=>q('delete from public.payment_settings'),/permission/);
  await rejected(()=>q('truncate public.payment_settings'),/permission/);await rejected(()=>q('insert into public.payment_settings(singleton) values(false)'),/permission/);
  await rejected(()=>q('insert into public.payment_settings_events(actor_id,actor_label) values($1,$2)',[id(n),'forged']),/permission/);
  await rejected(()=>q('update public.payment_settings_events set after_url=null'),/permission/);await rejected(()=>q('delete from public.payment_settings_events'),/permission/);await rejected(()=>q('truncate public.payment_settings_events'),/permission/);
  if(n===1){assert.equal((await q('select * from public.payment_settings')).length,0);await rejected(()=>q('select * from public.payment_settings_events'),/permission/);}
 },n===900?{app_metadata:{role:'admin'}}:{});
});
test('global QR configuration rejects foreign, missing and incorrectly typed storage objects',async()=>{
 const save=url=>admin(()=>rpc('save_payment_settings',[url,null,id(900)]));
 const objectPath=`${id(900)}/${id(500)}.webp`,url=`https://gftecgpbhiubrkmazlcu.supabase.co/storage/v1/object/public/activity-covers/${objectPath}`;
 for(const bad of ['https://other.supabase.co/storage/v1/object/public/activity-covers/'+objectPath,'https://gftecgpbhiubrkmazlcu.supabase.co/storage/v1/object/public/gallery-photos/'+objectPath,url+'?download=true',url+'#image','data:image/webp;base64,AAAA'])await rejected(()=>save(bad),/QR|URL/);
 await rejected(()=>save(url),/QR|OBJECT/);
 for(const metadata of [{size:1024,mimetype:'image/png'},{size:3145729,mimetype:'image/webp'},{mimetype:'image/webp'},{size:'1024',mimetype:'image/webp'}]){
  await admin(()=>q("insert into storage.objects(bucket_id,name,owner_id,metadata) values('activity-covers',$1,$2,$3)",[objectPath,id(900),metadata]));await rejected(()=>save(url),/QR|METADATA|OBJECT/);await q("delete from storage.objects where bucket_id='activity-covers' and name=$1",[objectPath]);
 }
 assert.deepEqual(await admin(()=>rpc('get_payment_settings')),{wechatQrUrl:null,updatedAt:null,updatedBy:null});assert.equal((await q('select * from public.payment_settings_events')).length,0);
});
