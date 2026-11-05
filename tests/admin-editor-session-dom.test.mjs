import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {act, createElement} from 'react';
import {MemoryRouter} from 'react-router-dom';
import {JSDOM} from 'jsdom';
import {build} from 'esbuild';
import {mkdir, mkdtemp, realpath, rmdir, unlink} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const dom = new JSDOM('<!doctype html><div id="app"></div>', {url: 'https://frontend.invalid/admin/news', pretendToBeVisual: true});
const originals = new Map();
function expose(key, value) {
  originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, {configurable: true, writable: true, value});
}
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'FormData', 'Event', 'localStorage']) {
  expose(key, key === 'window' ? dom.window : key === 'document' ? dom.window.document : dom.window[key]);
}
expose('IS_REACT_ACT_ENVIRONMENT', true);
expose('fetch', () => { throw new Error('Editor session tests must not make real network requests'); });
const {createRoot} = await import('react-dom/client');
const container = document.getElementById('app');
const adminA = {id: '00000000-0000-4000-8000-000000000a01', email: 'a@example.invalid', app_metadata: {role: 'admin'}, user_metadata: {}, is_anonymous: false};
const adminB = {id: '00000000-0000-4000-8000-000000000b02', email: 'b@example.invalid', app_metadata: {role: 'admin'}, user_metadata: {}, is_anonymous: false};
const subscribers = new Set();
const control = {
  sessionUser: adminA,
  serverUser: adminA,
  authCalls: [],
  listCalls: [],
  writes: [],
  passwordUpdates: [],
  contentEvents: 0,
  userResponses: [],
  writeResponses: [],
  listResponses: new Map(),
};
const owner = () => control.sessionUser?.id ?? null;
const userResult = user => ({data: {user}, error: null});
function contentRows(user) {
  const label = user.id === adminA.id ? 'A账号' : 'B账号';
  return [
    {id: `${user.id}-article`, kind: 'article', payload: {title: `${label}资讯`, description: '合成测试内容', category: '测试栏目', body: []}, published: false, created_at: '2026-11-01T00:00:00.000Z'},
    {id: `${user.id}-route`, kind: 'route', payload: {title: `${label}路线`, description: '合成测试路线', location: '', distance: 0, ascent: null}, published: false, created_at: '2026-11-01T00:00:00.000Z'},
  ];
}
function writeRequest(operation, record, requestOwner) {
  const call = {operation, record: structuredClone(record), owner: requestOwner};
  control.writes.push(call);
  const selected = {
    select(columns) {
      assert.equal(columns, 'id');
      return {single: async () => control.writeResponses.length ? control.writeResponses.shift() : {data: {id: record.id}, error: null}};
    },
  };
  return operation === 'insert' ? selected : {eq(column, id) {assert.equal(column, 'id'); assert.equal(id, record.id); return selected;}};
}
const backend = {
  auth: {
    async getSession() {
      control.authCalls.push({operation: 'getSession', owner: owner()});
      return {data: {session: control.sessionUser ? {access_token: 'synthetic-editor-session', user: control.sessionUser} : null}, error: null};
    },
    async getUser() {
      control.authCalls.push({operation: 'getUser', owner: owner()});
      return control.userResponses.length ? control.userResponses.shift() : userResult(control.serverUser);
    },
    onAuthStateChange(callback) {
      subscribers.add(callback);
      return {data: {subscription: {unsubscribe() {subscribers.delete(callback);}}}};
    },
    async updateUser(values) {
      control.passwordUpdates.push({owner: owner(), values});
      return {data: {user: control.serverUser}, error: null};
    },
  },
  from(table) {
    assert.equal(table, 'content_items');
    const requestOwner = owner();
    return {
      select(columns) {
        assert.equal(columns, 'id,kind,payload,published,created_at');
        return {order: async (column, options) => {
          assert.equal(column, 'created_at');
          assert.deepEqual(options, {ascending: false});
          control.listCalls.push({owner: requestOwner});
          const queue = control.listResponses.get(requestOwner);
          return queue?.length ? queue.shift() : {data: contentRows({id: requestOwner}), error: null};
        }};
      },
      insert(record) {return writeRequest('insert', record, requestOwner);},
      update(record) {return writeRequest('update', record, requestOwner);},
    };
  },
};
expose('__ADMIN_EDITOR_SESSION_BACKEND', backend);
window.addEventListener('chuanheng-content-updated', () => {control.contentEvents++;});
const project = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const artifacts = path.join(project, 'artifacts');
await mkdir(artifacts, {recursive: true});
const scratch = await mkdtemp(path.join(artifacts, 'admin-editor-session-'));
const bundle = path.join(scratch, 'component.mjs');
await build({
  stdin: {contents: "export {AdminPage} from './src/pages/Admin.jsx';", resolveDir: project, loader: 'jsx'},
  absWorkingDir: project, bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', loader: {'.css': 'empty'},
  define: {'import.meta.env': JSON.stringify({PROD: true, DEV: false, MODE: 'production', VITE_CONTENT_MODE: 'live'})},
  outfile: bundle,
  plugins: [{name: 'editor-session-backend', setup(builder) {
    builder.onResolve({filter: /(?:^|[\\/])backend\.js$/}, () => ({path: 'backend', namespace: 'editor-session'}));
    builder.onLoad({filter: /.*/, namespace: 'editor-session'}, () => ({contents: 'export const supabase=globalThis.__ADMIN_EDITOR_SESSION_BACKEND;export const isBackendConfigured=true;export const backendConfigurationError="";', loader: 'js'}));
  }}],
});
const {AdminPage} = await import(pathToFileURL(bundle).href);
let root;
const text = () => container.textContent.replace(/\s+/g, ' ').trim();
const editorForm = () => container.querySelector('[role="dialog"] form');
const newButton = kind => [...container.querySelectorAll('button')].find(button => button.textContent === `新建${kind === 'route' ? '路线' : '资讯'}`);
const pause = () => new Promise(resolve => setTimeout(resolve, 5));
function deferred() {
  let resolve;
  const promise = new Promise(yes => {resolve = yes;});
  return {promise, resolve};
}
async function waitFor(predicate, reason) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await act(async () => {await pause();});
  }
  assert.fail(`Timed out waiting for ${reason}: ${text().slice(0, 400)}`);
}
function emitRaw(event, user) {
  control.sessionUser = user;
  control.serverUser = user;
  for (const callback of [...subscribers]) callback(event, user ? {access_token: 'synthetic-editor-session', user} : null);
}
async function emit(event, user) {
  await act(async () => {emitRaw(event, user); await pause();});
}
async function mount(route = '/admin/news', {pendingList} = {}) {
  if (root) await act(async () => root.unmount());
  emitRaw('SIGNED_OUT', null);
  Object.assign(control, {
    sessionUser: adminA, serverUser: adminA, authCalls: [], listCalls: [], writes: [], passwordUpdates: [],
    contentEvents: 0, userResponses: [], writeResponses: [], listResponses: new Map(),
  });
  if (pendingList) control.listResponses.set(adminA.id, [pendingList]);
  localStorage.clear();
  root = createRoot(container);
  await act(async () => root.render(createElement(MemoryRouter, {initialEntries: [route]}, createElement(AdminPage))));
  await waitFor(() => control.listCalls.some(call => call.owner === adminA.id), 'administrator A content request');
  await waitFor(() => route.endsWith('/password') ? container.querySelector('input[name="password"]') : newButton(route.endsWith('/routes') ? 'route' : 'article'), 'administrator A page');
}
async function openEditor(kind = 'article', title = '') {
  await act(async () => newButton(kind).click());
  await waitFor(editorForm, 'content editor');
  if (title) await input(editorForm(), 'title', title);
  return editorForm();
}
async function input(form, name, value) {
  await act(async () => {
    const field = form.querySelector(`[name="${name}"]`);
    assert.ok(field, `field ${name} is present`);
    field.value = value;
    field.dispatchEvent(new dom.window.Event('input', {bubbles: true}));
  });
}
async function submit(form) {
  await act(async () => {form.dispatchEvent(new dom.window.Event('submit', {bubbles: true, cancelable: true}));});
}
async function switchToB() {
  await emit('SIGNED_IN', adminB);
  await waitFor(() => control.listCalls.some(call => call.owner === adminB.id), 'administrator B content request');
  await waitFor(() => text().includes('B账号资讯') || container.querySelector('input[name="password"]'), 'administrator B page');
}
function assertNoOldSaveFeedback() {
  assert.doesNotMatch(text(), /云端草稿已保存|内容已保存并发布|云端保存未完成|管理员身份校验未通过/);
}
after(async () => {
  if (root) await act(async () => root.unmount());
  emitRaw('SIGNED_OUT', null);
  dom.window.close();
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
  assert.equal(path.dirname(scratch), artifacts);
  await unlink(bundle);
  await rmdir(scratch);
});

