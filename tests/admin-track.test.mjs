import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { build } from 'esbuild';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom';
import { applyActivityTrack } from '../src/tracks/activity-workflow.js';
import { mkdir, mkdtemp, realpath, rmdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const artifactsRoot = path.join(projectRoot, 'artifacts');
await mkdir(artifactsRoot, { recursive: true });
const scratch = await mkdtemp(path.join(artifactsRoot, 'admin-track-test-'));
const bundlePath = path.join(scratch, 'admin.mjs');
after(async () => {
  assert.equal(path.dirname(scratch), artifactsRoot);
  await unlink(bundlePath).catch(error => { if (error.code !== 'ENOENT') throw error; });
  await rmdir(scratch);
});
const result = await build({
  stdin: { contents: "export * from './src/pages/Admin.jsx';", resolveDir: projectRoot, sourcefile: 'admin-track-test.jsx', loader: 'jsx' },
  absWorkingDir: projectRoot, bundle: true, write: false, platform: 'node', format: 'esm', target: 'node22', jsx: 'automatic', packages: 'external',
  loader: { '.css': 'empty' }, define: { 'import.meta.env': '{}' }, logLevel: 'silent',
  plugins: [{ name: 'no-external-storage', setup(builder) {
    builder.onResolve({ filter: /(?:^|[\\/])track-store\.js$/ }, () => ({ path: 'store', namespace: 'admin-test' }));
    builder.onResolve({ filter: /(?:^|[\\/])TrackUpload\.jsx$/ }, () => ({ path: 'upload', namespace: 'admin-test' }));
    builder.onLoad({ filter: /^store$/, namespace: 'admin-test' }, () => ({ contents: "export async function getLocalTrack(){return null} export async function putLocalTrack(){throw Error('No real storage in this test')}", loader: 'js' }));
    builder.onLoad({ filter: /^upload$/, namespace: 'admin-test' }, () => ({ contents: 'export default function TrackUpload(){return null}', loader: 'js' }));
  } }],
});
await writeFile(bundlePath, result.outputFiles[0].text, 'utf8');
const { prepareRouteTrackPayload, prepareActivityTrackPayload, DebugPanel, ContentEditor } = await import(pathToFileURL(bundlePath).href);

const imported = overrides => ({ version: 1, name: 'Synthetic track', stats: { distanceM: 2350, ascentM: null }, ...overrides });

test('local route saves derive metrics and store large track data outside the draft payload', async () => {
  const source = { title: 'Local route', distance: 999, ascent: 777, track: { name: 'old' }, trackLocalId: 'old-id' };
  const original = structuredClone(source);
  const track = imported();
  let stored;
  const result = await prepareRouteTrackPayload(source, track, { local: true, storeTrack: async value => { stored = value; return 'new-id'; } });
  assert.equal(stored, track);
  assert.equal(result.distance, 2.35);
  assert.equal(result.ascent, null, 'unknown ascent must stay null rather than becoming zero');
  assert.equal(result.trackLocalId, 'new-id');
  assert.ok(!Object.hasOwn(result, 'track'));
  assert.deepEqual(source, original, 'saving must not mutate the existing draft before persistence succeeds');
});

test('cloud payload attaches the imported track and removes stale browser-only references without writing remotely', async () => {
  const track = imported({ stats: { distanceM: 12345, ascentM: 654 } });
  const result = await prepareRouteTrackPayload({ trackLocalId: 'browser-only', distance: 1, ascent: 2 }, track, { local: false, storeTrack: async () => { throw Error('must not use local store'); } });
  assert.equal(result.track, track);
  assert.equal(result.distance, 12.345);
  assert.equal(result.ascent, 654);
  assert.ok(!Object.hasOwn(result, 'trackLocalId'));
});

test('a failed local track write leaves the prior payload and track reference unchanged', async () => {
  const source = { title: 'Existing', distance: 7, ascent: null, trackLocalId: 'preserve-me' };
  const original = structuredClone(source);
  await assert.rejects(() => prepareRouteTrackPayload(source, imported(), { local: true, storeTrack: async () => { throw Error('IndexedDB unavailable'); } }), /IndexedDB unavailable/);
  assert.deepEqual(source, original);
});

test('only explicit null removes both track representations; unresolved undefined preserves them', async () => {
  const source = { title: 'Existing', distance: 7, ascent: null, track: imported(), trackLocalId: 'preserve-me' };
  const unresolved = await prepareRouteTrackPayload(source, undefined, { local: true });
  assert.equal(unresolved.track, source.track);
  assert.equal(unresolved.trackLocalId, 'preserve-me');
  const removed = await prepareRouteTrackPayload(source, null, { local: true });
  assert.ok(!Object.hasOwn(removed, 'track'));
  assert.ok(!Object.hasOwn(removed, 'trackLocalId'));
  assert.equal(removed.distance, 7);
  assert.equal(removed.ascent, null);
  assert.ok(Object.hasOwn(source, 'track'));
});

test('invalid parsed metrics stop before storing or replacing an existing track', async () => {
  let writes = 0;
  for (const stats of [{ distanceM: -1, ascentM: 0 }, { distanceM: NaN, ascentM: 0 }, { distanceM: 500, ascentM: -5 }, { distanceM: 500, ascentM: Infinity }]) {
    await assert.rejects(() => prepareRouteTrackPayload({ trackLocalId: 'existing' }, imported({ stats }), { local: true, storeTrack: async () => { writes++; return 'id'; } }));
  }
  assert.equal(writes, 0);
});

test('activity track payload stores a small summary and derives real locations without guessing city names', async () => {
  const track = imported({
    pointCount: 3, segmentCount: 2,
    geojson: { type: 'Feature', geometry: { type: 'MultiLineString', coordinates: [[[104, 30, null], [104.1, 30.1, null]]] } },
    location: { coordinates: [114.05, 22.54], province: '广东省', city: '深圳市', adcode: '440300', locations: [{ province: '广东省', city: '深圳市', segmentIndex: 0 }, { province: '广东省', city: '惠州市', segmentIndex: 1 }, { province: '广东省', city: '深圳市', segmentIndex: 1 }], locationStatus: 'matched', source: 'local-test' },
  });
  const source = { title: '不同的活动标题', routeName: '关联路线名', distance: 500, ascent: 99, includeFootprint: true };
  const original = structuredClone(source);
  const result = await prepareActivityTrackPayload(source, track, { local: true, storeTrack: async () => 'activity-track' });
  assert.equal(result.trackLocalId, 'activity-track');
  assert.ok(!Object.hasOwn(result, 'track'));
  assert.equal(result.organizer, 'chuanheng');
  assert.equal(result.routeName, '关联路线名');
  assert.equal(result.location, '深圳市 / 惠州市');
  assert.deepEqual(result.coordinates, [114.05, 22.54]);
  assert.equal(result.province, '广东省');
  assert.equal(result.city, '深圳市');
  assert.equal(result.ascent, null);
  assert.equal(result.trackSummary.stats, track.stats);
  assert.equal(result.trackSummary.location, track.location);
  assert.deepEqual(result.trackSummary.coordinates, result.coordinates);
  assert.ok(!Object.hasOwn(result.trackSummary, 'geojson'), 'large geometry must stay outside localStorage');
  assert.deepEqual(source, original);
});

test('unmatched activity location uses the real track coordinate and clears stale administrative names', async () => {
  const track = imported({ pointCount: 2, segmentCount: 1, location: { locations: [], locationStatus: 'unmatched' }, geojson: { type: 'Feature', geometry: { type: 'MultiLineString', coordinates: [[[103.2, 31.3, null], [103.3, 31.4, null]]] } } });
  const result = await prepareActivityTrackPayload({ province: '旧省份', city: '旧城市', coordinates: [1, 2], location: '用户地点说明' }, track, { local: false });
  assert.deepEqual(result.coordinates, [103.2, 31.3]);
  assert.ok(!Object.hasOwn(result, 'province'));
  assert.ok(!Object.hasOwn(result, 'city'));
  assert.equal(result.location, '用户地点说明');
  assert.equal(result.locationStatus, 'unmatched');
});

test('explicit activity track removal clears derived map data and local inclusion while unresolved data stays intact', async () => {
  const source = { title: 'Activity', includeFootprint: true, trackLocalId: 'original', trackSummary: { stats: {} }, coordinates: [104, 30], province: '四川省', city: '成都市', locations: [{}], locationStatus: 'matched', location: '保留地点说明' };
  const unchanged = await prepareActivityTrackPayload(source, undefined, { local: true });
  assert.deepEqual(unchanged, source);
  const removed = await prepareActivityTrackPayload(source, null, { local: true });
  for (const key of ['track', 'trackLocalId', 'trackSummary', 'coordinates', 'province', 'city', 'locations', 'locationStatus']) assert.ok(!Object.hasOwn(removed, key), `remove derived ${key}`);
  assert.equal(removed.includeFootprint, false);
  assert.equal(removed.location, '保留地点说明');
});

test('Debug renders independent retention choices with each source, statistics and linked activity', () => {
  const routes = [
    { id: 'route-a', kind: 'route', created_at: '2026-10-01', payload: { title: '同名路线', source: '第一来源', distance: 8.5, ascent: 500 } },
    { id: 'route-b', kind: 'route', created_at: '2026-10-02', payload: { title: '同名路线', source: '第二来源', distance: 9.2, ascent: null } },
  ];
  const rows = [...routes, { id: 'activity-a', kind: 'activity', payload: { title: '关联的真实活动', routeId: 'route-a' } }];
  const html = renderToStaticMarkup(createElement(StaticRouter, { location: '/admin/debug' }, createElement(DebugPanel, { groups: [{ key: '同名路线', title: '同名路线', routes }], rows, local: true, busy: false, resolvingGroup: '', onResolve: async () => true })));
  assert.equal([...html.matchAll(/type="radio"/g)].length, 2);
  assert.doesNotMatch(html, /checked=""/, 'retention must require an explicit choice');
  assert.match(html, /第一来源/);
  assert.match(html, /第二来源/);
  assert.match(html, /8\.5 km/);
  assert.match(html, /9\.2 km/);
  assert.match(html, /关联的真实活动/);
  assert.match(html, /disabled=""[^>]*>.*?保留所选并归档其他版本/s);
  assert.match(html, /归档保留原记录及处理日志/);
});

test('prepared local activity is accepted by the real workflow and creates a single linked route without inline geometry', async () => {
  const track = imported({ pointCount: 2, segmentCount: 1, location: { coordinates: [104, 30], province: '四川省', city: '成都市', locations: [], locationStatus: 'matched' }, geojson: { type: 'Feature', geometry: { type: 'MultiLineString', coordinates: [[[104, 30, null], [104.1, 30.1, null]]] } } });
  const payload = await prepareActivityTrackPayload({ title: '活动标题', routeName: '独立路线标题', dateStart: '2026-10-01', status: '已结束', includeFootprint: true, isDemo: false }, track, { local: true, storeTrack: async () => 'stored-activity-track' });
  const rows = applyActivityTrack([], { id: 'activity-one', kind: 'activity', created_at: '2026-10-01T00:00:00Z', published: false, payload });
  const activity = rows.find(row => row.kind === 'activity');
  const route = rows.find(row => row.kind === 'route');
  assert.equal(rows.length, 2);
  assert.equal(route.payload.title, '独立路线标题');
  assert.equal(activity.payload.routeId, route.id);
  assert.equal(activity.published, false);
  assert.equal(route.published, false);
  assert.equal(activity.payload.trackLocalId, 'stored-activity-track');
  assert.equal(route.payload.trackLocalId, 'stored-activity-track');
  assert.equal(activity.payload.ascent, null);
  assert.equal(route.payload.ascent, null);
  assert.ok(!Object.hasOwn(activity.payload, 'track'));
  assert.ok(!Object.hasOwn(route.payload, 'track'));
});

test('activity editor exposes separate route/date fields and track-derived read-only metrics without public draft controls', () => {
  const editor = { kind: 'activity', payload: { title: '活动标题', track: imported(), status: '已结束' } };
  const html = renderToStaticMarkup(createElement(StaticRouter, { location: '/admin/activities' }, createElement(ContentEditor, { editor, local: true, busy: false, error: '', onSave: () => {}, onClose: () => {} })));
  assert.match(html, /name="routeId"/);
  assert.doesNotMatch(html, /name="routeName"/);
  assert.match(html, /打开路线管理/);
  assert.match(html, /刷新路线列表/);
  for (const name of ["dateStart", "dateEnd", "registrationStart", "registrationDeadline"]) assert.match(html, new RegExp(`<input(?=[^>]*name="${name}")(?=[^>]*type="datetime-local")[^>]*>`));

  assert.match(html, /历史轨迹/);
  assert.doesNotMatch(html, /name="published"/);
  const distance = html.match(/<input\b(?=[^>]*name="distance")[^>]*>/)[0];
  const ascent = html.match(/<input\b(?=[^>]*name="ascent")[^>]*>/)[0];
  assert.match(distance, /readonly=/i);
  assert.match(distance, /value="2\.35"/);
  assert.match(ascent, /readonly=/i);
  assert.match(ascent, /value=""/);
  assert.doesNotMatch(html, /name="includeFootprint"/, 'automatic activity footprints must not require another settings toggle');
});

test('activity editor blocks saving while the original IndexedDB track has not been read', () => {
  const editor = { id: 'activity-with-pending-track', kind: 'activity', payload: { title: '已有活动', trackLocalId: 'must-load-first' } };
  const html = renderToStaticMarkup(createElement(StaticRouter, { location: '/admin/activities' }, createElement(ContentEditor, { editor, local: true, busy: false, error: '', onSave: () => {}, onClose: () => {} })));
  assert.match(html, /正在读取原有轨迹/);
  const button = [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].find(match => match[2].includes('保存本地草稿'));
  assert.ok(button);
  assert.match(button[1], /disabled=""/);
});
