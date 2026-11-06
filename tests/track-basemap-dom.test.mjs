import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { act, createElement } from 'react';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// No jsdom resource loading is enabled. Tiles receive manual image load/error
// events, so these tests exercise real Leaflet without contacting a tile server.
const dom = new JSDOM('<div id="app"></div>', { url: 'https://frontend.invalid/routes/test', pretendToBeVisual: true });
for (const key of ['window', 'document', 'navigator', 'Element', 'HTMLElement', 'SVGElement']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? dom.window : key === 'document' ? dom.window.document : dom.window[key] });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
// jsdom does not implement layout or SVG feature detection. The real map gets
// one ordinary viewport and Leaflet's genuine SVG renderer remains enabled.
dom.window.SVGSVGElement.prototype.createSVGRect = () => ({});
for (const property of ['clientWidth', 'offsetWidth', 'clientHeight', 'offsetHeight']) {
  Object.defineProperty(dom.window.HTMLElement.prototype, property, {
    configurable: true,
    get() { return this.classList.contains('tv-leaflet-map') ? property.endsWith('Width') ? 900 : 420 : 0; },
  });
}

// Control only the product's connection deadline, leaving Leaflet timers real.
const originalSetTimeout = window.setTimeout.bind(window);
const originalClearTimeout = window.clearTimeout.bind(window);
const deadlines = new Map();
let clock = 0, nextDeadline = -1;
window.setTimeout = (callback, delay, ...args) => {
  if (Number(delay) !== 12000) return originalSetTimeout(callback, delay, ...args);
  const id = nextDeadline--;
  deadlines.set(id, { due: clock + Number(delay), callback: () => callback(...args) });
  return id;
};
window.clearTimeout = id => deadlines.delete(id) || originalClearTimeout(id);
async function advanceDeadline(milliseconds) {
  clock += milliseconds;
  await act(async () => {
    for (const [id, deadline] of [...deadlines]) if (deadline.due <= clock) {
      deadlines.delete(id);
      deadline.callback();
    }
  });
}

const { createRoot } = await import('react-dom/client');
const L = (await import('leaflet')).default;
const originalMap = L.map, originalTileLayer = L.tileLayer;
const maps = [], tileLayers = [];
L.map = (...args) => { const map = originalMap(...args); maps.push(map); return map; };
L.tileLayer = (...args) => { const layer = originalTileLayer(...args); tileLayers.push(layer); return layer; };
const project = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const artifacts = path.join(project, 'artifacts');
await mkdir(artifacts, { recursive: true });
const scratch = await mkdtemp(path.join(artifacts, 'track-basemap-dom-'));
const bundle = path.join(scratch, 'component.mjs');
await build({
  stdin: { contents: "export {default} from './src/tracks/TrackVisualization.jsx';", resolveDir: project, loader: 'jsx' },
  absWorkingDir: project, bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic',
  loader: { '.css': 'empty' }, define: { 'import.meta.env': '{}' }, outfile: bundle,
  plugins: [{ name: 'no-dom-stylesheets', setup(builder) {
    builder.onResolve({ filter: /\.css$/ }, args => ({ path: args.path, namespace: 'empty-style' }));
    builder.onLoad({ filter: /.*/, namespace: 'empty-style' }, () => ({ contents: '', loader: 'js' }));
  } }],
});
const Component = (await import(pathToFileURL(bundle).href)).default;
const container = document.getElementById('app');
// Synthetic fixture, never a real association route or a tile image.
const track = {
  version: 1, name: '底图加载测试', format: 'gpx', sourceFile: 'synthetic-test.gpx', pointCount: 2, segmentCount: 1,
  geojson: { type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: [[[114.88, 22.91, 100], [114.89, 22.92, 120]]] } },
  stats: { distanceM: 1500, ascentM: 20, descentM: 0 }, profile: [], warnings: [],
};
let root;
async function mount() {
  if (root) await act(async () => root.unmount());
  deadlines.clear(); clock = 0; maps.length = 0; tileLayers.length = 0;
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(Component, { track }));
  });
  // The production component imports Leaflet asynchronously in its effect.
  for (let attempt = 0; attempt < 20 && !tileLayers.length; attempt++) {
    await act(async () => { await new Promise(resolve => setImmediate(resolve)); });
  }
  assert.equal(tileLayers.length, 1, 'the genuine Leaflet tile layer must initialize');
  assert.ok(tileLayers[0] instanceof L.TileLayer);
  assert.ok(maps[0] instanceof L.Map);
  assert.ok(images().length > 0, 'Leaflet must create actual viewport tile images');
  return { map: maps[0], layer: tileLayers[0] };
}
const images = () => [...container.querySelectorAll('img.leaflet-tile')];
const button = label => [...container.querySelectorAll('button')].find(node => node.textContent.trim() === label);
const coordinateMap = () => container.querySelector('.tv-coordinate-map');
const liveRegion = () => container.querySelector('.tv-leaflet-map');
async function settleImages(event, tiles = images()) {
  assert.ok(tiles.length > 0);
  await act(async () => { for (const tile of tiles) tile.dispatchEvent(new dom.window.Event(event)); });
}
async function retry() {
  const previousLayers = tileLayers.length;
  assert.ok(button('重试底图'));
  await act(async () => button('重试底图').click());
  for (let attempt = 0; attempt < 20 && tileLayers.length === previousLayers; attempt++) {
    await act(async () => { await new Promise(resolve => setImmediate(resolve)); });
  }
  assert.equal(tileLayers.length, previousLayers + 1, 'retry must initialize a fresh genuine layer');
}
after(async () => {
  if (root) await act(async () => root.unmount());
  L.map = originalMap; L.tileLayer = originalTileLayer;
  window.setTimeout = originalSetTimeout; window.clearTimeout = originalClearTimeout;
  dom.window.close();
  assert.equal(path.dirname(scratch), artifacts);
  await rm(scratch, { recursive: true });
});

