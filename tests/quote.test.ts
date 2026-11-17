import assert from 'node:assert/strict';
import test from 'node:test';
import { parseMoney, quoteTotals } from '../shared/quote.ts';

test('人民币金额按分解析和计算，不产生浮点尾差', () => {
  assert.equal(parseMoney('19.90'), 1990);
  assert.equal(parseMoney(' 0.1 '), 10);
  assert.equal(parseMoney('10'), 1000);
  assert.deepEqual(quoteTotals([{ quantity: 2, unitPriceCents: parseMoney('19.90') }], parseMoney('10')), {
    subtotalCents: 3980, totalCents: 4980,
  });
  assert.equal(quoteTotals([{ quantity: 3, unitPriceCents: parseMoney('0.10') }], 20).totalCents, 50);
});

test('金额输入拒绝负数、科学计数法、空值和超过两位的小数', () => {
  for (const value of ['-1', '1.001', '1e3', '', ' ', 'NaN', '1,000', '.5']) {
    assert.throws(() => parseMoney(value), /金额/);
  }
});
