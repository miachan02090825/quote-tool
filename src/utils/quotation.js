import { cleanProjectName, inferProjectCategory } from './projects.js';

export const AMOUNT_FIELDS = ['functionalTestAmount', 'personnelAmount', 'deviceAmount', 'managementFee'];

export function moneyNumber(value) {
  const amount = Number(String(value ?? '').replace(/[,，\s元$]|NTD|NT\$/gi, ''));
  return Number.isFinite(amount) ? amount : 0;
}

export function sumQuotationAmounts(data) {
  return Math.round(AMOUNT_FIELDS.reduce((sum, field) => sum + moneyNumber(data[field]), 0) * 100) / 100;
}

export function normalizeQuotationAmounts(data) {
  const amounts = Object.fromEntries(AMOUNT_FIELDS.map(field => [field, String(moneyNumber(data[field]))]));
  amounts.totalExclTax = String(moneyNumber(data.totalExclTax) || sumQuotationAmounts(amounts));
  return amounts;
}

export function updateQuotationField(data, field, value) {
  const updated = { ...data, [field]: value };
  if (AMOUNT_FIELDS.includes(field)) updated.totalExclTax = String(sumQuotationAmounts(updated));
  return updated;
}

const compact = text => text.replace(/\s+/g, '');
const chargeField = text => {
  const value = compact(text);
  // 包人制 is also labelled 功能測試; classify it first and only once.
  if (/包人/.test(value)) return 'personnelAmount';
  if (/功能測試|功能/.test(value)) return 'functionalTestAmount';
  if (/測試器材|器材|設備|租借/.test(value)) return 'deviceAmount';
  if (/管理費|行政|服務費/.test(value)) return 'managementFee';
  return null;
};
const isBoundary = text => /合計|總計|小計|未稅|含稅|營業稅|備註|日期|作業期間|人員配置|電話|聯絡|報價單|單價|金額\(NTD\)/i.test(compact(text));

function lastAmount(text, orderId) {
  const withoutId = text.replace(/^\s*(?:\d{6}|x{6})\s*[：:].*/i, '')
    .replace(/\d+(?:\.\d+)?\s*%/g, '');
  const matches = [...withoutId.matchAll(/(?<![\w.])(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?(?![\w.%])/g)]
    .map(match => match[0]).filter(value => value !== orderId);
  return matches.length ? moneyNumber(matches.at(-1)) : null;
}

export function parseQuotationAmounts(lines, orderId = '') {
  const amounts = Object.fromEntries(AMOUNT_FIELDS.map(field => [field, 0]));
  const consumed = new Set();
  let totalExclTax = 0;
  let explicitUntaxedTotal = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*(?:\d{6}|x{6})\s*[：:]/i.test(line)) continue;
    const text = compact(line);
    if (/未稅/.test(text) || /合計|總計|小計/.test(text) && !/金額|含稅/.test(text)) {
      const value = lastAmount(line, orderId);
      if (value !== null && (!explicitUntaxedTotal || /未稅/.test(text))) {
        totalExclTax = value;
        explicitUntaxedTotal = /未稅/.test(text);
      }
      continue;
    }
    if (isBoundary(line)) continue;
    const field = chargeField(line);
    if (!field) continue;

    // A wrapped billing label belongs to the same charge as 功能測試 above it.
    if (field === 'functionalTestAmount' && chargeField(lines[i + 1] || '') === 'personnelAmount'
      && lastAmount(lines[i + 1], orderId) === null) continue;

    let source = i;
    let amount = lastAmount(line, orderId);
    if (amount === null) {
      for (const direction of [-1, 1]) {
        for (let distance = 1; distance <= 2; distance++) {
          const index = i + direction * distance;
          const neighbor = lines[index];
          if (!neighbor || isBoundary(neighbor) || consumed.has(index)) break;
          const neighborField = chargeField(neighbor);
          const wrappedLabel = field === 'personnelAmount' && neighborField === 'functionalTestAmount';
          if (neighborField && !wrappedLabel) break;
          const candidate = lastAmount(neighbor, orderId);
          if (candidate !== null) {
            amount = candidate;
            source = index;
            break;
          }
        }
        if (amount !== null) break;
      }
    }
    if (amount !== null && !consumed.has(source)) {
      amounts[field] += amount;
      consumed.add(source);
    }
  }
  return normalizeQuotationAmounts({ ...amounts, totalExclTax });
}

