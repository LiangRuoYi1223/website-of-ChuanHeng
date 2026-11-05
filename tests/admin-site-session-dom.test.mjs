import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { act, createElement } from 'react';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { mkdir, mkdtemp, realpath, rmdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dom = new JSDOM('<!doctype html><div id="admin"></div><div id="public"></div>', { url: 'https://frontend.invalid/', pretendToBeVisual: true });
const originals = new Map();
function expose(key, value) { originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value }); }
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'HTMLInputElement', 'FormData', 'File', 'Blob', 'Event', 'MouseEvent']) expose(key, key === 'window' ? dom.window : key === 'document' ? dom.window.document : key === 'navigator' ? dom.window.navigator : dom.window[key]);
expose('localStorage', dom.window.localStorage);
expose('IS_REACT_ACT_ENVIRONMENT', true);
expose('IntersectionObserver', class { observe() {} disconnect() {} });
expose('fetch', () => { throw Error('No real network requests in session navigation tests'); });
dom.window.scrollTo = () => {};
dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
const { createRoot } = await import('react-dom/client');
const { MemoryRouter } = await import('react-router-dom');
const admin = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', email: 'admin@example.invalid', app_metadata: { role: 'admin' }, user_metadata: {} };
const member = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', email: 'member@example.invalid', app_metadata: {}, user_metadata: { role: 'admin' } };
const controller = { session: null, verified: null, subscribers: new Set(), calls: [], nextVerification: null, verificationError: null };
const backend = {
  async rpc(name){assert.equal(name,'get_member_profile');if(controller.nextProfile){const result=controller.nextProfile;controller.nextProfile=null;return result;}return {data:{userId:controller.verified?.id,username:controller.username || '',realName:'',phone:'',updatedAt:null}};},
  auth: {
    async getSession() { controller.calls.push('getSession'); return { data: { session: controller.session ? { user: controller.session } : null }, error: null }; },
    async getUser() {
      controller.calls.push('getUser');
      if (controller.nextVerification) { const pending = controller.nextVerification; controller.nextVerification = null; return pending; }
      return { data: { user: controller.verified }, error: controller.verificationError };
    },
    onAuthStateChange(callback) { controller.subscribers.add(callback); return { data: { subscription: { unsubscribe: () => controller.subscribers.delete(callback) } } }; },
    async signInWithPassword() { emit('SIGNED_IN', admin); return { data: { user: admin }, error: null }; },
    async signOut() { controller.calls.push('signOut'); emit('SIGNED_OUT', null); return { error: null }; },
  },
  from(table) { assert.equal(table, 'content_items'); return { select: () => ({ order: async () => ({ data: [], error: null }) }) }; },
};
expose('__SESSION_NAV_BACKEND', backend);
const projectRoot = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const artifactsRoot = path.join(projectRoot, 'artifacts');
await mkdir(artifactsRoot, { recursive: true });
const scratch = await mkdtemp(path.join(artifactsRoot, 'admin-site-session-'));
const bundlePath = path.join(scratch, 'app.mjs');
const output = await build({
  entryPoints: ['src/App.jsx'], absWorkingDir: projectRoot, bundle: true, write: false, platform: 'node', format: 'esm', target: 'node24', jsx: 'automatic', packages: 'external', loader: { '.css': 'empty' },
  define: { 'import.meta.env': JSON.stringify({ PROD: true, DEV: false, MODE: 'production', VITE_CONTENT_MODE: 'live', VITE_TERRAIN_TILE_URL: 'offline' }) }, logLevel: 'silent',
  plugins: [{ name: 'synthetic-session-backend', setup(builder) {
    builder.onResolve({ filter: /(?:^|[\\/])backend\.js$/ }, () => ({ path: 'backend', namespace: 'session-test' }));
    builder.onLoad({ filter: /^backend$/, namespace: 'session-test' }, () => ({ contents: 'export const supabase=globalThis.__SESSION_NAV_BACKEND; export const isBackendConfigured=true; export const backendConfigurationError="";', loader: 'js' }));
  } }],
});
await writeFile(bundlePath, output.outputFiles[0].text, 'utf8');
const { default: App } = await import(pathToFileURL(bundlePath).href);
const containers = { admin: document.getElementById('admin'), public: document.getElementById('public') };
const roots = new Map();
let tabAuthSubscription;
const text = node => node?.textContent.replace(/\s+/g, ' ').trim() || '';
const header = () => containers.public.querySelector('.site-header');
const findLink = (node, label) => [...node.querySelectorAll('a')].find(link => text(link) === label);
async function mount(surface, route) {
  if (roots.has(surface)) await act(async () => roots.get(surface).unmount());
  const root = createRoot(containers[surface]); roots.set(surface, root);
  await act(async () => root.render(createElement(MemoryRouter, { initialEntries: [route] }, createElement(App))));
}
async function waitFor(predicate, reason) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) { if (predicate()) return; await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); }
  assert.fail(`Timed out waiting for ${reason}: ${text(containers.public).slice(0, 260)}`);
}
function emit(event, user) {
  controller.session = user; controller.verified = user;
  const callsBefore = controller.calls.length;
  for (const callback of controller.subscribers) assert.equal(callback(event, user ? { user } : null), undefined, 'auth callback must remain synchronous');
  assert.equal(controller.calls.length, callsBefore, 'auth callback must release its lock before making Auth requests');
}
async function reset(user = null) {
  for (const root of roots.values()) await act(async () => root.unmount()); roots.clear();
  assert.equal(controller.subscribers.size, tabAuthSubscription ? 1 : 0, 'only the tab identity cache may outlive its mounted pages');
  if (tabAuthSubscription) assert.ok(controller.subscribers.has(tabAuthSubscription));
  emit('SIGNED_OUT', null);
  controller.session = user; controller.verified = user; controller.calls = []; controller.nextVerification = null; controller.verificationError = null; controller.username='';controller.nextProfile=null;
  localStorage.clear();
}
after(async () => {
  await reset(); dom.window.close();
  for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  assert.equal(path.dirname(scratch), artifactsRoot);
  await unlink(bundlePath); await rmdir(scratch);
});

