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
const admin = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', email: 'admin@example.invalid', app_metadata: { role: 'admin' }, user_metadata: {} };
const controller = { rows: [], calls: [], reject: false };
const mockBackend = {
  auth: {
    getSession: async () => ({ data: { session: { user: admin } }, error: null }),
    getUser: async () => ({ data: { user: admin }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
  },
  from(table) {
    assert.equal(table, 'content_items');
    return { select: () => ({ order: async () => ({ data: structuredClone(controller.rows), error: null }) }) };
  },
  async rpc(name, args) {
    controller.calls.push({ name, args: structuredClone(args) });
    if (controller.reject) return { data: null, error: { code: '40001', message: 'stale' } };
    const row = args.activity_record;
    const result = { id: row.id, kind: 'activity', payload: row.payload, published: row.published, created_at: row.created_at };
    controller.rows = [...controller.rows.filter(item => item.id !== row.id), result];
    return { data: { activity: result, route: null }, error: null };
  },
};
expose('__PRODUCTION_AUTH_BACKEND', mockBackend);
const projectRoot = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const artifactsRoot = path.join(projectRoot, 'artifacts');
await mkdir(artifactsRoot, { recursive: true });
const scratch = await mkdtemp(path.join(artifactsRoot, 'admin-route-cloud-dom-'));
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
  stdin: { contents: "export {AdminPage} from './src/pages/Admin.jsx'; export {default as RouteImportPage} from './src/pages/RouteImport.jsx';", resolveDir: projectRoot, sourcefile: 'production-auth-dom.jsx', loader: 'jsx' },
  absWorkingDir: projectRoot, bundle: true, write: false, platform: 'node', format: 'esm', target: 'node22', jsx: 'automatic', packages: 'external', loader: { '.css': 'empty' },
  define: { 'import.meta.env': JSON.stringify({ PROD: true, DEV: false, MODE: 'production', VITE_CONTENT_MODE: 'preview', VITE_TERRAIN_TILE_URL: 'offline' }) }, logLevel: 'silent',
  plugins: [{ name: 'synthetic-backend-only', setup(builder) {
    builder.onResolve({ filter: /(?:^|[\\/])backend\.js$/ }, () => ({ path: 'backend', namespace: 'production-test' }));
    builder.onLoad({ filter: /^backend$/, namespace: 'production-test' }, () => ({ contents: "export const supabase=globalThis.__PRODUCTION_AUTH_BACKEND; export const isBackendConfigured=true; export const backendConfigurationError='';", loader: 'js' }));
  } }],
});
await writeFile(bundlePath, output.outputFiles[0].text, 'utf8');
const { AdminPage, RouteImportPage } = await import(pathToFileURL(bundlePath).href);
const container = dom.window.document.getElementById('app');
const text = node => node.textContent.replace(/\s+/g, ' ').trim();
const button = label => [...container.querySelectorAll('button')].find(node => text(node) === label);
async function click(node) { assert.ok(node); await act(async () => { node.focus(); node.click(); }); }
async function waitFor(predicate, reason) { const deadline = Date.now() + 4000; while (Date.now() < deadline) { if (predicate()) return; await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); } assert.fail(`Timed out waiting for ${reason}: ${text(container).slice(-900)}`); }
async function fill(name, value) { const input = container.querySelector(`[name="${name}"]`); assert.ok(input); await act(async () => { input.value = value; input.dispatchEvent(new dom.window.Event(input.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); }); }
async function mount(location) {
  if (root) await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () => root.render(createElement(MemoryRouter, { initialEntries: [location] }, createElement(Routes, null,
    createElement(Route, { path: '/routes/import', element: createElement(RouteImportPage) }),
    createElement(Route, { path: '/admin/*', element: createElement(AdminPage) }),
    createElement(Route, { path: '/', element: createElement('p', null, '已返回网站首页') }),
  ))));
}

