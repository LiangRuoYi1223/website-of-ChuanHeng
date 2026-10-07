import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

// Rebuild from the checked-in, reduced upstream snapshot; network is opt-in.
// Refresh with: node src/features/map-data/build-city-catalog.mjs --refresh
const directory = new URL('./', import.meta.url);
const snapshotFile = new URL('city-source-properties.json', directory);
const taiwanSnapshotFile = new URL('taiwan-city-points.json', directory);
const catalogFile = new URL('cities.ts', directory);
const municipalCodes = new Set([110000, 120000, 310000, 500000, 810000, 820000]);
const rootSourceUrl = 'https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json';

function selectProperties(properties) {
  return {
    adcode: properties.adcode,
    name: properties.name,
    level: properties.level,
    center: properties.center,
    ...(properties.centroid ? { centroid: properties.centroid } : {}),
    ...(properties.parent ? { parent: properties.parent.adcode } : {}),
  };
}

async function download(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
  const raw = Buffer.from(await response.arrayBuffer());
  const json = JSON.parse(raw.toString('utf8'));
  if (!Array.isArray(json.features)) throw new Error(`Missing GeoJSON features: ${url}`);
  return {
    url,
    sha256: createHash('sha256').update(raw).digest('hex'),
    bytes: raw.length,
    features: json.features.filter(feature => Number.isInteger(feature.properties?.adcode)).map(feature => selectProperties(feature.properties)),
  };
}

if (process.argv.includes('--refresh')) {
  const root = await download(rootSourceUrl);
  const provinces = root.features.filter(feature => feature.level === 'province');
  if (provinces.length !== 34) throw new Error(`Expected 34 provinces; got ${provinces.length}`);
  const sources = [];
  // Keep requests bounded and retain only feature properties, never city boundaries.
  for (let start = 0; start < provinces.length; start += 4) {
    const group = provinces.slice(start, start + 4).filter(province => !municipalCodes.has(province.adcode) && province.adcode !== 710000);
    const downloaded = await Promise.all(group.map(province => download(`https://geo.datav.aliyun.com/areas_v3/bound/${province.adcode}_full.json`)));
    sources.push(...downloaded);
    console.log(`Province sources downloaded: ${sources.length}`);
  }
  const snapshot = {
    retrievedDate: '2026-10-05',
    origin: 'DataV.GeoAtlas (AMAP source data)',
    root,
    provinces: sources.sort((a, b) => a.url.localeCompare(b.url)),
  };
  await writeFile(snapshotFile, `${JSON.stringify(snapshot, null, 2)}\n`, 'utf8');
}

const snapshot = JSON.parse(await readFile(snapshotFile, 'utf8'));
const provinceMap = new Map(snapshot.root.features.map(province => [province.adcode, province]));
const rows = [];
function append(properties, province) {
  const point = properties.center ?? properties.centroid;
  if (!Array.isArray(point) || point.length !== 2 || point.some(value => !Number.isFinite(value))) {
    throw new Error(`No representative point for ${properties.adcode} ${properties.name}`);
  }
  rows.push({ code: String(properties.adcode), name: properties.name, provinceCode: String(province.adcode), provinceName: province.name, longitude: point[0], latitude: point[1] });
}

for (const province of snapshot.root.features) {
  if (municipalCodes.has(province.adcode)) append(province, province);
}
for (const source of snapshot.provinces) {
  for (const properties of source.features) {
    const province = provinceMap.get(properties.parent);
    if (!province) throw new Error(`Unrecognized province for ${properties.name}`);
    // Direct province children include cities, prefectures/leagues, and directly
    // administered county-level units; all are selectable location granularity.
    append(properties, province);
  }
}
const taiwan = JSON.parse(await readFile(taiwanSnapshotFile, 'utf8'));
for (const county of taiwan.features) {
  rows.push({
    code: `TW-${county.countyCode}`,
    name: county.countyName,
    provinceCode: '710000',
    provinceName: provinceMap.get(710000).name,
    longitude: county.longitude,
    latitude: county.latitude,
  });
}
rows.sort((a, b) => a.code.localeCompare(b.code));
if (new Set(rows.map(row => row.code)).size !== rows.length) throw new Error('Duplicate location codes');
const generated = `// Generated from local DataV and NLSC snapshots by build-city-catalog.mjs.\n// Representative city points for display, not navigation or trailhead coordinates.\n// See SOURCE.md for retrieval date, coverage, and source limitations.\nexport interface CityLocation {\n  code: string;\n  name: string;\n  provinceCode: string;\n  provinceName: string;\n  longitude: number;\n  latitude: number;\n}\n\nexport const cities: CityLocation[] = ${JSON.stringify(rows, null, 2)};\n\nconst cityByCode = new Map(cities.map(city => [city.code, city]));\n\nexport function findCity(code: string | undefined): CityLocation | undefined {\n  return code ? cityByCode.get(code) : undefined;\n}\n`;
await writeFile(catalogFile, generated, 'utf8');
console.log(`Generated ${rows.length} local city locations across ${new Set(rows.map(row => row.provinceCode)).size} provinces.`);
