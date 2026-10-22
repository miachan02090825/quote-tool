import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CATEGORIES, DEFAULT_DEPT_MAP, migrateProjectSettings, cleanProjectName, inferProjectCategory, normalizeQuotationIdentity } from '../src/utils/projects.js';
import { parseQuotationPage } from '../src/utils/quotation.js';
import { buildAcceptanceSummary } from '../src/utils/acceptance.js';

const pageItems = lines => lines.map((str, i) => ({ str, transform: [1, 0, 0, 1, 30, 800 - i * 15] }));

test('names from the reported Other group match configured game aliases', () => {
  for (const title of ['《大滿貫》三隻小豬遊戲測試', '《大滿貫》幸運草金幣7X遊戲測試', '《大滿貫》ATG遊戲74, 940串接測試']) {
    assert.equal(inferProjectCategory(title), '大滿貫');
  }
  assert.equal(inferProjectCategory('【競技麻將】新虎機迦羅戰神測'), '競技麻將2');
  assert.equal(inferProjectCategory('【競技麻將】新遊戲競技大老二測'), '競技麻將2');
  assert.equal(inferProjectCategory('《 滿 貫 大 亨 》海馬戀人'), '滿貫大亨');
});

test('specific Web categories and custom categories take priority regardless of order', () => {
  const categories = ['滿貫大亨', '滿貫大亨Web館', '滿貫大亨實驗組'];
  assert.equal(inferProjectCategory('滿貫大亨Web館_活動', categories), '滿貫大亨Web館');
  assert.equal(inferProjectCategory('滿貫Web館_活動', categories), '滿貫大亨Web館');
  assert.equal(inferProjectCategory('滿貫大亨實驗組_活動', categories), '滿貫大亨實驗組');
  assert.equal(inferProjectCategory('VF_版本2'), 'social casino');
});

test('unrecognized games and disabled categories are not guessed', () => {
  assert.equal(inferProjectCategory('未設定的新遊戲7'), '其他');
  assert.equal(inferProjectCategory('競技麻將3新版本'), '其他');
  assert.equal(inferProjectCategory('《大滿貫》幸運草', ['唯舞獨尊']), '其他');
});

test('title cleanup preserves embedded digits, decimals, fullwidth numbers and matching ID text', () => {
  for (const title of ['幸運草金幣7X遊戲測試', '明星3缺1', '競技麻將2', 'ATG遊戲74, 940串接測試', '版本2.0_第3階段', '新遊戲７', '專案123456加強版']) {
    assert.equal(cleanProjectName(`專案名稱：${title}`, '123456'), title);
  }
  assert.equal(cleanProjectName('1 測試 《大滿貫》幸運草金幣7X 8 時 337.5 2,700'), '《大滿貫》幸運草金幣7X');
  assert.equal(cleanProjectName('123456:明星3缺1_新版本2 功能測試 計時制'), '明星3缺1_新版本2');
});

test('all local PDF name extraction paths preserve numbers', () => {
  const title = '《大滿貫》幸運草金幣7X遊戲測試';
  for (const nameLines of [
    [`123456:${title}`],
    [`案件名稱：${title}`],
    [`1 測試 ${title} 8 時 320 2,560`],
  ]) {
    const { data } = parseQuotationPage(pageItems(['報價單 T260904001', ...nameLines, '合計未稅:2,560元']), DEFAULT_CATEGORIES);
    assert.equal(data.projectName, title);
    assert.equal(data.category, '大滿貫');
    assert.equal(data.totalExclTax, '2560');
  }
  const { data } = parseQuotationPage(pageItems(['品名：明星 3 缺 1 新遊戲', '合計未稅 100']), DEFAULT_CATEGORIES);
  assert.equal(data.projectName, '明星3缺1新遊戲');
  assert.equal(data.category, '明星3缺1');
});

test('AI fallback uses the same aliases and preserves name digits', () => {
  assert.deepEqual(normalizeQuotationIdentity({ projectName: '《大滿貫》幸運草金幣7X遊戲測試', category: '其他' }), {
    projectName: '《大滿貫》幸運草金幣7X遊戲測試', category: '大滿貫',
  });
  assert.equal(normalizeQuotationIdentity({ projectName: '新活動', category: '競技麻將' }).category, '競技麻將2');
  assert.equal(normalizeQuotationIdentity({ projectName: '夜市新活動7', category: '滿貫大亨' }).category, '滿貫大亨');
});

const result = (category, projectName, totalExclTax, orderId = '') => ({ status: 'success', data: { category, projectName, totalExclTax, orderId } });

test('screenshot totals: the Other subtotal is explicit in the display data and copied text', () => {
  const summary = buildAcceptanceSummary([
    result('滿貫大亨', '海馬戀人', '62,548', '123456'),
    result('唯舞獨尊', '外部版本', '10,502'),
    result('其他', '幸運草金幣7X遊戲測試'.repeat(40), '74,940'),
    { status: 'error' },
  ], { '滿貫大亨': '研二', '唯舞獨尊': '研三' });
  assert.equal(summary.overallTotal, 147990);
  assert.equal(summary.groups.find(group => group.category === '其他').totalAmount, 74940);
  assert.match(summary.detailsText, /【其他】【其他】共 74,940\n/);
  assert.ok(summary.detailsText.endsWith('全部總計：共 147,990'));
  assert.equal(summary.orderIdsText, '123456');
});

