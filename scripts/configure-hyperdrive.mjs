import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseEnv } from 'node:util';
import { cloudConfig } from '../server/cloud-config.mjs';

const values = parseEnv(fs.readFileSync('.env.local', 'utf8'));
const config = cloudConfig(values, { requireSiteOrigin: false });
const original = new URL(config.databaseUrl);
const projectRef = new URL(config.supabaseUrl).hostname.split('.')[0];
if (!/^[a-z0-9]{20}$/.test(projectRef) || !original.hostname.endsWith('.supabase.com'))
  throw new Error('请确认 Supabase 数据库地址。');
const direct = new URL(original);
direct.hostname = `db.${projectRef}.supabase.co`;
direct.port = '5432';
direct.username = 'postgres';
direct.search = '';
const sensitive = [
  config.databaseUrl,
  direct.href,
  decodeURIComponent(original.password),
  original.password,
  config.secretKey,
].filter(Boolean);
const sanitize = (text) =>
  sensitive.reduce((out, value) => out.replaceAll(value, '[已隐藏]'), text);
function wrangler(args) {
  const result = spawnSync(process.execPath, ['node_modules/wrangler/bin/wrangler.js', ...args], {
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 1024 * 1024,
  });
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  if (result.status !== 0) {
    if (/CLOUDFLARE_API_TOKEN|not authenticated|token.*expired/i.test(output)) {
      console.error(
        'Cloudflare 部署工具未获得有效登录授权。请在同一个 PowerShell 窗口运行 npx wrangler login，在浏览器点击 Allow，看到 Successfully logged in 后再运行本脚本。',
      );
    } else console.error(sanitize(output));
    process.exit(1);
  }
  return output;
}
const configuration = JSON.parse(fs.readFileSync('wrangler.jsonc', 'utf8'));
if (configuration.hyperdrive?.length) {
  console.log('已有 Hyperdrive 绑定，请先检查现有配置，避免重复创建。');
  process.exit(0);
}
const loginStatus = wrangler(['whoami']);
if (!/logged in with/i.test(loginStatus)) {
  console.error('请先运行 npx wrangler login，在浏览器点击 Allow，再运行本脚本。');
  process.exit(1);
}
if (process.argv.includes('--check-login')) {
  console.log('Cloudflare 登录检测通过；未上传证书或数据库凭据。');
  process.exit(0);
}
fs.mkdirSync('.wrangler', { recursive: true });
if (!config.ca) throw new Error('缺少 Supabase 根证书。');
const certificatePath = path.resolve('.wrangler/supabase-ca.pem');
fs.writeFileSync(certificatePath, config.ca);
const certificateResult = wrangler([
  'cert',
  'upload',
  'certificate-authority',
  '--ca-cert',
  certificatePath,
  '--name',
  'chuanheng-supabase-ca',
]);
const certificateId = certificateResult.match(/(?:ID|id|uuid)\s*[:=]\s*([a-f0-9-]{36})/i)?.[1];
if (!certificateId) {
  console.log(sanitize(certificateResult));
  throw new Error('未读取到证书编号。');
}
console.log('Supabase 根证书已上传。');
const result = wrangler([
  'hyperdrive',
  'create',
  'chuanheng-supabase',
  '--connection-string',
  direct.href,
  '--ca-certificate-id',
  certificateId,
  '--sslmode',
  'verify-full',
  '--caching-disabled',
  '--origin-connection-limit',
  '5',
]);
const id =
  result.match(/"id"\s*:\s*"([a-f0-9]{32})"/)?.[1] ??
  result.match(/id\s*=\s*"([a-f0-9]{32})"/)?.[1];
if (!id) {
  console.log(sanitize(result));
  throw new Error('未读取到 Hyperdrive 编号。');
}
configuration.hyperdrive = [{ binding: 'HYPERDRIVE', id }];
fs.writeFileSync('wrangler.jsonc', JSON.stringify(configuration, null, 2) + '\n');
console.log('Hyperdrive 已创建并绑定；数据库证书与主机名校验开启，查询缓存关闭。');
