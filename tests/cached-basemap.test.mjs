import assert from 'node:assert/strict';
import test from 'node:test';
import { readCachedBasemap, buildCachedTrackMapModel } from '../src/tracks/cached-basemap.js';
import { createRouteBasemap } from '../server/basemaps/create-route-basemap.mjs';

const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="600" viewBox="0 0 1000 600"><rect width="1000" height="600" fill="#151515"/><text x="20" y="20">合成地图测试</text></svg>';
const imageFor = value => `data:image/svg+xml;base64,${Buffer.from(value).toString('base64')}`;
const basemap = (changes = {}) => ({ version: 1, format: 'svg', image: imageFor(svg), bounds: [0, 0, 10, 60], projection: 'EPSG:3857', width: 1000, height: 600, attribution: '© OpenStreetMap contributors', source: 'OpenStreetMap / Overpass API', generatedAt: '2026-11-06T00:00:00.000Z', ...changes });
const track = (changes = {}) => ({ basemap: basemap(), geojson: { type: 'Feature', geometry: { type: 'MultiLineString', coordinates: [[[0, 0, 100], [5, 30, 120]], [[6, 40, null], [10, 60, null]]] } }, ...changes });

test('saved basemaps retain valid georeferencing and fixed attribution without trusting added markup', () => {
  const input = Object.freeze(basemap({ license: 'ODbL-1.0', licenseUrl: 'https://www.openstreetmap.org/copyright', extraMarkup: '<script>bad</script>' }));
  const result = readCachedBasemap(input); assert.ok(result);
  assert.equal(result.image, input.image);
  assert.deepEqual(result.bounds, [0, 0, 10, 60]);
  assert.equal(result.attribution, '© OpenStreetMap contributors');
  assert.equal(result.source, 'OpenStreetMap / Overpass API');
  assert.equal(result.licenseUrl, 'https://www.openstreetmap.org/copyright');
  assert.equal(Object.hasOwn(result, 'extraMarkup'), false);
});

test('invalid versions, dimensions, geographic bounds, generation dates or sources are refused', () => {
  for (const changes of [{ version: 2 }, { format: 'png' }, { projection: 'EPSG:4326' }, { width: 999 }, { height: 601 }, { bounds: [10, 0, 0, 60] }, { bounds: [0, 60, 10, 0] }, { bounds: [0, 0, 181, 60] }, { bounds: [0, 0, 10, 90] }, { bounds: [0, NaN, 10, 60] }, { generatedAt: '2026-02-30T00:00:00Z' }, { source: 'unverified' }, { attribution: '<img src=x>' }, { licenseUrl: 'javascript:alert(1)' }]) assert.equal(readCachedBasemap(basemap(changes)), null, JSON.stringify(changes));
  for (const input of [undefined, null, [], false, 'image']) assert.equal(readCachedBasemap(input), null);
});

test('only bounded base64 SVG images with passive generated shapes can be shown', () => {
  const invalidImages = ['https://example.invalid/map.svg', 'data:image/png;base64,AAAA', 'data:image/svg+xml;base64,!!!!', imageFor('<svg><script>alert(1)</script></svg>'), imageFor('<svg xmlns="http://www.w3.org/2000/svg"><image href="https://example.invalid/image.png"/></svg>'), imageFor(svg.replace('<rect ', '<rect onclick="alert(1)" ')), imageFor(svg.replace('fill="#151515"', 'fill="url(https://example.invalid/pattern)"')), imageFor(svg.replace('<rect ', '<foreignObject><rect ')), imageFor(svg.replace('width="1000"', 'width="900"')), imageFor(svg.replace('</svg>', '')), imageFor(svg.replace('<rect ', '<style>*{background:url(https://example.invalid/a)}</style><rect ')), imageFor(svg.replace('<text ', '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///test">]><text ')), imageFor(svg.replace('</svg>', `<text>${'a'.repeat(270000)}</text></svg>`))];
  for (const image of invalidImages) assert.equal(readCachedBasemap(basemap({ image })), null);
});

