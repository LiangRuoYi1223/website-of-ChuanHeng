import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
const engine=process.env.SQL_TEST_ENGINE==='pg17'?'pglite-pg17':'@electric-sql/pglite';
const {PGlite}=await import(new URL(`../artifacts/sql-validation/node_modules/${engine}/dist/index.js`,import.meta.url));
test('scheduler authentication uses a protected service-only boolean check and rejects missing/duplicate secrets',async()=>{
 const db=new PGlite();
 const token='00000000-0000-4000-8000-00000000000800000000-0000-4000-8000-000000000009';
 try{
  await db.exec('create role anon;create role authenticated;create role service_role;create schema private;grant usage on schema private to service_role;create schema vault;create table vault.secrets(name text,decrypted_secret text);create view vault.decrypted_secrets as select * from vault.secrets;');
  await db.exec(await readFile(new URL('../supabase/migrations/20261101050040_activity_cleanup_schedule.sql',import.meta.url),'utf8'));
  const check=async value=>(await db.query('select public.authorize_activity_cleanup_wake($1) as valid',[value])).rows[0].valid;
  await db.exec('set role service_role');assert.equal(await check(token),false);await db.exec('reset role');
  await db.query('insert into vault.secrets values($1,$2)',['activity_cleanup_wake_token',token]);
  await db.exec('set role service_role');assert.equal(await check(token),true);assert.equal(await check(token.replace(/9$/,'7')),false);assert.equal(await check('anything'),false);await db.exec('reset role');
  for(const role of ['anon','authenticated']){await db.exec(`set role ${role}`);await assert.rejects(()=>check(token),/permission denied/);await db.exec('reset role');}
  await db.query('insert into vault.secrets values($1,$2)',['activity_cleanup_wake_token',token]);
  await db.exec('set role service_role');assert.equal(await check(token),false);await db.exec('reset role');
  const wrapper=(await db.query("select prosecdef from pg_proc where oid='public.authorize_activity_cleanup_wake(text)'::regprocedure")).rows[0];assert.equal(wrapper.prosecdef,false);
 }finally{await db.close();}
});
