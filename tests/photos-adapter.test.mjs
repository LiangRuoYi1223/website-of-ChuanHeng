import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { tracksVitePlugin } from '../server/tracks/vite-plugin.mjs';
import worker from '../server/worker.mjs';

test('Vite photo middleware processes a token-free loopback HTTP upload with real local Images binding', { timeout: 15000 }, async () => {
  let middleware;
  tracksVitePlugin({ localPreview: true, env: {} }).configureServer({
    middlewares: { use(handler) { middleware = handler; } },
  });
  const server = createServer((incoming, outgoing) => middleware(incoming, outgoing, () => {
    outgoing.statusCode = 404;
    outgoing.end('not handled');
  }));
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const origin = `http://127.0.0.1:${server.address().port}`;
    const source = await sharp({ create: { width: 32, height: 16, channels: 3, background: '#ee7422' } }).png().toBuffer();
    const form = new FormData();
    form.append('file', new Blob([source], { type: 'image/png' }), 'synthetic-local-only.png');
    const response = await fetch(`${origin}/api/photos/process`, {
      method: 'POST', headers: { origin }, body: form, signal: AbortSignal.timeout(10000),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/webp');
    assert.equal(response.headers.get('x-photo-processed'), '1');
    assert.equal(response.headers.get('x-photo-original-bytes'), String(source.byteLength));
    const output = new Uint8Array(await response.arrayBuffer());
    assert.equal(response.headers.get('x-photo-output-bytes'), String(output.byteLength));
    const metadata = await sharp(output).metadata();
    assert.equal(metadata.format, 'webp');
    assert.equal(metadata.width, 32);
    assert.equal(metadata.height, 16);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});

test('production photo wiring rejects token-free localhost preview query and env flags before network or Images access', async t => {
  const network = t.mock.method(globalThis, 'fetch', () => { throw Error('Unexpected outbound network request'); });
  let imagesCalled = 0;
  let assetsCalled = 0;
  const env = {
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_key',
    LOCAL_PREVIEW: 'true', localPreview: true,
    IMAGES: { info() { imagesCalled++; throw Error('Unexpected image decode'); } },
    ASSETS: { fetch() { assetsCalled++; throw Error('Unexpected asset fallback'); } },
  };
  const response = await worker.fetch(new Request('http://localhost/api/photos/process?preview=1', {
    method: 'POST', headers: { origin: 'http://localhost', 'x-local-preview': 'true' },
  }), env);
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await response.json()).error.code, 'AUTH_REQUIRED');
  assert.equal(network.mock.callCount(), 0);
  assert.equal(imagesCalled, 0);
  assert.equal(assetsCalled, 0);
});

test('real Vite runner configuration keeps local photo processing available after config loading', { timeout: 30000 }, async () => {
  const { createServer: createViteServer } = await import('vite');
  const server = await createViteServer({
    configFile: fileURLToPath(new URL('../vite.config.js', import.meta.url)),
    configLoader: 'runner',
    server: { host: '127.0.0.1', port: 0, watch: null, hmr: false },
    optimizeDeps: { noDiscovery: true, include: [] },
    logLevel: 'silent',
  });
  try {
    await server.listen();
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
    const source = await sharp({ create: { width: 8, height: 4, channels: 3, background: '#ee7422' } }).png().toBuffer();
    const form = new FormData();
    form.append('file', new Blob([source], { type: 'image/png' }), 'synthetic-runner-only.png');
    const response = await fetch(`${origin}/api/photos/process`, {
      method: 'POST', headers: { origin }, body: form, signal: AbortSignal.timeout(10000),
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'image/webp');
    assert.equal(response.headers.get('x-photo-processed'), '1');
    assert.equal((await sharp(new Uint8Array(await response.arrayBuffer())).metadata()).format, 'webp');
  } finally {
    await server.close();
  }
});
