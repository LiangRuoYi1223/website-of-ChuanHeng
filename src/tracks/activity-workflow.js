const copiedFields = ['description', 'image', 'difficulty', 'location', 'coordinates', 'province', 'city', 'provinceCode', 'cityCode', 'locations', 'locationStatus'];
const derivedLocationFields = ['coordinates', 'province', 'city', 'provinceCode', 'cityCode', 'locations', 'locationStatus'];
const own = (object, key) => Object.hasOwn(object || {}, key);
const fail = (code, message) => { const error = new Error(message); error.code = code; throw error; };
const isResolvedWinner = row => Array.isArray(row?.payload?.duplicateResolutions) && row.payload.duplicateResolutions.length > 0;

export function normalizeRouteTitle(title) {
  return typeof title === 'string' ? title.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLowerCase() : '';
}

function checkRows(rows) {
  if (!Array.isArray(rows)) fail('INVALID_ROWS', '内容列表无效，请重新读取后重试。');
  const ids = new Set();
  for (const row of rows) {
    if (!row || typeof row.id !== 'string' || !row.id || ids.has(row.id)) fail('INVALID_ROWS', '内容标识缺失或重复，请重新读取后重试。');
    ids.add(row.id);
  }
}

const validCoordinate = point => Array.isArray(point) && point.length >= 2 && Number.isFinite(point[0]) && Number.isFinite(point[1]) && Math.abs(point[0]) <= 180 && Math.abs(point[1]) <= 90;
function trackInformation(payload) {
  if (payload.track != null && (typeof payload.track !== 'object' || Array.isArray(payload.track))) fail('INVALID_TRACK', '轨迹数据无效，请重新读取后保存。');
  if (payload.trackLocalId != null && (typeof payload.trackLocalId !== 'string' || !payload.trackLocalId.trim())) fail('INVALID_TRACK', '本地轨迹标识无效，请重新读取后保存。');
  const inline = payload.track && typeof payload.track === 'object' ? payload.track : null;
  const localId = typeof payload.trackLocalId === 'string' && payload.trackLocalId.trim() ? payload.trackLocalId : null;
  if (!inline && !localId) return null;
  const summary = inline || payload.trackSummary;
  const stats = summary?.stats || summary;
  if (!Number.isFinite(stats?.distanceM) || stats.distanceM < 0 || (stats.ascentM != null && (!Number.isFinite(stats.ascentM) || stats.ascentM < 0))) fail('INVALID_TRACK', '轨迹摘要未就绪或统计无效，请重新读取轨迹后保存。');
  const geometry = inline?.geojson?.geometry;
  const first = geometry?.type === 'MultiLineString' ? geometry.coordinates?.find(segment => Array.isArray(segment) && segment.length)?.[0] : geometry?.type === 'LineString' ? geometry.coordinates?.[0] : null;
  const candidates = [payload.coordinates, summary?.coordinates, summary?.location?.coordinates, first];
  const point = candidates.find(validCoordinate);
  return { inline, localId, distance: stats.distanceM / 1000, ascent: stats.ascentM ?? null, coordinates: point ? point.slice(0, 2) : null };
}

function currentWinner(rows, archived) {
  const visited = new Set([archived.id]);
  let candidate = archived;
  while (candidate.payload?.archived === true && candidate.payload.archivedReason === 'duplicate') {
    const id = candidate.payload.duplicateWinnerId;
    if (typeof id !== 'string' || visited.has(id)) fail('ARCHIVED_ROUTE_UNAVAILABLE', '去重保留的路线已失效或关联成环，请先检查归档记录。');
    visited.add(id);
    candidate = rows.find(row => row.id === id && row.kind === 'route');
    if (!candidate) fail('ARCHIVED_ROUTE_UNAVAILABLE', '去重保留的路线不存在，请先检查归档记录。');
  }
  if (candidate.payload?.archived === true) fail('ARCHIVED_ROUTE_UNAVAILABLE', '去重保留的路线已归档，请先检查关联。');
  return candidate;
}

/** Pure, browser-storage-independent activity/route transaction for local rows.
 * Complete records are required. Persistence and IndexedDB writes belong to the caller.
 */
