import {PMTiles, ResolvedValueCache} from 'pmtiles';
import {VectorTile, classifyRings} from '@mapbox/vector-tile';
import {PbfReader} from 'pbf';
import {TrackError} from '../tracks/parse.mjs';

export const PROTOMAPS_BUILD_INDEX_URL = 'https://build-metadata.protomaps.dev/builds.json';
const ARCHIVE_ORIGIN = 'https://build.protomaps.com';
const MAX_TRANSFER = 4 * 1024 * 1024, MAX_INFLATED = 4 * 1024 * 1024, MAX_TOTAL_INFLATED = 16 * 1024 * 1024;
const MAX_FEATURES = 6000, MAX_POINTS = 60000, MAX_REQUESTS = 40, MAX_RANGE = 1024 * 1024;
const LAYERS = new Set(['roads', 'water', 'landuse', 'landcover', 'places', 'pois']);
const USER_AGENT = 'ChuanhengRouteBasemap/1.0 (+https://github.com/LiangRuoYi1223/website-of-ChuanHeng)';
const fail = (code, message, status = 422) => { throw new TrackError(code, message, status); };
const invalid = () => fail('BASEMAP_INVALID_RESPONSE', '地图文件或范围响应无效，请稍后重试。', 502);
const tooLarge = () => fail('BASEMAP_DATA_TOO_LARGE', '此范围地图数据过多，请缩小路线范围后重试。');
const cancelReader = reader => { try { Promise.resolve(reader.cancel()).catch(() => {}); } catch { /* already closed */ } };

function tilesFor(bounds, maximum = 13, minimum = 10) {
  if (!Array.isArray(bounds) || bounds.length !== 4 || !bounds.every(Number.isFinite)) fail('BASEMAP_INVALID_GEOMETRY', '底图范围缺少有效的经纬度。');
  const [west, south, east, north] = bounds;
  if (west < -180 || east > 180 || west >= east || south >= north || south <= -85.05112878 || north >= 85.05112878) fail('BASEMAP_OUTSIDE_COVERAGE', '路线范围超出静态地图覆盖边界。');
  const latitudeTile = (latitude, scale) => (1 - Math.asinh(Math.tan(latitude * Math.PI / 180)) / Math.PI) / 2 * scale;
  for (let zoom = maximum; zoom >= minimum; zoom--) {
    const scale = 2 ** zoom;
    const left = Math.floor((west + 180) / 360 * scale), right = Math.floor((east + 180) / 360 * scale - 1e-10);
    const top = Math.floor(latitudeTile(north, scale)), bottom = Math.floor(latitudeTile(south, scale) - 1e-10);
    if ((right - left + 1) * (bottom - top + 1) > 12) continue;
    const tiles = [];
    for (let x = left; x <= right; x++) for (let y = top; y <= bottom; y++) tiles.push({x, y, z: zoom});
    return tiles;
  }
  fail('BASEMAP_AREA_TOO_LARGE', '路线范围超过单张底图的读取上限，请分段后重试。');
}

function selectBuild(data, now) {
  if (!Array.isArray(data) || data.length > 1000) invalid();
  const today = new Date(now).toISOString().slice(0, 10).replaceAll('-', '');
  const records = data.filter(record => {
    if (!record || !/^\d{8}\.pmtiles$/.test(record.key || '') || !/^4\.\d+\.\d+$/.test(record.version || '') || !Number.isSafeInteger(record.size) || record.size < 16384) return false;
    const date = record.key.slice(0, 8);
    const parsed = new Date(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T00:00:00Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10).replaceAll('-', '') === date && date <= today
      && typeof record.uploaded === 'string' && Number.isFinite(Date.parse(record.uploaded)) && Date.parse(record.uploaded) <= now;
  }).sort((left, right) => right.key.localeCompare(left.key));
  if (!records.length) invalid();
  return records[0];
}

function clipSegment(first, last, extent) {
  const dx = last.x - first.x, dy = last.y - first.y;
  const p = [-dx, dx, -dy, dy], q = [first.x, extent - first.x, first.y, extent - first.y];
  let low = 0, high = 1;
  for (let edge = 0; edge < 4; edge++) {
    if (p[edge] === 0) { if (q[edge] < 0) return null; continue; }
    const fraction = q[edge] / p[edge];
    if (p[edge] < 0) low = Math.max(low, fraction); else high = Math.min(high, fraction);
    if (low > high) return null;
  }
  return [{x: first.x + low * dx, y: first.y + low * dy}, {x: first.x + high * dx, y: first.y + high * dy}];
}

