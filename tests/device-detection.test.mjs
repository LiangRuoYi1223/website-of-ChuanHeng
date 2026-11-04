import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { act, createElement } from 'react';
import { JSDOM } from 'jsdom';
import { build } from 'vite';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const project = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const artifacts = path.join(project, 'artifacts');
await mkdir(artifacts, { recursive: true });
const scratch = await mkdtemp(path.join(artifacts, 'device-detection-test-'));
const dom = new JSDOM('<!doctype html><div id="app"></div>', { url: 'https://frontend.invalid/admin/device-detection', pretendToBeVisual: true });
const originals = new Map();
function installGlobal(key, value) {
  originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
}
for (const key of ['window', 'document', 'navigator', 'HTMLElement', 'Event', 'MouseEvent']) {
  installGlobal(key, key === 'window' ? dom.window : key === 'document' ? dom.window.document : dom.window[key]);
}
installGlobal('IS_REACT_ACT_ENVIRONMENT', true);
const { createRoot } = await import('react-dom/client');
const container = document.getElementById('app');
let root;
let Component;
let loadError;
try {
  await build({
    configFile: false,
    root: project,
    publicDir: false,
    logLevel: 'silent',
    build: {
      ssr: 'src/maintenance/DeviceDetection.jsx',
      outDir: scratch,
      emptyOutDir: false,
      rollupOptions: { output: { entryFileNames: 'component.mjs' } },
    },
  });
  Component = (await import(pathToFileURL(path.join(scratch, 'component.mjs')).href)).default;
} catch (error) { loadError = error; }

async function mount() {
  assert.ifError(loadError);
  if (root) await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () => root.render(createElement(Component)));
}
const filters = () => [...container.querySelectorAll('[aria-label="维护计划频率"] button')];
const filter = label => filters().find(button => button.textContent.trim() === label);
async function click(button) {
  assert.ok(button, '维护计划频率必须提供可用按钮');
  await act(async () => { button.focus(); button.click(); });
}

after(async () => {
  if (root) await act(async () => root.unmount());
  dom.window.close();
  for (const [key, descriptor] of originals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else delete globalThis[key];
  }
  assert.equal(path.dirname(scratch), artifacts);
  await rm(scratch, { recursive: true });
});

// Catches a disconnected panel presenting fabricated observations as live results.
test('device detection keeps all live measurements unknown until a device is connected', async () => {
  await mount();
  const connection = container.querySelector('[aria-label="设备连接状态"]');
  assert.ok(connection);
  assert.match(connection.textContent, /未接入/);
  assert.match(connection.textContent, /最近检测\s*—/);
  const table = container.querySelector('table[aria-label="设备与服务检测项"]');
  assert.ok(table);
  const rows = [...table.tBodies[0].rows];
  assert.ok(rows.length >= 10, '硬件、网络、关键业务与资料保护均需要检测项');
  for (const row of rows) {
    assert.equal(row.querySelector('[data-metric-value]').textContent.trim(), '—');
    assert.equal(row.querySelector('[data-metric-status]').textContent.trim(), '等待接入');
  }
  assert.equal(container.querySelectorAll('progress, meter').length, 0, '未知使用率不能显示为零值');
});

