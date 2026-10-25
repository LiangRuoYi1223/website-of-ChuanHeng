import pg from 'pg';
import { AsyncLocalStorage } from 'node:async_hooks';

const tables = 'site_settings|activities|projects|users|sessions|registrations|site_status';
export function postgresSql(sql) {
  let index = 0;
  return sql
    .replace(/\?/g, () => `$${++index}`)
    .replace(new RegExp(`\\b(FROM|JOIN|UPDATE|INTO) (${tables})\\b`, 'g'), '$1 chuanheng.$2')
    .replace('ORDER BY rowid DESC', 'ORDER BY sort_order DESC')
    .replace(
      /INSERT INTO chuanheng\.(activities|projects) VALUES/,
      'INSERT INTO chuanheng.$1 (id, payload, revision) VALUES',
    );
}

export function createPostgres(config, poolOverride) {
  const connectionUrl = new URL(config.databaseUrl);
  for (const key of ['sslmode', 'sslcert', 'sslkey', 'sslrootcert'])
    connectionUrl.searchParams.delete(key);
  const pool =
    poolOverride ??
    new pg.Pool({
      connectionString: connectionUrl.href,
      // Hyperdrive's binding is a trusted runtime connection; Hyperdrive verifies
      // the remote Supabase certificate using verify-full and the uploaded CA.
      ssl: config.hyperdrive
        ? false
        : { rejectUnauthorized: true, ...(config.ca ? { ca: config.ca } : {}) },
      max: config.maxConnections ?? 1,
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 10000,
      statement_timeout: 15000,
      query_timeout: 20000,
      allowExitOnIdle: true,
    });
  pool.on?.('error', () => console.error('数据库连接中断，请检查云端服务状态。'));
  const context = new AsyncLocalStorage();
  const query = (sql, values = []) => (context.getStore()?.client ?? pool).query(sql, values);
  return {
    pool,
    prepare(sql) {
      const text = postgresSql(sql);
      return {
        async get(...values) {
          return (await query(text, values)).rows[0];
        },
        async all(...values) {
          return (await query(text, values)).rows;
        },
        async run(...values) {
          return { changes: (await query(text, values)).rowCount };
        },
      };
    },
    // Cloud mutations already run in a request transaction. Inner local SQLite
    // transaction boundaries must not release the shared PostgreSQL lock early.
    async exec(sql) {
      const state = context.getStore();
      if (!state) throw new Error('云端事务只能在请求上下文中使用。');
      if (sql === 'ROLLBACK') state.rollback = true;
      else if (!['BEGIN IMMEDIATE', 'COMMIT'].includes(sql))
        throw new Error('不支持的云端事务操作。');
    },
    async transaction(work) {
      const client = await pool.connect();
      const state = { client, rollback: false };
      try {
        await client.query('BEGIN');
        // Serialize mutations across all serverless instances, preserving revision
        // checks and last-admin/president protection from the local backend.
        await client.query('SELECT pg_advisory_xact_lock(20261008, 1)');
        const result = await context.run(state, work);
        await client.query(state.rollback ? 'ROLLBACK' : 'COMMIT');
        return result;
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {});
        throw error;
      } finally {
        client.release();
      }
    },
    close() {
      return pool.end();
    },
  };
}
