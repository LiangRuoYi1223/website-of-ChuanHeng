import assert from 'node:assert/strict';
import test from 'node:test';

import { locateTrack, createLocator, wgs84ToGcj02 } from '../server/tracks/locate.mjs';
import dataset from '../server/geography/china-cities.compact.json' with { type:'json' };
const check = test;
const track = (...segments) => ({ geojson: { type: 'Feature', geometry: { type: 'MultiLineString', coordinates: segments } } });
test('offline polygon location exports are available',()=>assert.equal(typeof locateTrack,'function'));

check('mainland cities match real offline polygons from WGS84 GPS coordinates',()=>{
  for (const [lon,lat,province,city] of [
    [114.0579,22.5431,'广东省','深圳市'],[116.39,39.90,'北京市','北京市'],
    [121.47,31.23,'上海市','上海市'],[104.0665,30.5723,'四川省','成都市'],
    [108.94,34.34,'陕西省','西安市'],[102.71,25.04,'云南省','昆明市'],
  ]) {
    const result=locateTrack(track([[lon,lat,null],[lon+.001,lat,null]]));
    assert.equal(result.province,province); assert.equal(result.city,city);
    assert.equal(result.locationStatus,'matched'); assert.equal(result.locations.length,1);
  }
});
check('a multi-segment route preserves every visited province/city and each segment origin',()=>{
  const result=locateTrack(track([[114.0579,22.5431],[114.06,22.544]],[[104.0665,30.5723],[104.067,30.573]]));
  assert.deepEqual(result.coordinates,[114.0579,22.5431]);
  assert.deepEqual(result.locations.map(item=>[item.city,item.segmentIndex]),[['深圳市',0],['成都市',1]]);
  assert.deepEqual(result.locations[1].coordinates,[104.0665,30.5723]);
  assert.equal(result.checkedPointCount,4); assert.equal(result.matchedPointCount,4);
});
check('overseas and unrepresented ocean coordinates never become a nearest-city guess',()=>{
  for (const point of [[2.35,48.86],[0,0],[150,10]]) {
    const result=locateTrack(track([point,point]));
    assert.equal(result.locationStatus,'unmatched'); assert.equal(result.province,null);
    assert.equal(result.city,null); assert.deepEqual(result.locations,[]);
    assert.deepEqual(result.coordinates,point);
  }
});
check('unmatched first points remain the representative location even when later points match',()=>{
  const result=locateTrack(track([[0,0],[114.0579,22.5431]]));
  assert.deepEqual(result.coordinates,[0,0]); assert.equal(result.city,null);
  assert.equal(result.locationStatus,'partial'); assert.equal(result.locations[0].city,'深圳市');
});
check('a short segment in a different city is not lost to route-wide sampling',()=>{
  const shenzhen=Array.from({length:29998},()=>[114.0579,22.5431]);
  const result=locateTrack(track(shenzhen,[[104.0665,30.5723],[104.0665,30.5723]]));
  assert.equal(result.checkedPointCount,30000);
  assert.equal(result.locations.length,2); assert.equal(result.locations[1].city,'成都市');
});
check('the WGS84 to GCJ02 transform matches its documented reference and leaves abroad unchanged',()=>{
  const result=wgs84ToGcj02([116.404,39.915]);
  assert.ok(Math.abs(result[0]-116.41024449916938)<1e-9);
  assert.ok(Math.abs(result[1]-39.91640428150164)<1e-9);
  assert.deepEqual(wgs84ToGcj02([2.35,48.86]),[2.35,48.86]);
});

const square=(left,bottom,right,top)=>[[left,bottom],[right,bottom],[right,top],[left,top],[left,bottom]];
const synthetic={version:1,id:'synthetic-test-only',boundaryGuardM:100,features:[
  {province:'测试省',city:'甲市',adcode:'test-a',crs:'WGS84',rings:[square(0,0,1,1),square(.4,.4,.6,.6),square(3,0,3.5,.5)]},
  {province:'测试省',city:'乙市',adcode:'test-b',crs:'WGS84',rings:[square(1,0,2,1)]},
]};
check('exact and near administrative borders remain uncertain instead of choosing either side',()=>{
  const locate=createLocator(synthetic);
  for(const point of [[1,.2],[.9999,.2],[1.0001,.2]]) {
    const result=locate(track([point,point]));
    assert.equal(result.locationStatus,'unmatched'); assert.equal(result.city,null);
    assert.ok(result.warnings.length>0);
  }
});
check('polygon holes and disconnected islands retain their real topological meaning',()=>{
  const locate=createLocator(synthetic);
  assert.equal(locate(track([[.5,.5],[.51,.5]])).locationStatus,'unmatched');
  assert.equal(locate(track([[.2,.2],[.21,.2]])).city,'甲市');
  assert.equal(locate(track([[3.2,.2],[3.21,.2]])).city,'甲市');
});
check('all recorded points are checked, including a one-point visit inside a long segment',()=>{
  const locate=createLocator(synthetic);
  const points=Array.from({length:2049},()=>[.2,.2]); points[1001]=[1.5,.2];
  const result=locate(track(points));
  assert.equal(result.checkedPointCount,2049);
  assert.deepEqual(result.locations.map(item=>item.adcode),['test-a','test-b']);
});
check('invalid track shapes fail closed without manufacturing coordinates or labels',()=>{
  for(const value of [null,{},track([[181,91],[NaN,0]])]) {
    const result=locateTrack(value);
    assert.equal(result.locationStatus,'unmatched'); assert.equal(result.coordinates,null);
  }
});
check('Hong Kong, Macau, and Taiwan county/city polygons have genuine source names',()=>{
  for(const [lon,lat,city] of [[114.17,22.30,'香港特别行政区'],[113.5439,22.1988,'澳门特别行政区'],[121.5654,25.033,'臺北市'],[120.30,22.63,'高雄市']]) {
    const result=locateTrack(track([[lon,lat],[lon+.0001,lat]]));
    assert.equal(result.city,city); assert.equal(result.locationStatus,'matched');
  }
});
check('overlapping polygons are explicitly ambiguous rather than resolved by source order',()=>{
  const locate=createLocator({...synthetic,features:[synthetic.features[0],{...synthetic.features[1],rings:[square(0,0,1,1)]}]});
  assert.equal(locate(track([[.2,.2],[.21,.2]])).locationStatus,'unmatched');
});
check('runtime matching never calls an external geocoding or coordinate conversion service',()=>{
  const previous=globalThis.fetch;
  try {
    globalThis.fetch=()=>{throw new Error('No user coordinate may be transmitted');};
    assert.equal(locateTrack(track([[114.0579,22.5431],[114.06,22.544]])).city,'深圳市');
  } finally {globalThis.fetch=previous;}
});
check('the shipped dataset has 391 unique genuine source codes and 34 provincial groups',()=>{
  assert.equal(dataset.features.length,391);
  assert.equal(new Set(dataset.features.map(feature=>feature.adcode)).size,391);
  assert.equal(new Set(dataset.features.map(feature=>feature.province)).size,34);
  assert.equal(dataset.features.filter(feature=>feature.crs==='TWD97').length,22);
  assert.ok(dataset.features.every(feature=>feature.rings.length && feature.rings.every(ring=>ring.length>=8)));
});
