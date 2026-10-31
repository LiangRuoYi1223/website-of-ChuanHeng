import assert from 'node:assert/strict';
import test from 'node:test';
import { File } from 'node:buffer';
import { createServer, request as nodeRequest } from 'node:http';
import { once } from 'node:events';
import { handleTrackRequest, MAX_FILE_BYTES, MAX_REQUEST_BYTES } from '../server/tracks/http.mjs';
import { tracksVitePlugin, isLocalPreviewRequest } from '../server/tracks/vite-plugin.mjs';
import worker from '../server/worker.mjs';

const origin = 'https://chuanheng.example';
const env = { SUPABASE_URL: 'https://project.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_key' };
const gpx = '<gpx><trk><name>测试路线</name><trkseg><trkpt lon="114" lat="22"><ele>10</ele></trkpt><trkpt lon="114.01" lat="22.01"><ele>20</ele></trkpt></trkseg></trk></gpx>';
const kml = '<kml><Placemark><LineString><altitudeMode>absolute</altitudeMode><coordinates>114,22,10 114.01,22.01,20</coordinates></LineString></Placemark></kml>';
const authResponse = role => Response.json({ id: 'verified-user', app_metadata: { role } });
const authorized = { fetchImpl: async () => authResponse('leader') };
function upload({ filename = 'test.gpx', bytes = gpx, url = `${origin}/api/tracks/convert`, headers = {}, form } = {}) {
  const body = form || new FormData();
  if (!form) body.append('file', new File([bytes], filename, { type: 'application/octet-stream' }));
  return new Request(url, { method: 'POST', headers: { origin: new URL(url).origin, authorization: 'Bearer test-access-token', ...headers }, body });
}
async function errorResponse(response, status, code) {
  assert.equal(response.status, status);
  assert.match(response.headers.get('content-type'), /application\/json/);
  assert.equal(response.headers.get('access-control-allow-origin'), null);
  const body = await response.json();
  assert.equal(typeof body.error?.message, 'string');
  assert.ok(body.error.message.length > 0 && body.error.message.length < 400);
  if (code) assert.equal(body.error.code, code);
  assert.doesNotMatch(JSON.stringify(body), /test-access-token|sb_publishable_test_key|stack|Error: /);
  return body;
}

