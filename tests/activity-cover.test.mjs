import assert from 'node:assert/strict';
import test from 'node:test';
import { uploadActivityCover } from '../src/media/activity-cover.js';
const image = (type = 'image/jpeg', size = 1024) => ({ name: '照片.jpg', type, size });
const admin = { id: 'admin-uuid', app_metadata: { role: 'admin' } };
function clientFor({ user = admin, authError, uploadError } = {}) {
  const calls = [];
  return { calls, auth: { async getUser() { calls.push(['auth']); return { data: { user }, error: authError }; } }, storage: { from(bucket) { assert.equal(bucket, 'activity-covers'); return { async upload(path, file, options) { calls.push(['upload', path, file, options]); return { data: { path }, error: uploadError }; }, getPublicUrl(path) { return { data: { publicUrl: `https://test.supabase.co/storage/v1/object/public/activity-covers/${path}` } }; } }; } } };
}

test('validated administrator uploads immutable MIME-derived file path to dedicated cover bucket', async () => {
  const client = clientFor(); const file = image('image/webp');
  const result = await uploadActivityCover(client, file, { randomUUID: () => 'new-uuid' });
  assert.equal(result, 'https://test.supabase.co/storage/v1/object/public/activity-covers/admin-uuid/new-uuid.webp');
  assert.deepEqual(client.calls[1], ['upload', 'admin-uuid/new-uuid.webp', file, { upsert: false, contentType: 'image/webp', cacheControl: '3600' }]);
});

test('unsupported, empty and oversized covers are rejected before cloud reads or writes', async () => {
  const client = clientFor();
  for (const file of [image('image/svg+xml'), image('image/gif'), image('__proto__'), image('toString'), image('image/png', 5 * 1024 * 1024 + 1), image('image/jpeg', 0)]) await assert.rejects(() => uploadActivityCover(client, file));
  assert.equal(client.calls.length, 0);
});

test('ordinary users and editable user metadata never authorize storage upload', async () => {
  for (const user of [null, { id: 'member', user_metadata: { role: 'admin' } }, { id: 'member', app_metadata: { role: 'leader' } }]) {
    const client = clientFor({ user }); await assert.rejects(() => uploadActivityCover(client, image()), /管理员/);
    assert.equal(client.calls.filter(call => call[0] === 'upload').length, 0);
  }
});

test('storage and authentication errors propagate without overwrite or cleanup writes', async () => {
  const client = clientFor({ uploadError: new Error('upload unavailable') });
  await assert.rejects(() => uploadActivityCover(client, image()), /upload unavailable/);
  assert.equal(client.calls.filter(call => call[0] === 'upload').length, 1);
  const unauthenticated = clientFor({ authError: new Error('session unavailable') });
  await assert.rejects(() => uploadActivityCover(unauthenticated, image()), /管理员/);
});

test('local covers use bounded data URLs without accessing cloud services', async () => {
  let read;
  const file = image('image/png');
  const result = await uploadActivityCover(null, file, { local: true, readDataUrl: async value => { read = value; return 'data:image/png;base64,AQID'; } });
  assert.equal(read, file); assert.equal(result, 'data:image/png;base64,AQID');
  await assert.rejects(() => uploadActivityCover(null, image('image/png', 1024 * 1024 + 1), { local: true, readDataUrl: async () => { throw Error('must not read'); } }), /1 MiB/);
  await assert.rejects(() => uploadActivityCover(null, file, { local: true, readDataUrl: async () => 'data:text/html;base64,AQID' }), /图片/);
});
