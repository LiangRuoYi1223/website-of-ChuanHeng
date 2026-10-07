import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHash, scryptSync } from 'node:crypto';
import { createApp } from '../server/index.mjs';
import { contentPermissions } from '../server/permissions.mjs';
import { initialSettings, initialActivities, legacyAboutDescription } from '../server/seed.mjs';
import { findCity } from '../src/features/map-data/cities.ts';

const initialPassword = 'test-initial-only-24-characters';
const readyPassword = 'test-ready-password-1234';
async function fixture(t, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'chuanheng-backend-test-'));
  const config = { dataDir: path.join(root, 'data'), uploadDir: path.join(root, 'uploads'), distDir: path.join(root, 'dist'), initialPassword, ...options };
  if (options.beforeCreate) await options.beforeCreate(config);
  let app = createApp(config);
  let origin;
  async function listen() {
    await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${app.server.address().port}`;
  }
  await listen();
  t.after(async () => { await app.close(); await rm(root, { recursive: true, force: true }); });
  return {
    root, config,
    async request(route, { method = 'GET', body, cookie = '', originOverride, headers = {} } = {}) {
      const response = await fetch(`${origin}${route}`, {
        method,
        headers: { Origin: originOverride ?? origin, ...(cookie ? { Cookie: cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const type = response.headers.get('content-type') ?? '';
      return { status: response.status, body: method !== 'HEAD' && type.includes('application/json') ? await response.json() : await response.text(), cookie: response.headers.get('set-cookie')?.split(';')[0], headers: response.headers };
    },
    async restart() { await app.close(); app = createApp(config); await listen(); },
  };
}
async function login(client, username = 'admin', password = initialPassword) {
  const result = await client.request('/api/auth/login', { method: 'POST', body: { username, password } });
  assert.equal(result.status, 200);
  assert.match(result.headers.get('set-cookie'), /HttpOnly; SameSite=Strict/);
  return result;
}
async function loginReady(client, username = 'admin', password = initialPassword, nextPassword = readyPassword) {
  const result = await login(client, username, password);
  const changed = await client.request('/api/auth/password', { method: 'POST', cookie: result.cookie, body: { currentPassword: password, newPassword: nextPassword } });
  assert.equal(changed.status, 200);
  return { ...result, body: changed.body };
}

test('public seed exposes demonstration markers and never exposes account credentials', async t => {
  const client = await fixture(t);
  const result = await client.request('/api/content');
  assert.equal(result.status, 200);
  assert.equal(result.body.settings.clubName, '川衡登山协会');
  assert.equal(result.body.settings.founded, '2018');
  assert.equal(result.body.settings.revision, 1);
  assert.equal(result.body.settings.demoMode, true);
  assert.equal(result.body.settings.logoUrl, '');
  assert.equal(result.body.activities.length, 7);
  assert.ok(result.body.activities.every(item => item.isDemo && item.title.includes('示例') && item.revision === 1));
  assert.ok(result.body.activities.every(item => typeof item.routeName === 'string' && item.location === item.routeName && findCity(item.cityCode)));
  assert.equal(result.body.projects.length, 3);
  assert.ok(result.body.projects.every(item => item.status === 'published' && item.isDemo));
  assert.equal(result.body.settings.semesterName, '2026 秋季学期');
  assert.ok(result.body.activities.every(item => item.preparation?.items.length));
  assert.ok(result.body.activities.some(item => item.album?.length));
  assert.ok(result.body.cooperation?.qualifications.length);
  assert.equal(JSON.stringify(result.body).includes(initialPassword), false);
  const me = await client.request('/api/auth/me');
  assert.deepEqual(me.body, { user: null });
  assert.equal((await client.request('/api/admin/content')).status, 401);
});

test('authentication protects writes, rejects cross-origin requests, and logout expires the session', async t => {
  const client = await fixture(t);
  assert.equal((await client.request('/api/admin/settings', { method: 'PUT', body: {} })).status, 401);
  assert.equal((await client.request('/api/auth/login', { method: 'POST', body: { username: 'admin', password: initialPassword }, originOverride: 'https://untrusted.example' })).status, 403);
  assert.equal((await client.request('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'wrong' } })).status, 401);
  const { cookie, body } = await login(client);
  assert.equal(body.user.role, 'admin');
  assert.equal(body.user.isPresident, true);
  assert.deepEqual(body.user.permissions, contentPermissions);
  assert.equal(body.user.mustChangePassword, true);
  assert.equal((await client.request('/api/auth/me', { cookie })).body.user.username, 'admin');
  const logout = await client.request('/api/auth/logout', { method: 'POST', cookie });
  assert.equal(logout.status, 200);
  assert.match(logout.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal((await client.request('/api/admin/content', { cookie })).status, 401);
});

test('activities persist across restart; drafts stay private; stale updates and deletes conflict', async t => {
  const client = await fixture(t);
  let { cookie } = await loginReady(client);
  const seed = (await client.request('/api/content')).body.activities[0];
  const created = await client.request('/api/admin/activities', { method: 'POST', cookie, body: { ...seed, id: '', title: '测试草稿', status: 'draft' } });
  assert.equal(created.status, 201);
  const draft = created.body.activity;
  assert.equal(draft.revision, 1);
  assert.ok(!(await client.request('/api/content')).body.activities.some(item => item.id === draft.id));
  assert.ok((await client.request('/api/admin/content', { cookie })).body.activities.some(item => item.id === draft.id));
  const published = await client.request(`/api/admin/activities/${draft.id}`, { method: 'PUT', cookie, body: { ...draft, title: '已发布活动', image: '/images/forest.webp', status: 'published' } });
  assert.equal(published.status, 200);
  assert.equal(published.body.activity.revision, 2);
  assert.equal(published.body.activity.image, '/images/forest.webp');
  assert.equal((await client.request('/api/content')).body.activities.find(item => item.id === draft.id).image, '/images/forest.webp');
  assert.equal((await client.request(`/api/admin/activities/${draft.id}`, { method: 'PUT', cookie, body: draft })).status, 409);
  const missingRevision = { ...published.body.activity }; delete missingRevision.revision;
  assert.equal((await client.request(`/api/admin/activities/${draft.id}`, { method: 'PUT', cookie, body: missingRevision })).status, 409);
  assert.equal((await client.request(`/api/admin/activities/${draft.id}?revision=1`, { method: 'DELETE', cookie })).status, 409);
  await client.restart();
  cookie = (await login(client, 'admin', readyPassword)).cookie;
  const persisted = (await client.request('/api/content')).body.activities.find(item => item.id === draft.id);
  assert.equal(persisted.title, '已发布活动'); assert.equal(persisted.revision, 2);
  assert.equal(persisted.image, '/images/forest.webp');
  assert.equal((await client.request(`/api/admin/activities/${draft.id}?revision=2`, { method: 'DELETE', cookie })).status, 200);
  assert.equal((await client.request(`/api/admin/activities/${draft.id}`, { method: 'DELETE', cookie })).status, 404);
});

test('activity routes and city codes validate independently, persist, and ignore client coordinates', async t => {
  const client = await fixture(t), { cookie } = await loginReady(client);
  const seed = (await client.request('/api/content')).body.activities[0];
  for (const changes of [{ cityCode: 'unknown-city' }, { cityCode: 440300 }, { cityCode: null }, { routeName: null }]) {
    assert.equal((await client.request('/api/admin/activities', { method: 'POST', cookie, body: { ...seed, id: '', ...changes } })).status, 400);
  }
  const created = await client.request('/api/admin/activities', { method: 'POST', cookie, body: {
    ...seed, id: '', routeName: '梧桐山徒步 · 测试路线', location: '旧地点字段应被路线取代', cityCode: '440300',
    longitude: 0, latitude: 0, cityName: '伪造城市名',
  } });
  assert.equal(created.status, 201);
  assert.equal(created.body.activity.routeName, '梧桐山徒步 · 测试路线');
  assert.equal(created.body.activity.location, created.body.activity.routeName);
  assert.equal(created.body.activity.cityCode, '440300');
  assert.ok(!('longitude' in created.body.activity) && !('latitude' in created.body.activity) && !('cityName' in created.body.activity));
  const routeChanged = await client.request(`/api/admin/activities/${created.body.activity.id}`, { method: 'PUT', cookie, body: { ...created.body.activity, routeName: '第二条测试路线' } });
  assert.equal(routeChanged.status, 200);
  assert.equal(routeChanged.body.activity.cityCode, '440300');
  assert.equal(routeChanged.body.activity.location, '第二条测试路线');
  const cityChanged = await client.request(`/api/admin/activities/${created.body.activity.id}`, { method: 'PUT', cookie, body: { ...routeChanged.body.activity, cityCode: '450300' } });
  assert.equal(cityChanged.status, 200);
  assert.equal(cityChanged.body.activity.routeName, '第二条测试路线');
  await client.restart();
  const persisted = (await client.request('/api/content')).body.activities.find(item => item.id === created.body.activity.id);
  assert.equal(persisted.cityCode, '450300');
  assert.equal(persisted.routeName, '第二条测试路线');
  assert.equal(persisted.revision, 3);
  const legacyInput = { ...seed, id: '', location: '旧客户端的宣传路线' };
  delete legacyInput.routeName; delete legacyInput.cityCode;
  const legacy = await client.request('/api/admin/activities', { method: 'POST', cookie, body: legacyInput });
  assert.equal(legacy.status, 201);
  assert.equal(legacy.body.activity.routeName, legacyInput.location);
  assert.equal(legacy.body.activity.location, legacyInput.location);
  assert.equal(legacy.body.activity.cityCode, '');
});

test('route/city migration retains edited activities, assigns only unchanged demo locations, and is idempotent', async t => {
  const oldActivity = id => {
    const activity = { ...initialActivities.find(item => item.id === id) };
    delete activity.routeName; delete activity.cityCode;
    return activity;
  };
  const unchangedDemo = { ...oldActivity('demo-autumn-hike'), title: '保留编辑过的标题', image: '/images/forest.webp' };
  const editedLocation = { ...oldActivity('demo-rope-training'), location: '用户记录的另一个地点' };
  const realActivity = { ...oldActivity('demo-forest-walk'), isDemo: false };
  const assignedActivity = { ...initialActivities.find(item => item.id === 'demo-november-trail'), routeName: '已经维护好的宣传路线', location: '已经维护好的宣传路线', cityCode: '440300' };
  const editedRoute = { ...oldActivity('demo-january-training'), routeName: '用户已经修改的路线名称' };
  const customActivity = { ...oldActivity('demo-forest-walk'), id: 'real-custom-activity', routeName: '正式活动路线', location: '正式活动路线', isDemo: false };
  const rows = [[unchangedDemo, 7], [editedLocation, 9], [realActivity, 11], [assignedActivity, 13], [editedRoute, 15], [customActivity, 17]];
  const client = await fixture(t, { async beforeCreate(config) {
    await mkdir(config.dataDir, { recursive: true });
    const database = new DatabaseSync(path.join(config.dataDir, 'chuanheng.sqlite'));
    database.exec(`CREATE TABLE site_settings (id INTEGER PRIMARY KEY CHECK(id = 1), payload TEXT NOT NULL, revision INTEGER NOT NULL);
      CREATE TABLE activities (id TEXT PRIMARY KEY, payload TEXT NOT NULL, revision INTEGER NOT NULL);`);
    database.prepare('INSERT INTO site_settings VALUES (1, ?, 1)').run(JSON.stringify(initialSettings));
    const insert = database.prepare('INSERT INTO activities VALUES (?, ?, ?)');
    for (const [activity, revision] of rows) insert.run(activity.id, JSON.stringify(activity), revision);
    database.close();
  } });
  const migrated = (await client.request('/api/content')).body.activities;
  const byId = new Map(migrated.map(item => [item.id, item]));
  assert.equal(migrated.length, rows.length);
  assert.equal(byId.get(unchangedDemo.id).cityCode, initialActivities.find(item => item.id === unchangedDemo.id).cityCode);
  assert.equal(byId.get(unchangedDemo.id).routeName, unchangedDemo.location);
  assert.equal(byId.get(unchangedDemo.id).title, unchangedDemo.title);
  assert.equal(byId.get(unchangedDemo.id).image, unchangedDemo.image);
  assert.equal(byId.get(unchangedDemo.id).revision, 8);
  assert.equal(byId.get(editedLocation.id).routeName, editedLocation.location);
  assert.equal(byId.get(editedLocation.id).cityCode, '');
  assert.equal(byId.get(realActivity.id).cityCode, '');
  assert.equal(byId.get(assignedActivity.id).routeName, assignedActivity.routeName);
  assert.equal(byId.get(assignedActivity.id).cityCode, assignedActivity.cityCode);
  assert.equal(byId.get(assignedActivity.id).revision, 13);
  assert.equal(byId.get(editedRoute.id).routeName, editedRoute.routeName);
  assert.equal(byId.get(editedRoute.id).cityCode, '');
  assert.equal(byId.get(customActivity.id).routeName, customActivity.routeName);
  assert.equal(byId.get(customActivity.id).cityCode, '');
  assert.ok(!byId.has('demo-climbing') && !byId.has('demo-december-forest'));
  const { cookie } = await loginReady(client);
  assert.equal((await client.request(`/api/admin/activities/${unchangedDemo.id}`, { method: 'PUT', cookie, body: { ...byId.get(unchangedDemo.id), revision: 7 } })).status, 409);
  await client.restart();
  assert.deepEqual((await client.request('/api/content')).body.activities, migrated);
});

test('route/city migration rolls back all rows if stored activity data is malformed', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'chuanheng-migration-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dataDir = path.join(root, 'data');
  await mkdir(dataDir);
  const databasePath = path.join(dataDir, 'chuanheng.sqlite');
  const database = new DatabaseSync(databasePath);
  database.exec('CREATE TABLE activities (id TEXT PRIMARY KEY, payload TEXT NOT NULL, revision INTEGER NOT NULL)');
  const activity = { ...initialActivities[0] };
  delete activity.routeName; delete activity.cityCode;
  const payload = JSON.stringify(activity);
  database.prepare('INSERT INTO activities VALUES (?, ?, ?)').run(activity.id, payload, 5);
  database.prepare('INSERT INTO activities VALUES (?, ?, ?)').run('malformed-activity', 'invalid-json', 1);
  database.close();
  assert.throws(() => createApp({ dataDir, uploadDir: path.join(root, 'uploads'), distDir: path.join(root, 'dist'), initialPassword }), SyntaxError);
  const reopened = new DatabaseSync(databasePath);
  try {
    assert.deepEqual({ ...reopened.prepare('SELECT payload, revision FROM activities WHERE id = ?').get(activity.id) }, { payload, revision: 5 });
  } finally { reopened.close(); }
});

test('settings use optimistic locking and validate contact links', async t => {
  const client = await fixture(t), { cookie } = await loginReady(client);
  const settings = (await client.request('/api/content')).body.settings;
  assert.equal((await client.request('/api/admin/settings', { method: 'PUT', cookie, body: { ...settings, officialSignupUrl: 'javascript:alert(1)' } })).status, 400);
  assert.equal((await client.request('/api/admin/settings', { method: 'PUT', cookie, body: { ...settings, contactEmail: 'bad-email' } })).status, 400);
  assert.equal((await client.request('/api/admin/settings', { method: 'PUT', cookie, body: { ...settings, logoUrl: 'javascript:alert(1)' } })).status, 400);
  const saved = await client.request('/api/admin/settings', { method: 'PUT', cookie, body: { ...settings, demoMode: false, logoUrl: '/images/forest.webp', officialSignupUrl: 'https://mp.weixin.qq.com/s/real-example', contactEmail: 'club@example.edu' } });
  assert.equal(saved.status, 200); assert.equal(saved.body.settings.revision, 2);
  assert.equal(saved.body.settings.demoMode, false);
  assert.equal(saved.body.settings.logoUrl, '/images/forest.webp');
  assert.equal((await client.request('/api/admin/settings', { method: 'PUT', cookie, body: settings })).status, 409);
  const legacy = { ...saved.body.settings }; delete legacy.logoUrl; delete legacy.demoMode;
  const compatible = await client.request('/api/admin/settings', { method: 'PUT', cookie, body: legacy });
  assert.equal(compatible.status, 200);
  assert.equal(compatible.body.settings.logoUrl, '');
  assert.equal(compatible.body.settings.demoMode, true);
  await client.restart();
  assert.equal((await client.request('/api/content')).body.settings.contactEmail, 'club@example.edu');
});

test('projects can be added later, published, updated, and deleted', async t => {
  const client = await fixture(t), { cookie } = await loginReady(client);
  const initialCount = (await client.request('/api/content')).body.projects.length;
  const project = { title: '待定项目示例', mountain: '待定', elevation: '', plannedDate: '', duration: '', summary: '计划待定', description: '', trainingPlan: '按项目更新', supportNeeds: '按项目更新', cooperationValue: '按协议确定', image: '/images/alpine.webp', status: 'draft', isDemo: true };
  const created = await client.request('/api/admin/projects', { method: 'POST', body: project, cookie });
  assert.equal(created.status, 201);
  assert.equal((await client.request('/api/content')).body.projects.length, initialCount);
  const updated = await client.request(`/api/admin/projects/${created.body.project.id}`, { method: 'PUT', cookie, body: { ...created.body.project, status: 'published' } });
  assert.equal(updated.status, 200); assert.equal(updated.body.project.revision, 2);
  assert.equal((await client.request('/api/content')).body.projects.length, initialCount + 1);
  assert.equal((await client.request(`/api/admin/projects/${created.body.project.id}`, { method: 'DELETE', cookie })).status, 200);
});

test('all admins can edit content and manage accounts; the final active admin remains protected', async t => {
  const client = await fixture(t), { cookie: adminCookie, body: admin } = await loginReady(client);
  const editor = await client.request('/api/admin/users', { method: 'POST', cookie: adminCookie, body: { username: 'editor.one', displayName: '维护同学', password: 'editor-password-1234', role: 'admin' } });
  assert.equal(editor.status, 201);
  assert.deepEqual(editor.body.user.permissions, contentPermissions);
  assert.equal(editor.body.user.isPresident, false);
  const { cookie: editorCookie } = await loginReady(client, 'editor.one', 'editor-password-1234', 'editor-ready-password-1234');
  assert.equal((await client.request('/api/admin/content', { cookie: editorCookie })).status, 200);
  const content = (await client.request('/api/content')).body, settings = content.settings;
  assert.equal((await client.request('/api/admin/settings', { method: 'PUT', cookie: editorCookie, body: { ...settings, intro: '维护者已更新' } })).status, 200);
  assert.equal((await client.request('/api/admin/activities', { method: 'POST', cookie: editorCookie, body: { ...content.activities[0], id: '', title: '管理员新增活动' } })).status, 201);
  assert.equal((await client.request('/api/admin/projects', { method: 'POST', cookie: editorCookie, body: { ...content.projects[0], id: '', title: '管理员新增项目' } })).status, 201);
  assert.equal((await client.request('/api/admin/upload', { method: 'POST', cookie: editorCookie, body: {} })).status, 400);
  assert.equal((await client.request('/api/admin/users', { cookie: editorCookie })).status, 200);
  assert.equal((await client.request('/api/admin/users', { method: 'POST', cookie: editorCookie, body: { username: 'admin.created.member', displayName: '管理员创建社员', password: 'member-created-password', role: 'member' } })).status, 201);
  assert.equal((await client.request(`/api/admin/users/${editor.body.user.id}`, { method: 'DELETE', cookie: adminCookie })).status, 200);
  assert.equal((await client.request('/api/admin/content', { cookie: editorCookie })).status, 401);
  assert.equal((await client.request('/api/auth/login', { method: 'POST', body: { username: 'editor.one', password: 'editor-ready-password-1234' } })).status, 401);
  for (const change of [{ role: 'member' }, { role: 'viewer' }, { active: false }]) {
    assert.equal((await client.request(`/api/admin/users/${admin.user.id}`, { method: 'PUT', cookie: adminCookie, body: change })).status, 400);
  }
  assert.equal((await client.request(`/api/admin/users/${admin.user.id}`, { method: 'DELETE', cookie: adminCookie })).status, 400);
  const users = (await client.request('/api/admin/users', { cookie: adminCookie })).body.users;
  assert.equal(users.find(user => user.id === editor.body.user.id).active, false);
  assert.ok(users.every(user => typeof user.isPresident === 'boolean' && !('password_hash' in user)));
});

test('password changes clear the temporary password requirement and invalidate other sessions', async t => {
  const client = await fixture(t), first = await login(client), second = await login(client);
  assert.equal((await client.request('/api/auth/password', { method: 'POST', cookie: first.cookie, body: { currentPassword: 'wrong', newPassword: 'new-password-1234' } })).status, 400);
  assert.equal((await client.request('/api/auth/password', { method: 'POST', cookie: first.cookie, body: { currentPassword: initialPassword, newPassword: 'short' } })).status, 400);
  const changed = await client.request('/api/auth/password', { method: 'POST', cookie: first.cookie, body: { currentPassword: initialPassword, newPassword: 'new-password-1234' } });
  assert.equal(changed.status, 200); assert.equal(changed.body.user.mustChangePassword, false);
  assert.equal((await client.request('/api/admin/content', { cookie: second.cookie })).status, 401);
  assert.equal((await client.request('/api/admin/content', { cookie: first.cookie })).status, 200);
  assert.equal((await client.request('/api/auth/login', { method: 'POST', body: { username: 'admin', password: initialPassword } })).status, 401);
  assert.equal((await login(client, 'admin', 'new-password-1234')).body.user.mustChangePassword, false);
});

test('uploads verify image bytes, enforce limits, use safe filenames, and serve without exposing arbitrary files', async t => {
  const client = await fixture(t), { cookie } = await loginReady(client);
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lVEAAAAASUVORK5CYII=';
  const upload = await client.request('/api/admin/upload', { method: 'POST', cookie, body: { filename: '../../secret.png', dataUrl: `data:image/png;base64,${png}` } });
  assert.equal(upload.status, 201);
  assert.match(upload.body.url, /^\/uploads\/[a-f0-9-]+\.png$/);
  assert.equal((await client.request(upload.body.url)).status, 200);
  assert.equal((await client.request('/api/admin/upload', { method: 'POST', cookie, body: { filename: 'evil.png', dataUrl: `data:image/png;base64,${Buffer.from('<svg><script></script></svg>').toString('base64')}` } })).status, 400);
  assert.equal((await client.request('/api/admin/upload', { method: 'POST', cookie, body: { filename: 'evil.svg', dataUrl: `data:image/svg+xml;base64,${Buffer.from('<svg/>').toString('base64')}` } })).status, 400);
  assert.equal((await client.request('/api/admin/upload', { method: 'POST', cookie, body: { filename: 'oversized.png', dataUrl: `data:image/png;base64,${Buffer.alloc(8 * 1024 * 1024 + 1).toString('base64')}` } })).status, 413);
  assert.equal((await client.request('/uploads/not-found.png')).status, 404);
  assert.equal((await client.request('/uploads/%2e%2e/initial-admin.txt')).status, 404);
});

test('production static fallback only applies to known routes, never missing APIs or uploads', async t => {
  const client = await fixture(t, { production: true });
  await mkdir(client.config.distDir, { recursive: true });
  await writeFile(path.join(client.config.distDir, 'index.html'), '<html>川衡</html>');
  for (const route of ['/', '/activities', '/activities/demo-forest-walk', '/about', '/team', '/cooperation', '/login', '/account', '/admin', '/projects/example-project']) {
    const result = await client.request(route);
    assert.equal(result.status, 200);
    assert.match(result.headers.get('content-type'), /text\/html/);
    assert.equal(result.body, '<html>川衡</html>');
  }
  for (const route of ['/api/missing', '/uploads/missing.png', '/missing.js', '/data/initial-admin.txt']) assert.equal((await client.request(route)).status, 404);
  assert.equal((await client.request('/api/auth/login', { method: 'POST', body: { username: 'admin', password: initialPassword }, originOverride: 'http://127.0.0.1:5173' })).status, 403);
});

test('repeated failed logins are throttled without revealing account existence', async t => {
  const client = await fixture(t);
  for (let i = 0; i < 5; i++) assert.equal((await client.request('/api/auth/login', { method: 'POST', body: { username: 'nonexistent', password: 'wrong' } })).status, 401);
  assert.equal((await client.request('/api/auth/login', { method: 'POST', body: { username: 'nonexistent', password: 'wrong' } })).status, 429);
  assert.equal((await login(client)).status, 200);
});

test('initial account credentials stay in the private data folder and are not regenerated on restart', async t => {
  const client = await fixture(t);
  const filename = path.join(client.config.dataDir, 'initial-admin.txt');
  const first = await readFile(filename, 'utf8');
  assert.ok(first.includes(initialPassword));
  await client.restart();
  assert.equal(await readFile(filename, 'utf8'), first);
});

test('temporary passwords cannot edit or upload until changed; password resets restore the requirement', async t => {
  const client = await fixture(t), { cookie } = await login(client);
  const settings = (await client.request('/api/content')).body.settings;
  const denied = await client.request('/api/admin/settings', { method: 'PUT', cookie, body: settings });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.code, 'PASSWORD_CHANGE_REQUIRED');
  assert.equal((await client.request('/api/admin/upload', { method: 'POST', cookie, body: {} })).body.code, 'PASSWORD_CHANGE_REQUIRED');
  assert.equal((await client.request('/api/admin/content', { cookie })).status, 200);
  const changed = await client.request('/api/auth/password', { method: 'POST', cookie, body: { currentPassword: initialPassword, newPassword: readyPassword } });
  assert.equal(changed.status, 200);
  assert.equal((await client.request('/api/admin/settings', { method: 'PUT', cookie, body: settings })).status, 200);
  const user = await client.request('/api/admin/users', { method: 'POST', cookie, body: { username: 'reset.test', displayName: '密码重置测试', password: 'reset-first-password', role: 'admin', permissions: ['projects:write'] } });
  const ready = await loginReady(client, 'reset.test', 'reset-first-password', 'reset-ready-password');
  assert.equal((await client.request('/api/admin/content', { cookie: ready.cookie })).status, 200);
  assert.equal((await client.request(`/api/admin/users/${user.body.user.id}`, { method: 'PUT', cookie, body: { password: 'reset-new-password' } })).status, 200);
  assert.equal((await client.request('/api/admin/content', { cookie: ready.cookie })).status, 401);
  const reset = await login(client, 'reset.test', 'reset-new-password');
  assert.equal(reset.body.user.mustChangePassword, true);
  assert.equal((await client.request('/api/admin/projects', { method: 'POST', cookie: reset.cookie, body: {} })).body.code, 'PASSWORD_CHANGE_REQUIRED');
});

async function createAccount(client, founderCookie, role, username = `${role}.test`, permissions = [], isPresident = false) {
  const password = `${username}-first-password`;
  const created = await client.request('/api/admin/users', { method: 'POST', cookie: founderCookie, body: { username, displayName: `${role}测试账号`, role, permissions, password, isPresident } });
  assert.equal(created.status, 201);
  const ready = await loginReady(client, username, password, `${username}-ready-password`);
  return { ...ready, user: created.body.user };
}

test('members and viewers cannot access management or acquire admin-only president status', async t => {
  const client = await fixture(t), founder = await loginReady(client);
  for (const role of ['member', 'viewer']) {
    const account = await createAccount(client, founder.cookie, role);
    assert.equal(account.body.user.role, role);
    assert.deepEqual(account.body.user.permissions, []);
    for (const [route, method] of [['/api/admin/content', 'GET'], ['/api/admin/users', 'GET'], ['/api/admin/users', 'POST'], ['/api/admin/settings', 'PUT'], ['/api/admin/activities', 'POST'], ['/api/admin/projects/arbitrary', 'DELETE'], ['/api/admin/upload', 'POST']]) {
      assert.equal((await client.request(route, { method, cookie: account.cookie, ...(method === 'GET' ? {} : { body: {} }) })).status, 403);
    }
    assert.equal((await client.request('/api/content', { cookie: account.cookie })).status, 200);
    assert.equal(account.body.user.isPresident, false);
    assert.equal((await client.request(`/api/admin/users/${account.user.id}`, { method: 'PUT', cookie: founder.cookie, body: { isPresident: true } })).status, 400);
  }
  const common = { username: 'bad.permissions', displayName: '无效权限', password: 'bad-permission-password' };
  assert.equal((await client.request('/api/admin/users', { method: 'POST', cookie: founder.cookie, body: { ...common, role: 'admin', permissions: ['users:write'] } })).status, 400);
  assert.equal((await client.request('/api/admin/users', { method: 'POST', cookie: founder.cookie, body: { ...common, role: 'editor' } })).status, 400);
  assert.equal((await client.request('/api/admin/users', { method: 'POST', cookie: founder.cookie, body: { ...common, role: 'founder' } })).status, 400);
  assert.equal((await client.request('/api/admin/users', { method: 'POST', cookie: founder.cookie, body: { ...common, role: 'viewer', permissions: ['settings:write'] } })).status, 400);
  const admin = await createAccount(client, founder.cookie, 'admin');
  assert.equal((await client.request(`/api/admin/users/${admin.user.id}`, { method: 'PUT', cookie: admin.cookie, body: { role: 'founder' } })).status, 400);
  assert.equal((await client.request(`/api/admin/users/${admin.user.id}`, { method: 'PUT', cookie: founder.cookie, body: { role: 'member' } })).status, 200);
  assert.equal((await client.request('/api/auth/me', { cookie: admin.cookie })).body.user, null);
});

test('all admins see drafts and activity rich fields survive edits', async t => {
  const client = await fixture(t), founder = await loginReady(client), admin = await createAccount(client, founder.cookie, 'admin', 'scoped.admin', ['activities:write']);
  const seed = (await client.request('/api/content')).body.activities.find(activity => activity.album?.length);
  const created = await client.request('/api/admin/activities', { method: 'POST', cookie: founder.cookie, body: { ...seed, id: '', status: 'draft', title: '管理员可见草稿' } });
  assert.equal(created.status, 201);
  assert.deepEqual(created.body.activity.album, seed.album);
  assert.deepEqual(created.body.activity.preparation, seed.preparation);
  assert.equal(created.body.activity.timeCommitment, seed.timeCommitment);
  const draftId = created.body.activity.id;
  assert.ok((await client.request('/api/admin/content', { cookie: admin.cookie })).body.activities.some(item => item.id === draftId));
  assert.equal((await client.request(`/api/admin/activities/${draftId}`, { method: 'PUT', cookie: admin.cookie, body: { ...created.body.activity, title: '管理员编辑成功' } })).status, 200);
  const project = (await client.request('/api/content')).body.projects[0];
  const projectDraft = await client.request('/api/admin/projects', { method: 'POST', cookie: admin.cookie, body: { ...project, id: '', status: 'draft', title: '管理员项目草稿' } });
  assert.equal(projectDraft.status, 201);
  assert.ok((await client.request('/api/admin/content', { cookie: admin.cookie })).body.projects.some(item => item.id === projectDraft.body.project.id));
  assert.ok(!(await client.request('/api/content')).body.activities.some(item => item.id === draftId));
  assert.equal((await client.request(`/api/admin/activities/${draftId}`, { method: 'DELETE', cookie: admin.cookie })).status, 200);
});

test('an admin keeps inherent access and the current session when updating their display name', async t => {
  const client = await fixture(t), founder = await loginReady(client);
  const saved = await client.request(`/api/admin/users/${founder.body.user.id}`, { method: 'PUT', cookie: founder.cookie, body: { role: 'admin', permissions: [], displayName: '修改后管理员' } });
  assert.equal(saved.status, 200);
  assert.deepEqual(saved.body.user.permissions, contentPermissions);
  assert.equal((await client.request('/api/auth/me', { cookie: founder.cookie })).body.user.displayName, '修改后管理员');
});

test('site registrations persist and belong to the signed-in participant; viewers cannot register', async t => {
  const client = await fixture(t), founder = await loginReady(client);
  const member = await createAccount(client, founder.cookie, 'member'), other = await createAccount(client, founder.cookie, 'member', 'other.member');
  const admin = await createAccount(client, founder.cookie, 'admin'), viewer = await createAccount(client, founder.cookie, 'viewer');
  const seed = (await client.request('/api/content')).body.activities.find(item => item.kind === 'upcoming');
  const created = await client.request('/api/admin/activities', { method: 'POST', cookie: founder.cookie, body: { ...seed, id: '', title: '开放报名测试活动', date: '2099-10-18', isDemo: false, registrationOpen: true } });
  assert.equal(created.status, 201);
  const activityId = created.body.activity.id;
  assert.equal((await client.request('/api/registrations', { method: 'POST', body: { activityId } })).status, 401);
  assert.equal((await client.request('/api/registrations', { cookie: viewer.cookie })).status, 403);
  assert.equal((await client.request('/api/registrations', { method: 'POST', cookie: viewer.cookie, body: { activityId } })).status, 403);
  assert.equal((await client.request('/api/registrations', { method: 'POST', cookie: member.cookie, body: { activityId }, originOverride: 'https://untrusted.example' })).status, 403);
  for (const account of [member, admin, founder]) {
    const registered = await client.request('/api/registrations', { method: 'POST', cookie: account.cookie, body: { activityId, userId: other.user.id } });
    assert.equal(registered.status, 201);
    assert.equal(registered.body.registration.activityId, activityId);
    assert.ok(!('userId' in registered.body.registration));
    assert.equal((await client.request('/api/registrations', { method: 'POST', cookie: account.cookie, body: { activityId } })).status, 409);
  }
  assert.deepEqual((await client.request('/api/registrations', { cookie: other.cookie })).body.registrations, []);
  assert.equal((await client.request(`/api/registrations/${activityId}`, { method: 'DELETE', cookie: other.cookie })).status, 404);
  await client.restart();
  const registrations = (await client.request('/api/registrations', { cookie: member.cookie })).body.registrations;
  assert.equal(registrations.length, 1);
  assert.equal(registrations[0].activityId, activityId);
  assert.equal((await client.request(`/api/registrations/${activityId}`, { method: 'DELETE', cookie: member.cookie })).status, 200);
  assert.deepEqual((await client.request('/api/registrations', { cookie: member.cookie })).body.registrations, []);
  assert.equal((await client.request('/api/registrations', { cookie: admin.cookie })).body.registrations.length, 1);
  assert.equal((await client.request(`/api/admin/activities/${activityId}`, { method: 'DELETE', cookie: founder.cookie })).status, 200);
  assert.deepEqual((await client.request('/api/registrations', { cookie: admin.cookie })).body.registrations, []);
});

test('registration requires an explicitly open real future activity and a changed temporary password', async t => {
  const client = await fixture(t), founder = await loginReady(client), member = await createAccount(client, founder.cookie, 'member');
  const seed = (await client.request('/api/content')).body.activities.find(item => item.kind === 'upcoming');
  for (const [changes, expected] of [[{ registrationOpen: false }, 400], [{ isDemo: true }, 400], [{ kind: 'past' }, 400], [{ date: '2000-01-01' }, 400], [{ status: 'draft' }, 404]]) {
    const created = await client.request('/api/admin/activities', { method: 'POST', cookie: founder.cookie, body: { ...seed, id: '', date: '2099-10-18', isDemo: false, registrationOpen: true, ...changes } });
    assert.equal(created.status, 201);
    assert.equal((await client.request('/api/registrations', { method: 'POST', cookie: member.cookie, body: { activityId: created.body.activity.id } })).status, expected);
  }
  const created = await client.request('/api/admin/users', { method: 'POST', cookie: founder.cookie, body: { username: 'temporary.member', displayName: '临时社员', role: 'member', password: 'temporary-first-password' } });
  assert.equal(created.status, 201);
  const temporary = await login(client, 'temporary.member', 'temporary-first-password');
  assert.equal((await client.request('/api/registrations', { method: 'POST', cookie: temporary.cookie, body: { activityId: seed.id } })).body.code, 'PASSWORD_CHANGE_REQUIRED');
});

test('legacy admins and editors migrate to full admins without changing credentials or deleted content', async t => {
  const salt = 'legacy-test-salt', hash = `${salt}:${scryptSync(initialPassword, salt, 32).toString('hex')}`, token = 'f'.repeat(64);
  const client = await fixture(t, { async beforeCreate(config) {
    await mkdir(config.dataDir, { recursive: true });
    const legacy = new DatabaseSync(path.join(config.dataDir, 'chuanheng.sqlite'));
    legacy.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('admin','editor')), password_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, must_change_password INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
      CREATE TABLE site_settings (id INTEGER PRIMARY KEY CHECK(id = 1), payload TEXT NOT NULL, revision INTEGER NOT NULL);
      CREATE TABLE activities (id TEXT PRIMARY KEY, payload TEXT NOT NULL, revision INTEGER NOT NULL);
      CREATE TABLE projects (id TEXT PRIMARY KEY, payload TEXT NOT NULL, revision INTEGER NOT NULL);`);
    legacy.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, 1, 0)').run('old-founder', 'admin', '原管理员', 'admin', hash);
    legacy.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, 1, 0)').run('old-editor', 'legacy.editor', '原维护者', 'editor', hash);
    legacy.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(createHash('sha256').update(token).digest('hex'), 'old-editor', Date.now() + 60_000);
    legacy.prepare('INSERT INTO site_settings VALUES (1, ?, 5)').run(JSON.stringify({ clubName: '用户已编辑协会名称', intro: '保存用户编辑内容', aboutDescription: legacyAboutDescription }));
    legacy.prepare('INSERT INTO activities VALUES (?, ?, 4)').run('demo-autumn-hike', JSON.stringify({ id: 'demo-autumn-hike', title: '用户已编辑活动标题', isDemo: true, status: 'published', kind: 'upcoming', date: '2099-10-18' }));
    legacy.close();
  } });
  const founder = await login(client);
  assert.equal(founder.body.user.id, 'old-founder');
  assert.equal(founder.body.user.role, 'admin');
  assert.equal(founder.body.user.isPresident, false);
  assert.equal(founder.body.user.mustChangePassword, false);
  const editorCookie = `chuanheng_session=${token}`;
  const editor = (await client.request('/api/auth/me', { cookie: editorCookie })).body.user;
  assert.equal(editor.id, 'old-editor'); assert.equal(editor.role, 'admin'); assert.deepEqual(editor.permissions, contentPermissions);
  assert.equal(editor.isPresident, false);
  const content = (await client.request('/api/content')).body;
  assert.equal(content.settings.clubName, '用户已编辑协会名称'); assert.equal(content.settings.revision, 5);
  assert.equal(content.settings.semesterName, '2026 秋季学期');
  assert.equal(content.settings.aboutDescription, initialSettings.aboutDescription);
  assert.equal(content.activities.length, 4);
  const editedActivity = content.activities.find(activity => activity.id === 'demo-autumn-hike');
  assert.equal(editedActivity.title, '用户已编辑活动标题'); assert.equal(editedActivity.revision, 5);
  assert.ok(editedActivity.preparation.items.length);
  assert.ok(!content.activities.some(activity => activity.id === 'demo-forest-walk'));
  assert.equal(content.projects.length, 3);
  assert.equal((await client.request('/api/admin/settings', { method: 'PUT', cookie: editorCookie, body: { ...initialSettings, ...content.settings, intro: '原维护者保留编辑权限' } })).status, 200);
  const projectId = content.projects[0].id;
  assert.equal((await client.request(`/api/admin/projects/${projectId}`, { method: 'DELETE', cookie: founder.cookie })).status, 200);
  assert.equal((await client.request('/api/admin/activities/demo-november-trail', { method: 'DELETE', cookie: founder.cookie })).status, 200);
  await client.restart();
  assert.equal((await client.request('/api/content')).body.projects.length, 2);
  assert.equal((await client.request('/api/content')).body.activities.length, 3);
  assert.equal((await client.request('/api/auth/me', { cookie: editorCookie })).body.user.role, 'admin');
  const db = new DatabaseSync(path.join(client.config.dataDir, 'chuanheng.sqlite'));
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
  db.close();
  assert.equal((await login(client, 'legacy.editor')).body.user.role, 'admin');
});

