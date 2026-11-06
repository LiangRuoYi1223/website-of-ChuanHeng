import assert from 'node:assert/strict';
import {test} from 'node:test';
import {gzipSync} from 'node:zlib';
import {zxyToTileId} from 'pmtiles';
import {loadBasemapElements} from '../server/basemaps/pmtiles-source.mjs';
import {archive,archiveUrl,archiveEtag,archiveResponse,makeArchive,makeMvt,defaultLayers} from './fixtures/pmtiles-basemap.mjs';

const catalogUrl = 'https://build-metadata.protomaps.dev/builds.json';
const bounds = [114,22,114.01,22.01];
const now = Date.parse('2026-11-06T18:00:00Z');
const catalog = bytes => [{key:'20261106.pmtiles',size:bytes.length,uploaded:'2026-11-06T01:00:00Z',version:'4.15.2'}];
function fixtureFetch(bytes = archive, {catalogRecords = catalog(bytes), transform} = {}) {
  return async (url,options) => {
    if(url === catalogUrl)return Response.json(catalogRecords);
    const response = archiveResponse(url,options,bytes);
    return transform ? transform(response,url,options) : response;
  };
}

test('real PMTiles directory and MVT bytes become only genuine whitelisted map elements',async()=>{
  const calls=[];
  const result=await loadBasemapElements(bounds,{now,fetchImpl:async(url,options)=>{calls.push({url,options});return fixtureFetch()(url,options)}});
  assert.ok(result.elements.length > 0, 'the real SDK must decode the synthetic archive and tile');
  assert.equal(result.archive,archiveUrl);
  assert.equal(result.source,'Protomaps / OpenStreetMap');
  assert.ok(result.zoom>=10&&result.zoom<=13);
  assert.ok(result.tileCount>=1&&result.tileCount<=12);
  assert.ok(result.downloadedBytes<=4*1024*1024);
  assert.equal(calls[0].url,catalogUrl);
  for(const call of calls){assert.equal(call.options.redirect,'manual');assert.equal(new Headers(call.options.headers).get('authorization'),null);assert.ok(call.options.signal instanceof AbortSignal)}
  const road=result.elements.find(element=>element.tags.highway==='footway');
  assert.ok(road);assert.equal(road.type,'way');
  assert.ok(road.geometry.every(point=>Number.isFinite(point.lon)&&Number.isFinite(point.lat)));
  assert.ok(result.elements.some(element=>element.tags.waterway==='stream'));
  assert.ok(result.elements.some(element=>element.tags.landuse==='forest'));
  assert.ok(result.elements.some(element=>element.tags.place==='village'&&element.tags.name==='合成村'));
  assert.ok(result.elements.some(element=>element.tags.natural==='peak'&&element.tags.name==='合成峰'));
  const forest=result.elements.find(element=>element.tags.landuse==='forest');
  assert.deepEqual(forest.geometry[0],forest.geometry.at(-1),'source area rings remain closed');
});

test('polygon holes retain their real rings and editor identities are never propagated',async()=>{
  const outer=[[0,0],[4096,0],[4096,4096],[0,4096],[0,0]];
  const hole=[[1000,1000],[1000,3000],[3000,3000],[3000,1000],[1000,1000]];
  const tile=makeMvt([{name:'water',features:[{type:3,properties:{kind:'water',name:'合成湖',user:'editor-private',uid:'123',email:'not-a-label'},geometry:[outer,hole]}]}]);
  const bytes=makeArchive({mvt:tile});
  const result=await loadBasemapElements(bounds,{now,fetchImpl:fixtureFetch(bytes)});
  const water=result.elements.find(element=>element.tags.natural==='water');
  assert.ok(water&&water.holes?.length===1,'a lake hole must not become another filled outer polygon');
  assert.deepEqual(water.holes[0][0],water.holes[0].at(-1));
  assert.doesNotMatch(JSON.stringify(result.elements),/editor-private|not-a-label|"uid"|"user"/);
});

test('the current catalog selects completed nonfuture archives and rejects malformed dates',async()=>{
  const valid=catalog(archive)[0];
  const result=await loadBasemapElements(bounds,{now,fetchImpl:fixtureFetch(archive,{catalogRecords:[{...valid,key:'20261107.pmtiles',uploaded:'2026-11-07T00:00:00Z'}, {...valid,key:'20261131.pmtiles'},valid,{...valid,key:'https://attacker.invalid/file.pmtiles'}]})});
  assert.equal(result.archive,archiveUrl);
  for(const records of [[],[{...valid,key:'20261107.pmtiles'}],[{...valid,uploaded:'2026-11-07T00:00:00Z'}],[{...valid,key:'20261131.pmtiles'}]]) {
    await assert.rejects(loadBasemapElements(bounds,{now,fetchImpl:fixtureFetch(archive,{catalogRecords:records})}),{code:'BASEMAP_INVALID_RESPONSE'});
  }
});

