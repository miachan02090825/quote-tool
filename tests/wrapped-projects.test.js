import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseQuotationPage } from '../src/utils/quotation.js';
import { DEFAULT_CATEGORIES } from '../src/utils/projects.js';

// PDF.js 3.11.174 items from the actual content table and notes title. The
// second title line shares a baseline with No., service, quantity and prices.
const referenceItems = JSON.parse(fs.readFileSync(new URL('./fixtures/quotation-wrapped-T261016004.json', import.meta.url)));
const parse = items => parseQuotationPage(items, DEFAULT_CATEGORIES).data;
const expectedTitle = '滿貫大亨_【太陽神諭】新機上線品檢測試';

test('actual PDF table preserves the second title line even without the repeated notes title', () => {
  const data = parse(referenceItems.filter(item => item.transform[5] > 460));
  assert.equal(data.orderId, '265243');
  assert.equal(data.projectName, expectedTitle);
  assert.equal(data.category, '滿貫大亨');
  assert.equal(data.functionalTestAmount, '20480');
  assert.equal(data.deviceAmount, '1600');
  assert.equal(data.managementFee, '2208');
  assert.equal(data.totalExclTax, '24288');
});

test('a repeated notes title completes a cut table title only for the same order and prefix', () => {
  const missingTableTail = referenceItems.filter(item => item.str !== '檢測試');
  assert.equal(parse(missingTableTail).projectName, expectedTitle);
  for (const replacement of ['654321:滿貫大亨_【太陽神諭】新機上線 品檢測試', '265243:滿貫大亨_不同專案品檢測試']) {
    const differentNotes = missingTableTail.map(item => item.transform[5] < 460 ? { ...item, str: replacement } : item);
    assert.equal(parse(differentNotes).projectName, '滿貫大亨_【太陽神諭】新機上線品');
  }
});

test('reported 256463 text survives the actual multi-column table layout', () => {
  // Reuse measured PDF coordinates with the user's supplied title; this is a
  // regression scenario, not an assertion that the original 256463 PDF exists.
  const items = referenceItems.filter(item => item.transform[5] > 460).map(item => ({
    ...item, str: item.str.replaceAll('265243', '256463').replaceAll('太陽神諭', '三隻小豬'),
  }));
  assert.equal(parse(items).orderId, '256463');
  assert.equal(parse(items).projectName, '滿貫大亨_【三隻小豬】新機上線品檢測試');
});

test('wrapped closing brackets remain in the title cell alongside quantity and fee cells', () => {
  const items = referenceItems.filter(item => item.transform[5] > 460).map(item => ({
    ...item,
    str: item.str === '檢測試' ? ')' : item.str.replace('滿貫大亨_【太陽神諭】新機上線 品', '滿貫大亨_260930營運活動(新增AUTO'),
  }));
  assert.equal(parse(items).projectName, '滿貫大亨_260930營運活動(新增AUTO)');
});
