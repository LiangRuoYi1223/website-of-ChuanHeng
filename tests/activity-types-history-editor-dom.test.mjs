import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {act, createElement} from 'react';
import {JSDOM} from 'jsdom';
import {build} from 'esbuild';
import {mkdir, mkdtemp, realpath, rmdir, unlink} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

// Real editor, catalog and listing components; only the network boundary is replaced.
const dom = new JSDOM('<!doctype html><div id="app"></div>', {url: 'https://frontend.invalid/admin/activities', pretendToBeVisual: true});
dom.window.confirm = () => true;
const originals = new Map();
function expose(key, value) {
  originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, {configurable: true, writable: true, value});
}
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'FormData', 'Event', 'localStorage']) {
  expose(key, key === 'window' ? dom.window : key === 'document' ? dom.window.document : dom.window[key]);
}
expose('IS_REACT_ACT_ENVIRONMENT', true);
expose('fetch', () => {throw new Error('Activity type tests must not make network requests');});
const {createRoot} = await import('react-dom/client');
const {MemoryRouter} = await import('react-router-dom');
const container = document.getElementById('app');
const admin = {id: 'ac710000-0000-4000-8000-000000000001', email: 'admin@example.invalid', app_metadata: {role: 'admin'}, user_metadata: {}, is_anonymous: false};
const control = {rows: [], writes: []};
function write(record) {
  control.rows = [...control.rows.filter(row => row.id !== record.id), structuredClone(record)];
}
const backend = {
  auth: {
    async getSession() {return {data: {session: {access_token: 'synthetic-only', user: admin}}, error: null};},
    async getUser() {return {data: {user: admin}, error: null};},
    onAuthStateChange() {return {data: {subscription: {unsubscribe() {}}}};},
  },
  from(table) {
    assert.equal(table, 'content_items');
    function save(record) {
      control.writes.push({name: 'content_items', record: structuredClone(record)});
      write(record);
      return {select() {return {single: async () => ({data: {id: record.id}, error: null})};}};
    }
    return {
      select(columns) {
        assert.ok(['id,kind,payload,published,created_at', 'id,kind,payload'].includes(columns));
        const list = {order: async () => ({data: structuredClone(control.rows), error: null})};
        return {...list, eq(field, value) {
          assert.equal(field, 'published'); assert.equal(value, true);
          return {order: async () => ({data: structuredClone(control.rows.filter(row => row.published)), error: null})};
        }};
      },
      insert: save,
      update(record) {return {eq(field, value) {assert.equal(field, 'id'); assert.equal(value, record.id); return save(record);}};},
    };
  },
  async rpc(name, args) {
    assert.equal(name, 'save_activity_with_route');
    const record = args.activity_record;
    control.writes.push({name, record: structuredClone(record)});
    const {expected, routeExpectedPayload, ...saved} = record;
    write(saved);
    return {data: {activity: saved, route: null}, error: null};
  },
};
expose('__ACTIVITY_TYPES_BACKEND', backend);
const project = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const artifacts = path.join(project, 'artifacts');
await mkdir(artifacts, {recursive: true});
const scratch = await mkdtemp(path.join(artifacts, 'activity-types-editor-'));
const bundle = path.join(scratch, 'components.mjs');
await build({
  stdin: {contents: "export {AdminPage, ContentEditor} from './src/pages/Admin.jsx'; export {ActivitiesPage, RoutesPage} from './src/pages/Explore.jsx'; export {CatalogProvider} from './src/catalog.jsx';", resolveDir: project, loader: 'jsx'},
  absWorkingDir: project, bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', loader: {'.css': 'empty'},
  define: {'import.meta.env': JSON.stringify({PROD: true, DEV: false, MODE: 'production', VITE_CONTENT_MODE: 'live'})},
  outfile: bundle,
  plugins: [{name: 'activity-types-network', setup(builder) {
    builder.onResolve({filter: /(?:^|[\\/])backend\.js$/}, () => ({path: 'backend', namespace: 'activity-types'}));
    builder.onLoad({filter: /.*/, namespace: 'activity-types'}, () => ({contents: 'export const supabase=globalThis.__ACTIVITY_TYPES_BACKEND;export const isBackendConfigured=true;export const backendConfigurationError="";', loader: 'js'}));
  }}],
});
const {AdminPage, ContentEditor, ActivitiesPage, RoutesPage, CatalogProvider} = await import(pathToFileURL(bundle).href);
let root;
const text = element => element.textContent.replace(/\s+/g, ' ').trim();
const button = label => [...container.querySelectorAll('button')].find(element => text(element) === label);
const form = () => container.querySelector('[role="dialog"] form, .activity-editor-page form');
const options = select => [...select.options].map(option => option.value);
const activity = (id, payload = {}, published = false) => ({id, kind: 'activity', published, created_at: '2026-11-01T00:00:00Z', payload: {title: id, image: '/images/test-cover.webp', ...payload}});
const route = (id, payload = {}, published = false) => ({id, kind: 'route', published, created_at: '2026-11-01T00:00:00Z', payload: {title: id, image: '/images/test-route.webp', distance: 3, ascent: 120, ...payload}});
async function mount(component, location = '/admin/activities') {
  if (root) await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () => root.render(createElement(MemoryRouter, {initialEntries: [location]}, component)));
}
async function click(element) {assert.ok(element, 'requested control exists'); await act(async () => element.click());}
async function waitFor(predicate, reason) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await act(async () => {await new Promise(resolve => setTimeout(resolve, 5));});
  }
  assert.fail(`Timed out waiting for ${reason}: ${text(container).slice(-650)}`);
}
async function fill(field, value) {
  assert.ok(field, 'requested field exists');
  await act(async () => {
    // Use the native setter so React sees controlled search changes, too.
    const prototype = field.tagName === 'SELECT' ? dom.window.HTMLSelectElement.prototype : field.tagName === 'TEXTAREA' ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(field, value);
    field.dispatchEvent(new dom.window.Event(field.tagName === 'SELECT' ? 'change' : 'input', {bubbles: true}));
  });
}
async function mountAdmin(rows = [], location = '/admin/activities') {
  control.rows = structuredClone(rows); control.writes = [];
  await mount(createElement(AdminPage), location);
  await waitFor(() => button(location.endsWith('/news') ? '新建资讯' : location.endsWith('/routes') ? '新建路线' : '新建活动'), 'administrator content list');
}
async function openExisting(id) {await click(container.querySelector(`[aria-label="编辑${id}"]`)); assert.ok(form());}
async function save() {
  const before = control.writes.length;
  await act(async () => form().dispatchEvent(new dom.window.Event('submit', {bubbles: true, cancelable: true})));
  await waitFor(() => control.writes.length > before && !form(), 'successful content save');
  return control.writes.at(-1).record;
}
after(async () => {
  if (root) await act(async () => root.unmount());
  dom.window.close();
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
  assert.equal(path.dirname(scratch), artifacts);
  await unlink(bundle); await rmdir(scratch);
});

