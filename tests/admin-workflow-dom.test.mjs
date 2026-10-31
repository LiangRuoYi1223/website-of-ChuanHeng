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
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Element', 'HTMLInputElement', 'HTMLSelectElement', 'FileReader', 'FormData', 'File', 'Blob', 'Event', 'MouseEvent', 'KeyboardEvent']) installGlobal(key, key === 'window' ? dom.window : key === 'document' ? dom.window.document : key === 'navigator' ? dom.window.navigator : dom.window[key]);
installGlobal('localStorage', dom.window.localStorage);
installGlobal('IS_REACT_ACT_ENVIRONMENT', true);
// JSDOM has no layout. Supply nonzero rectangles only for the focus-trap check;
// this is not a screenshot or a claim about rendered geometry.
dom.window.HTMLElement.prototype.getClientRects = function () { return this.hidden || this.closest('[aria-hidden="true"]') ? [] : [new dom.window.DOMRect(0, 0, 20, 20)]; };

const { createRoot } = await import('react-dom/client');
const { MemoryRouter, useNavigate } = await import('react-router-dom');
let navigateWithinTest;
function NavigationHandle(){navigateWithinTest=useNavigate();return null;}
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
  await act(async () => root.render(createElement(MemoryRouter, { initialEntries: [location] }, createElement(AdminPage),createElement(NavigationHandle))));
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
  const request = pending.findLast(item => item.filename === filename);
  assert.ok(request);
  await act(async () => request.release());
  await waitFor(() => dialog()?.querySelector('.track-import-result'), 'converted track preview');
}
async function saveEditor() {
  await click(button('保存本地草稿', dialog()));
  await waitFor(() => !dialog(), 'the saved editor to close');
}