test('cloud activity save sends route selection and optimistic versions through the dedicated RPC', async () => {
  const route = { id: 'route-id', kind: 'route', published: false, payload: { title: '云端合成路线', distance: 3, ascent: null } };
  controller.rows = [route];
  await mount('/admin/activities');
  await waitFor(() => button('新建活动'), 'verified administrator');
  await click(button('新建活动'));
  await fill('title', '云端合成活动');
  await fill('routeId', route.id);
  await click(button('保存内容'));
  await waitFor(() => !container.querySelector('[role="dialog"]'), 'new activity cloud save');
  const first = controller.calls.at(-1);
  assert.equal(first.name, 'save_activity_with_route');
  assert.equal(first.args.activity_record.expected, null);
  assert.deepEqual(first.args.activity_record.routeExpectedPayload, route.payload);
  assert.equal(first.args.activity_record.payload.routeId, route.id);
  assert.equal(first.args.activity_record.payload.track, undefined);
  const saved = structuredClone(controller.rows.find(row => row.kind === 'activity'));
  await waitFor(() => container.querySelector('button[aria-label="编辑云端合成活动"]'), 'cloud list refresh');
  await click(container.querySelector('button[aria-label="编辑云端合成活动"]'));
  await fill('description', '冲突时保留的说明');
  controller.reject = true;
  await click(button('保存内容'));
  await waitFor(() => container.querySelector('[role="dialog"] [role="alert"]'), 'cloud conflict');
  const edited = controller.calls.at(-1).args.activity_record;
  assert.deepEqual(edited.expected, { payload: saved.payload, published: saved.published });
  assert.equal(edited.routeExpectedPayload, undefined, 'same route ID does not request a fresh snapshot');
  assert.equal(container.querySelector('[name="description"]').value, '冲突时保留的说明');
  assert.ok(container.querySelector('[role="dialog"]'));
});

test('production legacy import URL redirects to route management without enabling local preview', async () => {
  controller.reject = false;
  await mount('/routes/import?preview=1');
  await waitFor(() => text(container).includes('路线列表'), 'route management redirect');
  assert.ok(!text(container).includes('本地设计预览'));
  assert.equal(container.querySelector('input[type="file"]'), null, 'redirect does not open a second upload interface');
});

const oldScheduleActivity = (published = true, registrationOpen = true) => ({
  id: 'legacy-schedule', kind: 'activity', published, created_at: '2025-01-01T00:00:00Z',
  payload: { title: '旧日期活动', dateStart: '2025-01-02', registrationDeadline: '2025-01-01T12:00:00Z', registrationOpen, image: '/images/legacy-cover.webp' },
});
async function editOldSchedule(row) {
  controller.rows = [structuredClone(row)]; controller.calls = []; controller.reject = false;
  await mount('/admin/activities');
  await waitFor(() => container.querySelector('button[aria-label="编辑旧日期活动"]'), 'old activity loaded');
  await click(container.querySelector('button[aria-label="编辑旧日期活动"]'));
}

test('legacy public activities retain absent time fields when editing descriptions or disabling existing bookings', async () => {
  for (const turnOff of [false, true]) {
    const old = oldScheduleActivity();
    await editOldSchedule(old);
    assert.equal(container.querySelector('[name="dateStart"]').value, '', 'unknown time must not become midnight');
    await fill('description', '修改介绍并保留历史时间');
    if (turnOff) await click(container.querySelector('[name="registrationOpen"]'));
    await click(button('保存内容'));
    assert.equal(controller.calls.length, 1, 'unchanged legacy times must reach the cloud save transaction');
    const record = controller.calls[0].args.activity_record;
    assert.equal(record.payload.dateStart, old.payload.dateStart);
    assert.equal(record.payload.registrationDeadline, old.payload.registrationDeadline);
    assert.equal(Object.hasOwn(record.payload, 'dateEnd'), false);
    assert.equal(Object.hasOwn(record.payload, 'registrationStart'), false);
    assert.equal(record.payload.registrationOpen, !turnOff);
    assert.equal(record.payload.image, old.payload.image);
    assert.deepEqual(record.expected, { payload: old.payload, published: true });
  }
});

test('changing a legacy public time, first enabling booking or first publishing a draft requires new valid times', async () => {
  await editOldSchedule(oldScheduleActivity());
  await fill('dateStart', '2025-01-02T08:00');
  await click(button('保存内容'));
  assert.equal(controller.calls.length, 0, 'editing time must not bypass current validation');
  assert.match(text(container), /活动开始和结束时间|完整/);
  await fill('dateEnd', '2025-01-02T18:00');
  await fill('registrationStart', '2024-12-01T08:00');
  await click(button('保存内容'));
  assert.equal(controller.calls.length, 1, 'complete corrected times may save');
  const corrected = controller.calls[0].args.activity_record.payload;
  assert.match(corrected.dateStart, /T/);
  assert.equal(Object.hasOwn(corrected, 'dateEnd'), true);
  assert.equal(Object.hasOwn(corrected, 'registrationStart'), true);

  await editOldSchedule(oldScheduleActivity(true, false));
  await click(container.querySelector('[name="registrationOpen"]'));
  await click(button('保存内容'));
  assert.equal(controller.calls.length, 0, 'first booking enable requires a complete window');
  assert.match(text(container), /活动开始和结束时间|完整/);

  await editOldSchedule(oldScheduleActivity(false, false));
  await click(container.querySelector('[name="published"]'));
  await click(button('保存内容'));
  assert.equal(controller.calls.length, 0, 'first publication requires the activity interval');
  assert.match(text(container), /活动开始和结束时间/);
});