export function applyActivityTrack(rows, activityRecord) {
  checkRows(rows);
  if (!activityRecord || activityRecord.kind !== 'activity' || typeof activityRecord.id !== 'string' || !activityRecord.id || !activityRecord.payload || typeof activityRecord.payload !== 'object' || Array.isArray(activityRecord.payload)) fail('INVALID_ACTIVITY', '请提供完整的活动记录。');
  const previous = rows.find(row => row.id === activityRecord.id);
  if (previous && previous.kind !== 'activity') fail('ID_CONFLICT', '活动标识已被其他内容使用，不能覆盖。');
  const generated = rows.filter(row => row.kind === 'route' && row.payload?.generatedFromActivityId === activityRecord.id);
  if (generated.length > 1) fail('AMBIGUOUS_GENERATED_ROUTE', '该活动存在多条自动路线，请先检查数据关联。');
  const next = structuredClone(rows);
  const activity = structuredClone(activityRecord);
  const payload = activity.payload;
  if (typeof payload.title !== 'string' || !payload.title.trim() || (payload.routeName != null && typeof payload.routeName !== 'string')) fail('INVALID_ACTIVITY', '活动标题或路线名称无效，请核对后保存。');
  payload.isDemo = false;
  const information = trackInformation(payload);
  const oldRoute = generated[0] && next.find(row => row.id === generated[0].id);

  if (!information) {
    delete payload.track; delete payload.trackLocalId; delete payload.trackSummary;
    for (const key of derivedLocationFields) delete payload[key];
    payload.includeFootprint = false;
    payload.footprintEligible = false;
    if (oldRoute || payload.routeLinkSource === 'activity-track' || previous?.payload?.routeLinkSource === 'activity-track') {
      delete payload.routeId; delete payload.routeLinkSource;
    }
    const usedElsewhere = oldRoute && next.some(row => row.kind === 'activity' && row.id !== activity.id && row.payload?.routeId === oldRoute.id);
    if (oldRoute && oldRoute.payload.archived !== true && !usedElsewhere && !isResolvedWinner(oldRoute)) {
      oldRoute.payload.archived = true;
      oldRoute.payload.archivedReason = 'activity-track-removed';
      oldRoute.payload.archivedAt = activity.updated_at || activity.created_at || null;
      oldRoute.published = false;
    }
  } else {
    payload.distance = information.distance;
    payload.ascent = information.ascent;
    payload.footprintEligible = payload.archived !== true;
    if (information.coordinates) payload.coordinates = information.coordinates;
    else delete payload.coordinates;
    if (information.inline) delete payload.trackLocalId;
    else delete payload.track;
    let linked;
    if (oldRoute?.payload.archived === true && oldRoute.payload.archivedReason === 'duplicate') {
      // Deduplication is a persistent administrative choice, not an invitation
      // to recreate the loser or overwrite the winning route on the next save.
      linked = currentWinner(next, oldRoute);
    } else if (oldRoute && oldRoute.payload.archived !== true && isResolvedWinner(oldRoute)) {
      // The original owner is also just one participant after administrative
      // deduplication. Its future edits must not replace the chosen shared route.
      linked = oldRoute;
    } else {
      if (oldRoute?.payload.archived === true && oldRoute.payload.archivedReason !== 'activity-track-removed') fail('GENERATED_ROUTE_ARCHIVED', '自动路线已归档，请先确认是否恢复。');
      const id = oldRoute?.id || `activity-route:${activity.id}`;
      if (!oldRoute && next.some(row => row.id === id)) fail('ID_CONFLICT', '自动路线标识已存在，不能覆盖其他记录。');
      linked = oldRoute || { id, kind: 'route', created_at: activity.created_at || null, payload: {} };
      const routePayload = linked.payload;
      for (const key of [...copiedFields, 'track', 'trackLocalId', 'trackSummary']) {
        if (own(payload, key)) routePayload[key] = structuredClone(payload[key]);
        else delete routePayload[key];
      }
      for (const key of ['archived', 'archivedReason', 'archivedAt', 'archivedBy']) delete routePayload[key];
      const title = [payload.routeName, payload.track?.name, payload.trackSummary?.name, payload.title]
        .find(value => typeof value === 'string' && value.trim())?.trim();
      Object.assign(routePayload, { title, generatedFromActivityId: activity.id, source: '活动关联路线', isDemo: false, verified: false, distance: information.distance, ascent: information.ascent });
      linked.published = activity.published === true && payload.archived !== true;
      if (!oldRoute) next.push(linked);
    }
    payload.routeId = linked.id;
    payload.routeLinkSource = 'activity-track';
  }
  const index = next.findIndex(row => row.id === activity.id);
  if (index >= 0) next[index] = activity;
  else next.push(activity);
  return next;
}

