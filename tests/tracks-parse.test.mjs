import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

import { convertTrack, TrackError } from '../server/tracks/parse.mjs';
const check = test;
const fixture = name => readFile(new URL(`./fixtures/tracks/${name}`, import.meta.url), 'utf8');
const point = (lon, lat, ele) => `<trkpt lon="${lon}" lat="${lat}">${ele === undefined ? '' : `<ele>${ele}</ele>`}</trkpt>`;
const gpx = points => `<gpx><trk><trkseg>${points}</trkseg></trk></gpx>`;
const kml = geometry => `<kml xmlns:gx="http://www.google.com/kml/ext/2.2"><Document><Placemark>${geometry}</Placemark></Document></kml>`;
const line = (coordinates, mode = 'absolute') => `<LineString>${mode === null ? '' : `<altitudeMode>${mode}</altitudeMode>`}<coordinates>${coordinates}</coordinates></LineString>`;
const rejects = (xml, code, status = 400) => assert.throws(() => convertTrack(xml, { filename: 'test.gpx' }), error => error instanceof TrackError && error.code === code && error.status === status && error.message.length < 300);
const near = (actual, expected, tolerance = 1) => assert.ok(Math.abs(actual - expected) < tolerance, `${actual} differs from ${expected}`);

test('the track converter and typed TrackError exports exist', () => {
  assert.equal(typeof convertTrack, 'function');
  assert.equal(typeof TrackError, 'function');
});

check('GPX tracks take precedence over routes and independent waypoints', async () => {
  const result = convertTrack(await fixture('segmented.gpx'), { filename: 'coast.gpx' });
  assert.equal(result.version, 1); assert.equal(result.format, 'gpx');
  assert.equal(result.name, '沿海测试'); assert.equal(result.sourceFile, 'coast.gpx');
  assert.equal(result.pointCount, 5); assert.equal(result.segmentCount, 2);
  assert.deepEqual(result.bounds, [0, 0, 10.01, 0]);
  assert.deepEqual(result.geojson.properties, {});
  assert.equal(result.geojson.type, 'Feature');
  assert.equal(result.geojson.geometry.type, 'MultiLineString');
  assert.deepEqual(result.geojson.geometry.coordinates.map(segment => segment.length), [3, 2]);
  near(result.stats.distanceM, 3335.8524); assert.equal(result.stats.ascentM, 20); assert.equal(result.stats.descentM, 5);
  assert.equal(result.stats.minElevationM, 10); assert.equal(result.stats.maxElevationM, 1010);
  assert.equal(result.stats.elevationCoverage, 1);
});

check('segments have independent distance and raw ascent with no bridge between segments', async () => {
  const result = convertTrack(await fixture('segmented.gpx'));
  assert.equal(result.segments.length, 2);
  assert.deepEqual(result.segments.map(segment => segment.index), [0, 1]);
  assert.deepEqual(result.segments.map(segment => segment.pointCount), [3, 2]);
  assert.ok(result.segments.every(segment => typeof segment.name === 'string'));
  near(result.segments[0].stats.distanceM, 2223.9016);
  near(result.segments[1].stats.distanceM, 1111.9508);
  assert.equal(result.segments[0].stats.ascentM, 10);
  assert.equal(result.segments[1].stats.ascentM, 10);
  assert.equal(result.profile[0].segmentDistanceM, 0);
  assert.equal(result.profile[3].segmentDistanceM, 0);
  near(result.profile[3].distanceM, result.segments[0].stats.distanceM);
  assert.equal(result.profile[3].segment, 1);
  assert.deepEqual(Object.keys(result.profile[0]).sort(), ['distanceM','elevationM','lat','lon','segment','segmentDistanceM'].sort());
});

check('routes are the GPX fallback and a complete flat route has zero ascent/descent', async () => {
  const result = convertTrack(await fixture('route.gpx'));
  assert.equal(result.name, '路线备选'); assert.equal(result.pointCount, 2);
  assert.equal(result.stats.ascentM, 0); assert.equal(result.stats.descentM, 0);
  assert.equal(result.stats.minElevationM, 0); assert.equal(result.stats.maxElevationM, 0);
});

check('missing elevation remains null and does not fabricate zero elevation totals', () => {
  const result = convertTrack(gpx(point(0, 0) + point(0.01, 0)));
  assert.deepEqual(result.geojson.geometry.coordinates[0], [[0,0,null],[0.01,0,null]]);
  assert.deepEqual(result.profile.map(item => item.elevationM), [null,null]);
  assert.equal(result.stats.ascentM, null); assert.equal(result.stats.descentM, null);
  assert.equal(result.stats.minElevationM, null); assert.equal(result.stats.maxElevationM, null);
  assert.equal(result.stats.elevationCoverage, 0); assert.ok(result.warnings.length > 0);
});

