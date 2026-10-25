export function cloudConfig(env = process.env, { requireSiteOrigin = true } = {}) {
  const required = [
    ...(env.HYPERDRIVE?.connectionString ? [] : ['DATABASE_URL']),
    'SUPABASE_URL',
    'SUPABASE_SECRET_KEY',
    ...(requireSiteOrigin ? ['SITE_ORIGIN'] : []),
  ];
  const missing = required.filter((key) => !env[key]?.trim());
  if (missing.length) throw new Error(`云端配置缺失：${missing.join(', ')}`);
  let databaseUrl, supabase, origin;
  try {
    databaseUrl = new URL(env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL);
    supabase = new URL(env.SUPABASE_URL);
    if (requireSiteOrigin) origin = new URL(env.SITE_ORIGIN);
  } catch {
    throw new Error('云端配置地址格式不正确，请检查数据库、Supabase 和网站地址。');
  }
  if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol))
    throw new Error('DATABASE_URL 必须是 PostgreSQL 连接地址。');
  if (
    supabase.protocol !== 'https:' ||
    (requireSiteOrigin && (origin.protocol !== 'https:' || origin.origin !== env.SITE_ORIGIN))
  ) {
    throw new Error('SUPABASE_URL 与 SITE_ORIGIN 须使用 HTTPS；SITE_ORIGIN 不含路径或结尾斜杠。');
  }
  const bucket = env.SUPABASE_STORAGE_BUCKET || 'chuanheng-uploads';
  if (!/^[a-z0-9-]+$/.test(bucket)) throw new Error('存储桶名称格式不正确。');
  return {
    databaseUrl: env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL,
    hyperdrive: Boolean(env.HYPERDRIVE?.connectionString),
    ca: env.DATABASE_CA_CERT?.replace(/\\n/g, '\n'),
    supabaseUrl: supabase.origin,
    secretKey: env.SUPABASE_SECRET_KEY,
    origin: origin?.origin,
    bucket,
  };
}