function clipRing(ring, extent) {
  let result = ring.slice(0, -1);
  for (const [axis, boundary, positive] of [['x', 0, true], ['x', extent, false], ['y', 0, true], ['y', extent, false]]) {
    const input = result; result = [];
    if (!input.length) break;
    let previous = input.at(-1), previousInside = positive ? previous[axis] >= boundary : previous[axis] <= boundary;
    for (const current of input) {
      const currentInside = positive ? current[axis] >= boundary : current[axis] <= boundary;
      if (currentInside !== previousInside) {
        const fraction = (boundary - previous[axis]) / (current[axis] - previous[axis]);
        result.push({x: previous.x + (current.x - previous.x) * fraction, y: previous.y + (current.y - previous.y) * fraction});
      }
      if (currentInside) result.push(current);
      previous = current; previousInside = currentInside;
    }
  }
  if (result.length >= 3) result.push({...result[0]});
  return result;
}

function tagsFor(layer, type, properties) {
  const kind = properties.kind, detail = properties.kind_detail;
  if (layer === 'roads' && type === 2 && ['highway', 'major_road', 'minor_road', 'path'].includes(kind)) return {highway: typeof detail === 'string' && detail.length <= 64 ? detail : kind};
  if (layer === 'water' && type === 2 && ['river', 'stream', 'canal', 'ditch', 'drain', 'tidal_channel', 'wadi'].includes(detail)) return {waterway: detail};
  if (layer === 'water' && type === 3) return {natural: 'water'};
  if (['landuse', 'landcover'].includes(layer) && type === 3) {
    if (['forest', 'wood'].includes(kind)) return {landuse: 'forest'};
    if (['grass', 'meadow'].includes(kind)) return {landuse: kind};
    if (['scrub', 'wetland'].includes(kind)) return {natural: kind};
  }
  if (layer === 'places' && type === 1 && ['locality', 'macrohood', 'neighbourhood'].includes(kind)) return {place: ['city', 'town', 'village', 'hamlet', 'suburb', 'locality'].includes(detail) ? detail : 'locality'};
  if (layer === 'pois' && type === 1 && ['peak', 'saddle'].includes(kind)) return {natural: kind};
  return null;
}

// Count packed geometry commands before the vector library allocates Point
// objects. A small compressed tile must not expand into millions of clones.
function inspectGeometry(data, budget) {
  const reader = new PbfReader(data);
  const messageEnd = maximum => {
    const length = reader.readVarint(), end = reader.pos + length;
    if (!Number.isSafeInteger(end) || end > maximum) invalid();
    return end;
  };
  while (reader.pos < reader.length) {
    const tileTag = reader.readVarint();
    if (tileTag !== 26) { reader.skip(tileTag); if (reader.pos > reader.length) invalid(); continue; }
    const layerEnd = messageEnd(reader.length), features = [];
    let name;
    while (reader.pos < layerEnd) {
      const tag = reader.readVarint();
      if (tag === 10) name = reader.readString();
      else if (tag === 18) {
        const end = messageEnd(layerEnd);
        if (features.length >= MAX_FEATURES) tooLarge();
        features.push([reader.pos, end]); reader.pos = end;
      } else reader.skip(tag);
      if (reader.pos > layerEnd) invalid();
    }
    if (!LAYERS.has(name)) continue;
    budget.features += features.length;
    if (budget.features > MAX_FEATURES) tooLarge();
    for (const [start, end] of features) {
      reader.pos = start;
      while (reader.pos < end) {
        const tag = reader.readVarint();
        if (tag !== 34) { reader.skip(tag); if (reader.pos > end) invalid(); continue; }
        const geometryEnd = messageEnd(end);
        while (reader.pos < geometryEnd) {
          const command = reader.readVarint(), operation = command % 8, count = Math.floor(command / 8);
          if (!count || ![1, 2, 7].includes(operation)) invalid();
          budget.points += count;
          if (budget.points > MAX_POINTS) tooLarge();
          if (operation !== 7) for (let index = 0; index < count * 2; index++) { reader.readVarint(); if (reader.pos > geometryEnd) invalid(); }
        }
      }
    }
    reader.pos = layerEnd;
  }
}

