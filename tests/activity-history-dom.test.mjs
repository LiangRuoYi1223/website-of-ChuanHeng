import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { act, createElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { mkdir, mkdtemp, realpath, rmdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dom = new JSDOM('<!doctype html><div id="app"></div>', { url: 'http://localhost/about' });
const originals = new Map();
for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true })) {
  originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { createRoot } = await import('react-dom/client');
const projectRoot = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const artifactsRoot = path.join(projectRoot, 'artifacts');
await mkdir(artifactsRoot, { recursive: true });
const scratch = await mkdtemp(path.join(artifactsRoot, 'activity-history-dom-'));
const bundlePath = path.join(scratch, 'history.mjs');
const fixtureKey = '__CHUANHENG_ACTIVITY_HISTORY_TEST_CATALOG';
let fixture;
globalThis[fixtureKey] = () => fixture;
const container = document.getElementById('app');
let root;

after(async () => {
  if (root) await act(async () => root.unmount());
  dom.window.close();
  delete globalThis[fixtureKey];
  for (const [key, descriptor] of originals) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
  await unlink(bundlePath).catch(error => { if (error.code !== 'ENOENT') throw error; });
  await rmdir(scratch);
});

const output = await build({
  stdin: { contents: "export { AboutPage } from './src/pages/Community.jsx';", resolveDir: projectRoot, loader: 'jsx' },
  absWorkingDir: projectRoot,
  bundle: true, write: false, platform: 'node', format: 'esm', jsx: 'automatic', packages: 'external',
  loader: { '.css': 'empty' }, define: { 'import.meta.env': '{}' }, logLevel: 'silent',
  plugins: [{ name: 'activity-history-catalog', setup(builder) {
    builder.onResolve({ filter: /(?:^|[\\/])catalog\.jsx$/ }, () => ({ path: 'catalog', namespace: 'history-fixture' }));
    builder.onLoad({ filter: /^catalog$/, namespace: 'history-fixture' }, () => ({ contents: `export function useCatalog() { return globalThis.${fixtureKey}(); }`, loader: 'js' }));
    builder.onResolve({ filter: /(?:^|[\\/])FootprintMap\.jsx$/ }, () => ({ path: 'footprints', namespace: 'history-fixture' }));
    builder.onLoad({ filter: /^footprints$/, namespace: 'history-fixture' }, () => ({ contents: 'export default function FootprintExplorer() { return null; }', loader: 'js' }));
  } }],
});
await writeFile(bundlePath, output.outputFiles[0].text, 'utf8');
const { AboutPage } = await import(pathToFileURL(bundlePath).href);

function activity(id, overrides = {}) {
  return { id, title: `合成活动${id}`, description: `合成活动${id}的测试简介`, type: '徒步', published: true, showInHistory: true, dateStart: '2001-03-10T01:00:00Z', dateEnd: '2001-03-10T09:00:00Z', ...overrides };
}
async function mount(catalog = {}) {
  if (root) await act(async () => root.unmount());
  fixture = { activities: [], loading: false, error: '', refresh: async () => {}, ...catalog };
  root = createRoot(container);
  await act(async () => root.render(createElement(MemoryRouter, null, createElement(AboutPage))));
}
function historySection() {
  const heading = [...container.querySelectorAll('h2')].find(node => node.textContent === '一路走来');
  assert.ok(heading, 'About retains its history section heading');
  return heading.closest('section');
}

test('About hero retains its title and official badge without the removed introductory button', async () => {
  await mount();
  const hero = container.querySelector('.page-hero');
  assert.equal(hero.querySelector('h1')?.textContent, '山野之间，彼此同行。');
  assert.equal([...hero.querySelectorAll('a, button')].some(node => node.textContent.includes('认识川衡')), false);
  assert.match(container.querySelector('.c-official-identity img')?.getAttribute('src') || '', /chuanheng-official-badge\.jpg$/);
});

test('About renders selected real completed activities in a dated timeline with working detail links', async () => {
  const older = activity('older');
  const latest = activity('latest', { title: '合成跨日活动', type: '露营', dateStart: '2002-06-10T15:00:00Z', dateEnd: '2002-06-11T02:00:00Z' });
  await mount({ activities: [older, latest, activity('not-selected', { showInHistory: false }), activity('unpublished', { published: false }), activity('demo', { isDemo: true }), activity('draft', { localDraft: true }), activity('archived', { archived: true }), activity('future', { status: '已结束', dateStart: '2099-06-01T00:00:00Z', dateEnd: '2099-06-02T00:00:00Z' }), activity('unknown-date', { dateStart: '', dateEnd: '', date: '往年' })] });
  const section = historySection();
  const links = [...section.querySelectorAll('h3 a')];
  assert.deepEqual(links.map(node => node.getAttribute('href')), ['/activities/latest', '/activities/older']);
  assert.match(section.textContent, /2002\/06\/10 — 2002\/06\/11/);
  assert.match(section.textContent, /2001\/03\/10/);
  assert.match(section.textContent, /合成跨日活动/);
  assert.match(section.textContent, /露营/);
  assert.match(section.textContent, /合成活动older的测试简介/);
  for (const excluded of ['not-selected', 'unpublished', 'demo', 'draft', 'archived', 'future', 'unknown-date']) assert.ok(!section.textContent.includes(`合成活动${excluded}`));
  assert.equal(section.querySelector('img'), null, 'history does not invent a photographic record');
});

test('an empty catalog awaits confirmed history without exposing editing instructions or fabricating records', async () => {
  await mount();
  const section = historySection();
  assert.match(section.textContent, /尚无大事记/);
  assert.match(section.textContent, /协会确认.*大事记发布后/);
  assert.doesNotMatch(section.textContent,/后台|勾选/);
  assert.equal(section.querySelector('ol'), null);
  assert.equal(section.querySelector('img'), null);
});

test('loading hides any previously loaded history until the catalog is ready', async () => {
  await mount({ activities: [activity('stale')], loading: true });
  const section = historySection();
  assert.match(section.querySelector('[role="status"]')?.textContent || '', /正在.*大事记/);
  assert.ok(!section.textContent.includes('合成活动stale'));
  assert.equal(section.querySelector('ol'), null);
});

test('a failed refresh hides stale history and lets keyboard users retry', async () => {
  let refreshes = 0;
  await mount({ activities: [activity('stale')], error: '暂时无法加载内容，请稍后重试。', refresh: async () => { refreshes += 1; } });
  const section = historySection();
  assert.match(section.querySelector('[role="alert"]')?.textContent || '', /暂时无法加载内容/);
  assert.ok(!section.textContent.includes('合成活动stale'));
  const retry = [...section.querySelectorAll('button')].find(node => /重试/.test(node.textContent));
  assert.ok(retry, 'catalog errors have a native retry button');
  retry.focus();
  assert.equal(document.activeElement, retry);
  await act(async () => retry.click());
  assert.equal(refreshes, 1);
});

test('optional metadata stays absent instead of inventing an activity type or description', async () => {
  await mount({ activities: [activity('minimal', { title: '合成最简记录', type: '', description: '' })] });
  const section = historySection();
  assert.equal(section.querySelector('h3 a')?.textContent, '合成最简记录');
  assert.equal(section.querySelectorAll('ol p').length, 0);
  assert.doesNotMatch(section.textContent, /山野同行|地点待确认|往年/);
});
