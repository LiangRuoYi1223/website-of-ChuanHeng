import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom';
import { build } from 'esbuild';
import { mkdir, mkdtemp, readFile, readdir, realpath, rmdir, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const publicRoot = path.join(projectRoot, 'public');
const artifactsRoot = path.join(projectRoot, 'artifacts');
await mkdir(artifactsRoot, { recursive: true });
const scratch = await mkdtemp(path.join(artifactsRoot, 'render-smoke-'));
const bundlePath = path.join(scratch, 'app.mjs');

after(async () => {
  // Only remove the two test-owned paths; never recursively clean shared artifacts.
  assert.equal(path.dirname(scratch), artifactsRoot);
  await unlink(bundlePath).catch(error => { if (error.code !== 'ENOENT') throw error; });
  await rmdir(scratch);
});

const output = await build({
  stdin: {
    contents: `export { default as App } from './src/App.jsx';
export { CatalogProvider } from './src/catalog.jsx';
export { activities, routes, articles } from './src/data.js';`,
    resolveDir: projectRoot,
    sourcefile: 'render-smoke-entry.jsx',
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
  logLevel: 'silent',
});
await writeFile(bundlePath, output.outputFiles[0].text, 'utf8');
const { App, CatalogProvider, activities, routes, articles } = await import(pathToFileURL(bundlePath).href);
const rendered = new Map();

function renderRoute(location) {
  if (!rendered.has(location)) {
    rendered.set(location, renderToStaticMarkup(createElement(StaticRouter, { location }, createElement(CatalogProvider, null, createElement(App)))));
  }
  return rendered.get(location);
}

function textContent(html) {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function assertUsablePage(location, expected) {
  const html = renderRoute(location);
  const text = textContent(html);
  assert.ok(html.length > 500, `${location}: page should contain real rendered content`);
  assert.match(text, expected, `${location}: expected routed content must be visible`);
  assert.doesNotMatch(text, /\b(?:undefined|null|NaN)\b/, `${location}: incomplete content must have readable fallbacks`);
  let mainDepth = 0;
  for (const match of html.matchAll(/<\/?main\b[^>]*>/gi)) {
    if (match[0].startsWith('</')) mainDepth--;
    else {
      mainDepth++;
      assert.ok(mainDepth <= 1, `${location}: a <main> landmark must not be nested inside another <main>`);
    }
    assert.ok(mainDepth >= 0, `${location}: main landmarks must be balanced`);
  }
  assert.equal(mainDepth, 0, `${location}: main landmarks must be closed`);
  return html;
}

test('all public primary routes render their content without runtime errors or nested main landmarks', async t => {
  const cases = [
    ['/', /以山为衡/],
    ['/activities', /一起，走向山野/],
    ['/routes', /让脚步，丈量山野/],
    ['/gallery', /山野，值得被看见/],
    ['/news', /读山野，也读自己/],
    ['/about', /山野之间，彼此同行/],
    ['/footprints', /每一次出发，都有来路/],
    ['/join', /下一座山/],
  ];
  for (const [location, expected] of cases) await t.test(location, () => assertUsablePage(location, expected));
});

test('every activity, route and article detail can be opened directly', async t => {
  const groups = [['activities', activities], ['routes', routes], ['news', articles]];
  for (const [section, records] of groups) {
    assert.ok(records.length > 0, `${section}: the preview catalog should contain usable sample content`);
    for (const item of records) {
      const location = `/${section}/${item.id}`;
      await t.test(location, () => {
        const html = assertUsablePage(location, new RegExp(item.title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
        assert.match(textContent(html), /示例|设计预览/, `${location}: samples must be clearly identified`);
      });
    }
  }
});

test('invalid detail IDs and unknown pages show a readable recovery instead of crashing', async t => {
  for (const [location, expected] of [
    ['/activities/does-not-exist', /没有找到[^。]*活动/],
    ['/routes/does-not-exist', /没有找到[^。]*路线/],
    ['/news/does-not-exist', /没有找到[^。]*资讯/],
    ['/does-not-exist', /这条路暂时还未开放/],
  ]) await t.test(location, () => {
    const html = assertUsablePage(location, expected);
    assert.match(html, /href="\/(?:activities|routes|news)?"/, `${location}: offer a working return link`);
  });
});

test('all current admin routes render a local preview without requiring cloud access', async t => {
  const sections = [
    ['', /欢迎回来/], ['activities', /活动管理/], ['projects', /项目管理/],
    ['routes', /路线管理/], ['gallery', /影像管理/], ['news', /资讯管理/],
    ['debug', /Debug/], ['backgrounds', /背景管理/],
    ['accounts', /账号管理/], ['services', /服务配置/], ['password', /修改密码/],
  ];
  for (const [section, expected] of sections) {
    const location = `/admin${section ? `/${section}` : ''}?preview=1`;
    await t.test(location, () => {
      const html = assertUsablePage(location, expected);
      assert.match(textContent(html), /本地设计预览/, `${location}: disclose local-only operation`);
      assert.doesNotMatch(textContent(html), /请先登录管理账号/, `${location}: explicitly requested preview must be usable`);
    });
  }
});

test('retired admin URLs retain their intended destination and no longer appear in navigation', async t => {
  for (const [location, expected] of [['/admin/footprints?preview=1', /活动管理/], ['/admin/settings?preview=1', /欢迎回来/]]) {
    await t.test(location, () => {
      const html = assertUsablePage(location, expected);
      assert.match(html, location.includes('/footprints') ? /<h1>活动管理<\/h1>/ : /<h1>欢迎回来[^<]*<\/h1>/, 'the retired URL must render its actual destination heading');
      assert.doesNotMatch(html, /href="\/admin\/(?:footprints|settings)(?:\?|"|\/)/, 'retired management screens must not remain in the sidebar');
      assert.match(html, /href="\/admin\/debug\?preview=1"/, 'Debug must be available from the current navigation');
    });
  }
});

test('login and registration render accessible forms and disclose disconnected authentication', async t => {
  for (const [location, expected] of [['/login', /欢迎回来/], ['/login?mode=register', /开启你的山野之旅/]]) {
    await t.test(location, () => {
      const html = assertUsablePage(location, expected);
      assert.match(html, /type="email"/, `${location}: provide an email field`);
      assert.match(html, /type="password"/, `${location}: initially conceal passwords`);
      assert.match(textContent(html), /认证服务尚未连接/, `${location}: never imply a real authenticated session in the offline preview`);
      assert.doesNotMatch(textContent(html), /账号已注册并登录|登录成功/, `${location}: do not simulate authentication success`);
    });
  }
});

test('sample content and unavailable real history are disclosed where visitors see them', () => {
  for (const location of ['/', '/activities', '/routes']) {
    assert.match(textContent(renderRoute(location)), /示例/, `${location}: sample content requires disclosure`);
  }
  assert.match(textContent(renderRoute('/gallery')), /AI.*示意/, 'the gallery must disclose synthetic imagery');
  const footprints = textContent(renderRoute('/footprints'));
  assert.match(footprints, /尚未载入真实活动地点/, 'empty footprints must not claim completed expeditions');
  assert.match(footprints, /非导航地图/, 'the terrain placeholder must be marked as schematic');
  for (const item of activities) assert.ok(!footprints.includes(item.title), 'sample activities must not become real association footprints');
  const about = textContent(renderRoute('/about'));
  assert.match(about, /成员资料待发布/, 'unknown real members should remain empty');
  assert.match(about, /协会历史正在整理/, 'unknown history should remain empty');
  assert.match(renderRoute('/join'), /id="faq"/, 'the public FAQ link must resolve to a real target');
});

async function sourceFiles(directory) {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await sourceFiles(filename));
    else if (entry.isFile() && /\.(?:css|html)$/.test(entry.name)) result.push(filename);
  }
  return result;
}

test('all rendered static media and CSS image/font paths exist in public', async t => {
  const assetPaths = new Set();
  for (const html of rendered.values()) {
    for (const match of html.matchAll(/\b(?:src|poster|href)="(\/[^"<>\s?]+\.(?:svg|png|webp|jpe?g|gif|woff2?|ttf|pdf)(?:\?[^"<>\s]*)?)"/g)) assetPaths.add(match[1]);
  }
  for (const filename of [...await sourceFiles(path.join(projectRoot, 'src')), path.join(projectRoot, 'index.html')]) {
    const content = await readFile(filename, 'utf8');
    for (const match of content.matchAll(/url\(\s*["']?(\/(?:images|fonts|docs)\/[^"'\s)]+)["']?\s*\)/g)) assetPaths.add(match[1]);
    for (const match of content.matchAll(/\b(?:src|href)="(\/[^"<>\s?]+\.(?:svg|png|webp|jpe?g|gif|woff2?|ttf|pdf)(?:\?[^"<>\s]*)?)"/g)) assetPaths.add(match[1]);
  }
  assert.ok(assetPaths.size > 0, 'the smoke render must exercise actual media assets');
  for (const asset of assetPaths) {
    const pathname = decodeURIComponent(new URL(asset.replaceAll('&amp;', '&'), 'http://localhost').pathname);
    const filename = path.resolve(publicRoot, `.${pathname}`);
    assert.ok(filename.startsWith(`${publicRoot}${path.sep}`), `${asset}: resource must stay inside public`);
    const info = await stat(filename).catch(() => null);
    assert.ok(info?.isFile() && info.size > 0, `${asset}: referenced static resource must exist and be nonempty`);
  }
  t.diagnostic(`${rendered.size} route renders exercised ${assetPaths.size} nonempty local media/font resources.`);
});
