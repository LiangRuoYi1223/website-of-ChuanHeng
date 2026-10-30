import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { act, createElement } from 'react';
import { JSDOM } from 'jsdom';
import 'fake-indexeddb/auto';
import { build } from 'esbuild';
import { mkdir, mkdtemp, realpath, rmdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { convertTrack } from '../server/tracks/parse.mjs';
import { getLocalTrack, putLocalTrack } from '../src/tracks/track-store.js';
import { getFootprints } from '../src/map/footprints.js';
import { applyActivityTrack, resolveDuplicateRoutes } from '../src/tracks/activity-workflow.js';

// A local component integration test. No browser automation, real geography lookup,
// tile requests, cloud accounts or network requests are used.
const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', { url: 'http://localhost:5178/admin', pretendToBeVisual: true });
const originals = new Map();
function installGlobal(key, value) {
  originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
}
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'HTMLInputElement', 'HTMLSelectElement', 'FormData', 'File', 'Blob', 'Event', 'MouseEvent', 'KeyboardEvent']) installGlobal(key, key === 'window' ? dom.window : key === 'document' ? dom.window.document : key === 'navigator' ? dom.window.navigator : dom.window[key]);
installGlobal('localStorage', dom.window.localStorage);
installGlobal('IS_REACT_ACT_ENVIRONMENT', true);
// JSDOM has no layout. Supply nonzero rectangles only for the focus-trap check;
// this is not a screenshot or a claim about rendered geometry.
dom.window.HTMLElement.prototype.getClientRects = function () { return this.hidden || this.closest('[aria-hidden="true"]') ? [] : [new dom.window.DOMRect(0, 0, 20, 20)]; };

