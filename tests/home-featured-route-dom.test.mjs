import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {act, createElement} from 'react';
import {MemoryRouter} from 'react-router-dom';
import {JSDOM} from 'jsdom';
import {build} from 'esbuild';
import {mkdir, mkdtemp, realpath, rmdir, unlink} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

const dom = new JSDOM('<!doctype html><div id="app"></div>', {url: 'https://frontend.invalid/', pretendToBeVisual: true});
const originals = new Map();
function expose(key, value) {
  originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, {configurable: true, writable: true, value});
}
for (const key of ['window', 'document', 'navigator', 'Event']) expose(key, key === 'window' ? dom.window : key === 'document' ? dom.window.document : dom.window[key]);
expose('IS_REACT_ACT_ENVIRONMENT', true);
expose('IntersectionObserver', class {observe() {} disconnect() {}});
expose('fetch', () => {throw new Error('Home tests must not use real network requests');});
dom.window.scrollTo = () => {};
dom.window.HTMLDialogElement.prototype.close = function () {this.removeAttribute('open');};
const {createRoot} = await import('react-dom/client');
const control = {rows: [], reads: 0};
expose('__HOME_FEATURED_BACKEND', {
  auth: {
    async getSession() {return {data: {session: null}, error: null};},
    onAuthStateChange() {return {data: {subscription: {unsubscribe() {}}}};},
  },
  from(table) {
    assert.equal(table, 'content_items');
    return {select(columns) {
      assert.equal(columns, 'id,kind,payload');
      return {eq(field, value) {
        assert.equal(field, 'published'); assert.equal(value, true);
        return {order: async () => {control.reads++; return {data: structuredClone(control.rows.filter(row => row.published === true)), error: null};}};
      }};
    }};
  },
  async rpc(name) {assert.equal(name, 'get_site_images'); return {data: {updatedAt: null, config: {}}, error: null};},
});
const project = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const artifacts = path.join(project, 'artifacts'); await mkdir(artifacts, {recursive: true});
const scratch = await mkdtemp(path.join(artifacts, 'home-featured-route-'));
const bundle = path.join(scratch, 'app.mjs');
await build({
  stdin: {contents: "export {default as App} from './src/App.jsx'; export {CatalogProvider} from './src/catalog.jsx';", resolveDir: project, loader: 'jsx'},
  absWorkingDir: project, bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', loader: {'.css': 'empty'},
  define: {'import.meta.env': JSON.stringify({PROD: true, DEV: false, MODE: 'production', VITE_CONTENT_MODE: 'live'})}, outfile: bundle,
  plugins: [{name: 'home-featured-network-only', setup(builder) {
    builder.onResolve({filter: /(?:^|[\\/])backend\.js$/}, () => ({path: 'backend', namespace: 'home-featured'}));
    builder.onLoad({filter: /.*/, namespace: 'home-featured'}, () => ({contents: 'export const supabase=globalThis.__HOME_FEATURED_BACKEND;export const isBackendConfigured=true;export const backendConfigurationError="";', loader: 'js'}));
  }}],
});
const {App, CatalogProvider} = await import(pathToFileURL(bundle).href);
const container = document.getElementById('app');
let root;
const route = (id, payload = {}, published = true) => ({id, kind: 'route', published, payload: {title: id, image: '/images/synthetic-route.webp', distance: 8, ascent: 320, ...payload}});
async function mount(rows) {
  if (root) await act(async () => root.unmount());
  control.rows = structuredClone(rows); control.reads = 0;
  root = createRoot(container);
  await act(async () => root.render(createElement(MemoryRouter, {initialEntries: ['/']}, createElement(CatalogProvider, null, createElement(App)))));
  assert.equal(control.reads, 1, 'the real catalog requests the published collection');
}
const featured = () => container.querySelector('.home-routes .route-feature');
function assertEmptySelection() {
  assert.ok(!featured(), 'an unselected or unavailable route must never be labeled featured');
  assert.match(container.querySelector('.home-routes').textContent, /精选路线即将更新/);
  assert.ok(container.querySelector('.home-routes a[href="/routes"]'), 'visitors can still explore all routes');
}
after(async () => {
  if (root) await act(async () => root.unmount());
  dom.window.close();
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
  }
  await unlink(bundle); await rmdir(scratch);
});

test('home features the first real published opt-in instead of the first catalog route', async () => {
  await mount([
    route('旧路线没有精选标记'),
    route('本地草稿不能精选', {featured: true, localDraft: true}),
    route('示例不能精选', {featured: true, isDemo: true}),
    route('未发布不能精选', {featured: true}, false),
    route('已归档不能精选', {featured: true, archived: true}),
    route('管理员选中的路线', {featured: true}),
    route('稍后的精选路线', {featured: true}),
  ]);
  assert.ok(featured(), 'an eligible selection should appear');
  assert.equal(featured().getAttribute('href'), '/routes/管理员选中的路线');
  assert.equal(featured().querySelector('h3').textContent, '管理员选中的路线');
});

test('home offers a truthful empty selection for old routes and malformed opt-in flags', async () => {
  for (const rows of [[], [route('旧路线')], [route('非布尔标记', {featured: 'true'})], [route('只有样例', {featured: true, isDemo: true})]]) {
    await mount(rows);
    assertEmptySelection();
  }
});

test('removing the last featured flag via a catalog refresh removes the home recommendation', async () => {
  await mount([route('可取消的精选路线', {featured: true})]);
  assert.ok(featured());
  control.rows[0].payload.featured = false;
  await act(async () => window.dispatchEvent(new dom.window.Event('chuanheng-content-updated')));
  assert.equal(control.reads, 2);
  assertEmptySelection();
});
