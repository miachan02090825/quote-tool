import test from 'node:test';
import assert from 'node:assert/strict';
import { stripProjectPrefix, DEFAULT_DEPT_MAP } from '../src/utils/projects.js';
import { buildAcceptanceSummary } from '../src/utils/acceptance.js';

test('display prefixes are removed without changing game numbers or subproject tags', () => {
  for (const [name, category, expected] of [
    ['【競技麻將2】新虎機-迦羅戰神500測試', '競技麻將2', '新虎機-迦羅戰神500測試'],
    ['【競技麻將】新遊戲-競技大老二測試', '競技麻將2', '新遊戲-競技大老二測試'],
    ['滿貫大亨_【三隻小豬】新機上線品檢測試', '滿貫大亨', '【三隻小豬】新機上線品檢測試'],
    ['《大滿貫》幸運草金幣4X4遊戲測試', '大滿貫', '幸運草金幣4X4遊戲測試'],
    ['滿貫大亨_20261014 GASH 點卡活動', '滿貫大亨', '20261014 GASH 點卡活動'],
    ['[自訂(2)+]版本2.0', '自訂(2)+', '版本2.0'],
  ]) assert.equal(stripProjectPrefix(name, category), expected);
});

test('unrelated tags, longer category names, and names consisting only of a label stay intact', () => {
  for (const [name, category] of [
    ['【三隻小豬】新機上線品檢測試', '滿貫大亨'],
    ['活動【競技麻將2】第3階段', '競技麻將2'],
    ['競技麻將20週年測試', '競技麻將2'],
    ['滿貫大亨Web館_新遊戲', '滿貫大亨'],
    ['【競技麻將2】', '競技麻將2'],
    ['【未分類】活動', '其他'],
  ]) assert.equal(stripProjectPrefix(name, category), name);
});

test('the requested compact summary preserves headings, amounts, and original names', () => {
  const results = [
    { status: 'success', data: { category: '競技麻將2', projectName: '【競技麻將2】新虎機-迦羅戰神500測試', totalExclTax: '10,000' } },
    { status: 'success', data: { category: '競技麻將2', projectName: '【競技麻將2】新遊戲-競技大老二測試', totalExclTax: '10,539' } },
  ];
  const original = structuredClone(results);
  const summary = buildAcceptanceSummary(results, DEFAULT_DEPT_MAP);
  assert.equal(summary.detailsWithoutPrefixesText, '【研五】【競技麻將2】共 20,539\n• 新虎機-迦羅戰神500測試、新遊戲-競技大老二測試\n\n全部總計：共 20,539');
  assert.ok(summary.detailsText.includes('• 【競技麻將2】新虎機-迦羅戰神500測試、【競技麻將2】新遊戲-競技大老二測試'));
  assert.equal(summary.overallTotal, 20539);
  assert.deepEqual(results, original);
});
