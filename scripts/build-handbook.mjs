import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { handbookData, dataHash, fileHash, assetHashes } from './handbook-data.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const canonical = path.join(root, 'public/docs/chuanheng-partnership-handbook.pdf');
const copy = path.join(root, 'output/pdf/chuanheng-partnership-handbook.pdf');
const cover = path.join(root, 'public/images/handbook-cover.png');
const manifestPath = path.join(root, 'public/docs/handbook-manifest.json');
const previewDir = path.join(root, 'artifacts/previews/handbook');
const bundled = path.join(os.homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', ...options });
  if (result.error || result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')}\n${result.error?.message || result.stderr || result.stdout}`);
  }
  return result;
}

function findPython() {
  const candidates = [process.env.CHUANHENG_PYTHON, path.join(bundled, 'python', process.platform === 'win32' ? 'python.exe' : 'bin/python3'), 'python3', 'python', 'py'].filter(Boolean);
  for (const command of candidates) {
    const probe = spawnSync(command, ['-c', 'import reportlab, pypdf, PIL'], { encoding: 'utf8' });
    if (!probe.error && probe.status === 0) return command;
  }
  throw new Error('找不到含 reportlab、pypdf、Pillow 的 Python。请安装 scripts/handbook-requirements.txt 中的依赖，或设置 CHUANHENG_PYTHON。');
}

function findPoppler() {
  for (const command of ['pdftoppm', path.join(bundled, 'native/poppler/Library/bin/pdftoppm.exe')]) {
    const probe = spawnSync(command, ['-v'], { encoding: 'utf8' });
    if (!probe.error && probe.status === 0) return command;
  }
  return null;
}

try {
  const data = handbookData();
  if (!data.cooperation) throw new Error('缺少合作页的共享内容。');
  const missingAssets = Object.entries(assetHashes(data)).filter(([, hash]) => hash === null).map(([url]) => url);
  if (missingAssets.length) throw new Error(`合作手册引用的本地影像缺失：${missingAssets.join('、')}`);
  for (const directory of [path.dirname(canonical), path.dirname(copy), path.dirname(cover), previewDir]) fs.mkdirSync(directory, { recursive: true });
  const python = findPython();
  const args = [path.join(root, 'scripts/build-handbook.py'), '--root', root, '--output', canonical];
  if (process.env.CHUANHENG_HANDBOOK_FONT) args.push('--font', process.env.CHUANHENG_HANDBOOK_FONT);
  const result = run(python, args, { input: JSON.stringify(data), env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' } });
  const summary = JSON.parse(result.stdout.trim());
  fs.copyFileSync(canonical, copy);
  const poppler = findPoppler();
  if (poppler) {
    run(poppler, ['-f', '1', '-singlefile', '-r', '140', '-png', canonical, cover.slice(0, -4)]);
    run(poppler, ['-r', '110', '-png', canonical, path.join(previewDir, 'page')]);
  } else {
    run(python, [path.join(root, 'scripts/render-handbook.py'), '--pdf', canonical, '--cover', cover, '--previews', previewDir], { env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' } });
  }
  const manifest = {
    schemaVersion: 1,
    title: '川衡登山队合作手册',
    version: data.cooperation.handbook.versionLabel,
    updatedAt: data.cooperation.handbook.updatedAt,
    contentSha256: dataHash(data),
    sourceAssets: assetHashes(data),
    pdfSha256: fileHash(fs.readFileSync(canonical)),
    coverSha256: fileHash(fs.readFileSync(cover)),
    pageCount: summary.pageCount,
    projectCount: data.projects.length,
    typography: summary.typography,
    pdfBytes: fs.statSync(canonical).size,
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`已同步生成合作手册：${summary.pageCount} 页，${data.projects.length} 个项目。`);
  console.log('PDF：public/docs/chuanheng-partnership-handbook.pdf');
  console.log('封面：public/images/handbook-cover.png');
  console.log('逐页预览：artifacts/previews/handbook/');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
