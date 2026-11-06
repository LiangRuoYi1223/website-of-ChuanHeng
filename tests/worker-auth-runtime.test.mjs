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

async function upload(worker, { query = '', authorization = `Bearer ${accessToken}` } = {}) {
  const form = new FormData();
  form.append('file', new File([gpx], 'synthetic-runtime.gpx', { type: 'application/gpx+xml' }));
  // Serialize before crossing Miniflare's separate undici implementation;
  // its FormData brand differs from Node's built-in web globals.
  const headers = { origin, ...(authorization ? {authorization} : {}) };
  const request = new Request(`${origin}/api/tracks/convert${query}`, {
    method: 'POST',
    headers,
    body: form,
  });
  return worker.dispatchFetch(request.url, {
    method: 'POST',
    headers: {
      ...headers,
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

const overpassUrl = 'https://overpass.private.coffee/api/interpreter';
const mapData = {elements: [{type: 'way', id: 1, tags: {highway: 'path'}, geometry: [{lon: 114, lat: 22}, {lon: 114.01, lat: 22.01}]}]};
const geometry = {type: 'LineString', coordinates: [[114, 22], [114.01, 22.01]]};
function storedBasemap(worker, {authorization = `Bearer ${accessToken}`, requestOrigin = origin} = {}) {
  return worker.dispatchFetch(`${origin}/api/tracks/basemap`, {
    method: 'POST', headers: {origin: requestOrigin, 'content-type': 'application/json', ...(authorization ? {authorization} : {})},
    body: JSON.stringify({geojson: geometry}),
  });
}
function assertSavedBasemap(map) {
  assert.equal(map.version, 1);
  assert.equal(map.format, 'svg');
  assert.equal(map.projection, 'EPSG:3857');
  assert.equal(map.width, 1000); assert.equal(map.height, 600);
  assert.ok(map.bounds[0] < 114 && map.bounds[1] < 22 && map.bounds[2] > 114.01 && map.bounds[3] > 22.01);
  assert.ok(Number.isFinite(Date.parse(map.generatedAt)));
  assert.equal(map.license, 'ODbL-1.0');
  assert.match(map.image, /^data:image\/svg\+xml;base64,/);
  const svg = Buffer.from(map.image.split(',')[1], 'base64').toString('utf8');
  assert.match(svg, /<svg\b/); assert.match(svg, /<path\b/);
  assert.match(svg, /OpenStreetMap contributors/);
  assert.doesNotMatch(svg, /\b(?:href|onload)=|<(?:image|script|foreignObject)\b|url\(/);
}

test('workerd basemap upload authenticates first and stores one static Overpass image without leaking Auth headers', {timeout: 30000}, async t => {
  const requests = [];
  const worker = await runtime(t, async request => {
    requests.push({url: request.url, method: request.method, authorization: request.headers.get('authorization'), apikey: request.headers.get('apikey')});
    if (request.url === authUrl) return Response.json({id: 'synthetic-admin', app_metadata: {role: 'admin'}});
    assert.equal(request.url, overpassUrl);
    const query = new URLSearchParams(await request.text()).get('data');
    assert.match(query, /\[out:json\]/);
    assert.doesNotMatch(query, /Synthetic runtime fixture|runtime-test-access-token|sb_publishable/);
    return Response.json(mapData);
  });
  const response = await upload(worker, {query: '?basemap=1'});
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.track.pointCount, 2);
  assertSavedBasemap(body.track.basemap);
  assert.deepEqual(requests, [
    {url: authUrl, method: 'GET', authorization: `Bearer ${accessToken}`, apikey: publishableKey},
    {url: overpassUrl, method: 'POST', authorization: null, apikey: null},
  ]);
});

test('workerd stored-route basemap shares same-origin trusted-role checks and rejects token-free uploads before any map request', {timeout: 30000}, async t => {
  const requests = [];
  let role = 'member';
  const worker = await runtime(t, request => {
    requests.push(request.url);
    if (request.url === authUrl) return Response.json({id: 'synthetic-user', app_metadata: {role}, user_metadata: {role: 'admin'}});
    assert.equal(request.url, overpassUrl);
    assert.equal(request.headers.get('authorization'), null);
    assert.equal(request.headers.get('apikey'), null);
    return Response.json(mapData);
  });
  for (const response of [
    await upload(worker, {query: '?basemap=1&preview=1', authorization: ''}),
    await storedBasemap(worker, {authorization: ''}),
  ]) {
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, 'AUTH_REQUIRED');
  }
  assert.deepEqual(requests, []);
  const crossSite = await storedBasemap(worker, {requestOrigin: 'https://attacker.invalid'});
  assert.equal(crossSite.status, 403); assert.equal((await crossSite.json()).error.code, 'INVALID_ORIGIN');
  const member = await storedBasemap(worker);
  assert.equal(member.status, 403); assert.equal((await member.json()).error.code, 'FORBIDDEN');
  assert.deepEqual(requests, [authUrl]);
  role = 'admin';
  const response = await storedBasemap(worker);
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assertSavedBasemap(body.basemap);
  assert.deepEqual(requests, [authUrl, authUrl, overpassUrl]);
});

test('workerd rejects oversized or failed basemap responses without returning a partial converted track', {timeout: 30000}, async t => {
  for (const [reply, status, code] of [
    [() => new Response('busy', {status: 429}), 503, 'BASEMAP_UNAVAILABLE'],
    [() => new Response('x'.repeat(4 * 1024 * 1024 + 1)), 422, 'BASEMAP_DATA_TOO_LARGE'],
  ]) {
    const requests = [];
    const worker = await runtime(t, request => {
      requests.push(request.url);
      if (request.url === authUrl) return Response.json({id: 'synthetic-admin', app_metadata: {role: 'admin'}});
      assert.equal(request.url, overpassUrl);
      return reply();
    });
    const response = await upload(worker, {query: '?basemap=1'});
    const body = await response.json();
    assert.equal(response.status, status, JSON.stringify(body));
    assert.equal(body.error.code, code);
    assert.equal(Object.hasOwn(body, 'track'), false, 'an incomplete map generation must not replace the prior route');
    assert.equal(Object.hasOwn(body, 'basemap'), false);
    assert.deepEqual(requests, [authUrl, overpassUrl]);
    assert.doesNotMatch(JSON.stringify(body), /runtime-test-access-token|sb_publishable_runtime_test_key/);
  }
});
