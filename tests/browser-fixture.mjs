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

async function request(path, body, session = cookie) {
  const response = await fetch(`${origin}/api${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, Cookie: session }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`Fixture setup failed: ${path} (${response.status})`);
  return response;
}
for (const [role, displayName, permissions] of [
  ['admin', '测试管理员', ['activities:write']],
  ['member', '测试社员', []],
  ['viewer', '测试浏览者', []],
]) {
  const username = `fixture_${role}`;
  await request('/admin/users', { username, displayName, role, permissions, password: 'fixture-initial-password-only' });
  const response = await request('/auth/login', { username, password: 'fixture-initial-password-only' });
  const session = response.headers.get('set-cookie').split(';')[0];
  await request('/auth/password', { currentPassword: 'fixture-initial-password-only', newPassword: 'fixture-browser-password-only' }, session);
}
await request('/admin/activities', {
  title: '浏览器验证活动', category: '轻松徒步', kind: 'upcoming', date: '2099-10-18',
  routeName: '隔离测试路线', cityCode: '440300', difficulty: '测试安排', summary: '仅用于功能验证的合成内容。',
  description: '临时隔离数据库中的合成活动，用于验证登录、社员报名与取消报名。',
  image: '/images/hiking.webp', signupUrl: '', qrImage: '', status: 'published', isDemo: false, registrationOpen: true,
});
console.log(`Isolated browser-check site ready: ${origin}`);
console.log('This fixture contains synthetic content and has no access to the real site database.');
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => void app.close().then(() => process.exit(0)));
