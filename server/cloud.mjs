import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { createApp } from './index.mjs';
import { cloudConfig } from './cloud-config.mjs';
import { createPostgres } from './postgres.mjs';
import { createStorage } from './supabase-storage.mjs';
import { HttpError } from './validation.mjs';

export function clientIp(req, platform = 'vercel') {
  // Only use headers from the explicitly configured hosting platform. Render
  // appends proxy addresses; the last address cannot be supplied by the client.
  const forwarded =
    platform === 'cloudflare'
      ? req.headers['cf-connecting-ip']
      : platform === 'render'
        ? req.headers['x-forwarded-for']?.split(',').at(-1)?.trim()
        : req.headers['x-vercel-forwarded-for']?.split(',')[0]?.trim();
  return forwarded && isIP(forwarded) ? forwarded : (req.socket.remoteAddress ?? 'unknown');
}

export function createRateLimiter(pool, platform = 'vercel') {
  return async (req, username, action) => {
    const ip = clientIp(req, platform);
    const digest = (value) => createHash('sha256').update(value).digest('hex');
    const keys = [digest(`${action}:ip:${ip}`), digest(`${action}:user:${ip}:${username}`)];
    const now = Date.now();
    await pool.query('DELETE FROM chuanheng.rate_limits WHERE until_at <= $1', [now]);
    // Reserve a slot before password verification. This also limits concurrent
    // attempts across instances; successful logins release only their user slot.
    for (let i = 0; i < keys.length; i++) {
      const result = await pool.query(
        `INSERT INTO chuanheng.rate_limits (key,count,until_at) VALUES ($1,1,$2)
        ON CONFLICT (key) DO UPDATE SET count = chuanheng.rate_limits.count + 1 RETURNING count`,
        [keys[i], now + 15 * 60 * 1000],
      );
      if (result.rows[0].count > (i === 0 ? 30 : 5))
        throw new HttpError(429, `${action}尝试过于频繁，请 15 分钟后再试。`);
    }
    return {
      async fail() {},
      async success() {
        await pool.query(
          'UPDATE chuanheng.rate_limits SET count = GREATEST(count - 1, 0) WHERE key = $1',
          [keys[0]],
        );
        await pool.query('DELETE FROM chuanheng.rate_limits WHERE key = $1', [keys[1]]);
      },
    };
  };
}

export function bufferedResponse() {
  const headers = new Map();
  return {
    statusCode: 200,
    headersSent: false,
    body: '',
    destroyed: false,
    setHeader(name, value) {
      headers.set(name.toLowerCase(), value);
    },
    getHeader(name) {
      return headers.get(name.toLowerCase());
    },
    writeHead(status, extra = {}) {
      this.statusCode = status;
      for (const [key, value] of Object.entries(extra)) this.setHeader(key, value);
      this.headersSent = true;
    },
    end(body = '') {
      this.body = body;
    },
    destroy() {
      this.destroyed = true;
    },
    flush(res) {
      if (this.destroyed) return res.destroy();
      res.writeHead(this.statusCode, Object.fromEntries(headers));
      res.end(this.body);
    },
  };
}

export function createCloudApp(env = process.env, dependencies = {}) {
  const config = cloudConfig(env);
  const db = dependencies.db ?? createPostgres(config);
  // Separate connections keep throttling durable after a rejected request and
  // prevent lock-waiting mutations from exhausting the limiter's connection.
  const limiterDb = dependencies.rateLimiter
    ? null
    : createPostgres({ ...config, maxConnections: 1 });
  const app = createApp({
    db,
    storage: dependencies.storage ?? createStorage(config),
    production: true,
    secureCookies: true,
    trustProxy: true,
    publicOrigin: config.origin,
    rateLimiter:
      dependencies.rateLimiter ??
      createRateLimiter(
        limiterDb.pool,
        env.HOSTING_PLATFORM ?? (env.RENDER === 'true' ? 'render' : 'vercel'),
      ),
    maxImageBytes: 3 * 1024 * 1024,
    servePublic: dependencies.servePublic,
    dummyPasswordHash: dependencies.dummyPasswordHash,
    distDir: 'dist',
    publicDir: 'public',
  });
  return {
    ...app,
    async close() {
      await app.close();
      if (limiterDb) await limiterDb.close();
    },
    async handler(req, res) {
      const pathname = new URL(req.url, 'http://localhost').pathname;
      if (pathname.startsWith('/api/') && !['GET', 'HEAD'].includes(req.method)) {
        const buffered = bufferedResponse();
        await db.transaction(async () => {
          await app.handler(req, buffered);
          if (buffered.statusCode >= 400 || buffered.destroyed) await db.exec('ROLLBACK');
        });
        buffered.flush(res);
      } else await app.handler(req, res);
    },
  };
}