const { createRoot } = await import('react-dom/client');
const { MemoryRouter } = await import('react-router-dom');
const projectRoot = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const artifactsRoot = path.join(projectRoot, 'artifacts');
await mkdir(artifactsRoot, { recursive: true });
const scratch = await mkdtemp(path.join(artifactsRoot, 'admin-workflow-dom-'));
const bundlePath = path.join(scratch, 'admin.mjs');
let root;
after(async () => {
  if (root) await act(async () => root.unmount());
  await new Promise((resolve, reject) => { const request = indexedDB.deleteDatabase('chuanheng-tracks'); request.onsuccess = resolve; request.onerror = () => reject(request.error); request.onblocked = () => reject(new Error('test database remained open')); });
  dom.window.close();
  for (const [key, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; }
  assert.equal(path.dirname(scratch), artifactsRoot);
  await unlink(bundlePath).catch(error => { if (error.code !== 'ENOENT') throw error; });
  await rmdir(scratch);
});
const output = await build({
  stdin: { contents: "export {AdminPage} from './src/pages/Admin.jsx';", resolveDir: projectRoot, sourcefile: 'admin-workflow-dom.jsx', loader: 'jsx' },
  absWorkingDir: projectRoot, bundle: true, write: false, platform: 'node', format: 'esm', target: 'node22', jsx: 'automatic', packages: 'external',
  loader: { '.css': 'empty' }, define: { 'import.meta.env': JSON.stringify({ VITE_CONTENT_MODE: 'preview', VITE_TERRAIN_TILE_URL: 'offline' }) }, logLevel: 'silent',
});
await writeFile(bundlePath, output.outputFiles[0].text, 'utf8');
const { AdminPage } = await import(pathToFileURL(bundlePath).href);

const xml = (name, offset = 0, elevation = true) => `<?xml version="1.0"?><gpx version="1.1" creator="synthetic-component-test"><trk><name>${name}</name><trkseg><trkpt lon="${104 + offset}" lat="${30 + offset}">${elevation ? '<ele>100</ele>' : ''}</trkpt><trkpt lon="${104.01 + offset}" lat="${30.01 + offset}">${elevation ? '<ele>120</ele>' : ''}</trkpt></trkseg><trkseg><trkpt lon="${104.03 + offset}" lat="${30.03 + offset}">${elevation ? '<ele>150</ele>' : ''}</trkpt><trkpt lon="${104.04 + offset}" lat="${30.04 + offset}">${elevation ? '<ele>160</ele>' : ''}</trkpt></trkseg></trk></gpx>`;
const fixtures = new Map([
  ['manual.gpx', { xml: xml('合成独立路线', .4), status: 'matched' }],
  ['activity-a.gpx', { xml: xml('合成活动甲'), status: 'matched' }],
  ['activity-b.gpx', { xml: xml('合成活动乙', .2, false), status: 'partial' }],
]);
for (const [filename, fixture] of fixtures) {
  fixture.track = convertTrack(fixture.xml, { filename });
  fixture.track.location = { coordinates: fixture.track.geojson.geometry.coordinates[0][0].slice(0, 2), province: '四川省', city: fixture.status === 'matched' ? '成都市' : null, adcode: null, locations: [{ province: '四川省', city: fixture.status === 'matched' ? '成都市' : null, segmentIndex: 0 }], locationStatus: fixture.status, source: 'synthetic-test-location' };
}
const requests = [];
const pending = [];
installGlobal('fetch', async (url, options) => {
  assert.equal(url, '/api/tracks/convert', 'the component must not fetch tiles or other services in this offline test');
  assert.equal(options.method, 'POST');
  assert.ok(options.body instanceof dom.window.FormData, 'the actual file input must reach the conversion client');
  const file = options.body.get('file');
  assert.ok(file instanceof dom.window.File);
  const fixture = fixtures.get(file.name);
  assert.ok(fixture, 'only a synthetic test file may be uploaded');
  assert.equal(file.size, Buffer.byteLength(fixture.xml));
  assert.ok(!options.headers.Authorization, 'local component tests must not transmit credentials');
  requests.push(file.name);
  return new Promise((resolve, reject) => {
    const abort = () => reject(new dom.window.DOMException('Cancelled', 'AbortError'));
    options.signal?.addEventListener('abort', abort, { once: true });
    pending.push({ filename: file.name, release: () => { options.signal?.removeEventListener('abort', abort); resolve({ ok: true, json: async () => ({ track: structuredClone(fixture.track) }) }); } });
  });
});

const container = dom.window.document.getElementById('app');
const drafts = () => JSON.parse(localStorage.getItem('chuanheng-drafts') || '[]');
const text = element => element.textContent.replace(/\s+/g, ' ').trim();
const button = (label, scope = container) => [...scope.querySelectorAll('button')].find(element => text(element) === label);
const dialog = () => container.querySelector('[role="dialog"]');
async function click(element) {
  assert.ok(element, 'the requested control must exist');
  // HTMLElement.click() does not focus controls in JSDOM; model the browser's
  // normal pointer-focus step explicitly before dispatching the native click.
  await act(async () => { element.focus(); element.click(); });
}
async function waitFor(predicate, description) {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  }
  assert.fail(`Timed out waiting for ${description}. Alerts: ${[...container.querySelectorAll('[role="alert"]')].map(text).join(' / ')}`);
}
async function mount(location) {
  if (root) await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () => root.render(createElement(MemoryRouter, { initialEntries: [location] }, createElement(AdminPage))));
}
async function navigateAdmin(section) {
  await click(container.querySelector(`.admin-sidebar a[href="/admin/${section}?preview=1"]`));
}
async function fill(name, value, scope = dialog()) {
  const input = scope.querySelector(`[name="${name}"]`);
  assert.ok(input, `${name} must be in the real editor form`);
  await act(async () => { input.value = value; input.dispatchEvent(new dom.window.Event(input.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); });
}
async function chooseFile(filename) {
  const input = dialog().querySelector('input[type="file"]');
  assert.ok(input);
  const fixture = fixtures.get(filename);
  const file = new dom.window.File([fixture.xml], filename, { type: 'application/gpx+xml' });
  Object.defineProperty(input, 'files', { configurable: true, value: [file] });
  await act(async () => input.dispatchEvent(new dom.window.Event('change', { bubbles: true })));
  await waitFor(() => pending.some(item => item.filename === filename), 'the conversion request');
}
async function releaseFile(filename) {
  const request = pending.find(item => item.filename === filename);
  assert.ok(request);
  await act(async () => request.release());
  await waitFor(() => dialog()?.querySelector('.track-import-result'), 'converted track preview');
}
async function saveEditor() {
  await click(button('保存本地草稿', dialog()));
  await waitFor(() => !dialog(), 'the saved editor to close');
}

test('real admin forms persist track-backed activities and resolve duplicate routes without losing activity tracks', async t => {
  localStorage.clear();
  let changedEvents = 0;
  dom.window.addEventListener('chuanheng-drafts-updated', () => changedEvents++);
  let firstActivity, secondActivity, firstRoute, secondRoute;

  await t.test('route editor uploads a real File through the client and keeps large geometry in IndexedDB', async () => {
    await mount('/admin/routes?preview=1');
    assert.equal(container.querySelector('a[href^="/admin/settings"]'), null);
    assert.equal(container.querySelector('a[href^="/admin/footprints"]'), null);
    assert.ok(container.querySelector('a[href="/routes/import"]'));
    await click(button('新建路线'));
    await fill('title', '独立路线草稿');
    await chooseFile('manual.gpx');
    assert.equal(button('保存本地草稿', dialog()).disabled, true);
    await releaseFile('manual.gpx');
    await saveEditor();
    const row = drafts().find(item => item.kind === 'route');
    assert.ok(row.payload.trackLocalId);
    assert.equal(row.published, false);
    assert.equal(row.payload.track, undefined);
    assert.deepEqual((await getLocalTrack(row.payload.trackLocalId)).geojson, fixtures.get('manual.gpx').track.geojson);
    assert.ok(container.querySelector(`a[href="/routes/${row.id}?draft=1"]`));
  });

  await t.test('activity conversion blocks submission until complete then saves one activity and its automatic route', async () => {
    await navigateAdmin('activities');
    await click(button('新建活动'));
    await fill('title', '合成活动甲');
    await fill('routeName', '共享山野路线');
    await fill('dateStart', '2026-10-01');
    await fill('status', '已结束');
    assert.equal(dialog().querySelector('[name="includeFootprint"]'), null, 'activity footprints are automatic, with no extra opt-in toggle');
    assert.match(text(dialog()), /自动出现在本地足迹预览/);
    const before = localStorage.getItem('chuanheng-drafts');
    await chooseFile('activity-a.gpx');
    assert.equal(button('保存本地草稿', dialog()).disabled, true);
    await act(async () => dialog().querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })));
    assert.equal(localStorage.getItem('chuanheng-drafts'), before, 'even direct form submission must not save an unfinished conversion');
    await releaseFile('activity-a.gpx');
    assert.equal(dialog().querySelector('[name="distance"]').readOnly, true);
    assert.equal(dialog().querySelector('[name="location"]').readOnly, true);
    await saveEditor();
    const rows = drafts();
    firstActivity = rows.find(row => row.kind === 'activity');
    firstRoute = rows.find(row => row.kind === 'route' && row.payload.generatedFromActivityId === firstActivity.id);
    assert.ok(firstRoute);
    assert.equal(firstActivity.payload.routeId, firstRoute.id);
    assert.equal(firstRoute.payload.title, '共享山野路线');
    assert.equal(firstActivity.payload.trackLocalId, firstRoute.payload.trackLocalId);
    assert.equal(firstActivity.payload.organizer, 'chuanheng');
    assert.equal(firstActivity.payload.dateStart, '2026-10-01');
    assert.equal(firstActivity.payload.status, '已结束');
    assert.equal(firstActivity.payload.includeFootprint, true);
    assert.equal(firstActivity.payload.footprintEligible, true);
    assert.equal(firstActivity.published, false);
    assert.equal(firstRoute.published, false);
    assert.deepEqual(firstActivity.payload.trackSummary.stats, fixtures.get('activity-a.gpx').track.stats);
    assert.equal(firstActivity.payload.track, undefined);
    assert.equal(firstRoute.payload.track, undefined);
    assert.ok(!localStorage.getItem('chuanheng-drafts').includes('"geojson"'));
    assert.ok(!localStorage.getItem('chuanheng-drafts').includes('"profile"'));
    assert.deepEqual(await getLocalTrack(firstActivity.payload.trackLocalId), fixtures.get('activity-a.gpx').track);
    assert.ok(container.querySelector(`a[href="/activities/${firstActivity.id}?draft=1"]`));
    const publicShape = { ...firstActivity.payload, id: firstActivity.id, published: false, localDraft: true };
    assert.equal(getFootprints([publicShape]).length, 0, 'a local preview must not publish a draft footprint');
    assert.equal(getFootprints([publicShape], { allowLocalPreview: true }).length, 1);
  });

  await t.test('a second same-name route remains separate until an explicit Debug choice', async () => {
    await click(button('新建活动'));
    await fill('title', '合成活动乙');
    await fill('routeName', '共享山野路线');
    await fill('dateStart', '2026-10-02');
    await fill('status', '已结束');
    assert.equal(dialog().querySelector('[name="includeFootprint"]'), null);
    await chooseFile('activity-b.gpx');
    await releaseFile('activity-b.gpx');
    await saveEditor();
    const rows = drafts();
    secondActivity = rows.find(row => row.kind === 'activity' && row.id !== firstActivity.id);
    secondRoute = rows.find(row => row.kind === 'route' && row.payload.generatedFromActivityId === secondActivity.id);
    assert.notEqual(secondRoute.id, firstRoute.id);
    assert.equal(rows.filter(row => row.kind === 'route' && row.payload.title === '共享山野路线' && !row.payload.archived).length, 2);
    assert.equal(secondActivity.payload.includeFootprint, true, 'completed dated activities with tracks automatically join local footprint preview');
    assert.equal(secondActivity.payload.ascent, null, 'missing altitude must not become zero during form save');
    await navigateAdmin('debug');
    assert.equal(container.querySelectorAll('.admin-debug-group input[type="radio"]').length, 2);
    const retain = button('保留所选并归档其他版本');
    assert.equal(retain.disabled, true);
    assert.match(text(container.querySelector('.admin-debug-locations')), /合成活动乙.*部分地点待核实/s);
    const selection = [...container.querySelectorAll('.admin-debug-group input[type="radio"]')].find(input => input.value === secondRoute.id);
    await click(selection);
    assert.equal(retain.disabled, false);
    await click(retain);
    await waitFor(() => !container.querySelector('.admin-debug-group'), 'duplicate archive transaction');
    assert.equal(dom.window.document.activeElement.id, 'admin-debug-title', 'successful consolidation must return keyboard focus to the Debug heading');
    const after = drafts();
    const loser = after.find(row => row.id === firstRoute.id);
    const winner = after.find(row => row.id === secondRoute.id);
    assert.equal(loser.payload.archived, true);
    assert.equal(loser.payload.archivedReason, 'duplicate');
    assert.equal(loser.payload.duplicateWinnerId, secondRoute.id);
    assert.equal(winner.payload.duplicateResolutions.length, 1);
    assert.deepEqual(winner.payload.duplicateResolutions[0].originalIds, [firstRoute.id, secondRoute.id].sort());
    const activities = after.filter(row => row.kind === 'activity');
    assert.ok(activities.every(row => row.payload.routeId === secondRoute.id));
    assert.equal(activities.find(row => row.id === firstActivity.id).payload.trackLocalId, firstActivity.payload.trackLocalId);
    assert.equal(activities.find(row => row.id === secondActivity.id).payload.trackLocalId, secondActivity.payload.trackLocalId);
    assert.deepEqual(await getLocalTrack(firstActivity.payload.trackLocalId), fixtures.get('activity-a.gpx').track);
    assert.deepEqual(await getLocalTrack(secondActivity.payload.trackLocalId), fixtures.get('activity-b.gpx').track);
  });

  await t.test('remount preserves archives and activity tracks, while editor keyboard focus stays inside the dialog', async () => {
    await mount('/admin/debug?preview=1');
    assert.equal(container.querySelectorAll('.admin-debug-group input[type="radio"]').length, 0);
    assert.match(text(container), /路线整理记录/);
    assert.match(text(container.querySelector('.admin-debug-locations')), /合成活动乙/);
    await navigateAdmin('activities');
    const edit = container.querySelector(`button[aria-label="编辑${firstActivity.payload.title}"]`);
    await click(edit);
    await waitFor(() => dialog()?.querySelector('.track-import-result'), 'existing IndexedDB track hydration');
    assert.match(text(dialog().querySelector('.track-import-result')), /activity-a\.gpx/);
    assert.equal(Number(dialog().querySelector('[name="distance"]').value), fixtures.get('activity-a.gpx').track.stats.distanceM / 1000);
    assert.equal(dom.window.document.body.style.overflow, 'hidden');
    const save = button('保存本地草稿', dialog());
    const close = dialog().querySelector('button[aria-label="关闭编辑器"]');
    await act(async () => { save.focus(); save.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })); });
    assert.ok(dom.window.document.activeElement === close, 'Tab from the last control must wrap to the modal close button');
    await act(async () => close.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true })));
    assert.ok(dom.window.document.activeElement === save, 'Shift+Tab from the first control must wrap to the save button');
    await act(async () => save.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    assert.equal(dialog(), null);
    assert.equal(dom.window.document.body.style.overflow, '');
    assert.ok(dom.window.document.activeElement === edit, 'closing must restore focus to the activity edit button');
    assert.deepEqual(requests, ['manual.gpx', 'activity-a.gpx', 'activity-b.gpx']);
    assert.equal(changedEvents, 4, 'each of three saves and the duplicate resolution dispatches one content update');
  });
});

