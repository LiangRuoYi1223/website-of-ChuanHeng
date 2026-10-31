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
for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, FileReader: dom.window.FileReader, IS_REACT_ACT_ENVIRONMENT: true })) {
  originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { createRoot } = await import('react-dom/client');
const projectRoot = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const artifactsRoot = path.join(projectRoot, 'artifacts'); await mkdir(artifactsRoot, { recursive: true });
const scratch = await mkdtemp(path.join(artifactsRoot, 'activity-cover-test-'));
const bundlePath = path.join(scratch, 'cover.mjs');
const output = await build({ stdin: { contents: "export {default} from './src/media/ActivityCoverUpload.jsx';", resolveDir: projectRoot, loader: 'jsx' }, absWorkingDir: projectRoot, bundle: true, write: false, platform: 'node', format: 'esm', jsx: 'automatic', packages: 'external', loader: { '.css': 'empty' }, define: { 'import.meta.env': '{}' }, logLevel: 'silent' });
await writeFile(bundlePath, output.outputFiles[0].text, 'utf8');
const { default: ActivityCoverUpload } = await import(pathToFileURL(bundlePath).href);
const container = dom.window.document.getElementById('app'); let root;
after(async () => {
  if (root) await act(async () => root.unmount());
  dom.window.close();
  for (const [key, descriptor] of originals) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
  await unlink(bundlePath); await rmdir(scratch);
});
async function mount(props) {
  if (root) await act(async () => root.unmount()); root = createRoot(container);
  await act(async () => root.render(createElement('form', {}, createElement(ActivityCoverUpload, props))));
}
async function choose(file) {
  const input = container.querySelector('input[type=file]'); assert.ok(input, 'file picker exists');
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await act(async () => input.dispatchEvent(new dom.window.Event('change', { bubbles: true })));
}
async function settled() {
  for (let i = 0; i < 100 && container.querySelector('[aria-busy=true]'); i++) await act(async () => new Promise(resolve => setTimeout(resolve, 5)));
  assert.equal(container.querySelector('[aria-busy=true]'), null);
}
const saved = () => new dom.window.FormData(container.querySelector('form')).get('image');

test('local file selection updates preview and hidden field only after read, with busy callbacks', async () => {
  const busy = []; await mount({ local: true, initialValue: '/existing.jpg', onBusyChange: value => busy.push(value) });
  assert.equal(saved(), '/existing.jpg');
  await choose(new dom.window.File(['sample'], 'photo.png', { type: 'image/png' })); await settled();
  assert.match(saved(), /^data:image\/png;base64,/);
  assert.equal(container.querySelector('img').getAttribute('src'), saved());
  assert.equal(busy[0], true); assert.equal(busy.at(-1), false);
});

test('rejected replacement leaves original URL in hidden field and preview, then shows an actionable error', async () => {
  const busy = []; await mount({ local: true, initialValue: '/existing.jpg', onBusyChange: value => busy.push(value) });
  await choose(new dom.window.File(['<svg/>'], 'unsafe.svg', { type: 'image/svg+xml' })); await settled();
  assert.equal(saved(), '/existing.jpg'); assert.equal(container.querySelector('img').getAttribute('src'), '/existing.jpg');
  assert.match(container.querySelector('[role=alert]').textContent, /JPEG.*PNG.*WebP/);
  assert.equal(busy.at(-1), false);
});

test('disabled editor disables file upload and no image is invented for an empty cover', async () => {
  await mount({ local: true, disabled: true });
  assert.equal(container.querySelector('input[type=file]').disabled, true);
  assert.equal(saved(), ''); assert.equal(container.querySelector('img'), null);
});
