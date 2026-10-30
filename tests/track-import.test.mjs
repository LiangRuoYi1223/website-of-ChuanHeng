import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';

let store, client;
try { store = await import('../src/tracks/track-store.js'); } catch {}
try { client = await import('../src/tracks/import-client.js'); } catch {}
test('track persistence and server conversion client are available', () => {
  assert.equal(typeof store?.putLocalTrack, 'function');
  assert.equal(typeof client?.convertTrackFile, 'function');
});

const track = {version:1,name:'合成测试轨迹',pointCount:4,segmentCount:2,stats:{distanceM:1250,ascentM:null},geojson:{type:'Feature',geometry:{type:'MultiLineString',coordinates:[[[114,22],[114.1,22.1]],[[114.2,22.2],[114.3,22.3]]]}},segments:[],profile:[],warnings:[]};
test('IndexedDB keeps all disconnected segments and null elevation after reopening', {skip:!store}, async () => {
  const id = await store.putLocalTrack(track);
  assert.ok(id);
  assert.deepEqual(await store.getLocalTrack(id),track);
  assert.equal(await store.getLocalTrack('missing'),null);
  await store.deleteLocalTrack(id);
  assert.equal(await store.getLocalTrack(id),null);
});
test('normalized route payload uses computed distances and does not invent ascent', {skip:!store}, () => {
  const p = store.routePayloadFromTrack(track,'  新路线  ');
  assert.equal(p.title,'新路线'); assert.equal(p.distance,1.25); assert.equal(p.ascent,null);
  assert.equal(p.isDemo,false); assert.equal(p.verified,false);
});
test('upload client posts exactly one file to the conversion backend', {skip:!client}, async () => {
  const file = new File(['<gpx/>'],'test.gpx');
  const result = await client.convertTrackFile(file,{fetchImpl:async (url,options) => {
    assert.equal(url,'/api/tracks/convert');assert.equal(options.method,'POST');
    assert.equal(options.body.get('file').name,'test.gpx');
    assert.equal(options.headers.Authorization,'Bearer validated-session-token');
    assert.deepEqual([...options.body.keys()],['file']);
    return Response.json({track});
  },token:'validated-session-token'});
  assert.deepEqual(result,track);
});
test('HTTP failure is surfaced without pretending conversion succeeded', {skip:!client}, async () => {
  await assert.rejects(client.convertTrackFile(new File(['x'],'broken.kml'),{fetchImpl:async () => Response.json({error:{code:'INVALID_XML',message:'文件格式无效'}},{status:400})}),/文件格式无效/);
});
test('wrong extension, empty and oversized files never leave browser', {skip:!client}, async () => {
  const fetchImpl = async () => {assert.fail('must not send rejected file')};
  for(const file of [new File(['x'],'track.zip'),new File([],'empty.gpx'),new File([new Uint8Array(5*1024*1024+1)],'large.kml')]) await assert.rejects(client.convertTrackFile(file,{fetchImpl}));
});
test('SPA HTML fallback cannot be treated as conversion success', {skip:!client}, async () => {
  await assert.rejects(client.convertTrackFile(new File(['x'],'track.gpx'),{fetchImpl:async()=>new Response('<html/>')}),/转换服务/);
});
