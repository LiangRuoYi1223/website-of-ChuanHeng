import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { build } from 'esbuild';
import { mkdir, mkdtemp, realpath, rmdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  unwrapTrackSegments,
  buildTrackMapModel,
  buildElevationModel,
  terrainTileConfiguration,
} from '../src/tracks/visualization-helpers.js';

// Synthetic coordinates are test fixtures, never association routes or map tiles.
const geometryTrack = segments => ({
  version: 1,
  name: '轨迹可视化测试',
  geojson: { type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: segments } },
});
const point = (distanceM, elevationM, segment = 0, overrides = {}) => ({
  segment, distanceM, elevationM, lon: 104 + distanceM / 100000, lat: 30, ...overrides,
});
const approximately = (actual, expected, tolerance = 1e-6) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `expected ${actual} to be within ${tolerance} of ${expected}`);
};

test('longitude unwrapping follows the short dateline crossing and preserves segment boundaries', () => {
  const input = [
    [[179, 20, 100], [-179, 20.1, null], [-178.5, 20.2, 120]],
    [[104, 30, null], [104.1, 30.1, 300]],
  ];
  const original = structuredClone(input);
  const actual = unwrapTrackSegments(input);
  assert.equal(actual.length, 2);
  assert.deepEqual(actual.map(segment => segment.length), [3, 2]);
  approximately(actual[0][0][0], 179);
  approximately(actual[0][1][0], 181);
  approximately(actual[0][2][0], 181.5);
  assert.deepEqual(actual[0].map(coordinate => coordinate.slice(1)), input[0].map(coordinate => coordinate.slice(1)));
  assert.deepEqual(input, original, 'display preparation must not change original GPS coordinates');
});

test('westbound dateline crossing is unwrapped without a 358-degree line', () => {
  const actual = unwrapTrackSegments([[[-179, 40, 0], [179, 40, 10]]]);
  approximately(actual[0][1][0] - actual[0][0][0], -2);
});

test('offline map produces one independent SVG path per real track segment', () => {
  const input = geometryTrack([
    [[104, 30, 100], [104.01, 30.01, 120], [104.02, 30.015, 110]],
    [[104.2, 30.2, null], [104.21, 30.21, 160]],
  ]);
  const original = structuredClone(input);
  const model = buildTrackMapModel(input, { width: 900, height: 420, padding: 35 });
  assert.equal(model.segments.length, 2);
  assert.deepEqual(model.segments.map(segment => segment.points.length), [3, 2]);
  for (const segment of model.segments) {
    assert.match(segment.path, /^M/);
    assert.equal((segment.path.match(/M/g) || []).length, 1, 'each segment must start its own path');
    assert.doesNotMatch(segment.path, /NaN|Infinity|undefined/);
    for (const mapped of segment.points) {
      assert.ok(Number.isFinite(mapped.x) && Number.isFinite(mapped.y));
      assert.ok(mapped.x >= 35 - 1e-6 && mapped.x <= 865 + 1e-6);
      assert.ok(mapped.y >= 35 - 1e-6 && mapped.y <= 385 + 1e-6);
    }
  }
  const first = model.segments[0].points[0];
  const last = model.segments[1].points.at(-1);
  approximately(model.start.x, first.x);
  approximately(model.start.y, first.y);
  approximately(model.end.x, last.x);
  approximately(model.end.y, last.y);
  assert.deepEqual(input, original);
});

test('dateline-crossing map bounds stay local instead of fitting almost the whole world', () => {
  const model = buildTrackMapModel(geometryTrack([[[179, 20, 0], [-179, 20.1, 10]]]));
  approximately(model.bounds[2] - model.bounds[0], 2);
  assert.ok(model.segments[0].points.every(mapped => Number.isFinite(mapped.x) && Number.isFinite(mapped.y)));
});