check('partial elevation only invalidates that segment and global rise totals', () => {
  const xml = `<gpx><trk><trkseg>${point(0,0,10)}${point(0.01,0,20)}</trkseg><trkseg>${point(5,0,40)}${point(5.01,0)}</trkseg></trk></gpx>`;
  const result = convertTrack(xml);
  assert.equal(result.stats.ascentM, null); assert.equal(result.stats.descentM, null);
  assert.equal(result.stats.minElevationM, 10); assert.equal(result.stats.maxElevationM, 40);
  assert.equal(result.stats.elevationCoverage, .75);
  assert.equal(result.segments[0].stats.ascentM, 10); assert.equal(result.segments[1].stats.ascentM, null);
  assert.ok(result.warnings.some(warning => /部分|缺失/.test(warning)));
});

check('haversine uses the short path across the date line and retains repeated points', () => {
  const result = convertTrack(gpx(point(179.99,0,0)+point(-179.99,0,1)+point(-179.99,0,1)));
  near(result.stats.distanceM, 2223.9016); assert.equal(result.pointCount,3);
  assert.equal(result.stats.ascentM,1); assert.equal(result.stats.descentM,0);
  assert.deepEqual(result.bounds,[-179.99,0,179.99,0]);
});

check('KML preserves MultiGeometry, gx:MultiTrack, and gx empty-coordinate breaks without mixing Points', async () => {
  const result = convertTrack(await fixture('mixed.kml'), { filename:'mixed.kml' });
  assert.equal(result.format,'kml'); assert.equal(result.name,'海岸与雪线');
  assert.equal(result.segmentCount,5); assert.equal(result.pointCount,10);
  assert.equal(result.stats.elevationCoverage,.8); assert.equal(result.stats.ascentM,null);
  assert.equal(result.stats.minElevationM,2); assert.equal(result.stats.maxElevationM,110);
  assert.deepEqual(result.geojson.geometry.coordinates[1].map(point=>point[2]),[null,null]);
  assert.deepEqual(result.segments.map(segment=>segment.stats.ascentM),[10,null,5,5,0]);
  assert.ok(result.warnings.some(warning=>/absolute/.test(warning)));
});

for (const mode of [null,'clampToGround','relativeToGround','relativeToSeaFloor']) {
  check(`KML ${mode ?? 'missing'} altitudeMode ignores supplied altitude`, () => {
    const result=convertTrack(kml(line('0,0,100 0.01,0,200',mode)));
    assert.deepEqual(result.profile.map(point=>point.elevationM),[null,null]);
    assert.equal(result.stats.ascentM,null);
  });
}

check('absolute KML altitude remains missing when omitted and blank lines split geometry', () => {
  const result=convertTrack(kml(line('0,0 0.01,0\n\n10,0,40 10.01,0,50')));
  assert.equal(result.segmentCount,2); near(result.stats.distanceM,2223.9016);
  assert.equal(result.segments[0].stats.elevationCoverage,0); assert.equal(result.segments[1].stats.ascentM,10);
});

check('isolated points after a break never become invalid one-point LineStrings', () => {
  const result=convertTrack(kml(line('0,0,1\n\n1,0,2 1.01,0,3')));
  assert.equal(result.segmentCount,1); assert.equal(result.pointCount,2);
  assert.ok(result.warnings.length>0);
});

check('prefixed GPX and numeric entities are handled without loading any external resource', () => {
  const xml='<p:gpx xmlns:p="http://www.topografix.com/GPX/1/1"><p:trk><p:name>A &amp; &#x5C71;</p:name><p:trkseg><p:trkpt lat="0" lon="0"/><p:trkpt lat="0" lon="1"/></p:trkseg></p:trk></p:gpx>';
  assert.equal(convertTrack(xml).name,'A & 山');
});

