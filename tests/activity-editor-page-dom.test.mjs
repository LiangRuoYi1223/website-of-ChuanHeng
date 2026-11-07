import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {act, createElement} from 'react';
import {JSDOM} from 'jsdom';
import {build} from 'esbuild';
import {mkdir, mkdtemp, realpath, rmdir, unlink} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

// Exercise the real local editor and persistence path without a cloud connection.
const dom = new JSDOM('<!doctype html><div id="app"></div>', {url: 'http://localhost:5178/admin/activities?preview=1', pretendToBeVisual: true});
dom.window.confirm = () => true;
const originals = new Map();
function expose(key, value) {
  originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, {configurable: true, writable: true, value});
}
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'FormData', 'Event', 'localStorage']) expose(key, key === 'window' ? dom.window : key === 'document' ? dom.window.document : dom.window[key]);
expose('IS_REACT_ACT_ENVIRONMENT', true);
expose('fetch', () => {throw new Error('Local activity editor must not send cloud requests');});
const {createRoot} = await import('react-dom/client');
const {BrowserRouter, MemoryRouter, Route, Routes, useLocation, useNavigate} = await import('react-router-dom');
const project = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const artifacts = path.join(project, 'artifacts');
await mkdir(artifacts, {recursive: true});
const scratch = await mkdtemp(path.join(artifacts, 'activity-editor-page-'));
const bundle = path.join(scratch, 'components.mjs');
await build({
  stdin: {contents: "export {AdminPage} from './src/pages/Admin.jsx'; export {ActivityDetailPage} from './src/pages/Explore.jsx';", resolveDir: project, loader: 'jsx'},
  absWorkingDir: project, bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', loader: {'.css': 'empty'},
  define: {'import.meta.env': JSON.stringify({VITE_CONTENT_MODE: 'preview', VITE_TERRAIN_TILE_URL: 'offline'})}, outfile: bundle,
});
const {AdminPage, ActivityDetailPage} = await import(pathToFileURL(bundle).href);
const container = document.getElementById('app');
let root, currentLocation, navigate;
function Navigation() {currentLocation = useLocation(); navigate = useNavigate(); return null;}
const page = () => container.querySelector('.activity-editor-page');
const form = () => page()?.querySelector('form');
const preview = () => page()?.querySelector('.activity-editor-preview');
const text = element => element.textContent.replace(/\s+/g, ' ').trim();
const button = (label, scope = container) => [...scope.querySelectorAll('button')].find(element => text(element) === label);
const drafts = () => JSON.parse(localStorage.getItem('chuanheng-drafts') || '[]');
async function mount(location, {browser = false} = {}) {
  if (root) await act(async () => root.unmount());
  if (browser) window.history.replaceState(null, '', location);
  root = createRoot(container);
  await act(async () => root.render(createElement(browser ? BrowserRouter : MemoryRouter, browser ? null : {initialEntries: [location]}, createElement(Routes, null,
    createElement(Route, {path: '/admin/*', element: createElement(AdminPage)}),
    createElement(Route, {path: '/activities/:id', element: createElement(ActivityDetailPage)}),
  ), createElement(Navigation))));
}
async function click(element) {assert.ok(element, 'the requested control exists'); await act(async () => element.click());}
async function fill(name, value) {
  const field = form()?.querySelector(`[name="${name}"]`);
  assert.ok(field, `${name} is editable`);
  await act(async () => {
    const prototype = field.tagName === 'TEXTAREA' ? dom.window.HTMLTextAreaElement.prototype : field.tagName === 'SELECT' ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(field, value);
    field.dispatchEvent(new dom.window.Event(field.tagName === 'SELECT' ? 'change' : 'input', {bubbles: true}));
  });
}
async function waitFor(predicate, reason) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await act(async () => {await new Promise(resolve => setTimeout(resolve, 5));});
  }
  assert.fail(`Timed out waiting for ${reason}: ${text(container).slice(-600)}`);
}
after(async () => {
  if (root) await act(async () => root.unmount());
  dom.window.close();
  for (const [key, descriptor] of originals) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
  assert.equal(path.dirname(scratch), artifacts);
  await unlink(bundle); await rmdir(scratch);
});

