import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/index.mjs';

const initialPassword = 'test-initial-only-24-characters';
const readyPassword = 'test-ready-password-1234';
async function fixture(t, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'chuanheng-backend-test-'));
  const config = { dataDir: path.join(root, 'data'), uploadDir: path.join(root, 'uploads'), distDir: path.join(root, 'dist'), initialPassword, ...options };
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
      return { status: response.status, body: type.includes('application/json') ? await response.json() : await response.text(), cookie: response.headers.get('set-cookie')?.split(';')[0], headers: response.headers };
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
  assert.equal(result.body.activities.length, 4);
  assert.ok(result.body.activities.every(item => item.isDemo && item.title.includes('示例') && item.revision === 1));
  assert.deepEqual(result.body.projects, []);
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
  const published = await client.request(`/api/admin/activities/${draft.id}`, { method: 'PUT', cookie, body: { ...draft, title: '已发布活动', status: 'published' } });
  assert.equal(published.status, 200);
  assert.equal(published.body.activity.revision, 2);
  assert.equal((await client.request(`/api/admin/activities/${draft.id}`, { method: 'PUT', cookie, body: draft })).status, 409);
  const missingRevision = { ...published.body.activity }; delete missingRevision.revision;
  assert.equal((await client.request(`/api/admin/activities/${draft.id}`, { method: 'PUT', cookie, body: missingRevision })).status, 409);
  assert.equal((await client.request(`/api/admin/activities/${draft.id}?revision=1`, { method: 'DELETE', cookie })).status, 409);
  await client.restart();
  cookie = (await login(client, 'admin', readyPassword)).cookie;
  const persisted = (await client.request('/api/content')).body.activities.find(item => item.id === draft.id);
  assert.equal(persisted.title, '已发布活动'); assert.equal(persisted.revision, 2);
  assert.equal((await client.request(`/api/admin/activities/${draft.id}?revision=2`, { method: 'DELETE', cookie })).status, 200);
  assert.equal((await client.request(`/api/admin/activities/${draft.id}`, { method: 'DELETE', cookie })).status, 404);
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
  const project = { title: '待定项目示例', mountain: '待定', elevation: '', plannedDate: '', duration: '', summary: '计划待定', description: '', trainingPlan: '按项目更新', supportNeeds: '按项目更新', cooperationValue: '按协议确定', image: '/images/alpine.webp', status: 'draft', isDemo: true };
  const created = await client.request('/api/admin/projects', { method: 'POST', body: project, cookie });
  assert.equal(created.status, 201);
  assert.deepEqual((await client.request('/api/content')).body.projects, []);
  const updated = await client.request(`/api/admin/projects/${created.body.project.id}`, { method: 'PUT', cookie, body: { ...created.body.project, status: 'published' } });
  assert.equal(updated.status, 200); assert.equal(updated.body.project.revision, 2);
  assert.equal((await client.request('/api/content')).body.projects.length, 1);
  assert.equal((await client.request(`/api/admin/projects/${created.body.project.id}`, { method: 'DELETE', cookie })).status, 200);
});

test('editors publish content but cannot manage accounts; the final admin cannot be disabled or demoted', async t => {
  const client = await fixture(t), { cookie: adminCookie, body: admin } = await loginReady(client);
  const editor = await client.request('/api/admin/users', { method: 'POST', cookie: adminCookie, body: { username: 'editor.one', displayName: '维护同学', password: 'editor-password-1234', role: 'editor' } });
  assert.equal(editor.status, 201);
  const { cookie: editorCookie } = await loginReady(client, 'editor.one', 'editor-password-1234', 'editor-ready-password-1234');
  assert.equal((await client.request('/api/admin/content', { cookie: editorCookie })).status, 200);
  const settings = (await client.request('/api/content')).body.settings;
  assert.equal((await client.request('/api/admin/settings', { method: 'PUT', cookie: editorCookie, body: { ...settings, intro: '维护者已更新' } })).status, 200);
  assert.equal((await client.request('/api/admin/users', { cookie: editorCookie })).status, 403);
  assert.equal((await client.request('/api/admin/users', { method: 'POST', cookie: editorCookie, body: {} })).status, 403);
  assert.equal((await client.request(`/api/admin/users/${admin.user.id}`, { method: 'DELETE', cookie: adminCookie })).status, 400);
  assert.equal((await client.request(`/api/admin/users/${admin.user.id}`, { method: 'PUT', cookie: adminCookie, body: { role: 'editor' } })).status, 400);
  assert.equal((await client.request(`/api/admin/users/${editor.body.user.id}`, { method: 'DELETE', cookie: adminCookie })).status, 200);
  assert.equal((await client.request('/api/admin/content', { cookie: editorCookie })).status, 401);
  assert.equal((await client.request('/api/auth/login', { method: 'POST', body: { username: 'editor.one', password: 'editor-password-1234' } })).status, 401);
  const users = (await client.request('/api/admin/users', { cookie: adminCookie })).body.users;
  assert.equal(users.find(user => user.id === editor.body.user.id).active, false);
  assert.ok(users.every(user => !('password_hash' in user)));
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
  for (const route of ['/', '/activities', '/activities/demo-forest-walk', '/about', '/team', '/admin', '/projects/example-project']) {
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
  const user = await client.request('/api/admin/users', { method: 'POST', cookie, body: { username: 'reset.test', displayName: '密码重置测试', password: 'reset-first-password', role: 'editor' } });
  const ready = await loginReady(client, 'reset.test', 'reset-first-password', 'reset-ready-password');
  assert.equal((await client.request('/api/admin/content', { cookie: ready.cookie })).status, 200);
  assert.equal((await client.request(`/api/admin/users/${user.body.user.id}`, { method: 'PUT', cookie, body: { password: 'reset-new-password' } })).status, 200);
  assert.equal((await client.request('/api/admin/content', { cookie: ready.cookie })).status, 401);
  const reset = await login(client, 'reset.test', 'reset-new-password');
  assert.equal(reset.body.user.mustChangePassword, true);
  assert.equal((await client.request('/api/admin/projects', { method: 'POST', cookie: reset.cookie, body: {} })).body.code, 'PASSWORD_CHANGE_REQUIRED');
});
