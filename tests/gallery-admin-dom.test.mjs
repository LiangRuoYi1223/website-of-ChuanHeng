import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { act, createElement } from 'react';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { mkdir, mkdtemp, realpath, rmdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dom = new JSDOM('<!doctype html><div id="app"></div>', { url: 'http://localhost/admin/gallery?preview=1', pretendToBeVisual: true });
const originals = new Map();
for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, localStorage: dom.window.localStorage, FormData: dom.window.FormData, Event: dom.window.Event, IS_REACT_ACT_ENVIRONMENT: true })) {
  originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { createRoot } = await import('react-dom/client');
const { MemoryRouter } = await import('react-router-dom');
const projectRoot = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const artifactsRoot = path.join(projectRoot, 'artifacts');
await mkdir(artifactsRoot, { recursive: true });
const scratch = await mkdtemp(path.join(artifactsRoot, 'gallery-admin-test-'));
const bundlePath = path.join(scratch, 'gallery-admin.mjs');
const bundle = await build({
  stdin: { contents: "export { AdminPage, ContentEditor } from './src/pages/Admin.jsx';", resolveDir: projectRoot, loader: 'jsx' },
  absWorkingDir: projectRoot, bundle: true, write: false, platform: 'node', format: 'esm', jsx: 'automatic', packages: 'external', loader: { '.css': 'empty' },
  define: { 'import.meta.env': JSON.stringify({ VITE_CONTENT_MODE: 'preview' }) }, logLevel: 'silent',
  plugins: [{ name: 'photo-service-boundary', setup(builder) {
    builder.onResolve({ filter: /\/gallery-photo\.js$/ }, () => ({ path: 'gallery-service', namespace: 'test' }));
    builder.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: 'export const uploadGalleryPhoto = (...args) => globalThis.__galleryAdminUpload(...args);' }));
  } }],
});
await writeFile(bundlePath, bundle.outputFiles[0].text, 'utf8');
const { AdminPage, ContentEditor } = await import(pathToFileURL(bundlePath).href);
const container = document.getElementById('app');
let root;
after(async () => {
  if (root) await act(async () => root.unmount());
  delete globalThis.__galleryAdminUpload;
  dom.window.close();
  for (const [key, value] of originals) if (value) Object.defineProperty(globalThis, key, value); else delete globalThis[key];
  await unlink(bundlePath); await rmdir(scratch);
});
async function mount(element) {
  if (root) await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () => root.render(createElement(MemoryRouter, { initialEntries: ['/admin/gallery?preview=1'] }, element)));
}
const button = label => [...container.querySelectorAll('button')].find(node => node.textContent.trim() === label);
const submit = async () => act(async () => container.querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })));

test('gallery editor saves a processed local photo and blocks missing photos and saving while upload is pending', async () => {
  localStorage.clear();
  await mount(createElement(AdminPage));
  assert.ok(!container.querySelector('a[href*="/admin/projects"]'));
  await act(async () => button('新建影像').click());
  const picker = container.querySelector('input[type=file][aria-label="影像照片文件"]');
  assert.ok(picker, 'gallery must offer a photo picker');
  assert.equal(container.querySelector('input[name=image]').type, 'hidden', 'gallery has no URL entry field');
  container.querySelector('input[name=title]').value = '本地合成照片测试';
  await submit();
  assert.match(container.querySelector('[role=alert]').textContent, /请先上传照片/);
  assert.equal(localStorage.getItem('chuanheng-drafts'), null);
  let release;
  globalThis.__galleryAdminUpload = () => new Promise(resolve => { release = resolve; });
  Object.defineProperty(picker, 'files', { configurable: true, value: [new dom.window.File(['synthetic'], 'test.jpg', { type: 'image/jpeg' })] });
  await act(async () => picker.dispatchEvent(new dom.window.Event('change', { bubbles: true })));
  assert.equal(container.querySelector('.admin-form-actions button:last-child').disabled, true);
  assert.match(container.querySelector('.admin-form-actions button:last-child').textContent, /正在处理照片/);
  await submit();
  assert.equal(localStorage.getItem('chuanheng-drafts'), null, 'pending processing must never save an incomplete record');
  const url = 'data:image/webp;base64,UklGRgQAAABXRUJQ';
  await act(async () => release({ url, originalBytes: 5 * 1024 * 1024, outputBytes: 12 }));
  assert.equal(container.querySelector('input[name=image]').value, url);
  await submit();
  assert.equal(container.querySelector('[role=dialog]'), null, 'successful local save must close the editor');
  const rows = JSON.parse(localStorage.getItem('chuanheng-drafts'));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'photo');
  assert.equal(rows[0].payload.image, url);
  assert.equal(rows[0].published, false);
});

test('editor preserves the existing activity uploader and article/route URL fields', async () => {
  for (const kind of ['activity', 'article', 'route']) {
    await mount(createElement(ContentEditor, { editor: { kind, payload: { image: '/existing.webp' } }, local: true, onClose() {}, onSave() {} }));
    assert.equal(container.querySelector('input[name=image]').type, kind === 'activity' ? 'hidden' : 'text');
    assert.equal(container.querySelector('input[name=image]').value, '/existing.webp');
    assert.equal(Boolean(container.querySelector('input[aria-label="活动封面文件"]')), kind === 'activity');
  }
});
