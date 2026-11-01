import assert from 'node:assert/strict';
import test from 'node:test';
import { parseRegistrationFee, formatRegistrationFee, registrationFeeInputValue } from '../src/activities/registration-fee.js';

test('registration fee converts yuan into exact integer cents and retains unknown and free values', () => {
  for (const [input, expected] of [[undefined, null], [null, null], ['', null], ['  ', null], ['0', 0], ['0.00', 0], ['12', 1200], ['12.', 1200], ['.5', 50], ['12.3', 1230], ['12.30', 1230], [' 12.50 ', 1250], ['0.01', 1], ['0.29', 29], ['90071992547409.91', 9007199254740991]]) {
    assert.equal(parseRegistrationFee(input), expected, String(input));
  }
});

test('invalid or imprecise fees cannot be saved as a different amount', () => {
  for (const input of ['-1', '-0.01', '1.234', '1e2', 'NaN', 'Infinity', '1,000', '.', '12元', '90071992547409.92']) {
    assert.throws(() => parseRegistrationFee(input), /报名费用/, input);
  }
});

test('fee presentation and editor values preserve cents without float rounding', () => {
  for (const [cents, label, input] of [[undefined, '未公布', ''], [null, '未公布', ''], [0, '免费', '0.00'], [1, '¥0.01', '0.01'], [29, '¥0.29', '0.29'], [1250, '¥12.50', '12.50'], [9007199254740991, '¥90071992547409.91', '90071992547409.91']]) {
    assert.equal(formatRegistrationFee(cents), label);
    assert.equal(registrationFeeInputValue(cents), input);
  }
});

test('malformed stored fees are unknown rather than becoming a false charge', () => {
  for (const cents of [-1, 1.5, NaN, Infinity, '1250', {}, 9007199254740992]) {
    assert.equal(formatRegistrationFee(cents), '未公布');
    assert.equal(registrationFeeInputValue(cents), '');
  }
});
