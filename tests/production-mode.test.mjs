import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom';
import { build } from 'esbuild';
import { mkdir, mkdtemp, realpath, rmdir, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = await realpath(fileURLToPath(new URL('../', import.meta.url)));
const artifactsRoot = path.join(projectRoot, 'artifacts');
await mkdir(artifactsRoot, { recursive: true });
const scratch = await mkdtemp(path.join(artifactsRoot, 'production-mode-'));
const bundlePath = path.join(scratch, 'app.mjs');
after(async () => {
  assert.equal(path.dirname(scratch), artifactsRoot);
  await unlink(bundlePath).catch(error => { if (error.code !== 'ENOENT') throw error; });
  await rmdir(scratch);
});
const output = await build({
  stdin: { contents: "export {AdminPage,LoginPage} from './src/pages/Admin.jsx'; export {CatalogProvider,useCatalog,isPreview} from './src/catalog.jsx';", resolveDir: projectRoot, sourcefile: 'production-mode.jsx', loader: 'jsx' },
  absWorkingDir: projectRoot, bundle: true, write: false, platform: 'node', format: 'esm', target: 'node22', jsx: 'automatic', packages: 'external', loader: { '.css': 'empty' },
  // A production build must fail closed even if a copied .env still says preview.
  define: { 'import.meta.env': JSON.stringify({ PROD: true, DEV: false, MODE: 'production', VITE_CONTENT_MODE: 'preview' }) }, logLevel: 'silent',
});
await writeFile(bundlePath, output.outputFiles[0].text, 'utf8');
const { AdminPage, LoginPage, CatalogProvider, useCatalog, isPreview } = await import(pathToFileURL(bundlePath).href);
const render = (Component, location) => renderToStaticMarkup(createElement(StaticRouter, { location }, createElement(Component)));

test('production catalog cannot fall back to fictional samples or local footprint previews', () => {
  assert.equal(isPreview, false);
  function Counts() {
    const catalog = useCatalog();
    return createElement('output', null, JSON.stringify({ activities: catalog.activities.length, routes: catalog.routes.length, photos: catalog.photos.length, articles: catalog.articles.length, localFootprintPreview: catalog.localFootprintPreview }));
  }
  const html = renderToStaticMarkup(createElement(CatalogProvider, null, createElement(Counts)));
  assert.match(html, /&quot;activities&quot;:0/);
  assert.match(html, /&quot;routes&quot;:0/);
  assert.match(html, /&quot;localFootprintPreview&quot;:false/);
});

test('production admin ignores preview=1 and exposes no disconnected local CRUD controls', () => {
  const html = render(AdminPage, '/admin/routes?preview=1');
  assert.doesNotMatch(html, /本地设计预览|本地草稿工作区|新建路线|保存本地草稿/);
  assert.doesNotMatch(html, /href="\/admin[^"<>]*preview=1/);
  assert.match(html, /认证服务|登录身份|管理账号/);
});

test('disconnected production login reports an unavailable service instead of offering a preview administrator entry', () => {
  const html = render(LoginPage, '/login');
  assert.doesNotMatch(html, /进入本地设计预览|本地设计预览/);
  assert.match(html, /登录服务暂时不可用|认证服务尚未配置/);
});
