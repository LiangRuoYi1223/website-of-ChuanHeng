import { TrackError } from '../tracks/parse.mjs';
import { loadBasemapElements } from './pmtiles-source.mjs';

export const MAX_BASEMAP_SVG_BYTES = 256 * 1024;
const WIDTH = 1000, HEIGHT = 600, RADIUS = 6378137, RAD = Math.PI / 180;
const LATITUDE_LIMIT = 85.05112878;
const MAX_ELEMENTS = 6000, MAX_DATA_POINTS = 60000, DEADLINE_MS = 30000;
const fail = (code, message, status = 422) => { throw new TrackError(code, message, status); };
const validPoint = point => Array.isArray(point) && point.length >= 2 && Number.isFinite(point[0]) && Number.isFinite(point[1]) && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90;
const project = ([longitude, latitude]) => [RADIUS * longitude * RAD, RADIUS * Math.log(Math.tan(Math.PI / 4 + latitude * RAD / 2))];
const unproject = ([x, y]) => [x / RADIUS / RAD, (2 * Math.atan(Math.exp(y / RADIUS)) - Math.PI / 2) / RAD];
const same = (first, last) => first[0] === last[0] && first[1] === last[1];
const number = value => Math.round(value * 10) / 10;
const escapeText = value => String(value).replace(/[^\u0009\u000a\u000d\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]/gu, '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]);

function frameFor(geojson) {
  const geometry = geojson?.type === 'Feature' ? geojson.geometry : geojson;
  const segments = geometry?.type === 'LineString' ? [geometry.coordinates] : geometry?.type === 'MultiLineString' ? geometry.coordinates : null;
  if (!Array.isArray(segments) || !segments.length || segments.length > 100) fail('BASEMAP_INVALID_GEOMETRY', '底图需要有效的真实路线坐标。');
  let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity, count = 0;
  for (const segment of segments) {
    if (!Array.isArray(segment) || segment.length < 2) fail('BASEMAP_INVALID_GEOMETRY', '路线各段至少需要两个有效坐标点。');
    for (const point of segment) {
      if (++count > 30000 || !validPoint(point)) fail('BASEMAP_INVALID_GEOMETRY', '路线坐标无效或超过 30,000 点，请检查轨迹。');
      if (Math.abs(point[1]) >= LATITUDE_LIMIT) fail('BASEMAP_OUTSIDE_COVERAGE', '路线超出静态地图的纬度覆盖范围。');
      const [x, y] = project(point);
      west = Math.min(west, x); east = Math.max(east, x); south = Math.min(south, y); north = Math.max(north, y);
    }
  }
  let width = Math.max(1000, east - west), height = Math.max(600, north - south);
  if (width / height < WIDTH / HEIGHT) width = height * WIDTH / HEIGHT;
  else height = width * HEIGHT / WIDTH;
  width *= 1.2; height *= 1.2;
  if (width > 200000 || height > 200000 || width * height > 10000 * 1000000) fail('BASEMAP_AREA_TOO_LARGE', '路线范围过大，无法准备单张底图，请将路线分段后上传。');
  const centerX = (west + east) / 2, centerY = (south + north) / 2;
  west = centerX - width / 2; east = centerX + width / 2; south = centerY - height / 2; north = centerY + height / 2;
  const lower = unproject([west, south]), upper = unproject([east, north]);
  const bounds = [...lower, ...upper];
  if (lower[0] < -180 || upper[0] > 180 || lower[1] <= -LATITUDE_LIMIT || upper[1] >= LATITUDE_LIMIT) fail('BASEMAP_OUTSIDE_COVERAGE', '路线范围跨越地图边界，请将路线分段后上传。');
  return { bounds, pixel(point) { const [x, y] = project(point); return [(x - west) / width * WIDTH, (north - y) / height * HEIGHT]; } };
}

// Clip against the actual image rectangle before producing path coordinates.
function clipLine(first, last) {
  const dx = last[0] - first[0], dy = last[1] - first[1];
  const p = [-dx, dx, -dy, dy], q = [first[0], WIDTH - first[0], first[1], HEIGHT - first[1]];
  let low = 0, high = 1;
  for (let edge = 0; edge < 4; edge++) {
    if (p[edge] === 0) { if (q[edge] < 0) return null; continue; }
    const ratio = q[edge] / p[edge];
    if (p[edge] < 0) low = Math.max(low, ratio); else high = Math.min(high, ratio);
    if (low > high) return null;
  }
  return [[first[0] + low * dx, first[1] + low * dy], [first[0] + high * dx, first[1] + high * dy]];
}

function clipPolygon(points) {
  let result = points.slice(0, -1);
  for (const [axis, boundary, positive] of [[0, 0, true], [0, WIDTH, false], [1, 0, true], [1, HEIGHT, false]]) {
    const source = result; result = [];
    if (!source.length) break;
    let previous = source.at(-1), previousInside = positive ? previous[axis] >= boundary : previous[axis] <= boundary;
    for (const current of source) {
      const currentInside = positive ? current[axis] >= boundary : current[axis] <= boundary;
      if (currentInside !== previousInside) {
        const ratio = (boundary - previous[axis]) / (current[axis] - previous[axis]);
        result.push([previous[0] + (current[0] - previous[0]) * ratio, previous[1] + (current[1] - previous[1]) * ratio]);
      }
      if (currentInside) result.push(current);
      previous = current; previousInside = currentInside;
    }
  }
  return result;
}

function pathForLine(points) {
  let path = '', previous;
  for (let index = 1; index < points.length; index++) {
    const clipped = clipLine(points[index - 1], points[index]);
    if (!clipped || same(clipped[0], clipped[1])) { previous = null; continue; }
    const [first, last] = clipped.map(point => point.map(number));
    if (!previous || !same(previous, first)) path += `M${first.join(',')}`;
    if (!previous || !same(previous, last)) path += `L${last.join(',')}`;
    previous = last;
  }
  return path;
}

function renderMap(data, frame) {
  if (!data || data.remark || !Array.isArray(data.elements)) fail('BASEMAP_INVALID_RESPONSE', '地图服务未返回完整的地图要素，请稍后重试。', 502);
  if (data.elements.length > MAX_ELEMENTS) fail('BASEMAP_DATA_TOO_LARGE', '此范围地图要素过多，请缩小路线范围后重试。');
  const areas = [], waterways = [], roads = [], labels = [], labelBoxes = [];
  let pointCount = 0, featureCount = 0;
  function label(name, pixel) {
    if (typeof name !== 'string' || !name.trim() || labels.length >= 80) return;
    const text = [...name.trim()].slice(0, 60).join('');
    const [x, y] = pixel;
    const width = Math.min(430, [...text].length * 13), box = [x + 5, y - 18, x + width + 9, y + 3];
    if (box[0] < 5 || box[1] < 5 || box[2] > WIDTH - 5 || box[3] > HEIGHT - 28 || labelBoxes.some(existing => box[0] < existing[2] && box[2] > existing[0] && box[1] < existing[3] && box[3] > existing[1])) return;
    labelBoxes.push(box);
    labels.push(`<text x="${number(x + 5)}" y="${number(y - 3)}" fill="#354038" font-size="13" stroke="#f6f3e9" stroke-width="3" paint-order="stroke" stroke-linejoin="round">${escapeText(text)}</text>`);
  }
  for (const element of data.elements) {
    if (!element || !element.tags || typeof element.tags !== 'object') continue;
    const tags = element.tags, name = typeof tags['name:zh'] === 'string' ? tags['name:zh'] : tags.name;
    if (element.type === 'node') {
      if (!/^(?:city|town|village|hamlet|suburb|locality)$/.test(tags.place || '') && !/^(?:peak|saddle)$/.test(tags.natural || '')) continue;
      const point = [element.lon, element.lat];
      if (!validPoint(point) || Math.abs(point[1]) >= LATITUDE_LIMIT) continue;
      const pixel = frame.pixel(point);
      if (pixel[0] >= 0 && pixel[0] <= WIDTH && pixel[1] >= 0 && pixel[1] <= HEIGHT && typeof name === 'string' && name.trim()) {
        const before = labels.length; label(name, pixel); if (labels.length > before) featureCount++;
      }
      continue;
    }
    if (element.type !== 'way' || !Array.isArray(element.geometry) || element.geometry.length < 2) continue;
    pointCount += element.geometry.length;
    if (pointCount > MAX_DATA_POINTS) fail('BASEMAP_DATA_TOO_LARGE', '此范围地图坐标过多，请缩小路线范围后重试。');
    const coordinates = element.geometry.map(point => [point?.lon, point?.lat]);
    if (!coordinates.every(point => validPoint(point) && Math.abs(point[1]) < LATITUDE_LIMIT)) continue;
    const pixels = coordinates.map(frame.pixel);
    const water = tags.natural === 'water' || tags.landuse === 'reservoir' || tags.waterway === 'riverbank';
    const green = /^(?:wood|scrub)$/.test(tags.natural || '') || /^(?:forest|meadow|grass)$/.test(tags.landuse || '');
    if ((water || green || tags.natural === 'wetland') && coordinates.length >= 4 && same(coordinates[0], coordinates.at(-1))) {
      const polygon = clipPolygon(pixels);
      if (polygon.length >= 3) {
        const rings=[polygon];
        for(const hole of element.holes || []) {
          if(!Array.isArray(hole)||hole.length<4||!hole.every(point=>validPoint([point?.lon,point?.lat])&&Math.abs(point.lat)<LATITUDE_LIMIT)||!same([hole[0].lon,hole[0].lat],[hole.at(-1).lon,hole.at(-1).lat])) fail('BASEMAP_INVALID_RESPONSE','地图区域边界无效，请稍后重试。',502);
          pointCount+=hole.length;
          if(pointCount>MAX_DATA_POINTS)fail('BASEMAP_DATA_TOO_LARGE','此范围地图坐标过多，请缩小路线范围后重试。');
          const clipped=clipPolygon(hole.map(point=>frame.pixel([point.lon,point.lat])));
          if(clipped.length>=3)rings.push(clipped);
        }
        const path = rings.map(ring=>`M${ring.map(point => point.map(number).join(',')).join('L')}Z`).join('');
        areas.push(`<path d="${path}" fill-rule="evenodd" fill="${water ? '#a8d0df' : tags.natural === 'wetland' ? '#c9ddd5' : '#d0dfc5'}" stroke="none"/>`);
        featureCount++;
      }
    }
    const path = pathForLine(pixels);
    if (!path) continue;
    if (typeof tags.highway === 'string' && tags.highway) {
      const major = /^(?:motorway|trunk|primary|secondary|tertiary)(?:_link)?$/.test(tags.highway);
      const trail = /^(?:path|footway|track|cycleway|steps|bridleway)$/.test(tags.highway);
      roads.push(`<path d="${path}" fill="none" stroke="${major ? '#a59a7e' : trail ? '#737e69' : '#a9a292'}" stroke-width="${major ? '2.4' : trail ? '1.1' : '1.5'}"${trail ? ' stroke-dasharray="4 3"' : ''}/>`);
      featureCount++;
    } else if (typeof tags.waterway === 'string' && tags.waterway && tags.waterway !== 'riverbank') {
      waterways.push(`<path d="${path}" fill="none" stroke="#6ba5c2" stroke-width="${tags.waterway === 'river' ? '2.5' : '1.3'}"/>`);
      featureCount++;
    }
  }
  if (!featureCount) fail('BASEMAP_NO_FEATURES', '此范围暂无可用的真实地图要素，未生成替代示意图。');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}"><rect width="${WIDTH}" height="${HEIGHT}" fill="#ebe9df"/><g stroke-linecap="round" stroke-linejoin="round">${areas.join('')}${waterways.join('')}${roads.join('')}</g><g font-family="sans-serif">${labels.join('')}<rect x="0" y="578" width="1000" height="22" fill="#f6f3e9"/><text x="990" y="593" text-anchor="end" font-size="11" fill="#4b5b51">© OpenStreetMap contributors · Protomaps · ODbL · openstreetmap.org/copyright</text></g></svg>`;
  const bytes = new TextEncoder().encode(svg);
  if (bytes.byteLength > MAX_BASEMAP_SVG_BYTES) fail('BASEMAP_IMAGE_TOO_LARGE', '底图图片超过 256 KiB，请缩小路线范围后重试。');
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return `data:image/svg+xml;base64,${btoa(binary)}`;
}