function appendTileElements(data, tile, budget) {
  inspectGeometry(data, budget);
  const vector = new VectorTile(new PbfReader(data)), result = [];
  const convert = (point, extent) => ({lon: (tile.x + point.x / extent) / 2 ** tile.z * 360 - 180,
    lat: Math.atan(Math.sinh(Math.PI * (1 - 2 * (tile.y + point.y / extent) / 2 ** tile.z))) * 180 / Math.PI});
  const same = (left, right) => left.x === right.x && left.y === right.y;
  for (const [name, layer] of Object.entries(vector.layers)) {
    if (!LAYERS.has(name)) continue;
    if (!Number.isSafeInteger(layer.extent) || layer.extent < 1 || layer.extent > 65536) tooLarge();
    for (let index = 0; index < layer.length; index++) {
      const feature = layer.feature(index), tags = tagsFor(name, feature.type, feature.properties);
      if (!tags) continue;
      const label = ['name:zh-Hans', 'name:zh', 'name'].map(key => feature.properties[key]).find(value => typeof value === 'string' && value.trim());
      if (label) tags.name = [...label.trim()].slice(0, 60).join('');
      const parts = feature.loadGeometry();
      if (parts.some(part => part.some(point => !Number.isFinite(point.x) || !Number.isFinite(point.y) || Math.abs(point.x) > layer.extent * 16 || Math.abs(point.y) > layer.extent * 16))) invalid();
      if (feature.type === 1) {
        if (!tags.name) continue;
        for (const part of parts) for (const point of part) if (point.x >= 0 && point.y >= 0 && point.x < layer.extent && point.y < layer.extent) result.push({type: 'node', ...convert(point, layer.extent), tags});
      } else if (feature.type === 2) {
        for (const part of parts) {
          let line = [];
          const flush = () => { if (line.length >= 2) result.push({type: 'way', geometry: line.map(point => convert(point, layer.extent)), tags}); line = []; };
          for (let pointIndex = 1; pointIndex < part.length; pointIndex++) {
            const clipped = clipSegment(part[pointIndex - 1], part[pointIndex], layer.extent);
            if (!clipped || same(clipped[0], clipped[1])) { flush(); continue; }
            if (clipped.every(point => point.x === layer.extent) || clipped.every(point => point.y === layer.extent)) continue;
            if (line.length && !same(line.at(-1), clipped[0])) flush();
            if (!line.length) line.push(clipped[0]);
            line.push(clipped[1]);
          }
          flush();
        }
      } else if (feature.type === 3) {
        for (const rings of classifyRings(parts)) {
          if (!rings.length) continue;
          const outer = clipRing(rings[0], layer.extent);
          if (outer.length < 4) continue;
          const holes = rings.slice(1).map(ring => clipRing(ring, layer.extent)).filter(ring => ring.length >= 4);
          result.push({type: 'way', geometry: outer.map(point => convert(point, layer.extent)), holes: holes.map(ring => ring.map(point => convert(point, layer.extent))), tags});
        }
      }
      if (result.length > MAX_FEATURES) tooLarge();
    }
  }
  budget.outputPoints += result.reduce((total, element) => total + (element.type === 'node' ? 1 : element.geometry.length + (element.holes?.reduce((count, ring) => count + ring.length, 0) || 0)), 0);
  if (budget.outputPoints > MAX_POINTS) tooLarge();
  return result;
}

