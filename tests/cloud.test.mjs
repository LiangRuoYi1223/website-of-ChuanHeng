import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createPostgres, postgresSql } from '../server/postgres.mjs';
import { createCloudApp, createRateLimiter, bufferedResponse } from '../server/cloud.mjs';
import { cloudConfig } from '../server/cloud-config.mjs';
import { seedCloud } from '../server/cloud-seed.mjs';
import { createStorage, storageHeaders } from '../server/supabase-storage.mjs';
import { contentPermissions } from '../server/permissions.mjs';

const env = {
  DATABASE_URL: 'postgresql://test:test@localhost:6543/postgres',
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_SECRET_KEY: 'test-only-secret',
  SITE_ORIGIN: 'https://website.test',
};
const initialPassword = 'test-cloud-initial-password-1234',
  readyPassword = 'test-cloud-ready-password-1234';

async function fixture(t) {
  const pg = new PGlite();
  await pg.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA storage;
    CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`);
  await pg.exec(
    await readFile(
      new URL('../supabase/migrations/202610080001_website.sql', import.meta.url),
      'utf8',
    ),
  );
  const statements = [];
  const query = async (sql, values) => {
    statements.push(sql);
    // PGlite is single-session; verify that the adapter requests the production
    // advisory lock, while PostgreSQL constraints/transactions execute for real.
    if (sql.startsWith('SELECT pg_advisory_xact_lock')) return { rows: [], rowCount: 1 };
    const result = await pg.query(sql, values);
    return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
  };
  const db = createPostgres(cloudConfig(env), {
    query,
    async connect() {
      return { query, release() {} };
    },
    end() {
      return pg.close();
    },
  });
  await seedCloud(db, initialPassword);
  const objects = new Map();
  const app = createCloudApp(env, {
    db,
    rateLimiter: async () => ({ async fail() {}, async success() {} }),
    storage: {
      async upload(name, buffer, mime) {
        objects.set(name, { buffer, mime });
      },
      async serve(req, res, name) {
        const item = objects.get(name);
        assert.ok(item);
        res.writeHead(200, { 'Content-Type': item.mime });
        res.end(req.method === 'HEAD' ? undefined : item.buffer);
      },
    },
  });
  const server = http.createServer((req, res) =>
    app.handler(req, res).catch((error) => {
      res.writeHead(500);
      res.end(error.message);
    }),
  );
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeIdleConnections();
    });
    await app.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(route, method = 'GET', body, cookie = '', origin = env.SITE_ORIGIN) {
    const response = await fetch(base + route, {
      method,
      headers: {
        Origin: origin,
        ...(cookie ? { Cookie: cookie } : {}),
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await response.text();
    return {
      status: response.status,
      body: response.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text,
      cookie: response.headers.get('set-cookie')?.split(';')[0],
      headers: response.headers,
    };
  }
  async function ready() {
    const login = await request('/api/auth/login', 'POST', {
      username: 'admin',
      password: initialPassword,
    });
    assert.equal(login.status, 200);
    assert.match(login.headers.get('set-cookie'), /; Secure/);
    assert.equal(
      (
        await request(
          '/api/auth/password',
          'POST',
          { currentPassword: initialPassword, newPassword: readyPassword },
          login.cookie,
        )
      ).status,
      200,
    );
    return login.cookie;
  }
  return { db, pg, request, ready, objects, statements };
}

async function createReadyAccount(f, presidentCookie, role, username) {
  const firstPassword = `${username}-first-password`,
    password = `${username}-ready-password`;
  const created = await f.request(
    '/api/admin/users',
    'POST',
    { username, displayName: `${role}测试账号`, role, password: firstPassword },
    presidentCookie,
  );
  assert.equal(created.status, 201);
  const logged = await f.request('/api/auth/login', 'POST', { username, password: firstPassword });
  assert.equal(logged.status, 200);
  const changed = await f.request(
    '/api/auth/password',
    'POST',
    { currentPassword: firstPassword, newPassword: password },
    logged.cookie,
  );
  assert.equal(changed.status, 200);
  return { user: changed.body.user, cookie: logged.cookie, password };
}

test('cloud initialization creates private schema and seeds once without overwriting content', async (t) => {
  const f = await fixture(t);
  const content = await f.request('/api/content');
  assert.equal(content.status, 200);
  assert.ok(content.body.activities.length);
  assert.ok(content.body.projects.length);
  assert.equal(content.body.settings.revision, 1);
  await assert.rejects(seedCloud(f.db, 'another-valid-password-1234'), /不会覆盖/);
  assert.equal((await f.db.prepare('SELECT COUNT(*) AS count FROM users').get()).count, 1);
  const { rows } = await f.pg.query(
    "SELECT relrowsecurity FROM pg_class JOIN pg_namespace ON pg_namespace.oid = relnamespace WHERE nspname = 'chuanheng' AND relkind = 'r'",
  );
  assert.ok(rows.length >= 8 && rows.every((row) => row.relrowsecurity));
  assert.equal(
    (await f.pg.query("SELECT public FROM storage.buckets WHERE id = 'chuanheng-uploads'")).rows[0]
      .public,
    false,
  );
});

test('PostgreSQL cloud CRUD uses revisions, preserves users and gates uploaded/static media on pause', async (t) => {
  const f = await fixture(t),
    cookie = await f.ready();
  const content = (await f.request('/api/admin/content', 'GET', undefined, cookie)).body;
  const settings = { ...content.settings, clubName: '云端川衡' };
  const saved = await f.request('/api/admin/settings', 'PUT', settings, cookie);
  assert.equal(saved.status, 200);
  assert.equal(saved.body.settings.revision, 2);
  assert.equal((await f.request('/api/admin/settings', 'PUT', settings, cookie)).status, 409);
  assert.equal((await f.request('/api/content')).body.settings.clubName, '云端川衡');
  const activity = {
    ...content.activities[0],
    id: 'cloud-activity',
    title: '云端活动',
    kind: 'upcoming',
    isDemo: false,
    registrationOpen: true,
    date: '2099-10-08',
  };
  delete activity.revision;
  const created = await f.request('/api/admin/activities', 'POST', activity, cookie);
  assert.equal(created.status, 201);
  const updated = await f.request(
    '/api/admin/activities/cloud-activity',
    'PUT',
    { ...created.body.activity, title: '更新云端活动' },
    cookie,
  );
  assert.equal(updated.status, 200);
  assert.equal(updated.body.activity.revision, 2);
  assert.equal(
    (
      await f.request(
        '/api/admin/activities/cloud-activity?revision=1',
        'DELETE',
        undefined,
        cookie,
      )
    ).status,
    409,
  );
  const createdUser = await f.request(
    '/api/admin/users',
    'POST',
    {
      username: 'cloud-member',
      displayName: '云端社员',
      role: 'member',
      password: initialPassword,
    },
    cookie,
  );
  assert.equal(createdUser.status, 201);
  const member = await f.request('/api/auth/login', 'POST', {
    username: 'cloud-member',
    password: initialPassword,
  });
  assert.equal(member.status, 200);
  await f.request(
    '/api/auth/password',
    'POST',
    { currentPassword: initialPassword, newPassword: readyPassword },
    member.cookie,
  );
  const registration = await f.request(
    '/api/registrations',
    'POST',
    { activityId: 'cloud-activity' },
    member.cookie,
  );
  assert.equal(registration.status, 201);
  assert.equal(
    (await f.request('/api/registrations', 'POST', { activityId: 'cloud-activity' }, member.cookie))
      .status,
    409,
  );
  assert.equal(
    (await f.request('/api/registrations', 'GET', undefined, member.cookie)).body.registrations
      .length,
    1,
  );
  assert.equal(
    (await f.request('/api/registrations/cloud-activity', 'DELETE', undefined, member.cookie))
      .status,
    200,
  );
  const png =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lVEAAAAASUVORK5CYII=';
  const upload = await f.request(
    '/api/admin/upload',
    'POST',
    { filename: 'cloud.png', dataUrl: `data:image/png;base64,${png}` },
    cookie,
  );
  assert.equal(upload.status, 201);
  assert.equal(f.objects.size, 1);
  assert.equal((await f.request(upload.body.url)).status, 200);
  assert.equal(
    (
      await f.request(
        '/api/admin/settings',
        'PUT',
        saved.body.settings,
        cookie,
        'https://evil.test',
      )
    ).status,
    403,
  );
  const status = (await f.request('/api/site-status')).body;
  assert.equal(
    (
      await f.request(
        '/api/admin/site-status',
        'POST',
        { paused: true, password: readyPassword, revision: status.revision },
        cookie,
      )
    ).status,
    200,
  );
  for (const route of [
    '/api/content',
    upload.body.url,
    '/images/hiking.webp',
    '/docs/chuanheng-partnership-handbook.pdf',
  ])
    assert.equal((await f.request(route)).status, 503);
  assert.equal((await f.request('/api/admin/content', 'GET', undefined, cookie)).status, 200);
  assert.equal(
    (await f.request('/api/admin/users/' + createdUser.body.user.id, 'DELETE', undefined, cookie))
      .status,
    200,
  );
  const admin = (await f.request('/api/auth/me', 'GET', undefined, cookie)).body.user;
  assert.equal(
    (await f.request('/api/admin/users/' + admin.id, 'DELETE', undefined, cookie)).status,
    400,
  );
  assert.equal(
    (await f.request('/api/auth/me', 'GET', undefined, cookie)).body.user.active,
    undefined,
  );
  assert.equal(
    (
      await f.request(
        '/api/admin/site-status',
        'POST',
        { paused: false, password: readyPassword, revision: status.revision + 1 },
        cookie,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await f.request(
        '/api/admin/activities/cloud-activity?revision=2',
        'DELETE',
        undefined,
        cookie,
      )
    ).status,
    200,
  );
  assert.ok(f.statements.some((sql) => sql.includes('pg_advisory_xact_lock')));
});

test('cloud president and ordinary admins list all account roles and inactive accounts without credential fields', async (t) => {
  const f = await fixture(t),
    presidentCookie = await f.ready();
  const president = (await f.request('/api/auth/me', 'GET', undefined, presidentCookie)).body.user;
  const admin = await createReadyAccount(f, presidentCookie, 'admin', 'directory.admin');
  const member = await createReadyAccount(f, presidentCookie, 'member', 'directory.member');
  const viewer = await createReadyAccount(f, presidentCookie, 'viewer', 'directory.viewer');
  const inactive = await createReadyAccount(f, presidentCookie, 'member', 'directory.inactive');
  assert.equal(
    (await f.request(`/api/admin/users/${inactive.user.id}`, 'DELETE', undefined, presidentCookie))
      .status,
    200,
  );
  const expectedIds = [
    president.id,
    admin.user.id,
    member.user.id,
    viewer.user.id,
    inactive.user.id,
  ].sort();
  let presidentUsers;
  for (const cookie of [presidentCookie, admin.cookie]) {
    const result = await f.request('/api/admin/users', 'GET', undefined, cookie);
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.users.map((user) => user.id).sort(), expectedIds);
    assert.equal(result.body.users.find((user) => user.id === president.id).isPresident, true);
    assert.equal(result.body.users.find((user) => user.id === admin.user.id).isPresident, false);
    assert.equal(result.body.users.find((user) => user.id === inactive.user.id).active, false);
    for (const user of result.body.users) {
      assert.deepEqual(user.permissions, user.role === 'admin' ? contentPermissions : []);
      for (const secret of ['password', 'passwordHash', 'password_hash', 'hash', 'salt'])
        assert.ok(!(secret in user));
    }
    for (const password of [
      initialPassword,
      readyPassword,
      admin.password,
      member.password,
      viewer.password,
      inactive.password,
    ]) {
      assert.equal(JSON.stringify(result.body).includes(password), false);
    }
    if (presidentUsers) assert.deepEqual(result.body.users, presidentUsers);
    else presidentUsers = result.body.users;
  }
});

test('cloud president promotes members, revokes their existing sessions, and grants all administrator capabilities', async (t) => {
  const f = await fixture(t),
    presidentCookie = await f.ready();
  const member = await createReadyAccount(f, presidentCookie, 'member', 'promotion.member');
  const otherSession = await f.request('/api/auth/login', 'POST', {
    username: member.user.username,
    password: member.password,
  });
  assert.equal(otherSession.status, 200);
  assert.equal((await f.request('/api/admin/users', 'GET', undefined, member.cookie)).status, 403);
  const promoted = await f.request(
    `/api/admin/users/${member.user.id}`,
    'PUT',
    { role: 'admin' },
    presidentCookie,
  );
  assert.equal(promoted.status, 200);
  assert.equal(promoted.body.user.role, 'admin');
  assert.equal(promoted.body.user.isPresident, false);
  assert.deepEqual(promoted.body.user.permissions, contentPermissions);
  for (const cookie of [member.cookie, otherSession.cookie]) {
    assert.deepEqual((await f.request('/api/auth/me', 'GET', undefined, cookie)).body, {
      user: null,
    });
    assert.equal((await f.request('/api/admin/users', 'GET', undefined, cookie)).status, 401);
  }
  const logged = await f.request('/api/auth/login', 'POST', {
    username: member.user.username,
    password: member.password,
  });
  assert.equal(logged.status, 200);
  assert.equal(logged.body.user.role, 'admin');
  assert.equal(logged.body.user.mustChangePassword, false);
  assert.deepEqual(logged.body.user.permissions, contentPermissions);
  const { cookie } = logged;
  const content = await f.request('/api/admin/content', 'GET', undefined, cookie);
  assert.equal(content.status, 200);
  assert.equal(
    (
      await f.request(
        '/api/admin/settings',
        'PUT',
        { ...content.body.settings, intro: '云端晋升管理员维护介绍' },
        cookie,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await f.request(
        '/api/admin/activities',
        'POST',
        { ...content.body.activities[0], id: '', title: '云端晋升管理员创建活动' },
        cookie,
      )
    ).status,
    201,
  );
  assert.equal(
    (
      await f.request(
        '/api/admin/projects',
        'POST',
        { ...content.body.projects[0], id: '', title: '云端晋升管理员创建项目' },
        cookie,
      )
    ).status,
    201,
  );
  const png =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lVEAAAAASUVORK5CYII=';
  assert.equal(
    (
      await f.request(
        '/api/admin/upload',
        'POST',
        { filename: 'promotion.png', dataUrl: `data:image/png;base64,${png}` },
        cookie,
      )
    ).status,
    201,
  );
  const created = await f.request(
    '/api/admin/users',
    'POST',
    {
      username: 'promotion.created',
      displayName: '晋升管理员创建社员',
      role: 'member',
      password: 'promotion-created-password',
    },
    cookie,
  );
  assert.equal(created.status, 201);
  const listed = await f.request('/api/admin/users', 'GET', undefined, cookie);
  assert.equal(listed.status, 200);
  const president = (await f.request('/api/auth/me', 'GET', undefined, presidentCookie)).body.user;
  assert.deepEqual(
    listed.body.users.map((user) => user.id).sort(),
    [president.id, member.user.id, created.body.user.id].sort(),
  );
});

test('cloud throttling keeps rejected attempts across backend instances', async () => {
  const counts = new Map();
  const pool = {
    async query(sql, values) {
      if (sql.startsWith('INSERT')) {
        const count = (counts.get(values[0]) ?? 0) + 1;
        counts.set(values[0], count);
        return { rows: [{ count }] };
      }
      if (sql.includes('WHERE key =')) counts.delete(values[0]);
      return { rows: [] };
    },
  };
  const request = { headers: { 'x-vercel-forwarded-for': '203.0.113.1' }, socket: {} };
  for (let i = 0; i < 5; i++)
    await (await createRateLimiter(pool)(request, 'admin', '登录')).fail();
  await assert.rejects(
    createRateLimiter(pool)(request, 'admin', '登录'),
    (error) => error.status === 429,
  );
  assert.ok([...counts.keys()].every((key) => /^[a-f0-9]{64}$/.test(key)));
});

test('successful logins do not consume the shared campus IP failure budget', async (t) => {
  const f = await fixture(t),
    limiter = createRateLimiter(f.db.pool);
  const request = { headers: { 'x-vercel-forwarded-for': '203.0.113.2' }, socket: {} };
  for (let i = 0; i < 35; i++) await (await limiter(request, 'admin', '登录')).success();
  const { rows } = await f.pg.query('SELECT count FROM chuanheng.rate_limits');
  assert.deepEqual(rows, [{ count: 0 }]);
});

test('Supabase storage sends secrets only to the backend storage endpoint and fails closed', async () => {
  const calls = [];
  const storage = createStorage(cloudConfig(env), async (url, options) => {
    calls.push({ url, options });
    return new Response('', { status: 200 });
  });
  await storage.upload('test.png', Buffer.from('test'), 'image/png');
  assert.equal(
    calls[0].url,
    'https://test.supabase.co/storage/v1/object/chuanheng-uploads/test.png',
  );
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-only-secret');
  assert.deepEqual(storageHeaders('sb_secret_test'), { apikey: 'sb_secret_test' });
  const failing = createStorage(cloudConfig(env), async () => new Response('', { status: 403 }));
  await assert.rejects(
    failing.upload('test.png', Buffer.from('test'), 'image/png'),
    (error) => error.status === 502,
  );
});

test('cloud configuration rejects missing secrets and invalid origins without revealing their values', () => {
  assert.throws(() => cloudConfig({}), /配置缺失/);
  assert.throws(() => cloudConfig({ ...env, SITE_ORIGIN: 'http://website.test' }), /HTTPS/);
  assert.throws(() => cloudConfig({ ...env, SITE_ORIGIN: 'https://website.test/' }), /结尾斜杠/);
  assert.equal(cloudConfig(env).origin, env.SITE_ORIGIN);
  assert.equal(
    cloudConfig({ ...env, SITE_ORIGIN: undefined }, { requireSiteOrigin: false }).origin,
    undefined,
  );
  assert.match(
    postgresSql('INSERT INTO activities VALUES (?, ?, 1)'),
    /chuanheng.activities \(id, payload, revision\) VALUES \(\$1, \$2, 1\)/,
  );
});

test('transaction replies remain buffered until commit and cookies survive flushing', () => {
  const buffer = bufferedResponse();
  buffer.setHeader('X-Frame-Options', 'DENY');
  buffer.writeHead(201, { 'Set-Cookie': 'session=test; Secure' });
  buffer.end('{"ok":true}');
  const res = {
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(body) {
      this.body = body;
    },
  };
  assert.equal(res.body, undefined);
  buffer.flush(res);
  assert.equal(res.status, 201);
  assert.equal(res.headers['set-cookie'], 'session=test; Secure');
});
