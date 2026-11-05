import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {before,after,beforeEach,afterEach,test} from 'node:test';

// Isolated Postgres only: this script never connects to the production project.
const {PGlite}=await import(new URL('../artifacts/sql-validation/node_modules/@electric-sql/pglite/dist/index.js',import.meta.url));
const root=new URL('../',import.meta.url),id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const config=(count=4)=>({heroSlides:Array.from({length:count},(_,i)=>({id:`slide-${i}`,url:`https://images.example.invalid/${i}.webp`,alt:`合成图片 ${i}`,credit:'本地 SQL 测试'})),slots:{activitiesHero:{url:'/images/redesign-v2/activities-snow.webp',alt:'示意雪山',credit:'AI 视觉示意'}}});
let db;
const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
const value=async(sql,args=[])=>(await q(sql,args))[0]?.v;
const rpc=(name,args=[])=>value(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) v`,args);
async function as(n,run,{role='authenticated',claims={}}={}){
 await db.exec(`set local role ${role}`);
 await q("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({...n?{sub:id(n)}:{},...claims})]);
 await db.exec('savepoint identity_call');
 try{const result=await run();await db.exec('release savepoint identity_call');return result;}
 catch(error){await db.exec('rollback to savepoint identity_call;release savepoint identity_call');throw error;}
 finally{await db.exec('reset role');}
}
const admin=run=>as(900,run,{claims:{app_metadata:{role:'admin'}}});
const save=(next,version=null,user=id(900))=>admin(()=>rpc('save_site_images',[next,version,user]));

before(async()=>{
 db=new PGlite();
 await db.exec(`create role anon;create role authenticated;
 create schema auth;create schema private;grant usage on schema auth,public,private to anon,authenticated;
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb,'{}'::jsonb)$$;
 create function auth.uid() returns uuid language sql stable as $$select (auth.jwt()->>'sub')::uuid$$;
 create schema chuanheng;create table chuanheng.sentinel(v text);insert into chuanheng.sentinel values('untouched');
 create table public.content_items(id uuid primary key,kind text,payload jsonb);
 insert into public.content_items values('00000000-0000-4000-8000-000000000001','activity','{"retained":"exact"}');`);
 const files=(await readdir(new URL('supabase/migrations/',root))).filter(name=>name.endsWith('_site_image_settings.sql'));
 assert.equal(files.length,1,'exactly one site image migration must exist');
 await db.exec(await readFile(new URL(`supabase/migrations/${files[0]}`,root),'utf8'));
});
after(async()=>db?.close());beforeEach(async()=>db.exec('begin'));afterEach(async()=>db.exec('rollback'));

test('public reads expose only image configuration; writes preserve unrelated schemas',async()=>{
 assert.deepEqual(await as(null,()=>rpc('get_site_images'),{role:'anon'}),{config:{},updatedAt:null});
 const next=config();const saved=await save(next);
 assert.deepEqual(saved.config,next);assert.ok(saved.updatedAt);
 assert.deepEqual(Object.keys(saved).sort(),['config','updatedAt']);
 assert.deepEqual(await as(null,()=>rpc('get_site_images'),{role:'anon'}),saved);
 assert.deepEqual(await as(1,()=>rpc('get_site_images')),saved);
 assert.equal(await value('select v from chuanheng.sentinel'), 'untouched');
 assert.deepEqual((await q('select payload from public.content_items'))[0].payload,{retained:'exact'});
});

test('anon, member, spoofed metadata, anonymous auth and wrong account cannot save',async()=>{
 for(const request of [
  ()=>as(null,()=>rpc('save_site_images',[config(),null,id(900)]),{role:'anon'}),
  ()=>as(1,()=>rpc('save_site_images',[config(),null,id(1)])),
  ()=>as(1,()=>rpc('save_site_images',[config(),null,id(1)]),{claims:{user_metadata:{role:'admin'}}}),
  ()=>as(900,()=>rpc('save_site_images',[config(),null,id(900)]),{claims:{app_metadata:{role:'admin'},is_anonymous:true}}),
  ()=>save(config(),null,id(1)),
  ()=>save(config(),null,null),
 ])await assert.rejects(request,/permission|AUTH|ADMIN/i);
 assert.deepEqual((await rpc('get_site_images')).config,{});
 assert.equal(await value('select count(*)::int v from private.site_image_settings_events'),0);
});

test('direct table mutation and audit access are unavailable even to administrators',async()=>{
 const requests=[
  ()=>q("update public.site_image_settings set config='{}'::jsonb"),
  ()=>q('delete from public.site_image_settings'),
  ()=>q('insert into public.site_image_settings(singleton) values(false)'),
  ()=>q('select * from private.site_image_settings_events'),
  ()=>q('delete from private.site_image_settings_events'),
  ()=>q("insert into private.site_image_settings_events(actor_id,before_config,after_config) values($1,'{}','{}')",[id(900)]),
 ];
 for(const request of requests)await assert.rejects(()=>admin(request),/permission denied/i);
 assert.equal(await value('select count(*)::int v from private.site_image_settings_events'),0);
});

test('CAS uses exact versions, changed saves advance time, no-ops do not append events',async()=>{
 const first=await save(config(1));
 const same=await save(config(1),first.updatedAt);assert.deepEqual(same,first);
 const second=await save(config(5),first.updatedAt);assert.notEqual(second.updatedAt,first.updatedAt);
 await assert.rejects(()=>save(config(2),first.updatedAt),error=>error.code==='40001');
 await assert.rejects(()=>save(config(2),null),error=>error.code==='40001');
 assert.deepEqual((await rpc('get_site_images')).config,config(5));
 const events=await q('select actor_id,before_config,after_config from private.site_image_settings_events order by id');
 assert.equal(events.length,2);assert.equal(events[0].actor_id,id(900));assert.deepEqual(events[0].before_config,{});assert.deepEqual(events[1].after_config,config(5));
});

test('configuration rejects empty slides, duplicates, invalid fields and unknown slots',async()=>{
 const cases=[null,{},[],{...config(),heroSlides:[]},{...config(),heroSlides:[config().heroSlides[0],config().heroSlides[0]]},{...config(),other:true},{...config(),slots:{unknown:{url:'/x.webp',alt:'x',credit:''}}}];
 for(const field of ['id','url','alt','credit']){const next=config(1);delete next.heroSlides[0][field];cases.push(next);}
 for(const [field,data]of [['id','x'.repeat(81)],['alt','x'.repeat(201)],['credit','x'.repeat(201)],['url','https://images.example.invalid/'+'x'.repeat(2048)]]){const next=config(1);next.heroSlides[0][field]=data;cases.push(next);}
 for(const next of cases)await assert.rejects(()=>save(next),/INVALID_SITE_IMAGES/);
 assert.deepEqual((await rpc('get_site_images')).config,{});
});

test('URL validation rejects ambiguous schemes, credentials, controls and protocol relative paths',async()=>{
 for(const url of ['javascript:alert(1)','data:image/png;base64,AAAA','http://example.invalid/a.webp','//example.invalid/a.webp','/\\example.invalid/a.webp','https://name:pass@example.invalid/a.webp','https://example.invalid\\@other.invalid/a.webp','https://example.invalid/a\n.webp',' /images/a.webp','https:///a.webp','https://']){
  const next=config(1);next.heroSlides[0].url=url;
  await assert.rejects(()=>save(next),/INVALID_SITE_IMAGES/,url);
 }
 for(const url of ['/images/a.webp','https://example.invalid/a.webp','https://example.invalid:8443/a.webp?size=2#part']){
  const next=config(1);next.heroSlides[0].url=url;
  const current=await rpc('get_site_images');assert.equal((await save(next,current.updatedAt)).config.heroSlides[0].url,url);
 }
});

test('all fixed slots and more than three slides are accepted; whole config has a byte ceiling',async()=>{
 const next=config(9),entry=next.slots.activitiesHero;
 const keys=['activitiesHero','routesHero','galleryHero','newsHero','aboutHero','footprintsHero','joinHero','loginBackground','homeAbout','homeKnowledge','homeJoin','aboutStory','joinStory','joinClosing','routeFallback','photoFallback','articleFallback','activityFallback'];
 next.slots=Object.fromEntries(keys.map(key=>[key,entry]));
 assert.deepEqual((await save(next)).config,next);
 const huge=config(1500),version=(await rpc('get_site_images')).updatedAt;await assert.rejects(()=>save(huge,version),/INVALID_SITE_IMAGES/);
});