async function seedConcurrentActivities() {
  localStorage.clear();
  let rows = [];
  for (const [id, filename, title] of [['concurrent-a', 'activity-a.gpx', '跨窗活动甲'], ['concurrent-b', 'activity-b.gpx', '跨窗活动乙']]) {
    const track = fixtures.get(filename).track;
    const trackLocalId = await putLocalTrack(track);
    rows = applyActivityTrack(rows, { id, kind: 'activity', published: false, created_at: '2026-10-31T00:00:00Z', payload: { title, routeName: '跨窗共享路线', dateStart: '2026-10-01', status: '已结束', includeFootprint: true, isDemo: false, organizer: 'chuanheng', coordinates: track.location.coordinates, trackLocalId, trackSummary: { name: track.name, stats: track.stats, location: track.location, coordinates: track.location.coordinates, pointCount: track.pointCount, segmentCount: track.segmentCount } } });
  }
  localStorage.setItem('chuanheng-drafts', JSON.stringify(rows));
  const routes = rows.filter(row => row.kind === 'route');
  return { rows, routes, winnerId: routes[1].id, loserId: routes[0].id };
}

function consolidateInAnotherTab(seed) {
  const rows = resolveDuplicateRoutes(drafts(), seed.routes.map(row => row.id), seed.winnerId, { actorId: 'other-tab', now: '2026-10-31T02:00:00Z' });
  const serialized = JSON.stringify(rows);
  localStorage.setItem('chuanheng-drafts', serialized);
  return serialized;
}

