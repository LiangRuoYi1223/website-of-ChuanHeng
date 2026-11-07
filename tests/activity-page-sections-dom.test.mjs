import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { mkdir, mkdtemp, realpath, rmdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const artifactsRoot = path.join(projectRoot, 'artifacts'); await mkdir(artifactsRoot, { recursive: true });
const scratch = await mkdtemp(path.join(artifactsRoot, 'activity-page-sections-test-'));
const bundlePath = path.join(scratch, 'sections.mjs');
const output = await build({ stdin: { contents: "export {default} from './src/activities/ActivityPageSections.jsx';", resolveDir: projectRoot, loader: 'jsx' }, absWorkingDir: projectRoot, bundle: true, write: false, platform: 'node', format: 'esm', jsx: 'automatic', packages: 'external', loader: { '.css': 'empty' }, logLevel: 'silent' });
await writeFile(bundlePath, output.outputFiles[0].text, 'utf8');
const { default: ActivityPageSections } = await import(pathToFileURL(bundlePath).href);
after(async () => { await unlink(bundlePath); await rmdir(scratch); });

function render(item) {
  return new JSDOM(renderToStaticMarkup(createElement(ActivityPageSections, { item, trackContent: createElement('p', { 'data-track': true }, '历史轨迹快照') })));
}

test('public page renders custom copy, arbitrary item counts, and the separate frozen track content', () => {
  const dom = render({ description: '正式简介', pageContent: {
    overview: { title: '认识本次活动', body: '第一行\n第二行', noteTitle: '集合说明', noteBody: '南门集合' },
    itinerary: { title: '当日安排', intro: '请准时', items: [{ time: '08:00', title: '出发', description: '按安排出发' }] },
    equipment: { title: '随身装备', intro: '', items: Array.from({ length: 5 }, (_, index) => ({ title: `模块${index}`, description: `装备${index}` })) },
    safety: { title: '风险说明', items: ['撤退点另行确认', '保持队伍节奏'], outro: '请阅读领队通知' },
  } });
  const document = dom.window.document;
  assert.equal(document.querySelector('#activity-overview h2').textContent, '认识本次活动');
  assert.equal(document.querySelector('.explore-lead').textContent, '正式简介');
  assert.ok(document.querySelector('#activity-overview').textContent.includes('第一行\n第二行'));
  assert.equal(document.querySelectorAll('.explore-timeline-number').length, 1);
  assert.equal(document.querySelector('.explore-timeline-number').textContent, '01');
  assert.equal(document.querySelectorAll('.explore-equipment-grid>div').length, 5);
  assert.deepEqual([...document.querySelectorAll('.explore-safety-list li')].map(item => item.textContent), ['撤退点另行确认', '保持队伍节奏']);
  assert.equal(document.querySelector('#activity-track [data-track]').textContent, '历史轨迹快照');
  assert.ok(!document.body.textContent.includes('充分准备'));
  dom.window.close();
});

test('removing every list or notice keeps it removed and never interprets copy as HTML', () => {
  const attack = '<img src=x onerror=alert(1)>';
  const dom = render({ description: '', pageContent: { overview: { body: attack, noteTitle: '', noteBody: '' }, itinerary: { items: [] }, equipment: { items: [] }, safety: { items: [], outro: '' } } });
  const document = dom.window.document;
  assert.equal(document.querySelector('.explore-timeline'), null);
  assert.equal(document.querySelector('.explore-equipment-grid'), null);
  assert.equal(document.querySelector('.explore-safety-list'), null);
  assert.equal(document.querySelector('.explore-note'), null);
  assert.equal(document.querySelector('img'), null);
  assert.ok(document.querySelector('#activity-overview').textContent.includes(attack));
  dom.window.close();
});
