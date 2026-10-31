import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { act, createElement } from 'react';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { mkdir, mkdtemp, realpath, rmdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const dom = new JSDOM('<!doctype html><html><body><button id="opener">报名管理</button><div id="app"></div></body></html>', { url: 'http://localhost/' });
const originals = new Map();
for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true })) { originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value }); }
const { createRoot } = await import('react-dom/client');
const projectRoot = await realpath(fileURLToPath(new URL('../', import.meta.url)));
await mkdir(path.join(projectRoot, 'artifacts'), { recursive: true });
const scratch = await mkdtemp(path.join(projectRoot, 'artifacts', 'admin-registrations-'));
const bundlePath = path.join(scratch, 'admin.mjs');
let rpc, authCallback, currentUser;
const admin = { id: 'admin-a', is_anonymous: false, app_metadata: { role: 'admin' } };
globalThis.__registrationAdminClient = { rpc: (...args) => rpc(...args), auth: { getUser: async () => ({ data: { user: currentUser } }), onAuthStateChange: callback => { authCallback = callback; return { data: { subscription: { unsubscribe() {} } } }; } } };
const output = await build({ stdin: { contents: "export {default} from './src/applications/ActivityRegistrationAdmin.jsx';", resolveDir: projectRoot, loader: 'jsx' }, absWorkingDir: projectRoot, bundle: true, write: false, platform: 'node', format: 'esm', jsx: 'automatic', packages: 'external', loader: { '.css': 'empty' }, plugins: [{ name: 'backend', setup(build) { build.onLoad({ filter: /[/\\]backend\.js$/ }, () => ({ contents: 'export const supabase = globalThis.__registrationAdminClient;', loader: 'js' })); } }], logLevel: 'silent' });
await writeFile(bundlePath, output.outputFiles[0].text);
const { default: Component } = await import(pathToFileURL(bundlePath).href);
const container = document.getElementById('app'); let root;
const member = (id, registeredAt, extra = {}) => ({ id, userId: id, displayName: id === 'first' ? '先报名者' : '后报名者', email: `${id}@example.invalid`, createdAt: registeredAt, registeredAt, status: 'active', paymentStatus: 'unpaid', position: id === 'first' ? 1 : 2, selectionStatus: id === 'first' ? 'confirmed' : 'waitlisted', ...extra });
const state = () => ({ viewerId: 'admin-a', capacity: 1, activeCount: 2, confirmedCount: 1, waitlistCount: 1, applications: [member('second', '2026-10-31T02:00:00Z'), member('first', '2026-10-31T01:00:00Z')], events: [{ id: 'event', action: 'registered', actorId: 'first', actorLabel: '先报名者', actorType: 'member', source: 'self_service', subjectUserId: 'first', subjectLabel: '先报名者', occurredAt: '2026-10-31T01:00:00Z', details: {} }] });
async function mount(props = {}) { currentUser = admin; if (root) await act(async () => root.unmount()); document.getElementById('opener').focus(); root = createRoot(container); await act(async () => root.render(createElement(Component, { activity: { id: 'activity', payload: { title: '合成活动' } }, onClose() {}, ...props }))); }
async function click(text) { const button = [...container.querySelectorAll('button')].find(item => item.textContent.includes(text)); assert.ok(button, text); await act(async () => button.click()); }
after(async () => { if (root) await act(async () => root.unmount()); dom.window.close(); for (const [key, descriptor] of originals) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; delete globalThis.__registrationAdminClient; await unlink(bundlePath); await rmdir(scratch); });
test('roster renders registeredAt order, queue capacity and administrator-only identity', async () => { rpc = async () => ({ data: state() }); await mount(); assert.match(container.textContent, /合成活动/); const rows = [...container.querySelectorAll('tbody tr')]; assert.match(rows[0].textContent, /先报名者/); assert.match(rows[0].textContent, /first@example.invalid/); assert.match(rows[0].textContent, /1\s*\/\s*1/); assert.match(rows[1].textContent, /候补/); await click('日志'); assert.match(container.textContent, /self_service/); });
test('payment conflict retains the server value and offers reload; success refreshes roster and event', async () => { let changes = 0; rpc = async (name, args) => { if (name === 'get_activity_registrations') return { data: state() }; assert.deepEqual(args, { p_application_id: 'first', p_payment_status: 'paid', p_expected_payment_status: 'unpaid', p_expected_user_id: 'admin-a' }); if (++changes === 1) return { error: { code: '40001', message: 'payment conflict' } }; const next = state(); next.applications[1].paymentStatus = 'paid'; next.events.push({ ...next.events[0], id: 'payment', action: 'payment_changed', actorLabel: '管理员甲', actorId: 'admin', actorType: 'admin', source: 'manual', details: { paymentStatus: { before: 'unpaid', after: 'paid' } } }); return { data: next }; }; await mount(); const select = container.querySelector('select'); await act(async () => { select.value = 'paid'; select.dispatchEvent(new dom.window.Event('change', { bubbles: true })); }); assert.equal(select.value, 'unpaid'); assert.match(container.querySelector('[role=alert]').textContent, /重新加载/); await click('重新加载'); const reloadedSelect = container.querySelector('select'); await act(async () => { reloadedSelect.value = 'paid'; reloadedSelect.dispatchEvent(new dom.window.Event('change', { bubbles: true })); }); assert.equal(container.querySelector('select').value, 'paid'); await click('日志'); assert.match(container.textContent, /管理员甲/); assert.match(container.textContent, /未缴费.*已缴费/); });
test('local draft never calls real registration RPC; dialog traps focus and restores opener', async () => { rpc = async () => { throw new Error('local draft must not fetch'); }; let closed = 0; await mount({ local: true, onClose: () => closed++ }); assert.match(container.textContent, /本地草稿/); const buttons = [...container.querySelectorAll('button:not(:disabled)')]; buttons.at(-1).focus(); await act(async () => document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))); assert.equal(document.activeElement, buttons[0]); await act(async () => document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))); assert.equal(closed, 1); await act(async () => root.unmount()); root = null; assert.equal(document.activeElement.id, 'opener'); });
test('load failure offers retry and an empty roster does not invent records', async () => { rpc = async () => ({ error: { code: '42501' } }); await mount(); assert.ok(container.querySelector('[role=alert]')); rpc = async () => ({ data: { viewerId: 'admin-a', capacity: null, activeCount: 0, confirmedCount: 0, waitlistCount: 0, applications: [], events: [] } }); await click('重新加载'); assert.match(container.textContent, /暂无报名/); assert.match(container.textContent, /未设置/); await click('日志'); assert.match(container.textContent, /暂无.*日志/); });


