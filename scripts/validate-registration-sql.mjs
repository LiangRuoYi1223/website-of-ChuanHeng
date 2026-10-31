import assert from 'node:assert/strict';
import { readFile,readdir } from 'node:fs/promises';
import { test } from 'node:test';
const engine=process.env.SQL_TEST_ENGINE==='pg17'?'pglite-pg17':'@electric-sql/pglite';
const {PGlite}=await import(new URL(`../artifacts/sql-validation/node_modules/${engine}/dist/index.js`,import.meta.url));
const root=new URL('../',import.meta.url), id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
test('registration migration: ordered queue, retained data, role isolation and immutable audit',async()=>{
 const db=new PGlite();
 const q=async(s,a=[])=>(await db.query(s,a)).rows;
 const v=async(s,a=[])=>(await q(s,a))[0]?.v;
 const writes=new Set(['register_activity','withdraw_activity_registration','set_activity_registration_payment']);
 const rpc=(name,args=[])=>v(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}${writes.has(name)?(name==='set_activity_registration_payment'?',auth.uid(),null':',auth.uid()'):''}) v`,args);
 const as=async(n,fn,extra={},role='authenticated')=>{await db.exec(`set role ${role}`);await q("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:n?id(n):undefined,email:`u${n}@example.test`,user_metadata:{displayName:`会员${n}`},...extra})]);try{return await fn();}finally{await db.exec('reset role');}};
 const fail=async(fn,re=/./)=>{await assert.rejects(fn,re)};
 try{
 await db.exec(`create role anon;create role authenticated;create schema auth;grant usage on schema auth,public to anon,authenticated;
 create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
 create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
 create schema chuanheng;create table chuanheng.sentinel(v text);insert into chuanheng.sentinel values('untouched');
 create schema storage;grant usage on schema storage to anon,authenticated;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,owner uuid,owner_id text,metadata jsonb);
 create function storage.foldername(name text) returns text[] language sql immutable as $$select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1]$$;
 alter table storage.objects enable row level security;grant select,insert,update,delete on storage.objects to anon,authenticated;`);
 const files=(await readdir(new URL('supabase/migrations/',root))).filter(f=>f.endsWith('.sql')).sort();
 let legacyApplication;
 for(const f of files) {
 if(f.includes('activity_registration_management')) {
 await q('insert into auth.users(id,email,raw_user_meta_data) values($1,$2,$3)',[id(77),'historical@example.test',{displayName:'历史会员',role:'admin'}]);
 await db.exec('alter table public.content_items disable trigger user');
 await q(`insert into public.content_items(id,kind,published,payload) values($1,'activity',true,$2)`,[id(777),{title:'保留历史',registrationOpen:true,dateStart:'2099-01-02T00:00:00Z'}]);
 await db.exec('alter table public.content_items enable trigger user');
 await q(`insert into public.applications(activity_id,user_id,payload,created_at) values($1,$2,$3,'2025-01-01T00:00:00Z')`,[id(777),id(77),{original:'保留'}]);
 legacyApplication=(await q('select * from public.applications where user_id=$1',[id(77)]))[0];
 for(const [n,metadata] of [[78,{full_name:'完整姓名'}],[79,{name:'名称'}],[80,{}]]) {
 await q('insert into auth.users(id,raw_user_meta_data) values($1,$2)',[id(n),metadata]);
 await q('insert into public.applications(activity_id,user_id) values($1,$2)',[id(777),id(n)]);
 }
 }
 await db.exec(await readFile(new URL(`supabase/migrations/${f}`,root),'utf8'));
 }
 const preserved=(await q('select * from public.applications where user_id=$1',[id(77)]))[0];
 for(const [k,value] of Object.entries(legacyApplication)) assert.deepEqual(preserved[k],value);
 assert.deepEqual(preserved.registered_at,legacyApplication.created_at);
 assert.equal(preserved.registration_status,'active');
 assert.equal(preserved.display_name,'历史会员');
 assert.equal(preserved.email,'historical@example.test');
 for(const [n,name] of [[78,'完整姓名'],[79,'名称'],[80,id(80)]]) {
 const row=(await q('select display_name,email from public.applications where user_id=$1',[id(n)]))[0];
 assert.equal(row.display_name,name);assert.equal(row.email,null);
 }
 assert.equal((await q('select * from public.registration_events')).length,0,'backfill must not invent historical actions');
 await as(77,async()=>{const old=await rpc('get_activity_registration',[id(777)]);assert.equal(old.capacity,null);assert.equal(old.application.selectionStatus,'unconfirmed');});

 for(const n of [1,2,3,900]) await q('insert into auth.users(id) values($1)',[id(n)]);
 await as(900,()=>q(`insert into public.content_items(id,kind,published,payload) values($1,'activity',true,$2)`,[id(100),{title:'测试活动',registrationCapacity:1,registrationOpen:true,registrationStart:'2020-01-01T00:00:00Z',registrationDeadline:'2099-01-01T00:00:00Z',dateStart:'2099-01-02T00:00:00Z',dateEnd:'2099-01-03T00:00:00Z'}]),{app_metadata:{role:'admin'}});
 const beforeWrongRegister=await q('select * from public.applications order by id');
 const beforeWrongEvents=await q('select * from public.registration_events order by id');
 await as(3,async()=>{
 for(const expected of [id(1),null]) {
 await fail(()=>v('select public.register_activity($1,$2) v',[id(100),expected]),/AUTH_CHANGED/);
 await fail(()=>v('select private.register_activity($1,$2) v',[id(100),expected]),/AUTH_CHANGED/);
 }
 });
 assert.deepEqual(await q('select * from public.applications order by id'),beforeWrongRegister);
 assert.deepEqual(await q('select * from public.registration_events order by id'),beforeWrongEvents);
 await as(3,async()=>{
 await fail(()=>rpc('register_activity',[id(100)]),/AUTH_REQUIRED/);
 await fail(()=>v('select private.register_activity($1,auth.uid()) v',[id(100)]),/AUTH_REQUIRED/);
 await fail(()=>rpc('get_activity_registration',[id(100)]),/AUTH_REQUIRED/);
 await fail(()=>rpc('withdraw_activity_registration',[id(100)]),/AUTH_REQUIRED/);
 },{is_anonymous:true});
 await as(900,()=>fail(()=>rpc('set_activity_registration_payment',[id(999),'paid','unpaid']),/AUTH_REQUIRED/),{is_anonymous:true,app_metadata:{role:'admin'}});
 let a=await as(1,()=>rpc('register_activity',[id(100)]));assert.equal(a.application.position,1);assert.equal(a.application.selectionStatus,'confirmed');
 let b=await as(2,()=>rpc('register_activity',[id(100)]));assert.equal(b.application.position,2);assert.equal(b.application.selectionStatus,'waitlisted');
 await as(3,()=>rpc('register_activity',[id(100)]));
 const beforeWrongWrites=await q('select * from public.applications order by id');
 const beforeWrongWriteEvents=await q('select * from public.registration_events order by id');
 await as(2,async()=>{
 for(const expected of [id(1),null]) {
 await fail(()=>v('select public.withdraw_activity_registration($1,$2) v',[id(100),expected]),/AUTH_CHANGED/);
 await fail(()=>v('select private.withdraw_activity_registration($1,$2) v',[id(100),expected]),/AUTH_CHANGED/);
 }
 });
 await as(900,async()=>{
 for(const expected of [id(1),null]) {
 await fail(()=>v('select public.set_activity_registration_payment($1,$2,$3,$4,null) v',[a.application.id,'paid','unpaid',expected]),/AUTH_CHANGED/);
 await fail(()=>v('select private.set_activity_registration_payment($1,$2,$3,$4,null) v',[a.application.id,'paid','unpaid',expected]),/AUTH_CHANGED/);
 }
 const state=await rpc('get_activity_registrations',[id(100)]);assert.equal(state.viewerId,id(900));
 },{app_metadata:{role:'admin'}});
 assert.deepEqual(await q('select * from public.applications order by id'),beforeWrongWrites);
 assert.deepEqual(await q('select * from public.registration_events order by id'),beforeWrongWriteEvents);
 await as(1,async()=>{const again=await rpc('register_activity',[id(100)]);assert.equal(again.application.id,a.application.id);assert.equal(again.activeCount,3);assert.equal((await q('select * from public.applications')).length,1);assert.equal((await q('select * from public.registration_events')).length,0);});
 await as(900,async()=>{const paid=await rpc('set_activity_registration_payment',[a.application.id,'paid','unpaid']);assert.equal(paid.applications.find(x=>x.id===a.application.id).paymentStatus,'paid');await fail(()=>rpc('set_activity_registration_payment',[a.application.id,'unpaid','unpaid']),/STALE/);},{app_metadata:{role:'admin'}});
 await as(1,()=>rpc('withdraw_activity_registration',[id(100)]));b=await as(2,()=>rpc('get_activity_registration',[id(100)]));assert.equal(b.application.position,1);assert.equal(b.application.selectionStatus,'confirmed');
 await as(1,()=>rpc('withdraw_activity_registration',[id(100)]));a=await as(1,()=>rpc('register_activity',[id(100)]));assert.equal(a.application.position,3);assert.equal(a.application.paymentStatus,'paid');
 for(const jwt of [{},{user_metadata:{role:'admin'}}]) await as(1,async()=>{await fail(()=>rpc('get_activity_registrations',[id(100)]),/ADMIN/);await fail(()=>rpc('set_activity_registration_payment',[a.application.id,'unpaid','paid']),/ADMIN/);},jwt);
 await as(null,()=>fail(()=>rpc('get_activity_registration',[id(100)]),/AUTH/));await as(null,()=>fail(()=>rpc('register_activity',[id(100)]),/permission/),{},'anon');
 for(const n of [1,900]) await as(n,async()=>{
 await fail(()=>q('insert into public.applications(activity_id) values($1)',[id(100)]),/permission/);
 await fail(()=>q("update public.applications set payment_status='paid',registered_at='2000-01-01'"),/permission/);
 await fail(()=>q('delete from public.applications'),/permission/);
 await fail(()=>q("insert into public.registration_events(activity_id,action) values($1,'registered')",[id(100)]),/permission/);
 await fail(()=>q("update public.registration_events set actor_label='forged'"),/permission/);
 await fail(()=>q('delete from public.registration_events'),/permission/);
 await fail(()=>q('truncate table public.registration_events'),/permission/);
 },n===900?{app_metadata:{role:'admin'}}:{});
 await as(1,async()=>{
 await fail(()=>v('select private.registration_state($1,true) v',[id(100)]),/ADMIN/);
 await fail(()=>v('select private.set_activity_registration_payment($1,$2,$3,auth.uid(),null) v',[a.application.id,'paid','paid']),/ADMIN/);
 await fail(()=>q('select private.audit_registration()'),/permission/);
 await fail(()=>q('select private.guard_registration_capacity()'),/permission/);
 await fail(()=>rpc('register_activity',[id(777)]),/CAPACITY/);
 await fail(()=>rpc('get_activity_registration',[id(999)]),/UNAVAILABLE/);
 });
 await as(null,()=>fail(()=>v('select private.registration_state($1,false) v',[id(100)]),/AUTH/),{app_metadata:{role:'admin'}});
 await as(900,async()=>{
 await q(`update public.content_items set payload=jsonb_set(payload,'{registrationCapacity}','2') where id=$1`,[id(100)]);
 const all=await rpc('get_activity_registrations',[id(100)]);assert.equal(all.applications.length,3);assert.equal(all.confirmedCount,2);assert.equal(all.events.length,8);
 const event=all.events.find(e=>e.action==='payment_changed');assert.equal(event.actorId,id(900));assert.equal(event.actorLabel,'会员900');assert.equal(event.source,'manual');assert.equal(event.actorType,'admin');assert.equal(all.events.filter(e=>e.action==='withdrawn').length,1);
 assert.equal(all.events.find(e=>e.action==='rejoined').source,'self_service');
 await fail(()=>q(`update public.content_items set payload=jsonb_set(payload,'{registrationCapacity}','0') where id=$1`,[id(100)]),/CAPACITY/);
 },{app_metadata:{role:'admin'}});
 await as(900,async()=>{
 // Ordinary edits keep a historical unknown capacity and do not invent one.
 await q(`update public.content_items set payload=payload || '{"description":"历史修改"}' where id=$1`,[id(777)]);
 await fail(()=>q(`update public.content_items set payload=payload-'registrationCapacity' where id=$1`,[id(100)]),/CAPACITY/);
 await fail(()=>q(`update public.content_items set payload=jsonb_set(payload,'{registrationCapacity}','null'::jsonb) where id=$1`,[id(100)]),/CAPACITY/);
 for(const capacity of [0,-1,1.5,100001,'3',true,{},[]]) await fail(()=>q(`update public.content_items set payload=jsonb_set(payload,'{registrationCapacity}',$2) where id=$1`,[id(100),JSON.stringify(capacity)]),/CAPACITY/);
 for(const patch of [{registrationOpen:false},{registrationStart:'2098-01-01T00:00:00Z'},{registrationDeadline:'2021-01-01T00:00:00Z'},{archived:true},{isDemo:true}]) {
 const current=(await q('select payload from public.content_items where id=$1',[id(100)]))[0].payload;
 await q('update public.content_items set payload=$2 where id=$1',[id(100),{...current,...patch}]);
 await as(1,()=>rpc('withdraw_activity_registration',[id(100)]));
 await as(1,()=>fail(()=>rpc('register_activity',[id(100)]),/CLOSED/));
 // as() resets role: explicitly restore the administrator for this fixture.
 await db.exec('set role authenticated');await q("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:id(900),app_metadata:{role:'admin'}})]);
 await q('update public.content_items set payload=$2 where id=$1',[id(100),current]);
 await as(1,()=>rpc('register_activity',[id(100)]));
 await db.exec('set role authenticated');await q("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:id(900),app_metadata:{role:'admin'}})]);
 }
 },{app_metadata:{role:'admin'}});
 await as(900,async()=>{
 const current=(await q('select payload from public.content_items where id=$1',[id(100)]))[0].payload;
 await q('update public.content_items set payload=$2 where id=$1',[id(100),{...current,registrationDeadline:'2021-01-01T00:00:00Z',dateStart:'2021-01-02T00:00:00Z',dateEnd:'2021-01-03T00:00:00Z'}]);
 },{app_metadata:{role:'admin'}});
 await as(1,()=>fail(()=>rpc('withdraw_activity_registration',[id(100)]),/WITHDRAWAL_CLOSED/));
 await as(900,async()=>{
 await q(`insert into public.content_items(id,kind,published,payload) values($1,'activity',false,$2)`,[id(101),{title:'从无报名可删除活动',registrationCapacity:10}]);
 await rpc('delete_content_with_links',[id(101)]);
 assert.equal((await q('select * from public.content_items where id=$1',[id(101)])).length,0);
 const log=(await q('select details from public.registration_events where activity_id=$1',[id(101)]))[0];
 assert.equal(log.details.activityTitle,'从无报名可删除活动');assert.equal(log.details.capacity.after,10);
 await fail(()=>rpc('delete_content_with_links',[id(100)]),/foreign key/);
 },{app_metadata:{role:'admin'}});
 for(const signature of ['public.register_activity(uuid)','private.register_activity(uuid)','public.withdraw_activity_registration(uuid)','private.withdraw_activity_registration(uuid)','public.set_activity_registration_payment(uuid,text,text)','private.set_activity_registration_payment(uuid,text,text)']) assert.equal(await v('select to_regprocedure($1)::text v',[signature]),null,'old unbound write overload must not exist');
 const beforePlatformMaintenance=await q('select * from public.registration_events order by id');
 await db.exec('begin');
 try {
   const edited=await q("update public.registration_events set actor_label=actor_label || ' isolated platform maintenance' where id=(select min(id) from public.registration_events) returning id");
   assert.equal(edited.length,1,'trusted database owner can maintain logs outside website roles');
 } finally { await db.exec('rollback'); }
 assert.deepEqual(await q('select * from public.registration_events order by id'),beforePlatformMaintenance);
 assert.equal(await v('select v from chuanheng.sentinel'),'untouched');
 assert.ok((await q("select prosecdef from pg_proc where pronamespace='public'::regnamespace")).every(x=>!x.prosecdef));
 }finally{await db.close();}
});
