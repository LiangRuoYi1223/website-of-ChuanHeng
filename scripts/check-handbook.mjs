import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dataHash, fileHash, assetHashes } from './handbook-data.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = {
  pdf: path.join(root, 'public/docs/chuanheng-partnership-handbook.pdf'),
  cover: path.join(root, 'public/images/handbook-cover.png'),
  manifest: path.join(root, 'public/docs/handbook-manifest.json'),
};

try {
  const manifest = JSON.parse(fs.readFileSync(files.manifest, 'utf8'));
  if (manifest.contentSha256 !== dataHash()) throw new Error('合作内容已更新，PDF 尚未同步。');
  if (JSON.stringify(manifest.sourceAssets) !== JSON.stringify(assetHashes())) throw new Error('项目影像已更新，PDF 尚未同步。');
  if (manifest.pdfSha256 !== fileHash(fs.readFileSync(files.pdf))) throw new Error('合作手册 PDF 缺失或已被替换。');
  if (manifest.coverSha256 !== fileHash(fs.readFileSync(files.cover))) throw new Error('合作手册封面缺失或已被替换。');
  console.log(`合作手册同步校验通过：${manifest.pageCount} 页，${manifest.projectCount} 个公开项目。`);
} catch (error) {
  console.error(`合作手册校验失败：${error.message}\n请运行 npm run handbook 后重新构建。`);
  process.exitCode = 1;
}
