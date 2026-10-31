import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom';
import { build } from 'esbuild';
import { mkdir, mkdtemp, realpath, rmdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { getFootprints, filterFootprints, clampView, projectCoordinate } from '../src/map/footprints.js';

// Synthetic test records: these are never published or sent to a service.
const record = (overrides = {}) => ({
  id: 'public-2026',
  title: '测试活动，不是真实协会记录',
  isDemo: false,
  organizer: 'chuanheng',
  published: true,
  date: '2026-03-21',
  type: '徒步',
  coordinates: [104.0665, 30.5723],
  ...overrides,
});

test('only explicitly real, published activities organized by Chuanheng become footprints', () => {
  const accepted = record();
  const excluded = [
    record({ id: 'demo', isDemo: true }),
    record({ id: 'demo-omitted', isDemo: undefined }),
    record({ id: 'demo-string', isDemo: 'false' }),
    record({ id: 'demo-number', isDemo: 0 }),
    record({ id: 'other-organizer', organizer: 'another-club' }),
    record({ id: 'organizer-omitted', organizer: undefined }),
    record({ id: 'draft', published: false }),
    record({ id: 'publication-omitted', published: undefined }),
    record({ id: 'publication-string', published: 'true' }),
    record({ id: 'publication-number', published: 1 }),
  ];
  assert.deepEqual(getFootprints([accepted, ...excluded]).map(item => item.id), [accepted.id]);
  assert.deepEqual(getFootprints(excluded), []);
});

test('local completed activity tracks appear only in an explicitly enabled local footprint preview', () => {
  const draft = record({published:false,localDraft:true,includeFootprint:true,status:'已结束',trackLocalId:'local-track',footprintEligible:true});
  assert.equal(getFootprints([draft]).length,0);
  assert.equal(getFootprints([draft],{allowLocalPreview:true}).length,1);
  for(const change of [{status:'报名中'},{includeFootprint:false},{trackLocalId:null},{footprintEligible:false}]) {
    assert.equal(getFootprints([{...draft,...change}],{allowLocalPreview:true}).length,0);
  }
  assert.equal(getFootprints([record({footprintEligible:false})]).length,0);
});

test('scheduled route snapshots become footprints only after the actual activity end', () => {
  const item = record({ status: '即将开始', dateStart: '2026-11-10T00:00:00Z', dateEnd: '2026-11-10T10:00:00Z', routeSnapshot: { trackLocalId: 'route-history-track' }, includeFootprint: true, footprintEligible: true, published: false, localDraft: true });
  assert.equal(getFootprints([item], { allowLocalPreview: true, now: Date.parse('2026-11-10T09:59:59Z') }).length, 0);
  assert.equal(getFootprints([item], { allowLocalPreview: true, now: Date.parse('2026-11-10T10:00:00Z') }).length, 1);
});

test('a footprint requires a nonblank identity, title and a parseable activity date', () => {
  const excluded = [
    record({ id: undefined }),
    record({ id: null }),
    record({ id: '' }),
    record({ id: '  ' }),
    record({ title: undefined }),
    record({ title: null }),
    record({ title: '' }),
    record({ title: ' \t ' }),
    record({ date: undefined }),
    record({ date: '' }),
    record({ date: 'not-a-date' }),
    record({ date: '2026.12.05 — 12.08' }),
  ];
  assert.deepEqual(getFootprints(excluded), []);
});

test('valid dates and dateStart produce a numeric year without modifying the source records', () => {
  const activity = record();
  Object.freeze(activity.coordinates);
  Object.freeze(activity);
  const dateStartOnly = record({ id: 'date-start', date: undefined, dateStart: '2025-07-10T08:00:00+08:00' });
  const parseableDate = record({ id: 'readable-date', date: 'October 5, 2024 12:00:00 GMT+0800' });
  const original = structuredClone([activity, dateStartOnly, parseableDate]);
  const actual = getFootprints([activity, dateStartOnly, parseableDate]);
  assert.deepEqual(actual.map(({ id, year }) => [id, year]).sort(), [
    ['public-2026', 2026], ['date-start', 2025], ['readable-date', 2024],
  ].sort());
  assert.deepEqual([activity, dateStartOnly, parseableDate], original);
  assert.equal(actual.find(item => item.id === activity.id).title, activity.title);
});

test('coordinates require finite numeric longitude/latitude inside the inclusive China bounding box', () => {
  const excluded = [
    undefined, null, [], [104.0665], ['104.0665', '30.5723'],
    [NaN, 30], [104, NaN], [Infinity, 30], [104, -Infinity],
    [72.99, 30], [135.01, 30], [104, 2.99], [104, 54.01],
    [30.5723, 104.0665], '104.0665,30.5723',
  ].map((coordinates, index) => record({ id: `bad-gps-${index}`, coordinates }));
  assert.deepEqual(getFootprints(excluded), []);
  const edges = [record({ id: 'southwest-edge', coordinates: [73, 3] }), record({ id: 'northeast-edge', coordinates: [135, 54] })];
  assert.deepEqual(getFootprints(edges).map(item => item.id).sort(), edges.map(item => item.id).sort());
});

test('an empty activity source cannot manufacture association footprints', () => {
  assert.deepEqual(getFootprints([]), []);
});

test('footprint filters combine the selected year and activity type with AND', () => {
  const records = getFootprints([
    record({ id: '2026-hike', date: '2026-03-21', type: '徒步' }),
    record({ id: '2026-climb', date: '2026-04-18', type: '登山' }),
    record({ id: '2025-climb', date: '2025-05-09', type: '登山' }),
  ]);
  const ids = options => filterFootprints(records, options).map(item => item.id).sort();
  assert.deepEqual(ids({ year: 'all', type: 'all' }), ['2025-climb', '2026-climb', '2026-hike']);
  assert.deepEqual(ids({ year: '2026', type: 'all' }), ['2026-climb', '2026-hike']);
  assert.deepEqual(ids({ year: 'all', type: '登山' }), ['2025-climb', '2026-climb']);
  assert.deepEqual(ids({ year: '2026', type: '徒步' }), ['2026-hike']);
  assert.deepEqual(ids({ year: '2025', type: '徒步' }), []);
  assert.deepEqual(ids({ year: '1999', type: 'all' }), []);
  assert.deepEqual(ids({ year: 'all', type: '未发布的活动类型' }), []);
  assert.equal(records.length, 3, 'applying filters must not discard source records');
});

test('view clamping keeps zoom in 1–4 and resets both pan axes at the base view', () => {
  assert.deepEqual(clampView({ zoom: 0.5, panX: 900, panY: -900 }), { zoom: 1, panX: 0, panY: 0 });
  assert.deepEqual(clampView({ zoom: 1, panX: -100, panY: 200 }), { zoom: 1, panX: 0, panY: 0 });
  assert.deepEqual(clampView({ zoom: 7, panX: 9999, panY: -9999 }), { zoom: 4, panX: 1500, panY: -960 });
});

test('view pan limits follow the 1000×640 viewBox at integer and fractional zoom', () => {
  assert.deepEqual(clampView({ zoom: 2, panX: -9999, panY: 9999 }), { zoom: 2, panX: -500, panY: 320 });
  assert.deepEqual(clampView({ zoom: 2.5, panX: 9999, panY: -9999 }), { zoom: 2.5, panX: 750, panY: -480 });
  const withinBounds = { zoom: 3.5, panX: 310, panY: -150 };
  assert.deepEqual(clampView(withinBounds), withinBounds);
});

test('projecting valid Chinese coordinates returns finite two-dimensional map points', () => {
  // The implementation owns the projection. Do not bind this test to invented pixels.
  for (const coordinates of [[104.0665, 30.5723], [116.4074, 39.9042], [114.0579, 22.5431], [73, 3], [135, 54]]) {
    const original = [...coordinates];
    const result = projectCoordinate(coordinates);
    assert.ok(Array.isArray(result) && result.length === 2);
    assert.ok(result.every(value => typeof value === 'number' && Number.isFinite(value)));
    assert.deepEqual(coordinates, original, 'projection must not mutate the source GPS coordinates');
  }
});

let renderEmptyPage;
let scratch;
let bundlePath;
const projectRoot = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const artifactsRoot = path.join(projectRoot, 'artifacts');

after(async () => {
  if (!scratch) return;
  // Remove only paths created by this test; do not recursively clean shared artifacts.
  assert.equal(path.dirname(scratch), artifactsRoot);
  if (bundlePath) await unlink(bundlePath).catch(error => { if (error.code !== 'ENOENT') throw error; });
  await rmdir(scratch);
});

async function getEmptyPageRenderer() {
  if (renderEmptyPage) return renderEmptyPage;
  await mkdir(artifactsRoot, { recursive: true });
  scratch = await mkdtemp(path.join(artifactsRoot, 'footprints-regression-'));
  bundlePath = path.join(scratch, 'pages.mjs');
  const output = await build({
    stdin: {
      contents: "export { AboutPage, FootprintsPage } from './src/pages/Community.jsx';",
      resolveDir: projectRoot,
      sourcefile: 'empty-footprints-entry.jsx',
      loader: 'jsx',
    },
    absWorkingDir: projectRoot,
    bundle: true,
    write: false,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    jsx: 'automatic',
    packages: 'external',
    loader: { '.css': 'empty' },
    define: { 'import.meta.env': JSON.stringify({ VITE_CONTENT_MODE: 'preview' }) },
    plugins: [{
      name: 'empty-footprint-catalog',
      setup(builder) {
        builder.onResolve({ filter: /(?:^|[\\/])catalog\.jsx$/ }, () => ({ path: 'empty-catalog', namespace: 'footprint-test' }));
        builder.onLoad({ filter: /^empty-catalog$/, namespace: 'footprint-test' }, () => ({
          contents: "export const isPreview = true; export function useCatalog() { return { activities: [], routes: [], photos: [], articles: [], loading: false, error: '', refresh: async () => {} }; }",
          loader: 'js',
        }));
      },
    }],
    logLevel: 'silent',
  });
  await writeFile(bundlePath, output.outputFiles[0].text, 'utf8');
  const pages = await import(pathToFileURL(bundlePath).href);
  renderEmptyPage = page => renderToStaticMarkup(createElement(StaticRouter, { location: page === 'AboutPage' ? '/about' : '/footprints' }, createElement(pages[page])));
  return renderEmptyPage;
}

test('About and dedicated footprints pages keep an accessible China SVG map when real activities are empty', async t => {
  const render = await getEmptyPageRenderer();
  for (const page of ['AboutPage', 'FootprintsPage']) {
    await t.test(page, () => {
      const html = render(page);
      const svg = html.match(/<svg\b[^>]*aria-label="[^"]*中国[^"]*"[^>]*>/);
      assert.ok(svg, `${page}: empty activities must still display a China SVG base map, not only mountain photography`);
      assert.doesNotMatch(svg[0], /aria-hidden="true"/, 'the labelled base map must remain available to assistive technology');
      assert.match(html, /<path\b/, `${page}: the map must contain vector geography`);
      assert.doesNotMatch(html, /测试活动，不是真实协会记录/, 'empty activity input must not create markers or activity history');
    });
  }
});