test('flat, vertical and repeated coordinates retain finite map geometry', async t => {
  for (const [name, coordinates] of [
    ['horizontal', [[104, 30, null], [104.1, 30, null]]],
    ['vertical', [[104, 30, null], [104, 30.1, null]]],
    ['repeated', [[104, 30, null], [104, 30, null]]],
    ['one point', [[104, 30, null]]],
  ]) await t.test(name, () => {
    const model = buildTrackMapModel(geometryTrack([coordinates]));
    assert.equal(model.segments[0].points.length, coordinates.length);
    assert.doesNotMatch(model.segments[0].path, /NaN|Infinity|undefined/);
    for (const mapped of model.segments[0].points) {
      assert.ok(Number.isFinite(mapped.x) && Number.isFinite(mapped.y));
      assert.ok(mapped.x >= 0 && mapped.x <= 900 && mapped.y >= 0 && mapped.y <= 420);
    }
  });
});

test('an empty track creates no invented coordinate paths', () => {
  const model = buildTrackMapModel(geometryTrack([]));
  assert.deepEqual(model.segments, []);
});

test('elevation paths break at missing elevations and at every new segment', () => {
  const profile = [
    point(0, 100), point(500, 110), point(1000, null),
    point(1500, 125), point(2000, 130),
    point(2000, 200, 1), point(2300, 205, 1),
  ];
  const original = structuredClone(profile);
  const model = buildElevationModel(profile);
  assert.equal(model.hasElevation, true);
  assert.equal(model.points.length, profile.length);
  assert.equal(model.points[2], null, 'missing altitude must remain a visible graph gap');
  assert.deepEqual(model.lines.map(line => line.points.map(mapped => mapped.index)), [[0, 1], [3, 4], [5, 6]]);
  assert.deepEqual(model.lines.map(line => line.segment), [0, 0, 1]);
  assert.deepEqual(model.distanceDomain, [0, 2300]);
  for (const line of model.lines) assert.doesNotMatch(line.path, /NaN|Infinity|undefined/);
  assert.deepEqual(profile, original);
});

test('zero and negative real elevations are valid, not missing values', () => {
  const model = buildElevationModel([point(0, 0), point(100, -5), point(200, 10)]);
  assert.equal(model.hasElevation, true);
  assert.equal(model.points.filter(Boolean).length, 3);
  assert.ok(model.elevationDomain[0] <= -5 && model.elevationDomain[1] >= 10);
  assert.ok(model.points.every(mapped => Number.isFinite(mapped.x) && Number.isFinite(mapped.y)));
});

test('a flat elevation record receives a finite padded scale without inventing variation', () => {
  const model = buildElevationModel([point(0, 500), point(1000, 500), point(2400, 500)]);
  assert.ok(model.elevationDomain[0] < 500 && model.elevationDomain[1] > 500);
  assert.ok(model.points.every(mapped => Number.isFinite(mapped.x) && Number.isFinite(mapped.y)));
  assert.ok(model.points.every(mapped => mapped.y === model.points[0].y));
  assert.equal(model.lines.length, 1);
});

test('a record without elevations stays empty instead of drawing a synthetic profile', () => {
  const model = buildElevationModel([point(0, null), point(1000, null)]);
  assert.equal(model.hasElevation, false);
  assert.deepEqual(model.lines, []);
  assert.deepEqual(model.points, [null, null]);
});

test('profile positions use actual cumulative distances and altitude, not point indices', () => {
  const model = buildElevationModel([point(0, 100), point(1000, 200), point(3000, 300)]);
  const [start, middle, end] = model.points;
  approximately((middle.x - start.x) / (end.x - start.x), 1 / 3);
  approximately((start.y - middle.y) / (start.y - end.y), 1 / 2);
  assert.deepEqual(model.distanceDomain, [0, 3000]);
  assert.ok(model.xTicks.length >= 2 && model.yTicks.length >= 2);
  for (const tick of model.xTicks) {
    assert.ok(Number.isFinite(tick.value) && Number.isFinite(tick.x));
    assert.ok(tick.value >= 0 && tick.value <= 3000);
    assert.match(tick.label, /km|公里/);
  }
  for (const tick of model.yTicks) {
    assert.ok(Number.isFinite(tick.value) && Number.isFinite(tick.y));
    assert.match(tick.label, /m|米/);
  }
});

test('zero-distance and one-point elevation records never produce invalid scales', () => {
  for (const profile of [[point(0, 500)], [point(0, 500), point(0, 505)]]) {
    const model = buildElevationModel(profile);
    assert.deepEqual(model.distanceDomain, [0, 0]);
    assert.ok(model.points.every(mapped => Number.isFinite(mapped.x) && Number.isFinite(mapped.y)));
  }
});

