import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { scryptSync } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { createPresidentAccount, presidentCredentials } from '../server/president-account.mjs';
import { setupPresident } from '../scripts/setup-president.mjs';
import { cloudConfig } from '../server/cloud-config.mjs';
import { createPostgres } from '../server/postgres.mjs';
import { contentPermissions } from '../server/permissions.mjs';

const credentials = {
  username: 'club-president',
  password: 'test-president-private#password-1234',
  displayName: '川衡社长',
};
const env = {
  PRESIDENT_USERNAME: credentials.username,
  PRESIDENT_PASSWORD: credentials.password,
  PRESIDENT_DISPLAY_NAME: credentials.displayName,
};
const execute = promisify(execFile);
const script = fileURLToPath(new URL('../scripts/setup-president.mjs', import.meta.url));

async function sqliteFixture(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'chuanheng-president-test-'));
  const databasePath = path.join(directory, 'chuanheng.sqlite'),
    db = new DatabaseSync(databasePath);
  db.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('admin','member','viewer')),
    is_president INTEGER NOT NULL DEFAULT 0 CHECK(is_president IN (0,1) AND (is_president = 0 OR role = 'admin')),
    permissions TEXT NOT NULL DEFAULT '[]', password_hash TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1, must_change_password INTEGER NOT NULL DEFAULT 1);
    CREATE TABLE site_settings(id INTEGER PRIMARY KEY, payload TEXT NOT NULL, revision INTEGER NOT NULL);
    INSERT INTO site_settings VALUES (1, '{"clubName":"保留原网站"}', 7);`);
  t.after(async () => {
    db.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { db, directory, databasePath };
}

async function postgresFixture(t) {
  const pg = new PGlite(),
    statements = [];
  await pg.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE SCHEMA storage;
    CREATE TABLE storage.buckets(id text PRIMARY KEY, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);`);
  await pg.exec(
    await readFile(
      new URL('../supabase/migrations/202610080001_website.sql', import.meta.url),
      'utf8',
    ),
  );
  const query = async (sql, values) => {
    statements.push(sql);
    if (sql.startsWith('SELECT pg_advisory_xact_lock')) return { rows: [], rowCount: 1 };
    const result = await pg.query(sql, values);
    return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
  };
  const config = cloudConfig(
    {
      DATABASE_URL: 'postgresql://test:test@localhost/postgres',
      SUPABASE_URL: 'https://test.supabase.co',
      SUPABASE_SECRET_KEY: 'test-only-secret',
    },
    { requireSiteOrigin: false },
  );
  const db = createPostgres(config, {
    query,
    async connect() {
      return { query, release() {} };
    },
    end() {
      return pg.close();
    },
  });
  t.after(() => db.close());
  await db
    .prepare('INSERT INTO site_settings (id, payload, revision) VALUES (?, ?, ?)')
    .run(1, '{"clubName":"保留原网站"}', 7);
  return { db, statements };
}