test('administrator and public pages share verified login state', async t => {
  await t.test('login, return to website, and reload preserve the same administrator session', async () => {
    await reset(); await mount('admin', '/login');
    await act(async () => {
      containers.admin.querySelector('[name="email"]').value = admin.email;
      containers.admin.querySelector('[name="password"]').value = 'Synthetic-test-password-123';
      containers.admin.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true }));
    });
    await waitFor(() => containers.admin.querySelector('.admin-shell'), 'administration after login');
    assert.equal(controller.subscribers.size, 1);
    tabAuthSubscription = [...controller.subscribers][0];
    const website = findLink(containers.admin.querySelector('.admin-sidebar-bottom'), '打开网站');
    assert.ok(website, 'administrator must be able to open the website while keeping the workspace');
    assert.equal(website.getAttribute('href'), '/'); assert.equal(website.target, '_blank'); assert.match(website.rel, /noopener/);
    await mount('public', '/');
    await waitFor(() => findLink(header(), '管理后台'), 'public administrator navigation');
    assert.equal(findLink(header(), '登录 / 注册'), undefined);
    const management = findLink(header(), '管理后台');
    assert.equal(management.getAttribute('href'), '/admin'); assert.equal(management.target, '_blank'); assert.match(management.rel, /noopener/);
    assert.ok(containers.admin.querySelector('.admin-shell'));
    assert.equal(controller.calls.includes('signOut'), false);
    await mount('public', '/routes');
    await waitFor(() => findLink(header(), '管理后台'), 'restored session on reload');
    assert.equal(controller.session.id, admin.id);
  });

  await t.test('mobile menu also shows the authenticated administrator entrance', async () => {
    await reset(admin); await mount('public', '/');
    await waitFor(() => findLink(header(), '管理后台'), 'administrator header');
    await act(async () => header().querySelector('[aria-controls="mobile-menu"]').click());
    assert.ok(findLink(containers.public.querySelector('#mobile-menu'), '管理后台'));
    assert.equal(findLink(containers.public.querySelector('#mobile-menu'), '登录 / 注册'), undefined);
  });

  await t.test('a member is shown as logged in without trusting an editable admin claim', async () => {
    await reset(member); await mount('public', '/');
    await waitFor(() => Boolean(findLink(header(), '已登录')), 'member header');
    assert.equal(header().querySelector('a[href="/admin"]'), null);
    assert.equal(findLink(header(), '登录 / 注册'), undefined);
  });

  await t.test('cached administrator claims never replace server-verified membership', async () => {
    await reset(member); controller.session = admin;
    await mount('public', '/');
    await waitFor(() => Boolean(findLink(header(), '已登录')), 'verified member despite cached admin');
    assert.equal(header().querySelector('a[href="/admin"]'), null);
  });

  await t.test('token refresh and user updates recheck the current role', async () => {
    await reset(admin); await mount('public', '/');
    await waitFor(() => findLink(header(), '管理后台'), 'initial administrator');
    await act(async () => emit('TOKEN_REFRESHED', member));
    await waitFor(() => Boolean(findLink(header(), '已登录')), 'refreshed member');
    assert.equal(header().querySelector('a[href="/admin"]'), null);
    await act(async () => emit('USER_UPDATED', admin));
    await waitFor(() => findLink(header(), '管理后台'), 'updated administrator');
  });

  await t.test('other-tab login and signout events update both open surfaces', async () => {
    await reset(); await mount('public', '/'); await mount('admin', '/admin');
    await waitFor(() => findLink(header(), '登录 / 注册'), 'guest header');
    await act(async () => emit('SIGNED_IN', admin));
    await waitFor(() => findLink(header(), '管理后台') && text(containers.admin).includes('欢迎回来'), 'shared login event');
    await act(async () => emit('SIGNED_OUT', null));
    await waitFor(() => findLink(header(), '登录 / 注册') && text(containers.admin).includes('请先登录管理账号'), 'shared signout event');
  });

  await t.test('a stale verification cannot restore a signed-out or replaced account', async () => {
    await reset(admin);
    let finish;
    controller.nextVerification = new Promise(resolve => { finish = resolve; });
    await mount('public', '/');
    await waitFor(() => controller.calls.includes('getUser'), 'pending verification');
    assert.equal(findLink(header(), '登录 / 注册'), undefined, 'checking must not masquerade as logged out');
    await act(async () => emit('SIGNED_OUT', null));
    await waitFor(() => findLink(header(), '登录 / 注册'), 'immediate signout');
    await act(async () => finish({ data: { user: admin }, error: null }));
    assert.equal(header().querySelector('a[href="/admin"]'), null);
    await act(async () => emit('SIGNED_IN', member));
    await waitFor(() => Boolean(findLink(header(), '已登录')), 'replacement member');
    assert.equal(header().querySelector('a[href="/admin"]'), null);
  });

  await t.test('verification failure is distinguished from a logged-out account', async () => {
    await reset(admin); controller.verificationError = new Error('synthetic offline verification');
    await mount('public', '/');
    await waitFor(() => text(header()).includes('登录状态待确认'), 'verification error');
    assert.equal(header().querySelector('a[href="/admin"]'), null);
    assert.equal(findLink(header(), '登录 / 注册'), undefined);
  });
});