test('a segment chart can use its own distance starting at zero while retaining global profile distances', () => {
  const profile = [
    point(5000, 100, 1, { segmentDistanceM: 0 }),
    point(5500, 150, 1, { segmentDistanceM: 500 }),
    point(6500, 200, 1, { segmentDistanceM: 1500 }),
  ];
  const original = structuredClone(profile);
  const model = buildElevationModel(profile, { distanceKey: 'segmentDistanceM' });
  assert.deepEqual(model.distanceDomain, [0, 1500]);
  const [start, middle, end] = model.points;
  approximately((middle.x - start.x) / (end.x - start.x), 1 / 3);
  const zeroTick = model.xTicks.find(tick => tick.value === 0);
  assert.ok(zeroTick, 'each segment distance axis should show its own zero');
  approximately(zeroTick.x, start.x);
  assert.deepEqual(profile, original, 'using segment distances must preserve authoritative global distances');
});

test('terrain configuration keeps default attribution and validates custom tile source credits', () => {
  const defaults = terrainTileConfiguration({});
  assert.equal(defaults.offline, false);
  assert.match(defaults.url, /^https:\/\/.*opentopomap\.org\/\{z\}\/\{x\}\/\{y\}\.png$/);
  assert.match(defaults.attribution, /OpenStreetMap/);
  assert.match(defaults.attribution, /SRTM/);
  assert.match(defaults.attribution, /OpenTopoMap/);
  assert.match(defaults.attribution, /CC-BY-SA/);
  assert.equal(terrainTileConfiguration({ VITE_TERRAIN_TILE_URL: 'offline' }).offline, true);
  assert.equal(terrainTileConfiguration({ VITE_TERRAIN_TILE_URL: 'http://example.test/{z}/{x}/{y}.png', VITE_TERRAIN_TILE_ATTRIBUTION: 'test' }).offline, true);
  assert.equal(terrainTileConfiguration({ VITE_TERRAIN_TILE_URL: 'https://example.test/{z}/{x}.png', VITE_TERRAIN_TILE_ATTRIBUTION: 'test' }).offline, true);
  assert.equal(terrainTileConfiguration({ VITE_TERRAIN_TILE_URL: 'https://example.test/{z}/{x}/{y}.png' }).offline, true);
  const custom = terrainTileConfiguration({ VITE_TERRAIN_TILE_URL: 'https://example.test/{z}/{x}/{y}.png', VITE_TERRAIN_TILE_ATTRIBUTION: '© Test <img src=x>', VITE_TERRAIN_TILE_MAX_ZOOM: '18' });
  assert.equal(custom.offline, false);
  assert.equal(custom.maxZoom, 18);
  assert.doesNotMatch(custom.attribution, /<img/);
  assert.match(custom.attribution, /&lt;img/);
});

const projectRoot = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const artifactsRoot = path.join(projectRoot, 'artifacts');
let scratch;
let bundlePath;
let renderer;
after(async () => {
  if (!scratch) return;
  assert.equal(path.dirname(scratch), artifactsRoot);
  if (bundlePath) await unlink(bundlePath).catch(error => { if (error.code !== 'ENOENT') throw error; });
  await rmdir(scratch);
});

async function renderTrack(track) {
  if (!renderer) {
    await mkdir(artifactsRoot, { recursive: true });
    scratch = await mkdtemp(path.join(artifactsRoot, 'track-visualization-'));
    bundlePath = path.join(scratch, 'component.mjs');
    const bundle = await build({
      stdin: { contents: "export { default } from './src/tracks/TrackVisualization.jsx';", resolveDir: projectRoot, sourcefile: 'track-visualization-ssr.jsx', loader: 'jsx' },
      absWorkingDir: projectRoot,
      bundle: true, write: false, platform: 'node', format: 'esm', target: 'node22', jsx: 'automatic', packages: 'external',
      loader: { '.css': 'empty' }, define: { 'import.meta.env': '{}' }, logLevel: 'silent',
    });
    await writeFile(bundlePath, bundle.outputFiles[0].text, 'utf8');
    const { default: Component } = await import(pathToFileURL(bundlePath).href);
    renderer = value => renderToStaticMarkup(createElement(Component, { track: value }));
  }
  return renderer(track);
}

