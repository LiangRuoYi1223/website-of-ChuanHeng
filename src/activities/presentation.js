const metric = (value, digits, unit, unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? `${Number(value.toFixed(digits))} ${unit}` : unknown;
export const formatActivityDistance = value => metric(value, 2, 'km', '暂不提供数据');
export const formatActivityAscent = value => metric(value, 1, 'm', '暂不提供数据');

export function resolveActivityView(activity) {
  const view = { ...activity };
  const snapshot = activity?.routeSnapshot;
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return view;
  for (const key of ['track', 'trackLocalId', 'trackSummary', 'distance', 'ascent', 'coordinates', 'location', 'province', 'city', 'provinceCode', 'cityCode', 'locations', 'locationStatus']) {
    delete view[key];
    if (Object.hasOwn(snapshot, key)) view[key] = snapshot[key];
  }
  return view;
}
