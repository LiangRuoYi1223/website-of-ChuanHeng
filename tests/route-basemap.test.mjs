import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { createRouteBasemap } from '../server/basemaps/create-route-basemap.mjs';

// Synthetic coordinates and OSM-shaped elements; never real member or route data.
const geojson = { type: 'Feature', properties: { name: 'private route name never sent' }, geometry: { type: 'MultiLineString', coordinates: [[[114, 22], [114.01, 22.01]]] } };
const elements = [
  { type: 'way', id: 1, tags: { highway: 'path', name: '合成道路' }, geometry: [{ lon: 114, lat: 22 }, { lon: 114.01, lat: 22.01 }] },
  { type: 'way', id: 2, tags: { natural: 'water' }, geometry: [{ lon: 114.001, lat: 22.001 }, { lon: 114.004, lat: 22.001 }, { lon: 114.004, lat: 22.004 }, { lon: 114.001, lat: 22.001 }] },
  { type: 'way', id: 3, tags: { landuse: 'forest' }, geometry: [{ lon: 114.006, lat: 22.006 }, { lon: 114.009, lat: 22.006 }, { lon: 114.009, lat: 22.009 }, { lon: 114.006, lat: 22.006 }] },
  { type: 'node', id: 4, tags: { place: 'village', name: '<script>alert(1)</script> & "村"' }, lon: 114.005, lat: 22.005 },
];
const response = data => Response.json(data || { elements });
const decodeSvg = basemap => new TextDecoder().decode(Uint8Array.from(atob(basemap.image.split(',')[1]), character => character.charCodeAt(0)));

test('one bounded Overpass data request creates a self-contained real map image with aligned Mercator metadata', async () => {
  const calls = [];
  const basemap = await createRouteBasemap(geojson, { now: 0, fetchImpl: async (url, options) => {
    calls.push({ url, options }); return response();
  } });
  assert.ok(basemap, 'a saved static basemap must be returned');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://overpass.private.coffee/api/interpreter');
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.redirect, 'manual');
  const query = new URLSearchParams(calls[0].options.body).get('data');
  assert.match(query, /\[timeout:15\]/);
  assert.match(query, /out body geom;$/, 'Overpass requires body/skel detail to return path geometry; tags-only omits it');
  assert.doesNotMatch(query, /private route name|tile\.openstreetmap|route.*coordinates/);
  assert.match(calls[0].options.headers['user-agent'], /Chuanheng/);
  assert.ok(calls[0].options.headers['user-agent'].includes('https://github.com/LiangRuoYi1223/website-of-ChuanHeng'));
  assert.equal(calls[0].options.headers.authorization, undefined);
  assert.equal(basemap.version, 1);
  assert.equal(basemap.projection, 'EPSG:3857');
  assert.equal(basemap.width, 1000); assert.equal(basemap.height, 600);
  assert.equal(basemap.generatedAt, '1970-01-01T00:00:00.000Z');
  const [west, south, east, north] = basemap.bounds;
  assert.ok(west < 114 && east > 114.01 && south < 22 && north > 22.01);
  const radians = Math.PI / 180;
  const mercatorY = latitude => Math.log(Math.tan(Math.PI / 4 + latitude * radians / 2));
  assert.ok(Math.abs((east - west) * radians / (mercatorY(north) - mercatorY(south)) - 1000 / 600) < 1e-8);
  assert.ok(query.includes(`(${south},${west},${north},${east})`), 'the provider query must cover exactly the saved image extent');
  const svg = decodeSvg(basemap);
  const document = new JSDOM(svg, { contentType: 'image/svg+xml' }).window.document;
  assert.equal(document.documentElement.getAttribute('viewBox'), '0 0 1000 600');
  assert.ok(document.querySelectorAll('path').length >= 3, 'real roads, water and forest must render');
  const road = document.querySelector('path[fill="none"]');
  const roadPixels = road.getAttribute('d').match(/-?\d+(?:\.\d+)?/g).map(Number);
  const expectedPixels = [[114, 22], [114.01, 22.01]].flatMap(([longitude, latitude]) => [(longitude - west) / (east - west) * 1000, (mercatorY(north) - mercatorY(latitude)) / (mercatorY(north) - mercatorY(south)) * 600]);
  roadPixels.forEach((value, index) => assert.ok(Math.abs(value - expectedPixels[index]) < .11, 'saved metadata must project the actual OSM coordinate to its drawn pixel'));
  assert.ok([...document.querySelectorAll('text')].some(text => text.textContent === '<script>alert(1)</script> & "村"'));
  assert.match(document.documentElement.textContent, /OpenStreetMap contributors/);
  assert.match(document.documentElement.textContent, /openstreetmap\.org\/copyright/);
  assert.equal(document.querySelectorAll('script, foreignObject, image, use, a, iframe').length, 0);
  assert.doesNotMatch(svg, /(?:onload|onclick|href)=|url\(/i);
  assert.ok(new TextEncoder().encode(svg).length <= 256 * 1024);
});

