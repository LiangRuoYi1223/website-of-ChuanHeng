import assert from 'node:assert/strict';
import test from 'node:test';
import { act, createElement } from 'react';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { mkdir, mkdtemp, readFile, realpath, rmdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveTrackBasemap } from '../src/tracks/reference-basemaps.js';

// These deliberately small synthetic maps exist only in this regression file.
const image = color => `data:image/svg+xml;base64,${Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="600" viewBox="0 0 1000 600"><rect width="1000" height="600" fill="${color}"/></svg>`).toString('base64')}`;
const reference = (changes = {}) => ({ version: 1, format: 'svg', image: image('#123'), bounds: [114, 22, 115, 23], projection: 'EPSG:3857', width: 1000, height: 600, attribution: '© OpenStreetMap contributors', source: 'Protomaps / OpenStreetMap', generatedAt: '2026-11-06T00:00:00.000Z', ...changes });
const track = (segments = [[[114.1, 22.1], [114.2, 22.2]]], changes = {}) => ({ name: '仅供测试的旧轨迹', geojson: { geometry: { type: 'MultiLineString', coordinates: segments } }, ...changes });

test('a legacy track uses a reference only when every real point is covered', () => {
  const saved = reference();
  const model = resolveTrackBasemap(track(), [saved]); assert.ok(model);
  assert.equal(model.reference, true);
  assert.equal(model.basemap.image, saved.image);
  assert.equal(model.segments.length, 1);
  for (const point of model.segments[0].points) assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
  assert.equal(resolveTrackBasemap(track([[[114.1, 22.1], [116, 22.2], [114.2, 22.2]]]), [saved]), null, 'an outside middle point cannot be hidden by inside endpoints');
  assert.equal(resolveTrackBasemap(track([[[114.1, 22.1], [114.2, 22.2]], [[115.1, 22.1], [115.2, 22.2]]]), [saved]), null, 'all independent segments must be covered');
});

test('reference selection preserves the original track, snapshot and registry objects', () => {
  const source = track();
  const saved = reference();
  const before = structuredClone({ source, saved });
  Object.freeze(source); Object.freeze(saved); Object.freeze(saved.bounds);
  const registry = Object.freeze([saved]);
  const model = resolveTrackBasemap(source, registry); assert.ok(model);
  assert.equal(Object.hasOwn(source, 'basemap'), false);
  assert.deepEqual({ source, saved }, before);
  assert.notEqual(model.basemap, saved, 'the display model contains normalized metadata rather than modifying the public asset');
});

test('an existing saved map has priority and never becomes a reference map', () => {
  const ownMap = reference({ image: image('#456') });
  const source = track(undefined, { basemap: ownMap });
  const model = resolveTrackBasemap(source, [reference()]); assert.ok(model);
  assert.equal(model.basemap.image, ownMap.image);
  assert.equal(model.reference, undefined);
});

test('an explicitly provided invalid or mismatched cache is never silently replaced', () => {
  for (const basemap of [null, false, '', {}, { ...reference(), image: 'https://example.invalid/map.svg' }, reference({ bounds: [116, 22, 117, 23] })]) {
    assert.equal(resolveTrackBasemap(track(undefined, { basemap }), [reference()]), null);
  }
});

test('titles and ids never create a map without real covered coordinates', () => {
  const named = { id: 'dananshan', name: '大南山', title: '惠州大南山', location: '惠州' };
  assert.equal(resolveTrackBasemap(named, [reference()]), null);
  assert.equal(resolveTrackBasemap({ ...named, geojson: { geometry: { type: 'LineString', coordinates: [] } } }, [reference()]), null);
  assert.equal(resolveTrackBasemap(track([[[104, 30], [104.01, 30.01]]], named), [reference()]), null);
});

test('invalid references are skipped and the first complete geographic match is selected', () => {
  const saved = reference();
  const model = resolveTrackBasemap(track(), [null, {}, reference({ bounds: [116, 22, 117, 23] }), saved]); assert.ok(model);
  assert.equal(model.basemap.image, saved.image);
  assert.equal(model.reference, true);
  for (const references of [undefined, null, {}, 'not a registry']) assert.equal(resolveTrackBasemap(track([[[0, 0], [1, 1]]]), references), null);
});

test('the real bundled regional map is displayed only as a reference for covered legacy geometry', async t => {
  const project = await realpath(fileURLToPath(new URL('../', import.meta.url)));
  const actual = JSON.parse(await readFile(path.join(project, 'src/assets/maps/dananshan-20261106.json'), 'utf8'));
  const [west, south, east, north] = actual.bounds;
  const legacy = track([[[west + (east - west) * .25, south + (north - south) * .25], [west + (east - west) * .75, south + (north - south) * .75]]], { version: 1, format: 'gpx', sourceFile: 'synthetic-reference-test.gpx', pointCount: 2, segmentCount: 1, stats: { distanceM: 1500, ascentM: 20 }, profile: [], warnings: [] });
  const before = structuredClone(legacy);
  const artifacts = path.join(project, 'artifacts'); await mkdir(artifacts, { recursive: true });
  const scratch = await mkdtemp(path.join(artifacts, 'reference-basemap-dom-'));
  const bundle = path.join(scratch, 'components.mjs');
  const dom = new JSDOM('<!doctype html><div id="app"></div>', { url: 'https://frontend.invalid/routes/synthetic-reference-test' });
  const originals = new Map();
  let requests = 0, root;
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true, fetch: async () => { requests++; throw new Error('Displaying a bundled reference map must not access the network'); } })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key)); Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  try {
    await build({ stdin: { contents: "export {default as TrackVisualization} from './src/tracks/TrackVisualization.jsx';export {default as RouteLibraryMap} from './src/map/RouteLibraryMap.jsx';", resolveDir: project, loader: 'jsx' }, absWorkingDir: project, bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', loader: { '.css': 'empty' }, outfile: bundle, logLevel: 'silent' });
    const { TrackVisualization, RouteLibraryMap } = await import(pathToFileURL(bundle).href);
    const { createRoot } = await import('react-dom/client');
    const container = document.getElementById('app');
    async function mount(Component, props) {
      if (root) await act(async () => root.unmount());
      root = createRoot(container); await act(async () => root.render(createElement(Component, props)));
    }
    await t.test('track detail labels the actual regional image as a local reference without modifying its legacy snapshot', async () => {
      await mount(TrackVisualization, { track: legacy });
      assert.equal(container.querySelector('image')?.getAttribute('href') === actual.image, true);
      assert.match(container.textContent, /本地参考底图/);
      assert.equal(container.querySelectorAll('path[data-track-segment]').length, 1);
      assert.ok(container.querySelector('a[href="https://protomaps.com"]'));
      assert.deepEqual(legacy, before);
      assert.equal(Object.hasOwn(legacy, 'basemap'), false);
    });
    await t.test('a failed reference image retains the same coordinate fallback and does not fetch another map', async () => {
      await mount(TrackVisualization, { track: legacy });
      const image = container.querySelector('image'); assert.ok(image);
      await act(async () => image.dispatchEvent(new dom.window.Event('error')));
      assert.equal(container.querySelector('image'), null);
      assert.ok(container.querySelector('.tv-coordinate-map'));
      assert.match(container.textContent, /本地参考底图暂时无法显示/);
    });
    await t.test('the route library uses the same real reference and preserves Protomaps credit', async () => {
      const item = { id: 'synthetic-reference-test', title: '合成覆盖范围回归', track: legacy };
      await mount(RouteLibraryMap, { items: [item], selected: item, onSelect() {} });
      assert.equal(container.querySelector('image')?.getAttribute('href') === actual.image, true);
      assert.match(container.querySelector('.rlm-map-title').textContent, /本地参考底图/);
      assert.ok(container.querySelector('a[href="https://protomaps.com"]'));
    });
    await t.test('an invalid existing cache inside the reference region remains an explicit error', async () => {
      await mount(TrackVisualization, { track: { ...legacy, basemap: {} } });
      assert.equal(container.querySelector('image'), null);
      assert.match(container.textContent, /已保存底图与轨迹不匹配或数据无效/);
      assert.doesNotMatch(container.textContent, /本地参考底图/);
    });
    assert.equal(requests, 0);
  } finally {
    if (root) await act(async () => root.unmount());
    dom.window.close();
    for (const [key, descriptor] of originals) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
    await unlink(bundle).catch(error => { if (error.code !== 'ENOENT') throw error; }); await rmdir(scratch);
  }
});
