import assert from 'node:assert/strict';
import {PbfWriter} from 'pbf';
import {zxyToTileId} from 'pmtiles';
import {gzipSync} from 'node:zlib';

export const archiveUrl = 'https://build.protomaps.com/20261106.pmtiles';
export const catalogUrl = 'https://build-metadata.protomaps.dev/builds.json';
export const archiveEtag = '"synthetic-pmtiles-v3-fixture"';
const extent = 4096;
const square = [[[0, 0], [extent, 0], [extent, extent], [0, extent], [0, 0]]];
export const defaultLayers = [
  {name: 'landcover', features: [{type: 3, properties: {kind: 'forest'}, geometry: square}]},
  {name: 'landuse', features: [{type: 3, properties: {kind: 'forest'}, geometry: square}]},
  {name: 'roads', features: [{type: 2, properties: {kind: 'path', kind_detail: 'footway'}, geometry: [[[0, 0], [extent, extent]]]}]},
  {name: 'water', features: [
    {type: 3, properties: {kind: 'water'}, geometry: [[[500, 500], [900, 500], [900, 900], [500, 900], [500, 500]]]},
    {type: 2, properties: {kind: 'water', kind_detail: 'stream'}, geometry: [[[0, extent], [extent, 0]]]},
  ]},
  {name: 'places', features: [{type: 1, properties: {kind: 'locality', kind_detail: 'village', 'name:zh-Hans': '合成村'}, geometry: [[[2048, 2048]]]}]},
  {name: 'pois', features: [{type: 1, properties: {kind: 'peak', name: '合成峰'}, geometry: [[[2100, 2100]]]}]},
];

// MVT v2: properties use genuine key/value tables; geometry commands maintain
// their cursor between parts, including opposite-winding polygon hole rings.
function geometryCommands(feature) {
  const commands = []; let x = 0, y = 0;
  const delta = point => {commands.push((point[0] - x) * 2 ^ (point[0] - x) >> 31, (point[1] - y) * 2 ^ (point[1] - y) >> 31); [x, y] = point;};
  for (const source of feature.geometry) {
    const points = feature.type === 3 && source.length > 1 && source[0][0] === source.at(-1)[0] && source[0][1] === source.at(-1)[1] ? source.slice(0, -1) : source;
    commands.push(9); delta(points[0]);
    if (points.length > 1) {commands.push((points.length - 1) * 8 + 2); for (const point of points.slice(1)) delta(point);}
    if (feature.type === 3) commands.push(15);
  }
  return commands;
}
export function makeMvt(layers = defaultLayers) {
  const tile = new PbfWriter();
  for (const layer of layers) tile.writeMessage(3, (layer, writer) => {
    const keys = [...new Set(layer.features.flatMap(feature => Object.keys(feature.properties || {})))];
    const values = [...new Set(layer.features.flatMap(feature => Object.values(feature.properties || {})).map(String))];
    writer.writeVarintField(15, 2); writer.writeStringField(1, layer.name); writer.writeVarintField(5, extent);
    for (const [index, feature] of layer.features.entries()) writer.writeMessage(2, (feature, item) => {
      item.writeVarintField(1, index + 1);
      item.writePackedVarint(2, Object.entries(feature.properties || {}).flatMap(([key, value]) => [keys.indexOf(key), values.indexOf(String(value))]));
      item.writeVarintField(3, feature.type); item.writePackedVarint(4, geometryCommands(feature));
    }, feature);
    for (const key of keys) writer.writeStringField(3, key);
    for (const value of values) writer.writeMessage(4, (value, item) => item.writeStringField(1, value), value);
  }, layer);
  return new Uint8Array(tile.finish());
}
const tileXY = (lon, lat, z) => [Math.floor((lon + 180) / 360 * 2 ** z), Math.floor((1 - Math.asinh(Math.tan(lat * Math.PI / 180)) / Math.PI) / 2 * 2 ** z)];
function varints(values) {const writer = new PbfWriter(); for (const value of values) writer.writeVarint(value); return writer.finish();}
export function makeArchive({mvt = makeMvt(), minZoom = 10, maxZoom = 13, bounds = [113.9, 21.9, 114.1, 22.1], internalCompression = 1, tileCompression = 1} = {}) {
  assert.ok([1, 2].includes(internalCompression) && [1, 2].includes(tileCompression));
  const tile = tileCompression === 2 ? new Uint8Array(gzipSync(mvt)) : mvt;
  const entries = [];
  for (let z = minZoom; z <= maxZoom; z++) {
    const [left, top] = tileXY(bounds[0], bounds[3], z), [right, bottom] = tileXY(bounds[2], bounds[1], z);
    for (let x = left; x <= right; x++) for (let y = top; y <= bottom; y++) entries.push({tileId: zxyToTileId(z, x, y)});
  }
  entries.sort((a, b) => a.tileId - b.tileId);
  let previous = 0;
  const rawDirectory = varints([entries.length, ...entries.map(entry => {const delta = entry.tileId - previous; previous = entry.tileId; return delta;}),
    ...entries.map(() => 1), ...entries.map(() => tile.length), ...entries.map((_, index) => index * tile.length + 1)]);
  const directory = internalCompression === 2 ? new Uint8Array(gzipSync(rawDirectory)) : rawDirectory;
  const metadata = internalCompression === 2 ? new Uint8Array(gzipSync('{}')) : new TextEncoder().encode('{}');
  assert.ok(127 + directory.length + 2 < 16384, 'fixture root directory stays in the initial header range');
  const tileDataOffset = 16384, archive = new Uint8Array(tileDataOffset + entries.length * tile.length);
  archive.set(new TextEncoder().encode('PMTiles')); archive[7] = 3;
  const header = new DataView(archive.buffer);
  const uint64 = (offset, value) => header.setBigUint64(offset, BigInt(value), true);
  uint64(8, 127); uint64(16, directory.length); uint64(24, 127 + directory.length); uint64(32, metadata.length);
  uint64(40, tileDataOffset); uint64(48, 0); uint64(56, tileDataOffset); uint64(64, entries.length * tile.length);
  uint64(72, entries.length); uint64(80, entries.length); uint64(88, entries.length);
  archive[96] = 1; archive[97] = internalCompression; archive[98] = tileCompression; archive[99] = 1; archive[100] = minZoom; archive[101] = maxZoom;
  for (const [index, value] of bounds.entries()) header.setInt32(102 + index * 4, Math.round(value * 1e7), true);
  archive[118] = maxZoom; header.setInt32(119, 1140050000, true); header.setInt32(123, 220050000, true);
  archive.set(directory, 127); archive.set(metadata, 127 + directory.length);
  for (let index = 0; index < entries.length; index++) archive.set(tile, tileDataOffset + index * tile.length);
  return archive;
}
export const archive = makeArchive();