test('invalid, huge, polar or dateline route bounds fail before any remote request', async () => {
  const invalid = [
    null,
    { type: 'Point', coordinates: [114, 22] },
    { type: 'LineString', coordinates: [[114, 22], ['114.01', 22.01]] },
    { type: 'LineString', coordinates: [[114, 22], [116, 24]] },
    { type: 'LineString', coordinates: [[179.99, 22], [-179.99, 22.01]] },
    { type: 'LineString', coordinates: [[114, 89], [114.01, 89.01]] },
    { type: 'LineString', coordinates: Array.from({ length: 30001 }, () => [114, 22]) },
  ];
  for (const value of invalid) await assert.rejects(createRouteBasemap(value, { fetchImpl() { assert.fail('invalid extent must not reach the provider'); } }), error => /^BASEMAP_(?:INVALID_GEOMETRY|AREA_TOO_LARGE|OUTSIDE_COVERAGE)$/.test(error.code));
});

test('empty, unsupported or off-map data cannot become a fabricated basemap', async () => {
  for (const value of [{ elements: [] }, { remark: 'runtime error', elements }, { elements: [{ type: 'node', lon: 114, lat: 22, tags: { amenity: 'cafe' } }] }, { elements: [{ ...elements[0], geometry: [{ lon: 0, lat: 0 }, { lon: 1, lat: 1 }] }] }]) {
    await assert.rejects(createRouteBasemap(geojson, { fetchImpl: async () => response(value) }), error => /^BASEMAP_(?:NO_FEATURES|INVALID_RESPONSE)$/.test(error.code));
  }
});

test('remote failure, malformed replies and streaming byte limits fail without retry or leakage', async () => {
  for (const fetchImpl of [
    async () => { throw Error('private network secret'); },
    async () => new Response('rate limited', { status: 429 }),
    async () => new Response(null, { status: 302, headers: { location: 'https://attacker.invalid/' } }),
    async () => new Response('not JSON'),
    async () => new Response('x'.repeat(4 * 1024 * 1024 + 1)),
    async () => response({ elements: Array.from({ length: 6001 }, () => elements[0]) }),
  ]) {
    let calls = 0;
    await assert.rejects(createRouteBasemap(geojson, { fetchImpl: (...args) => { calls++; return fetchImpl(...args); } }), error => /^BASEMAP_/.test(error.code) && !/private network secret/.test(error.message));
    assert.equal(calls, 1);
  }
  let cancelled = false;
  await assert.rejects(createRouteBasemap(geojson, { fetchImpl: async () => new Response(new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(65536)); }, cancel() { cancelled = true; } })) }), { code: 'BASEMAP_DATA_TOO_LARGE' });
  assert.equal(cancelled, true);
});

test('fetch and response-body stalls have the same bounded deadline and caller cancellation stops the request', async () => {
  for (const fetchImpl of [async () => new Promise(() => {}), async () => new Response(new ReadableStream({ start() {} }))]) {
    let signal;
    await assert.rejects(createRouteBasemap(geojson, { timeoutMs: 10, fetchImpl: (...args) => { signal = args[1].signal; return fetchImpl(...args); } }), { code: 'BASEMAP_TIMEOUT' });
    assert.equal(signal.aborted, true);
  }
  const controller = new AbortController();
  const result = createRouteBasemap(geojson, { signal: controller.signal, fetchImpl: async () => new Promise(() => {}) });
  controller.abort();
  await assert.rejects(result, { code: 'BASEMAP_CANCELLED' });
});

test('coordinate and final image budgets are enforced independently of the remote byte budget', async () => {
  const denseWay = { ...elements[0], geometry: Array.from({ length: 60001 }, () => ({ lon: 114, lat: 22 })) };
  await assert.rejects(createRouteBasemap(geojson, { fetchImpl: async () => response({ elements: [denseWay] }) }), { code: 'BASEMAP_DATA_TOO_LARGE' });
  const manyRoads = Array.from({ length: 3000 }, (_, id) => ({ ...elements[0], id }));
  await assert.rejects(createRouteBasemap(geojson, { fetchImpl: async () => response({ elements: manyRoads }) }), { code: 'BASEMAP_IMAGE_TOO_LARGE' });
});
