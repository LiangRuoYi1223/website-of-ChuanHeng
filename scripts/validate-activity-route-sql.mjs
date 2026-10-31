import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { before, after, beforeEach, afterEach, test } from 'node:test';

// Isolated PostgreSQL only: never reads cloud credentials or connects to Supabase.
const engine = process.env.SQL_TEST_ENGINE || 'pg18';
const engines = { pg18: '@electric-sql/pglite', pg17: 'pglite-pg17' };
assert.ok(engines[engine]);
const { PGlite } = await import(new URL(`../artifacts/sql-validation/node_modules/${engines[engine]}/dist/index.js`, import.meta.url));
const root = new URL('../', import.meta.url);
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const admin = { sub: uuid(900), app_metadata: { role: 'admin' } };
const member = { sub: uuid(901), app_metadata: {} };
const track = { stats: { distanceM: 2300, ascentM: null }, geojson: { type: 'Feature', geometry: { type: 'MultiLineString', coordinates: [[[114,22,null],[115,23,null]]] } } };
const route = n => ({ id: uuid(n), kind: 'route', published: false, payload: { title: '路线', track, distance: 2.3, ascent: null, trackLocalId: 'never cloud', coordinates: [114,22] } });
const activity = (n, payload = {}, published = false) => ({ id: uuid(n), kind: 'activity', payload: { title: '活动', ...payload }, published });
let db;
const q = async (sql, args = []) => (await db.query(sql,args)).rows;
const val = async (sql, args) => (await q(sql,args))[0]?.value;
const get = async n => (await q('select * from public.content_items where id=$1',[typeof n === 'number' ? uuid(n) : n]))[0];
const insert = async row => q('insert into public.content_items(id,kind,payload,published) values($1,$2,$3,$4)',[row.id,row.kind,row.payload,row.published]);
const save = row => val('select public.save_activity_with_route($1) as value',[row]);
const edit = (row, payload = {}, published = row.published) => ({ ...row, payload: { ...row.payload, ...payload }, published, expected: { payload: row.payload, published: row.published } });
async function identity(jwt, run, role = 'authenticated') {
  await db.exec(`set local role ${role}`);
  await q("select set_config('request.jwt.claims',$1,true)",[JSON.stringify(jwt)]);
  try { return await run(); } finally { await db.exec('reset role'); }
}
async function fails(run, pattern = /./) {
  await db.exec('savepoint rejected');
  let error;
  try { await run(); await db.exec('set constraints all immediate'); } catch (e) { error = e; }
  await db.exec('rollback to savepoint rejected; release savepoint rejected');
  assert.ok(error,'operation must reject');
  assert.match(error.message, pattern);
}
before(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth;
    grant usage on schema auth,public to anon,authenticated;
    create table auth.users(id uuid primary key);
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb) $$;
    create function auth.uid() returns uuid language sql stable as $$ select (auth.jwt()->>'sub')::uuid $$;
    create schema chuanheng; create table chuanheng.sentinel(value text); insert into chuanheng.sentinel values ('private untouched');
    create schema storage; grant usage on schema storage to anon,authenticated;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text);
    create function storage.foldername(name text) returns text[] language sql immutable as $$ select (string_to_array(name,'/'))[1:array_length(string_to_array(name,'/'),1)-1] $$;
    alter table storage.objects enable row level security;
    grant select,insert,update,delete on storage.objects to anon,authenticated;`);
  const files = (await readdir(new URL('supabase/migrations/',root))).filter(f=>f.endsWith('.sql')).sort();
  assert.ok(files.length >= 3, 'new CLI-generated migration must exist');
  await db.exec(await readFile(new URL(`supabase/migrations/${files[0]}`,root),'utf8'));
  // Existing public data must survive installation byte-for-byte, too.
  await insert(activity(800,{ track, dateStart: 'old date', registrationOpen: true, registrationDeadline: 'bad date' },true));
  for(const n of [801,802]) {
    const native={...track,stats:{distanceM:1000,ascentM:null},geojson:{type:'Feature',geometry:{type:'MultiLineString',coordinates:[[[101,25,null],[101.01,25.01,null]]]}}};
    if(n===801) native.location={coordinates:[101,25],province:'来源A省',city:'来源A市',locations:[{province:'来源A省',city:'来源A市'}],locationStatus:'matched'};
    await insert(activity(n,{track:native,distance:1,ascent:null,coordinates:[101,25],province:'来源A省',city:'来源A市',location:'来源A市',dateStart:'2020-01-01T00:00:00Z'}));
  }
  for(const n of [803,804,805]) {
    const native={...track,stats:{distanceM:null,ascentM:null}};
    if(n!==803) native.manualMetrics={source:n===804?'administrator':'untrusted',confirmedAt:'2026-10-31T10:00:00Z',distanceM:1200,ascentM:0};
    await insert(activity(n,{track:native,distance:999,ascent:999}));
  }
  // Opaque historical snapshot must not be normalized by a later migration.
  await insert(activity(806,{routeSnapshot:{track:{stats:{distanceM:null}},distance:null,ascent:null,selectedAt:'old'}}));
  const before = await get(800);
  const historicalSnapshot=await get(806);
  let oldBucket, oldPolicies, oldObject;
  for (const file of files.slice(1)) {
    try { await db.exec(await readFile(new URL(`supabase/migrations/${file}`,root),'utf8')); }
    catch (error) { throw new Error(`${file}: ${error.code}: ${error.message}; position=${error.position}; context=${error.where || ''}`); }
    if(file.includes('_activity_route_scheduling.sql')) {
      await q("insert into storage.objects(bucket_id,name) values('activity-covers','historical/keep-original.webp')");
      oldObject=await q('select * from storage.objects');
      oldBucket=(await q("select * from storage.buckets where id='activity-covers'"))[0];
      oldPolicies=await q("select * from pg_policies where schemaname='storage' order by policyname");
    }
  }
  assert.deepEqual(await get(800),before);
  assert.deepEqual(await get(806),historicalSnapshot);
  assert.deepEqual(await q('select * from storage.objects'),oldObject);
  assert.deepEqual((await q("select * from storage.buckets where id='activity-covers'"))[0],{...oldBucket,file_size_limit:3145728});
  assert.deepEqual(await q("select * from pg_policies where schemaname='storage' order by policyname"),oldPolicies);
  // Remove this isolated fixture after proving the migration preserved it.
  await q("delete from storage.objects where name='historical/keep-original.webp'");
  await q('insert into auth.users values($1),($2)',[admin.sub,member.sub]);
  console.log('Isolated engine:', await val('select version() as value'));
});
after(async () => db?.close());
beforeEach(async () => db.exec('begin'));
afterEach(async () => db.exec('rollback'));

test('migration preserves legacy and privileges; old RPC retired',async()=>{
  assert.equal(await val('select value from chuanheng.sentinel'),'private untouched');
  assert.equal(await val("select has_function_privilege('authenticated','public.save_activity_with_track(jsonb)','EXECUTE') as value"),false);
  assert.equal(await val("select has_function_privilege('anon','public.save_activity_with_route(jsonb)','EXECUTE') as value"),false);
  assert.ok((await q("select prosecdef from pg_proc where pronamespace='public'::regnamespace")).every(r=>!r.prosecdef));
});
test('selection snapshot whitelist, reused routes and no route writes',async()=>identity(admin,async()=>{
  const r=route(1); await insert(r); const before=await get(1);
  for(const n of [2,3]) {
    const result=await save({...activity(n,{routeId:r.id,routeSnapshot:{evil:true}}),routeExpectedPayload:r.payload});
    assert.equal(result.route.id,r.id);
    assert.deepEqual(result.activity.payload.routeSnapshot.track,track);
    assert.equal(result.activity.payload.routeSnapshot.trackLocalId,undefined);
    assert.equal(result.activity.payload.routeSnapshot.evil,undefined);
    assert.equal(result.activity.payload.track,undefined);
  }
  assert.deepEqual(await get(1),before);
}));
test('same route freezes snapshot; stale expected activity and route fail',async()=>identity(admin,async()=>{
  const r=route(1); await insert(r);
  const a=(await save({...activity(2,{routeId:r.id}),routeExpectedPayload:r.payload})).activity;
  await q("update public.content_items set payload=payload || '{\"distance\":9}' where id=$1",[r.id]);
  const b=(await save(edit(a,{description:'new'}))).activity;
  assert.deepEqual(b.payload.routeSnapshot,a.payload.routeSnapshot);
  await fails(()=>save(edit(a,{description:'stale'})),/STALE/);
  await fails(()=>save({...activity(3,{routeId:r.id}),routeExpectedPayload:r.payload}),/STALE/);
  await fails(()=>save({...b,expected:undefined}),/EXPECTED/);
}));
test('legacy own track immutable; new own tracks and direct forged snapshots reject',async()=>identity(admin,async()=>{
  await fails(()=>save(activity(1,{track})),/TRACK/);
  await fails(()=>insert(activity(2,{track})),/TRACK/);
  const a=await get(800);
  const saved=(await save(edit(a,{description:'keep legacy',registrationOpen:false}))).activity;
  assert.deepEqual(saved.payload.track,a.payload.track);
  await fails(()=>save(edit(saved,{track:{}})),/TRACK/);
  await fails(()=>q("update public.content_items set payload=payload || '{\"routeSnapshot\":{}}' where id=$1",[a.id]),/SNAPSHOT/);
}));
test('references reject missing archived demo and wrong kind; direct DML cannot delete or archive linked route',async()=>identity(admin,async()=>{
  const r=route(1); await insert(r);
  await save({...activity(2,{routeId:r.id}),routeExpectedPayload:r.payload});
  await fails(()=>q('delete from public.content_items where id=$1',[r.id]),/IN_USE/);
  await fails(()=>q("update public.content_items set payload=payload || '{\"archived\":true}' where id=$1",[r.id]),/ROUTE|IN_USE/);
  await fails(()=>save({...activity(3,{routeId:uuid(99)}),routeExpectedPayload:{}}),/ROUTE/);
  for(const patch of [{archived:true},{isDemo:true}]) {
    await insert({...route(4),payload:{...r.payload,...patch}});
    await fails(()=>save({...activity(3,{routeId:uuid(4)}),routeExpectedPayload:{...r.payload,...patch}}),/ROUTE/);
    await q('delete from public.content_items where id=$1',[uuid(4)]);
  }
}));
test('audited dedup keeps snapshots and old geometry; delete RPC no longer uses old save',async()=>identity(admin,async()=>{
  for(const n of [1,2]) await insert(route(n));
  const r=await get(2); const a=(await save({...activity(3,{routeId:r.id}),routeExpectedPayload:r.payload})).activity;
  await val('select public.resolve_route_duplicates($1,$2) as value',[[uuid(1),uuid(2)],uuid(1)]);
  await db.exec('set constraints all immediate');
  assert.equal((await get(3)).payload.routeId,uuid(1));
  assert.deepEqual((await get(3)).payload.routeSnapshot,a.payload.routeSnapshot);
  assert.deepEqual((await get(2)).payload.track,track);
  await val('select public.delete_content_with_links($1) as value',[uuid(3)]);
  assert.equal(await get(3),undefined);
}));
test('schedule validation permits closed history and drafts, rejects partial publication and bad ISO',async()=>identity(admin,async()=>{
  await save(activity(1));
  await fails(()=>save(activity(2,{},true)),/SCHEDULE/);
  const dates={dateStart:'2020-01-02T10:00:00Z',dateEnd:'2020-01-02T11:00:00Z',registrationStart:'2020-01-01T09:00:00Z',registrationDeadline:'2020-01-02T10:00:00Z',registrationOpen:true};
  const a=(await save(activity(3,dates,true))).activity;
  await save(edit(a,{registrationOpen:false}));
  for(const patch of [{dateEnd:dates.dateStart},{registrationStart:dates.registrationDeadline},{dateStart:'2020-01-02'},{dateEnd:'infinity'},{dateEnd:'2020-02-31T12:00:00Z'},{registrationStart:null}]) await fails(()=>save(activity(4,{...dates,...patch},true)),/SCHEDULE/);
}));
test('registration server clock enforces exact open inclusive deadline/start/end exclusive; malformed legacy fails closed',async()=>{
  const now=await val('select now() as value'); const t=new Date(now).getTime(); const iso=delta=>new Date(t+delta).toISOString();
  const dates={registrationOpen:true,registrationStart:iso(-1000),registrationDeadline:iso(1000),dateStart:iso(2000),dateEnd:iso(3000)};
  const patches=[{}, {registrationStart:iso(0)}, {registrationStart:iso(1)}, {registrationDeadline:iso(0)}, {dateStart:iso(0)}, {dateEnd:iso(0)}];
  // Fixtures intentionally bypass only our trigger to exercise RLS against historical bad rows.
  await db.exec('alter table public.content_items disable trigger user');
  for(let n=0;n<patches.length;n++) await insert(activity(n+1,{...dates,...patches[n]},true));
  await db.exec('alter table public.content_items enable trigger user');
  await identity(member,async()=>{
    for(const n of [1,2]) await q('insert into public.applications(activity_id) values($1)',[uuid(n)]);
    for(const n of [3,4,5,6,800]) await fails(()=>q('insert into public.applications(activity_id) values($1)',[uuid(n)]),/row-level security/);
  });
});
test('members and user_metadata cannot save; anon no RPC access',async()=>{
  for(const jwt of [member,{...member,user_metadata:{role:'admin'}},{app_metadata:{role:'admin'}}]) await identity(jwt,async()=>fails(()=>save(activity(1)),/administrator/i));
  await identity({},async()=>fails(()=>save(activity(1)),/permission/),'anon');
});

test('changing selection refreshes once; clearing removes snapshot but preserves legacy own-track',async()=>identity(admin,async()=>{
  for(const n of [1,2]) await insert({...route(n),payload:{...route(n).payload,title:`路线 ${n}`}});
  const r=await get(1), next=await get(2);
  const a=(await save({...activity(3,{routeId:r.id}),routeExpectedPayload:r.payload})).activity;
  await fails(()=>save(edit(a,{routeId:next.id})),/EXPECTED_ROUTE/);
  const b=(await save({...edit(a,{routeId:next.id}),routeExpectedPayload:next.payload})).activity;
  assert.equal(b.payload.routeSnapshot.sourceRouteId,next.id);
  assert.equal(b.payload.routeSnapshot.title,'路线 2');
  const c=(await save(edit(b,{routeId:''}))).activity;
  assert.equal(c.payload.routeSnapshot,undefined);
  assert.equal(c.payload.distance,undefined);
  assert.equal(c.payload.includeFootprint,false);
  assert.equal((await get(1)).payload.title,'路线 1');
  const legacy=await get(800);
  const selected=(await save({...edit(legacy,{routeId:r.id}),routeExpectedPayload:r.payload})).activity;
  assert.deepEqual(selected.payload.track,legacy.payload.track);
  const cleared=(await save(edit(selected,{routeId:''}))).activity;
  assert.deepEqual(cleared.payload.track,legacy.payload.track);
  assert.equal(cleared.payload.routeSnapshot,undefined);
}));

test('direct writes cannot change existing snapshot, identity/kind, or forge own-track on no-route activity',async()=>identity(admin,async()=>{
  const r=route(1);await insert(r);
  const a=(await save({...activity(2,{routeId:r.id}),routeExpectedPayload:r.payload})).activity;
  await fails(()=>q("update public.content_items set payload=jsonb_set(payload,'{routeSnapshot,title}','\"forged\"') where id=$1",[a.id]),/SNAPSHOT/);
  await fails(()=>q("update public.content_items set kind='photo' where id=$1",[r.id]),/IMMUTABLE/);
  await fails(()=>q('update public.content_items set id=$2 where id=$1',[r.id,uuid(8)]),/IMMUTABLE/);
  await fails(()=>q("update public.content_items set payload=payload || '{\"trackLocalId\":\"browser-only\"}' where id=$1",[a.id]),/TRACK/);
  const plain=(await save(activity(3,{coordinates:[114,22],distance:50,includeFootprint:true,footprintEligible:true}))).activity;
  assert.equal(plain.payload.coordinates,undefined);
  assert.equal(plain.payload.footprintEligible,false);
}));

test('invalid selected route geometry and local-only cloud route rejected without activity writes',async()=>identity(admin,async()=>{
  const candidates=[{track:null,trackLocalId:'browser'}, {track:{...track,stats:{distanceM:-1}}}, {track:{...track,geojson:{geometry:{type:'MultiLineString',coordinates:[[[181,22],[114,22]]]}}}}, {track:{...track,geojson:{geometry:{type:'MultiLineString',coordinates:[[[114,22]]]}}}}];
  for(const patch of candidates){
    const r={...route(1),payload:{...route(1).payload,...patch}}; await insert(r);
    await fails(()=>save({...activity(2,{routeId:r.id}),routeExpectedPayload:r.payload}),/TRACK/);
    assert.equal(await get(2),undefined);
    await q('delete from public.content_items where id=$1',[r.id]);
  }
}));

test('RPC failures after trigger do not partially modify activity or route',async()=>identity(admin,async()=>{
  const r=route(1);await insert(r);
  const a=(await save({...activity(2,{routeId:r.id}),routeExpectedPayload:r.payload})).activity;
  const before=await q('select * from public.content_items order by id');
  await fails(()=>save(edit(a,{dateStart:'not a date'})),/SCHEDULE/);
  assert.deepEqual(await q('select * from public.content_items order by id'),before);
}));

test('activity deletion with application FK rejects atomically and retains automatic route',async()=>{
  const base=new Date().getTime(), iso=delta=>new Date(base+delta).toISOString();
  let a;
  await identity(admin,async()=>{
    const r={...route(1),payload:{...route(1).payload,generatedFromActivityId:uuid(2)}};await insert(r);
    a=(await save({...activity(2,{routeId:r.id,registrationOpen:true,registrationStart:iso(-60000),registrationDeadline:iso(60000),dateStart:iso(120000),dateEnd:iso(180000)},true),routeExpectedPayload:r.payload})).activity;
  });
  await identity(member,async()=>q('insert into public.applications(activity_id) values($1)',[a.id]));
  const before=await q('select * from public.content_items order by id');
  await identity(admin,async()=>fails(()=>val('select public.delete_content_with_links($1) as value',[a.id]),/foreign key/));
  assert.deepEqual(await q('select * from public.content_items order by id'),before);
});

test('safe ISO parser rejects all malformed and non-ISO values without exceptions',async()=>{
  for(const input of [null,'','yesterday','infinity','2026-02-31T10:00:00Z','2026-01-01','2026-01-01T10:00:00','2026-01-01T10:00:00+99:00']) assert.equal(await val('select public.activity_iso_time($1) as value',[input]),null);
  assert.ok(await val('select public.activity_iso_time($1) as value',['2026-01-01T10:00:00+08:00']));
});

test('late SQL constraint rolls activity back without route writes',async()=>{
  await db.exec("alter table public.content_items add constraint reject_activity_title check (payload->>'title'<>'拒绝')");
  await identity(admin,async()=>{
    const r=route(1);await insert(r);
    const a=(await save({...activity(2,{routeId:r.id}),routeExpectedPayload:r.payload})).activity;
    const before=await q('select * from public.content_items order by id');
    await fails(()=>save(edit(a,{title:'拒绝'})),/reject_activity_title/);
    assert.deepEqual(await q('select * from public.content_items order by id'),before);
  });
});

test('activity covers bucket restricts uploads and own metadata to verified admin UUID folder',async()=>{
  const bucket=(await q("select * from storage.buckets where id='activity-covers'"))[0];
  assert.equal(bucket.public,true);assert.equal(Number(bucket.file_size_limit),3145728);
  assert.deepEqual(bucket.allowed_mime_types,['image/jpeg','image/png','image/webp']);
  const upload=name=>q("insert into storage.objects(bucket_id,name) values('activity-covers',$1)",[name]);
  await identity(admin,async()=>{
    await upload(`${admin.sub}/cover.webp`);
    await fails(()=>upload(`${member.sub}/forged.webp`),/row-level security/);
    await fails(()=>upload('cover.webp'),/row-level security/);
    assert.equal((await q('select * from storage.objects')).length,1);
    assert.equal((await q("update storage.objects set name='changed' returning id")).length,0);
    assert.equal((await q('delete from storage.objects returning id')).length,0);
  });
  for(const jwt of [member,{...member,user_metadata:{role:'admin'}}]) await identity(jwt,async()=>{
    await fails(()=>upload(`${jwt.sub}/cover.webp`),/row-level security/);
    assert.equal((await q('select * from storage.objects')).length,0);
  });
  await identity({},async()=>{
    await fails(()=>upload(`${admin.sub}/cover.webp`),/row-level security/);
    assert.equal((await q('select * from storage.objects')).length,0);
  },'anon');
});

test('cover restrictions survive pre-existing broad permissive Storage policies and leave other buckets alone',async()=>{
  await db.exec(`create policy old_broad_storage_policy on storage.objects for all to anon,authenticated using(true) with check(true);
    insert into storage.buckets(id,name,public) values('other','other',false);`);
  await identity(admin,async()=>{
    await q("insert into storage.objects(bucket_id,name) values('activity-covers',$1)",[`${admin.sub}/cover.jpg`]);
    assert.equal((await q("update storage.objects set name='overwrite.jpg' where bucket_id='activity-covers' returning id")).length,0);
    assert.equal((await q("delete from storage.objects where bucket_id='activity-covers' returning id")).length,0);
  });
  await identity(member,async()=>{
    await fails(()=>q("insert into storage.objects(bucket_id,name) values('activity-covers',$1)",[`${member.sub}/cover.jpg`]),/row-level security/);
    assert.equal((await q("select * from storage.objects where bucket_id='activity-covers'")).length,0);
    await q("insert into storage.objects(bucket_id,name) values('other','allowed-by-old-policy.jpg')");
    assert.equal((await q("delete from storage.objects where bucket_id='other' returning id")).length,1);
  });
});

test('legacy publication can be cancelled and draft metadata edited; first draft publication needs new range',async()=>identity(admin,async()=>{
  let a=await get(800);
  a=(await save(edit(a,{description:'legacy metadata'}))).activity;
  a=(await save(edit(a,{},false))).activity;
  a=(await save(edit(a,{description:'draft metadata'}))).activity;
  assert.equal(a.payload.dateStart,'old date');
  await fails(()=>save(edit(a,{},true)),/SCHEDULE/);
}));

test('out-of-band archived or missing route is rechecked even when selection stays the same',async()=>{
  let a;
  await identity(admin,async()=>{
    const r=route(1);await insert(r);
    a=(await save({...activity(2,{routeId:r.id}),routeExpectedPayload:r.payload})).activity;
  });
  await db.exec('set constraints all immediate');
  await db.exec('alter table public.content_items disable trigger user');
  await q("update public.content_items set payload=payload || '{\"archived\":true}' where id=$1",[uuid(1)]);
  await db.exec('alter table public.content_items enable trigger user');
  await identity(admin,async()=>fails(()=>save(edit(a,{description:'cannot retain dangling'})),/ROUTE_UNAVAILABLE/));
  await db.exec('alter table public.content_items disable trigger user');
  await q('delete from public.content_items where id=$1',[uuid(1)]);
  await db.exec('alter table public.content_items enable trigger user');
  await identity(admin,async()=>fails(()=>save(edit(a,{description:'cannot retain missing'})),/ROUTE_UNAVAILABLE/));
});

test('stale edits cannot resurrect deleted activity, with changed route or without route',async()=>identity(admin,async()=>{
  for(const n of [1,2]) await insert(route(n));
  const r=await get(1),other=await get(2);
  const routed=(await save({...activity(3,{routeId:r.id}),routeExpectedPayload:r.payload})).activity;
  const plain=(await save(activity(4))).activity;
  for(const a of [routed,plain]) await val('select public.delete_content_with_links($1) as value',[a.id]);
  const before=await q('select * from public.content_items order by id');
  await fails(()=>save({...edit(routed,{routeId:other.id}),routeExpectedPayload:other.payload}),/STALE_ACTIVITY/);
  await fails(()=>save(edit(plain,{description:'stale browser tab'})),/STALE_ACTIVITY/);
  assert.deepEqual(await q('select * from public.content_items order by id'),before);
  assert.equal((await save({...activity(5),expected:null})).activity.id,uuid(5));
}));

test('clearing selected snapshot rederives legacy 1km source A instead of retaining 9km source B',async()=>identity(admin,async()=>{
  const r={...route(1),payload:{...route(1).payload,track:{...track,stats:{distanceM:9000,ascentM:900}},coordinates:[120,30],province:'来源B省',city:'来源B市',location:'来源B市',provinceCode:'B',cityCode:'BB',locations:[{province:'来源B省',city:'来源B市'}],locationStatus:'matched'}};
  await insert(r);
  for(const n of [801,802]) {
    const old=await get(n);
    const selected=(await save({...edit(old,{routeId:r.id}),routeExpectedPayload:r.payload})).activity;
    assert.equal(selected.payload.distance,9);
    assert.equal(selected.payload.city,'来源B市');
    const cleared=(await save(edit(selected,{routeId:''}))).activity;
    assert.deepEqual(cleared.payload.track,old.payload.track);
    assert.equal(cleared.payload.routeSnapshot,undefined);
    assert.equal(cleared.payload.distance,1);
    assert.equal(cleared.payload.ascent,null);
    assert.deepEqual(cleared.payload.coordinates,[101,25]);
    assert.equal(cleared.payload.city,n===801?'来源A市':undefined);
    assert.equal(cleared.payload.province,n===801?'来源A省':undefined);
    assert.equal(cleared.payload.cityCode,undefined);
    assert.equal(cleared.payload.provinceCode,undefined);
    assert.ok(!JSON.stringify(cleared.payload).includes('来源B'));
  }
}));


const manual = (values={}) => ({source:'administrator',confirmedAt:'2026-10-31T12:00:00.000Z',...values});
test('manual metrics fill missing raw only, preserve raw and source in frozen snapshots',async()=>identity(admin,async()=>{
  const t={...track,stats:{distanceM:null,ascentM:null},manualMetrics:manual({distanceM:0,ascentM:120})};
  const r={...route(10),payload:{...route(10).payload,track:t,distance:999,ascent:999}};await insert(r);
  const a=(await save({...activity(11,{routeId:r.id}),routeExpectedPayload:r.payload})).activity;
  assert.equal(a.payload.distance,0);assert.equal(a.payload.ascent,120);
  assert.deepEqual(a.payload.routeSnapshot.track,t);
  assert.deepEqual(a.payload.routeSnapshot.metricSources,{distance:'administrator',ascent:'administrator'});
  await q("update public.content_items set payload=jsonb_set(payload,'{track,manualMetrics,ascentM}','200') where id=$1",[r.id]);
  const unchanged=(await save(edit(a,{description:'history'}))).activity;
  assert.deepEqual(unchanged.payload.routeSnapshot,a.payload.routeSnapshot);
  const current=await get(10);const b=(await save({...activity(12,{routeId:r.id}),routeExpectedPayload:current.payload})).activity;
  assert.equal(b.payload.ascent,200);assert.equal(b.payload.routeSnapshot.track.stats.ascentM,null);
}));

test('unknown metrics remain null and raw zero has track provenance',async()=>identity(admin,async()=>{
  for(const [n,stats] of [[10,{distanceM:null,ascentM:null}],[20,{distanceM:0,ascentM:0}]]) {
    const r={...route(n),payload:{...route(n).payload,track:{...track,stats}}};await insert(r);
    const a=(await save({...activity(n+1,{routeId:r.id}),routeExpectedPayload:r.payload})).activity;
    assert.equal(a.payload.distance,n===10?null:0);assert.equal(a.payload.ascent,n===10?null:0);
    assert.deepEqual(a.payload.routeSnapshot.metricSources,{distance:n===10?'unavailable':'track',ascent:n===10?'unavailable':'track'});
  }
}));

test('direct route DML rejects manual overrides and malformed metadata or metrics',async()=>identity(admin,async()=>{
  const invalid=[manual({distanceM:1}),manual({ascentM:-1}),manual({ascentM:'NaN'}),manual({ascentM:'Infinity'}),manual({ascentM:'1'}),manual({ascentM:true}),manual({ascentM:{}}),manual({ascentM:[]}),manual({source:'user',ascentM:1}),manual({confirmedAt:'invalid',ascentM:1}),manual({confirmedAt:'2026-10-31',ascentM:1}),manual({confirmedAt:'2026-02-31T10:00:00Z',ascentM:1}),manual({confirmedAt:null,ascentM:1}),{ascentM:1},[],false];
  for(const m of invalid) {
    const r={...route(10),payload:{...route(10).payload,track:{...track,manualMetrics:m}}};
    await fails(()=>insert(r),/MANUAL/);
  }
  const enormous='{"stats":{},"manualMetrics":{"source":"administrator","confirmedAt":"2026-10-31T10:00:00Z","distanceM":1e400}}';
  await fails(()=>q("insert into public.content_items(id,kind,payload) values($1,'route',jsonb_build_object('track',$2::jsonb))",[uuid(10),enormous]),/MANUAL/);
  await insert(route(10));
  await fails(()=>q("update public.content_items set payload=jsonb_set(payload,'{track,manualMetrics}',$2) where id=$1",[uuid(10),manual({distanceM:0})]),/MANUAL/);
}));

test('metric helper enforces raw priority and invalid manual validation consistently',async()=>{
  const resolved=await val('select public.resolve_route_track_metrics($1) as value',[{stats:{distanceM:2300,ascentM:null},manualMetrics:manual({ascentM:0})}]);
  assert.deepEqual(resolved,{distanceM:2300,ascentM:0,sources:{distance:'track',ascent:'administrator'}});
  for(const bad of ['1',-1,true,'NaN','Infinity']) await fails(()=>val('select public.resolve_route_track_metrics($1) as value',[{stats:{},manualMetrics:manual({distanceM:bad})}]),/MANUAL/);
});


test('clearing selection restores only legal legacy raw or manual metrics, never snapshot values or fabricated zero',async()=>identity(admin,async()=>{
  const r=route(10);await insert(r);
  for(const n of [803,804,805]) {
    const old=await get(n);
    const selected=(await save({...edit(old,{routeId:r.id}),routeExpectedPayload:r.payload})).activity;
    const cleared=(await save(edit(selected,{routeId:''}))).activity;
    assert.deepEqual(cleared.payload.track,old.payload.track);
    assert.equal(cleared.payload.distance,n===804?1.2:null);
    assert.equal(cleared.payload.ascent,n===804?0:null);
    assert.deepEqual(cleared.payload.metricSources,{distance:n===804?'administrator':'unavailable',ascent:n===804?'administrator':'unavailable'});
  }
}));
