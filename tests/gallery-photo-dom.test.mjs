import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { act, createElement } from 'react';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { mkdir, mkdtemp, realpath, rmdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'http://localhost/' });
const originals = new Map();
for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true })) {
  originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { createRoot } = await import('react-dom/client');
const projectRoot = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const artifactsRoot = path.join(projectRoot, 'artifacts'); await mkdir(artifactsRoot, { recursive: true });
const scratch = await mkdtemp(path.join(artifactsRoot, 'gallery-photo-test-'));
const bundlePath = path.join(scratch, 'gallery.mjs');
// The service boundary is isolated here; its real validation/storage behavior is tested separately.
const output = await build({ stdin: { contents: "export {default} from './src/media/GalleryPhotoUpload.jsx';", resolveDir: projectRoot, loader: 'jsx' }, absWorkingDir: projectRoot, bundle: true, write: false, platform: 'node', format: 'esm', jsx: 'automatic', packages: 'external', loader: { '.css': 'empty' }, define: { 'import.meta.env': '{}' }, logLevel: 'silent', plugins: [{ name: 'service-boundary', setup(builder) {
  builder.onResolve({ filter: /\/gallery-photo\.js$/ }, () => ({ path: 'gallery-service', namespace: 'test' }));
  builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export const uploadGalleryPhoto = (...args) => globalThis.__galleryUpload(...args);' }));
} }] });
await writeFile(bundlePath, output.outputFiles[0].text, 'utf8');
const { default: GalleryPhotoUpload } = await import(pathToFileURL(bundlePath).href);
const container = document.getElementById('app'); let root;
after(async () => {
  if (root) await act(async () => root.unmount());
  dom.window.close();
  for (const [key, descriptor] of originals) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
  delete globalThis.__galleryUpload;
  await unlink(bundlePath); await rmdir(scratch);
});
async function mount(props = {}) {
  if (root) await act(async () => root.unmount()); root = createRoot(container);
  await act(async () => root.render(createElement('form', {}, createElement(GalleryPhotoUpload, props))));
}
async function choose(file = new dom.window.File(['photo'], 'photo.jpg', { type: 'image/jpeg' })) {
  const input = container.querySelector('input[type=file]'); assert.ok(input, 'file picker exists');
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await act(async () => input.dispatchEvent(new dom.window.Event('change', { bubbles: true })));
}
const saved = () => new dom.window.FormData(container.querySelector('form')).get('image');
const result = { url: 'https://test.example/new.webp', originalBytes: 5 * 1024 * 1024, outputBytes: 1024 * 1024 };
function deferredUpload() {
  let resolve, reject; const calls = [];
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  globalThis.__galleryUpload = (...args) => { calls.push(args); return promise; };
  return { resolve, reject, calls };
}

test('busy callbacks disable all controls, preserve old photo until success, then show new preview, hidden value and sizes', async () => {
  const busy = [], pending = deferredUpload(); await mount({ initialValue: '/existing.jpg', local: true, onBusyChange: value => busy.push(value) });
  assert.match(container.textContent, /原图.*20 MiB/); assert.match(container.textContent, /保存.*3 MiB/);
  await choose(); assert.equal(saved(), '/existing.jpg'); assert.deepEqual(busy, [true]); assert.ok(container.querySelector('[aria-busy=true]'));
  for (const control of container.querySelectorAll('button,input[type=file]')) assert.equal(control.disabled, true);
  assert.equal(pending.calls[0][2].local, true); assert.ok(pending.calls[0][2].signal);
  await choose(); assert.equal(pending.calls.length, 1, 'concurrent selection cannot start a second request');
  await act(async () => pending.resolve(result));
  assert.equal(saved(), result.url); assert.equal(container.querySelector('img').getAttribute('src'), result.url); assert.deepEqual(busy, [true, false]);
  assert.match(container.textContent, /5(?:\.0+)? MiB/); assert.match(container.textContent, /1(?:\.0+)? MiB/);
  assert.equal(container.querySelector('[aria-busy=true]'), null);
});
test('failed replacement preserves existing photo and exposes error; remove clears only editor state', async () => {
  const pending = deferredUpload(); await mount({ initialValue: '/existing.jpg' }); await choose();
  await act(async () => pending.reject(Error('照片处理失败')));
  assert.equal(saved(), '/existing.jpg'); assert.equal(container.querySelector('img').getAttribute('src'), '/existing.jpg'); assert.match(container.querySelector('[role=alert]').textContent, /照片处理失败.*原照片已保留/);
  const remove = [...container.querySelectorAll('button')].find(button => /移除/.test(button.textContent));
  await act(async () => remove.click()); assert.equal(saved(), ''); assert.equal(container.querySelector('img'), null); assert.equal(container.querySelector('[role=alert]'), null);
});
test('unmount aborts work, releases busy callback and ignores late results', async () => {
  const busy = [], pending = deferredUpload(); await mount({ initialValue: '/existing.jpg', onBusyChange: value => busy.push(value) }); await choose();
  const signal = pending.calls[0][2].signal;
  await act(async () => root.unmount()); root = null;
  assert.equal(signal.aborted, true); assert.deepEqual(busy, [true, false]);
  await act(async () => pending.resolve(result)); assert.deepEqual(busy, [true, false]); assert.equal(container.textContent, '');
});
test('disabled empty editor has no invented photo and never starts uploading', async () => {
  const pending = deferredUpload(); await mount({ disabled: true });
  assert.equal(saved(), ''); assert.equal(container.querySelector('img'), null); assert.equal(container.querySelector('input[type=file]').disabled, true);
  await choose(); assert.equal(pending.calls.length, 0);
});
