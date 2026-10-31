import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, afterEach, before, beforeEach, test } from 'node:test';

const engines = {
  pg18: '../artifacts/sql-validation/node_modules/@electric-sql/pglite/dist/index.js',
  pg17: '../artifacts/sql-validation/node_modules/pglite-pg17/dist/index.js',
};
const engine = process.env.SQL_TEST_ENGINE || 'pg18';
if (!Object.hasOwn(engines, engine)) throw new Error('SQL_TEST_ENGINE must be pg18 or pg17');
const { PGlite } = await import(new URL(engines[engine], import.meta.url));

// This suite never connects to Supabase. Only the supplied SQL is under test;
// Supabase's request-scoped auth helpers/roles and auth.users FK are local stubs.
const root = new URL('../', import.meta.url);
const adminId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const memberId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const otherId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const claims = (sub, role) => ({ sub, role: 'authenticated', app_metadata: role ? { role } : {}, user_metadata: {} });
const admin = claims(adminId, 'admin');
const member = claims(memberId, 'member');
const other = claims(otherId, 'member');
const track = (name = '雪山环线', distanceM = 2500) => ({ version: 1, name, stats: { distanceM, ascentM: null }, geojson: { type: 'Feature', geometry: { type: 'MultiLineString', coordinates: [[[114, 22, null], [114.01, 22.01, null]]] } } });
const activity = (n, payload = {}, published = false) => ({ id: id(n), kind: 'activity', payload: { title: `活动 ${n}`, track: track(), isDemo: false, ...payload }, published, created_at: '2026-10-31T03:00:00Z' });
let db;
const q = async (sql, args = []) => (await db.query(sql, args)).rows;
const value = async (sql, args = []) => (await q(sql, args))[0]?.value;
const rpc = async (name, args) => value(`select public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) as value`, args);
const record = async recordId => (await q('select * from public.content_items where id=$1', [recordId]))[0];
const save = record => rpc('save_activity_with_track', [record]);
const insert = async record => { await db.query('insert into public.content_items(id,kind,payload,published,created_at) values($1,$2,$3,$4,$5)', [record.id, record.kind, record.payload, record.published, record.created_at || '2026-10-31T03:00:00Z']); };
const snapshot = async () => q('select * from public.content_items order by id');

async function asIdentity(role, jwt, run) {
  assert.ok(['anon', 'authenticated'].includes(role));
  await db.exec(`set local role ${role}`);
  await db.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify(jwt)]);
  try { return await run(); } finally { await db.exec('reset role'); }
}

async function fails(run, code, message) {
  await db.exec('savepoint expected_failure');
  let caught;
  try { await run(); } catch (error) { caught = error; }
  finally { await db.exec('rollback to savepoint expected_failure; release savepoint expected_failure'); }
  assert.ok(caught, 'operation must fail, rather than silently succeed');
  if (code) assert.ok((Array.isArray(code) ? code : [code]).includes(caught.code), `expected SQLSTATE ${code}, got ${caught.code}: ${caught.message}`);
  if (message) assert.match(caught.message, message);
}

