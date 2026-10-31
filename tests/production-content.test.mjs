import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter, Routes, Route } from 'react-router-dom';
import { build } from 'esbuild';
import { mkdir, mkdtemp, realpath, rmdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const artifactsRoot = path.join(projectRoot, 'artifacts');
await mkdir(artifactsRoot, { recursive: true });
const scratch = await mkdtemp(path.join(artifactsRoot, 'production-content-'));
const bundlePath = path.join(scratch, 'content.mjs');
after(async () => {
  assert.equal(path.dirname(scratch), artifactsRoot);
  await unlink(bundlePath).catch(error => { if (error.code !== 'ENOENT') throw error; });
  await rmdir(scratch);
});
const record = { id: 'synthetic-real', title: '合成正式内容', description: '仅用于本地验证的正式内容形状', image: 'https://assets.invalid/member-photo.webp', published: true, isDemo: false, status: '已结束', category: '行记', body: [{ heading: '行记正文', text: '本地合成文字。' }] };
const output = await build({
  stdin: { contents: "export * from './src/pages/Explore.jsx'; export {setFixture} from './src/catalog.jsx';", resolveDir: projectRoot, sourcefile: 'production-content.jsx', loader: 'jsx' },
  absWorkingDir: projectRoot, bundle: true, write: false, platform: 'node', format: 'esm', target: 'node22', jsx: 'automatic', packages: 'external', loader: { '.css': 'empty' },
  define: { 'import.meta.env': JSON.stringify({ PROD: true, MODE: 'production', VITE_CONTENT_MODE: 'preview' }) }, logLevel: 'silent',
  plugins: [{ name: 'synthetic-published-content', setup(builder) {
    builder.onResolve({ filter: /(?:^|[\\/])catalog\.jsx$/ }, () => ({ path: 'catalog', namespace: 'content-test' }));
    builder.onLoad({ filter: /^catalog$/, namespace: 'content-test' }, () => ({ contents: `export const isPreview=false;let record=${JSON.stringify(record)};export function setFixture(next){record=next}export function useCatalog(){return {activities:[record],routes:[record],photos:[record],articles:[record],loading:false,error:'',refresh:async()=>{}}}`, loader: 'js' }));
  } }],
});

await writeFile(bundlePath, output.outputFiles[0].text, 'utf8');
const pages = await import(pathToFileURL(bundlePath).href);

test('published production records and uploaded photos are not labelled as design examples', async t => {
  for (const [name, route, location] of [
    ['ActivitiesPage', '/activities', '/activities'],
    ['ActivityDetailPage', '/activities/:id', '/activities/synthetic-real'],
    ['RoutesPage', '/routes', '/routes'],
    ['RouteDetailPage', '/routes/:id', '/routes/synthetic-real'],
    ['GalleryPage', '/gallery', '/gallery'],
    ['NewsPage', '/news', '/news'],
    ['ArticlePage', '/news/:id', '/news/synthetic-real'],
  ]) await t.test(name, () => {
    const html = renderToStaticMarkup(createElement(StaticRouter, { location }, createElement(Routes, null, createElement(Route, { path: route, element: createElement(pages[name]) }))));
    assert.match(html, /合成正式内容/);
    assert.ok(!/示例文章|示例编辑内容|全部为示例路线|>示例路线<|本页为 AI 示意影像|非协会实拍记录|设计预览 · 活动与路线为示例/.test(html), 'published content must not be mislabelled as preview material');
    assert.ok(!/<span class="explore-(?:image|photo)-label">(?:AI )?示意影像[^<]*<\/span>/.test(html), 'a supplied image must not inherit the bundled fallback image disclosure');
  });
});

test('bundled AI covers and missing-image fallbacks keep their illustration disclosure in production', () => {
  for (const image of ['', '/images/redesign-v2/home-summit.webp']) {
    pages.setFixture({ ...record, image });
    const html = renderToStaticMarkup(createElement(StaticRouter, { location: '/gallery' }, createElement(pages.GalleryPage)));
    assert.ok(/<span class="explore-photo-label">AI 示意影像<\/span>/.test(html), 'a bundled AI image must retain its disclosure');
    assert.ok(!html.includes('本页为 AI 示意影像'), 'a fallback cover must not mislabel the entire published catalog');
  }
  pages.setFixture(record);
});