export function findDuplicateRoutes(rows) {
  checkRows(rows);
  const groups = new Map();
  for (const row of rows) {
    if (row.kind !== 'route' || row.payload?.archived === true) continue;
    const key = normalizeRouteTitle(row.payload?.title);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, { key, title: row.payload.title.normalize('NFKC').trim().replace(/\s+/gu, ' '), routes: [] });
    groups.get(key).routes.push(structuredClone(row));
  }
  return [...groups.values()].filter(group => group.routes.length >= 2).sort((a, b) => a.key.localeCompare(b.key));
}

export function resolveDuplicateRoutes(rows, ids, winnerId, { actorId = 'local-admin', now = new Date().toISOString() } = {}) {
  checkRows(rows);
  if (!Array.isArray(ids) || ids.length < 2 || ids.some(id => typeof id !== 'string' || !id) || new Set(ids).size !== ids.length || !ids.includes(winnerId)) fail('INVALID_DUPLICATE_SELECTION', '请为至少两条同名路线选择一条保留记录。');
  const sortedIds = [...ids].sort();
  const group = findDuplicateRoutes(rows).find(item => item.routes.some(route => route.id === winnerId));
  if (!group || JSON.stringify(group.routes.map(route => route.id).sort()) !== JSON.stringify(sortedIds)) fail('STALE_DUPLICATE_GROUP', '同名路线组已变化，请重新检查后再选择。');
  const timestamp = new Date(now);
  if (!Number.isFinite(timestamp.getTime()) || typeof actorId !== 'string' || !actorId.trim()) fail('INVALID_AUDIT', '操作时间或管理员标识无效。');
  const at = timestamp.toISOString();
  const result = structuredClone(rows);
  const winner = result.find(row => row.id === winnerId);
  if (winner.payload.duplicateResolutions !== undefined && !Array.isArray(winner.payload.duplicateResolutions)) fail('INVALID_AUDIT', '已有去重记录格式异常，请先检查。');
  winner.payload.duplicateResolutions = [...(winner.payload.duplicateResolutions || []), { originalIds: sortedIds, winnerId, actorId, at }];
  const losers = new Set(ids.filter(id => id !== winnerId));
  for (const record of result) {
    if (losers.has(record.id)) {
      record.published = false;
      Object.assign(record.payload, { archived: true, archivedReason: 'duplicate', archivedAt: at, archivedBy: actorId, duplicateWinnerId: winnerId });
    }
    if (record.kind === 'activity' && losers.has(record.payload?.routeId)) record.payload.routeId = winnerId;
  }
  return result;
}

export function deleteContentWithLinks(rows, id) {
  checkRows(rows);
  const record = rows.find(row => row.id === id);
  if (!record) fail('CONTENT_NOT_FOUND', '该内容已经不存在，请刷新列表。');
  if (record.kind === 'route') {
    const ownerId = record.payload?.generatedFromActivityId;
    const referenced = rows.some(row => row.kind === 'activity' && (row.payload?.routeId === id || row.id === ownerId))
      || rows.some(row => row.id !== id && row.payload?.duplicateWinnerId === id);
    if (referenced) fail('CONTENT_IN_USE', '这条路线仍被活动或去重记录引用，不能直接删除。请先处理关联并保留原始记录。');
  }
  let next = rows;
  if (record.kind === 'activity') {
    const withoutTrack = structuredClone(record);
    delete withoutTrack.payload.track;
    delete withoutTrack.payload.trackLocalId;
    delete withoutTrack.payload.trackSummary;
    next = applyActivityTrack(rows, withoutTrack);
  }
  return structuredClone(next.filter(row => row.id !== id));
}