test('activity editor offers the four fixed kinds and preserves unclassified and legacy kinds without guessing', async () => {
  await mountAdmin([activity('旧徒步活动', {type: '徒步'})]);
  await click(button('新建活动'));
  const field = form().querySelector('[name="type"]');
  assert.equal(field.tagName, 'SELECT', 'activity kind must be a selection rather than free text');
  assert.deepEqual(options(field), ['', '单日徒步', '重装徒步', '讲座活动', '攀冰', '徒步']);
  assert.equal(field.value, '', 'a new unclassified draft must not invent a category');
  await click(button('取消'));
  await openExisting('旧徒步活动');
  assert.equal(form().querySelector('[name="type"]').value, '徒步');
  const saved = await save();
  assert.equal(saved.payload.type, '徒步');
  assert.equal(saved.payload.showInHistory, false);
});

test('the real cloud save persists selected kind and history opt-in, and allows clearing the opt-in', async () => {
  await mountAdmin();
  await click(button('新建活动'));
  await fill(form().querySelector('[name="title"]'), '可提前标记的合成活动');
  await fill(form().querySelector('[name="type"]'), '攀冰');
  const flag = form().querySelector('[name="showInHistory"]');
  assert.ok(flag, 'activity editor provides the history opt-in');
  assert.equal(flag.checked, false);
  assert.match(text(flag.closest('label')), /展示到大事记/);
  assert.match(text(form()), /已发布.*已结束.*日期完整.*关于页/);
  await click(flag);
  const first = await save();
  assert.equal(control.writes.at(-1).name, 'save_activity_with_route');
  assert.equal(first.payload.type, '攀冰');
  assert.equal(first.payload.showInHistory, true);
  assert.equal(Object.hasOwn(first.payload, 'featured'), false, 'activity saves must not gain a route selection field');
  assert.equal(first.published, false, 'marking a future draft must not publish it');
  assert.equal(first.payload.status, '即将开始', 'the opt-in must not force an ended status');
  await openExisting('可提前标记的合成活动');
  assert.equal(form().querySelector('[name="showInHistory"]').checked, true);
  await click(form().querySelector('[name="showInHistory"]'));
  const second = await save();
  assert.equal(second.payload.showInHistory, false);
  assert.equal(second.expected.payload.showInHistory, true, 'existing optimistic version still accompanies the RPC');
});

