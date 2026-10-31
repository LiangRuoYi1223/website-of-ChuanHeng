import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// These are public client values. Never read a service key or a database password.
const root = fileURLToPath(new URL('../', import.meta.url));
const config = JSON.parse(readFileSync(new URL('../wrangler.jsonc', import.meta.url), 'utf8'));
const url = config.vars?.SUPABASE_URL;
const key = config.vars?.SUPABASE_PUBLISHABLE_KEY;
if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(url || '') || !/^sb_publishable_[A-Za-z0-9_-]+$/.test(key || '')) {
  throw new Error('Production requires a Supabase URL and a publishable key in wrangler.jsonc.');
}
const result = spawnSync(process.execPath, [fileURLToPath(new URL('../node_modules/vite/bin/vite.js', import.meta.url)), 'build', '--configLoader', 'runner'], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, VITE_SUPABASE_URL: url, VITE_SUPABASE_PUBLISHABLE_KEY: key, VITE_CONTENT_MODE: 'live' },
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
