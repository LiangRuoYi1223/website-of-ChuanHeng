import { rm } from 'node:fs/promises';
import path from 'node:path';

// Media must be served by the maintenance-aware API rather than the static CDN.
const root = path.resolve('dist');
for (const name of ['images', 'docs']) {
  const target = path.resolve(root, name);
  if (path.dirname(target) !== root) throw new Error('构建资源路径超出 dist。');
  await rm(target, { recursive: true, force: true });
}
console.log('云端构建就绪；图片与手册由网站接口提供。');