test('same-account sign-in keeps the same article and route editor with unsaved input', async () => {
  for (const [route, kind] of [['/admin/news', 'article'], ['/admin/routes', 'route']]) {
    await mount(route);
    const form = await openEditor(kind, '尚未保存的测试标题');
    await input(form, 'description', '尚未保存的测试简介');
    const confirmations = control.authCalls.filter(call => call.operation === 'getUser').length;
    await emit('SIGNED_IN', adminA);
    await emit('TOKEN_REFRESHED', adminA);

    assert.equal(editorForm(), form);
    assert.equal(form.querySelector('[name="title"]').value, '尚未保存的测试标题');
    assert.equal(form.querySelector('[name="description"]').value, '尚未保存的测试简介');
    assert.equal(control.authCalls.filter(call => call.operation === 'getUser').length, confirmations);
    assert.doesNotMatch(text(), /正在验证登录身份/);
  }
});

test('account changes and a batched sign-out/sign-in discard the previous editor instead of reviving its draft', async () => {
  await mount();
  await openEditor('article', 'A未保存的草稿');
  await switchToB();
  assert.equal(editorForm(), null);
  const previousBForm = await openEditor('article', 'B会话退出前的草稿');
  const before = control.authCalls.filter(call => call.operation === 'getUser' && call.owner === adminB.id).length;

  await act(async () => {
    emitRaw('SIGNED_OUT', null);
    emitRaw('SIGNED_IN', adminB);
    await pause();
  });
  await waitFor(() => control.authCalls.filter(call => call.operation === 'getUser' && call.owner === adminB.id).length > before, 'new B login confirmation');
  await waitFor(() => newButton('article'), 'replacement B session');
  assert.equal(editorForm(), null, 'a new login must not retain a draft just because the final user id matches');
  const next = await openEditor();
  assert.notEqual(next, previousBForm);
  assert.equal(next.querySelector('[name="title"]').value, '');
});