test('new activity opens an addressable full page with a live preview instead of a modal', async () => {
  localStorage.clear();
  await mount('/admin/activities?preview=1');
  await click(button('新建活动'));
  assert.ok(page(), 'activity editing occupies a full page');
  assert.equal(page().getAttribute('aria-label'), '活动编辑工作区');
  assert.equal(container.querySelector('[role="dialog"]'), null, 'the activity editor must not be a modal');
  assert.equal(currentLocation.pathname, '/admin/activities/new');
  assert.equal(new URLSearchParams(currentLocation.search).get('preview'), '1');
  assert.ok(preview(), 'the preview is visible beside the editing form');
  await fill('title', '合成本地编辑预览');
  await fill('description', '修改后立即显示的活动简介。');
  assert.match(text(preview()), /合成本地编辑预览/);
  assert.match(text(preview()), /修改后立即显示的活动简介。/);
  assert.equal(drafts().length, 0, 'previewing does not silently save or publish a record');
  assert.equal(form().querySelector('[name="published"]'), null, 'local preview cannot publish');
});

test('direct new and edit URLs survive remount, save only a local draft, and keep content editable', async () => {
  localStorage.clear();
  await mount('/admin/activities/new?preview=1');
  await waitFor(() => page(), 'direct new activity page');
  await fill('title', '合成保存后重开活动');
  await fill('description', '保存前填写的简介');
  await act(async () => form().dispatchEvent(new dom.window.Event('submit', {bubbles: true, cancelable: true})));
  await waitFor(() => !page() && drafts().length === 1, 'local draft save and return to list');
  const [saved] = drafts();
  assert.equal(saved.kind, 'activity');
  assert.equal(saved.published, false);
  assert.equal(saved.payload.description, '保存前填写的简介');
  assert.equal(currentLocation.pathname, '/admin/activities');
  await click(container.querySelector(`[aria-label="编辑${saved.payload.title}"]`));
  await waitFor(() => page(), 'existing activity editing page');
  assert.equal(currentLocation.pathname, `/admin/activities/${saved.id}/edit`);
  await mount(`/admin/activities/${saved.id}/edit?preview=1`);
  await waitFor(() => form(), 'existing draft restored from its URL');
  assert.equal(form().querySelector('[name="title"]').value, saved.payload.title);
  assert.equal(form().querySelector('[name="description"]').value, saved.payload.description);
  assert.match(text(preview()), /保存前填写的简介/);
  await fill('description', '重开后修改的简介');
  await act(async () => form().dispatchEvent(new dom.window.Event('submit', {bubbles: true, cancelable: true})));
  await waitFor(() => !page(), 'updated local draft save');
  assert.equal(drafts().length, 1, 'saving the restored activity updates its own record');
  assert.equal(drafts()[0].payload.description, '重开后修改的简介');
});

test('browser back restores the list and forward reopens the addressable activity editing page', async () => {
  localStorage.clear();
  await mount('/admin/activities?preview=1');
  await click(button('新建活动'));
  assert.ok(page());
  await act(async () => navigate(-1));
  await waitFor(() => !page(), 'activity list after browser back');
  assert.equal(currentLocation.pathname, '/admin/activities');
  assert.ok(button('新建活动'));
  await act(async () => navigate(1));
  await waitFor(() => page(), 'activity editor reopened by browser forward');
  assert.equal(currentLocation.pathname, '/admin/activities/new');
  assert.ok(form());
});

test('datetime edits show a formatted preview date and clearing preserves a legacy date-only value', async () => {
  localStorage.clear();
  const legacy = {id: 'synthetic-legacy-date', kind: 'activity', published: false, payload: {title: '合成旧日期活动', dateStart: '2026-11-01'}};
  localStorage.setItem('chuanheng-drafts', JSON.stringify([legacy]));
  await mount(`/admin/activities/${legacy.id}/edit?preview=1`);
  await waitFor(() => form(), 'legacy activity date editor');
  await fill('dateStart', '2030-05-13T09:30');
  const date = () => text(preview().querySelector('.explore-heading-meta'));
  assert.match(date(), /2030\/05\/13/);
  assert.ok(!date().includes('T09:30'), 'datetime-local input is converted before public date formatting');
  await fill('dateStart', '');
  assert.match(date(), /2026\/11\/01/, 'an unknown legacy time retains its original known calendar date');
  assert.equal(drafts()[0].payload.dateStart, '2026-11-01', 'preview editing does not alter the persisted legacy date');
});

test('legacy activity preview uses the same original read-only metrics shown in the editing form', async () => {
  localStorage.clear();
  const legacy = {id: 'synthetic-legacy-metrics', kind: 'activity', published: false, payload: {title: '合成旧指标活动', distance: 12.808831764596027, ascent: 1062}};
  localStorage.setItem('chuanheng-drafts', JSON.stringify([legacy]));
  await mount(`/admin/activities/${legacy.id}/edit?preview=1`);
  await waitFor(() => form(), 'legacy metrics editor');
  const editingMetrics = [...form().querySelectorAll('.admin-track-metrics dd')].map(text);
  const previewMetrics = [...preview().querySelectorAll('.activity-editor-preview-metrics dd')].slice(0, 2).map(text);
  assert.deepEqual(editingMetrics, ['12.81 km', '1062 m']);
  assert.deepEqual(previewMetrics, editingMetrics, 'the absence of a new route does not erase historical metrics from the preview');
  assert.equal(form().querySelector('[name="distance"], [name="ascent"]'), null, 'activity metrics stay read only');
});

