import { randomUUID } from 'node:crypto';
import { cloudConfig } from '../server/cloud-config.mjs';
import { createPostgres } from '../server/postgres.mjs';
import { seedCloud } from '../server/cloud-seed.mjs';
import { createStorage, storageHeaders } from '../server/supabase-storage.mjs';

// Database preparation precedes creating the Vercel domain.
const config = cloudConfig(process.env, { requireSiteOrigin: false });
const db = createPostgres(config);
try {
  if (process.argv.includes('--check')) {
    const {
      rows: [state],
    } = await db.pool.query(
      `SELECT
      (SELECT count(*)::int FROM chuanheng.users WHERE role = 'admin' AND active = 1) AS admins,
      (SELECT count(*)::int FROM chuanheng.site_settings) AS settings,
      (SELECT public FROM storage.buckets WHERE id = $1) AS bucket_public`,
      [config.bucket],
    );
    if (!state.admins || state.settings !== 1 || state.bucket_public !== false)
      throw new Error('请先初始化数据库并创建私有存储桶。');
    console.log('云端数据库可连接，管理员、网站设置与私有存储桶已就绪。');
  } else {
    await seedCloud(db, process.env.INITIAL_ADMIN_PASSWORD);
    console.log('云端示例内容与 admin 管理员（社长）已初始化。首次登录必须修改密码。');
  }
  const filename = `${randomUUID()}.png`;
  const image = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0M8AAAAASUVORK5CYII=',
    'base64',
  );
  await createStorage(config).upload(filename, image, 'image/png');
  const removed = await fetch(`${config.supabaseUrl}/storage/v1/object/${config.bucket}`, {
    method: 'DELETE',
    headers: { ...storageHeaders(config.secretKey), 'Content-Type': 'application/json' },
    body: JSON.stringify({ prefixes: [filename] }),
    signal: AbortSignal.timeout(20000),
  });
  if (!removed.ok)
    throw new Error('存储写入正常，但校验图片未能清理，请在 Storage 删除该测试图片。');
  console.log('Supabase 图片存储写入与清理检查通过。');
} catch (error) {
  const safe = /云端数据库已有内容|请先初始化数据库|图片暂时无法保存|存储写入正常|密码/.test(
    error.message,
  );
  console.error(
    safe ? error.message : '云端准备失败：请检查 SQL 初始化、环境变量、数据库密码与 CA 证书。',
  );
  process.exitCode = 1;
} finally {
  await db.close();
}
