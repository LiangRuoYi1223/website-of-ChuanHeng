import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { build } from 'vite';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const project = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const artifacts = path.join(project, 'artifacts');
await mkdir(artifacts, { recursive: true });
const scratch = await mkdtemp(path.join(artifacts, 'device-trend-test-'));
let Component;
let loadError;
try {
  await build({
    configFile: false, root: project, publicDir: false, logLevel: 'silent',
    build: {
      ssr: 'src/maintenance/DeviceTrendChart.jsx', outDir: scratch, emptyOutDir: false,
      rollupOptions: { output: { entryFileNames: 'component.mjs' } },
    },
  });
  Component = (await import(pathToFileURL(path.join(scratch, 'component.mjs')).href)).default;
} catch (error) { loadError = error; }

function render(props = {}) {
  assert.ifError(loadError);
  return JSDOM.fragment(renderToStaticMarkup(createElement(Component, props)));
}
const statistic = (fragment, name) => fragment.querySelector(`[data-trend-stat="${name}"] dd`).textContent.trim();
const lines = fragment => [...fragment.querySelectorAll('[data-trend-line]')].map(line => line.getAttribute('points'));

after(async () => {
  assert.equal(path.dirname(scratch), artifacts);
  await rm(scratch, { recursive: true });
});

// Catches disconnected history being presented as a zero measurement or invented observation.
test('empty history shows a labelled grid and unknown statistics without a data curve', () => {
  const fragment = render();
  const plot = fragment.querySelector('svg[role="img"]');
  assert.ok(plot);
  assert.match(plot.querySelector('title').textContent, /CPU 使用率.*60 秒/);
  assert.match(plot.querySelector('desc').textContent, /暂无数据/);
  assert.match(fragment.textContent, /等待设备接入/);
  assert.ok(fragment.querySelectorAll('.device-trend-grid line').length > 2);
  assert.match(fragment.querySelector('.device-trend-y-labels').textContent, /100.*%/);
  assert.match(fragment.querySelector('.device-trend-time-axis').textContent, /60.*30.*0/);
  assert.equal(fragment.querySelectorAll('[data-trend-line], [data-trend-area], [data-trend-point]').length, 0);
  assert.equal(statistic(fragment, 'current'), '—');
  assert.equal(statistic(fragment, 'peak'), '—');
});

// Catches a selector changing its label without changing the chart's accessible metric and units.
test('each hardware metric names the chosen measurement and its unit', () => {
  for (const [metric, title, unit] of [
    ['cpu', 'CPU 使用率', '%'], ['memory', '内存使用率', '%'],
    ['temperature', '设备温度', '°C'], ['disk-space', '硬盘空间使用率', '%'],
    ['internet', '网络延迟', 'ms'],
  ]) {
    const fragment = render({ metric });
    const plot = fragment.querySelector('[role="img"]');
    assert.match(plot.querySelector('title').textContent, new RegExp(title));
    assert.ok(plot.querySelector('desc').textContent.includes(unit));
    assert.equal(fragment.querySelector('h2').textContent, title);
  }
});

// Catches plotting by array index, selecting stale samples, or silently discarding a genuine zero.
test('a 60 second window uses real timestamps and preserves zero as a valid measurement', () => {
  const fragment = render({ samples: [
    { timestamp: 100_000, value: 0 }, { timestamp: 69_999, value: 99 },
    { timestamp: 130_000, value: 0 }, { timestamp: 70_000, value: 100 },
  ] });
  assert.deepEqual(lines(fragment), ['0,0 500,300 1000,300']);
  assert.equal(statistic(fragment, 'current'), '0 %');
  assert.equal(statistic(fragment, 'peak'), '100 %');
  assert.equal(fragment.querySelectorAll('[data-trend-area]').length, 1);
  assert.equal(fragment.querySelector('.device-trend-empty'), null);
});

// Catches invalid values being coerced to zero or removed in a way that joins across a data gap.
test('missing or invalid samples break the line instead of being bridged or plotted', () => {
  for (const gap of [null, {}, { value: null }, { value: undefined }, { value: -1 },
    { value: 101 }, { value: NaN }, { value: Infinity }, { value: '40' }]) {
    const missing = gap === null ? null : { timestamp: 100_000, ...gap };
    const fragment = render({ endTime: 130_000, samples: [
      { timestamp: 70_000, value: 10 }, { timestamp: 80_000, value: 20 }, missing,
      { timestamp: 120_000, value: 40 }, { timestamp: 130_000, value: 50 },
    ] });
    const segments = lines(fragment);
    assert.equal(segments.length, 2, `gap ${String(gap?.value)} must remain a break`);
    assert.equal(segments[0].split(' ').length, 2);
    assert.equal(segments[1].split(' ').length, 2);
    assert.equal(statistic(fragment, 'peak'), '50 %');
    assert.doesNotMatch(fragment.textContent, /NaN|undefined|Infinity/);
  }
});