test('the saved map model uses nonlinear Mercator latitude and separate paths for real segments', () => {
  const input = track(); const copy = structuredClone(input);
  const model = buildCachedTrackMapModel(input); assert.ok(model);
  assert.equal(model.width, 1000); assert.equal(model.height, 600);
  assert.equal(model.segments.length, 2);
  const middle = model.project(5, 30);
  assert.equal(middle.x, 500);
  assert.ok(Math.abs(middle.y - 349.742) < .01, `Mercator y was ${middle.y}`);
  assert.equal(model.project(0, 0).y, 600);
  assert.ok(Math.abs(model.project(10, 60).y) < 1e-8);
  assert.deepEqual(model.segments.map(segment => segment.points.length), [2, 2]);
  assert.deepEqual(input, copy);
});

test('mismatched bounds or unsupported geometry never create a falsely aligned map', () => {
  assert.equal(buildCachedTrackMapModel(track({ basemap: undefined })), null);
  assert.equal(buildCachedTrackMapModel(track({ basemap: basemap({ bounds: [0, 0, 4, 60] }) })), null);
  for (const geometry of [{ type: 'Point', coordinates: [5, 30] }, { type: 'MultiLineString', coordinates: [[[0, 0], [NaN, 30]]] }, { type: 'LineString', coordinates: [[0, 0], [181, 30]] }]) assert.equal(buildCachedTrackMapModel(track({ geojson: { geometry } })), null);
});

test('numerically collapsed Mercator bounds are rejected instead of drawing NaN pixels', () => {
  const collapsed = basemap({ bounds: [0, 0, 1, Number.MIN_VALUE] });
  assert.equal(readCachedBasemap(collapsed), null);
  assert.equal(buildCachedTrackMapModel({ basemap: collapsed, geojson: { geometry: { type: 'LineString', coordinates: [[0, 0], [1, 0]] } } }), null);
});

test('the static display refuses more than the server limit of 30000 real points or 100 segments', () => {
  const first = [1, 1], last = [2, 2];
  const geometry = coordinates => ({ geojson: { geometry: { type: 'MultiLineString', coordinates } } });
  const atPointLimit = track(geometry([Array.from({ length: 30000 }, (_, index) => index % 2 ? last : first)]));
  assert.ok(buildCachedTrackMapModel(atPointLimit));
  const overPointLimit = track(geometry([Array.from({ length: 30001 }, () => first)]));
  assert.equal(buildCachedTrackMapModel(overPointLimit) === null, true);
  assert.ok(buildCachedTrackMapModel(track(geometry(Array.from({ length: 100 }, () => [first, last])))));
  assert.equal(buildCachedTrackMapModel(track(geometry(Array.from({ length: 101 }, () => [first, last])))) === null, true);
});

test('only finite pixels inside the saved image can be produced or highlighted', () => {
  const model = buildCachedTrackMapModel(track()); assert.ok(model);
  for (const [lon, lat] of [[NaN, 30], [5, Infinity], [5, 90], [5, -90], [11, 30], [-1, 30]]) assert.equal(model.project(lon, lat), null);
  const tooSmallForOutsidePoint = basemap({ bounds: [0, 0, Number.MIN_VALUE, 1] });
  assert.equal(buildCachedTrackMapModel({ basemap: tooSmallForOutsidePoint, geojson: { geometry: { type: 'LineString', coordinates: [[0, 0], [1e-10, 0]] } } }), null, 'degree tolerances cannot admit points whose projected positions are infinite');
});

test('actual server-generated roads and escaped place labels remain displayable and aligned', async () => {
  const geojson = { type: 'Feature', geometry: { type: 'LineString', coordinates: [[114, 22], [114.01, 22.01]] } };
  const generated = await createRouteBasemap(geojson, { now: () => Date.parse('2026-11-06T00:00:00Z'), fetchImpl: async () => Response.json({ elements: [
    { type: 'way', tags: { highway: 'path' }, geometry: [{ lon: 114, lat: 22 }, { lon: 114.01, lat: 22.01 }] },
    { type: 'node', tags: { place: 'village', name: '合成地名 & <测试>' }, lon: 114.005, lat: 22.005 },
  ] }) });
  assert.ok(readCachedBasemap(generated));
  const model = buildCachedTrackMapModel({ basemap: generated, geojson }); assert.ok(model);
  for (const point of model.segments[0].points) assert.ok(point.x > 0 && point.x < 1000 && point.y > 0 && point.y < 600);
});
