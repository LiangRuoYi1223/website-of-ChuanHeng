import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createServer} from 'node:http';
import {test} from 'node:test';
import {tracksVitePlugin} from '../server/tracks/vite-plugin.mjs';
import {archiveResponse, catalogUrl} from './fixtures/pmtiles-basemap.mjs';

const env = {SUPABASE_URL: 'https://project.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_adapter_fixture'};
const authUrl = 'https://project.supabase.co/auth/v1/user';
const geojson = {type: 'LineString', coordinates: [[114, 22], [114.01, 22.01]]};
async function listen(t, hook, options) {
  let middleware;
  tracksVitePlugin(options)[hook]({middlewares: {use(handler) {middleware = handler;}}});
  const server = createServer((incoming, outgoing) => middleware(incoming, outgoing, () => {outgoing.statusCode = 404; outgoing.end();}));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => {server.closeAllConnections(); await new Promise(resolve => server.close(resolve));});
  return `http://127.0.0.1:${server.address().port}`;
}

test('both Vite adapters authenticate before preparing a static basemap with the configured outbound fetch', {timeout: 15000}, async t => {
  for (const hook of ['configureServer', 'configurePreviewServer']) await t.test(hook, async t => {
    const requests = [];
    const origin = await listen(t, hook, {env, fetchImpl: async (url, options) => {
      requests.push({url, options});
      if (url === authUrl) return Response.json({id: 'synthetic-admin', app_metadata: {role: 'admin'}});
      assert.equal(new Headers(options.headers).get('authorization'), null);
      assert.equal(new Headers(options.headers).get('apikey'), null);
      return archiveResponse(url, options);
    }});
    const response = await fetch(`${origin}/api/tracks/basemap`, {method: 'POST', headers: {origin, authorization: 'Bearer synthetic-adapter', 'content-type': 'application/json'}, body: JSON.stringify({geojson})});
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    assert.equal(result.basemap.projection, 'EPSG:3857');
    assert.match(result.basemap.image, /^data:image\/svg\+xml;base64,/);
    assert.deepEqual(requests.slice(0, 2).map(request => request.url), [authUrl, catalogUrl]);
    assert.ok(requests.length > 2, 'the actual archive protocol loads header and vector tile ranges');
    for (const request of requests.slice(2)) assert.match(new Headers(request.options.headers).get('range'), /^bytes=\d+-\d+$/);
    const authorizedRequests = requests.length;
    assert.equal(requests[0].options.headers.authorization, 'Bearer synthetic-adapter');
    const rejected = await fetch(`${origin}/api/tracks/basemap`, {method: 'POST', headers: {origin, 'content-type': 'application/json'}, body: JSON.stringify({geojson})});
    assert.equal(rejected.status, 401);
    assert.equal((await rejected.json()).error.code, 'AUTH_REQUIRED');
    assert.equal(requests.length, authorizedRequests, 'missing identity must stop before Auth or map data requests');
  });
});

test('Vite accepts a trusted processor injection only after its normal identity gate', {timeout: 15000}, async t => {
  const seen = [];
  const basemap = {version: 1, image: 'data:image/svg+xml;base64,PHN2Zy8+'};
  const origin = await listen(t, 'configureServer', {env, fetchImpl: async url => {
    assert.equal(url, authUrl);
    return Response.json({id: 'synthetic-admin', app_metadata: {role: 'admin'}});
  }, createBasemap: async (geometry, {signal}) => {seen.push({geometry, signal}); return basemap;}});
  const response = await fetch(`${origin}/api/tracks/basemap`, {method: 'POST', headers: {origin, authorization: 'Bearer synthetic-adapter', 'content-type': 'application/json'}, body: JSON.stringify({geojson})});
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {basemap});
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0].geometry, geojson);
  assert.ok(seen[0].signal instanceof AbortSignal);
  assert.equal(seen[0].signal.aborted, false);
});