test('admin safety regressions preserve concurrent route decisions, links and unknown ascent', async t => {
  await t.test('an open stale activity editor reports a conflict after another tab resolves duplicates', async () => {
    const seed = await seedConcurrentActivities();
    await mount('/admin/activities?preview=1');
    await click(container.querySelector('button[aria-label="编辑跨窗活动甲"]'));
    await waitFor(() => dialog()?.querySelector('.track-import-result'), 'original activity track');
    await fill('description', '未提交的用户编辑内容');
    const serialized = consolidateInAnotherTab(seed);
    await act(async () => dom.window.dispatchEvent(new dom.window.StorageEvent('storage', { key: 'chuanheng-drafts', storageArea: localStorage, newValue: serialized })));
    assert.ok(dialog(), 'refreshing rows must not discard an open editor snapshot');
    assert.equal(dialog().querySelector('[name="description"]').value, '未提交的用户编辑内容');
    await click(button('保存本地草稿', dialog()));
    await waitFor(() => [...container.querySelectorAll('[role="alert"]')].some(element => /冲突|已.*(?:修改|变化)|重新打开/.test(text(element))), 'stale editor conflict message');
    assert.ok(dialog(), 'conflicting edits must remain available for review');
    assert.equal(localStorage.getItem('chuanheng-drafts'), serialized, 'a stale save must not revive the archived loser or remove the audit');
  });

  await t.test('a new record merges into fresh storage even if no storage event was delivered', async () => {
    const seed = await seedConcurrentActivities();
    await mount('/admin/routes?preview=1');
    await click(button('新建路线'));
    await fill('title', '跨窗之后新增路线');
    await fill('distance', '8');
    await fill('ascent', '100');
    consolidateInAnotherTab(seed);
    await saveEditor();
    const rows = drafts();
    assert.equal(rows.find(row => row.id === seed.loserId).payload.archived, true);
    assert.equal(rows.find(row => row.id === seed.winnerId).payload.duplicateResolutions.length, 1);
    assert.ok(rows.find(row => row.payload.title === '跨窗之后新增路线'));
  });

  await t.test('deleting a linked route is rejected without dangling activity references', async () => {
    const seed = await seedConcurrentActivities();
    await mount('/admin/routes?preview=1');
    dom.window.confirm = () => true;
    const before = localStorage.getItem('chuanheng-drafts');
    await click(container.querySelector('button[aria-label="删除跨窗共享路线"]'));
    await waitFor(() => [...container.querySelectorAll('[role="alert"]')].some(element => /关联|引用|无法删除|不能删除/.test(text(element))), 'linked-route deletion rejection');
    assert.equal(localStorage.getItem('chuanheng-drafts'), before);
    assert.ok(drafts().find(row => row.id === seed.routes[0].id));
  });

  await t.test('delete merges fresh rows rather than overwriting another tab audit', async () => {
    const seed = await seedConcurrentActivities();
    localStorage.setItem('chuanheng-drafts', JSON.stringify([...drafts(), { id: 'unlinked-delete', kind: 'route', published: false, payload: { title: '独立将删路线', distance: 1, ascent: null } }]));
    await mount('/admin/routes?preview=1');
    dom.window.confirm = () => { consolidateInAnotherTab(seed); return true; };
    await click(container.querySelector('button[aria-label="删除独立将删路线"]'));
    await waitFor(() => !drafts().find(row => row.id === 'unlinked-delete'), 'unlinked route deletion');
    assert.equal(drafts().find(row => row.id === seed.loserId).payload.archived, true);
    assert.equal(drafts().find(row => row.id === seed.winnerId).payload.duplicateResolutions.length, 1);
    dom.window.confirm = () => true;
  });

  await t.test('archived route rows expose no edit, preview or delete action', async () => {
    const seed = await seedConcurrentActivities();
    consolidateInAnotherTab(seed);
    await mount('/admin/routes?preview=1');
    const archived = [...container.querySelectorAll('.admin-table tbody tr')].find(row => text(row).includes('已归档'));
    assert.ok(archived);
    assert.equal(archived.querySelectorAll('button, a').length, 0);
    assert.match(text(archived), /只读|归档/);
  });

  await t.test('activity deletion archives its unused automatic route while retaining original geometry', async () => {
    const seed = await seedConcurrentActivities();
    const activity = seed.rows.find(row => row.id === 'concurrent-a');
    await mount('/admin/activities?preview=1');
    dom.window.confirm = () => true;
    await click(container.querySelector('button[aria-label="删除跨窗活动甲"]'));
    await waitFor(() => !drafts().find(row => row.id === activity.id), 'activity deletion with linked route archival');
    const automatic = drafts().find(row => row.id === seed.loserId);
    assert.equal(automatic.payload.archived, true);
    assert.equal(automatic.payload.archivedReason, 'activity-track-removed');
    assert.equal(automatic.published, false);
    assert.deepEqual((await getLocalTrack(activity.payload.trackLocalId)).geojson, fixtures.get('activity-a.gpx').track.geojson);
    assert.ok(drafts().find(row => row.id === 'concurrent-b'));
  });

  await t.test('a storage refresh updates the list without replacing unsaved editor values', async () => {
    await seedConcurrentActivities();
    await mount('/admin/activities?preview=1');
    await click(container.querySelector('button[aria-label="编辑跨窗活动甲"]'));
    await waitFor(() => dialog()?.querySelector('.track-import-result'), 'editable existing track');
    await fill('description', '本窗口未保存的说明');
    const latest = drafts().map(row => row.id === 'concurrent-b' ? { ...row, payload: { ...row.payload, title: '另一窗口改过的活动乙' } } : row);
    localStorage.setItem('chuanheng-drafts', JSON.stringify(latest));
    await act(async () => dom.window.dispatchEvent(new dom.window.Event('chuanheng-drafts-updated')));
    assert.match(text(container.querySelector('.admin-table')), /另一窗口改过的活动乙/);
    assert.equal(dialog().querySelector('[name="description"]').value, '本窗口未保存的说明');
    await saveEditor();
    assert.equal(drafts().find(row => row.id === 'concurrent-a').payload.description, '本窗口未保存的说明');
    assert.equal(drafts().find(row => row.id === 'concurrent-b').payload.title, '另一窗口改过的活动乙');
  });

  await t.test('blank manual ascent stays null for new content and after an elevation-less track is removed', async () => {
    localStorage.clear();
    await mount('/admin/routes?preview=1');
    await click(button('新建路线'));
    await fill('title', '未知爬升路线');
    await fill('distance', '8.7');
    assert.equal(dialog().querySelector('[name="ascent"]').value, '', 'unknown ascent must not be presented as a zero value');
    await saveEditor();
    assert.equal(drafts()[0].payload.ascent, null);
    await seedConcurrentActivities();
    await mount('/admin/activities?preview=1');
    await click(container.querySelector('button[aria-label="编辑跨窗活动乙"]'));
    await waitFor(() => dialog()?.querySelector('.track-import-result'), 'elevation-less activity track');
    await click(button('移除', dialog()));
    assert.equal(dialog().querySelector('[name="ascent"]').value, '');
    await saveEditor();
    const activity = drafts().find(row => row.id === 'concurrent-b');
    assert.equal(activity.payload.ascent, null);
    assert.equal(activity.payload.trackLocalId, undefined);
    assert.equal(activity.payload.includeFootprint, false, 'removing the track automatically removes local footprint eligibility');
  });

  await t.test('changing a completed tracked activity back to upcoming automatically removes its local footprint', async () => {
    await seedConcurrentActivities();
    await mount('/admin/activities?preview=1');
    await click(container.querySelector('button[aria-label="编辑跨窗活动乙"]'));
    await waitFor(() => dialog()?.querySelector('.track-import-result'), 'tracked activity to change status');
    await fill('status', '即将开始');
    assert.equal(dialog().querySelector('[name="dateStart"]').required, false);
    await saveEditor();
    const activity = drafts().find(row => row.id === 'concurrent-b');
    assert.equal(activity.payload.includeFootprint, false);
    assert.equal(activity.payload.status, '即将开始');
    assert.ok(activity.payload.trackLocalId, 'the activity keeps its real track even when it is no longer a completed footprint');
  });
});