for (const [name, fixture] of [
  ['SQLite', sqliteFixture],
  ['PostgreSQL', postgresFixture],
]) {
  test(`${name} creates a president without changing existing accounts or content and repeat setup keeps its password`, async (t) => {
    const { db, statements } = await fixture(t);
    await db
      .prepare(
        'INSERT INTO users (id, username, display_name, role, password_hash, must_change_password) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run('existing-member', 'member-kept', '原社员', 'member', 'existing-password-hash', 0);
    const before = await db.prepare('SELECT * FROM users WHERE id = ?').get('existing-member');
    const result = await createPresidentAccount(db, credentials);
    assert.equal(result.created, true);
    assert.deepEqual(Object.keys(result).sort(), ['created', 'id', 'username']);
    const president = await db.prepare('SELECT * FROM users WHERE id = ?').get(result.id);
    assert.equal(president.username, credentials.username);
    assert.equal(president.display_name, credentials.displayName);
    assert.equal(president.role, 'admin');
    assert.equal(president.is_president, 1);
    assert.equal(president.active, 1);
    assert.equal(president.must_change_password, 1);
    assert.deepEqual(JSON.parse(president.permissions), contentPermissions);
    const [salt, hash] = president.password_hash.split(':');
    assert.equal(scryptSync(credentials.password, salt, 32).toString('hex'), hash);
    assert.ok(!JSON.stringify(result).includes(credentials.password));
    const repeated = await createPresidentAccount(db, {
      ...credentials,
      username: credentials.username.toUpperCase(),
      password: 'test-replacement-password-1234',
      displayName: '不能覆盖原名称',
    });
    assert.deepEqual(repeated, { created: false, id: result.id, username: credentials.username });
    assert.deepEqual(
      await db.prepare('SELECT * FROM users WHERE id = ?').get(result.id),
      president,
    );
    assert.deepEqual(
      await db.prepare('SELECT * FROM users WHERE id = ?').get('existing-member'),
      before,
    );
    assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM users').get()).count, 2);
    assert.deepEqual(
      JSON.parse(
        (await db.prepare('SELECT payload FROM site_settings WHERE id = 1').get()).payload,
      ),
      { clubName: '保留原网站' },
    );
    assert.equal(
      (await db.prepare('SELECT revision FROM site_settings WHERE id = 1').get()).revision,
      7,
    );
    if (statements)
      assert.ok(
        statements.filter((sql) => sql.startsWith('SELECT pg_advisory_xact_lock')).length >= 2,
      );
  });

  test(`${name} refuses to overwrite a member, ordinary administrator, or disabled president`, async (t) => {
    const { db } = await fixture(t);
    for (const [role, isPresident, active] of [
      ['member', 0, 1],
      ['admin', 0, 1],
      ['admin', 1, 0],
    ]) {
      const username = `existing-${role}-${isPresident}-${active}`;
      await db
        .prepare(
          'INSERT INTO users (id, username, display_name, role, is_president, active, password_hash) VALUES (?, ?, ?, ?, ?, ?, ?)',
        )
        .run(username, username, '原有账号', role, isPresident, active, 'original-hash');
      const before = await db.prepare('SELECT * FROM users WHERE username = ?').get(username);
      await assert.rejects(
        createPresidentAccount(db, { ...credentials, username }),
        /不会修改现有账号/,
      );
      assert.deepEqual(
        await db.prepare('SELECT * FROM users WHERE username = ?').get(username),
        before,
      );
    }
    assert.equal((await db.prepare('SELECT COUNT(*) AS count FROM users').get()).count, 3);
  });
}

test('president credentials require user-filled fields and apply existing account validation', () => {
  assert.throws(() => presidentCredentials({}), /PRESIDENT_USERNAME、PRESIDENT_PASSWORD/);
  assert.throws(
    () => presidentCredentials({ ...env, PRESIDENT_PASSWORD: '  ' }),
    /PRESIDENT_PASSWORD/,
  );
  assert.throws(
    () => presidentCredentials({ ...env, PRESIDENT_USERNAME: 'bad username' }),
    /账号须为/,
  );
  assert.throws(() => presidentCredentials({ ...env, PRESIDENT_PASSWORD: 'short' }), /12 至 128/);
  assert.throws(
    () => presidentCredentials({ ...env, PRESIDENT_DISPLAY_NAME: '长'.repeat(101) }),
    /显示名称格式/,
  );
  assert.equal(
    presidentCredentials({ ...env, PRESIDENT_USERNAME: 'My-President', PRESIDENT_DISPLAY_NAME: '' })
      .username,
    'my-president',
  );
  assert.equal(
    presidentCredentials({ ...env, PRESIDENT_DISPLAY_NAME: '' }).displayName,
    '协会社长',
  );
});

test('missing databases or old users schema remain untouched', async (t) => {
  const f = await sqliteFixture(t),
    missing = path.join(f.directory, 'missing.sqlite');
  await assert.rejects(setupPresident({ env, databasePath: missing }), /数据库不存在/);
  await assert.rejects(stat(missing), { code: 'ENOENT' });
  await assert.rejects(setupPresident({ env: {}, databasePath: missing }), /PRESIDENT_USERNAME/);
  f.db.exec(
    'DROP TABLE users; CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL);',
  );
  await assert.rejects(createPresidentAccount(f.db, credentials), /数据库尚未初始化或版本过旧/);
  assert.deepEqual(
    f.db
      .prepare('PRAGMA table_info(users)')
      .all()
      .map((column) => column.name),
    ['id', 'username', 'password_hash'],
  );
  assert.equal(f.db.prepare('SELECT count(*) AS count FROM users').get().count, 0);
});

test('failed local creation rolls back and permits a subsequent valid creation', async (t) => {
  const { db } = await sqliteFixture(t);
  db.exec(`CREATE TRIGGER reject_president BEFORE INSERT ON users WHEN NEW.username = 'blocked-president'
    BEGIN SELECT RAISE(ABORT, 'test-only insertion failure'); END;`);
  await assert.rejects(
    createPresidentAccount(db, { ...credentials, username: 'blocked-president' }),
    /test-only insertion failure/,
  );
  assert.equal(db.prepare('SELECT count(*) AS count FROM users').get().count, 0);
  assert.equal((await createPresidentAccount(db, credentials)).created, true);
});

test('setup command reads a private env file, hides its password and remains safe on repeat', async (t) => {
  const f = await sqliteFixture(t),
    envFile = path.join(f.directory, '.env.private');
  await writeFile(
    envFile,
    `PRESIDENT_USERNAME=${credentials.username}\nPRESIDENT_PASSWORD='${credentials.password}'\nPRESIDENT_DISPLAY_NAME=${credentials.displayName}\n`,
  );
  const args = [script, `--env-file=${envFile}`, `--database=${f.databasePath}`];
  const first = await execute(process.execPath, args);
  assert.match(first.stdout, /社长账号已创建/);
  assert.ok(!`${first.stdout}${first.stderr}`.includes(credentials.password));
  const president = f.db
    .prepare('SELECT * FROM users WHERE username = ?')
    .get(credentials.username);
  const second = await execute(process.execPath, args);
  assert.match(second.stdout, /账号和密码未改动/);
  assert.deepEqual(
    f.db.prepare('SELECT * FROM users WHERE username = ?').get(credentials.username),
    president,
  );
  await writeFile(envFile, 'PRESIDENT_USERNAME=\nPRESIDENT_PASSWORD=\n');
  await assert.rejects(
    execute(process.execPath, args),
    (error) => error.code === 1 && /PRESIDENT_USERNAME、PRESIDENT_PASSWORD/.test(error.stderr),
  );
  assert.equal(f.db.prepare('SELECT count(*) AS count FROM users').get().count, 1);
});
