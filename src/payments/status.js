export const PAYMENT_STATUSES = Object.freeze(['unpaid', 'pending', 'paid']);
const labels = Object.freeze({ unpaid: '未缴费', pending: '应已缴费', paid: '已缴费' });
export const paymentLabel = value => typeof value === 'string' && Object.hasOwn(labels, value) ? labels[value] : '未知';