test('initial auth subscription does not clear roster, while sign-out clears private data', async () => {
  rpc = async () => ({ data: state() }); await mount();
  await act(async () => authCallback('INITIAL_SESSION'));
  assert.match(container.textContent, /first@example.invalid/);
  await act(async () => authCallback('SIGNED_OUT'));
  assert.doesNotMatch(container.textContent, /first@example.invalid/);
  assert.match(container.querySelector('[role=alert]').textContent, /登录状态/);
});

test('pending payment does not claim success and disables other payment edits', async () => {
  let finish;
  rpc = async name => name === 'get_activity_registrations' ? { data: state() } : new Promise(resolve => { finish = resolve; });
  await mount(); const select = container.querySelector('select');
  await act(async () => { select.value = 'paid'; select.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
  assert.equal(select.value, 'unpaid'); assert.ok([...container.querySelectorAll('select')].every(item => item.disabled));
  await act(async () => finish({ error: { code: '40001' } }));
  assert.equal(select.value, 'unpaid'); assert.equal(select.disabled, false);
});

test('account switching without an auth notification cannot pay under a stale roster', async () => {
  let writes = 0; rpc = async name => { if (name !== 'get_activity_registrations') writes++; return { data: state() }; };
  await mount(); currentUser = { ...admin, id: 'admin-b' };
  const select = container.querySelector('select');
  await act(async () => { select.value = 'paid'; select.dispatchEvent(new dom.window.Event('change', { bubbles: true })); });
  assert.equal(writes, 0); assert.equal(select.value, 'unpaid'); assert.ok(container.querySelector('[role=alert]'));
});

test('equal-time numeric event IDs sort correctly and lifecycle logs expose before and after values', async () => {
  const data = state(); const base = data.events[0];
  data.events = [
    { ...base, id: '9', action: 'withdrawn', details: { status: { before: 'active', after: 'withdrawn' }, registeredAt: { before: '2026-10-30T01:00:00Z', after: '2026-10-30T01:00:00Z' } } },
    { ...base, id: '10', action: 'rejoined', details: { status: { before: 'withdrawn', after: 'active' }, registeredAt: { before: '2026-10-30T01:00:00Z', after: '2026-10-31T02:00:00Z' } } },
    { ...base, id: '8', action: 'registered', details: { status: { before: null, after: 'active' }, registeredAt: '2026-10-30T01:00:00Z' } },
  ];
  rpc = async () => ({ data }); await mount(); await click('日志');
  const events = [...container.querySelectorAll('.registration-admin-events li')];
  assert.match(events[0].textContent, /重新报名/);
  assert.match(events[0].textContent, /已退出.*有效报名/);
  assert.match(events[0].textContent, /报名时间.*→/);
  assert.match(events[1].textContent, /有效报名.*已退出/);
  assert.match(events[2].textContent, /无记录.*有效报名/);
  assert.match(events[2].textContent, /报名时间/);
});
