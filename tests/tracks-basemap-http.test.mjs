import assert from 'node:assert/strict';
import { test } from 'node:test';
import { handleTrackRequest } from '../server/tracks/http.mjs';
import { TrackError } from '../server/tracks/parse.mjs';

const origin = 'https://frontend.invalid';
const env = { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_key' };
const geojson = { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[114, 22], [114.01, 22.01]] } };
const basemap = { version: 1, format: 'svg', image: 'data:image/svg+xml;base64,PHN2Zy8+', bounds: [113.99, 21.99, 114.02, 22.02], projection: 'EPSG:3857', width: 1000, height: 600, attribution: '© OpenStreetMap contributors', source: 'OpenStreetMap / Overpass API', generatedAt: '2030-01-01T00:00:00.000Z' };
const authorized = { fetchImpl: async () => Response.json({ id: 'verified', app_metadata: { role: 'admin' } }) };
function upload(query = '?basemap=1') {
  const form = new FormData();
  form.append('file', new File(['<gpx><trk><trkseg><trkpt lon="114" lat="22"/><trkpt lon="114.01" lat="22.01"/></trkseg></trk></gpx>'], 'synthetic.gpx'));
  return new Request(`${origin}/api/tracks/convert${query}`, { method: 'POST', headers: { origin, authorization: 'Bearer synthetic' }, body: form });
}
function existing(body = JSON.stringify({ geojson }), headers = {}) {
  return new Request(`${origin}/api/tracks/basemap`, { method: 'POST', headers: { origin, authorization: 'Bearer synthetic', 'content-type': 'application/json', ...headers }, body });
}
async function failure(response, status, code) {
  assert.equal(response.status, status);
  const body = await response.json();
  assert.equal(body.error.code, code);
  assert.doesNotMatch(body.error.message, /synthetic|secret|stack/);
}

test('opt-in conversion stores the generated basemap while normal conversion stays unchanged', async () => {
  let received;
  const createBasemap = async value => { received = value; return basemap; };
  const response = await handleTrackRequest(upload(), env, { ...authorized, createBasemap });
  assert.equal(response.status, 200);
  const { track } = await response.json();
  assert.deepEqual(received, track.geojson);
  assert.deepEqual(track.basemap, basemap);
  const normal = await handleTrackRequest(upload(''), env, { ...authorized, createBasemap() { assert.fail('normal conversion must not fetch map data'); } });
  assert.equal(normal.status, 200);
  assert.equal(Object.hasOwn((await normal.json()).track, 'basemap'), false);
});

test('stored-route endpoint generates from bounded GeoJSON and preserves trusted identity and same-origin checks', async () => {
  let processed = 0;
  const options = { ...authorized, createBasemap: async value => { processed++; assert.deepEqual(value, geojson); return basemap; } };
  const response = await handleTrackRequest(existing(), env, options);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { basemap });
  assert.equal(response.headers.get('cache-control'), 'no-store');
  await failure(await handleTrackRequest(existing(undefined, { origin: 'https://attacker.invalid' }), env, options), 403, 'INVALID_ORIGIN');
  await failure(await handleTrackRequest(existing(), env, { ...options, fetchImpl: async () => Response.json({ id: 'member', user_metadata: { role: 'admin' } }) }), 403, 'FORBIDDEN');
  await failure(await handleTrackRequest(existing(undefined, { authorization: '' }), env, options), 401, 'AUTH_REQUIRED');
  assert.equal(processed, 1);
});

test('processor absence and generation failures return explicit errors without a partial successful track', async () => {
  for (const request of [upload(), existing()]) await failure(await handleTrackRequest(request, env, authorized), 503, 'BASEMAP_UNAVAILABLE');
  await failure(await handleTrackRequest(upload(), env, { ...authorized, createBasemap() { throw new TrackError('BASEMAP_NO_FEATURES', '此范围暂无可用地图要素，请调整路线后重试。', 422); } }), 422, 'BASEMAP_NO_FEATURES');
  await failure(await handleTrackRequest(existing(), env, { ...authorized, createBasemap() { throw Error('secret detail'); } }), 502, 'BASEMAP_UNAVAILABLE');
  await failure(await handleTrackRequest(existing(), env, { ...authorized, createBasemap: async () => null }), 502, 'BASEMAP_UNAVAILABLE');
});

test('the JSON endpoint rejects wrong methods, media types, malformed data and oversized streamed requests', async () => {
  const options = { ...authorized, createBasemap() { assert.fail('invalid JSON must not reach the provider'); } };
  await failure(await handleTrackRequest(new Request(`${origin}/api/tracks/basemap`), env, options), 405, 'METHOD_NOT_ALLOWED');
  await failure(await handleTrackRequest(existing('{}', { 'content-type': 'text/plain' }), env, options), 415, 'UNSUPPORTED_MEDIA_TYPE');
  for (const body of ['{broken', '{}', '{"geojson":null}', '{"geojson":{},"extra":true}', '[]']) await failure(await handleTrackRequest(existing(body), env, options), 400, 'INVALID_BASEMAP_REQUEST');
  await failure(await handleTrackRequest(existing('{}', { 'content-length': String(5 * 1024 * 1024 + 1) }), env, options), 413, 'REQUEST_TOO_LARGE');
  let cancelled = false;
  const request = new Request(`${origin}/api/tracks/basemap`, { method: 'POST', duplex: 'half', headers: { origin, authorization: 'Bearer synthetic', 'content-type': 'application/json' }, body: new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(65536)); }, cancel() { cancelled = true; } }) });
  await failure(await handleTrackRequest(request, env, options), 413, 'REQUEST_TOO_LARGE');
  assert.equal(cancelled, true);
});
