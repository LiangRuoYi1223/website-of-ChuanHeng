import assert from 'node:assert/strict';
import {after, test} from 'node:test';
import {act, createElement} from 'react';
import {JSDOM} from 'jsdom';
import {build} from 'esbuild';
import {mkdir, mkdtemp, realpath, rmdir, unlink} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {convertTrack} from '../server/tracks/parse.mjs';
import {createRouteBasemap} from '../server/basemaps/create-route-basemap.mjs';

// Actual server-produced fixtures and actual upload, validation and visualization
// components. The replacement fetch is the only network boundary in these tests.
const xml = (name, offset = 0, elevations = true) => `<gpx><trk><name>${name}</name><trkseg><trkpt lon="${114 + offset}" lat="${22 + offset}">${elevations ? '<ele>100</ele>' : ''}</trkpt><trkpt lon="${114.01 + offset}" lat="${22.01 + offset}">${elevations ? '<ele>120</ele>' : ''}</trkpt></trkseg></trk></gpx>`;
async function fixture(name, offset, elevations = true) {
  const track = convertTrack(xml(name, offset, elevations), {filename: `${name}.gpx`});
  const points = track.geojson.geometry.coordinates[0];
  const basemap = await createRouteBasemap(track.geojson, {now: Date.parse('2026-11-06T00:00:00Z'), loadElements: async () => ({elements: [{type: 'way', id: 1, tags: {highway: 'path'}, geometry: points.map(([lon, lat]) => ({lon, lat}))}]})});
  return {legacy: track, prepared: {...track, basemap}, basemap};
}
const first = await fixture('原合成路线', 0), second = await fixture('新合成路线', .1), missingElevation = await fixture('缺失海拔合成路线', .2, false);
const dom = new JSDOM('<!doctype html><div id="app"></div>', {url: 'https://frontend.invalid/admin/routes', pretendToBeVisual: true});
const originals = new Map();
function expose(key, value) {
  originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, {configurable: true, writable: true, value});
}
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'FormData', 'Event']) expose(key, key === 'window' ? dom.window : key === 'document' ? dom.window.document : dom.window[key]);
expose('IS_REACT_ACT_ENVIRONMENT', true);
const control = {calls: [], changes: [], busy: [], authCalls: 0, submits: 0, reply: null};
expose('__TRACK_UPLOAD_BASEMAP_BACKEND', {auth: {async getSession() {
  control.authCalls++;
  return {data: {session: {access_token: 'synthetic-upload-token'}}, error: null};
}}});
expose('fetch', async (url, options) => {
  assert.ok(['/api/tracks/convert?basemap=1', '/api/tracks/basemap'].includes(url), 'components must never load tiles or write content while preparing a draft');
  control.calls.push({url, options});
  assert.equal(new Headers(options.headers).get('authorization'), 'Bearer synthetic-upload-token');
  assert.equal(options.method, 'POST');
  return control.reply(url, options);
});
const {createRoot} = await import('react-dom/client');
const project = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const artifacts = path.join(project, 'artifacts'); await mkdir(artifacts, {recursive: true});
const scratch = await mkdtemp(path.join(artifacts, 'track-upload-basemap-'));
const bundle = path.join(scratch, 'component.mjs');
await build({
  stdin: {contents: "export {default} from './src/tracks/TrackUpload.jsx';", resolveDir: project, loader: 'jsx'},
  absWorkingDir: project, bundle: true, platform: 'node', format: 'esm', packages: 'external', jsx: 'automatic', loader: {'.css': 'empty'},
  define: {'import.meta.env': JSON.stringify({PROD: true, DEV: false, MODE: 'production', VITE_CONTENT_MODE: 'live'})}, outfile: bundle,
  plugins: [{name: 'track-upload-session-only', setup(builder) {
    builder.onResolve({filter: /(?:^|[\\/])backend\.js$/}, () => ({path: 'backend', namespace: 'track-upload'}));
    builder.onLoad({filter: /.*/, namespace: 'track-upload'}, () => ({contents: 'export const supabase=globalThis.__TRACK_UPLOAD_BASEMAP_BACKEND;', loader: 'js'}));
  }}],
});
const TrackUpload = (await import(pathToFileURL(bundle).href)).default;
const container = document.getElementById('app');
let root;
const button = label => [...container.querySelectorAll('button')].find(node => node.textContent.trim() === label);
const currentName = () => container.querySelector('.track-import-result strong')?.textContent;
async function render(value) {
  await act(async () => root.render(createElement('form', {onSubmit: event => {event.preventDefault(); control.submits++;}},
    createElement(TrackUpload, {value, local: false, onChange: next => control.changes.push(next), onBusyChange: busy => control.busy.push(busy)}),
    createElement('button', {type: 'submit'}, '保存表单'),
  )));
}
async function mount(value = first.legacy, reply = () => Response.json({track: second.prepared})) {
  if (root) await act(async () => root.unmount());
  Object.assign(control, {calls: [], changes: [], busy: [], authCalls: 0, submits: 0, reply});
  root = createRoot(container);
  await render(value);
}
async function click(label) {const node = button(label); assert.ok(node, `${label} control exists`); await act(async () => node.click());}
async function upload({sourceXml = xml('新合成路线', .1), filename = 'synthetic-new.gpx'} = {}) {
  const input = container.querySelector('input[type="file"]');
  Object.defineProperty(input, 'files', {configurable: true, value: [new dom.window.File([sourceXml], filename, {type: 'application/gpx+xml'})]});
  await act(async () => input.dispatchEvent(new dom.window.Event('change', {bubbles: true})));
}
function deferred() {let resolve; const promise = new Promise(yes => {resolve = yes;}); return {promise, resolve};}
async function release(pending, response) {await act(async () => {pending.resolve(response); await new Promise(resolve => setImmediate(resolve));});}
function assertOriginalRetained() {
  assert.equal(control.changes.length, 0, 'no partial or obsolete result may replace the prior track');
  assert.equal(currentName(), first.legacy.name);
  assert.equal(Object.hasOwn(first.legacy, 'basemap'), false, 'the original object must stay unchanged');
}
after(async () => {
  if (root) await act(async () => root.unmount());
  dom.window.close();
  for (const [key, descriptor] of originals) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
  await unlink(bundle); await rmdir(scratch);
});

