export const DEFAULT_CATEGORIES = [
  '滿貫大亨Web館', '網頁組', '明星3缺1', '滿貫大亨', '大滿貫',
  '競技麻將2', '唯舞獨尊', '玩星派對', 'social casino',
];

export const DEFAULT_DEPT_MAP = {
  '明星3缺1': '研五', '競技麻將2': '研五', 'social casino': '研五',
  '滿貫大亨': '研二', '大滿貫': '研二', '滿貫大亨Web館': '研二', '玩星派對': '研三', '唯舞獨尊': '研三',
};

const CATEGORY_ALIASES = {
  '滿貫大亨': ['滿貫'],
  '滿貫大亨Web館': ['滿貫Web館', '大滿貫Web館'],
  '競技麻將2': ['競技麻將'],
  '明星3缺1': ['明星三缺一'],
};

export function stripProjectPrefix(projectName, category) {
  const original = String(projectName ?? '');
  if (!category || category === '其他') return original;
  const aliases = [category, ...(CATEGORY_ALIASES[category] || [])].sort((a, b) => b.length - a.length);
  for (const alias of aliases) {
    const label = [...alias.replace(/\s/g, '')].map(char => char.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s*');
    // Only remove a leading game label, leaving subproject tags and digits intact.
    const prefix = new RegExp(`^\\s*(?:【\\s*${label}\\s*】|《\\s*${label}\\s*》|\\[\\s*${label}\\s*\\]|（\\s*${label}\\s*）|\\(\\s*${label}\\s*\\)|${label}(?=[\\s_：:－-]|$))[\\s_：:－-]*`, 'i');
    const stripped = original.replace(prefix, '');
    if (stripped !== original && stripped.trim()) return stripped;
  }
  return original;
}

export function migrateProjectSettings(saved = {}) {
  const categories = [...(saved.categories || DEFAULT_CATEGORIES)];
  const deptMap = { ...(saved.deptMap || DEFAULT_DEPT_MAP) };
  if (saved.categorySchemaVersion !== 2) {
    const index = categories.indexOf('滿貫大亨');
    if (index !== -1 && !categories.includes('大滿貫')) categories.splice(index + 1, 0, '大滿貫');
    deptMap['滿貫大亨'] = '研二';
    deptMap['大滿貫'] = '研二';
  }
  return { ...saved, categories, deptMap, categorySchemaVersion: 2 };
}

const normalizeForMatch = value => String(value ?? '').normalize('NFKC').toLowerCase()
  .replace(/[\s_《》〈〉【】「」[\]（）()-]/g, '');

export function inferProjectCategory(projectName, categories = DEFAULT_CATEGORIES) {
  const name = normalizeForMatch(projectName);
  if (name.includes('vf') && categories.includes('social casino')) return 'social casino';
  const matches = [];
  for (const category of categories) {
    if (!category || category === '其他') continue;
    for (const alias of [category, ...(CATEGORY_ALIASES[category] || [])]) {
      const key = normalizeForMatch(alias);
      const index = name.indexOf(key);
      if (index === -1) continue;
      // 大滿貫 is a separate game, even if its category has been disabled.
      if (alias === '滿貫' && name[index - 1] === '大') continue;
      if (alias === '競技麻將' && /^\d/.test(name.slice(index + key.length))) continue;
      matches.push({ category, length: key.length });
    }
  }
  // Specific Web/custom categories win over shorter names such as 滿貫.
  matches.sort((a, b) => b.length - a.length);
  return matches[0]?.category || '其他';
}

export function cleanProjectName(value, orderId = '') {
  let name = String(value ?? '').replace(/[\r\n]+/g, '').trim();
  name = name.replace(/^T\d{7,11}\s*[：:_-]?\s*/i, '')
    .replace(/^(?:\d{6}|x{6})\s*[：:]\s*/i, '');
  if (orderId && name.startsWith(`${orderId} `)) name = name.slice(orderId.length).trim();
  name = name.replace(/^(?:專\s*案\s*名\s*稱|案\s*件\s*名\s*稱|案\s*名|品\s*名)\s*[：:]?\s*/, '')
    .replace(/^[：:]\s*/, '')
    .replace(/^\d+\s+測試\s+/, '');
  // Strip a recognizable quantity/unit/unit-price/amount tail, never digits in a title.
  name = name.replace(/\s+\d+(?:\.\d+)?\s*(?:小時|人時|時|份|天|人|月|件|hrs?)\s+[\d,]+(?:\.\d+)?\s+[\d,]+(?:\.\d+)?\s*(?:元|NTD)?\s*$/i, '');
  name = name.replace(/(?:功\s*能\s*測\s*試\s*(?:計\s*時\s*制|包\s*人\s*制)?|測\s*試\s*器\s*材|計\s*時\s*制|包\s*人\s*制)\s*$/, '');
  return name.replace(/(?<=[\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff\d])/g, '')
    .replace(/(?<=\d)\s+(?=[\u4e00-\u9fff])/g, '')
    .replace(/\s+/g, ' ').trim();
}

export function normalizeQuotationIdentity(data, categories = DEFAULT_CATEGORIES) {
  const projectName = cleanProjectName(data.projectName, data.orderId);
  const inferred = inferProjectCategory(projectName, categories);
  const isDisabledGrandSlam = normalizeForMatch(projectName).includes('大滿貫') && !categories.includes('大滿貫');
  const category = inferred !== '其他' ? inferred : isDisabledGrandSlam ? '其他'
    : categories.includes(data.category) ? data.category
      : inferProjectCategory(data.category, categories);
  return { projectName, category };
}
