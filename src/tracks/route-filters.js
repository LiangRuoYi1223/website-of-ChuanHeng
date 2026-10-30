export function matchesAscent(value, bucket) {
  if (!bucket) return true;
  if (value == null || value === '' || !['number','string'].includes(typeof value)) return false;
  const ascent = Number(value);
  if (!Number.isFinite(ascent) || ascent < 0) return false;
  return bucket === 'low' ? ascent < 800 : bucket === 'medium' ? ascent >= 800 && ascent <= 1500 : bucket === 'high' ? ascent > 1500 : false;
}
