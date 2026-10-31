import assert from 'node:assert/strict';
import test from 'node:test';
import { File } from 'node:buffer';
import { uploadActivityCover } from '../src/media/activity-cover.js';
const image = (type = 'image/jpeg', size = 1024) => new File([new Uint8Array(size)], 'photo.jpg', { type });
const admin = { id: 'admin-uuid', app_metadata: { role: 'admin' } };
const webp = new Uint8Array([82,73,70,70,4,0,0,0,87,69,66,80]);
function clientFor({ user = admin, authError, uploadError, token = 'test-token' } = {}) {
 const calls = [];
 return { calls, auth: { async getUser() { calls.push(['auth']); return { data: { user }, error: authError }; }, async getSession() { return { data: { session: token ? { access_token: token } : null }, error: null }; } }, storage: { from(bucket) { assert.equal(bucket, 'activity-covers'); return { async upload(path, file, options) { calls.push(['upload', path, file, options]); return { data: { path }, error: uploadError }; }, getPublicUrl(path) { return { data: { publicUrl: `https://test.supabase.co/storage/v1/object/public/activity-covers/${path}` } }; } }; } } };
}
const processed = () => new Response(webp, { headers: { 'content-type': 'image/webp', 'x-cover-processed': '1' } });
test('administrator first uses authenticated backend compression then uploads processed WebP only', async () => {
 const client = clientFor(); const file = image(); let request;
 const result = await uploadActivityCover(client, file, { randomUUID: () => 'new-uuid', fetchImpl: async (url, options) => { request = { url, options }; assert.equal(client.calls.filter(c => c[0] === 'upload').length, 0); return processed(); } });
 assert.equal(request.url, '/api/covers/process'); assert.equal(request.options.headers.Authorization, 'Bearer test-token');
 assert.equal(request.options.body.get('file'), file);
 assert.equal(result, 'https://test.supabase.co/storage/v1/object/public/activity-covers/admin-uuid/new-uuid.webp');
 const call = client.calls.find(c => c[0] === 'upload'); assert.equal(call[2].type, 'image/webp'); assert.equal(call[2].size, webp.length); assert.deepEqual(new Uint8Array(await call[2].arrayBuffer()), webp);
 assert.deepEqual(call[3], { upsert: false, contentType: 'image/webp', cacheControl: '3600' });
});
test('unsupported empty and above-three-MiB covers stop before Auth or writes', async () => {
 const client = clientFor();
 for (const file of [image('image/svg+xml'), image('image/gif'), image('image/png', 3*1024*1024+1), image('image/jpeg', 0)]) await assert.rejects(() => uploadActivityCover(client,file));
 assert.equal(client.calls.length,0);
});
test('ordinary identities and missing sessions never reach image processing or storage', async () => {
 for (const options of [{user:null},{user:{id:'member',user_metadata:{role:'admin'}}},{user:{id:'leader',app_metadata:{role:'leader'}}},{token:null}]) {
  const client=clientFor(options); await assert.rejects(()=>uploadActivityCover(client,image(),{fetchImpl:()=>{throw Error('must not request');}})); assert.equal(client.calls.filter(c=>c[0]==='upload').length,0);
 }
});
test('compression failures and unmarked or oversized outputs never store the original image',async()=>{
 for (const fetchImpl of [async()=>{throw Error('network');},async()=>Response.json({error:{message:'compression unavailable'}},{status:503}),async()=>new Response(webp,{headers:{'content-type':'image/webp'}}),async()=>new Response(new Uint8Array(3*1024*1024+1),{headers:{'content-type':'image/webp','x-cover-processed':'1'}})]) {
  const client=clientFor(); await assert.rejects(()=>uploadActivityCover(client,image(),{fetchImpl})); assert.equal(client.calls.filter(c=>c[0]==='upload').length,0);
 }
});
test('storage errors propagate after compression without overwrite or cleanup',async()=>{
 const client=clientFor({uploadError:Error('upload unavailable')}); await assert.rejects(()=>uploadActivityCover(client,image(),{fetchImpl:async()=>processed()}),/upload unavailable/); assert.equal(client.calls.filter(c=>c[0]==='upload').length,1);
});
test('local preview remains bounded and never sends raw data to cloud',async()=>{
 const file=image('image/png'); const result=await uploadActivityCover(null,file,{local:true,readDataUrl:async()=> 'data:image/png;base64,AQID'});assert.equal(result,'data:image/png;base64,AQID');
 await assert.rejects(()=>uploadActivityCover(null,image('image/png',1024*1024+1),{local:true}),/1 MiB/);
});