for (const xml of ['<gpx><trk></gpx>','<gpx/><gpx/>','<gpx x=no/>','<gpx>','<gpx>\0</gpx>','text<gpx/>']) {
  check(`malformed XML is rejected: ${JSON.stringify(xml)}`,()=>rejects(xml,'INVALID_XML'));
}
for (const xml of ['<!DOCTYPE gpx SYSTEM "https://example.invalid/evil.dtd"><gpx/>','<!DOCTYPE gpx [<!ENTITY x "boom">]><gpx/>','<!ENTITY x SYSTEM "file:///etc/passwd"><gpx/>']) {
  check('DTD and entity declarations are forbidden',()=>rejects(xml,'UNSAFE_XML'));
}
for (const [lon,lat] of [['181','0'],['0','91'],['1x','2'],['NaN','0'],['Infinity','0'],['','1'],['1','']]) {
  check(`invalid coordinates ${lon}/${lat} are rejected`,()=>rejects(gpx(point(lon,lat,1)),'INVALID_COORDINATE'));
}
for (const value of ['NaN','Infinity','12m','1e999']) {
  check(`invalid elevation ${value} is rejected`,()=>rejects(gpx(point(0,0,value)+point(1,0,0)),'INVALID_ELEVATION'));
}
check('invalid KML tuple shape is rejected',()=>rejects(kml(line('0,0,1,2 1,0,2')),'INVALID_COORDINATE'));
check('unsupported roots are rejected independently of the filename',()=>rejects('<html/>','UNSUPPORTED_FORMAT',415));
check('a GPX containing only independent waypoints has no line geometry',()=>rejects('<gpx><wpt lon="1" lat="2"/></gpx>','EMPTY_TRACK'));
check('input types and invalid UTF-8 are rejected with bounded TrackErrors',()=>{
  rejects(null,'INVALID_INPUT'); rejects(Buffer.from([0xff,0xfe,0x00]),'INVALID_XML');
});
check('UTF-8 byte size limit counts multibyte characters',()=>rejects(`<gpx>${'汉'.repeat(1800000)}</gpx>`,'FILE_TOO_LARGE',413));
check('excessive XML nesting is rejected before parsing',()=>rejects(`<gpx>${'<x>'.repeat(70)}${'</x>'.repeat(70)}</gpx>`,'XML_TOO_DEEP',413));
check('more than 30000 raw points are rejected',()=>rejects(gpx(point(0,0,0).repeat(30001)),'TOO_MANY_POINTS',413));
check('30000 points are retained without simplification',()=>assert.equal(convertTrack(gpx(point(0,0,0).repeat(30000))).pointCount,30000));
check('more than 100 segments are rejected',()=>rejects(`<gpx><trk>${`<trkseg>${point(0,0,0)}${point(1,0,0)}</trkseg>`.repeat(101)}</trk></gpx>`,'TOO_MANY_SEGMENTS',413));
check('source filenames and names remain bounded and do not include directory paths',()=>{
  const result=convertTrack(gpx(point(0,0,0)+point(1,0,0)),{filename:`C:\\private\\${'a'.repeat(500)}.gpx`});
  assert.ok(result.sourceFile.length<=200); assert.ok(result.name.length<=160);
  assert.ok(!result.sourceFile.includes('private'));
});

check('100 segments are retained and have independent local origins',()=>{
  const result=convertTrack(`<gpx><trk>${`<trkseg>${point(0,0,0)}${point(0.01,0,1)}</trkseg>`.repeat(100)}</trk></gpx>`);
  assert.equal(result.segmentCount,100);
  assert.ok(result.profile.filter(point=>point.segmentDistanceM===0).length===100);
  assert.equal(result.stats.ascentM,100);
});
check('KML explicit empty tuples create breaks rather than connecting across them',()=>{
  const result=convertTrack(kml(line('0,0,1 0.01,0,2 ,, 10,0,3 10.01,0,4')));
  assert.equal(result.segmentCount,2); near(result.stats.distanceM,2223.9016);
});
check('an empty GPX track can fall back to a populated route',()=>{
  const result=convertTrack('<gpx><trk/><rte><rtept lat="0" lon="0"/><rtept lat="0" lon="1"/></rte></gpx>');
  assert.equal(result.pointCount,2);
});
check('XML predefined entities are not recursively decoded and CDATA stays literal',()=>{
  const prefix='<gpx><trk><name>';
  const suffix=`</name><trkseg>${point(0,0,1)}${point(1,0,1)}</trkseg></trk></gpx>`;
  assert.equal(convertTrack(prefix+'&amp;#x5C71;'+suffix).name,'&#x5C71;');
  assert.equal(convertTrack(prefix+'<![CDATA[山 &amp; <!DOCTYPE sample>]]>'+suffix).name,'山 &amp; <!DOCTYPE sample>');
});
check('quoted greater-than signs do not confuse the XML depth scanner',()=>{
  const result=convertTrack(`<gpx creator="a > b"><trk><trkseg>${point(0,0)}${point(1,0)}</trkseg></trk></gpx>`);
  assert.equal(result.pointCount,2);
});
check('unknown entities and illegal numeric character references are rejected',()=>{
  rejects('<gpx><name>&unknown;</name></gpx>','INVALID_XML');
  rejects('<gpx><name>&#0;</name></gpx>','INVALID_XML');
  rejects('<gpx><name>&#xD800;</name></gpx>','INVALID_XML');
});
check('the core works with Web APIs and no global Node Buffer',()=>{
  const previous=globalThis.Buffer;
  try {
    globalThis.Buffer=undefined;
    assert.equal(convertTrack(new TextEncoder().encode(gpx(point(0,0)+point(1,0)))).pointCount,2);
    assert.equal(convertTrack(gpx(point(0,0)+point(1,0))).pointCount,2);
  } finally { globalThis.Buffer=previous; }
});
check('KML NetworkLink content is ignored while local line geometry remains usable',()=>{
  const result=convertTrack(`<kml><Document><NetworkLink><Link><href>https://example.invalid/track.kml</href></Link></NetworkLink><Placemark>${line('0,0,1 1,0,2')}</Placemark></Document></kml>`);
  assert.equal(result.pointCount,2); assert.equal(result.segmentCount,1);
});
check('repeated unterminated comment openers fail as malformed XML',()=>{
  rejects('<gpx>'+'<!--'.repeat(20000),'INVALID_XML');
});
