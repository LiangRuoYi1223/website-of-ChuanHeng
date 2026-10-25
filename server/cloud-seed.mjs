import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { initialSettings, initialActivities, initialProjects } from './seed.mjs';
import { password } from './validation.mjs';

export async function seedCloud(db, initialPassword) {
  await db.transaction(async () => {
    if (
      (await db.prepare('SELECT id FROM site_settings WHERE id = 1').get()) ||
      (await db.prepare('SELECT id FROM users LIMIT 1').get())
    ) {
      throw new Error('云端数据库已有内容，本命令不会覆盖或重置。');
    }
    password(initialPassword);
    await db
      .prepare('INSERT INTO site_settings (id,payload,revision) VALUES (1,?,1)')
      .run(JSON.stringify(initialSettings));
    for (const table of ['activities', 'projects']) {
      for (const item of table === 'activities' ? initialActivities : initialProjects) {
        await db
          .prepare(`INSERT INTO ${table} (id,payload,revision) VALUES (?,?,1)`)
          .run(item.id, JSON.stringify(item));
      }
    }
    const salt = randomBytes(16).toString('hex');
    const hash = `${salt}:${scryptSync(initialPassword, salt, 32).toString('hex')}`;
    await db
      .prepare(
        'INSERT INTO users (id,username,display_name,role,is_president,password_hash) VALUES (?,?,?,?,1,?)',
      )
      .run(randomUUID(), 'admin', '协会初始管理员', 'admin', hash);
  });
}