test('history checkbox opts in only for boolean true and other content kinds retain their free-text type', async () => {
  for (const showInHistory of [undefined, false, 'true', true]) {
    await mount(createElement(ContentEditor, {editor: activity('合成活动', {type: '旧自定义分类', showInHistory}), local: false, busy: false, onSave() {}, onClose() {}}));
    const flag = form().querySelector('[name="showInHistory"]');
    assert.ok(flag, 'activity editor provides the history opt-in');
    assert.equal(flag.checked, showInHistory === true);
    assert.equal(form().querySelector('[name="type"]').value, '旧自定义分类');
  }
  for (const kind of ['route', 'photo', 'article']) {
    await mount(createElement(ContentEditor, {editor: {kind, payload: {title: '其他内容', type: '其他旧分类'}}, local: false, busy: false, onSave() {}, onClose() {}}));
    assert.equal(form().querySelector('[name="type"]').tagName, 'INPUT');
    assert.equal(form().querySelector('[name="type"]').value, '其他旧分类');
    assert.equal(form().querySelector('[name="showInHistory"]'), null);
  }
  await mountAdmin([], '/admin/news');
  await click(button('新建资讯'));
  await fill(form().querySelector('[name="title"]'), '合成资讯');
  await fill(form().querySelector('[name="type"]'), '自由输入分类');
  const saved = await save();
  assert.equal(saved.payload.type, '自由输入分类');
  assert.equal(Object.hasOwn(saved.payload, 'showInHistory'), false, 'other content saves must not gain a history field');
  assert.equal(Object.hasOwn(saved.payload, 'featured'), false, 'article saves must not gain a route selection field');
});

test('public kinds stay available with no records and append real legacy kinds once without blank options', async () => {
  for (const types of [[], ['徒步', '徒步', ' 单日旧类 ', '单日徒步', '', '   ', null]]) {
    control.rows = types.map((type, index) => activity(`合成分类${index}`, {type}, true));
    await mount(createElement(CatalogProvider, null, createElement(ActivitiesPage)), '/activities');
    await waitFor(() => !container.querySelector('.explore-catalog-feedback[role="status"]'), 'public catalog');
    const field = container.querySelector('select[aria-label="活动种类"]');
    assert.ok(field, 'public listing names the activity kind filter');
    assert.deepEqual(options(field), ['', '单日徒步', '重装徒步', '讲座活动', '攀冰', ...(types.length ? ['徒步', ' 单日旧类 '] : [])]);
    if (types.length) {
      await fill(field, ' 单日旧类 ');
      assert.deepEqual([...container.querySelectorAll('.explore-activity-card h2')].map(text), ['合成分类2']);
    }
  }
});

test('activity kind composes with status, region, difficulty and search, and reset clears all five filters', async () => {
  const base = {type: '重装徒步', status: '报名中', location: '四川', difficulty: '挑战', description: '高山合成测试'};
  control.rows = [
    activity('目标合成活动', base, true),
    activity('不同种类', {...base, type: '单日徒步'}, true),
    activity('不同状态', {...base, status: '已结束'}, true),
    activity('不同地区', {...base, location: '广东'}, true),
    activity('不同难度', {...base, difficulty: '入门'}, true),
    activity('不同关键词', {...base, description: '森林合成测试'}, true),
    activity('旧徒步分类', {...base, type: '徒步'}, true),
  ];
  await mount(createElement(CatalogProvider, null, createElement(ActivitiesPage)), '/activities');
  await waitFor(() => container.querySelectorAll('.explore-activity-card').length === 7, 'seven public fixtures');
  const field = container.querySelector('select[aria-label="活动种类"]');
  assert.ok(field, 'activity kind filter exists');
  await fill(field, '重装徒步');
  assert.equal(container.querySelectorAll('.explore-activity-card').length, 5);
  await click(button('报名中'));
  await fill(container.querySelector('select[aria-label="地区"]'), '四川');
  await fill(container.querySelector('select[aria-label="难度"]'), '挑战');
  await fill(container.querySelector('input[type="search"]'), '高山');
  assert.deepEqual([...container.querySelectorAll('.explore-activity-card h2')].map(text), ['目标合成活动']);
  await fill(field, '攀冰');
  assert.equal(container.querySelectorAll('.explore-activity-card').length, 0);
  await click(button('重置筛选'));
  assert.equal(container.querySelectorAll('.explore-activity-card').length, 7);
  assert.equal(button('全部活动').getAttribute('aria-pressed'), 'true');
  assert.deepEqual([...container.querySelectorAll('.explore-filters select')].map(element => element.value), ['', '', '']);
  assert.equal(container.querySelector('input[type="search"]').value, '');
});