test('range reads reject full files, redirects, mismatched byte ranges, length and changing ETags',async()=>{
  const cases=[
    response=>new Response('never read a whole archive',{status:200}),
    response=>new Response(null,{status:302,headers:{location:'https://attacker.invalid/'}}),
    response=>{const headers=new Headers(response.headers);headers.set('content-range',`bytes 1-16384/${archive.length}`);return new Response(response.body,{status:206,headers})},
    response=>{const headers=new Headers(response.headers);headers.set('content-length','1');return new Response(response.body,{status:206,headers})},
    response=>{const headers=new Headers(response.headers);headers.delete('etag');return new Response(response.body,{status:206,headers})},
  ];
  for(const transform of cases)await assert.rejects(loadBasemapElements(bounds,{now,fetchImpl:fixtureFetch(archive,{transform})}),error=>/^BASEMAP_/.test(error.code));
  let rangeRequests=0;
  await assert.rejects(loadBasemapElements(bounds,{now,fetchImpl:fixtureFetch(archive,{transform:response=>{
    const headers=new Headers(response.headers);headers.set('etag',++rangeRequests===1?archiveEtag:'"different-build"');return new Response(response.body,{status:206,headers});
  }})}),{code:'BASEMAP_ARCHIVE_CHANGED'});
});

test('gzip tile bytes are decoded once, with an independent decompression budget',async()=>{
  const compressed=gzipSync(makeMvt());
  const bytes=makeArchive({mvt:compressed});bytes[98]=2;
  const result=await loadBasemapElements(bounds,{now,fetchImpl:fixtureFetch(bytes)});
  assert.ok(result.elements.some(element=>element.tags.highway==='footway'));
  const bomb=makeArchive({mvt:gzipSync(new Uint8Array(4*1024*1024+1))});bomb[98]=2;
  await assert.rejects(loadBasemapElements(bounds,{now,fetchImpl:fixtureFetch(bomb)}),{code:'BASEMAP_DATA_TOO_LARGE'});
});

test('invalid extents, stalled reads and cancellation fail without unbounded archive access',async()=>{
  for(const value of [null,[114,22,113,23],[-180,-85,180,85],[114,89,115,90]])await assert.rejects(loadBasemapElements(value,{now,fetchImpl(){assert.fail('invalid bounds must not fetch')}}),error=>/^BASEMAP_/.test(error.code));
  const controller=new AbortController();
  const promise=loadBasemapElements(bounds,{now,signal:controller.signal,fetchImpl:()=>new Promise(()=>{})});
  controller.abort();
  await assert.rejects(promise,{code:'BASEMAP_CANCELLED'});
  await assert.rejects(loadBasemapElements(bounds,{now,timeoutMs:10,fetchImpl:async()=>new Response(new ReadableStream({start(){}}))}),{code:'BASEMAP_TIMEOUT'});
});

test('transfer, geometry and feature budgets reject oversized files before yielding partial elements',async()=>{
  const points=Array.from({length:60001},(_,index)=>[index%2,index%2]);
  const largeGeometry=makeArchive({mvt:makeMvt([{name:'roads',features:[{type:2,properties:{kind:'path'},geometry:[points]}]}])});
  await assert.rejects(loadBasemapElements(bounds,{now,fetchImpl:fixtureFetch(largeGeometry)}),{code:'BASEMAP_DATA_TOO_LARGE'});
  const features=Array.from({length:6001},()=>({type:2,properties:{kind:'path'},geometry:[[[0,0],[1,1]]]}));
  const manyFeatures=makeArchive({mvt:makeMvt([{name:'roads',features}])});
  await assert.rejects(loadBasemapElements(bounds,{now,fetchImpl:fixtureFetch(manyFeatures)}),{code:'BASEMAP_DATA_TOO_LARGE'});
  const bigMvt=makeMvt([...defaultLayers,{name:'ignored',features:[{type:1,properties:{padding:'x'.repeat(620000)},geometry:[[[20,20]]]}]}]);
  const bigArchive=makeArchive({mvt:bigMvt});
  let bytesRequested=0;
  await assert.rejects(loadBasemapElements([114,22,114.1,22.1],{now,fetchImpl:async(url,options)=>{
    if(url!==catalogUrl){const range=/bytes=(\d+)-(\d+)/.exec(new Headers(options.headers).get('range'));bytesRequested+=Number(range[2])-Number(range[1])+1;assert.ok(bytesRequested<=4*1024*1024)}
    return fixtureFetch(bigArchive)(url,options);
  }}),{code:'BASEMAP_DATA_TOO_LARGE'});
});