test('leaving a changed activity asks before discarding and cancellation retains all entered text', async () => {
  localStorage.clear();
  await mount('/admin/activities/new?preview=1');
  await waitFor(() => form(), 'new activity page');
  await fill('title', '尚未保存的活动标题');
  await fill('description', '不应因返回而丢失的活动简介');
  const prompts = [];
  let discard = false;
  window.confirm = message => {prompts.push(message); return discard;};
  try {
    await click(page().querySelector('[aria-label="返回活动列表"]'));
    assert.deepEqual(prompts, ['还有未保存的活动修改，确定离开并放弃修改吗？']);
    assert.ok(page(), 'canceling the discard prompt keeps the activity open');
    assert.equal(form().querySelector('[name="description"]').value, '不应因返回而丢失的活动简介');
    assert.equal(currentLocation.pathname, '/admin/activities/new');
    discard = true;
    await click(button('取消', form()));
    await waitFor(() => !page(), 'confirmed return to activity list');
    assert.equal(prompts.length, 2);
    assert.equal(currentLocation.pathname, '/admin/activities');
    assert.deepEqual(drafts(), [], 'discarding does not silently persist the unsaved activity');
  } finally {window.confirm = () => true;}
});

test('page-content list actions mark unsaved changes and successful save clears refresh protection', async () => {
  localStorage.clear();
  await mount('/admin/activities/new?preview=1');
  await waitFor(() => form(), 'new activity page');
  const unloading = () => {
    const event = new dom.window.Event('beforeunload', {cancelable: true});
    window.dispatchEvent(event);
    return event;
  };
  assert.equal(unloading().defaultPrevented, false, 'a pristine page does not block refresh');
  await click(button('添加装备模块', form()));
  assert.equal(unloading().defaultPrevented, true, 'adding a module protects unsaved content even without typing');
  let prompts = 0;
  window.confirm = () => {prompts++; return false;};
  try {
    await click(button('取消', form()));
    assert.equal(prompts, 1);
    assert.equal(form().querySelectorAll('#editor-equipment .activity-editor-item').length, 4, 'canceled navigation retains the added module');
    await fill('title', '保存后解除离开保护的活动');
    await act(async () => form().dispatchEvent(new dom.window.Event('submit', {bubbles: true, cancelable: true})));
    await waitFor(() => !page() && drafts().length === 1, 'saved local activity');
    assert.equal(prompts, 1, 'a successful save returns without another discard question');
    assert.equal(unloading().defaultPrevented, false, 'the saved activity no longer blocks refresh');
  } finally {window.confirm = () => true;}
});

test('canceling browser-back navigation retains the current activity and its unsaved values', async () => {
  localStorage.clear();
  await mount('/admin/activities?preview=1');
  await click(button('新建活动'));
  await fill('title', '浏览器后退不应丢失的活动');
  await fill('pageContent.overview.body', '已编辑但尚未保存的详细正文');
  let prompts = 0;
  window.confirm = () => {prompts++; return false;};
  try {
    await act(async () => navigate(-1));
    await waitFor(() => currentLocation.pathname === '/admin/activities/new', 'canceled back navigation restored activity URL');
    assert.equal(prompts, 1);
    assert.ok(page());
    assert.equal(form().querySelector('[name="title"]').value, '浏览器后退不应丢失的活动');
    assert.equal(form().querySelector('[name="pageContent.overview.body"]').value, '已编辑但尚未保存的详细正文');
    await act(async () => navigate('/admin/activities/new?preview=1#editor-equipment'));
    assert.equal(prompts, 1, 'changing the chapter hash does not ask to discard edits');
    assert.equal(form().querySelector('[name="title"]').value, '浏览器后退不应丢失的活动');
  } finally {window.confirm = () => true;}
});

