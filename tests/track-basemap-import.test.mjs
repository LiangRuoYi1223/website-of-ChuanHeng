import assert from 'node:assert/strict';
import test from 'node:test';
import * as client from '../src/tracks/import-client.js';
import { createRouteBasemap } from '../server/basemaps/create-route-basemap.mjs';

const track = {version:1,name:'合成路线',pointCount:2,segmentCount:1,stats:{distanceM:1500,ascentM:20},profile:[],segments:[],geojson:{type:'Feature',geometry:{type:'MultiLineString',coordinates:[[[114,22,10],[114.01,22.01,30]]]}}};
const basemap = await createRouteBasemap(track.geojson,{loadElements:async()=>({elements:[{type:'way',tags:{highway:'path'},geometry:[{lon:114,lat:22},{lon:114.01,lat:22.01}]}]})});

test('route upload explicitly prepares and validates its single saved basemap',async()=>{
  let calls=0;
  const result=await client.convertTrackFile(new File(['synthetic'],'test.gpx'),{prepareBasemap:true,token:'synthetic-token',fetchImpl:async(url,options)=>{
    calls++;assert.equal(url,'/api/tracks/convert?basemap=1');
    assert.equal(options.headers.Authorization,'Bearer synthetic-token');
    assert.deepEqual([...options.body.keys()],['file']);
    return Response.json({track:{...track,basemap}});
  }});
  assert.equal(calls,1);assert.deepEqual(result.basemap,basemap);
});

test('required map missing or unsafe from conversion never replaces an existing route',async()=>{
  for(const value of [undefined,{...basemap,image:'https://tiles.invalid/map.svg'}, {...basemap,image:`data:image/svg+xml;base64,${Buffer.from('<svg><script>alert(1)</script></svg>').toString('base64')}`}]){
    await assert.rejects(client.convertTrackFile(new File(['synthetic'],'test.gpx'),{prepareBasemap:true,fetchImpl:async()=>Response.json({track:{...track,basemap:value}})}),/底图/);
  }
});

test('malformed importer display metadata is rejected before it reaches the route editor',async()=>{
  for(const change of [{pointCount:undefined},{pointCount:30001},{segmentCount:0},{segments:[null]},{segments:[{index:0,name:{unsafe:'object'}}]},{name:{}},{sourceFile:[]}]){
    await assert.rejects(client.convertTrackFile(new File(['synthetic'],'test.gpx'),{prepareBasemap:true,fetchImpl:async()=>Response.json({track:{...track,basemap,...change}})}),/轨迹数据无效/);
  }
});

test('existing route map is generated only by an authenticated same-origin request with coordinates',async()=>{
  assert.equal(typeof client.generateTrackBasemap,'function');
  const signal=new AbortController().signal;
  const result=await client.generateTrackBasemap(track,{token:'synthetic-token',signal,fetchImpl:async(url,options)=>{
    assert.equal(url,'/api/tracks/basemap');assert.equal(options.method,'POST');
    assert.equal(options.headers.Authorization,'Bearer synthetic-token');assert.equal(options.headers['content-type'],'application/json');
    assert.equal(options.signal,signal);assert.deepEqual(JSON.parse(options.body),{geojson:track.geojson});
    assert.ok(!options.body.includes('合成路线'));
    return Response.json({basemap});
  }});
  assert.deepEqual(result,basemap);
  assert.equal(track.basemap,undefined,'generation does not mutate caller or historical snapshots');
});

test('map generation rejects unsafe output, upstream failure, cancellation and malformed track',async()=>{
  assert.equal(typeof client.generateTrackBasemap,'function');
  await assert.rejects(client.generateTrackBasemap(track,{fetchImpl:async()=>Response.json({basemap:{...basemap,bounds:[114,22,114,23]}})}),/底图/);
  await assert.rejects(client.generateTrackBasemap(track,{fetchImpl:async()=>Response.json({error:{message:'地图服务繁忙'}},{status:503})}),/地图服务繁忙/);
  await assert.rejects(client.generateTrackBasemap(track,{fetchImpl:async()=>new Response('<html/>')}),/底图/);
  const cancelled=new DOMException('cancelled','AbortError');
  await assert.rejects(client.generateTrackBasemap(track,{fetchImpl:async()=>{throw cancelled}}),error=>error===cancelled);
  await assert.rejects(client.generateTrackBasemap({name:'no coordinates'},{fetchImpl:async()=>assert.fail('invalid geometry must not leave browser')}),/坐标/);
});
