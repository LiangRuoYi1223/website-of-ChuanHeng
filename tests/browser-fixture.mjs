// An isolated, disposable site for manual browser checks. Never uses the user's database.
import path from 'node:path';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createApp } from '../server/index.mjs';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureParent = path.join(workspace, 'artifacts', 'browser-checks');
mkdirSync(fixtureParent, { recursive: true });
const root = mkdtempSync(path.join(fixtureParent, 'fixture-'));
const app = createApp({ dataDir: path.join(root, 'data'), uploadDir: path.join(root, 'uploads'), initialPassword: 'fixture-initial-password-only', distDir: path.join(workspace, 'dist') });
const origin = 'http://127.0.0.1:3002';
await new Promise(resolve => app.server.listen(3002, '127.0.0.1', resolve));
const login = await fetch(`${origin}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify({ username: 'admin', password: 'fixture-initial-password-only' }) });
if (!login.ok) throw new Error('Test fixture authentication failed');
const cookie = login.headers.get('set-cookie').split(';')[0];
const changed = await fetch(`${origin}/api/auth/password`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, Cookie: cookie }, body: JSON.stringify({ currentPassword: 'fixture-initial-password-only', newPassword: 'fixture-browser-password-only' }) });
if (!changed.ok) throw new Error('Test fixture preparation failed');
console.log(`Isolated browser-check site ready: ${origin}`);
console.log('This fixture contains synthetic content and has no access to the real site database.');
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => void app.close().then(() => process.exit(0)));
