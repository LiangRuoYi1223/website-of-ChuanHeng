export function parseRegistrationCapacity(value, { required = false } = {}) {
  const text = value == null ? '' : String(value).trim();
  if (!text) {
    if (required) throw new Error('请填写活动预设报名人数。');
    return null;
  }
  const capacity = Number(text);
  if (!/^[1-9]\d*$/.test(text) || !Number.isSafeInteger(capacity) || capacity > 100000) throw new Error('报名人数须为 1 至 100000 的整数。');
  return capacity;
}
