import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

const root = realpathSync(fileURLToPath(new URL('../', import.meta.url)));
const configuration = JSON.parse(readFileSync(join(root, 'wrangler.jsonc'), 'utf8'));
const origin = 'https://chuanheng.example';
const authUrl = 'https://project.supabase.co/auth/v1/user';
const accessToken = 'runtime-test-access-token';
const publishableKey = 'sb_publishable_runtime_test_key';
const gpx = '<gpx><trk><name>Synthetic runtime fixture</name><trkseg><trkpt lon="114" lat="22"><ele>10</ele></trkpt><trkpt lon="114.01" lat="22.01"><ele>20</ele></trkpt></trkseg></trk></gpx>';
const bundle = build({
  entryPoints: [join(root, 'server/worker.mjs')],
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'neutral',
  mainFields: ['module', 'main'],
  target: 'es2022',
}).then(result => result.outputFiles[0].text);

async function runtime(t, outboundService) {
  // Exercise the actual Workers fetch/Request implementation. A Node fetch
  // mock accepts redirect modes that workerd rejects before any Auth request.
  const worker = new Miniflare(convertV4MiniflareOptions({
    modules: true,
    compatibilityDate: configuration.compatibility_date,
    compatibilityFlags: configuration.compatibility_flags,
    cf: false,
    script: await bundle,
    bindings: {
      SUPABASE_URL: 'https://project.supabase.co',
      SUPABASE_PUBLISHABLE_KEY: publishableKey,
    },
    outboundService,
  }));
  t.after(() => worker.dispose());
  return worker;
}

async function upload(worker) {
  const form = new FormData();
  form.append('file', new File([gpx], 'synthetic-runtime.gpx', { type: 'application/gpx+xml' }));
  // Serialize before crossing Miniflare's separate undici implementation;
  // its FormData brand differs from Node's built-in web globals.
  const request = new Request(`${origin}/api/tracks/convert`, {
    method: 'POST',
    headers: { origin, authorization: `Bearer ${accessToken}` },
    body: form,
  });
  return worker.dispatchFetch(request.url, {
    method: 'POST',
    headers: {
      origin,
      authorization: `Bearer ${accessToken}`,
      'content-type': request.headers.get('content-type'),
    },
    body: await request.arrayBuffer(),
  });
}

test('bundled production Worker authenticates an admin and converts GPX in workerd', { timeout: 30000 }, async t => {
  const requests = [];
  const worker = await runtime(t, request => {
    requests.push({
      url: request.url,
      method: request.method,
      authorization: request.headers.get('authorization'),
      apikey: request.headers.get('apikey'),
    });
    return Response.json({ id: 'synthetic-admin', app_metadata: { role: 'admin' } });
  });

  const response = await upload(worker);
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.track.format, 'gpx');
  assert.equal(body.track.pointCount, 2);
  assert.deepEqual(body.track.geojson.geometry.coordinates, [[[114, 22, 10], [114.01, 22.01, 20]]]);
  assert.equal(body.track.stats.ascentM, 10);
  assert.deepEqual(requests, [{
    url: authUrl,
    method: 'GET',
    authorization: `Bearer ${accessToken}`,
    apikey: publishableKey,
  }]);
});

test('bundled production Worker rejects Auth redirects without sending credentials to another host', { timeout: 30000 }, async t => {
  const requests = [];
  const worker = await runtime(t, request => {
    requests.push(request.url);
    if (request.url === authUrl) return new Response(null, {
      status: 302,
      headers: { location: 'https://redirect-target.example/collect' },
    });
    return Response.json({ id: 'redirected-user', app_metadata: { role: 'admin' } });
  });

  const response = await upload(worker);
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.error.code, 'AUTH_UNAVAILABLE');
  assert.deepEqual(requests, [authUrl], 'an Auth redirect must never trigger a second request');
  assert.doesNotMatch(JSON.stringify(body), /runtime-test-access-token|sb_publishable_runtime_test_key/);
});