test('verified username links to settings and late profile cannot restore a previous account',async()=>{
 await reset(member);controller.username='山野同行';await mount('public','/');await waitFor(()=>findLink(header(),'山野同行'),'verified username');assert.equal(findLink(header(),'山野同行').getAttribute('href'),'/settings');assert.doesNotMatch(text(header()),/member@example/);
 await reset(member);let release;controller.nextProfile=new Promise(resolve=>release=resolve);await mount('public','/');await waitFor(()=>findLink(header(),'已登录'),'profile pending fallback');await act(async()=>emit('SIGNED_OUT',null));await act(async()=>release({data:{userId:member.id,username:'旧用户名',realName:'',phone:'',updatedAt:null}}));assert.ok(findLink(header(),'登录 / 注册'));assert.doesNotMatch(text(header()),/旧用户名/);
});

test('returning to a public page rechecks a missed login and displays the current username', async () => {
  await reset(); await mount('public', '/activities');
  await waitFor(() => findLink(header(), '登录 / 注册'), 'initial guest navigation');
  // A restored tab can miss the event emitted while it was suspended.
  controller.session = member; controller.verified = member; controller.username = '山野同行';
  await act(async () => window.dispatchEvent(new Event('pageshow')));
  await waitFor(() => findLink(header(), '山野同行'), 'restored member username');
  assert.equal(findLink(header(), '登录 / 注册'), undefined);
  assert.equal(findLink(header(), '山野同行').getAttribute('href'), '/settings');
});