test('route uploads request a prepared basemap and pass a real server result through the actual component', async () => {
  await mount();
  await upload();
  assert.equal(control.authCalls, 1);
  assert.equal(control.calls.length, 1);
  assert.equal(control.calls[0].url, '/api/tracks/convert?basemap=1');
  assert.ok(control.calls[0].options.body instanceof dom.window.FormData);
  assert.equal(control.calls[0].options.body.get('file').name, 'synthetic-new.gpx');
  assert.deepEqual(control.changes, [second.prepared]);
  assert.equal(control.busy[0], true); assert.equal(control.busy.at(-1), false);
  assert.equal(control.submits, 0, 'conversion prepares a draft rather than submitting the route form');
});

test('upload responses without a valid saved basemap never replace the original track', async () => {
  for (const track of [second.legacy, {...second.prepared, basemap: first.basemap}]) {
    await mount(first.legacy, () => Response.json({track}));
    await upload();
    assertOriginalRetained();
    assert.match(container.querySelector('[role="alert"]')?.textContent || '', /有效底图/);
    assert.equal(control.busy.at(-1), false);
  }
});

test('an existing track generates its own basemap using its session token and still requires form submission', async () => {
  const original = structuredClone(first.legacy), before = structuredClone(original);
  await mount(original, () => Response.json({basemap: first.basemap}));
  await click('生成底图');
  assert.equal(control.authCalls, 1);
  assert.equal(control.calls.length, 1);
  const call = control.calls[0];
  assert.equal(call.url, '/api/tracks/basemap');
  assert.equal(new Headers(call.options.headers).get('content-type'), 'application/json');
  assert.deepEqual(JSON.parse(call.options.body), {geojson: original.geojson});
  assert.deepEqual(control.changes, [{...original, basemap: first.basemap}]);
  assert.notEqual(control.changes[0], original);
  assert.deepEqual(original, before, 'generating a map must not mutate the saved input object');
  assert.equal(control.submits, 0);
  await click('保存表单');
  assert.equal(control.submits, 1, 'only the explicit save submits the surrounding form');
});

