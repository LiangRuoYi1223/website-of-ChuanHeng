export const ACTIVITY_TYPES = Object.freeze(['单日徒步', '重装徒步', '讲座活动', '攀冰']);

export function activityTypeOptions(values = []) {
  return [...new Set([...ACTIVITY_TYPES, ...values.filter(value => typeof value === 'string' && value.trim())])];
}
