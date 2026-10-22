import { moneyNumber } from './quotation.js';
import { stripProjectPrefix } from './projects.js';

const formatMoney = value => new Intl.NumberFormat('zh-TW').format(moneyNumber(value));
const roundMoney = value => Math.round(value * 100) / 100;

export function buildAcceptanceSummary(results, deptMap = {}) {
  const deptOrder = { '研五': 1, '研二': 2, '研三': 3, '其他': 4 };
  const grouped = new Map();
  for (const item of results) {
    if (item.status !== 'success') continue;
    const { data } = item;
    const category = data.category || '其他';
    if (!grouped.has(category)) {
      grouped.set(category, { category, dept: deptMap[category] || '其他', orderIds: [], projectNames: [], totalAmount: 0 });
    }
    const group = grouped.get(category);
    if (data.orderId) group.orderIds.push(data.orderId);
    if (data.projectName) group.projectNames.push(data.projectName);
    group.totalAmount = roundMoney(group.totalAmount + moneyNumber(data.totalExclTax));
  }
  const groups = [...grouped.values()].sort((a, b) =>
    (deptOrder[a.dept] || 99) - (deptOrder[b.dept] || 99) || a.category.localeCompare(b.category, 'zh-TW'));
  const overallTotal = roundMoney(groups.reduce((sum, group) => sum + group.totalAmount, 0));
  const formatDetails = hidePrefixes => groups.map(group => {
    const names = [...new Set(group.projectNames)];
    const displayNames = hidePrefixes ? names.map(name => stripProjectPrefix(name, group.category)) : names;
    // Put the amount on its own heading so long project lists cannot obscure it.
    return `【${group.dept}】【${group.category}】共 ${formatMoney(group.totalAmount)}\n${displayNames.length ? `• ${displayNames.join('、')}` : ''}`;
  }).join('\n\n') + `\n\n全部總計：共 ${formatMoney(overallTotal)}`;
  return {
    groups,
    overallTotal,
    orderIdsText: groups.flatMap(group => group.orderIds).join('、'),
    detailsText: groups.length ? formatDetails(false) : '',
    detailsWithoutPrefixesText: groups.length ? formatDetails(true) : '',
  };
}
