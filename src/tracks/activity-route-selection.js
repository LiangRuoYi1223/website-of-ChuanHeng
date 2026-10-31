import { resolvedTrackMetrics, validateManualTrackMetrics } from './metrics.js';
const own = (value, key) => Object.hasOwn(value || {}, key);
const fail = (code, message) => { const error = new Error(message); error.code = code; throw error; };
const trackFields = ['track', 'trackLocalId', 'trackSummary'];
const locationFields = ['coordinates', 'location', 'province', 'city', 'provinceCode', 'cityCode', 'locations', 'locationStatus'];
const derivedFields = ['distance', 'ascent', ...locationFields];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const coordinate = point => Array.isArray(point) && point.length >= 2 && Number.isFinite(point[0]) && Number.isFinite(point[1]) && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90;
// JSON payloads compare by content, independent of object key insertion order.
const canonical = value => Array.isArray(value) ? value.map(canonical) : object(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const equal = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));

function trackInformation(payload) {
  const inline = object(payload.track) ? payload.track : null;
  const localId = typeof payload.trackLocalId === 'string' && payload.trackLocalId.trim() ? payload.trackLocalId : null;
  const summary = inline || (localId && object(payload.trackSummary) ? payload.trackSummary : null);
  validateManualTrackMetrics(summary);
  const stats = resolvedTrackMetrics(summary);
  const raw = summary?.stats || summary;
  if (!summary || ['distanceM','ascentM'].some(key=>raw?.[key]!=null&&(!Number.isFinite(raw[key])||raw[key]<0))) fail('INVALID_TRACK', '路线轨迹或统计未就绪，请先在路线管理中检查。');
  let first;
  if (inline) {
    const geometry = inline.geojson?.geometry;
    const segments = geometry?.type === 'LineString' ? [geometry.coordinates] : geometry?.type === 'MultiLineString' ? geometry.coordinates : null;
    if (!Array.isArray(segments) || !segments.length || !segments.every(segment => Array.isArray(segment) && segment.length >= 2 && segment.every(coordinate))) fail('INVALID_TRACK', '路线缺少可用的真实轨迹，请先在路线管理中检查。');
    first = segments[0][0];
  }
  const point = [payload.coordinates, summary.coordinates, summary.location?.coordinates, first].find(coordinate);
  return { inline, localId, distance: stats.distanceM===null?null:stats.distanceM / 1000, ascent: stats.ascentM, coordinates: point ? point.slice(0, 2) : null };
}

function snapshotOf(route, now) {
  if (route.payload?.archived === true) fail('ROUTE_ARCHIVED', '所选路线已归档，请刷新路线列表。');
  if (route.payload?.isDemo === true) fail('DEMO_ROUTE', '示例路线不能作为真实活动记录。');
  const information = trackInformation(route.payload || {});
  const snapshot = { sourceRouteId: route.id, selectedAt: new Date(now).toISOString(), title: route.payload.title };
  for (const key of locationFields) if (own(route.payload, key)) snapshot[key] = structuredClone(route.payload[key]);
  if (information.inline) snapshot.track = structuredClone(information.inline);
  else {
    snapshot.trackLocalId = information.localId;
    snapshot.trackSummary = structuredClone(route.payload.trackSummary);
  }
  snapshot.distance = information.distance;
  snapshot.ascent = information.ascent;
  if (information.coordinates) snapshot.coordinates = information.coordinates;
  else delete snapshot.coordinates;
  return snapshot;
}