test('a geometry command bomb is rejected before constructing millions of point objects',async()=>{
  // Repeated ClosePath commands can clone a point many times despite being
  // tiny commands. Inspecting them before allocating point objects is required.
  const {PbfWriter}=await import('pbf');
  const writer=new PbfWriter();
  writer.writeMessage(3,(_,layer)=>{
    layer.writeVarintField(15,2);layer.writeStringField(1,'roads');layer.writeVarintField(5,4096);
    layer.writeMessage(2,(_,feature)=>{
      feature.writePackedVarint(2,[0,0]);feature.writeVarintField(3,2);
      feature.writePackedVarint(4,[9,0,0,...Array(100000).fill(15)]);
    },null);
    layer.writeStringField(3,'kind');layer.writeMessage(4,(_,value)=>value.writeStringField(1,'path'),null);
  },null);
  const bytes=makeArchive({mvt:writer.finish(),tileCompression:2});
  const {VectorTileFeature}=await import('@mapbox/vector-tile');
  const original=VectorTileFeature.prototype.loadGeometry;let geometryDecodes=0;
  VectorTileFeature.prototype.loadGeometry=function(...args){geometryDecodes++;return original.apply(this,args)};
  try {
    await assert.rejects(loadBasemapElements(bounds,{now,fetchImpl:fixtureFetch(bytes)}),{code:'BASEMAP_DATA_TOO_LARGE'});
    assert.equal(geometryDecodes,0,'unsafe command counts must fail before the library allocates point objects');
  } finally {VectorTileFeature.prototype.loadGeometry=original;}
});

test('compressed directory counts are bounded before the SDK allocates entry objects',async()=>{
  const countBytes=count=>{const values=[];do{const value=count%128;count=Math.floor(count/128);values.push(value+(count?128:0));}while(count);return values;};
  for(const [count,code] of [[100000,'BASEMAP_DATA_TOO_LARGE'],[50000,'BASEMAP_INVALID_DIRECTORY']]){
    // Only the first of four required entry columns is present. Tiny gzip
    // input must not cause an array of many Entry objects to be allocated.
    const compressed=gzipSync(Uint8Array.from([...countBytes(count),...Array(count).fill(0)]));
    const bytes=makeArchive();bytes.fill(0,127,16384);bytes.set(compressed,127);bytes[97]=2;
    new DataView(bytes.buffer).setBigUint64(16,BigInt(compressed.length),true);
    await assert.rejects(loadBasemapElements(bounds,{now,fetchImpl:fixtureFetch(bytes)}),{code});
  }
});

test('a valid 61220-entry directory remains readable within the bounded object budget',async()=>{
  const count=61220,mvt=makeMvt(),base=makeArchive({mvt,minZoom:13,maxZoom:13});
  const scale=2**13,x=Math.floor((114.005+180)/360*scale),y=Math.floor((1-Math.asinh(Math.tan(22.005*Math.PI/180))/Math.PI)/2*scale);
  const start=zxyToTileId(13,x,y)-1000,values=[count,start,...Array(count-1).fill(1),...Array(count).fill(1),...Array(count).fill(mvt.length),...Array(count).fill(1)],encoded=[];
  for(let value of values){do{const byte=value%128;value=Math.floor(value/128);encoded.push(byte+(value?128:0));}while(value);}
  const directory=gzipSync(Uint8Array.from(encoded)),metadata=gzipSync('{}');
  assert.ok(127+directory.length+metadata.length<16384);
  const bytes=base.slice(0,16384+mvt.length),header=new DataView(bytes.buffer);
  bytes.fill(0,127,16384);bytes.set(directory,127);bytes.set(metadata,127+directory.length);bytes[97]=2;
  header.setBigUint64(16,BigInt(directory.length),true);header.setBigUint64(24,BigInt(127+directory.length),true);header.setBigUint64(32,BigInt(metadata.length),true);
  header.setBigUint64(64,BigInt(mvt.length),true);header.setBigUint64(72,BigInt(count),true);header.setBigUint64(80,BigInt(count),true);header.setBigUint64(88,1n,true);
  const result=await loadBasemapElements(bounds,{now,fetchImpl:fixtureFetch(bytes)});
  assert.ok(result.elements.some(element=>element.tags.landuse==='forest'));
});