// Catches a broken state change that leaves unrelated maintenance tasks visible.
test('maintenance offers only activity, monthly and occasional plans below the monitoring area', async () => {
  await mount();
  assert.deepEqual(filters().map(button => button.textContent.trim()), ['每场活动', '每月', '不定期']);
  assert.equal(filter('每场活动').getAttribute('aria-pressed'), 'true');
  const monitoring = container.querySelector('[aria-label="设备监测"]');
  const maintenance = container.querySelector('[aria-label="日常维护计划"]');
  assert.ok(monitoring && maintenance);
  assert.equal(monitoring.contains(maintenance), false, 'maintenance must be outside the side-by-side monitoring area');
  assert.ok(monitoring.compareDocumentPosition(maintenance) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
  for (const [label, frequency] of [['每场活动', 'activity'], ['每月', 'monthly'], ['不定期', 'as-needed']]) {
    await click(filter(label));
    const groups = [...container.querySelectorAll('[data-maintenance-frequency]')];
    assert.equal(groups.length, 1);
    assert.equal(groups[0].dataset.maintenanceFrequency, frequency);
    assert.equal(filter(label).getAttribute('aria-pressed'), 'true');
    assert.equal(filters().filter(button => button.getAttribute('aria-pressed') === 'true').length, 1);
    assert.equal(document.activeElement, filter(label));
  }
  assert.ok(filters().every(button => button.type === 'button'));
});

test('choosing a hardware metric changes the adjacent trend without inventing observations', async () => {
  await mount();
  const memory = container.querySelector('button[aria-label="查看内存使用情况趋势"]');
  assert.ok(memory);
  await click(memory);
  assert.equal(memory.getAttribute('aria-pressed'), 'true');
  const trend = container.querySelector('[aria-label="性能趋势"]');
  assert.ok(trend);
  assert.match(trend.textContent, /内存/);
  assert.match(trend.textContent, /暂无数据/);
  assert.equal(trend.querySelectorAll('[data-trend-line]').length, 0, 'disconnected history must not be a fabricated zero or sample line');
});

test('network observation offers week, month and validated custom day counts', async () => {
  await mount();
  await click(container.querySelector('button[aria-label="查看外网连通趋势"]'));
  const scope = container.querySelector('[aria-label="网络观察范围"]');
  assert.ok(scope);
  const rangeButton = label => [...scope.querySelectorAll('button')].find(button => button.textContent.trim() === label);
  const trend = () => container.querySelector('[aria-label="性能趋势"]');
  assert.match(trend().textContent, /7\s*天/);
  await click(rangeButton('一月'));
  assert.match(trend().textContent, /30\s*天/);
  await click(rangeButton('自定义'));
  const input = scope.querySelector('input[aria-label="观测天数"]');
  assert.ok(input);
  for (const value of ['', '0', '-2', '1.5', 'abc', '99999999999999999999']) {
    await act(async () => { input.value = value; input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
    await click(rangeButton('应用'));
    assert.ok(scope.querySelector('[role="alert"]'), `invalid days ${value} must be explained`);
    assert.match(trend().textContent, /30\s*天/, 'invalid input must not replace the last applied window');
  }
  await act(async () => { input.value = '14'; input.dispatchEvent(new dom.window.Event('input', { bubbles: true })); });
  await click(rangeButton('应用'));
  assert.equal(scope.querySelector('[role="alert"]'), null);
  assert.match(trend().textContent, /14\s*天/);
  await click(rangeButton('一周'));
  assert.match(trend().textContent, /7\s*天/);
  assert.match(trend().textContent, /暂无数据/);
});

// Catches accidental integration with cloud services or private browser data.
test('rendering and changing maintenance filters make no network or storage accesses', async () => {
  const attempts = [];
  const blocked = name => () => { attempts.push(name); throw new Error(`Unexpected access: ${name}`); };
  const restore = [];
  function block(target, key, descriptor) {
    const original = Object.getOwnPropertyDescriptor(target, key);
    Object.defineProperty(target, key, { configurable: true, ...descriptor });
    restore.push(() => original ? Object.defineProperty(target, key, original) : delete target[key]);
  }
  for (const target of [globalThis, dom.window]) {
    for (const key of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource']) block(target, key, { value: blocked(key), writable: true });
    for (const key of ['localStorage', 'sessionStorage', 'indexedDB']) block(target, key, { get: blocked(key) });
  }
  try {
    await mount();
    for (const button of filters()) await click(button);
    for (const button of container.querySelectorAll('button[data-trend-metric]')) await click(button);
    assert.deepEqual(attempts, []);
  } finally { for (const undo of restore.reverse()) undo(); }
});
