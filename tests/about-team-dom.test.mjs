import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { act, createElement } from 'react';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { mkdir, mkdtemp, realpath, rmdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dom = new JSDOM('<div id="app"></div>', { url: 'https://frontend.invalid/about' });
for (const key of ['window', 'document', 'navigator', 'HTMLElement']) {
  Object.defineProperty(globalThis, key, { value: key === 'window' ? dom.window : key === 'document' ? dom.window.document : dom.window[key], configurable: true });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import('react-dom/client');
const { MemoryRouter } = await import('react-router-dom');
const project = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const artifacts = path.join(project, 'artifacts');
await mkdir(artifacts, { recursive: true });
const scratch = await mkdtemp(path.join(artifacts, 'about-team-dom-'));
const bundle = path.join(scratch, 'component.mjs');
await build({
  stdin: { contents: "export { AboutPage } from './src/pages/Community.jsx'", resolveDir: project, loader: 'jsx' },
  bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic',
  loader: { '.css': 'empty' }, outfile: bundle,
  define: { 'import.meta.env': JSON.stringify({ VITE_CONTENT_MODE: 'live' }) },
  logLevel: 'silent',
});
const { AboutPage } = await import(pathToFileURL(bundle));
const container = document.getElementById('app');
const root = createRoot(container);

after(async () => {
  await act(async () => root.unmount());
  dom.window.close();
  assert.equal(path.dirname(scratch), artifacts);
  await unlink(bundle);
  await rmdir(scratch);
});

test('about team switches between management and leaders while keeping unpublished members explicit', async () => {
  await act(async () => root.render(createElement(MemoryRouter, { initialEntries: ['/about'] }, createElement(AboutPage))));
  const section = container.querySelector('.c-team-section');
  const buttons = [...section.querySelectorAll('.c-role-options button')];
  const panel = section.querySelector('.c-role-panel');
  assert.deepEqual(buttons.map(node => node.textContent), ['管理团队', '领队']);
  assert.equal(buttons[0].getAttribute('aria-pressed'), 'true');
  assert.equal(buttons[1].getAttribute('aria-pressed'), 'false');
  assert.equal(panel.querySelector('h3').textContent, '管理团队');
  assert.match(panel.textContent, /成员资料待发布/);

  await act(async () => buttons[1].click());
  assert.equal(buttons[0].getAttribute('aria-pressed'), 'false');
  assert.equal(buttons[1].getAttribute('aria-pressed'), 'true');
  assert.equal(panel.querySelector('h3').textContent, '领队');
  assert.match(panel.textContent, /成员资料待发布/);

  await act(async () => buttons[0].click());
  assert.equal(buttons[0].getAttribute('aria-pressed'), 'true');
  assert.equal(buttons[1].getAttribute('aria-pressed'), 'false');
  assert.equal(panel.querySelector('h3').textContent, '管理团队');
});
