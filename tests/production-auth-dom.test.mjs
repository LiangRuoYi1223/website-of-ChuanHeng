import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { act, createElement } from 'react';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { mkdir, mkdtemp, realpath, rmdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dom = new JSDOM('<!doctype html><div id="app"></div>', { url: 'https://frontend.invalid/login', pretendToBeVisual: true });
const originals = new Map();
function expose(key, value) { originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value }); }
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'HTMLInputElement', 'FormData', 'File', 'Blob', 'Event', 'MouseEvent']) expose(key, key === 'window' ? dom.window : key === 'document' ? dom.window.document : key === 'navigator' ? dom.window.navigator : dom.window[key]);
expose('localStorage', dom.window.localStorage);
expose('IS_REACT_ACT_ENVIRONMENT', true);
expose('fetch', () => { throw Error('No real network requests are allowed in production-auth tests'); });
const { createRoot } = await import('react-dom/client');
const { MemoryRouter, Routes, Route } = await import('react-router-dom');
const member = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'member@example.invalid', app_metadata: {}, user_metadata: { role: 'admin' } };
const admin = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', email: 'admin@example.invalid', app_metadata: { role: 'admin' }, user_metadata: {} };
const activity = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', title: '合成公开活动', published: true, isDemo: false, status: '报名中', registrationOpen: true, registrationStart: new Date(Date.now() - 86400000).toISOString(), registrationDeadline: new Date(Date.now() + 86400000).toISOString(), dateStart: new Date(Date.now() + 2 * 86400000).toISOString(), dateEnd: new Date(Date.now() + 3 * 86400000).toISOString() };
const controller = { session: null, verified: null, calls: [], applications: new Map(), subscribers: new Set(), signupConfirmation: true, writeError: null, insertBarrier: null };
const mockBackend = {
  auth: {
    getSession: async () => ({ data: { session: controller.session ? { user: controller.session, access_token: 'synthetic-test-token' } : null }, error: null }),
    getUser: async () => { controller.calls.push({ operation: 'getUser' }); return { data: { user: controller.verified }, error: controller.verified ? null : { name: 'AuthSessionMissingError' } }; },
    onAuthStateChange(callback) { controller.subscribers.add(callback); return { data: { subscription: { unsubscribe: () => controller.subscribers.delete(callback) } } }; },
    async signInWithPassword(credentials) { controller.calls.push({ operation: 'signIn', credentials }); controller.session = member; controller.verified = member; for (const callback of controller.subscribers) callback('SIGNED_IN', { user: member }); return { data: { user: member }, error: null }; },
    async signUp(credentials) { controller.calls.push({ operation: 'signUp', credentials }); if (controller.signupConfirmation) return { data: { user: member, session: null }, error: null }; controller.session = member; controller.verified = member; return { data: { user: member, session: { user: member } }, error: null }; },
  },
  from(table) {
    if (table === 'content_items') return { select(columns) { controller.calls.push({ operation: 'content-read', columns }); return { order: async () => ({ data: [], error: null }) }; } };
    assert.equal(table, 'applications');
    return {
      select(columns) {
        const filters = {};
        const chain = { eq(key, value) { filters[key] = value; return chain; }, async maybeSingle() { controller.calls.push({ operation: 'application-read', columns, filters }); return { data: controller.applications.get(`${filters.activity_id}:${filters.user_id}`) || null, error: null }; } };
        return chain;
      },
      insert(payload) {
        controller.calls.push({ operation: 'application-insert', payload });
        return { select: () => ({ async single() {
          if (controller.insertBarrier) await controller.insertBarrier;
          if (controller.writeError) return { data: null, error: controller.writeError };
          const key = `${payload.activity_id}:${payload.user_id}`;
          if (controller.applications.has(key)) return { data: null, error: { code: '23505' } };
          const row = { id: crypto.randomUUID(), created_at: new Date().toISOString() };
          controller.applications.set(key, row);
          return { data: row, error: null };
        } }) };
      },
    };
  },
};
expose('__PRODUCTION_AUTH_BACKEND', mockBackend);
const projectRoot = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const artifactsRoot = path.join(projectRoot, 'artifacts');
await mkdir(artifactsRoot, { recursive: true });
const scratch = await mkdtemp(path.join(artifactsRoot, 'production-auth-dom-'));
const bundlePath = path.join(scratch, 'components.mjs');
let root;
after(async () => {
  if (root) await act(async () => root.unmount());
  dom.window.close();
  for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  assert.equal(path.dirname(scratch), artifactsRoot);
  await unlink(bundlePath).catch(error => { if (error.code !== 'ENOENT') throw error; });
  await rmdir(scratch);
});
const output = await build({
  stdin: { contents: "export {AdminPage,LoginPage} from './src/pages/Admin.jsx'; export {default as ActivityApplication} from './src/applications/ActivityApplication.jsx';", resolveDir: projectRoot, sourcefile: 'production-auth-dom.jsx', loader: 'jsx' },
  absWorkingDir: projectRoot, bundle: true, write: false, platform: 'node', format: 'esm', target: 'node22', jsx: 'automatic', packages: 'external', loader: { '.css': 'empty' },
  define: { 'import.meta.env': JSON.stringify({ PROD: true, DEV: false, MODE: 'production', VITE_CONTENT_MODE: 'preview', VITE_TERRAIN_TILE_URL: 'offline' }) }, logLevel: 'silent',
  plugins: [{ name: 'synthetic-backend-only', setup(builder) {
    builder.onResolve({ filter: /(?:^|[\\/])backend\.js$/ }, () => ({ path: 'backend', namespace: 'production-test' }));
    builder.onLoad({ filter: /^backend$/, namespace: 'production-test' }, () => ({ contents: "export const supabase=globalThis.__PRODUCTION_AUTH_BACKEND; export const isBackendConfigured=true; export const backendConfigurationError='';", loader: 'js' }));
  } }],
});
await writeFile(bundlePath, output.outputFiles[0].text, 'utf8');
const { AdminPage, LoginPage, ActivityApplication } = await import(pathToFileURL(bundlePath).href);
const container = dom.window.document.getElementById('app');
const text = node => node.textContent.replace(/\s+/g, ' ').trim();
const button = label => [...container.querySelectorAll('button')].find(node => text(node) === label);
async function click(node) { assert.ok(node); await act(async () => { node.focus(); node.click(); }); }
async function waitFor(predicate, reason) { const deadline = Date.now() + 4000; while (Date.now() < deadline) { if (predicate()) return; await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); } assert.fail(`Timed out waiting for ${reason}: ${text(container).slice(-900)}`); }
async function fill(name, value) { const input = container.querySelector(`[name="${name}"]`); assert.ok(input); await act(async () => { input.value = value; input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); }); }
async function mount(location) {
  if (root) await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () => root.render(createElement(MemoryRouter, { initialEntries: [location] }, createElement(Routes, null,
    createElement(Route, { path: '/login', element: createElement(LoginPage) }),
    createElement(Route, { path: '/admin/*', element: createElement(AdminPage) }),
    createElement(Route, { path: '/activities/:id', element: createElement(ActivityApplication, { activity }) }),
    createElement(Route, { path: '/', element: createElement('p', null, '已返回网站首页') }),
  ))));
}
function reset() { controller.calls = []; controller.session = null; controller.verified = null; controller.applications.clear(); controller.signupConfirmation = true; controller.writeError = null; controller.insertBarrier = null; localStorage.clear(); }

