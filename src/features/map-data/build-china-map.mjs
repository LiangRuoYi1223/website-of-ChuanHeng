import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

// Rebuild with: node src/features/map-data/build-china-map.mjs
// The complete upstream GeoJSON is kept beside this script; no runtime requests.
const raw = readFileSync(new URL('./china-provinces.geojson', import.meta.url));
const geo = JSON.parse(raw.toString('utf8'));
const radians = Math.PI / 180;
const phi1 = 25 * radians, phi2 = 47 * radians, phi0 = 35 * radians;
const n = (Math.sin(phi1) + Math.sin(phi2)) / 2;
const c = Math.cos(phi1) ** 2 + 2 * n * Math.sin(phi1);
const rho0 = Math.sqrt(c - 2 * n * Math.sin(phi0)) / n;
function albers([lon, lat]) {
  const rho = Math.sqrt(c - 2 * n * Math.sin(lat * radians)) / n;
  const theta = n * (lon - 105) * radians;
  return [rho * Math.sin(theta), rho0 - rho * Math.cos(theta)];
}
function polygons(feature) {
  return feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : feature.geometry.coordinates;
}
function area(polygon) {
  const ring = polygon[0];
  return Math.abs(ring.reduce((sum, point, i) => {
    const next = ring[(i + 1) % ring.length];
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0));
}
const hainan = geo.features.find(feature => feature.properties.adcode === 460000);
const hainanPolygons = polygons(hainan);
const hainanMain = hainanPolygons.reduce((largest, polygon) => area(polygon) > area(largest) ? polygon : largest);
const main = geo.features.filter(feature => feature.properties.adcode !== '100000_JD').map(feature => ({
  adcode: String(feature.properties.adcode), name: feature.properties.name,
  polygons: feature.properties.adcode === 460000 ? [hainanMain] : polygons(feature),
}));
const projectedPoints = main.flatMap(feature => feature.polygons.flatMap(polygon => polygon.flatMap(ring => ring.map(albers))));
const minX = Math.min(...projectedPoints.map(point => point[0]));
const maxX = Math.max(...projectedPoints.map(point => point[0]));
const minY = Math.min(...projectedPoints.map(point => point[1]));
const maxY = Math.max(...projectedPoints.map(point => point[1]));
const scale = Math.min(830 / (maxX - minX), 540 / (maxY - minY));
const fit = { minX, maxY, scale, left: 35 + (830 - (maxX - minX) * scale) / 2, top: 24 + (540 - (maxY - minY) * scale) / 2 };
function mainProject(point) {
  const [x, y] = albers(point);
  return [fit.left + (x - fit.minX) * fit.scale, fit.top + (fit.maxY - y) * fit.scale];
}
// A geographic inset moves the southern islands into a compact view without
// redrawing boundaries. Preserve both the island rings and the source JD paths.
function insetProject([lon, lat]) { return [777 + (lon - 107) / 17 * 98, 428 + (25.5 - lat) / 23.5 * 144]; }
function pathData(shape, project) {
  return shape.map(polygon => polygon.map(ring => ring.map((point, i) => {
    const [x, y] = project(point);
    return `${i ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join('') + 'Z').join('')).join('');
}
const provinces = main.map(feature => ({ adcode: feature.adcode, name: feature.name, path: pathData(feature.polygons, mainProject) }));
const jd = geo.features.find(feature => feature.properties.adcode === '100000_JD');
const inset = [
  { adcode: '460000', name: '海南与南海诸岛', path: pathData(hainanPolygons, insetProject) },
  { adcode: '100000_JD', name: '源数据海域界线', path: pathData(polygons(jd), insetProject) },
];
const source = '// Generated from the adjacent DataV GeoJSON. Do not hand-edit geographic paths.\n';
const output = `${source}export interface ChinaMapPath { adcode: string; name: string; path: string; }\nexport const CHINA_VIEWBOX = { width: 920, height: 650 } as const;\nexport const chinaProvinces: ChinaMapPath[] = ${JSON.stringify(provinces)};\nexport const southSeaPaths: ChinaMapPath[] = ${JSON.stringify(inset)};\nconst fit = ${JSON.stringify(fit)};\nexport function projectChinaPoint(lon: number, lat: number): [number, number] {\n  const radians = Math.PI / 180;\n  const n = (Math.sin(25 * radians) + Math.sin(47 * radians)) / 2;\n  const c = Math.cos(25 * radians) ** 2 + 2 * n * Math.sin(25 * radians);\n  const rho0 = Math.sqrt(c - 2 * n * Math.sin(35 * radians)) / n;\n  const rho = Math.sqrt(c - 2 * n * Math.sin(lat * radians)) / n;\n  const theta = n * (lon - 105) * radians;\n  return [fit.left + (rho * Math.sin(theta) - fit.minX) * fit.scale, fit.top + (fit.maxY - (rho0 - rho * Math.cos(theta))) * fit.scale];\n}\n`;
writeFileSync(new URL('./china-paths.ts', import.meta.url), output);
console.log(JSON.stringify({ provinces: provinces.length, insetFeatures: inset.length, sourceBytes: raw.length, sourceSha256: createHash('sha256').update(raw).digest('hex'), generatedBytes: Buffer.byteLength(output), fit }, null, 2));