// Catches an explicit viewport end being ignored, including points that are still in the future.
test('an explicit end time clips the window without manufacturing boundary points', () => {
  const fragment = render({ endTime: 130_000, samples: [
    { timestamp: 60_000, value: 99 }, { timestamp: 80_000, value: 25 },
    { timestamp: 120_000, value: 75 }, { timestamp: 140_000, value: 100 },
  ] });
  assert.deepEqual(lines(fragment), ['166.667,225 833.333,75']);
  assert.equal(statistic(fragment, 'current'), '75 %');
  assert.equal(statistic(fragment, 'peak'), '75 %');
});

// Catches single real observations disappearing, or a one-point history becoming a flat line.
test('a single observation is a single point without an invented line or area', () => {
  const fragment = render({ samples: [{ timestamp: 130_000, value: 0 }] });
  assert.equal(fragment.querySelectorAll('[data-trend-line], [data-trend-area]').length, 0);
  const point = fragment.querySelector('[data-trend-point]');
  assert.ok(point);
  assert.equal(point.getAttribute('cx'), '1000');
  assert.equal(point.getAttribute('cy'), '300');
  assert.equal(statistic(fragment, 'current'), '0 %');
});

// Catches assuming every metric is a percentage and rejecting valid temperatures or latencies.
test('temperature and network latency scale to valid measurements above 100', () => {
  for (const [metric, unit] of [['temperature', '°C'], ['internet', 'ms']]) {
    const fragment = render({ metric, samples: [
      { timestamp: 100_000, value: 125 }, { timestamp: 130_000, value: 250 },
    ] });
    assert.equal(lines(fragment).length, 1);
    assert.equal(statistic(fragment, 'current'), `250 ${unit}`);
    assert.equal(statistic(fragment, 'peak'), `250 ${unit}`);
    const coordinates = lines(fragment)[0].split(/[ ,]/).map(Number);
    assert.ok(coordinates.every(Number.isFinite));
    assert.ok(coordinates[1] >= 0 && coordinates[3] >= 0);
  }
});

// Catches malformed histories crashing the panel or treating invalid dates as observations.
test('malformed timestamps and absent histories leave the metrics unknown', () => {
  for (const samples of [null, {}, [{ timestamp: '130000', value: 25 }],
    [{ timestamp: NaN, value: 25 }], [{ timestamp: Infinity, value: 25 }],
    [{ value: 25 }], [{ timestamp: 130_000, value: -1 }]]) {
    const fragment = render({ samples });
    assert.equal(statistic(fragment, 'current'), '—');
    assert.equal(statistic(fragment, 'peak'), '—');
    assert.equal(fragment.querySelectorAll('[data-trend-line], [data-trend-area], [data-trend-point]').length, 0);
  }
});

// Catches network range controls changing their labels while keeping a fixed 60-second viewport.
test('network ranges filter actual samples for a week, month and custom days without adding points', () => {
  const day = 86_400_000;
  const samples = [
    { timestamp: day, value: 999 }, { timestamp: 15 * day, value: 70 },
    { timestamp: 36 * day, value: 50 }, { timestamp: 39 * day, value: 30 },
    { timestamp: 40 * day, value: 20 }, { timestamp: 41 * day, value: 200 },
  ];
  for (const [windowDays, expectedPeak, expectedPoints] of [[7, '50 ms', 3], [30, '70 ms', 4], [3, '30 ms', 2]]) {
    const fragment = render({ metric: 'internet', samples, endTime: 40 * day, windowDays });
    assert.equal(statistic(fragment, 'peak'), expectedPeak);
    assert.equal(statistic(fragment, 'current'), '20 ms');
    assert.equal(lines(fragment).length, 1);
    assert.equal(lines(fragment)[0].split(' ').length, expectedPoints);
    assert.match(fragment.querySelector('svg title').textContent, new RegExp(`最近\\s*${windowDays}\\s*天`));
    assert.ok(fragment.querySelector('.device-trend-time-axis').textContent.includes(`${windowDays}天前`));
  }
  for (const windowDays of [undefined, 0, -1, NaN, Infinity, '3', 1.5]) {
    const fragment = render({ metric: 'internet', samples, endTime: 40 * day, windowDays });
    assert.equal(statistic(fragment, 'peak'), '50 ms');
    assert.doesNotMatch(fragment.textContent, /NaN|undefined|Infinity/);
  }
});
