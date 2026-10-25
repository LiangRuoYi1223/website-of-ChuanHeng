import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { cloudConfig } from '../server/cloud-config.mjs';
import { createPostgres } from '../server/postgres.mjs';
import { HttpError } from '../server/validation.mjs';
import {
  createPresidentAccount,
  presidentCredentials,
  PresidentSetupError,
} from '../server/president-account.mjs';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultDatabase = path.join(projectRoot, 'data', 'chuanheng.sqlite');

export async function setupPresident({ env, cloud = false, databasePath = defaultDatabase }) {
  // Validate user-supplied credentials before opening either database.
  const credentials = presidentCredentials(env);
  if (!cloud && !existsSync(databasePath)) {
    throw new PresidentSetupError('本地账号数据库不存在；请先启动本地后台，再运行创建命令。');
  }
  const db = cloud
    ? createPostgres(cloudConfig(env, { requireSiteOrigin: false }))
    : new DatabaseSync(databasePath);
  try {
    if (!cloud) db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    return await createPresidentAccount(db, credentials);
  } finally {
    await db.close();
  }
}

function options(args) {
  const result = {
    cloud: false,
    envFile: path.join(projectRoot, '.env.local'),
    databasePath: defaultDatabase,
  };
  for (const arg of args) {
    if (arg === '--cloud') result.cloud = true;
    else if (arg.startsWith('--env-file=') && arg.slice(11))
      result.envFile = path.resolve(arg.slice(11));
    else if (arg.startsWith('--database=') && arg.slice(11))
      result.databasePath = path.resolve(arg.slice(11));
    else
      throw new PresidentSetupError(
        '命令参数不正确。支持 --cloud、--env-file=私有配置文件、--database=本地数据库路径。',
      );
  }
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const config = options(process.argv.slice(2));
    let fileEnv;
    try {
      fileEnv = parseEnv(readFileSync(config.envFile, 'utf8'));
    } catch {
      throw new PresidentSetupError(
        '无法读取私有配置文件；请在 .env.local 填写社长账号和密码，或使用 --env-file 指定文件。',
      );
    }
    const result = await setupPresident({ ...config, env: { ...process.env, ...fileEnv } });
    console.log(
      result.created
        ? '社长账号已创建；首次登录请修改密码。'
        : '该有效社长账号已存在，账号和密码未改动。',
    );
  } catch (error) {
    // Do not print raw database errors: they can contain connection credentials.
    console.error(
      error instanceof PresidentSetupError || error instanceof HttpError
        ? error.message
        : '社长账号创建失败，请检查数据库连接、现有数据库版本和私有配置。',
    );
    process.exitCode = 1;
  }
}
