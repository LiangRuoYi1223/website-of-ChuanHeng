import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { demoContent } from '../src/demo-content.ts';

// Both the public page and the handbook consume these source records.
export function handbookData() {
  return {
    settings: demoContent.settings,
    cooperation: demoContent.cooperation,
    projects: demoContent.projects.filter(project => project.status === 'published'),
  };
}

export function dataHash(data = handbookData()) {
  return createHash('sha256').update(JSON.stringify(data)).digest('hex');
}

export function fileHash(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

export function assetHashes(data = handbookData()) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const urls = [...new Set([data.settings.heroTeam, ...data.projects.map(project => project.image)])].sort();
  return Object.fromEntries(urls.map(url => {
    const file = path.join(root, 'public', url.replace(/^\//, ''));
    return [url, fs.existsSync(file) ? fileHash(fs.readFileSync(file)) : null];
  }));
}