test('route uploads are reused by activity selection, with frozen history and refresh preserving edits', async t => {
  localStorage.clear();
  let route, firstActivity;
  await t.test('route editor remains the sole upload entry and stores derived summary outside geometry', async () => {
    await mount('/admin/routes?preview=1');
    await click(button('新建路线'));
    await fill('title', '共享山野路线');
    await chooseFile('manual.gpx');
    assert.equal(button('保存本地草稿', dialog()).disabled, true);
    await releaseFile('manual.gpx');
    await saveEditor();
    route = drafts().find(row => row.kind === 'route');
    assert.ok(route.payload.trackLocalId);
    assert.equal(route.payload.track, undefined);
    assert.deepEqual(route.payload.trackSummary.stats, fixtures.get('manual.gpx').track.stats);
    assert.equal(route.payload.locationStatus, 'matched');
  });
  await t.test('activity has four datetime fields, no track upload and refresh retains typed input and selection', async () => {
    await navigateAdmin('activities');
    await click(button('新建活动'));
    await fill('title', '路线选择活动甲');
    await fill('description', '刷新前未提交的介绍');
    for (const name of ['dateStart', 'dateEnd', 'registrationStart', 'registrationDeadline']) assert.equal(dialog().querySelector(`[name="${name}"]`).type, 'datetime-local');
    assert.ok(![...dialog().querySelectorAll('input[type="file"]')].some(input => /gpx|kml/i.test(input.accept)), 'activity never exposes a track upload');
    assert.equal(dialog().querySelector('[name="routeName"]'), null);
    const manage = [...dialog().querySelectorAll('a')].find(link => text(link).includes('打开路线管理'));
    assert.equal(manage.target, '_blank');
    assert.equal(manage.getAttribute('href'), '/admin/routes?preview=1');
    await fill('routeId', route.id);
    await fill('dateStart', '2026-10-01T08:00');
    await fill('dateEnd', '2026-10-01T18:00');
    await fill('status', '已结束');
    const added = { id: 'another-route', kind: 'route', published: false, payload: { title: '另一个窗口新增路线', distance: 1, ascent: null } };
    localStorage.setItem('chuanheng-drafts', JSON.stringify([...drafts(), added]));
    await click(button('刷新路线列表', dialog()));
    assert.match(text(dialog().querySelector('[name="routeId"]')), /另一个窗口新增路线/);
    assert.equal(dialog().querySelector('[name="description"]').value, '刷新前未提交的介绍');
    assert.equal(dialog().querySelector('[name="dateStart"]').value, '2026-10-01T08:00');
    assert.equal(dialog().querySelector('[name="routeId"]').value, route.id);
    assert.equal(dialog().querySelector('[name="distance"]'), null);
    assert.ok(dialog().querySelector('.admin-track-metrics dd'));
    await saveEditor();
    firstActivity = drafts().find(row => row.kind === 'activity');
    assert.equal(firstActivity.payload.routeSnapshot.sourceRouteId, route.id);
    assert.equal(firstActivity.payload.routeSnapshot.trackLocalId, route.payload.trackLocalId);
    assert.equal(drafts().filter(row => row.kind === 'route').length, 2, 'activity save creates no route');
  });
  await t.test('two activities reuse one route while existing activity version stays frozen after route edit', async () => {
    await click(button('新建活动'));
    await fill('title', '路线选择活动乙');
    await fill('routeId', route.id);
    await saveEditor();
    assert.equal(drafts().filter(row => row.kind === 'activity' && row.payload.routeId === route.id).length, 2);
    const latest = drafts().map(row => row.id === route.id ? { ...row, payload: { ...row.payload, distance: 999 } } : row);
    localStorage.setItem('chuanheng-drafts', JSON.stringify(latest));
    await click(container.querySelector('button[aria-label="编辑路线选择活动甲"]'));
    await click(button('刷新路线列表', dialog()));
    assert.notEqual(text(dialog().querySelector('.admin-track-metrics dd')), '999');
    await fill('description', '保留历史版本');
    await saveEditor();
    assert.deepEqual(drafts().find(row => row.id === firstActivity.id).payload.routeSnapshot, firstActivity.payload.routeSnapshot);
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
    await waitFor(() => dialog()?.querySelector('.admin-legacy-track'), 'original activity track');
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
    await waitFor(() => dialog()?.querySelector('.admin-legacy-track'), 'editable existing track');
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

  await t.test('blank manual route ascent stays null and legacy activity track is read only', async () => {
    localStorage.clear();
    await mount('/admin/routes?preview=1');
    await click(button('新建路线'));
    await fill('title', '未知爬升路线');
    await fill('distance', '8.7');
    assert.equal(dialog().querySelector('[name="ascent"]').value, '');
    await saveEditor();
    assert.equal(drafts()[0].payload.ascent, null);
    await seedConcurrentActivities();
    await mount('/admin/activities?preview=1');
    await click(container.querySelector('button[aria-label="编辑跨窗活动乙"]'));
    await waitFor(() => dialog()?.querySelector('.admin-legacy-track'), 'legacy track read');
    assert.ok(![...dialog().querySelectorAll('input[type="file"]')].some(input => /gpx|kml/i.test(input.accept)), 'activity never exposes a track upload');
    assert.equal(button('移除', dialog()), undefined);
    assert.equal(dialog().querySelector('[name="ascent"]'), null);
    assert.match(text(dialog().querySelector('.admin-track-metrics')), /暂不提供数据/);
    const original = drafts().find(row => row.id === 'concurrent-b').payload;
    await saveEditor();
    const activity = drafts().find(row => row.id === 'concurrent-b');
    assert.equal(activity.payload.trackLocalId, original.trackLocalId);
    assert.equal(activity.payload.dateStart, '2026-10-01', 'unknown legacy time is not fabricated');
    assert.equal(Object.hasOwn(activity.payload, 'dateEnd'), false, 'legacy missing keys remain absent');
    assert.equal(activity.payload.ascent, null);
  });

  await t.test('legacy activity shows its historical metrics rather than the current linked route version', async () => {
    const seed = await seedConcurrentActivities();
    localStorage.setItem('chuanheng-drafts', JSON.stringify(seed.rows.map(row => row.id === seed.loserId ? { ...row, payload: { ...row.payload, distance: 999, ascent: 999, location: '后来修改的地点' } } : row)));
    await mount('/admin/activities?preview=1');
    await click(container.querySelector('button[aria-label="编辑跨窗活动甲"]'));
    await waitFor(() => dialog()?.querySelector('.admin-legacy-track'), 'historical activity track');
    assert.equal(Number(text(dialog().querySelector('.admin-track-metrics dd'))), fixtures.get('activity-a.gpx').track.stats.distanceM / 1000);
    assert.notEqual(dialog().querySelector('[name="location"]').value, '后来修改的地点');
  });

  await t.test('missing legacy track blocks save without exposing track removal or track upload', async () => {
    localStorage.setItem('chuanheng-drafts', JSON.stringify([{ id: 'missing-track', kind: 'activity', published: false, payload: { title: '丢失轨迹活动', dateStart: '2026-10-01', trackLocalId: 'not-in-indexeddb' } }]));
    await mount('/admin/activities?preview=1');
    await click(container.querySelector('button[aria-label="编辑丢失轨迹活动"]'));
    await waitFor(() => dialog()?.querySelector('.admin-track-load-error'), 'legacy track failure protection');
    assert.equal(button('保存本地草稿', dialog()).disabled, true);
    assert.ok(button('重试读取', dialog()));
    assert.equal(button('移除旧轨迹引用', dialog()), undefined);
    assert.ok(![...dialog().querySelectorAll('input[type="file"]')].some(input => /gpx|kml/i.test(input.accept)), 'activity never exposes a track upload');
    const before = localStorage.getItem('chuanheng-drafts');
    await act(async () => dialog().querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })));
    assert.equal(localStorage.getItem('chuanheng-drafts'), before);
  });

  await t.test('selected route updated in another tab rejects save and retains unsaved text', async () => {
    await seedConcurrentActivities();
    await mount('/admin/activities?preview=1');
    await click(button('新建活动'));
    await fill('title', '路线过期选择');
    await fill('description', '不可丢失的填写内容');
    const selected = drafts().find(row => row.kind === 'route');
    await fill('routeId', selected.id);
    const changed = drafts().map(row => row.id === selected.id ? { ...row, payload: { ...row.payload, title: '另一窗口更新路线' } } : row);
    localStorage.setItem('chuanheng-drafts', JSON.stringify(changed));
    const before = localStorage.getItem('chuanheng-drafts');
    await click(button('保存本地草稿', dialog()));
    assert.match(text(dialog()), /所选路线已被更新/);
    assert.equal(dialog().querySelector('[name="description"]').value, '不可丢失的填写内容');
    assert.equal(localStorage.getItem('chuanheng-drafts'), before);
  });

  await t.test('past booking cutoff can be saved and time order errors retain the form', async () => {
    localStorage.clear();
    await mount('/admin/activities?preview=1');
    await click(button('新建活动'));
    await fill('title', '历史报名窗口');
    await fill('dateStart', '2026-01-02T08:00');
    await fill('dateEnd', '2026-01-02T18:00');
    await fill('registrationStart', '2026-01-01T08:00');
    await fill('registrationDeadline', '2026-01-02T08:00');
    await click(dialog().querySelector('[name="registrationOpen"]'));
    await saveEditor();
    assert.equal(drafts()[0].payload.registrationOpen, true);
    await click(container.querySelector('button[aria-label="编辑历史报名窗口"]'));
    await fill('dateEnd', '2026-01-02T07:00');
    await click(button('保存本地草稿', dialog()));
    assert.match(text(dialog()), /活动结束时间必须晚于开始时间/);
    const save = button('保存本地草稿', dialog());
    const close = dialog().querySelector('button[aria-label="关闭编辑器"]');
    await act(async () => { save.focus(); save.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })); });
    assert.equal(dom.window.document.activeElement, close);
    await act(async () => close.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    assert.equal(dialog(), null);
  });

  await t.test('activity cover upload blocks submission until ready then persists the selected image', async () => {
    localStorage.clear();
    await mount('/admin/activities?preview=1');
    await click(button('新建活动'));
    await fill('title', '单独封面活动');
    let releaseCover;
    const OriginalReader = globalThis.FileReader;
    globalThis.FileReader = class extends OriginalReader {
      readAsDataURL(file) { releaseCover = () => super.readAsDataURL(file); }
    };
    try {
      const input = dialog().querySelector('input[type="file"]');
      assert.ok(input && /image|png|jpe?g|webp/i.test(input.accept));
      const file = new dom.window.File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'synthetic-cover.png', { type: 'image/png' });
      Object.defineProperty(input, 'files', { configurable: true, value: [file] });
      await act(async () => input.dispatchEvent(new dom.window.Event('change', { bubbles: true })));
      await waitFor(() => releaseCover, 'cover reader start');
      assert.equal(dialog().querySelector('.admin-form-actions .primary').disabled, true);
      const before = localStorage.getItem('chuanheng-drafts');
      await act(async () => dialog().querySelector('form').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })));
      assert.equal(localStorage.getItem('chuanheng-drafts'), before);
      await act(async () => releaseCover());
      await waitFor(() => dialog()?.querySelector('[name="image"]')?.value.startsWith('data:image/png;base64,'), 'cover image ready');
      await saveEditor();
      assert.match(drafts()[0].payload.image, /^data:image\/png;base64,/);
      assert.equal(drafts()[0].payload.track, undefined, 'cover image is independent of the activity route');
    } finally { globalThis.FileReader = OriginalReader; }
  });

  await t.test('changing a completed tracked activity back to upcoming automatically removes its local footprint', async () => {
    await seedConcurrentActivities();
    await mount('/admin/activities?preview=1');
    await click(container.querySelector('button[aria-label="编辑跨窗活动乙"]'));
    await waitFor(() => dialog()?.querySelector('.admin-legacy-track'), 'tracked activity to change status');
    await fill('status', '即将开始');
    assert.equal(dialog().querySelector('[name="dateStart"]').required, false);
    await saveEditor();
    const activity = drafts().find(row => row.id === 'concurrent-b');
    assert.equal(activity.payload.includeFootprint, true, 'track/date preserve footprint permission');
    assert.equal(getFootprints([{ ...activity.payload, id: activity.id, localDraft: true }], { allowLocalPreview: true }).length, 0, 'upcoming legacy activity does not display a footprint');
    assert.equal(activity.payload.status, '即将开始');
    assert.ok(activity.payload.trackLocalId, 'the activity keeps its real track even when it is no longer a completed footprint');
  });
});