// A selected snapshot overwrote top-level metadata. When it is cleared, those
// fields cannot describe the retained legacy geometry; derive only from its
// immutable track/summary, never from the activity's now-stale top-level values.
function restoreLegacyDerived(payload, old) {
  for (const key of derivedFields) delete payload[key];
  const source = Object.fromEntries(trackFields.filter(key => own(old, key)).map(key => [key, old[key]]));
  let information;
  try { information = trackInformation(source); } catch { return false; }
  payload.distance = information.distance;
  payload.ascent = information.ascent;
  if (information.coordinates) payload.coordinates = information.coordinates;
  const location = object(source.track?.location) ? source.track.location : object(source.trackSummary?.location) ? source.trackSummary.location : {};
  for (const key of ['province', 'city', 'provinceCode', 'cityCode', 'locationStatus']) {
    if (typeof location[key] === 'string' && location[key].trim()) payload[key] = location[key];
  }
  if (Array.isArray(location.locations)) payload.locations = structuredClone(location.locations);
  const label = [...new Set([payload.province, payload.city].filter(Boolean))].join(' ');
  if (label) payload.location = label;
  return true;
}
/** Pure local transaction: selecting a route never creates or rewrites any route row. */
export function applyActivityRoute(rows, activityRecord, { now = Date.now() } = {}) {
  if (!Array.isArray(rows) || rows.some(row => !row || typeof row.id !== 'string' || !row.id) || new Set(rows.map(row => row.id)).size !== rows.length) fail('INVALID_ROWS', '内容列表无效，请重新读取后重试。');
  if (!activityRecord || activityRecord.kind !== 'activity' || typeof activityRecord.id !== 'string' || !activityRecord.id || !object(activityRecord.payload) || typeof activityRecord.payload.title !== 'string' || !activityRecord.payload.title.trim()) fail('INVALID_ACTIVITY', '请提供完整的活动记录与标题。');
  if (!Number.isFinite(new Date(now).getTime())) fail('INVALID_AUDIT', '保存时间无效。');
  const previous = rows.find(row => row.id === activityRecord.id);
  if (previous && previous.kind !== 'activity') fail('ID_CONFLICT', '活动标识已被其他内容使用，不能覆盖。');
  const activity = structuredClone(activityRecord);
  const payload = activity.payload;
  const old = previous?.payload || {};
  // Own tracks are immutable legacy data. New tracks enter through route snapshots only.
  for (const key of trackFields) {
    if (own(payload, key) && payload[key] !== undefined && (!own(old, key) || !equal(payload[key], old[key]))) fail('ACTIVITY_TRACK_READ_ONLY', '活动原有轨迹只读，请在路线管理上传后选择路线。');
    if (own(old, key)) payload[key] = structuredClone(old[key]);
    else delete payload[key];
  }
  const routeId = own(payload, 'routeId') ? payload.routeId : old.routeId;
  if (routeId != null && typeof routeId !== 'string') fail('INVALID_ACTIVITY', '路线标识无效。');
  const sameRoute = Boolean(routeId) && routeId === old.routeId;
  const legacy = sameRoute && !old.routeSnapshot && trackFields.some(key => old[key] != null);
  const route = routeId ? rows.find(row => row.kind === 'route' && row.id === routeId) : null;
  if (routeId && !route) fail('ROUTE_NOT_FOUND', '所选路线已不存在，请刷新路线列表。');
  if (route?.payload?.archived === true) fail('ROUTE_ARCHIVED', '所选路线已归档，请刷新路线列表。');
  let snapshot;
  if (sameRoute && old.routeSnapshot) snapshot = structuredClone(old.routeSnapshot);
  else if (routeId && !legacy) {
    if (own(activityRecord, 'routeExpectedPayload') && !equal(activityRecord.routeExpectedPayload, route.payload)) fail('STALE_ROUTE', '所选路线已被更新，请刷新并重新选择。');
    snapshot = snapshotOf(route, now);
  }
  delete activity.routeExpectedPayload;
  delete activity.expected;
  delete payload.routeSnapshot;
  if (routeId) payload.routeId = routeId;
  else { delete payload.routeId; delete payload.routeLinkSource; }
  let usable = false;
  if (snapshot) {
    payload.routeSnapshot = snapshot;
    for (const key of derivedFields) {
      if (own(snapshot, key)) payload[key] = structuredClone(snapshot[key]);
      else delete payload[key];
    }
    payload.routeLinkSource = 'route-selection';
    usable = true;
  } else if (!routeId && (old.routeId || old.routeSnapshot)) {
    usable = restoreLegacyDerived(payload, old);
  } else if (legacy || (!routeId && !old.routeId && !old.routeSnapshot && trackFields.some(key => old[key] != null))) {
    try { const information = trackInformation(old); usable = Boolean(information); } catch { /* Keep opaque legacy data unchanged; it cannot establish a new footprint. */ }
  } else {
    for (const key of derivedFields) delete payload[key];
  }
  payload.isDemo = false;
  if (usable) payload.organizer = 'chuanheng';
  payload.footprintEligible = usable && payload.archived !== true;
  payload.includeFootprint = payload.footprintEligible && typeof payload.dateStart === 'string' && Number.isFinite(Date.parse(payload.dateStart));
  const next = structuredClone(rows);
  const index = next.findIndex(row => row.id === activity.id);
  if (index < 0) next.push(activity); else next[index] = activity;
  return next;
}