// This implements real HTTP byte serving rather than supplying parsed map data.
// Both Node fetch(url,options) and Miniflare outboundService(Request) are accepted.
export function archiveResponse(requestOrUrl, options = {}, bytes = archive) {
  const request = typeof requestOrUrl === 'string' || requestOrUrl instanceof URL ? new Request(requestOrUrl, options) : requestOrUrl;
  assert.equal(request.method, 'GET');
  assert.equal(request.headers.get('authorization'), null);
  assert.equal(request.headers.get('apikey'), null);
  if (request.url === catalogUrl) return Response.json([{key: '20261106.pmtiles', size: bytes.length, uploaded: '2026-11-06T00:00:00Z', version: '4.15.2'}]);
  const address = new URL(request.url);
  assert.equal(address.origin, 'https://build.protomaps.com');
  assert.match(address.pathname, /^\/\d{8}\.pmtiles$/);
  assert.equal(address.search, '');
  const match = /^bytes=(\d+)-(\d+)$/.exec(request.headers.get('range') || '');
  assert.ok(match, 'archive reads require an explicit bounded byte Range');
  const start = Number(match[1]), requestedEnd = Number(match[2]);
  assert.ok(Number.isSafeInteger(start) && requestedEnd >= start);
  assert.ok(start < bytes.length, 'the fixture should contain every requested offset');
  const end = Math.min(requestedEnd, bytes.length - 1), body = bytes.slice(start, end + 1);
  return new Response(body, {status: 206, headers: {'content-type': 'application/vnd.pmtiles', 'content-range': `bytes ${start}-${end}/${bytes.length}`, 'content-length': String(body.length), etag: archiveEtag}});
}