test('production auth and activity application use verified identities and real schema results', async t => {
  await t.test('preview query and user-editable metadata cannot grant production administration', async () => {
    reset(); controller.session = { ...member, app_metadata: { role: 'admin' } }; controller.verified = member;
    await mount('/admin/routes?preview=1');
    await waitFor(() => text(container).includes('当前账号没有管理权限'), 'verified authorization failure');
    assert.ok(!text(container).includes('本地设计预览'));
    assert.equal(button('新建路线'), undefined);
    assert.equal(controller.calls.filter(call => call.operation === 'content-read').length, 0);
    assert.ok(controller.calls.some(call => call.operation === 'getUser'));
  });

  await t.test('a verified administrator reads the current content_items schema without local fallback', async () => {
    reset(); controller.session = admin; controller.verified = admin;
    await mount('/admin/routes?preview=1');
    await waitFor(() => button('新建路线'), 'verified cloud administration');
    assert.ok(!text(container).includes('本地设计预览'));
    const call = controller.calls.find(item => item.operation === 'content-read');
    assert.equal(call.columns, 'id,kind,payload,published,created_at');
  });

  await t.test('email confirmation signup does not claim an authenticated session', async () => {
    reset();
    await mount('/login?mode=register');
    await fill('email', 'synthetic-new@example.invalid');
    await fill('password', 'Synthetic-test-password-123');
    await fill('confirmation', 'Synthetic-test-password-123');
    await click(button('创建账号'));
    await waitFor(() => text(container).includes('验证邮件将发送到邮箱'), 'email confirmation notice');
    assert.ok(!text(container).includes('账号已注册并登录'));
    assert.equal(controller.calls.find(call => call.operation === 'signUp').credentials.options.emailRedirectTo, 'https://frontend.invalid/login');
  });

  await t.test('login returns to the activity and submission waits for the application row response', async () => {
    reset();
    const returnPath = `/activities/${activity.id}#application`;
    await mount(`/login?next=${encodeURIComponent(returnPath)}`);
    await fill('email', 'member@example.invalid');
    await fill('password', 'Synthetic-test-password-123');
    await click(button('登录'));
    await waitFor(() => button('确认提交报名申请'), 'authenticated activity return');
    let release;
    controller.insertBarrier = new Promise(resolve => { release = resolve; });
    await click(button('确认提交报名申请'));
    assert.ok(!text(container).includes('报名申请已提交'), 'an in-flight request must not simulate success');
    assert.equal(button('正在提交…').disabled, true);
    await act(async () => release());
    await waitFor(() => text(container).includes('报名申请已提交'), 'confirmed application row');
    const insertion = controller.calls.find(call => call.operation === 'application-insert');
    assert.deepEqual(insertion.payload, { activity_id: activity.id, user_id: member.id, payload: {} });
    assert.equal(controller.calls.filter(call => call.operation === 'application-insert').length, 1);
  });

  await t.test('application permission errors are visible and never become success', async () => {
    reset(); controller.session = member; controller.verified = member; controller.writeError = { code: '42501' };
    await mount(`/activities/${activity.id}`);
    await waitFor(() => button('确认提交报名申请'), 'application form');
    await click(button('确认提交报名申请'));
    await waitFor(() => container.querySelector('[role="alert"]'), 'application write failure');
    assert.match(text(container.querySelector('[role="alert"]')), /报名未完成/);
    assert.ok(!text(container).includes('报名申请已提交'));
    assert.equal(controller.applications.size, 0);
  });

  await t.test('switching accounts during submission never shows the prior account application as the new account result', async () => {
    reset(); controller.session = member; controller.verified = member;
    await mount(`/activities/${activity.id}`);
    await waitFor(() => button('确认提交报名申请'), 'member application form');
    let release;
    controller.insertBarrier = new Promise(resolve => { release = resolve; });
    await click(button('确认提交报名申请'));
    await act(async () => {
      controller.session = admin; controller.verified = admin;
      for (const callback of controller.subscribers) callback('SIGNED_IN', { user: admin });
    });
    await waitFor(() => text(container).includes(admin.email), 'new account application form');
    await act(async () => release());
    assert.ok(!text(container).includes('报名申请已提交'), 'the old account response must not become the new account success state');
    assert.ok(text(container).includes(admin.email));
    assert.equal(controller.applications.has(`${activity.id}:${admin.id}`), false);
  });

  await t.test('external login return URLs are ignored', async () => {
    reset();
    await mount('/login?next=https%3A%2F%2Foutside.invalid');
    await fill('email', 'member@example.invalid');
    await fill('password', 'Synthetic-test-password-123');
    await click(button('登录'));
    await waitFor(() => text(container).includes('已返回网站首页'), 'safe default login destination');
  });
});