test('four-role account migration preserves identities, sessions, memberships and deleted content without inventing a president', async t => {
  const salt = 'four-role-test-salt', hash = `${salt}:${scryptSync(initialPassword, salt, 32).toString('hex')}`;
  const tokens = { founder: 'a'.repeat(64), admin: 'b'.repeat(64), member: 'c'.repeat(64) };
  const activity = { ...initialActivities[0], isDemo: false, date: '2099-10-18', registrationOpen: true };
  const client = await fixture(t, { async beforeCreate(config) {
    await mkdir(config.dataDir, { recursive: true });
    const legacy = new DatabaseSync(path.join(config.dataDir, 'chuanheng.sqlite'));
    legacy.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('founder','admin','member','viewer')), permissions TEXT NOT NULL DEFAULT '[]', password_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, must_change_password INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL);
      CREATE TABLE site_settings (id INTEGER PRIMARY KEY CHECK(id = 1), payload TEXT NOT NULL, revision INTEGER NOT NULL);
      CREATE TABLE activities (id TEXT PRIMARY KEY, payload TEXT NOT NULL, revision INTEGER NOT NULL);
      CREATE TABLE projects (id TEXT PRIMARY KEY, payload TEXT NOT NULL, revision INTEGER NOT NULL);
      CREATE TABLE registrations (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, activity_id TEXT NOT NULL REFERENCES activities(id) ON DELETE CASCADE, created_at TEXT NOT NULL, UNIQUE(user_id, activity_id));`);
    for (const role of ['founder', 'admin', 'member', 'viewer']) {
      legacy.prepare('INSERT INTO users VALUES (?, ?, ?, ?, ?, ?, 1, 0)').run(`existing-${role}`, role === 'founder' ? 'admin' : `existing.${role}`, `原${role}账号`, role, JSON.stringify(role === 'admin' ? ['activities:write'] : []), hash);
      if (tokens[role]) legacy.prepare('INSERT INTO sessions VALUES (?, ?, ?)').run(createHash('sha256').update(tokens[role]).digest('hex'), `existing-${role}`, Date.now() + 60_000);
    }
    legacy.prepare('INSERT INTO site_settings VALUES (1, ?, 11)').run(JSON.stringify({ ...initialSettings, clubName: '保留原协会名称' }));
    legacy.prepare('INSERT INTO activities VALUES (?, ?, 8)').run(activity.id, JSON.stringify(activity));
    legacy.prepare('INSERT INTO registrations VALUES (?, ?, ?, ?)').run('existing-registration', 'existing-member', activity.id, '2026-09-01T00:00:00.000Z');
    legacy.close();
  } });
  for (const role of ['founder', 'admin', 'member']) {
    const current = (await client.request('/api/auth/me', { cookie: `chuanheng_session=${tokens[role]}` })).body.user;
    assert.equal(current.id, `existing-${role}`);
    assert.equal(current.role, role === 'founder' ? 'admin' : role);
    assert.equal(current.isPresident, false);
    assert.equal(current.mustChangePassword, false);
    assert.deepEqual(current.permissions, role === 'member' ? [] : contentPermissions);
  }
  const admin = await login(client, 'existing.admin');
  assert.equal(admin.body.user.role, 'admin');
  assert.equal((await client.request('/api/admin/users', { cookie: admin.cookie })).status, 200);
  assert.deepEqual((await client.request('/api/site-status')).body, { paused: false, revision: 1 });
  assert.equal((await client.request('/api/admin/site-status', { method: 'POST', cookie: admin.cookie, body: { paused: true, password: initialPassword, revision: 1 } })).status, 403);
  const content = (await client.request('/api/content')).body;
  assert.equal(content.settings.clubName, '保留原协会名称');
  assert.equal(content.settings.revision, 11);
  assert.deepEqual(content.activities.map(item => item.id), [activity.id]);
  assert.deepEqual(content.projects, []);
  assert.equal((await client.request('/api/registrations', { cookie: `chuanheng_session=${tokens.member}` })).body.registrations[0].id, 'existing-registration');
  await client.restart();
  assert.equal((await client.request('/api/content')).body.activities.length, 1);
  assert.equal((await client.request('/api/content')).body.projects.length, 0);
  const db = new DatabaseSync(path.join(client.config.dataDir, 'chuanheng.sqlite'));
  try { assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []); }
  finally { db.close(); }
});

test('site status changes require a president admin, a changed own password, valid input and the current revision', async t => {
  const client = await fixture(t);
  assert.deepEqual((await client.request('/api/site-status')).body, { paused: false, revision: 1 });
  const input = { paused: true, password: readyPassword, revision: 1 };
  assert.equal((await client.request('/api/admin/site-status', { method: 'POST', body: input })).status, 401);
  const temporary = await login(client);
  const denied = await client.request('/api/admin/site-status', { method: 'POST', cookie: temporary.cookie, body: { ...input, password: initialPassword } });
  assert.equal(denied.status, 403);
  assert.equal(denied.body.code, 'PASSWORD_CHANGE_REQUIRED');
  const changed = await client.request('/api/auth/password', { method: 'POST', cookie: temporary.cookie, body: { currentPassword: initialPassword, newPassword: readyPassword } });
  assert.equal(changed.status, 200);
  const president = { ...temporary, body: changed.body };
  for (const role of ['admin', 'member', 'viewer']) {
    const account = await createAccount(client, president.cookie, role, `status.${role}`);
    assert.equal((await client.request('/api/admin/site-status', { method: 'POST', cookie: account.cookie, body: { ...input, password: `status.${role}-ready-password` } })).status, 403);
  }
  for (const body of [
    { ...input, paused: 'true' }, { ...input, revision: 0 }, { ...input, revision: undefined },
    { ...input, password: '' }, { ...input, password: 123 }, { ...input, password: 'x'.repeat(129) },
  ]) assert.equal((await client.request('/api/admin/site-status', { method: 'POST', cookie: president.cookie, body })).status, 400);
  assert.equal((await client.request('/api/admin/site-status', { method: 'POST', cookie: president.cookie, body: input, originOverride: 'https://untrusted.example' })).status, 403);
  assert.equal((await client.request('/api/admin/site-status', { method: 'POST', cookie: president.cookie, body: { ...input, password: 'wrong-password' } })).status, 400);
  assert.equal((await client.request('/api/admin/site-status', { method: 'POST', cookie: president.cookie, body: { ...input, password: 'status.admin-ready-password' } })).status, 400);
  assert.deepEqual((await client.request('/api/site-status')).body, { paused: false, revision: 1 });
  const paused = await client.request('/api/admin/site-status', { method: 'POST', cookie: president.cookie, body: input });
  assert.equal(paused.status, 200);
  assert.deepEqual(paused.body, { paused: true, revision: 2 });
  assert.equal((await client.request('/api/admin/site-status', { method: 'POST', cookie: president.cookie, body: { ...input, paused: false } })).status, 409);
  assert.deepEqual((await client.request('/api/site-status')).body, paused.body);
  const restored = await client.request('/api/admin/site-status', { method: 'POST', cookie: president.cookie, body: { paused: false, password: readyPassword, revision: 2 } });
  assert.equal(restored.status, 200);
  assert.deepEqual(restored.body, { paused: false, revision: 3 });
});

test('failed president password confirmations are throttled independently of login', async t => {
  const client = await fixture(t), president = await loginReady(client);
  for (let i = 0; i < 5; i++) {
    assert.equal((await client.request('/api/admin/site-status', { method: 'POST', cookie: president.cookie, body: { paused: true, password: 'wrong-password', revision: 1 } })).status, 400);
  }
  assert.equal((await client.request('/api/admin/site-status', { method: 'POST', cookie: president.cookie, body: { paused: true, password: readyPassword, revision: 1 } })).status, 429);
  assert.equal((await login(client, 'admin', readyPassword)).status, 200);
  assert.deepEqual((await client.request('/api/site-status')).body, { paused: false, revision: 1 });
});

test('pause persists and blocks public content, nonadmin login and registrations while admin recovery remains available', async t => {
  const client = await fixture(t), president = await loginReady(client);
  const admin = await createAccount(client, president.cookie, 'admin', 'pause.admin');
  const member = await createAccount(client, president.cookie, 'member', 'pause.member');
  const viewer = await createAccount(client, president.cookie, 'viewer', 'pause.viewer');
  const seed = (await client.request('/api/content')).body.activities.find(item => item.kind === 'upcoming');
  const activity = await client.request('/api/admin/activities', { method: 'POST', cookie: admin.cookie, body: { ...seed, id: '', isDemo: false, date: '2099-10-18', registrationOpen: true } });
  assert.equal(activity.status, 201);
  const activityId = activity.body.activity.id;
  assert.equal((await client.request('/api/registrations', { method: 'POST', cookie: member.cookie, body: { activityId } })).status, 201);
  assert.equal((await client.request('/api/admin/site-status', { method: 'POST', cookie: president.cookie, body: { paused: true, password: readyPassword, revision: 1 } })).status, 200);
  await client.restart();
  assert.deepEqual((await client.request('/api/site-status')).body, { paused: true, revision: 2 });
  for (const cookie of ['', member.cookie, viewer.cookie]) {
    for (const [route, method, body] of [
      ['/api/content', 'GET'], ['/api/registrations', 'GET'], ['/api/registrations', 'POST', { activityId }], [`/api/registrations/${activityId}`, 'DELETE'],
    ]) {
      const result = await client.request(route, { method, cookie, body });
      assert.equal(result.status, 503);
      assert.equal(result.body.code, 'SITE_PAUSED');
    }
    assert.equal((await client.request('/api/auth/me', { cookie })).status, 200);
    assert.deepEqual((await client.request('/api/site-status', { cookie })).body, { paused: true, revision: 2 });
  }
  const db = new DatabaseSync(path.join(client.config.dataDir, 'chuanheng.sqlite'));
  const sessionsBefore = db.prepare('SELECT COUNT(*) AS count FROM sessions').get().count;
  db.close();
  for (const role of ['member', 'viewer']) {
    const rejected = await client.request('/api/auth/login', { method: 'POST', body: { username: `pause.${role}`, password: `pause.${role}-ready-password` } });
    assert.equal(rejected.status, 503);
    assert.equal(rejected.body.code, 'SITE_PAUSED');
    assert.equal(rejected.cookie, undefined);
  }
  const reopened = new DatabaseSync(path.join(client.config.dataDir, 'chuanheng.sqlite'));
  try { assert.equal(reopened.prepare('SELECT COUNT(*) AS count FROM sessions').get().count, sessionsBefore); }
  finally { reopened.close(); }
  assert.equal((await client.request('/api/auth/login', { method: 'POST', body: { username: 'pause.member', password: 'wrong-password' } })).status, 401);
  assert.equal((await login(client, 'pause.admin', 'pause.admin-ready-password')).body.user.role, 'admin');
  for (const route of ['/api/content', '/api/admin/content', '/api/admin/users', '/api/registrations']) assert.equal((await client.request(route, { cookie: admin.cookie })).status, 200);
  assert.equal((await client.request('/api/admin/site-status', { method: 'POST', cookie: admin.cookie, body: { paused: false, password: 'pause.admin-ready-password', revision: 2 } })).status, 403);
  assert.equal((await client.request('/api/auth/logout', { method: 'POST', cookie: member.cookie })).status, 200);
  assert.deepEqual((await client.request('/api/auth/me', { cookie: member.cookie })).body, { user: null });
  const restored = await client.request('/api/admin/site-status', { method: 'POST', cookie: president.cookie, body: { paused: false, password: readyPassword, revision: 2 } });
  assert.equal(restored.status, 200);
  assert.equal((await client.request('/api/content')).status, 200);
  assert.equal((await login(client, 'pause.viewer', 'pause.viewer-ready-password')).body.user.role, 'viewer');
  const restoredMember = await login(client, 'pause.member', 'pause.member-ready-password');
  assert.equal((await client.request('/api/registrations', { cookie: restoredMember.cookie })).body.registrations[0].activityId, activityId);
});

test('ordinary settings cannot change pause state and president flags validate against roles', async t => {
  const client = await fixture(t), president = await loginReady(client), admin = await createAccount(client, president.cookie, 'admin', 'settings.admin');
  const settings = (await client.request('/api/content')).body.settings;
  const saved = await client.request('/api/admin/settings', { method: 'PUT', cookie: admin.cookie, body: { ...settings, paused: true, isPaused: true, siteStatus: { paused: true } } });
  assert.equal(saved.status, 200);
  assert.ok(!('paused' in saved.body.settings) && !('siteStatus' in saved.body.settings));
  assert.deepEqual((await client.request('/api/site-status')).body, { paused: false, revision: 1 });
  for (const role of ['member', 'viewer']) {
    assert.equal((await client.request('/api/admin/users', { method: 'POST', cookie: admin.cookie, body: { username: `invalid.${role}`, displayName: '无效社长', role, isPresident: true, password: 'invalid-president-password' } })).status, 400);
  }
  for (const flag of [null, 'true', 1]) {
    assert.equal((await client.request(`/api/admin/users/${admin.user.id}`, { method: 'PUT', cookie: admin.cookie, body: { isPresident: flag } })).status, 400);
  }
});

test('paused sites protect the final active president until another president can restore service', async t => {
  const client = await fixture(t), president = await loginReady(client), admin = await createAccount(client, president.cookie, 'admin', 'recovery.admin');
  assert.equal((await client.request('/api/admin/site-status', { method: 'POST', cookie: president.cookie, body: { paused: true, password: readyPassword, revision: 1 } })).status, 200);
  for (const change of [{ role: 'member' }, { role: 'viewer' }, { active: false }, { isPresident: false }]) {
    assert.equal((await client.request(`/api/admin/users/${president.body.user.id}`, { method: 'PUT', cookie: admin.cookie, body: change })).status, 400);
  }
  assert.equal((await client.request(`/api/admin/users/${president.body.user.id}`, { method: 'DELETE', cookie: admin.cookie })).status, 400);
  assert.equal((await client.request('/api/auth/me', { cookie: president.cookie })).body.user.isPresident, true);
  const designated = await client.request(`/api/admin/users/${admin.user.id}`, { method: 'PUT', cookie: president.cookie, body: { isPresident: true } });
  assert.equal(designated.status, 200);
  assert.equal(designated.body.user.isPresident, true);
  const replacement = await login(client, 'recovery.admin', 'recovery.admin-ready-password');
  assert.equal((await client.request(`/api/admin/users/${president.body.user.id}`, { method: 'PUT', cookie: replacement.cookie, body: { isPresident: false } })).status, 200);
  assert.equal((await client.request('/api/admin/site-status', { method: 'POST', cookie: replacement.cookie, body: { paused: false, password: 'recovery.admin-ready-password', revision: 2 } })).status, 200);
  assert.equal((await client.request('/api/content')).status, 200);
});

test('paused production serves the login shell and runtime assets but gates uploads and static content', async t => {
  const client = await fixture(t, { production: true }), president = await loginReady(client);
  await mkdir(path.join(client.config.distDir, 'assets'), { recursive: true });
  await mkdir(path.join(client.config.distDir, 'images'), { recursive: true });
  await mkdir(path.join(client.config.distDir, 'documents'), { recursive: true });
  await writeFile(path.join(client.config.distDir, 'index.html'), '<html>登录应用</html>');
  const assets = {
    'assets/app.js': 'export const login = true;', 'assets/app.css': 'body{color:black}',
    'assets/app.woff2': 'fixture font', 'images/private.webp': 'fixture content image',
    'documents/private.pdf': 'fixture content document',
  };
  for (const [filename, contents] of Object.entries(assets)) await writeFile(path.join(client.config.distDir, filename), contents);
  const uploadedFilename = '12345678-1234-1234-1234-123456789abc.png';
  await writeFile(path.join(client.config.uploadDir, uploadedFilename), 'fixture uploaded image');
  for (const route of ['/images/private.webp', '/documents/private.pdf', `/uploads/${uploadedFilename}`]) assert.equal((await client.request(route)).status, 200);
  assert.equal((await client.request('/api/admin/site-status', { method: 'POST', cookie: president.cookie, body: { paused: true, password: readyPassword, revision: 1 } })).status, 200);
  for (const route of ['/', '/login', '/admin', '/activities/demo-forest-walk', '/assets/app.js', '/assets/app.css', '/assets/app.woff2']) {
    assert.equal((await client.request(route)).status, 200);
  }
  for (const route of ['/images/private.webp', '/documents/private.pdf', `/uploads/${uploadedFilename}`]) {
    const denied = await client.request(route);
    assert.equal(denied.status, 503);
    assert.equal(denied.body.code, 'SITE_PAUSED');
    assert.equal((await client.request(route, { cookie: president.cookie })).status, 200);
    const head = await client.request(route, { method: 'HEAD' });
    assert.equal(head.status, 503);
    assert.equal(head.body, '');
  }
  for (const route of ['/IMAGES/private.webp', '/DoCs/private.pdf', `/UpLoAds/${uploadedFilename}`, '/%69mages/private.webp', '/images%2Fprivate.webp']) {
    const denied = await client.request(route);
    assert.equal(denied.status, 503);
    assert.equal(denied.body.code, 'SITE_PAUSED');
  }
  assert.equal((await client.request('/api/site-status')).status, 200);
});
