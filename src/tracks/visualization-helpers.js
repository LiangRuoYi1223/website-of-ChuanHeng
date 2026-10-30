// Drawing helpers only. Distances, ascent and descent remain the importer's results.
export function unwrapLongitude(longitude, reference) {
  return longitude + 360 * Math.round((reference - longitude) / 360);
}

const validCoordinate = point => Array.isArray(point) && Number.isFinite(point[0]) && Number.isFinite(point[1]) && Math.abs(point[1]) <= 90;
const pathFor = points => points.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ');

export function unwrapTrackSegments(segments = []) {
  if (!Array.isArray(segments)) return [];
  const first = segments.find(segment => Array.isArray(segment) && segment.length && segment.every(validCoordinate));
  const anchor = first?.[0]?.[0] ?? 0;
  return segments.map(segment => {
    if (!Array.isArray(segment) || !segment.length || !segment.every(validCoordinate)) return [];
    let previous = anchor;
    return segment.map(point => {
      const longitude = unwrapLongitude(point[0], previous);
      previous = longitude;
      return [longitude, point[1], Number.isFinite(point[2]) ? point[2] : null];
    });
  });
}

export function buildTrackMapModel(track, { width = 900, height = 420, padding = 35 } = {}) {
  const geometry = track?.geojson?.geometry;
  const source = geometry?.type === 'MultiLineString' ? geometry.coordinates : geometry?.type === 'LineString' ? [geometry.coordinates] : [];
  const coordinates = unwrapTrackSegments(source);
  const all = coordinates.flat();
  if (!all.length) return { width, height, padding, segments: [], bounds: null, start: null, end: null, project: () => null };
  let minLon = Infinity, minLat = Infinity, maxLon = -Infinity, maxLat = -Infinity;
  for (const [longitude, latitude] of all) {
    minLon = Math.min(minLon, longitude); maxLon = Math.max(maxLon, longitude);
    minLat = Math.min(minLat, latitude); maxLat = Math.max(maxLat, latitude);
  }
  const centerLon = (minLon + maxLon) / 2;
  const centerLat = (minLat + maxLat) / 2;
  // A local equirectangular coordinate plot, deliberately without simulated terrain.
  const correction = Math.max(.01, Math.cos(centerLat * Math.PI / 180));
  const scale = Math.min((width - padding * 2) / Math.max((maxLon - minLon) * correction, 1e-9), (height - padding * 2) / Math.max(maxLat - minLat, 1e-9));
  const project = (longitude, latitude) => ({
    x: width / 2 + (unwrapLongitude(longitude, centerLon) - centerLon) * correction * scale,
    y: height / 2 - (latitude - centerLat) * scale,
  });
  const segments = coordinates.map((segment, index) => {
    const points = segment.map(([lon, lat, elevationM]) => ({ ...project(lon, lat), lon, lat, elevationM }));
    return { index, coordinates: segment, points, path: pathFor(points) };
  }).filter(segment => segment.points.length);
  return { width, height, padding, segments, bounds: [minLon, minLat, maxLon, maxLat], start: segments[0].points[0], end: segments.at(-1).points.at(-1), project };
}

function ticksBetween(minimum, maximum, count = 5) {
  if (minimum === maximum) return [minimum];
  const raw = (maximum - minimum) / Math.max(1, count - 1);
  const power = 10 ** Math.floor(Math.log10(raw));
  const ratio = raw / power;
  const step = (ratio <= 1 ? 1 : ratio <= 2 ? 2 : ratio <= 5 ? 5 : 10) * power;
  const ticks = [];
  for (let value = Math.ceil(minimum / step) * step; value <= maximum + step * 1e-8 && ticks.length < 20; value += step) ticks.push(Number(value.toPrecision(12)));
  return ticks.length >= 2 ? ticks : [minimum, maximum];
}

export function formatKilometers(distanceM) {
  if (!Number.isFinite(distanceM)) return '—';
  const kilometers = distanceM / 1000;
  const digits = kilometers === 0 || Math.abs(kilometers) >= 10 ? 1 : Math.abs(kilometers) >= 1 ? 2 : Math.abs(kilometers) >= .01 ? 3 : 6;
  return `${Number(kilometers.toFixed(digits))} km`;
}

export function formatMeters(value) {
  return Number.isFinite(value) ? `${Number(value.toFixed(1)).toLocaleString('zh-CN')} m` : '—';
}

