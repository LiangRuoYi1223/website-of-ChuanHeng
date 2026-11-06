import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { act, createElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { mkdir, mkdtemp, realpath, rmdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dom = new JSDOM('<div id="app"></div>', { url: 'https://frontend.invalid/routes' });
const originals = new Map();
for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true })) {
  originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { createRoot } = await import('react-dom/client');
const project = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const artifacts = path.join(project, 'artifacts'); await mkdir(artifacts, { recursive: true });
const scratch = await mkdtemp(path.join(artifacts, 'route-library-map-dom-'));
const bundle = path.join(scratch, 'component.mjs');
let fixture;
globalThis.__ROUTE_LIBRARY_MAP_CATALOG = () => fixture;
await build({ stdin: { contents: "export {RoutesPage} from './src/pages/Explore.jsx';", resolveDir: project, loader: 'jsx' }, absWorkingDir: project, bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', loader: { '.css': 'empty' }, define: { 'import.meta.env': '{}' }, outfile: bundle, logLevel: 'silent', plugins: [{ name: 'route-catalog', setup(builder) {
  builder.onResolve({ filter: /(?:^|[\\/])catalog\.jsx$/ }, () => ({ path: 'catalog', namespace: 'route-map-test' }));
  builder.onLoad({ filter: /^catalog$/, namespace: 'route-map-test' }, () => ({ contents: 'export const isPreview=false;export function useCatalog(){return globalThis.__ROUTE_LIBRARY_MAP_CATALOG()}', loader: 'js' }));
} }] });
const { RoutesPage } = await import(pathToFileURL(bundle).href);
const image = color => `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="600" viewBox="0 0 1000 600"><rect width="1000" height="600" fill="${color}"/></svg>`).toString('base64')}`;
const route = (id, color, changes = {}) => ({ id, title: `合成路线${id}`, published: true, description: '仅用于测试', track: { basemap: { version: 1, format: 'svg', image: image(color), bounds: [104, 30, 105, 31], projection: 'EPSG:3857', width: 1000, height: 600, attribution: '© OpenStreetMap contributors', source: 'OpenStreetMap / Overpass API', generatedAt: '2026-11-06T00:00:00Z' }, geojson: { geometry: { type: 'LineString', coordinates: [[104.1, 30.1], [104.5, 30.5]] } } }, ...changes });
const first = route('第一条', '#111'); const second = route('第二条', '#222');
const legacy = route('旧路线', '#333'); delete legacy.track.basemap;
const container = document.getElementById('app'); let root;
const button = label => [...container.querySelectorAll('button')].find(node => node.textContent.trim() === label);
async function mount(routes = [first, second, legacy]) {
  if (root) await act(async () => root.unmount());
  fixture = { activities: [], routes, photos: [], articles: [], loading: false, error: '', refresh: async () => {} };
  root = createRoot(container); await act(async () => root.render(createElement(MemoryRouter, null, createElement(RoutesPage))));
  await act(async () => button('地图').click());
}
after(async () => {
  if (root) await act(async () => root.unmount()); dom.window.close(); delete globalThis.__ROUTE_LIBRARY_MAP_CATALOG;
  for (const [key, descriptor] of originals) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
  await unlink(bundle); await rmdir(scratch);
});

test('the library map shows the selected route saved image and real title buttons switch the whole route', async () => {
  await mount();
  const saved = () => container.querySelector('.route-library-map image');
  assert.equal(saved()?.getAttribute('href'), first.track.basemap.image);
  assert.equal(container.querySelectorAll('.route-library-map path[data-track-segment]').length, 1);
  const choose = button(second.title); assert.ok(choose);
  choose.focus(); assert.equal(document.activeElement, choose);
  await act(async () => choose.click());
  assert.equal(saved()?.getAttribute('href'), second.track.basemap.image);
  assert.equal(button(second.title).getAttribute('aria-pressed'), 'true');
  assert.equal(container.querySelector('.explore-map-pin'), null);
  assert.doesNotMatch(container.querySelector('.explore-map-layout').textContent, /示意点|随机|非真实地理位置/);
});

test('a selected legacy route uses its own coordinates and discloses that a saved map is missing', async () => {
  await mount(); await act(async () => button(legacy.title).click());
  const map = container.querySelector('.route-library-map'); assert.ok(map);
  assert.equal(map.querySelector('image'), null);
  assert.ok(map.querySelector('.tv-coordinate-map'));
  assert.match(map.textContent, /尚未保存地图底图/);
  assert.equal(map.querySelector('img[src^="http"]'), null);
});

test('example or draft records never acquire a fabricated map location', async () => {
  await mount([route('示例', '#444', { isDemo: true }), route('草稿', '#555', { localDraft: true })]);
  const map = container.querySelector('.route-library-map'); assert.ok(map);
  assert.equal(map.querySelector('image'), null);
  assert.equal(map.querySelector('[data-track-segment]'), null);
  assert.match(map.textContent, /暂无可展示的真实路线/);
});