test('preview tab reveals the editing fields when native validation rejects an empty title', async () => {
  localStorage.clear();
  await mount('/admin/activities/new?preview=1');
  await waitFor(() => form(), 'new activity page');
  await click(button('页面预览', page()));
  assert.equal(page().dataset.panel, 'preview');
  let valid;
  await act(async () => {valid = form().checkValidity();});
  assert.equal(valid, false, 'the required title is checked by the real form');
  assert.equal(page().dataset.panel, 'edit', 'the invalid field is revealed instead of staying hidden behind the preview');
  await waitFor(() => document.activeElement === form().querySelector('[name="title"]'), 'invalid title focused after revealing edit panel');
  assert.deepEqual(drafts(), []);
});

test('preview tab reveals the editing form and preserves its error when schedule validation rejects saving', async () => {
  localStorage.clear();
  await mount('/admin/activities/new?preview=1');
  await waitFor(() => form(), 'new activity page');
  await fill('title', '合成错误时间顺序活动');
  await fill('dateStart', '2030-05-13T09:30');
  await fill('dateEnd', '2030-05-13T08:30');
  await click(button('页面预览', page()));
  assert.equal(page().dataset.panel, 'preview');
  await act(async () => form().dispatchEvent(new dom.window.Event('submit', {bubbles: true, cancelable: true})));
  await waitFor(() => page()?.dataset.panel === 'edit', 'edit panel revealed after save error');
  assert.match(text(form().querySelector('[role="alert"]')), /活动结束时间必须晚于开始时间/);
  assert.equal(form().querySelector('[name="title"]').value, '合成错误时间顺序活动');
  assert.equal(form().querySelector('[name="dateEnd"]').value, '2030-05-13T08:30');
  assert.deepEqual(drafts(), [], 'the invalid schedule is never saved');
});

test('canceling BrowserRouter back across admin sections preserves the activity editing session', async () => {
  localStorage.clear();
  await mount('/admin/routes?preview=1', {browser: true});
  await act(async () => navigate('/admin/activities/new?preview=1'));
  await waitFor(() => form(), 'activity opened from route management');
  await fill('title', '跨栏目后退保留的活动');
  await fill('pageContent.overview.body', '跨栏目后退不应重置此正文');
  let prompts = 0;
  window.confirm = () => {prompts++; return false;};
  try {
    await act(async () => navigate(-1));
    await waitFor(() => prompts === 1 && currentLocation.pathname === '/admin/activities/new', 'cross-section back canceled and URL restored');
    assert.ok(page(), 'canceling does not replace the activity with route management');
    assert.equal(form().querySelector('[name="title"]').value, '跨栏目后退保留的活动');
    assert.equal(form().querySelector('[name="pageContent.overview.body"]').value, '跨栏目后退不应重置此正文');
    assert.deepEqual(drafts(), []);
  } finally {window.confirm = () => true;}
});

test('native BrowserRouter back outside admin preserves edits when canceled and leaves when confirmed', async () => {
  localStorage.clear();
  const previous = {id: 'synthetic-outside-admin-back', kind: 'activity', published: false, payload: {title: '合成既有活动'}};
  localStorage.setItem('chuanheng-drafts', JSON.stringify([previous]));
  const previousURL = `/activities/${previous.id}?draft=1`;
  await mount(previousURL, {browser: true});
  assert.ok(container.querySelector('.explore-activity-detail'), 'history begins at a public activity page');
  await act(async () => navigate('/admin/activities/new?preview=1'));
  await waitFor(() => form(), 'new activity editing page');
  await fill('title', '原生后退必须保护的活动');
  await fill('pageContent.overview.body', '离开后台前仍未保存的详细正文');
  let prompts = 0;
  let discard = false;
  window.confirm = () => {prompts++; return discard;};
  try {
    await act(async () => window.history.back());
    await waitFor(() => prompts === 1 && window.location.pathname === '/admin/activities/new', 'native outside-admin back canceled and browser URL restored');
    assert.equal(currentLocation.pathname, '/admin/activities/new');
    assert.equal(form().querySelector('[name="title"]').value, '原生后退必须保护的活动');
    assert.equal(form().querySelector('[name="pageContent.overview.body"]').value, '离开后台前仍未保存的详细正文');
    discard = true;
    await act(async () => window.history.back());
    await waitFor(() => !page() && currentLocation.pathname === `/activities/${previous.id}`, 'confirmed native outside-admin navigation');
    assert.equal(prompts, 2, 'each attempted departure asks once');
    assert.equal(window.location.pathname, `/activities/${previous.id}`);
    assert.ok(container.querySelector('.explore-activity-detail'));
    assert.deepEqual(drafts(), [previous], 'discarding leaves existing records intact and does not save the unfinished activity');
  } finally {window.confirm = () => true;}
});