test('a save waiting for A verification cannot start a write or disturb the editor opened by B', async () => {
  await mount();
  const pending = deferred();
  control.userResponses.push(pending.promise);
  await submit(await openEditor('article', 'A等待核验的保存'));
  await waitFor(() => control.authCalls.filter(call => call.operation === 'getUser' && call.owner === adminA.id).length === 2, 'pending A save verification');
  assert.equal(control.writes.length, 0);

  await switchToB();
  const formB = await openEditor('article', 'B正在编辑的草稿');
  await act(async () => {pending.resolve(userResult(adminA)); await pause();});
  assert.equal(control.writes.length, 0, 'the old operation must stop before sending a write under B');
  assert.equal(editorForm(), formB);
  assert.equal(formB.querySelector('[name="title"]').value, 'B正在编辑的草稿');
  assertNoOldSaveFeedback();
});

test('a write already sent by A cannot close B editor or announce success after its late response', async () => {
  await mount();
  const pending = deferred();
  control.writeResponses.push(pending.promise);
  await submit(await openEditor('article', 'A已发出的保存'));
  await waitFor(() => control.writes.length === 1, 'A content write');
  assert.equal(control.writes[0].owner, adminA.id);
  assert.equal(control.writes[0].record.payload.title, 'A已发出的保存');

  await switchToB();
  const formB = await openEditor('article', 'B独立的编辑内容');
  await act(async () => {pending.resolve({data: {id: control.writes[0].record.id}, error: null}); await pause();});
  assert.equal(editorForm(), formB);
  assert.equal(formB.querySelector('[name="title"]').value, 'B独立的编辑内容');
  assert.equal(control.writes.length, 1);
  assert.equal(control.contentEvents, 0, 'a stale response must not announce an update to the new session');
  assertNoOldSaveFeedback();
});