export async function createRouteBasemap(geojson, { fetchImpl = fetch, signal, now = Date.now, timeoutMs = DEADLINE_MS, loadElements = loadBasemapElements } = {}) {
  const frame = frameFor(geojson);
  const generatedAt = new Date(typeof now === 'function' ? now() : now).toISOString();
  if (signal?.aborted) fail('BASEMAP_CANCELLED', '底图准备已取消，原路线保留。', 408);
  const controller = new AbortController();
  let timer, rejectDeadline;
  const deadline = new Promise((_, reject) => {
    rejectDeadline = reject;
    const supplied = Number(timeoutMs);
    timer = setTimeout(() => { reject(new TrackError('BASEMAP_TIMEOUT', '地图资源读取超时，原路线保留，请稍后重试。', 504)); controller.abort(); }, Number.isFinite(supplied) && supplied > 0 ? Math.min(supplied, DEADLINE_MS) : DEADLINE_MS);
  });
  const abort = () => { rejectDeadline(new TrackError('BASEMAP_CANCELLED', '底图准备已取消，原路线保留。', 408)); controller.abort(); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    return await Promise.race([deadline, (async () => {
      const data = await loadElements(frame.bounds,{fetchImpl,signal:controller.signal});
      if (controller.signal.aborted) fail('BASEMAP_CANCELLED', '底图准备已取消，原路线保留。', 408);
      const image = renderMap(data, frame);
      const sourceArchive=data.archive || data.sourceArchive;
      return { version: 1, format: 'svg', image, bounds: frame.bounds, projection: 'EPSG:3857', width: WIDTH, height: HEIGHT,
        attribution: '© OpenStreetMap contributors', source: 'Protomaps / OpenStreetMap', license: 'ODbL-1.0', licenseUrl: 'https://www.openstreetmap.org/copyright', generatedAt,
        ...(sourceArchive?{sourceArchive,sourceVersion:data.sourceVersion,sourceZoom:data.zoom}:{}) };
    })()]);
  } catch (error) {
    if (error instanceof TrackError) throw error;
    fail('BASEMAP_UNAVAILABLE', '无法准备真实底图，原路线保留，请稍后重试。', 502);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