test('default OSM viewport tiles retain a valid referrer policy and reveal an interactive real map after loading', async () => {
  const { map, layer } = await mount();
  assert.ok(coordinateMap(), 'coordinates remain visible while the first tiles load');
  assert.equal(liveRegion().getAttribute('aria-hidden'), 'true');
  for (const image of images()) {
    assert.match(image.src, /^https:\/\/tile\.openstreetmap\.org\/\d+\/\d+\/\d+\.png$/);
    assert.equal(image.referrerPolicy, 'strict-origin-when-cross-origin');
  }
  assert.equal(layer.options.maxNativeZoom, 19);
  assert.ok(container.querySelector('.leaflet-control-attribution a[href="https://www.openstreetmap.org/copyright"]'));
  await settleImages('load');
  assert.equal(coordinateMap(), null);
  assert.equal(liveRegion().hasAttribute('aria-hidden'), false);
  assert.equal(liveRegion().tabIndex, 0);
  assert.equal(map.keyboard.enabled(), true);
  const previousZoom = map.getZoom();
  await act(async () => container.querySelector('.leaflet-control-zoom-in').click());
  assert.equal(map.getZoom(), previousZoom + 1, 'the real zoom control must remain interactive');
});

test('failed viewport tiles preserve coordinates and a retry can recover the real map', async () => {
  await mount();
  await settleImages('error');
  assert.ok(coordinateMap());
  assert.match(container.querySelector('.tv-map-notice').textContent, /底图.*(?:失败|无法|不可用)/);
  assert.ok(button('重试底图'));
  assert.equal(liveRegion().getAttribute('aria-hidden'), 'true');
  await retry();
  assert.ok(coordinateMap());
  await settleImages('load');
  assert.equal(coordinateMap(), null);
  assert.equal(container.querySelector('.tv-map-notice'), null);
  assert.equal(liveRegion().tabIndex, 0);
});

test('a new stalled viewport has its own 12 second fallback after a previous viewport loaded successfully', async () => {
  const { map, layer } = await mount();
  await settleImages('load');
  assert.equal(coordinateMap(), null);
  // Expire any first-viewport deadline before moving: its successful tiles must
  // neither disable nor substitute the next viewport's deadline.
  await advanceDeadline(12000);
  assert.equal(coordinateMap(), null);
  const previousImages = new Set(images());
  let loadingEvents = 0;
  layer.on('loading', () => { loadingEvents++; });
  await act(async () => map.panBy([1800, 0], { animate: false }));
  assert.equal(loadingEvents, 1, 'a real map movement must begin a new Leaflet tile batch');
  assert.ok(images().some(image => !previousImages.has(image)), 'the new viewport must contain unresolved real tile images');
  await advanceDeadline(11999);
  assert.equal(button('重试底图'), undefined, 'the new viewport must receive its whole connection deadline');
  await advanceDeadline(1);
  assert.ok(coordinateMap(), 'stalled new tiles must restore the complete coordinate track');
  assert.ok(button('重试底图'), 'timeout must offer a visible way to recover the basemap');
  assert.match(container.querySelector('.tv-map-notice').textContent, /底图.*(?:失败|无法|不可用|超时)/);
});

test('an unfinished old batch cannot keep a wholly new stalled viewport blank after one old tile succeeded', async () => {
  const { map, layer } = await mount();
  const successfulTile = images()[0];
  const tileSize = layer.getTileSize();
  const [, , x, y] = new URL(successfulTile.src).pathname.match(/^\/(\d+)\/(\d+)\/(\d+)\.png$/).map(Number);
  await settleImages('load', [successfulTile]);
  assert.equal(coordinateMap(), null, 'one successful tile may reveal the initial viewport');
  const oldImages = new Set(images());
  assert.ok(oldImages.size > 1, 'other first-viewport tiles must remain unresolved');
  let loadingEvents = 0;
  layer.on('loading', () => { loadingEvents++; });
  await advanceDeadline(6000);
  await act(async () => map.panBy([1800, 0], { animate: false }));
  assert.equal(loadingEvents, 0, 'real Leaflet keeps an unfinished batch loading across the movement');
  assert.ok(images().some(image => !oldImages.has(image)), 'the moved viewport must request new unresolved images');
  const bounds = map.getPixelBounds();
  const oldTileInViewport = x * tileSize.x < bounds.max.x && (x + 1) * tileSize.x > bounds.min.x
    && y * tileSize.y < bounds.max.y && (y + 1) * tileSize.y > bounds.min.y;
  assert.equal(oldTileInViewport, false, 'the only successful tile must be outside the current viewport');
  await advanceDeadline(11999);
  assert.equal(button('重试底图'), undefined, 'movement must reset the deadline instead of using the old viewport timeout');
  await advanceDeadline(1);
  assert.ok(coordinateMap(), 'an offscreen successful tile must not leave the new viewport blank');
  assert.ok(button('重试底图'));
  assert.equal(liveRegion().getAttribute('aria-hidden'), 'true');
  assert.match(container.querySelector('.tv-map-notice').textContent, /底图.*(?:失败|无法|不可用|超时)/);
});
