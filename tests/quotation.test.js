import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseQuotationPage, parseQuotationAmounts, normalizeQuotationAmounts, updateQuotationField } from '../src/utils/quotation.js';

const referenceItems = JSON.parse(fs.readFileSync(new URL('./fixtures/quotation-T260904001.json', import.meta.url)));
const expected = {
  functionalTestAmount: '2560', personnelAmount: '2700', deviceAmount: '200', managementFee: '276', totalExclTax: '5736',
};

test('real PDF.js text and coordinates: hourly and personnel charges remain separate', () => {
  const result = parseQuotationPage(referenceItems);
  assert.deepEqual(result.data, { orderId: '', projectName: '滿貫', category: '其他', ...expected });
  assert.equal(result.hasWarning, true, 'xxxxxx must not become an invented order ID');
});

test('missing printed total still includes personnel fees', () => {
  const items = referenceItems.filter(item => !item.str.includes('合計未稅'));
  assert.equal(parseQuotationPage(items).data.totalExclTax, '5736');
});

test('old quotations without personnel charges retain their total', () => {
  assert.deepEqual(parseQuotationAmounts(['功能測試 2,560', '測試器材 200', '10%管理費 276']), {
    ...expected, personnelAmount: '0', totalExclTax: '3036',
  });
});

test('multiple personnel rows add up and use line amounts rather than decimal unit prices', () => {
  const result = parseQuotationAmounts(['功能測試 計時制 8 時 320 2,560', '功能測試 包人制 8 時 337.5 2,700', '包 人 制 4 時 337.5 1,350']);
  assert.equal(result.functionalTestAmount, '2560');
  assert.equal(result.personnelAmount, '4050');
  assert.equal(result.totalExclTax, '6610');
});

test('wrapped personnel label counts its amount exactly once', () => {
  for (const lines of [
    ['4 測試 滿貫 8 時 337.5 2,700', '功能測試', '包人制'],
    ['功能測試 8 時 337.5 2,700', '包人制'],
    ['功能測試', '包人制', '8 時 337.5 2,700'],
  ]) {
    const result = parseQuotationAmounts(lines);
    assert.equal(result.personnelAmount, '2700');
    assert.equal(result.functionalTestAmount, '0');
    assert.equal(result.totalExclTax, '2700');
  }
});

test('untaxed total takes precedence over tax and tax-inclusive totals', () => {
  const result = parseQuotationAmounts(['功能測試 包人制 2,700', '營業稅 135', '合計金額 2,835', '合計未稅金額 2,700']);
  assert.equal(result.totalExclTax, '2700');
});

test('missing personnel amount does not borrow another fee, tax or date', () => {
  const result = parseQuotationAmounts(['管理費 276', '包人制', '營業稅 287', '作業期間 9/4']);
  assert.equal(result.personnelAmount, '0');
  assert.equal(result.totalExclTax, '276');
});

test('personnel-only quotation works with ungrouped amounts and printed order ID', () => {
  const result = parseQuotationAmounts(['123456:滿貫', '功能測試 包人制 2700'], '123456');
  assert.equal(result.totalExclTax, '2700');
  assert.equal(result.personnelAmount, '2700');
});

test('editing any component retains personnel fees in the amount used for comparison', () => {
  assert.equal(updateQuotationField(expected, 'personnelAmount', '3,000').totalExclTax, '6036');
  assert.equal(updateQuotationField(expected, 'deviceAmount', '300').totalExclTax, '5836');
  assert.equal(updateQuotationField(expected, 'managementFee', '0').totalExclTax, '5460');
  assert.equal(updateQuotationField(expected, 'functionalTestAmount', '0').totalExclTax, '3176');
  assert.equal(updateQuotationField(expected, 'totalExclTax', '6000').totalExclTax, '6000');
});

test('AI results normalize missing new fields, grouped amounts and total fallback', () => {
  assert.equal(normalizeQuotationAmounts({ functionalTestAmount: '2,560', personnelAmount: '2,700', deviceAmount: 200, managementFee: 276 }).totalExclTax, '5736');
  assert.equal(normalizeQuotationAmounts({ functionalTestAmount: 2560 }).personnelAmount, '0');
});

test('a project name mentioning functional testing is not an additional charge', () => {
  const result = parseQuotationAmounts(['123456:滿貫功能測試', '功能測試 計時制 2,560', '功能測試 包人制 2,700'], '123456');
  assert.equal(result.functionalTestAmount, '2560');
  assert.equal(result.personnelAmount, '2700');
});