test('failed or mismatched basemap generation preserves the existing route and reports an actionable error', async () => {
  for (const reply of [
    () => Response.json({error: {message: '地图服务暂时繁忙，请稍后重试。'}}, {status: 503}),
    () => Response.json({basemap: second.basemap}),
  ]) {
    await mount(first.legacy, reply);
    await click('生成底图');
    assertOriginalRetained();
    assert.match(container.querySelector('[role="alert"]')?.textContent || '', /重试/);
    assert.equal(control.busy.at(-1), false);
  }
});

test('cancelling an upload rejects a late successful response even when fetch ignores its abort signal', async () => {
  const pending = deferred();
  await mount(first.legacy, () => pending.promise);
  await upload();
  assert.equal(control.calls.length, 1);
  await click('取消');
  assert.equal(control.calls[0].options.signal.aborted, true);
  await release(pending, Response.json({track: second.prepared}));
  assertOriginalRetained();
  assert.equal(control.busy.at(-1), false);
});

test('cancelling basemap generation rejects a late successful response even when fetch ignores its abort signal', async () => {
  const pending = deferred();
  await mount(first.legacy, () => pending.promise);
  await click('生成底图');
  await click('取消');
  assert.equal(control.calls[0].options.signal.aborted, true);
  await release(pending, Response.json({basemap: first.basemap}));
  assertOriginalRetained();
  assert.equal(control.busy.at(-1), false);
});

test('unmounting invalidates late successful uploads and map generation without notifying a former owner', async () => {
  for (const operation of ['upload', 'map']) {
    const pending = deferred();
    await mount(first.legacy, () => pending.promise);
    if (operation === 'upload') await upload(); else await click('生成底图');
    await act(async () => root.unmount()); root = null;
    assert.equal(control.calls[0].options.signal.aborted, true);
    await release(pending, Response.json(operation === 'upload' ? {track: second.prepared} : {basemap: first.basemap}));
    assert.equal(control.changes.length, 0);
    assert.equal(control.busy.at(-1), false);
  }
});

test('switching the same component to another track invalidates outstanding upload and map success', async () => {
  for (const operation of ['upload', 'map']) {
    const pending = deferred();
    await mount(first.legacy, () => pending.promise);
    if (operation === 'upload') await upload(); else await click('生成底图');
    await render(second.legacy);
    assert.equal(currentName(), second.legacy.name);
    await release(pending, Response.json(operation === 'upload' ? {track: second.prepared} : {basemap: first.basemap}));
    assert.equal(control.changes.length, 0, 'an earlier route request cannot replace the track now owned by this editor');
    assert.equal(currentName(), second.legacy.name);
    assert.equal(control.busy.at(-1), false);
  }
});

test('a pending metric decision for a replaced track cannot overwrite the new owner', async () => {
  await mount(first.legacy, () => Response.json({track: missingElevation.prepared}));
  await upload({sourceXml: xml('缺失海拔合成路线', .2, false), filename: '缺失海拔合成路线.gpx'});
  assert.ok(container.querySelector('.track-metrics-dialog'), 'the real parser result with missing altitude opens the metric decision');
  assert.equal(control.changes.length, 0, 'an unconfirmed metric decision has not committed a replacement');
  await render(second.legacy);
  // A stale visible dialog can be activated by a user; clearing it is also a
  // valid fix. In either case its old result must never reach the new owner.
  if (button('暂不提供')) await click('暂不提供');
  assert.equal(control.changes.length, 0, 'confirming an older pending result must not replace the current track');
  assert.equal(currentName(), second.legacy.name);
  assert.ok(!container.querySelector('.track-metrics-dialog'), 'changing the route dismisses the obsolete metric decision');
  assert.equal(control.busy.at(-1), false);
});

test('obsolete request failures do not appear on the track that replaced their owner', async () => {
  for (const operation of ['upload', 'map']) {
    const pending = deferred();
    await mount(first.legacy, () => pending.promise);
    if (operation === 'upload') await upload(); else await click('生成底图');
    await render(second.legacy);
    await release(pending, Response.json({error: {message: '旧路线A请求失败，请稍后重试。'}}, {status: 503}));
    assert.ok(!container.querySelector('[role="alert"]'), 'a late error for the former route must not become the new route error');
    assert.equal(control.changes.length, 0);
    assert.equal(currentName(), second.legacy.name);
    assert.equal(control.busy.at(-1), false);
  }
});