test('missing metric dialog preserves prior track on cancel, supports skip and administrator zero without replacing automatic distance',async()=>{
 localStorage.clear();await mount('/admin/routes?preview=1');await click(button('新建路线'));await fill('title','参数补充测试');
 await chooseFile('manual.gpx');await releaseFile('manual.gpx');
 const oldName=text(dialog().querySelector('.track-import-result strong'));
 async function uploadMissing(){
   await chooseFile('activity-b.gpx');const request=pending.findLast(item=>item.filename==='activity-b.gpx');
   await act(async()=>request.release());await waitFor(()=>dialog()?.querySelector('.track-metrics-dialog'),'missing metrics dialog');
   assert.equal(button('保存本地草稿',dialog()).disabled,true);
   assert.equal(dialog().querySelector('.track-metrics-dialog input').readOnly,true);
   assert.equal(document.activeElement,dialog().querySelector('.track-metrics-dialog input:not([readonly])'));
 }
 await uploadMissing();
 await act(async()=>document.activeElement.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true})));
 assert.ok(dialog(),'Escape closes only the supplement dialog');assert.equal(dialog().querySelector('.track-metrics-dialog'),null);
 assert.equal(text(dialog().querySelector('.track-import-result strong')),oldName);
 await uploadMissing();await click(button('暂不提供',dialog()));
 assert.match(text(dialog().querySelector('.track-import-result strong')),/合成活动乙/);
 assert.equal(button('保存本地草稿',dialog()).disabled,false);
 await click(button('补充缺失路线参数',dialog()));
 const input=dialog().querySelector('.track-metrics-dialog input:not([readonly])');
 await act(async()=>{Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype,'value').set.call(input,'0');input.dispatchEvent(new dom.window.Event('input',{bubbles:true}));});
 await click(button('确认补充',dialog()));await saveEditor();
 const saved=drafts()[0].payload;
 assert.equal(saved.ascent,0);assert.equal(saved.trackSummary.stats.ascentM,null);assert.equal(saved.trackSummary.manualMetrics.ascentM,0);
 assert.equal(saved.distance,fixtures.get('activity-b.gpx').track.stats.distanceM/1000);
});