export function buildElevationModel(profile = [], { width = 900, height = 260, distanceKey = 'distanceM' } = {}) {
  const source = Array.isArray(profile) ? profile : [];
  const padding = { left: 68, right: 28, top: 24, bottom: 42 };
  let maxDistance = 0, minimum = Infinity, maximum = -Infinity;
  for (const point of source) {
    if (!Number.isFinite(point?.[distanceKey]) || point[distanceKey] < 0) continue;
    maxDistance = Math.max(maxDistance, point[distanceKey]);
    if (Number.isFinite(point.elevationM)) { minimum = Math.min(minimum, point.elevationM); maximum = Math.max(maximum, point.elevationM); }
  }
  const hasElevation = Number.isFinite(minimum);
  const extra = hasElevation ? minimum === maximum ? Math.max(1, Math.abs(minimum) * .02) : Math.max(1, (maximum - minimum) * .1) : 0;
  const elevationDomain = hasElevation ? [minimum - extra, maximum + extra] : [0, 0];
  const xFor = distance => padding.left + (maxDistance > 0 ? distance / maxDistance : .5) * (width - padding.left - padding.right);
  const yFor = elevation => height - padding.bottom - (elevation - elevationDomain[0]) / (elevationDomain[1] - elevationDomain[0] || 1) * (height - padding.top - padding.bottom);
  const points = source.map((point, index) => Number.isFinite(point?.[distanceKey]) && point[distanceKey] >= 0 && Number.isFinite(point?.elevationM) ? { index, source: point, x: xFor(point[distanceKey]), y: yFor(point.elevationM) } : null);
  const lines = [];
  let current = null;
  for (let index = 0; index < points.length; index++) {
    const point = points[index];
    if (!point) { current = null; continue; }
    const segment = point.source.segment ?? 0;
    if (!current || current.segment !== segment || (index > 0 && source[index][distanceKey] < source[index - 1]?.[distanceKey])) {
      current = { segment, points: [], path: '' }; lines.push(current);
    }
    current.points.push(point);
  }
  for (const line of lines) line.path = pathFor(line.points);
  const distances = [...new Set([0, ...ticksBetween(0, maxDistance), maxDistance])].sort((a, b) => a - b);
  return {
    width, height, padding, hasElevation, points, lines, distanceDomain: [0, maxDistance], elevationDomain,
    xTicks: distances.map(value => ({ value, x: xFor(value), label: formatKilometers(value) })),
    yTicks: hasElevation ? ticksBetween(...elevationDomain).map(value => ({ value, y: yFor(value), label: formatMeters(value) })) : [],
    xFor, yFor,
  };
}

export function nearestProfileIndex(profile, distance, distanceKey = 'segmentDistanceM') {
  if (!profile.length) return -1;
  let low = 0, high = profile.length - 1;
  while (low < high) { const middle = Math.floor((low + high) / 2); if (profile[middle][distanceKey] < distance) low = middle + 1; else high = middle; }
  if (low > 0 && Math.abs(profile[low - 1][distanceKey] - distance) <= Math.abs(profile[low][distanceKey] - distance)) return low - 1;
  return low;
}

const escapeMarkup = value => String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

// Sources checked 2026-10-31: https://opentopomap.org/about#verwendung
// Leaflet 1.9.4 API: https://leafletjs.com/reference.html
export function terrainTileConfiguration(environment = {}) {
  const url = String(environment.VITE_TERRAIN_TILE_URL || '').trim();
  const credit = String(environment.VITE_TERRAIN_TILE_ATTRIBUTION || '').trim();
  if (url.toLowerCase() === 'offline') return { offline: true, reason: '已配置为仅显示本地坐标轨迹。' };
  if (url && (!/^https:\/\//i.test(url) || !['{z}', '{x}', '{y}'].every(token => url.includes(token)))) return { offline: true, reason: '底图地址配置无效，当前仅显示真实坐标轨迹。' };
  if (url && !credit) return { offline: true, reason: '自定义底图缺少来源署名，当前仅显示真实坐标轨迹。' };
  const configuredZoom = Number(environment.VITE_TERRAIN_TILE_MAX_ZOOM);
  return {
    offline: false, custom: Boolean(url), url: url || 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    maxZoom: Number.isFinite(configuredZoom) && configuredZoom >= 1 ? Math.min(20, Math.floor(configuredZoom)) : 17,
    attribution: url ? escapeMarkup(credit) : '地图数据 &copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a> | DEM: SRTM, Sonny | 地图样式 &copy; <a href="https://opentopomap.org" target="_blank" rel="noopener noreferrer">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/" target="_blank" rel="noopener noreferrer">CC-BY-SA</a>)',
    plainAttribution: url ? credit : '© OpenStreetMap contributors · DEM: SRTM, Sonny · © OpenTopoMap (CC-BY-SA)',
  };
}
