import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { act, createElement } from 'react';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dom = new JSDOM('<button id="outside">正文</button><div id="app"></div>', { url: 'https://frontend.invalid/activities/test', pretendToBeVisual: true });
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Event', 'MouseEvent', 'KeyboardEvent']) Object.defineProperty(globalThis, key, { value: key === 'window' ? dom.window : key === 'document' ? dom.window.document : dom.window[key], configurable: true });
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const media = { matches: false, listeners: new Set(), addEventListener(type, fn) { this.listeners.add(fn); }, removeEventListener(type, fn) { this.listeners.delete(fn); } };
window.matchMedia = () => media;
let modalShows = 0;
dom.window.HTMLDialogElement.prototype.showModal = function () { if (this.open) throw new dom.window.DOMException('Already open non-modally', 'InvalidStateError'); modalShows++; this.setAttribute('open', ''); };
dom.window.HTMLDialogElement.prototype.close = function () { this.removeAttribute('open'); this.dispatchEvent(new Event('close')); };
dom.window.HTMLElement.prototype.scrollIntoView = function () {};
const { createRoot } = await import('react-dom/client');
const { MemoryRouter } = await import('react-router-dom');
const controller = { mounts: 0, unmounts: 0, slots: {} };
globalThis.__SIDEBAR_MODEL = controller;
function setSlots(label = '入选 · 3/10') {
  controller.slots = { shortLabel: label, checking: false, summary: createElement('div', { className: 'application-summary' }, label, createElement('p', { className: 'application-ranking' }, '当前排位 / 活动名额', createElement('b', null, '3/10'))), details: createElement('div', { className: 'application-details' }, createElement('p', null, '入选待缴费'), createElement('p', null, '正式缴费说明。'.repeat(40))), actions: createElement('div', { className: 'application-controls' }, createElement('button', { type: 'button' }, '退出本次报名')) };
}
const project = await realpath(fileURLToPath(new URL('../', import.meta.url)));
await mkdir(path.join(project, 'artifacts'), { recursive: true });
const scratch = await mkdtemp(path.join(project, 'artifacts', 'sidebar-dom-'));
const bundle = path.join(scratch, 'component.mjs');
await build({ stdin: { contents: "export {default} from './src/activities/ActivitySidebar.jsx'", resolveDir: project, loader: 'jsx' }, bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', loader: { '.css': 'empty' }, outfile: bundle, plugins: [{ name: 'registration-state', setup(builder) { builder.onResolve({ filter: /ActivityApplication\.jsx$/ }, () => ({ path: 'registration', namespace: 'mock' })); builder.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: "import {useEffect} from 'react';export default function MockApplication({children}){useEffect(()=>{globalThis.__SIDEBAR_MODEL.mounts++;return()=>globalThis.__SIDEBAR_MODEL.unmounts++;},[]);return children(globalThis.__SIDEBAR_MODEL.slots);}", loader: 'js', resolveDir: project })); } }] });
const Component = (await import(pathToFileURL(bundle))).default;
const container = document.getElementById('app');
const activity = { id: 'test', title: '长活动名称'.repeat(7), distance: 12.8, ascent: 1062, difficulty: '入门', location: '惠州市', dateStart: '2026-11-08T00:00:00Z', dateEnd: '2026-11-08T10:00:00Z', registrationStart: '2026-11-02T00:00:00Z', registrationDeadline: '2026-11-06T12:00:00Z' };
let root;
async function mount({ mobile = false, hash = '', overrides = {} } = {}) {
  if (root) await act(async () => root.unmount());
  media.matches = mobile; modalShows = 0; controller.mounts = 0; controller.unmounts = 0; setSlots();
  window.history.replaceState(null, '', `/activities/test${hash}`);
  root = createRoot(container);
  await act(async () => root.render(createElement(MemoryRouter, { initialEntries: ['/activities/test' + hash] }, createElement(Component, { activity: { ...activity, ...overrides } }))));
}
async function click(node) { assert.ok(node); await act(async () => node.click()); }
const button = label => [...container.querySelectorAll('button')].find(node => node.textContent.trim() === label);
const tabs = () => [...container.querySelectorAll('[role="tab"]')];
after(async () => { if (root) await act(async () => root.unmount()); dom.window.close(); assert.equal(path.dirname(scratch), path.join(project, 'artifacts')); await rm(scratch, { recursive: true }); });

test('activity tabs switch with pointer and keyboard while the one registration footer remains mounted', async () => {
  await mount();
  assert.deepEqual(tabs().map(node => node.textContent), ['活动资料', '报名详情']);
  assert.equal(tabs()[0].getAttribute('aria-selected'), 'true');
  await click(tabs()[1]);
  assert.equal(tabs()[1].getAttribute('aria-selected'), 'true');
  assert.equal(document.getElementById(tabs()[1].getAttribute('aria-controls')).hidden, false);
  await act(async () => tabs()[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })));
  assert.equal(tabs()[0].getAttribute('aria-selected'), 'true');
  assert.equal(document.activeElement, tabs()[0]);
  assert.match(container.querySelector('.activity-sidebar-footer').textContent, /3\/10/);
  assert.ok(button('退出本次报名'));
  await click(button('查看报名详情'));
  assert.equal(tabs()[1].getAttribute('aria-selected'), 'true');
  assert.equal(controller.mounts, 1); assert.equal(modalShows, 0);
});