test('route editor starts with no recommendation and saves explicit featured opt-in and opt-out', async () => {
  await mountAdmin([], '/admin/routes');
  await click(button('新建路线'));
  await fill(form().querySelector('[name="title"]'), '人工精选的合成路线');
  const flag = form().querySelector('[name="featured"]');
  assert.ok(flag, 'route editor provides the explicit featured flag');
  assert.match(text(flag.closest('label')), /设为精选路线/);
  assert.equal(flag.checked, false, 'new routes are never selected automatically');
  await click(flag);
  const first = await save();
  assert.equal(first.kind, 'route');
  assert.equal(first.payload.featured, true);
  assert.equal(Object.hasOwn(first.payload, 'showInHistory'), false);
  await openExisting('人工精选的合成路线');
  assert.equal(form().querySelector('[name="featured"]').checked, true);
  await click(form().querySelector('[name="featured"]'));
  const second = await save();
  assert.equal(second.payload.featured, false);
});

test('legacy route recommendations use boolean true only and are never inferred from position or text', async () => {
  for (const featured of [undefined, false, 'true', true]) {
    const old = route('旧合成路线', {featured});
    await mountAdmin([old], '/admin/routes');
    await openExisting('旧合成路线');
    const flag = form().querySelector('[name="featured"]');
    assert.ok(flag, 'route editor provides the explicit featured flag');
    assert.equal(flag.checked, featured === true);
    const saved = await save();
    assert.equal(saved.payload.featured, featured === true);
    assert.equal(saved.payload.distance, 3);
    assert.equal(saved.payload.ascent, 120);
  }
});

test('featured routes combine with the remaining filters and metric displays survive removal of metric filters', async () => {
  const base = {featured: true, location: '四川', difficulty: '挑战', source: '协会整理', description: '高山合成测试', distance: 123, ascent: 2345};
  control.rows = [
    route('目标合成路线', base, true),
    route('未精选路线', {...base, featured: false}, true),
    route('其他地区路线', {...base, location: '广东'}, true),
    route('其他难度路线', {...base, difficulty: '入门'}, true),
    route('其他来源路线', {...base, source: '公开资料'}, true),
    route('其他关键词路线', {...base, description: '森林合成测试'}, true),
    route('字符串标记路线', {...base, featured: 'true'}, true),
  ];
  await mount(createElement(CatalogProvider, null, createElement(RoutesPage)), '/routes');
  await waitFor(() => container.querySelectorAll('.explore-route-card').length === 7, 'public route fixtures');
  assert.ok(!container.querySelector('select[aria-label="距离"]'), 'route listing no longer exposes the distance filter');
  assert.ok(!container.querySelector('select[aria-label="爬升"]'), 'route listing no longer exposes the ascent filter');
  assert.deepEqual([...container.querySelectorAll('.explore-route-filters select')].map(element => element.getAttribute('aria-label')), ['地区', '难度', '来源']);
  assert.match(text(container.querySelector('.explore-route-card')), /123 km/);
  assert.match(text(container.querySelector('.explore-route-card')), /2345 m/);
  await click(button('精选路线'));
  assert.equal(container.querySelectorAll('.explore-route-card').length, 5, 'only explicit boolean selections qualify');
  await fill(container.querySelector('select[aria-label="地区"]'), '四川');
  await fill(container.querySelector('select[aria-label="难度"]'), '挑战');
  await fill(container.querySelector('select[aria-label="来源"]'), '协会整理');
  await fill(container.querySelector('input[type="search"]'), '高山');
  assert.deepEqual([...container.querySelectorAll('.explore-route-card h3')].map(text), ['目标合成路线']);
  await fill(container.querySelector('input[type="search"]'), '未匹配的测试文字');
  await click(button('重置筛选'));
  assert.equal(container.querySelectorAll('.explore-route-card').length, 7);
  assert.equal(button('全部路线').getAttribute('aria-pressed'), 'true');
  assert.deepEqual([...container.querySelectorAll('.explore-route-filters select')].map(element => element.value), ['', '', '']);
  assert.equal(container.querySelector('input[type="search"]').value, '');
});