test('editable introduction, itinerary, equipment and safety persist and match the full activity detail', async () => {
  localStorage.clear();
  await mount('/admin/activities/new?preview=1');
  await waitFor(() => form(), 'direct activity editing page');
  await fill('title', '合成正文编辑活动');
  await fill('description', '仅用于本地集成测试的简介');
  await fill('pageContent.overview.title', '自定义活动介绍');
  await fill('pageContent.overview.body', '第一段活动正文\n第二段活动正文');
  await fill('pageContent.overview.noteTitle', '本次集合说明');
  await fill('pageContent.overview.noteBody', '请在指定集合点签到');
  await fill('pageContent.itinerary.title', '本次行程');
  await fill('pageContent.itinerary.intro', '以当天领队安排为准');
  await fill('pageContent.equipment.title', '本次装备');
  await fill('pageContent.equipment.intro', '请逐项核对');
  await fill('pageContent.safety.title', '本次安全要求');
  await fill('pageContent.safety.outro', '活动前再次确认天气');
  for (const kind of ['行程', '装备', '安全']) {
    let remove;
    while ((remove = form().querySelector(`[aria-label="删除${kind}第1项"]`))) await click(remove);
  }
  for (const [index, time, title, description] of [[0, '08:00', '集合', '签到并检查装备'], [1, '09:00', '出发', '按领队安排同行']]) {
    await click(button('添加行程项', form()));
    await fill(`pageContent.itinerary.items.${index}.time`, time);
    await fill(`pageContent.itinerary.items.${index}.title`, title);
    await fill(`pageContent.itinerary.items.${index}.description`, description);
  }
  await click(button('添加装备模块', form()));
  await fill('pageContent.equipment.items.0.title', '照明装备');
  await fill('pageContent.equipment.items.0.description', '头灯与备用电池');
  await click(button('添加装备模块', form()));
  await fill('pageContent.equipment.items.1.title', '通信装备');
  await fill('pageContent.equipment.items.1.description', '充满电的手机');
  await click(form().querySelector('[aria-label="上移装备第2项"]'));
  await click(button('添加安全条目', form()));
  await fill('pageContent.safety.items.0', '身体不适及时告知领队');
  await click(button('添加安全条目', form()));
  await fill('pageContent.safety.items.1', '服从临时撤退安排');
  const sectionIds = ['activity-overview', 'activity-plan', 'activity-equipment', 'activity-safety'];
  const sectionCopy = scope => sectionIds.map(id => text(scope.querySelector(`#${id}`)));
  const beforeSave = sectionCopy(preview());
  assert.match(beforeSave[0], /自定义活动介绍.*第一段活动正文.*第二段活动正文.*本次集合说明/);
  assert.match(beforeSave[1], /本次行程.*08:00.*集合.*09:00.*出发/);
  assert.match(beforeSave[2], /本次装备.*通信装备.*照明装备/);
  assert.match(beforeSave[3], /本次安全要求.*身体不适.*临时撤退.*再次确认天气/);
  assert.ok(!text(preview()).includes('充分准备'), 'removed itinerary defaults stay removed');
  await act(async () => form().dispatchEvent(new dom.window.Event('submit', {bubbles: true, cancelable: true})));
  await waitFor(() => !page() && drafts().length === 1, 'full page content saved locally');
  const [saved] = drafts();
  assert.deepEqual(saved.payload.pageContent.itinerary.items, [
    {time: '08:00', title: '集合', description: '签到并检查装备'},
    {time: '09:00', title: '出发', description: '按领队安排同行'},
  ]);
  assert.deepEqual(saved.payload.pageContent.equipment.items.map(item => item.title), ['通信装备', '照明装备']);
  assert.deepEqual(saved.payload.pageContent.safety.items, ['身体不适及时告知领队', '服从临时撤退安排']);
  await mount(`/admin/activities/${saved.id}/edit?preview=1`);
  await waitFor(() => form(), 'saved full page content reopened');
  assert.equal(form().querySelector('[name="pageContent.overview.body"]').value, '第一段活动正文\n第二段活动正文');
  assert.equal(form().querySelector('[name="pageContent.equipment.items.0.title"]').value, '通信装备');
  assert.deepEqual(sectionCopy(preview()), beforeSave, 'reopening renders the same content and order');
  await mount(`/activities/${saved.id}?draft=1`);
  const detail = container.querySelector('article.explore-detail-body');
  assert.ok(detail, 'the full local activity detail uses the saved draft');
  assert.deepEqual(sectionCopy(detail), beforeSave, 'detail sections match the editor preview after saving');
  assert.match(text(container), /本地活动草稿，尚未公开发布/);
  assert.equal(saved.published, false, 'saving editable copy never publishes a local draft');
});
