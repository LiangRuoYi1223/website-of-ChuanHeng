import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {act, createElement} from 'react';
import {MemoryRouter} from 'react-router-dom';
import {JSDOM} from 'jsdom';
import {build} from 'esbuild';
import {mkdir, mkdtemp, realpath, rm} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const dom = new JSDOM('<div id="app"></div>', {url: 'https://frontend.invalid/admin/backgrounds'});
for (const key of ['window', 'document', 'navigator', 'FormData', 'localStorage']) {
  Object.defineProperty(globalThis, key, {configurable: true, value: key === 'window' ? dom.window : key === 'document' ? dom.window.document : dom.window[key]});
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const {createRoot} = await import('react-dom/client');
const project = await realpath(fileURLToPath(new URL('../', import.meta.url)));
await mkdir(path.join(project, 'artifacts'), {recursive: true});
const scratch = await mkdtemp(path.join(project, 'artifacts', 'site-images-session-'));
const admin = {id: '00000000-0000-4000-8000-000000000900', app_metadata: {role: 'admin'}};
const otherAdmin = {id: '00000000-0000-4000-8000-000000000901', app_metadata: {role: 'admin'}};
const subscribers = new Set();
let sessionUser = admin;
let getUser = async () => ({data: {user: admin}, error: null});
globalThis.__SITE_SESSION_BACKEND = {
  auth: {
    getSession: async () => ({data: {session: sessionUser ? {access_token: 'synthetic-session', user: sessionUser} : null}, error: null}),
    getUser: () => getUser(),
    onAuthStateChange(callback) {
      subscribers.add(callback);
      return {data: {subscription: {unsubscribe() {subscribers.delete(callback);}}}};
    },
  },
  rpc: async name => {
    assert.equal(name, 'get_site_images');
    return {data: {config: {}, updatedAt: null}, error: null};
  },
  from: table => {
    assert.equal(table, 'content_items');
    return {select: () => ({order: async () => ({data: [], error: null})})};
  },
};
await build({
  stdin: {contents: "export {AdminPage} from './src/pages/Admin.jsx';", resolveDir: project, loader: 'jsx'},
  absWorkingDir: project, bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', loader: {'.css': 'empty'},
  define: {'import.meta.env': JSON.stringify({PROD: true, MODE: 'production', VITE_CONTENT_MODE: 'live'})},
  outfile: path.join(scratch, 'component.mjs'),
  plugins: [{name: 'session-backend', setup(builder) {
    builder.onResolve({filter: /backend\.js$/}, () => ({path: 'backend', namespace: 'mock'}));
    builder.onLoad({filter: /.*/, namespace: 'mock'}, () => ({contents: 'export const supabase=globalThis.__SITE_SESSION_BACKEND;export const isBackendConfigured=true;export const backendConfigurationError="";', loader: 'js'}));
  }}],
});
const {AdminPage} = await import(pathToFileURL(path.join(scratch, 'component.mjs')));
const container = document.getElementById('app');
let root;
const slideCount = () => container.querySelectorAll('[data-hero-id]').length;
const addButton = () => [...container.querySelectorAll('button')].find(node => node.textContent === '添加首页图片');
async function mount() {
  if (root) {
    sessionUser = null;
    await emit('SIGNED_OUT', null);
    await act(async () => root.unmount());
  }
  sessionUser = admin;
  getUser = async () => ({data: {user: admin}, error: null});
  root = createRoot(container);
  await act(async () => root.render(createElement(MemoryRouter, {initialEntries: ['/admin/backgrounds']}, createElement(AdminPage))));
  assert.equal(slideCount(), 3);
  await act(async () => addButton().click());
  assert.equal(slideCount(), 4);
}
async function emit(event, user = sessionUser) {
  await act(async () => {
    for (const callback of [...subscribers]) callback(event, user ? {access_token: 'synthetic-session', user} : null);
    await new Promise(resolve => setTimeout(resolve, 5));
  });
}
function deferredUser() {
  let release;
  const promise = new Promise(resolve => {release = user => resolve({data: {user}, error: null});});
  return {promise, release};
}
after(async () => {
  if (root) await act(async () => root.unmount());
  dom.window.close();
  await rm(scratch, {recursive: true});
  delete globalThis.__SITE_SESSION_BACKEND;
});

test('same administrator returning to the tab retains unsaved image edits without another identity request', async () => {
  await mount();
  const form = container.querySelector('.site-images-admin form');
  let calls = 0;
  getUser = async () => { calls++; return {data: {user: admin}, error: null}; };
  await emit('SIGNED_IN');
  await emit('TOKEN_REFRESHED');
  assert.equal(slideCount(), 4, 'returning to the same account must not unmount the edited image manager');
  assert.equal(container.querySelector('.site-images-admin form'), form);
  assert.equal(calls, 0, 'a verified tab must reuse its identity within twelve hours');
  assert.doesNotMatch(container.textContent, /正在验证登录身份/);
  assert.match(container.textContent, /有修改尚未保存/);
});

test('twelve-hour expiry verifies in the background and preserves the same edited form', async () => {
  await mount();
  const form = container.querySelector('.site-images-admin form');
  const pending = deferredUser();
  let calls = 0;
  getUser = () => { calls++; return pending.promise; };
  const realNow = Date.now;
  try {
    const later = realNow() + 12 * 60 * 60 * 1000;
    Date.now = () => later;
    await emit('SIGNED_IN');
    assert.equal(calls, 1);
    assert.equal(container.querySelector('.site-images-admin form'), form);
    assert.equal(slideCount(), 4);
    assert.doesNotMatch(container.textContent, /正在验证登录身份/);
    await act(async () => pending.release(admin));
    assert.equal(container.querySelector('.site-images-admin form'), form);
    assert.equal(slideCount(), 4);
  } finally { Date.now = realNow; }
});

test('signing out during token revalidation clears edits and rejects the late verified identity', async () => {
  await mount();
  const pending = deferredUser();
  getUser = () => pending.promise;
  await emit('USER_UPDATED');
  sessionUser = null;
  await emit('SIGNED_OUT', null);
  assert.equal(container.querySelector('.site-images-admin form'), null);
  await act(async () => pending.release(admin));
  assert.equal(container.querySelector('.site-images-admin form'), null);
  assert.match(container.textContent, /请先登录管理账号/);
});

test('switching administrators discards old drafts and a late refresh cannot replace the new account editor', async () => {
  await mount();
  const pending = deferredUser();
  getUser = () => pending.promise;
  await emit('USER_UPDATED');
  sessionUser = otherAdmin;
  const nextIdentity = deferredUser();
  getUser = () => nextIdentity.promise;
  await emit('SIGNED_IN', otherAdmin);
  assert.equal(container.querySelector('.site-images-admin form'), null);
  getUser = async () => ({data: {user: otherAdmin}, error: null});
  await act(async () => nextIdentity.release(otherAdmin));
  assert.equal(slideCount(), 3, 'the prior account draft must not transfer to the new administrator');
  await act(async () => addButton().click());
  const form = container.querySelector('.site-images-admin form');
  await act(async () => pending.release(admin));
  assert.equal(slideCount(), 4);
  assert.equal(container.querySelector('.site-images-admin form'), form);
});

test('a server-confirmed role downgrade hides the retained image editor after token refresh', async () => {
  await mount();
  sessionUser = {...admin, app_metadata: {role: 'member'}};
  await emit('TOKEN_REFRESHED', sessionUser);
  assert.equal(container.querySelector('.site-images-admin form'), null);
  assert.match(container.textContent, /当前账号没有管理权限/);
});
