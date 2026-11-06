import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { act, createElement } from 'react';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { mkdir, mkdtemp, realpath, rmdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const dom = new JSDOM('<div id="app"></div>', { url: 'https://frontend.invalid/routes/test' });
const originals = new Map();
for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true })) {
  originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
const { createRoot } = await import('react-dom/client');
const project = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const artifacts = path.join(project, 'artifacts');
await mkdir(artifacts, { recursive: true });
const scratch = await mkdtemp(path.join(artifacts, 'track-basemap-dom-'));
const bundle = path.join(scratch, 'component.mjs');
await build({
  stdin: { contents: "export {default} from './src/tracks/TrackVisualization.jsx';", resolveDir: project, loader: 'jsx' },
  absWorkingDir: project, bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic',
  loader: { '.css': 'empty' }, define: { 'import.meta.env': '{}' }, outfile: bundle, logLevel: 'silent',
});
const Component = (await import(pathToFileURL(bundle).href)).default;
const container = document.getElementById('app');
const image = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="600" viewBox="0 0 1000 600"><rect width="1000" height="600" fill="#1b2423"/><path d="M0,600L1000,0" stroke="#fff"/></svg>').toString('base64')}`;
const basemap = { version: 1, format: 'svg', image, bounds: [0, 0, 10, 60], projection: 'EPSG:3857', width: 1000, height: 600, attribution: '© OpenStreetMap contributors', source: 'OpenStreetMap / Overpass API', generatedAt: '2026-11-06T00:00:00.000Z' };
const track = () => ({
  version: 1, name: '合成静态地图测试', format: 'gpx', sourceFile: 'synthetic-test.gpx', pointCount: 4, segmentCount: 2, basemap,
  geojson: { type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: [[[0, 0, 100], [5, 30, 120]], [[6, 40, 130], [10, 60, 150]]] } },
  segments: [{ index: 0, name: '合成第一段' }, { index: 1, name: '合成第二段' }],
  stats: { distanceM: 1500, ascentM: 50, descentM: 0 },
  profile: [{ segment: 0, lon: 0, lat: 0, distanceM: 0, elevationM: 100 }, { segment: 0, lon: 5, lat: 30, distanceM: 1000, elevationM: 120 }], warnings: [],
});
let root;
async function mount(value = track()) {
  if (root) await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () => { root.render(createElement(Component, { track: value })); await new Promise(resolve => setImmediate(resolve)); });
}
const button = label => [...container.querySelectorAll('button')].find(node => node.textContent.trim() === label);
const mapSvg = () => container.querySelector('svg[data-cached-track-map]');
after(async () => {
  if (root) await act(async () => root.unmount());
  dom.window.close();
  for (const [key, descriptor] of originals) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
  await unlink(bundle); await rmdir(scratch);
});

test('saved map and independent real track segments share the exact Mercator image frame', async () => {
  await mount();
  const svg = mapSvg(); assert.ok(svg, 'the saved map is immediately available');
  assert.equal(svg.getAttribute('viewBox'), '0 0 1000 600');
  assert.equal(svg.querySelector('image').getAttribute('href'), image);
  const paths = [...svg.querySelectorAll('path[data-track-segment]')];
  assert.equal(paths.length, 2);
  const mercator = latitude => Math.log(Math.tan(Math.PI / 4 + latitude * Math.PI / 360));
  const y30 = 600 * (mercator(60) - mercator(30)) / (mercator(60) - mercator(0));
  assert.match(paths[0].getAttribute('d'), new RegExp(`^M0(?:\\.00)?,600(?:\\.00)? L500(?:\\.00)?,${y30.toFixed(2)}$`));
  assert.match(paths[1].getAttribute('d'), / L1000(?:\.00)?,0(?:\.00)?$/);
  for (const path of paths) assert.equal((path.getAttribute('d').match(/M/g) || []).length, 1, 'a disconnected segment starts its own path');
  assert.match(container.textContent, /已保存.*底图/);
  assert.ok(container.querySelector('a[href="https://www.openstreetmap.org/copyright"]'));
  assert.equal(container.querySelector('.leaflet-container'), null);
  assert.equal(container.querySelector('[aria-label*="缩放"]'), null);
});

test('viewing either a saved map or a legacy track does not fetch online tiles or other external images', async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = async () => { requests += 1; throw new Error('Viewing a track must not request a basemap'); };
  try {
    for (const value of [track(), { ...track(), basemap: undefined }]) {
      await mount(value);
      for (const element of container.querySelectorAll('img[src], image[href]')) assert.match(element.getAttribute('src') || element.getAttribute('href'), /^data:image\/svg\+xml;base64,/);
    }
    assert.equal(requests, 0);
  } finally { globalThis.fetch = originalFetch; }
});

test('legacy tracks without a saved map retain local coordinates and clearly explain the missing map', async () => {
  await mount({ ...track(), basemap: undefined });
  assert.equal(mapSvg(), null);
  assert.ok(container.querySelector('.tv-coordinate-map'));
  assert.match(container.textContent, /尚未保存地图底图/);
  assert.equal(button('重试底图'), undefined);
  assert.equal(container.querySelector('[role="alert"]'), null);
  assert.ok(container.querySelector('svg[aria-label="合成第一段海拔剖面"]'));
});

test('saved map segment selection and profile point focus retain aligned highlights', async () => {
  await mount();
  await act(async () => button('合成第二段').click());
  const paths = [...mapSvg().querySelectorAll('path[data-track-segment]')];
  assert.equal(paths[0].getAttribute('opacity'), '0.25');
  assert.equal(paths[1].getAttribute('opacity'), '1');
  const slider = container.querySelector('input[aria-label="合成第一段轨迹采样点"]');
  await act(async () => slider.focus());
  const highlight = mapSvg().querySelector('[data-selected-track-point]'); assert.ok(highlight);
  assert.equal(Number(highlight.getAttribute('cx')), 0);
  assert.equal(Number(highlight.getAttribute('cy')), 600);
  await act(async () => button('坐标轨迹').click());
  assert.ok(container.querySelector('.tv-coordinate-map'));
  await act(async () => button('已保存底图').click());
  assert.ok(mapSvg());
});

test('invalid or failed saved images fall back to real coordinates without an online retry', async () => {
  await mount({ ...track(), basemap: { ...basemap, image: 'https://example.invalid/map.svg' } });
  assert.equal(mapSvg(), null);
  assert.ok(container.querySelector('.tv-coordinate-map'));
  await mount();
  await act(async () => mapSvg().querySelector('image').dispatchEvent(new dom.window.Event('error')));
  assert.equal(mapSvg(), null);
  assert.ok(container.querySelector('.tv-coordinate-map'));
  assert.match(container.textContent, /已保存底图.*无法显示/);
});
