import type { Activity } from '../types';
import { findCity } from './map-data/cities';

export function activityRoute(activity: Activity): string {
  return activity.routeName ?? activity.location ?? '';
}

export function activityCity(activity: Activity): string {
  const city = findCity(activity.cityCode);
  return city ? (city.provinceName === city.name ? city.name : `${city.provinceName} · ${city.name}`) : '';
}
