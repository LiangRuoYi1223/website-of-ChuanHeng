import geography from './geography.json' with { type: 'json' };
import { effectiveActivityStatus } from '../activities/schedule.js';

// Basemap geography and association activity records are independent.
// Never promote design samples or unverified locations into association history.
export function getFootprints(activities = [], {allowLocalPreview = false, now = Date.now()} = {}) {
  if (!Array.isArray(activities)) return [];
  return activities.flatMap(item => {
    if (!item || item.isDemo !== false || item.organizer !== 'chuanheng' || item.footprintEligible === false) return [];
    const status = item.dateEnd ? effectiveActivityStatus(item, now) : item.status;
    if (status && status !== '已结束') return [];
    const local = allowLocalPreview && item.localDraft === true && item.includeFootprint === true && status === '已结束' && Boolean(item.routeSnapshot?.track || item.routeSnapshot?.trackLocalId || item.track || item.trackLocalId);
    if (item.published !== true && !local) return [];
    if (typeof item.id !== 'string' || !item.id.trim() || typeof item.title !== 'string' || !item.title.trim()) return [];
    const point = item.coordinates;
    if (!Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite)) return [];
    const [longitude, latitude] = point;
    if (longitude < 73 || longitude > 135 || latitude < 3 || latitude > 54) return [];
    const date = item.dateStart || item.date;
    if (typeof date !== 'string' || !date.trim()) return [];
    const timestamp = Date.parse(date);
    if (!Number.isFinite(timestamp)) return [];
    return [{ ...item, year: new Date(timestamp + 8 * 3600 * 1000).getUTCFullYear() }];
  });
}

export function filterFootprints(records, { year = 'all', type = 'all' } = {}) {
  return records.filter(item => (year === 'all' || String(item.year) === String(year)) && (type === 'all' || item.type === type));
}

const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
export function clampView({ zoom = 1, panX = 0, panY = 0 } = {}) {
  zoom = Math.min(4, Math.max(1, finite(zoom, 1)));
  if (zoom === 1) return { zoom: 1, panX: 0, panY: 0 };
  const limitX = (zoom - 1) * 500;
  const limitY = (zoom - 1) * 320;
  return { zoom, panX: Math.min(limitX, Math.max(-limitX, finite(panX))), panY: Math.min(limitY, Math.max(-limitY, finite(panY))) };
}

export function projectCoordinate([longitude, latitude]) {
  const projection = geography.projection;
  const rad = Math.PI / 180;
  const [first, second] = projection.standardParallels;
  const n = (Math.sin(first * rad) + Math.sin(second * rad)) / 2;
  const c = Math.cos(first * rad) ** 2 + 2 * n * Math.sin(first * rad);
  const origin = Math.sqrt(c - 2 * n * Math.sin(projection.latitudeOfOrigin * rad)) / n;
  const rho = Math.sqrt(c - 2 * n * Math.sin(latitude * rad)) / n;
  const theta = n * (longitude - projection.centralMeridian) * rad;
  const { left, top, minX, maxY, scale } = projection.fit;
  // Center the source's 920×650 canvas inside our 1000×640 interaction canvas.
  return [40 + left + (rho * Math.sin(theta) - minX) * scale, -5 + top + (maxY - (origin - rho * Math.cos(theta))) * scale];
}
