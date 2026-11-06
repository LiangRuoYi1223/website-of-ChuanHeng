import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { scheduleInstant } from '../activities/schedule.js';

export const MAX_CACHED_BASEMAP_IMAGE_BYTES = 350 * 1024;
const MAX_SVG_BYTES = 256 * 1024;
const MAX_TRACK_POINTS = 30000;
const MAX_TRACK_SEGMENTS = 100;
const PREFIX = 'data:image/svg+xml;base64,';
const LATITUDE_LIMIT = 85.05112878;
const ATTRIBUTION = '© OpenStreetMap contributors';
const SOURCE = 'OpenStreetMap / Overpass API';
const LICENSE_URL = 'https://www.openstreetmap.org/copyright';
const mercatorY = latitude => Math.log(Math.tan(Math.PI / 4 + latitude * Math.PI / 360));
const parser = new XMLParser({ preserveOrder: true, ignoreAttributes: false, attributeNamePrefix: '', parseTagValue: false, parseAttributeValue: false, processEntities: false, trimValues: false });
const numeric = /^-?\d+(?:\.\d+)?$/;
const attributes = {
  xmlns: value => value === 'http://www.w3.org/2000/svg',
  viewBox: value => value === '0 0 1000 600',
  width: value => numeric.test(value), height: value => numeric.test(value),
  x: value => numeric.test(value), y: value => numeric.test(value),
  fill: value => /^(?:#[\da-fA-F]{3,8}|none)$/.test(value),
  stroke: value => /^(?:#[\da-fA-F]{3,8}|none)$/.test(value),
  'stroke-width': value => numeric.test(value), 'font-size': value => numeric.test(value),
  'stroke-linecap': value => value === 'round', 'stroke-linejoin': value => value === 'round',
  'stroke-dasharray': value => /^[\d. ]+$/.test(value),
  'font-family': value => value === 'sans-serif',
  'paint-order': value => value === 'stroke',
  'text-anchor': value => ['start', 'middle', 'end'].includes(value),
  d: value => /^[MLZmlz\d.,\s-]+$/.test(value),
};

function passiveSvg(image) {
  if (typeof image !== 'string' || image.length > MAX_CACHED_BASEMAP_IMAGE_BYTES || !image.startsWith(PREFIX)) return false;
  const encoded = image.slice(PREFIX.length);
  if (!encoded || encoded.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return false;
  try {
    const binary = atob(encoded);
    if (binary.length > MAX_SVG_BYTES) return false;
    const svg = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, character => character.charCodeAt(0)));
    if (/<!|<\?/.test(svg) || XMLValidator.validate(svg, { allowBooleanAttributes: false }) !== true) return false;
    const roots = parser.parse(svg);
    if (roots.length !== 1 || !Array.isArray(roots[0].svg)) return false;
    const root = roots[0][':@'];
    if (root?.xmlns !== 'http://www.w3.org/2000/svg' || root.width !== '1000' || root.height !== '600' || root.viewBox !== '0 0 1000 600') return false;
    function safe(nodes, depth = 0) {
      if (depth > 8) return false;
      return nodes.every(node => {
        const tag = Object.keys(node).find(key => key !== ':@');
        if (tag === '#text') return typeof node[tag] === 'string';
        if (!['svg', 'g', 'rect', 'path', 'text'].includes(tag) || tag === 'svg' && depth !== 0) return false;
        if (!Object.entries(node[':@'] || {}).every(([key, value]) => Object.hasOwn(attributes, key) && attributes[key](value))) return false;
        return Array.isArray(node[tag]) && safe(node[tag], depth + 1);
      });
    }
    return safe(roots);
  } catch { return false; }
}

export function readCachedBasemap(value) {
  if (!value || typeof value !== 'object' || value.version !== 1 || value.format !== 'svg' || value.projection !== 'EPSG:3857' || value.width !== 1000 || value.height !== 600) return null;
  const bounds = value.bounds;
  if (!Array.isArray(bounds) || bounds.length !== 4 || !bounds.every(Number.isFinite)) return null;
  const [west, south, east, north] = bounds;
  if (west < -180 || east > 180 || west >= east || south <= -LATITUDE_LIMIT || north >= LATITUDE_LIMIT || south >= north) return null;
  const lower = mercatorY(south), upper = mercatorY(north);
  if (!Number.isFinite(lower) || !Number.isFinite(upper) || !(upper > lower)) return null;
  if (value.attribution !== ATTRIBUTION || value.source !== SOURCE || !Number.isFinite(scheduleInstant(value.generatedAt))) return null;
  if (value.license != null && value.license !== 'ODbL-1.0' || value.licenseUrl != null && value.licenseUrl !== LICENSE_URL || !passiveSvg(value.image)) return null;
  return { version: 1, format: 'svg', image: value.image, bounds: [...bounds], projection: 'EPSG:3857', width: 1000, height: 600, attribution: ATTRIBUTION, source: SOURCE, license: 'ODbL-1.0', licenseUrl: LICENSE_URL, generatedAt: value.generatedAt };
}

export function buildCachedTrackMapModel(track) {
  const geometry = track?.geojson?.geometry;
  const source = geometry?.type === 'MultiLineString' ? geometry.coordinates : geometry?.type === 'LineString' ? [geometry.coordinates] : null;
  if (!Array.isArray(source) || !source.length || source.length > MAX_TRACK_SEGMENTS) return null;
  let pointCount = 0;
  for (const segment of source) {
    if (!Array.isArray(segment) || !segment.length || segment.length > MAX_TRACK_POINTS - pointCount) return null;
    pointCount += segment.length;
  }
  const basemap = readCachedBasemap(track?.basemap);
  if (!basemap) return null;
  const [west, south, east, north] = basemap.bounds;
  const lower = mercatorY(south), upper = mercatorY(north);
  const inside = (lon, lat) => Number.isFinite(lon) && Number.isFinite(lat) && lon >= west && lon <= east && lat >= south && lat <= north;
  const project = (lon, lat) => {
    if (!inside(lon, lat)) return null;
    const x = (lon - west) / (east - west) * basemap.width, y = (upper - mercatorY(lat)) / (upper - lower) * basemap.height;
    return Number.isFinite(x) && Number.isFinite(y) && x >= 0 && x <= basemap.width && y >= 0 && y <= basemap.height ? { x, y } : null;
  };
  const segments = [];
  for (const [index, coordinates] of source.entries()) {
    const points = [];
    for (const coordinate of coordinates) {
      if (!Array.isArray(coordinate)) return null;
      const [lon, lat, elevationM] = coordinate;
      const pixel = project(lon, lat);
      if (!pixel) return null;
      points.push({ ...pixel, lon, lat, elevationM });
    }
    segments.push({ index, points, path: points.map((point, pointIndex) => `${pointIndex ? 'L' : 'M'}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(' ') });
  }
  return { basemap, width: basemap.width, height: basemap.height, bounds: basemap.bounds, segments, start: segments[0].points[0], end: segments.at(-1).points.at(-1), project };
}
