import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../worker/index.mjs';
import { cloudConfig } from '../server/cloud-config.mjs';
import { createPostgres } from '../server/postgres.mjs';

test('Cloudflare serves SPA routes with security headers without needing database credentials', async () => {
  let calls = 0;
  const env = {
    ASSETS: {
      async fetch() {
        calls++;
        return new Response('<html>website</html>', { headers: { 'Content-Type': 'text/html' } });
      },
    },
  };
  const response = await worker.fetch(new Request('https://club.test/activities/a'), env);
  assert.equal(response.status, 200);
  assert.equal(calls, 1);
  assert.equal(response.headers.get('x-frame-options'), 'DENY');
  assert.equal(await response.text(), '<html>website</html>');
});

test('Cloudflare fails closed for APIs and protected media until Hyperdrive is bound', async () => {
  let calls = 0;
  const env = {
    ASSETS: {
      async fetch() {
        calls++;
        return new Response('private image');
      },
    },
  };
  for (const route of [
    '/api/content',
    '/images/hiking.webp',
    '/docs/handbook.pdf',
    '/uploads/example.png',
    '/%69mages/hiking.webp',
  ]) {
    const response = await worker.fetch(new Request('https://club.test' + route), env);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  assert.equal(calls, 0);
  assert.equal((await worker.fetch(new Request('https://club.test/images/%ZZ'), env)).status, 400);
});

test('Hyperdrive binding replaces direct credentials while ordinary PostgreSQL still verifies its CA', async () => {
  const env = {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SECRET_KEY: 'sb_secret_test',
    SITE_ORIGIN: 'https://club.test',
    HYPERDRIVE: { connectionString: 'postgresql://binding:local@localhost:5432/postgres' },
  };
  const config = cloudConfig(env);
  assert.equal(config.hyperdrive, true);
  const db = createPostgres(config);
  assert.equal(db.pool.options.ssl, false);
  await db.close();
  const direct = createPostgres({ ...config, hyperdrive: false, ca: 'test-ca' });
  assert.deepEqual(direct.pool.options.ssl, { rejectUnauthorized: true, ca: 'test-ca' });
  await direct.close();
});