test('Debug edit link opens exactly the requested route once; closing and refreshing never reopens it',async()=>{
 localStorage.clear();localStorage.setItem('chuanheng-drafts',JSON.stringify([{id:'debug-edit-route',kind:'route',published:false,payload:{title:'Debug待补参数路线',distance:2,ascent:null}}]));
 await mount('/admin/debug?preview=1');
 const link=container.querySelector('a[href="/admin/routes?preview=1&edit=debug-edit-route"]');assert.ok(link);
 await click(link);await waitFor(()=>dialog(),'Debug requested route editor');
 assert.equal(dialog().querySelector('[name="title"]').value,'Debug待补参数路线');
 await fill('description','应保留的输入');
 await act(async()=>window.dispatchEvent(new dom.window.StorageEvent('storage',{key:'chuanheng-drafts'})));
 assert.equal(dialog().querySelector('[name="description"]').value,'应保留的输入');
 await click(button('取消',dialog()));assert.equal(dialog(),null);
 await act(async()=>window.dispatchEvent(new dom.window.StorageEvent('storage',{key:'chuanheng-drafts'})));assert.equal(dialog(),null);
});
test('route edit requests reject missing, archived and demo routes, and other sections never edit arbitrary routes',async()=>{
 localStorage.clear();localStorage.setItem('chuanheng-drafts',JSON.stringify([{id:'archived-deep',kind:'route',payload:{title:'归档路线',archived:true}},{id:'demo-deep',kind:'route',payload:{title:'示例路线',isDemo:true}}]));
 for(const [url,message] of [['/admin/routes?preview=1&edit=missing-deep',/不存在/],['/admin/routes?preview=1&edit=archived-deep',/归档/],['/admin/routes?preview=1&edit=demo-deep',/示例/]]){
  await mount(url);await waitFor(()=>message.test(text(container)),'invalid route request notice');assert.equal(dialog(),null);
 }
 await mount('/admin/activities?preview=1&edit=archived-deep');assert.equal(dialog(),null);
});

test('a second route edit URL cannot replace an open form or lose unsaved text',async()=>{
 localStorage.clear();localStorage.setItem('chuanheng-drafts',JSON.stringify(['one','two'].map(id=>({id,kind:'route',payload:{title:`路线${id}`,distance:1,ascent:null}}))));
 await mount('/admin/routes?preview=1&edit=one');await waitFor(()=>dialog(),'first requested route');await fill('description','尚未保存的说明');
 await act(async()=>navigateWithinTest('/admin/routes?preview=1&edit=two'));
 assert.equal(dialog().querySelector('[name="title"]').value,'路线one');assert.equal(dialog().querySelector('[name="description"]').value,'尚未保存的说明');
 assert.match(text(dialog()),/请先保存或关闭编辑器/);
 await click(button('取消',dialog()));assert.equal(dialog(),null);
 await act(async()=>navigateWithinTest('/admin/routes?preview=1&edit=two'));
 await waitFor(()=>dialog(),'explicit second route request after closing');assert.equal(dialog().querySelector('[name="title"]').value,'路线two');
});