test('a delayed content list fetched by A cannot replace the list loaded for B', async () => {
  const pending = deferred();
  await mount('/admin/news', {pendingList: pending.promise});
  assert.equal(control.listCalls[0].owner, adminA.id);
  await switchToB();
  assert.ok(container.querySelector('[aria-label="编辑B账号资讯"]'));

  await act(async () => {pending.resolve({data: contentRows(adminA), error: null}); await pause();});
  assert.ok(container.querySelector('[aria-label="编辑B账号资讯"]'));
  assert.equal(container.querySelector('[aria-label="编辑A账号资讯"]'), null);
});

test('a password change awaiting A verification cannot update the replacement B account', async () => {
  await mount('/admin/password');
  const formA = container.querySelector('.admin-form-panel form');
  await input(formA, 'password', 'Synthetic-A-password-123');
  await input(formA, 'confirmation', 'Synthetic-A-password-123');
  const pending = deferred();
  control.userResponses.push(pending.promise);
  await submit(formA);
  await waitFor(() => control.authCalls.filter(call => call.operation === 'getUser' && call.owner === adminA.id).length === 2, 'pending A password verification');

  await switchToB();
  const formB = container.querySelector('.admin-form-panel form');
  await input(formB, 'password', 'Synthetic-B-unsaved-456');
  await input(formB, 'confirmation', 'Synthetic-B-unsaved-456');
  await act(async () => {pending.resolve(userResult(adminA)); await pause();});
  assert.equal(control.passwordUpdates.length, 0, 'the old submit must not call updateUser on the current B session');
  assert.equal(container.querySelector('.admin-form-panel form'), formB);
  assert.equal(formB.querySelector('[name="password"]').value, 'Synthetic-B-unsaved-456');
  assert.doesNotMatch(text(), /密码已通过认证服务更新|管理员身份校验未通过/);
});

test('a failed save verification from an older login cannot revoke a new login of the same account', async () => {
  await mount();
  const pending = deferred();
  control.userResponses.push(pending.promise);
  await submit(await openEditor('article', 'A前一次登录的保存'));
  await waitFor(() => control.authCalls.filter(call => call.operation === 'getUser' && call.owner === adminA.id).length === 2, 'old A save verification');

  await act(async () => {
    emitRaw('SIGNED_OUT', null);
    emitRaw('SIGNED_IN', adminA);
    await pause();
  });
  await waitFor(() => control.authCalls.filter(call => call.operation === 'getUser' && call.owner === adminA.id).length === 3, 'new login confirmation for the same account');
  await waitFor(() => newButton('article'), 'new A login');
  assert.equal(editorForm(), null);
  const newForm = await openEditor('article', 'A重新登录后的独立草稿');

  await act(async () => {pending.resolve({data: {user: null}, error: new Error('old login verification failed')}); await pause();});
  assert.equal(editorForm(), newForm, 'an old error cannot invalidate the replacement login with the same UUID');
  assert.equal(newForm.querySelector('[name="title"]').value, 'A重新登录后的独立草稿');
  assert.equal(control.writes.length, 0);
  assertNoOldSaveFeedback();
  assert.doesNotMatch(text(), /身份核验失败|正在验证登录身份|请先登录管理账号/);
});