test('zero totals remain visible, duplicate project names do not discard their amounts', () => {
  const summary = buildAcceptanceSummary([
    result('其他', '新遊戲7', 0), result('其他', '新遊戲7', ''),
    result('測試', '同名版本2', '1,000'), result('測試', '同名版本2', '200'),
  ]);
  assert.ok(summary.detailsText.includes('【其他】【其他】共 0'));
  assert.equal(summary.groups.find(group => group.category === '測試').totalAmount, 1200);
  assert.equal(summary.overallTotal, 1200);
});

test('滿貫 and 大滿貫 stay separate under 研二 and preserve the overall total', () => {
  const titles = ['滿貫大亨_營運活動', '滿貫_海馬戀人', '《大滿貫》幸運草金幣7X'];
  const records = titles.map((title, i) => result(inferProjectCategory(title), title, [30000, 32548, 74940][i]));
  const summary = buildAcceptanceSummary(records, DEFAULT_DEPT_MAP);
  assert.equal(summary.groups.length, 2);
  assert.equal(summary.groups.find(g => g.category === '滿貫大亨').totalAmount, 62548);
  assert.equal(summary.groups.find(g => g.category === '大滿貫').totalAmount, 74940);
  assert.ok(summary.groups.every(g => g.dept === '研二'));
  assert.equal(summary.overallTotal, 137488);
  assert.equal(inferProjectCategory('《大滿貫》活動', ['滿貫大亨']), '其他');
  assert.equal(normalizeQuotationIdentity({ projectName: '《大滿貫》活動', category: '滿貫大亨' }, ['滿貫大亨']).category, '其他');
});

test('existing saved settings gain 大滿貫 without discarding custom categories or preferences', () => {
  const old = { apiKey: 'test-only', modelName: 'custom-model', categories: ['滿貫大亨', '自訂遊戲'], deptMap: { '滿貫大亨': '研二', '自訂遊戲': '研三' } };
  const migrated = migrateProjectSettings(old);
  assert.deepEqual(migrated.categories, ['滿貫大亨', '大滿貫', '自訂遊戲']);
  assert.equal(migrated.deptMap['大滿貫'], '研二');
  assert.equal(migrated.deptMap['自訂遊戲'], '研三');
  assert.equal(migrated.apiKey, old.apiKey);
  assert.equal(migrated.modelName, old.modelName);
  assert.deepEqual(old.categories, ['滿貫大亨', '自訂遊戲']);
  assert.deepEqual(migrateProjectSettings(migrated), migrated);
});

test('PDF names continue onto following rows without truncating endings or brackets', () => {
  for (const [lines, expectedName] of [
    [['123456:【競技麻將2】新虎機-迦羅戰神500測', '試'], '【競技麻將2】新虎機-迦羅戰神500測試'],
    [['案件名稱：滿貫大亨_營運活動(新增AUTO', ')'], '滿貫大亨_營運活動(新增AUTO)'],
    [['《大滿貫》【三隻小豬】新機上線品', '檢測試'], '《大滿貫》【三隻小豬】新機上線品檢測試'],
    [['品名：【競技麻將2】新遊戲-競技大老二測', '試 功能測試'], '【競技麻將2】新遊戲-競技大老二測試'],
  ]) {
    const { data } = parseQuotationPage(pageItems([...lines, '功能測試 2,560', '合計未稅 2,560']), DEFAULT_CATEGORIES);
    assert.equal(data.projectName, expectedName);
    assert.equal(data.totalExclTax, '2560');
  }
});

test('wrapped titles stop at a new project, accounting row, or distant text', () => {
  for (const following of ['8 時 320 2,560', '測試器材 200', '管理費 276', '備註：另外說明', '654321:另一個專案', '《大滿貫》另一個遊戲']) {
    const { data } = parseQuotationPage(pageItems(['123456:滿貫大亨_第一個專案', following, '合計未稅 100']), DEFAULT_CATEGORIES);
    assert.equal(data.projectName, '滿貫大亨_第一個專案');
  }
  const items = pageItems(['123456:滿貫大亨_第一個專案', '其他說明']);
  items[1].transform[5] = 700;
  assert.equal(parseQuotationPage(items, DEFAULT_CATEGORIES).data.projectName, '滿貫大亨_第一個專案');
});

test('acceptance text joins complete names in one bullet per category', () => {
  const summary = buildAcceptanceSummary([
    result('滿貫大亨', '滿貫大亨_260930營運活動', 100),
    result('滿貫大亨', '滿貫大亨_20261014 GASH 點卡活動', 200),
    result('滿貫大亨', '滿貫大亨_開心捕魚X_海馬戀人', 300),
    result('滿貫大亨', '滿貫大亨_【三隻小豬】新機上線品檢測試', 400),
    result('大滿貫', '《大滿貫》幸運草金幣4X4遊戲測試', 500),
  ], DEFAULT_DEPT_MAP);
  assert.ok(summary.detailsText.includes('\n• 滿貫大亨_260930營運活動、滿貫大亨_20261014 GASH 點卡活動、滿貫大亨_開心捕魚X_海馬戀人、滿貫大亨_【三隻小豬】新機上線品檢測試\n'));
  assert.equal(summary.detailsText.match(/^• /gm).length, 2);
  assert.ok(summary.detailsText.endsWith('全部總計：共 1,500'));
});