export function parseQuotationPage(items, categories = []) {
  const makeFlexRegex = (keyword) => {
    const chars = keyword.split('').map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return new RegExp(chars.join('\\s*'), 'i');
  };

  const METADATA_KEYWORDS = [
    '聯絡人', '電話', '統一編號', '統編', '傳真', '地址', '日期', '頁次', '頁碼', 
    'email', 'mail', '公司', '戶名', '帳號', '銀行', '分行', '報價單', 
    '鈊象', '電子', '委託單位', '客戶', '備註', '說明', '期限',
    'docusign', 'envelope', 'digital', 'hearts', 'linguitronics', 'taiwan', '電心萬象',
    'no.', '服務項目', '內容摘要', '營業稅', '合計金額', '作業期間', '人員配置', '主管'
  ];

  const projectKeywords = ['專案名稱', '案件名稱', '案名', '品名'];

  // Group PDF text items by visual Y coordinates (rows)
  const linesMap = {};
  items.forEach(item => {
    const y = Math.round(item.transform[5]);
    let foundY = Object.keys(linesMap).find(key => Math.abs(Number(key) - y) < 6);
    if (foundY) {
      linesMap[foundY].push(item);
    } else {
      linesMap[y] = [item];
    }
  });

  // Sort rows top-to-bottom and items left-to-right
  const sortedY = Object.keys(linesMap).sort((a, b) => Number(b) - Number(a));
  const rows = sortedY.map(y => {
    const lineItems = linesMap[y].filter(item => item.str.trim()).sort((a, b) => a.transform[4] - b.transform[4]);
    return { y: Number(y), items: lineItems, text: lineItems.map(item => item.str).join(' ').trim() };
  }).filter(row => row.text);
  const cleanLines = rows.map(row => row.text);

  const projectLine = cleanLines.find(line => /^\s*(?:\d{6}|x{6})\s*[：:]/i.test(line));
  let orderId = projectLine?.match(/^\s*(\d{6})\s*[：:]/)?.[1] || '';
  let projectName = '';

  const hasFeeLabel = text => /功能測試|測試器材|計時制|包人制|管理費|服務費/.test(compact(text));
  const readWrappedName = (startIndex, firstText) => {
    const firstRow = rows[startIndex];
    const firstNameItem = firstRow.items.find(item => /^(?:\d{6}|x{6})\s*[：:]/i.test(item.str.trim())
      || inferProjectCategory(item.str, categories) !== '其他')
      || firstRow.items.find(item => /[\p{L}]/u.test(item.str) && !/^(測試|專案管理)$/.test(item.str.trim()));
    const nameX = firstNameItem?.transform[4] ?? firstRow.items[0].transform[4];
    // A table row contains several cells: its leftmost item is often the row
    // number, not the title continuation. Restrict reading to the title column.
    const headerIndex = rows.findLastIndex((row, index) => index < startIndex
      && /內容摘要/.test(compact(row.text)) && /數量/.test(compact(row.text)));
    const inTable = headerIndex !== -1 && !rows.slice(headerIndex + 1, startIndex)
      .some(row => /^(?:備註|營業稅|合計|總計)/.test(compact(row.text)));
    const rightX = inTable
      ? rows[headerIndex].items.find(item => /數/.test(item.str))?.transform[4] ?? Infinity
      : Infinity;
    const nameItems = row => row.items.filter(item => item.transform[4] >= nameX - 20 && item.transform[4] < rightX);
    const titleText = firstText ?? nameItems(firstRow).map(item => item.str).join(' ');
    let name = cleanProjectName(titleText, orderId);
    if (hasFeeLabel(titleText)) return name;
    for (let i = startIndex + 1; i < rows.length; i++) {
      const row = rows[i];
      const columnItems = nameItems(row);
      const text = columnItems.map(item => item.str).join(' ').trim();
      if (rows[i - 1].y - row.y > 24 || !columnItems.length
        || columnItems[0].transform[4] > nameX + 120) break;
      if (isBoundary(text) || METADATA_KEYWORDS.some(kw => makeFlexRegex(kw).test(text))
        || projectKeywords.some(kw => makeFlexRegex(kw).test(text))
        || /^(?:\d{6}|x{6})\s*[：:]|^\d+\s+測試/i.test(text)) break;
      if (/^(功能測試|測試器材|計時制|包人制|管理費|服務費)/.test(compact(text))) break;
      if (/^[《【[]/.test(text) && inferProjectCategory(text, categories) !== '其他') break;
      const fragment = cleanProjectName(text, orderId);
      // A continuation can be a final 試, an alphanumeric suffix, or a closing bracket.
      // Quantities/prices and standalone fee labels are not part of the title.
      if (!fragment || /^管理費|^行政費|^服務費/.test(compact(fragment))
        || /^\d+(?:\.\d+)?\s*(?:時|份|天|人|月|件)\s*[\d,]/.test(text)
        || /^[\d,.$\s]+$/.test(fragment)) break;
      if (!/[\p{L}]/u.test(fragment) && !/^[)）\]】》]+$/.test(fragment)) break;
      name += /[a-z]$/i.test(name) && /^[a-z]/i.test(fragment) ? ` ${fragment}` : fragment;
      if (hasFeeLabel(text)) break;
    }
    return cleanProjectName(name, orderId);
  };

  // Heuristic 1: Extract Order ID (ONLY 6-digit pure numbers, exclude years)
  for (let i = 0; i < cleanLines.length; i++) {
    if (projectLine) break;
    const line = cleanLines[i];
    if (METADATA_KEYWORDS.some(kw => makeFlexRegex(kw).test(line))) continue;
    const orderIdMatch = line.match(/^\s*(\d{6})\s*[：:]/) || line.match(/\b\d{6}\b/);
    if (orderIdMatch) {
      const idCandidate = orderIdMatch[1] || orderIdMatch[0];
      const isYear = idCandidate.startsWith('202') || idCandidate.startsWith('199');
      if (!isYear) {
        orderId = idCandidate;
        break;
      }
    }
  }

  if (projectLine) {
    projectName = readWrappedName(cleanLines.indexOf(projectLine));
    // The same order is repeated in fee rows and in the notes. A complete
    // repetition can supply a missing tail, but never merge different titles.
    for (let i = 0; i < cleanLines.length; i++) {
      const match = cleanLines[i].match(/^\s*(\d{6}|x{6})\s*[：:]/i);
      if (!match || (orderId ? match[1] !== orderId : !/^x{6}$/i.test(match[1]))) continue;
      const candidate = readWrappedName(i);
      if (compact(candidate).startsWith(compact(projectName)) && candidate.length > projectName.length) projectName = candidate;
    }
  }

  // Heuristic 2: Extract Project Name
  // Pass 1: Look for lines with project keywords
  for (const line of cleanLines) {
    if (projectName) break;
    const isMeta = METADATA_KEYWORDS.some(kw => makeFlexRegex(kw).test(line));
    if (isMeta) continue;

    const matchedKw = projectKeywords.find(kw => makeFlexRegex(kw).test(line));
    if (matchedKw) {
      const regex = makeFlexRegex(matchedKw);
      const match = line.match(regex);
      if (match) {
        const idx = match.index + match[0].length;
        let candidate = line.substring(idx).trim();
        candidate = readWrappedName(cleanLines.indexOf(line), candidate);
        if (candidate && candidate.length > 2) {
          projectName = candidate;
          break;
        }
      }
    }
  }

  if (!projectName) {
    const recognized = cleanLines.find(line => !METADATA_KEYWORDS.some(kw => makeFlexRegex(kw).test(line))
      && inferProjectCategory(cleanProjectName(line, orderId), categories) !== '其他');
    if (recognized) projectName = readWrappedName(cleanLines.indexOf(recognized));
  }

  // Pass 2: Fallback - scan all lines for the first line that yields a valid project name
  if (!projectName) {
    for (const line of cleanLines) {
      const isMeta = METADATA_KEYWORDS.some(kw => makeFlexRegex(kw).test(line));
      if (isMeta) continue;

      const candidate = readWrappedName(cleanLines.indexOf(line));
      if (candidate && candidate.length > 2) {
        projectName = candidate;
        break;
      }
    }
  }

  const amounts = parseQuotationAmounts(cleanLines, orderId);
  const { totalExclTax } = amounts;

  const finalProjectName = cleanProjectName(projectName, orderId);
  const category = inferProjectCategory(finalProjectName, categories);

  const hasText = items.length > 0;
  const hasParsedFields = orderId || parseInt(totalExclTax, 10) > 0;

  return {
    hasWarning: !hasParsedFields || !orderId || parseInt(totalExclTax, 10) === 0,
    warningMsg: !hasText 
      ? '本地解析無文字（此頁可能是掃描影像或圖片，您可在表格中直接手動編輯，或於設定啟用 AI OCR）' 
      : (!orderId || parseInt(totalExclTax, 10) === 0)
        ? '本地解析未成功識別所有欄位（單號或合計為 0，請點擊欄位直接手動修改補齊）'
        : null,
    data: {
      orderId,
      projectName: finalProjectName || (!hasText ? '⚠️ 掃描件 (請雙擊此處手動輸入專案名稱)' : '⚠️ 未識別案件 (請雙擊編輯)'),
      category,
      ...amounts
    }
  };
}