test('mobile information opens modally, restores focus and body scrolling on close, and is not duplicated', async () => {
  document.body.style.overflow = 'scroll';
  await mount({ mobile: true });
  const trigger = button('活动信息与报名');
  trigger.focus();
  await click(trigger);
  const dialog = container.querySelector('dialog');
  assert.equal(dialog.open, true); assert.equal(modalShows, 1);
  assert.equal(document.body.style.overflow, 'hidden');
  assert.equal(controller.mounts, 1);
  await click(button('关闭活动信息'));
  assert.equal(dialog.open, false); assert.equal(document.body.style.overflow, 'scroll');
  assert.equal(document.activeElement, trigger);
  await click(trigger);
  await act(async () => dialog.dispatchEvent(new Event('cancel', { bubbles: false, cancelable: true })));
  assert.equal(dialog.open, false);
  assert.equal(document.body.style.overflow, 'scroll');
  document.body.style.overflow = '';
});

test('application hash opens registration on mobile and desktop resize exits the modal without losing state', async () => {
  await mount({ mobile: true, hash: '#application' });
  const dialog = container.querySelector('dialog');
  assert.equal(dialog.open, true); assert.equal(tabs()[1].getAttribute('aria-selected'), 'true');
  await act(async () => { media.matches = false; for (const fn of media.listeners) fn({ matches: false }); });
  assert.notEqual(document.body.style.overflow, 'hidden');
  assert.equal(dialog.getAttribute('aria-modal'), null);
  assert.equal(document.activeElement, tabs()[1], 'desktop returns focus to the currently selected tab');
  assert.equal(controller.mounts, 1);
  await act(async () => { media.matches = true; for (const fn of media.listeners) fn({ matches: true }); });
  assert.equal(dialog.open, false);
  window.location.hash = '';
  await act(async () => { window.history.replaceState(null, '', '/activities/test#application'); window.dispatchEvent(new Event('hashchange')); });
  assert.equal(dialog.open, true);
  await click(button('关闭活动信息'));
  await act(async () => { window.history.replaceState(null, '', '/activities/test#activity-track'); window.dispatchEvent(new Event('hashchange')); });
  assert.equal(dialog.open, false, 'leaving the application hash must not reopen the drawer');
});

test('summary preserves zero metrics and unknown schedule without fabricating activity data', async () => {
  await mount({ overrides: { distance: 0, ascent: 0, dateStart: null, dateEnd: null, registrationStart: null, registrationDeadline: null, location: '', difficulty: '' } });
  const header = container.querySelector('.activity-sidebar-header');
  assert.match(header.textContent, /0\s*km/); assert.match(header.textContent, /0\s*m/);
  assert.match(header.textContent, /待公布/);
  const info = document.getElementById(tabs()[0].getAttribute('aria-controls'));
  assert.match(info.textContent, /待公布/); assert.match(info.textContent, /未公布/);
  assert.equal(container.querySelectorAll('#application').length, 1);
});

test('changing activity resets the drawer and unmounting restores the original scroll setting', async () => {
  document.body.style.overflow = 'scroll';
  await mount({ mobile: true });
  await click(button('活动信息与报名'));
  await click(tabs()[1]);
  await act(async () => root.render(createElement(MemoryRouter, { initialEntries: ['/activities/test'] }, createElement(Component, { activity: { ...activity, id: 'another' } }))));
  assert.equal(container.querySelector('dialog').open, false);
  assert.equal(tabs()[0].getAttribute('aria-selected'), 'true');
  await click(button('活动信息与报名'));
  await act(async () => root.unmount()); root = null;
  assert.equal(document.body.style.overflow, 'scroll');
  assert.equal(media.listeners.size, 0);
  document.body.style.overflow = '';
});

test('mobile dialog fallback keeps closing and scroll restoration available', async () => {
  const showModal = dom.window.HTMLDialogElement.prototype.showModal;
  const close = dom.window.HTMLDialogElement.prototype.close;
  dom.window.HTMLDialogElement.prototype.showModal = undefined;
  dom.window.HTMLDialogElement.prototype.close = undefined;
  try {
    await mount({ mobile: true });
    await click(button('活动信息与报名'));
    assert.equal(container.querySelector('dialog').open, true);
    await click(button('关闭活动信息'));
    assert.equal(container.querySelector('dialog').open, false);
    assert.notEqual(document.body.style.overflow, 'hidden');
  } finally { dom.window.HTMLDialogElement.prototype.showModal = showModal; dom.window.HTMLDialogElement.prototype.close = close; }
});
