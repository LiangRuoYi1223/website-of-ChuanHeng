import assert from 'node:assert/strict';
import test from 'node:test';
import { File } from 'node:buffer';
import { uploadGalleryPhoto } from '../src/media/gallery-photo.js';

const MiB = 1024 * 1024;
const image = (size = 1024, type = 'image/jpeg') => new File([new Uint8Array(size)], 'photo.jpg', { type });
const webp = Uint8Array.from([82, 73, 70, 70, 16, 0, 0, 0, 87, 69, 66, 80, 86, 80, 56, 76, 4, 0, 0, 0, 47, 0, 0, 0]);
const response = (bytes = webp, headers = { 'content-type': 'image/webp', 'x-photo-processed': '1' }) => new Response(bytes, { headers });
function clientFor({ user = { id: 'admin-uuid', app_metadata: { role: 'admin' } }, token = 'test-token', uploadError } = {}) {
  const calls = [];
  return { calls, auth: { async getUser() { calls.push(['auth']); return { data: { user } }; }, async getSession() { return { data: { session: token ? { access_token: token } : null } }; } }, storage: { from(bucket) {
    calls.push(['bucket', bucket]);
    return { async upload(...args) { calls.push(['upload', ...args]); return { error: uploadError }; }, getPublicUrl(path) { return { data: { publicUrl: `https://test.supabase.co/storage/v1/object/public/gallery-photos/${path}` } }; } };
  } } };
}
test('processes originals above 3 MiB through the 20 MiB boundary and stores only marked WebP with immutable random paths', async () => {
  for (const size of [3 * MiB + 1, 20 * MiB]) {
    const client = clientFor(), file = image(size); let request;
    const result = await uploadGalleryPhoto(client, file, { randomUUID: () => 'random-new-id', fetchImpl: async (url, options) => { request = { url, options }; assert.equal(client.calls.some(c => c[0] === 'upload'), false); return response(); } });
    assert.equal(request.url, '/api/photos/process'); assert.equal(request.options.method, 'POST'); assert.equal(request.options.headers.Authorization, 'Bearer test-token'); assert.equal(request.options.body.get('file'), file);
    assert.deepEqual(result, { url: 'https://test.supabase.co/storage/v1/object/public/gallery-photos/admin-uuid/random-new-id.webp', originalBytes: size, outputBytes: webp.length });
    assert.deepEqual(client.calls.find(c => c[0] === 'bucket'), ['bucket', 'gallery-photos']);
    const [, path, uploaded, options] = client.calls.find(c => c[0] === 'upload');
    assert.equal(path, 'admin-uuid/random-new-id.webp'); assert.equal(uploaded.type, 'image/webp'); assert.deepEqual(new Uint8Array(await uploaded.arrayBuffer()), webp);
    assert.deepEqual(options, { upsert: false, contentType: 'image/webp', cacheControl: '3600' });
  }
});
test('empty unsupported and oversized originals stop before authentication or processing', async () => {
  const client = clientFor(); let requested = false;
  for (const file of [image(0), image(20 * MiB + 1), image(1, 'image/svg+xml'), image(1, 'image/gif')]) await assert.rejects(() => uploadGalleryPhoto(client, file, { fetchImpl: () => { requested = true; } }));
  assert.equal(requested, false); assert.equal(client.calls.length, 0);
});
test('only verified app metadata administrators with sessions may process and store in live mode', async () => {
  for (const options of [{ user: null }, { user: { id: 'member', user_metadata: { role: 'admin' } } }, { user: { id: 'leader', app_metadata: { role: 'leader' } } }, { token: null }]) {
    const client = clientFor(options); let requested = false;
    await assert.rejects(() => uploadGalleryPhoto(client, image(), { fetchImpl: () => { requested = true; } }));
    assert.equal(requested, false); assert.equal(client.calls.some(c => c[0] === 'upload'), false);
  }
});
test('service errors, invalid markers, forged formats and out-of-bound results never reach storage', async () => {
  for (const fetchImpl of [async () => { throw Error('network'); }, async () => Response.json({ error: { message: 'backend unavailable' } }, { status: 503 }), async () => response(webp, { 'content-type': 'image/webp' }), async () => response(webp, { 'content-type': 'image/png', 'x-photo-processed': '1' }), async () => response(new Uint8Array()), async () => response(new Uint8Array(3 * MiB + 1)), async () => response(new Uint8Array(24)), async () => response(webp.slice(0, 11))]) {
    const client = clientFor(); await assert.rejects(() => uploadGalleryPhoto(client, image(), { fetchImpl })); assert.equal(client.calls.some(c => c[0] === 'upload'), false);
  }
});
test('storage failure propagates without overwrite or cleanup', async () => {
  const client = clientFor({ uploadError: Error('storage unavailable') });
  await assert.rejects(() => uploadGalleryPhoto(client, image(), { fetchImpl: async () => response() }), /storage unavailable/);
  assert.equal(client.calls.filter(c => c[0] === 'upload').length, 1);
});
test('local mode processes on backend before reading bounded WebP data URL and never touches cloud', async () => {
  const client = clientFor(), stages = [], file = image(5 * MiB);
  const result = await uploadGalleryPhoto(client, file, { local: true, fetchImpl: async (url, options) => { stages.push('process'); assert.equal(url, '/api/photos/process'); assert.equal(options.headers.Authorization, undefined); return response(); }, readDataUrl: async output => { stages.push('read'); assert.equal(output.type, 'image/webp'); assert.deepEqual(new Uint8Array(await output.arrayBuffer()), webp); return `data:image/webp;base64,${Buffer.from(webp).toString('base64')}`; } });
  assert.deepEqual(stages, ['process', 'read']); assert.equal(client.calls.length, 0); assert.equal(result.originalBytes, file.size); assert.equal(result.outputBytes, webp.length); assert.match(result.url, /^data:image\/webp;base64,/);
  await assert.rejects(() => uploadGalleryPhoto(null, image(), { local: true, fetchImpl: async () => response(), readDataUrl: async () => 'data:image/png;base64,AAAA' }));
});
test('aborted processing never starts or resumes storage', async () => {
  const controller = new AbortController(), client = clientFor();
  await assert.rejects(() => uploadGalleryPhoto(client, image(), { signal: controller.signal, fetchImpl: async (url, options) => { assert.ok(options.signal); controller.abort(); return response(); } }));
  assert.equal(client.calls.some(c => c[0] === 'upload'), false);
});
test('exactly 3 MiB of processed WebP is accepted while local errors never invoke the preview reader', async () => {
  const bytes = new Uint8Array(3 * MiB); bytes.set(webp);
  const client = clientFor();
  const result = await uploadGalleryPhoto(client, image(), { fetchImpl: async () => response(bytes) });
  assert.equal(result.outputBytes, 3 * MiB);
  let reads = 0;
  await assert.rejects(() => uploadGalleryPhoto(null, image(), { local: true, fetchImpl: async () => Response.json({ error: { message: 'backend unavailable' } }, { status: 503 }), readDataUrl: async () => { reads++; } }), /backend unavailable/);
  assert.equal(reads, 0);
});
