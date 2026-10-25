import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
import * as validate from './validation.mjs';
import { contentPermissions } from './permissions.mjs';

export class PresidentSetupError extends Error {}

export function presidentCredentials(env) {
  const missing = ['PRESIDENT_USERNAME', 'PRESIDENT_PASSWORD'].filter(
    (key) => typeof env[key] !== 'string' || !env[key].trim(),
  );
  if (missing.length)
    throw new PresidentSetupError(`请先在私有配置文件填写 ${missing.join('、')}，再创建社长账号。`);
  return {
    username: validate.username(env.PRESIDENT_USERNAME),
    password: validate.password(env.PRESIDENT_PASSWORD),
    displayName: validate.string(env.PRESIDENT_DISPLAY_NAME?.trim() || '协会社长', '社长显示名称', {
      required: true,
      max: 100,
    }),
  };
}

async function transaction(db, work) {
  if (typeof db.transaction === 'function') return db.transaction(work);
  await db.exec('BEGIN IMMEDIATE');
  try {
    const result = await work();
    await db.exec('COMMIT');
    return result;
  } catch (error) {
    await db.exec('ROLLBACK');
    throw error;
  }
}

export async function createPresidentAccount(db, input) {
  const username = validate.username(input.username);
  const password = validate.password(input.password);
  const displayName = validate.string(input.displayName ?? '协会社长', '社长显示名称', {
    required: true,
    max: 100,
  });
  return transaction(db, async () => {
    try {
      // Require the application's existing schema; this command never creates or migrates tables.
      await db
        .prepare(
          'SELECT id, username, display_name, role, is_president, permissions, password_hash, active, must_change_password FROM users LIMIT 0',
        )
        .all();
    } catch (error) {
      if (
        ['42P01', '42703', '3F000'].includes(error.code) ||
        /no such (?:table|column)/i.test(error.message)
      ) {
        throw new PresidentSetupError(
          '账号数据库尚未初始化或版本过旧；请先启动本地后台，云端请先完成现有数据库迁移，再创建社长账号。',
        );
      }
      throw error;
    }
    const existing = await db
      .prepare(
        'SELECT id, username, role, is_president, active FROM users WHERE lower(username) = ?',
      )
      .get(username);
    if (existing) {
      if (existing.role === 'admin' && existing.is_president === 1 && existing.active === 1) {
        return { created: false, id: existing.id, username: existing.username };
      }
      throw new PresidentSetupError(
        '该账号已存在且不是有效社长账号；本命令不会修改现有账号，请另选账号名称。',
      );
    }
    const id = randomUUID(),
      salt = randomBytes(16).toString('hex');
    const hash = `${salt}:${scryptSync(password, salt, 32).toString('hex')}`;
    await db
      .prepare(
        'INSERT INTO users (id, username, display_name, role, is_president, permissions, password_hash, active, must_change_password) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      )
      .run(id, username, displayName, 'admin', 1, JSON.stringify(contentPermissions), hash, 1, 1);
    return { created: true, id, username };
  });
}