const completeTrack = () => ({
  ...geometryTrack([[[104, 30, 100], [104.01, 30.01, 120]], [[104.2, 30.2, 200], [104.21, 30.21, 220]]]),
  format: 'gpx', sourceFile: 'synthetic-test.gpx', pointCount: 4, segmentCount: 2,
  stats: { distanceM: 12345, ascentM: 432, descentM: 321, minElevationM: 100, maxElevationM: 220, elevationCoverage: 1 },
  segments: [
    { index: 0, name: '第一分段', pointCount: 2, stats: { distanceM: 1000, ascentM: 20, descentM: 0, minElevationM: 100, maxElevationM: 120, elevationCoverage: 1 } },
    { index: 1, name: '第二分段', pointCount: 2, stats: { distanceM: 500, ascentM: 20, descentM: 0, minElevationM: 200, maxElevationM: 220, elevationCoverage: 1 } },
  ],
  profile: [point(0, 100, 0, { segmentDistanceM: 0 }), point(1000, 120, 0, { segmentDistanceM: 1000 }), point(1000, 200, 1, { segmentDistanceM: 0 }), point(1500, 220, 1, { segmentDistanceM: 500 })],
  warnings: [],
});

test('empty visualization renders a useful recovery state without browser globals', async () => {
  const html = await renderTrack(null);
  assert.match(html, /尚未载入可显示的轨迹/);
  assert.match(html, /GPX.*KML/);
  assert.doesNotMatch(html, /undefined|NaN/);
});

test('SSR renders authoritative statistics and a separate elevation chart for every real segment', async () => {
  const html = await renderTrack(completeTrack());
  assert.match(html, /12\.3 km/, 'the summary uses importer-provided distance, not the map coordinates');
  assert.match(html, /432 m/, 'the summary must keep importer-provided ascent');
  assert.match(html, /321 m/, 'the summary must keep importer-provided descent');
  const charts = [...html.matchAll(/<svg\b[^>]*aria-label="([^"]*海拔剖面)"/g)];
  assert.deepEqual(charts.map(match => match[1]), ['第一分段海拔剖面', '第二分段海拔剖面']);
  assert.match(html, /无地形背景/);
  assert.match(html, /OpenTopoMap/);
  assert.match(html, /OpenStreetMap/);
  assert.doesNotMatch(html, /undefined|NaN/);
});

test('a segment without elevation receives its own missing-data state and no invented curve', async () => {
  const track = completeTrack();
  track.profile = track.profile.map(item => item.segment === 1 ? { ...item, elevationM: null } : item);
  track.segments[1].stats = { distanceM: 500, ascentM: null, descentM: null, minElevationM: null, maxElevationM: null, elevationCoverage: 0 };
  const html = await renderTrack(track);
  assert.match(html, /第一分段海拔剖面/);
  assert.doesNotMatch(html, /aria-label="第二分段海拔剖面"/);
  assert.match(html, /第二分段/);
  assert.match(html, /本段未提供海拔数据/);
  assert.equal([...html.matchAll(/<svg\b[^>]*aria-label="[^"]*海拔剖面"/g)].length, 1);
});

test('track summary and segment distance/ascent use unavailable text while real zero stays visible',async()=>{
 const track=completeTrack();track.stats.distanceM=null;track.stats.ascentM=null;
 track.segments[0].stats.distanceM=null;track.segments[0].stats.ascentM=null;
 track.segments[1].stats.distanceM=0;track.segments[1].stats.ascentM=0;
 const html=await renderTrack(track);
 const stats=[...html.matchAll(/<dl class="tv-statistics[^\"]*">([\s\S]*?)<\/dl>/g)].map(match=>match[1]);
 assert.equal(stats.length,3);
 for(const block of stats.slice(0,2))assert.equal((block.match(/暂不提供数据/g)||[]).length,2);
 assert.match(stats[2],/0 km/);assert.match(stats[2],/0 m/);assert.doesNotMatch(stats[2],/暂不提供数据/);
});
