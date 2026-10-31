import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { act, createElement } from 'react';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { mkdir, mkdtemp, realpath, rmdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dom = new JSDOM('<!doctype html><div id="app"></div>', { url: 'http://localhost/' });
const originals = new Map();
for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true })) {
  originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { createRoot } = await import('react-dom/client');
const projectRoot = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const artifactsRoot = path.join(projectRoot, 'artifacts'); await mkdir(artifactsRoot, { recursive: true });
const scratch = await mkdtemp(path.join(artifactsRoot, 'activity-public-cover-test-'));
const bundlePath = path.join(scratch, 'cover.mjs');
const output = await build({ stdin: { contents: "export {default} from './src/media/ActivityCover.jsx';", resolveDir: projectRoot, loader: 'jsx' }, absWorkingDir: projectRoot, bundle: true, write: false, platform: 'node', format: 'esm', jsx: 'automatic', packages: 'external', loader: { '.css': 'empty' }, define: { 'import.meta.env': '{}' }, logLevel: 'silent' });
await writeFile(bundlePath, output.outputFiles[0].text, 'utf8');
const { default: ActivityCover } = await import(pathToFileURL(bundlePath).href);
const container = dom.window.document.getElementById('app'); let root;
const fallback = '/images/redesign-v2/activities-snow.webp';
const label = 'AI 示意影像 · 非活动实拍';
after(async () => {
  if (root) await act(async () => root.unmount());
  dom.window.close();
  for (const [key, descriptor] of originals) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
  await unlink(bundlePath); await rmdir(scratch);
});
async function mount(item, loading) {
  if (root) await act(async () => root.unmount());
  root = createRoot(container);
  await render(item, loading);
}
async function render(item, loading) { await act(async () => root.render(createElement(ActivityCover, { item, loading }))); }
async function failImage() {
  const img = container.querySelector('img'); assert.ok(img);
  await act(async () => img.dispatchEvent(new dom.window.Event('error')));
}

test('missing covers display a disclosed illustration without adding a wrapper', async () => {
  await mount({ title: '活动', image: '' });
  const img = container.querySelector('img'); assert.ok(img);
  assert.equal(img.getAttribute('src'), fallback); assert.equal(img.parentElement, container);
  assert.equal(img.getAttribute('loading'), 'lazy'); assert.ok(container.textContent.includes(label));
});

test('real uploaded covers remain undisclosed as AI until image loading fails', async () => {
  await mount({ title: '活动', image: 'https://example.org/upload.jpg' }, 'eager');
  assert.equal(container.querySelector('img').getAttribute('src'), 'https://example.org/upload.jpg');
  assert.equal(container.querySelector('img').getAttribute('loading'), 'eager'); assert.ok(!container.textContent.includes(label));
  await failImage();
  assert.equal(container.querySelector('img').getAttribute('src'), fallback); assert.ok(container.textContent.includes(label));
});

test('failure of the fallback ends retries with an accessible neutral placeholder', async () => {
  await mount({ title: '活动', image: '/missing.jpg' });
  await failImage(); await failImage();
  assert.equal(container.querySelector('img'), null);
  const placeholder = container.querySelector('[role=img]'); assert.ok(placeholder);
  assert.ok(placeholder.getAttribute('aria-label') || placeholder.textContent.trim());
});

test('changing the cover after both failures restores the new uploaded image', async () => {
  await mount({ id: 'same-activity', title: '活动', image: '/missing.jpg' });
  await failImage(); await failImage();
  await render({ id: 'same-activity', title: '活动', image: '/replacement.jpg' });
  assert.equal(container.querySelector('img')?.getAttribute('src'), '/replacement.jpg');
  assert.ok(!container.textContent.includes(label));
});