test('public route navigation recovers a login without requiring a full reload', async () => {
  await reset(); await mount('public', '/');
  await waitFor(() => findLink(header(), '登录 / 注册'), 'initial guest navigation');
  controller.session = member; controller.verified = member; controller.username = '山野同行';
  await act(async () => findLink(header(), '活动').click());
  await waitFor(() => findLink(header(), '山野同行'), 'member username after route navigation');
  assert.equal(header().querySelector('a[href="/admin"]'), null);
});

test('focus recovery clears the previous account and profile edits update desktop and mobile usernames', async () => {
  await reset(admin); controller.username = '原用户名'; await mount('public', '/');
  await waitFor(() => findLink(header(), '原用户名'), 'initial username');
  controller.session = member; controller.verified = member; controller.username = '新用户名';
  await act(async () => window.dispatchEvent(new Event('focus')));
  await waitFor(() => findLink(header(), '新用户名'), 'replacement username after focus');
  assert.equal(findLink(header(), '原用户名'), undefined);
  assert.equal(header().querySelector('a[href="/admin"]'), null);
  await act(async () => header().querySelector('[aria-controls="mobile-menu"]').click());
  await waitFor(() => findLink(containers.public.querySelector('#mobile-menu'), '新用户名'), 'mobile username');
  controller.username = '修改后的用户名';
  await act(async () => window.dispatchEvent(new Event('member-profile-updated')));
  await waitFor(() => findLink(header(), '修改后的用户名') && findLink(containers.public.querySelector('#mobile-menu'), '修改后的用户名'), 'profile update in both navigations');
});

test('returning to a visible tab rechecks identity and signout invalidates a queued recovery', async () => {
  await reset(); await mount('public', '/');
  await waitFor(() => findLink(header(), '登录 / 注册'), 'guest navigation');
  controller.session = member; controller.verified = member; controller.username = '山野同行';
  await act(async () => document.dispatchEvent(new Event('visibilitychange')));
  await waitFor(() => findLink(header(), '山野同行'), 'visible tab username');
  await act(async () => { window.dispatchEvent(new Event('focus')); emit('SIGNED_OUT', null); });
  await waitFor(() => findLink(header(), '登录 / 注册'), 'signout after recovery');
  assert.equal(findLink(header(), '山野同行'), undefined);
});

test('unmounting both navigation instances removes recovery listeners and pending requests', async () => {
  await reset(member); controller.username = '山野同行'; await mount('public', '/');
  await waitFor(() => findLink(header(), '山野同行'), 'member navigation');
  await act(async () => header().querySelector('[aria-controls="mobile-menu"]').click());
  await waitFor(() => findLink(containers.public.querySelector('#mobile-menu'), '山野同行'), 'mobile navigation');
  await act(async () => roots.get('public').unmount()); roots.delete('public');
  assert.equal(controller.subscribers.size, 1, 'only the tab cache remains; public navigation unsubscribed');
  assert.ok(controller.subscribers.has(tabAuthSubscription));
  const before = controller.calls.length;
  await act(async () => {
    for (const type of ['focus', 'pageshow', 'member-profile-updated']) window.dispatchEvent(new Event(type));
    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise(resolve => setTimeout(resolve, 10));
  });
  assert.equal(controller.calls.length, before, 'unmounted navigation must not keep making Auth requests');
});