test('same-origin authenticated GPX/KML upload returns real converted geometry and makes only an Auth read', async () => {
  for (const [filename, bytes, format] of [['route.GPX', gpx, 'gpx'], ['route.kml', kml, 'kml']]) {
    const calls = [];
    const response = await handleTrackRequest(upload({ filename, bytes }), env, { fetchImpl: async (url, options) => {
      calls.push({ url, options });
      assert.equal(url, `${env.SUPABASE_URL}/auth/v1/user`);
      assert.equal(options.method, 'GET');
      assert.equal(options.headers.authorization, 'Bearer test-access-token');
      assert.equal(options.headers.apikey, env.SUPABASE_PUBLISHABLE_KEY);
      assert.ok(options.signal instanceof AbortSignal);
      return authResponse('leader');
    } });
    assert.equal(response.status, 200);
    const { track } = await response.json();
    assert.equal(track.format, format);
    assert.equal(track.pointCount, 2);
    assert.deepEqual(track.geojson.geometry.coordinates, [[[114, 22, 10], [114.01, 22.01, 20]]]);
    assert.equal(track.stats.ascentM, 10);
    assert.equal(calls.length, 1);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
});

test('KML uploads without altitudeMode retain supplied gx:Track elevations in the shared converter', async () => {
  const bytes='<kml xmlns:gx="http://www.google.com/kml/ext/2.2"><Placemark><gx:Track><gx:coord>114 22 100</gx:coord><gx:coord>114.01 22.01 150</gx:coord></gx:Track></Placemark></kml>';
  const response=await handleTrackRequest(upload({filename:'recording.kml',bytes}),env,authorized);
  assert.equal(response.status,200);
  const {track}=await response.json();
  assert.deepEqual(track.profile.map(point=>point.elevationM),[100,150]);
  assert.equal(track.stats.elevationCoverage,1);
  assert.equal(track.stats.ascentM,50);
  assert.ok(track.warnings.some(warning=>/未声明海拔模式/.test(warning)));
});

test('status is explicit and absent, unsafe or secret backend configuration fails closed', async () => {
  const status = await handleTrackRequest(new Request(`${origin}/api/tracks/status`));
  assert.deepEqual(await status.json(), { localPreview: false, configured: false });
  const configured = await handleTrackRequest(new Request(`${origin}/api/tracks/status`), env);
  assert.deepEqual(await configured.json(), { localPreview: false, configured: true });
  for (const configuration of [{}, { ...env, SUPABASE_URL: 'http://project.supabase.co' }, { ...env, SUPABASE_PUBLISHABLE_KEY: 'sb_secret_do_not_expose' }]) {
    await errorResponse(await handleTrackRequest(upload(), configuration, authorized), 503);
  }
});

test('Origin is mandatory and must match; cross-site requests never contact Auth', async () => {
  for (const headers of [{ origin: '' }, { origin: 'null' }, { origin: 'https://attacker.example' }, { 'sec-fetch-site': 'cross-site' }]) {
    let called = false;
    const response = await handleTrackRequest(upload({ headers }), env, { fetchImpl: async () => { called = true; throw new Error('must not run'); } });
    await errorResponse(response, 403, 'INVALID_ORIGIN');
    assert.equal(called, false);
  }
});

test('only verified app_metadata leader/admin roles are authorized', async () => {
  for (const role of ['leader', 'admin']) assert.equal((await handleTrackRequest(upload(), env, { fetchImpl: async () => authResponse(role) })).status, 200);
  for (const user of [
    { id: 'ordinary', app_metadata: { role: 'member' }, user_metadata: { role: 'admin' } },
    { id: 'ordinary', user_metadata: { role: 'leader' } },
    { app_metadata: { role: 'admin' } },
  ]) await errorResponse(await handleTrackRequest(upload(), env, { fetchImpl: async () => Response.json(user) }), 403);
  await errorResponse(await handleTrackRequest(upload({ headers: { authorization: '' } }), env, authorized), 401);
  await errorResponse(await handleTrackRequest(upload({ headers: { authorization: 'Basic token' } }), env, authorized), 401);
  await errorResponse(await handleTrackRequest(upload(), env, { fetchImpl: async () => new Response('denied', { status: 401 }) }), 401);
});

test('Auth network errors, oversized/invalid replies, redirects and stalls fail closed with a bounded timeout', async () => {
  for (const fetchImpl of [
    async () => { throw new Error('network detail must stay private'); },
    async () => new Response('service down', { status: 503 }),
    async () => new Response('not JSON'),
    async () => new Response('x'.repeat(70 * 1024)),
    async () => new Response(null, { status: 302, headers: { location: 'https://attacker.example' } }),
  ]) await errorResponse(await handleTrackRequest(upload(), env, { fetchImpl }), 503);
  let signal;
  const started = Date.now();
  await errorResponse(await handleTrackRequest(upload(), env, { authTimeoutMs: 20, fetchImpl: async (_url, options) => { signal = options.signal; return new Promise(() => {}); } }), 504, 'AUTH_TIMEOUT');
  assert.ok(signal.aborted);
  assert.ok(Date.now() - started < 2000);
  const stalledBody = new Response(new ReadableStream({ start() {} }));
  await errorResponse(await handleTrackRequest(upload(), env, { authTimeoutMs: 20, fetchImpl: async () => stalledBody }), 504, 'AUTH_TIMEOUT');
});

test('multipart contains exactly one file field and requires a GPX/KML filename', async () => {
  for (const makeForm of [
    () => new FormData(),
    () => { const form = new FormData(); form.append('file', 'not a file'); return form; },
    () => { const form = new FormData(); form.append('wrong', new File([gpx], 'x.gpx')); return form; },
    () => { const form = new FormData(); form.append('file', new File([gpx], 'x.gpx')); form.append('file', new File([gpx], 'y.gpx')); return form; },
    () => { const form = new FormData(); form.append('file', new File([gpx], 'x.gpx')); form.append('metadata', 'extra'); return form; },
  ]) await errorResponse(await handleTrackRequest(upload({ form: makeForm() }), env, authorized), 400, 'INVALID_UPLOAD');
  await errorResponse(await handleTrackRequest(upload({ filename: 'x.xml' }), env, authorized), 415, 'UNSUPPORTED_FORMAT');
  const wrongType = new Request(`${origin}/api/tracks/convert`, { method: 'POST', headers: { origin, authorization: 'Bearer test-access-token', 'content-type': 'application/json' }, body: '{}' });
  await errorResponse(await handleTrackRequest(wrongType, env, authorized), 415);
  const badMultipart = new Request(`${origin}/api/tracks/convert`, { method: 'POST', headers: { origin, authorization: 'Bearer test-access-token', 'content-type': 'multipart/form-data; boundary=broken' }, body: 'not multipart' });
  await errorResponse(await handleTrackRequest(badMultipart, env, authorized), 400);
});

test('invalid UTF-8 and unsafe XML are rejected instead of being repaired or resolved', async () => {
  await errorResponse(await handleTrackRequest(upload({ bytes: new Uint8Array([0xc3, 0x28]) }), env, authorized), 400, 'INVALID_ENCODING');
  await errorResponse(await handleTrackRequest(upload({ bytes: '<!DOCTYPE gpx [<!ENTITY x SYSTEM "https://attacker.example">]><gpx>&x;</gpx>' }), env, authorized), 400, 'UNSAFE_XML');
});

test('file and total request limits are checked independently, including streamed bodies without Content-Length', async () => {
  assert.equal(MAX_FILE_BYTES, 5 * 1024 * 1024);
  assert.equal(MAX_REQUEST_BYTES, MAX_FILE_BYTES + 64 * 1024);
  await errorResponse(await handleTrackRequest(upload({ bytes: new Uint8Array(MAX_FILE_BYTES + 1) }), env, authorized), 413, 'FILE_TOO_LARGE');
  const tooLong = upload({ headers: { 'content-length': String(MAX_REQUEST_BYTES + 1) } });
  await errorResponse(await handleTrackRequest(tooLong, env, authorized), 413, 'REQUEST_TOO_LARGE');
  let cancelled = false;
  let sent = 0;
  const stream = new ReadableStream({ pull(controller) { sent += 65536; controller.enqueue(new Uint8Array(65536)); }, cancel() { cancelled = true; } }, { highWaterMark: 0 });
  const request = new Request(`${origin}/api/tracks/convert`, { method: 'POST', headers: { origin, authorization: 'Bearer test-access-token', 'content-type': 'multipart/form-data; boundary=x' }, body: stream, duplex: 'half' });
  await errorResponse(await handleTrackRequest(request, env, authorized), 413, 'REQUEST_TOO_LARGE');
  assert.ok(cancelled);
  assert.ok(sent <= MAX_REQUEST_BYTES + 65536, 'reader must stop when the byte budget is exceeded');
});

test('API methods/unknown paths return JSON and non-API requests are delegated', async () => {
  for (const [pathname, method] of [['/api/tracks/convert', 'GET'], ['/api/tracks/status', 'POST'], ['/api/tracks/convert', 'OPTIONS']]) {
    await errorResponse(await handleTrackRequest(new Request(`${origin}${pathname}`, { method }), env), 405, 'METHOD_NOT_ALLOWED');
  }
  await errorResponse(await handleTrackRequest(new Request(`${origin}/api/unknown`)), 404, 'NOT_FOUND');
  assert.equal(await handleTrackRequest(new Request(`${origin}/routes`)), null);
});

test('local bypass requires explicit option, loopback Host and loopback socket endpoints', async () => {
  const local = upload({ url: 'http://127.0.0.1:5178/api/tracks/convert', headers: { authorization: '' } });
  assert.equal((await handleTrackRequest(local, {}, { localPreview: true })).status, 200);
  await errorResponse(await handleTrackRequest(upload({ url: 'http://127.0.0.1:5178/api/tracks/convert?preview=1' }), { LOCAL_PREVIEW: 'true' }), 503);
  await errorResponse(await handleTrackRequest(upload(), {}, { localPreview: true }), 503);
  const request = { headers: { host: 'localhost:5178' }, socket: { localAddress: '127.0.0.1', remoteAddress: '::ffff:127.0.0.1' } };
  assert.equal(isLocalPreviewRequest(request, true), true);
  assert.equal(isLocalPreviewRequest(request, false), false);
  assert.equal(isLocalPreviewRequest({ ...request, headers: { host: 'public.example' } }, true), false);
  assert.equal(isLocalPreviewRequest({ ...request, socket: { ...request.socket, localAddress: '0.0.0.0' } }, true), false);
  assert.equal(isLocalPreviewRequest({ ...request, socket: { ...request.socket, remoteAddress: '192.0.2.5' } }, true), false);
});

test('both Vite hooks install a working bounded Node-to-Request adapter', async t => {
  for (const hook of ['configureServer', 'configurePreviewServer']) await t.test(hook, async () => {
    let middleware;
    const plugin = tracksVitePlugin({ localPreview: true, env: {} });
    plugin[hook]({ middlewares: { use(fn) { middleware = fn; } } });
    assert.equal(typeof middleware, 'function');
    const server = createServer((request, response) => middleware(request, response, () => { response.end('static asset'); }));
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    try {
      const localOrigin = `http://127.0.0.1:${server.address().port}`;
      const response = await fetch(upload({ url: `${localOrigin}/api/tracks/convert`, headers: { authorization: '' } }));
      assert.equal(response.status, 200);
      assert.equal((await response.json()).track.pointCount, 2);
      const status = await fetch(`${localOrigin}/api/tracks/status`);
      assert.deepEqual(await status.json(), { localPreview: true, configured: false });
      // Fetch controls Host itself. Use the HTTP transport for this one spoofed
      // authority test, while retaining the real FormData-generated request body.
      const forged = upload({ url: `${localOrigin}/api/tracks/convert`, headers: { origin: 'http://public.example' } });
      const encoded = new Uint8Array(await forged.arrayBuffer());
      const hostileHost = await new Promise((resolve, reject) => {
        const connection = nodeRequest(`${localOrigin}/api/tracks/convert`, { method: 'POST', headers: { ...Object.fromEntries(forged.headers), host: 'public.example', 'content-length': encoded.byteLength } }, response => {
          const chunks = [];
          response.on('data', chunk => chunks.push(chunk));
          response.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: response.statusCode, headers: response.headers })));
        });
        connection.on('error', reject);
        connection.end(encoded);
      });
      await errorResponse(hostileHost, 503);
      // Deliberately oversized declared length is rejected without first sending
      // the complete body. Native HTTP observes that response before closing.
      const oversized = await new Promise((resolve, reject) => {
        const connection = nodeRequest(`${localOrigin}/api/tracks/convert`, { method: 'POST', headers: { origin: localOrigin, 'content-type': 'multipart/form-data; boundary=x', 'content-length': MAX_REQUEST_BYTES + 1 } }, response => {
          const chunks = [];
          response.on('data', chunk => chunks.push(chunk));
          response.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: response.statusCode, headers: response.headers })));
        });
        connection.on('error', reject);
        connection.end('x');
      });
      await errorResponse(oversized, 413, 'REQUEST_TOO_LARGE');
      assert.equal(await (await fetch(`${localOrigin}/routes`)).text(), 'static asset');
    } finally {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  });
});

test('production worker never enables local preview and sends only non-API paths to ASSETS', async () => {
  let assetsCalled = 0;
  const workerEnv = { LOCAL_PREVIEW: 'true', ASSETS: { fetch: async () => { assetsCalled++; return new Response('asset'); } } };
  const response = await worker.fetch(upload({ url: 'http://localhost/api/tracks/convert?preview=1' }), workerEnv);
  await errorResponse(response, 503);
  assert.equal(assetsCalled, 0);
  const status = await worker.fetch(new Request('http://localhost/api/tracks/status'), workerEnv);
  assert.deepEqual(await status.json(), { localPreview: false, configured: false });
  await errorResponse(await worker.fetch(new Request(`${origin}/api/not-found`), workerEnv), 404);
  assert.equal(await (await worker.fetch(new Request(`${origin}/about`), workerEnv)).text(), 'asset');
  assert.equal(assetsCalled, 1);
});
