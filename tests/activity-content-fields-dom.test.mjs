import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {act, createElement, useState} from 'react';
import {JSDOM} from 'jsdom';
import {build} from 'esbuild';
import {mkdir, mkdtemp, realpath, rmdir, unlink} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

// These tests edit the real controlled fields. No network or browser is needed.
const dom = new JSDOM('<!doctype html><div id="app"></div>', {url: 'http://localhost:5178', pretendToBeVisual: true});
const originals = new Map();
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Event']) {
  originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, {configurable: true, writable: true, value: key === 'window' ? dom.window : key === 'document' ? dom.window.document : dom.window[key]});
}
originals.set('IS_REACT_ACT_ENVIRONMENT', Object.getOwnPropertyDescriptor(globalThis, 'IS_REACT_ACT_ENVIRONMENT'));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const {createRoot} = await import('react-dom/client');
const project = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const artifacts = path.join(project, 'artifacts');
await mkdir(artifacts, {recursive: true});
const scratch = await mkdtemp(path.join(artifacts, 'activity-content-fields-'));
const bundle = path.join(scratch, 'fields.mjs');
let root;
after(async () => {
  if (root) await act(async () => root.unmount());
  dom.window.close();
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
  await unlink(bundle).catch(error => {if (error.code !== 'ENOENT') throw error;});
  await rmdir(scratch);
});

await build({
  stdin: {contents: "export {default} from './src/activities/ActivityContentFields.jsx';", resolveDir: project, loader: 'jsx'},
  absWorkingDir: project, bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', outfile: bundle,
});
const {default: ActivityContentFields} = await import(pathToFileURL(bundle).href);
const container = document.getElementById('app');
const fixture = () => ({
  overview: {title: '介绍', body: '第一段\n第二段', noteTitle: '资料', noteBody: '已核实资料'},
  itinerary: {title: '行程', intro: '行程说明', items: [{time: '08:00', title: '集合', description: '集合说明'}, {time: '10:00', title: '抵达', description: '抵达说明'}]},
  equipment: {title: '装备', intro: '装备说明', items: [{title: '衣物', description: '防风衣'}, {title: '补给', description: '饮水'}]},
  safety: {title: '安全', items: ['注意天气', '确认体能'], outro: '安全补充'},
});
let changes = [];
function Harness({initial, disabled = false}) {
  const [value, setValue] = useState(initial);
  return createElement('form', {}, createElement(ActivityContentFields, {value, disabled, onChange(next) {changes.push(next); setValue(next);}}));
}
async function mount(initial = fixture(), disabled = false) {
  if (root) await act(async () => root.unmount());
  changes = [];
  root = createRoot(container);
  await act(async () => root.render(createElement(Harness, {initial, disabled})));
}
const field = name => container.querySelector(`[name="pageContent.${name}"]`);
const saved = () => JSON.parse(container.querySelector('input[name="pageContent"]').value);
const text = element => element.textContent.replace(/\s+/g, ' ').trim();
const button = label => [...container.querySelectorAll('button')].find(element => element.getAttribute('aria-label') === label || text(element) === label);
async function click(element) {assert.ok(element, 'requested action exists'); await act(async () => element.click());}
async function fill(element, value) {
  assert.ok(element, 'requested field exists');
  await act(async () => {
    const prototype = element.tagName === 'TEXTAREA' ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
    element.dispatchEvent(new dom.window.Event('input', {bubbles: true}));
  });
}

test('all prose fields can be changed, preserve paragraphs, and serialize without mutating the source', async () => {
  const original = fixture();
  const before = structuredClone(original);
  await mount(original);
  for (const [name, value] of [
    ['overview.title', '我的活动介绍'], ['overview.body', '新段一\n新段二'], ['overview.noteTitle', '集合信息'], ['overview.noteBody', '一楼集合\n请准时'],
    ['itinerary.title', '当天行程'], ['itinerary.intro', '行程可调整'], ['equipment.title', '个人装备'], ['equipment.intro', '准备说明'],
    ['safety.title', '出行安全'], ['safety.outro', '请遵守约定'],
  ]) await fill(field(name), value);
  assert.deepEqual(saved().overview, {title: '我的活动介绍', body: '新段一\n新段二', noteTitle: '集合信息', noteBody: '一楼集合\n请准时'});
  assert.equal(saved().itinerary.title, '当天行程');
  assert.equal(saved().equipment.intro, '准备说明');
  assert.equal(saved().safety.outro, '请遵守约定');
  assert.deepEqual(original, before, 'controlled editing must never mutate the original conflict snapshot');
  assert.ok(changes.length >= 10);
  for (const item of container.querySelectorAll('button')) assert.equal(item.type, 'button', 'list actions must not submit the activity');
});

test('itinerary additions, moves and removals keep the edited item and input node together', async () => {
  await mount();
  await fill(field('itinerary.items.1.title'), '改为午餐');
  const movedInput = field('itinerary.items.1.title');
  movedInput.focus();
  await click(button('上移行程第2项'));
  assert.equal(saved().itinerary.items[0].title, '改为午餐');
  assert.equal(field('itinerary.items.0.title'), movedInput, 'moving keeps stable item identity');
  assert.equal(document.activeElement, movedInput, 'moving preserves keyboard editing focus');
  await click(button('删除行程第2项'));
  assert.deepEqual(saved().itinerary.items, [{time: '10:00', title: '改为午餐', description: '抵达说明'}]);
  await click(button('添加行程项'));
  await fill(field('itinerary.items.1.time'), '14:00');
  await fill(field('itinerary.items.1.title'), '返程');
  await fill(field('itinerary.items.1.description'), '确认人数后返回');
  assert.deepEqual(saved().itinerary.items[1], {time: '14:00', title: '返程', description: '确认人数后返回'});
});

test('equipment and safety can be reordered, emptied, and rebuilt without restoring deleted defaults', async () => {
  await mount();
  await click(button('下移装备第1项'));
  assert.equal(saved().equipment.items[0].title, '补给');
  await click(button('删除装备第1项'));
  await click(button('删除装备第1项'));
  assert.deepEqual(saved().equipment.items, []);
  await click(button('添加装备模块'));
  await fill(field('equipment.items.0.title'), '通信');
  await fill(field('equipment.items.0.description'), '充满电的手机');
  assert.deepEqual(saved().equipment.items, [{title: '通信', description: '充满电的手机'}]);
  await click(button('下移安全第1项'));
  assert.deepEqual(saved().safety.items, ['确认体能', '注意天气']);
  await click(button('删除安全第1项'));
  await click(button('删除安全第1项'));
  assert.deepEqual(saved().safety.items, []);
  await click(button('添加安全条目'));
  await fill(field('safety.items.0'), '带走全部垃圾\n不干扰野生动物');
  assert.deepEqual(saved().safety.items, ['带走全部垃圾\n不干扰野生动物']);
});

test('the item limit and disabled mode prevent accidental edits while preserving serialized data', async () => {
  const initial = fixture();
  initial.itinerary.items = Array.from({length: 50}, (_, index) => ({time: '', title: `行程${index}`, description: ''}));
  await mount(initial);
  assert.equal(button('添加行程项').disabled, true);
  assert.match(text(container.querySelector('#editor-itinerary')), /50/);
  await click(button('添加行程项'));
  assert.equal(saved().itinerary.items.length, 50);
  await mount(fixture(), true);
  for (const element of container.querySelectorAll('button, input:not([type="hidden"]), textarea')) assert.equal(element.disabled, true);
  assert.deepEqual(saved(), fixture());
});