before(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    grant usage on schema auth,public to anon,authenticated;
    create table auth.users(id uuid primary key);
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
    $$;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(auth.jwt() ->> 'sub', '')::uuid
    $$;
    create schema chuanheng;
    create table chuanheng.legacy_sentinel(id integer primary key, value text not null);
    insert into chuanheng.legacy_sentinel values(1,'private data must survive');
  `);
  for (const filename of ['docs/supabase-schema.sql', 'docs/route-deduplication.sql']) {
    try { await db.exec(await readFile(new URL(filename, root), 'utf8')); }
    catch (error) { throw new Error(`${filename}: ${error.code}: ${error.message}; position=${error.position}; context=${error.where || ''}`); }
  }
  await db.query('insert into auth.users(id) values($1),($2),($3)', [adminId, memberId, otherId]);
  console.log('Isolated engine:', await value('select version() as value'));
});
beforeEach(async () => { await db.exec('begin'); });
afterEach(async () => { await db.exec('rollback'); });
after(async () => { await db?.close(); });

test('both SQL files install without touching a private legacy schema; grants and RLS apply to real roles', async () => {
  assert.equal(await value('select value from chuanheng.legacy_sentinel where id=1'), 'private data must survive');
  const tables = await q("select relname,relrowsecurity,relforcerowsecurity from pg_class where oid in ('public.content_items'::regclass,'public.applications'::regclass) order by relname");
  assert.equal(tables.length, 2);
  assert.ok(tables.every(row => row.relrowsecurity && row.relforcerowsecurity));
  const functions = await q("select proname,prosecdef,proconfig from pg_proc where pronamespace='public'::regnamespace and proname in ('route_title_key','save_activity_with_track','resolve_route_duplicates','delete_content_with_links')");
  assert.equal(functions.length, 4);
  assert.ok(functions.every(row => !row.prosecdef && row.proconfig.includes('search_path=pg_catalog, public')));
  assert.equal(await value("select has_table_privilege('anon','public.content_items','INSERT') as value"), false);
  assert.equal(await value("select has_table_privilege('authenticated','public.applications','UPDATE') as value"), false);
  for (const name of ['save_activity_with_track(jsonb)', 'resolve_route_duplicates(uuid[],uuid)', 'delete_content_with_links(uuid)']) {
    assert.equal(await value('select has_function_privilege($1,$2,$3) as value', ['anon', `public.${name}`, 'EXECUTE']), false);
    assert.equal(await value('select has_function_privilege($1,$2,$3) as value', ['authenticated', `public.${name}`, 'EXECUTE']), true);
  }
});

test('visitors only read published genuine active content and cannot read applications', async () => {
  for (const item of [activity(1, { track: undefined }, true), activity(2), activity(3, { isDemo: true }, true), activity(4, { archived: true }, true)]) await insert(item);
  await asIdentity('anon', {}, async () => {
    assert.deepEqual((await q('select id from public.content_items order by id')).map(row => row.id), [id(1)]);
    await fails(() => q('select * from public.applications'), '42501');
    await fails(() => insert(activity(9)), '42501');
    await fails(() => q('update public.content_items set published=false where id=$1', [id(1)]), '42501');
    await fails(() => q('delete from public.content_items where id=$1', [id(1)]), '42501');
    await fails(() => q('insert into public.applications(activity_id) values($1)', [id(1)]), '42501');
    await fails(() => save(activity(9)), '42501');
  });
});

test('members and forged user_metadata roles cannot write content or execute any administrator workflow', async () => {
  await insert(activity(1, {}, true));
  const forged = { ...member, user_metadata: { role: 'admin' } };
  for (const jwt of [member, claims(memberId, 'leader'), forged, { app_metadata: { role: 'admin' } }]) {
    await asIdentity('authenticated', jwt, async () => {
      await fails(() => insert(activity(2)), '42501');
      assert.equal((await db.query('update public.content_items set published=false where id=$1 returning id', [id(1)])).rows.length, 0);
      assert.equal((await db.query('delete from public.content_items where id=$1 returning id', [id(1)])).rows.length, 0);
      await fails(() => save(activity(2)), '42501');
      await fails(() => rpc('resolve_route_duplicates', [[id(1), id(2)], id(1)]), '42501');
      await fails(() => rpc('delete_content_with_links', [id(1)]), '42501');
    });
  }
  assert.equal((await snapshot()).length, 1);
});

test('applications allow only the owner and an open future genuine activity, and stay private', async () => {
  const future = new Date(Date.now() + 86400000).toISOString();
  const past = new Date(Date.now() - 86400000).toISOString();
  const open = { registrationOpen: true, registrationDeadline: future, status: '报名中', track: undefined };
  const candidates = [activity(1, open, true), activity(2, { ...open, isDemo: true }, true), activity(3, open, false), activity(4, { ...open, registrationOpen: false }, true), activity(5, { ...open, status: '已结束' }, true), activity(6, { ...open, registrationDeadline: past }, true), activity(7, { ...open, registrationDeadline: undefined }, true), activity(8, { ...open, archived: true }, true)];
  for (const item of candidates) await insert(item);
  await asIdentity('authenticated', member, async () => {
    await q('insert into public.applications(activity_id,payload) values($1,$2) returning id', [id(1), { message: 'my application' }]);
    assert.equal((await q('select * from public.applications')).length, 1);
    await fails(() => q('insert into public.applications(activity_id,user_id) values($1,$2)', [id(1), otherId]), '42501');
    for (let n = 2; n <= 8; n++) await fails(() => q('insert into public.applications(activity_id) values($1)', [id(n)]), '42501');
    await fails(() => q('insert into public.applications(activity_id) values($1)', [id(1)]), '23505');
  });
  await asIdentity('authenticated', other, async () => assert.equal((await q('select * from public.applications')).length, 0));
  await asIdentity('authenticated', admin, async () => assert.equal((await q('select * from public.applications')).length, 1));
});

test('admin saves atomically create one stable UUID route with actual file name, metrics and unknown altitude', async () => {
  await asIdentity('authenticated', admin, async () => {
    const first = await save(activity(1, { title: '第一次活动', track: track('  雪山环线  ') }, true));
    assert.match(first.route.id, /^[a-f0-9-]{36}$/);
    assert.equal(first.activity.payload.routeId, first.route.id);
    assert.equal(first.route.payload.title, '雪山环线');
    assert.equal(first.route.payload.distance, 2.5);
    assert.equal(first.route.payload.ascent, null);
    assert.equal(first.route.payload.verified, false);
    assert.equal(first.route.payload.isDemo, false);
    assert.equal(first.route.published, true);
    assert.deepEqual(first.route.payload.coordinates, [114, 22]);
    const second = await save(activity(1, { routeName: '  自定线路  ', track: track('File name', 7000) }));
    assert.equal(second.route.id, first.route.id);
    assert.equal(second.route.payload.title, '自定线路');
    assert.equal(second.route.payload.distance, 7);
    assert.equal(second.route.published, false);
    const fallback = await save(activity(2, { title: '活动兜底名', track: track('  ') }));
    assert.equal(fallback.route.payload.title, '活动兜底名');
    const summary = await save(activity(3, { track: track(''), trackSummary: { name: '摘要名称' } }));
    assert.equal(summary.route.payload.title, '摘要名称');
    assert.equal((await q("select * from public.content_items where kind='route'")).length, 3);
  });
});

test('invalid or local-only cloud inputs fail without partial activity or route writes', async () => {
  await asIdentity('authenticated', admin, async () => {
    for (const input of [activity(1, { track: undefined, trackLocalId: 'browser-only' }), activity(1, { track: { stats: { distanceM: -1 } } }), { ...activity(1), kind: 'photo' }, activity(1, { title: '' }), { ...activity(1), id: 'not-a-uuid' }]) {
      await fails(() => save(input), '22023');
      assert.equal((await snapshot()).length, 0);
    }
    await insert({ id: id(1), kind: 'photo', payload: { title: 'keep me' }, published: false });
    const before = await snapshot();
    await fails(() => save(activity(1)), '22023', /ID_CONFLICT/);
    assert.deepEqual(await snapshot(), before);
  });
});

test('a late activity table constraint failure rolls back an already attempted route write', async () => {
  await db.exec("alter table public.content_items add constraint local_test_reject_activity check (kind <> 'activity' or payload ->> 'title' <> 'Reject after route write')");
  await asIdentity('authenticated', admin, async () => {
    const first = await save(activity(1));
    const before = await snapshot();
    await fails(() => save(activity(1, { title: 'Reject after route write', track: track('new title', 99000) }, true)), '23514');
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual((await record(first.route.id)).payload.track, first.route.payload.track);
    await fails(() => save(activity(2, { title: 'Reject after route write' })), '23514');
    assert.deepEqual(await snapshot(), before, 'failed inserts leave no orphan route');
  });
});

test('full normalized duplicate group is rechecked; resolution retains tracks and redirects activity links', async () => {
  await asIdentity('authenticated', admin, async () => {
    const a = await save(activity(1, { track: track('  ＲＯＵＴＥ\u3000One  ') }));
    const b = await save(activity(2, { track: track('\ufeffroute\tONE\n', 9000) }));
    const c = await save(activity(3, { track: track('route one', 12000) }));
    const before = await snapshot();
    await fails(() => rpc('resolve_route_duplicates', [[a.route.id, b.route.id], a.route.id]), '22023', /STALE_DUPLICATE_GROUP/);
    assert.deepEqual(await snapshot(), before);
    const resolved = await rpc('resolve_route_duplicates', [[a.route.id, b.route.id, c.route.id], a.route.id]);
    assert.equal(resolved.winnerId, a.route.id);
    assert.equal(resolved.resolution.actorId, adminId);
    const winner = await record(a.route.id);
    assert.deepEqual(winner.payload.track, a.route.payload.track);
    assert.equal(winner.payload.duplicateResolutions.length, 1);
    for (const loser of [b.route, c.route]) {
      const stored = await record(loser.id);
      assert.equal(stored.payload.archived, true);
      assert.equal(stored.payload.duplicateWinnerId, a.route.id);
      assert.equal(stored.published, false);
      assert.deepEqual(stored.payload.track, loser.payload.track);
    }
    for (const n of [1, 2, 3]) assert.equal((await record(id(n))).payload.routeId, a.route.id);
    assert.equal((await record(id(2))).payload.track.stats.distanceM, 9000);
    await fails(() => rpc('resolve_route_duplicates', [[a.route.id, b.route.id, c.route.id], a.route.id]), '22023', /STALE_DUPLICATE_GROUP/);
  });
});

test('winner remains frozen after either owner edits, removes or deletes its own activity track', async () => {
  await asIdentity('authenticated', admin, async () => {
    const a = await save(activity(1));
    const b = await save(activity(2));
    await rpc('resolve_route_duplicates', [[a.route.id, b.route.id], a.route.id]);
    const frozen = await record(a.route.id);
    for (const n of [1, 2]) {
      const update = await save(activity(n, { routeName: 'new title', track: track('new geometry', 99000) }, true));
      assert.equal(update.activity.payload.routeId, a.route.id);
      assert.equal(update.activity.payload.track.stats.distanceM, 99000);
      assert.deepEqual(await record(a.route.id), frozen);
    }
    const removed = await save(activity(1, { track: undefined, location: '手填地点', includeFootprint: true }));
    assert.equal(removed.activity.payload.includeFootprint, false);
    assert.equal(removed.activity.payload.routeId, undefined);
    assert.equal(removed.activity.payload.location, '手填地点');
    assert.deepEqual(await record(a.route.id), frozen);
    assert.deepEqual(await rpc('delete_content_with_links', [id(1)]), { deletedId: id(1) });
    assert.deepEqual(await rpc('delete_content_with_links', [id(2)]), { deletedId: id(2) });
    assert.deepEqual(await record(a.route.id), frozen);
    assert.equal((await record(b.route.id)).payload.archived, true);
  });
});

test('deletion protects all route references and archives only the removed activity unused automatic route', async () => {
  await asIdentity('authenticated', admin, async () => {
    const a = await save(activity(1));
    await fails(() => rpc('delete_content_with_links', [a.route.id]), '22023', /CONTENT_IN_USE/);
    await q("update public.content_items set payload=payload - array['routeId','routeLinkSource'] where id=$1", [id(1)]);
    await fails(() => rpc('delete_content_with_links', [a.route.id]), '22023', /CONTENT_IN_USE/);
    await rpc('delete_content_with_links', [id(1)]);
    assert.equal(await record(id(1)), undefined);
    const archived = await record(a.route.id);
    assert.equal(archived.payload.archivedReason, 'activity-track-removed');
    assert.equal(archived.published, false);
    assert.deepEqual(archived.payload.track, a.route.payload.track);
    await insert({ id: id(9), kind: 'route', payload: { title: 'manual', duplicateWinnerId: a.route.id }, published: false });
    await fails(() => rpc('delete_content_with_links', [a.route.id]), '22023', /CONTENT_IN_USE/);
    await rpc('delete_content_with_links', [id(9)]);
    await rpc('delete_content_with_links', [a.route.id]);
    assert.equal((await snapshot()).length, 0);
    await fails(() => rpc('delete_content_with_links', [id(999)]), '22023', /CONTENT_NOT_FOUND/);
  });
});

test('deleting an automatic route owner preserves a non-deduplicated route still linked by another activity', async () => {
  await asIdentity('authenticated', admin, async () => {
    const a = await save(activity(1));
    await insert(activity(2, { routeId: a.route.id, track: track('another outing', 6000) }));
    const before = await record(a.route.id);
    await rpc('delete_content_with_links', [id(1)]);
    assert.deepEqual(await record(a.route.id), before);
    assert.equal((await record(id(2))).payload.routeId, a.route.id);
    await fails(() => rpc('delete_content_with_links', [a.route.id]), '22023', /CONTENT_IN_USE/);
  });
});

test('activity deletion rejected by an application foreign key rolls back its preceding route archive', async () => {
  let a;
  await asIdentity('authenticated', admin, async () => { a = await save(activity(1, { registrationOpen: true, registrationDeadline: new Date(Date.now() + 86400000).toISOString() }, true)); });
  await asIdentity('authenticated', member, async () => { await q('insert into public.applications(activity_id) values($1)', [id(1)]); });
  const before = await snapshot();
  await asIdentity('authenticated', admin, async () => { await fails(() => rpc('delete_content_with_links', [id(1)]), ['23001', '23503']); });
  assert.deepEqual(await snapshot(), before);
  assert.equal((await record(a.route.id)).payload.archived, undefined);
});

test('broken dedup chains and malformed existing audits reject the entire operation', async () => {
  await asIdentity('authenticated', admin, async () => {
    const a = await save(activity(1));
    const b = await save(activity(2));
    await q("update public.content_items set payload=payload || $2 where id=$1", [a.route.id, { duplicateResolutions: {} }]);
    const before = await snapshot();
    await fails(() => rpc('resolve_route_duplicates', [[a.route.id, b.route.id], a.route.id]), '22023', /INVALID_AUDIT/);
    assert.deepEqual(await snapshot(), before);
    await q("update public.content_items set payload=payload || $2 where id=$1", [b.route.id, { archived: true, archivedReason: 'duplicate', duplicateWinnerId: id(999) }]);
    const beforeBroken = await snapshot();
    await fails(() => save(activity(2, { track: track('replacement', 99999) })), '22023', /ARCHIVED_ROUTE_UNAVAILABLE/);
    assert.deepEqual(await snapshot(), beforeBroken);
  });
});
