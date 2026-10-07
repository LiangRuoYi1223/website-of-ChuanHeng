import type { Activity } from '../types.ts';
import { findCity } from './map-data/cities.ts';

export interface FootprintPoint {
  id: string;
  city: string;
  region: string;
  provinceCode: string;
  longitude: number;
  latitude: number;
  status: 'upcoming' | 'past';
  upcomingCount: number;
  completedCount: number;
  demoOnly: boolean;
  activities: Activity[];
}

/** A marker always comes from published activities, never a standalone location example. */
export function aggregateFootprints(activities: readonly Activity[]): FootprintPoint[] {
  const groups = new Map<string, FootprintPoint>();
  for (const activity of activities) {
    if (activity.status !== 'published') continue;
    const city = findCity(activity.cityCode ?? '');
    if (!city) continue;
    let point = groups.get(city.code);
    if (!point) {
      point = {
        id: city.code, city: city.name, region: city.provinceName === city.name ? city.name : `${city.provinceName} · ${city.name}`,
        provinceCode: city.provinceCode, longitude: city.longitude, latitude: city.latitude,
        status: 'past', upcomingCount: 0, completedCount: 0, demoOnly: true, activities: [],
      };
      groups.set(city.code, point);
    }
    point.activities.push(activity);
    if (activity.kind === 'upcoming') {
      point.upcomingCount += 1;
      point.status = 'upcoming';
    } else {
      point.completedCount += 1;
    }
    point.demoOnly = point.demoOnly && activity.isDemo;
  }
  return [...groups.values()].sort((a, b) => a.id.localeCompare(b.id)).map(point => ({
    ...point,
    activities: [...point.activities].sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'upcoming' ? -1 : 1;
      return a.kind === 'upcoming' ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date);
    }),
  }));
}

/** A removed or unpublished selected city falls back to the first remaining city. */
export function selectFootprint(points: readonly FootprintPoint[], selectedId: string): FootprintPoint | undefined {
  return points.find(point => point.id === selectedId) ?? points[0];
}