export async function loadBasemapElements(bounds, {fetchImpl = fetch, signal, now = Date.now, timeoutMs = 30000} = {}) {
  tilesFor(bounds); // Reject unsuitable extents before making any public request.
  if (signal?.aborted) fail('BASEMAP_CANCELLED', '底图准备已取消，原路线保留。', 408);
  const controller = new AbortController(), readers = new Set(), ranges = new Map(), decompressed = new WeakMap(), checkedDirectories = new WeakSet();
  let timer, rejectStop, transferred = 0, reserved = 0, catalogBytes = 0, requestCount = 0, inflatedBytes = 0, directoryEntries = 0, etag, archiveSize;
  const stopped = new Promise((_, reject) => { rejectStop = reject; });
  const stop = error => { rejectStop(error); controller.abort(); for (const reader of readers) cancelReader(reader); };
  const onAbort = () => stop(new TrackError('BASEMAP_CANCELLED', '底图准备已取消，原路线保留。', 408));
  signal?.addEventListener('abort', onAbort, {once: true});
  const supplied = Number(timeoutMs);
  timer = setTimeout(() => stop(new TrackError('BASEMAP_TIMEOUT', '地图文件读取超时，原路线保留，请稍后重试。', 504)), Number.isFinite(supplied) && supplied > 0 ? Math.min(supplied, 30000) : 30000);
  const race = promise => Promise.race([promise, stopped]);
  async function read(stream, limit, {network = false, exact} = {}) {
    if (!stream) invalid();
    const reader = stream.getReader(); readers.add(reader);
    const chunks = []; let size = 0;
    try {
      while (true) {
        const {done, value} = await race(reader.read());
        if (done) break;
        size += value.byteLength;
        if (network) { transferred += value.byteLength; if (transferred > MAX_TRANSFER) tooLarge(); }
        if (size > limit) tooLarge();
        chunks.push(value);
      }
      if (exact !== undefined && size !== exact) invalid();
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      return bytes.buffer;
    } catch (error) { cancelReader(reader); throw error; }
    finally { readers.delete(reader); try { reader.releaseLock(); } catch { /* cancellation already closed reader */ } }
  }
  async function request(url, headers) {
    if (++requestCount > MAX_REQUESTS) tooLarge();
    return await race(fetchImpl(url, {method: 'GET', redirect: 'manual', signal: controller.signal, headers: {'user-agent': USER_AGENT, ...headers}}));
  }
  const decompress = async (buffer, compression) => {
    if (![1, 2].includes(compression)) invalid();
    let byCompression = decompressed.get(buffer);
    if (!byCompression) { byCompression = new Map(); decompressed.set(buffer, byCompression); }
    if (byCompression.has(compression)) return await byCompression.get(compression);
    const operation = (async () => {
      const value = compression === 1 ? buffer : await read(new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip')), MAX_INFLATED);
      if (value.byteLength > MAX_INFLATED || (inflatedBytes += value.byteLength) > MAX_TOTAL_INFLATED) tooLarge();
      return value;
    })();
    byCompression.set(compression, operation);
    return await operation;
  };
  const decompressDirectory = async (buffer, compression) => {
    const raw=await decompress(buffer,compression);
    if(checkedDirectories.has(raw))return raw;
    const bytes=new Uint8Array(raw);let count=0,factor=1,position=0,complete=false;
    for(;position<Math.min(bytes.length,8);position++){
      const byte=bytes[position];count+=(byte&127)*factor;
      if(!Number.isSafeInteger(count)||count>60000)tooLarge();
      if(byte<128){position++;complete=true;break;}factor*=128;
    }
    // The SDK allocates Entry objects from the first varint before reading
    // four columns. Bound that allocation before handing a directory to it.
    if(!complete||bytes.length-position<count*4)fail('BASEMAP_INVALID_DIRECTORY','地图目录记录不完整，请稍后重试。',502);
    if((directoryEntries+=count)>120000)tooLarge();
    checkedDirectories.add(raw);return raw;
  };
  try {
    const catalogResponse = await request(PROTOMAPS_BUILD_INDEX_URL, {accept: 'application/json'});
    if (catalogResponse.status !== 200 || catalogResponse.redirected) { try { await catalogResponse.body?.cancel(); } catch { /* no body */ } fail('BASEMAP_UNAVAILABLE', '地图文件目录暂时不可用，请稍后重试。', 503); }
    if (Number(catalogResponse.headers.get('content-length')) > 65536) tooLarge();
    const catalogBuffer = await read(catalogResponse.body, 65536, {network: true}); catalogBytes = catalogBuffer.byteLength;
    let catalog;
    try { catalog = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(catalogBuffer)); } catch { invalid(); }
    const build = selectBuild(catalog, typeof now === 'function' ? now() : now), archive = `${ARCHIVE_ORIGIN}/${build.key}`;
    const source = {getKey: () => archive, async getBytes(offset, length, _sdkSignal, expectedEtag) {
      if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length <= 0 || length > MAX_RANGE || !Number.isSafeInteger(offset + length) || offset + length > build.size) invalid();
      if (expectedEtag && etag && expectedEtag !== etag) fail('BASEMAP_ARCHIVE_CHANGED', '地图文件在读取中发生变化，请重新生成底图。', 502);
      const key = `${offset}:${length}`;
      if (ranges.has(key)) return await ranges.get(key);
      if ((reserved += length) + catalogBytes > MAX_TRANSFER) tooLarge();
      const operation = (async () => {
        const response = await request(archive, {accept: 'application/octet-stream', range: `bytes=${offset}-${offset + length - 1}`, ...(etag ? {'if-match': etag} : {})});
        if (response.status !== 206 || response.redirected) { try { await response.body?.cancel(); } catch { /* no body */ } fail('BASEMAP_UNAVAILABLE', '地图文件服务未提供部分读取，请稍后重试。', 503); }
        const range = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('content-range') || '');
        const currentEtag = response.headers.get('etag'), declared = response.headers.get('content-length');
        if (!range || Number(range[1]) !== offset || Number(range[2]) !== offset + length - 1 || Number(range[3]) !== build.size
          || !currentEtag || !/^"[^"\r\n]{1,250}"$/.test(currentEtag) || declared !== null && (!/^\d+$/.test(declared) || Number(declared) !== length)) { try { await response.body?.cancel(); } catch { /* no body */ } invalid(); }
        if (etag && currentEtag !== etag) { try { await response.body?.cancel(); } catch { /* no body */ } fail('BASEMAP_ARCHIVE_CHANGED', '地图文件在读取中发生变化，请重新生成底图。', 502); }
        etag = currentEtag; archiveSize = Number(range[3]);
        const data = await read(response.body, length, {network: true, exact: length});
        if (offset === 0) {
          const bytes = new Uint8Array(data), view = new DataView(data);
          if (new TextDecoder().decode(bytes.subarray(0, 7)) !== 'PMTiles' || bytes[7] !== 3) invalid();
          const rootOffset = Number(view.getBigUint64(8, true)), rootLength = Number(view.getBigUint64(16, true));
          if (rootOffset < 127 || rootLength <= 0 || rootOffset + rootLength > data.byteLength) invalid();
        }
        return {data, etag};
      })();
      ranges.set(key, operation);
      return await operation;
    }};
    const pmtiles = new PMTiles(source, new ResolvedValueCache(25, undefined, decompressDirectory), decompress);
    const header = await race(pmtiles.getHeader());
    if (header.specVersion !== 3 || header.tileType !== 1 || ![1, 2].includes(header.internalCompression) || ![1, 2].includes(header.tileCompression)
      || !Number.isInteger(header.minZoom) || !Number.isInteger(header.maxZoom) || header.minZoom > header.maxZoom || header.minZoom < 0 || header.maxZoom > 26) invalid();
    const tiles = tilesFor(bounds, Math.min(13, header.maxZoom), Math.max(10, header.minZoom));
    const tileElements = new Array(tiles.length), budget = {features: 0, points: 0, outputPoints: 0};
    let cursor = 0;
    async function worker() {
      while (cursor < tiles.length) {
        const index = cursor++, tile = tiles[index];
        const response = await race(pmtiles.getZxy(tile.z, tile.x, tile.y, controller.signal));
        tileElements[index] = response ? appendTileElements(response.data, tile, budget) : [];
      }
    }
    await race(Promise.all(Array.from({length: Math.min(4, tiles.length)}, worker)));
    const elements = tileElements.flat();
    if (!elements.length) fail('BASEMAP_NO_FEATURES', '此范围暂无可用的真实地图要素。');
    if (elements.length > MAX_FEATURES) tooLarge();
    return {elements, archive, source: 'Protomaps / OpenStreetMap', sourceVersion: build.version, archiveSize, archiveEtag: etag, zoom: tiles[0].z,
      tileCount: tiles.length, downloadedBytes: transferred, rangeRequestCount: requestCount - 1};
  } catch (error) {
    controller.abort(); for (const reader of readers) cancelReader(reader);
    if (error instanceof TrackError) throw error;
    fail('BASEMAP_INVALID_RESPONSE', '地图文件数据无效或暂时无法读取，请稍后重试。', 502);
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); }
}
