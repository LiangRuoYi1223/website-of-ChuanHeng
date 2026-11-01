export function parseRegistrationFee(value) {
  const text = value == null ? '' : String(value).trim();
  if (!text) return null;
  if (!/^(?:\d+(?:\.\d{0,2})?|\.\d{1,2})$/.test(text)) throw new Error('报名费用须为有效的非负金额，最多两位小数。');
  const [yuan, fraction = ''] = text.split('.');
  const cents = BigInt(yuan || '0') * 100n + BigInt(fraction.padEnd(2, '0'));
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('报名费用超出可保存范围。');
  return Number(cents);
}

export function registrationFeeInputValue(cents) {
  if (!Number.isSafeInteger(cents) || cents < 0) return '';
  const exact = BigInt(cents);
  return `${exact / 100n}.${String(exact % 100n).padStart(2, '0')}`;
}

export function formatRegistrationFee(cents) {
  const amount = registrationFeeInputValue(cents);
  return !amount ? '未公布' : cents === 0 ? '免费' : `¥${amount}`;
}
