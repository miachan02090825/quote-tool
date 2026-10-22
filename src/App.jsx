import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  FileText, Loader2, CheckCircle2, AlertCircle, Download, UploadCloud, 
  BarChart3, Filter, FileSpreadsheet, List, FileCheck, Scale, 
  ClipboardCheck, Trash2, Settings as SettingsIcon, Search, 
  ChevronDown, ChevronUp, Plus, Check, Cpu, Zap
} from 'lucide-react';
import SettingsPanel from './components/SettingsPanel';
import ColumnMapperModal from './components/ColumnMapperModal';
import { parseQuotationPage, normalizeQuotationAmounts, updateQuotationField, moneyNumber } from './utils/quotation';

import { DEFAULT_CATEGORIES, DEFAULT_DEPT_MAP, inferProjectCategory, normalizeQuotationIdentity, migrateProjectSettings } from './utils/projects';
import { buildAcceptanceSummary } from './utils/acceptance';

const App = () => {
  // --- Tab & Lib state ---
  const [activeTab, setActiveTab] = useState('parser'); // 'parser' | 'invoice' | 'compare' | 'acceptance' | 'settings'
  const [, setLibsLoaded] = useState({ pdf: false, xlsx: false });

  // --- Settings state ---
  const [settings, setSettings] = useState(() => {
    const saved = localStorage.getItem('invoice_tool_settings');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return migrateProjectSettings({
          categorySchemaVersion: parsed.categorySchemaVersion,
          apiKey: parsed.apiKey || '',
          modelName: parsed.modelName || 'gemini-3.5-flash',
          categories: parsed.categories || DEFAULT_CATEGORIES,
          deptMap: parsed.deptMap || DEFAULT_DEPT_MAP
        });
      } catch (e) {
        console.error('Error parsing saved settings', e);
      }
    }
    return {
      categorySchemaVersion: 2,
      apiKey: '',
      modelName: 'gemini-3.5-flash',
      categories: DEFAULT_CATEGORIES,
      deptMap: DEFAULT_DEPT_MAP
    };
  });

  // --- PDF Parser State ---
  const [results, setResults] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [filterCategory, setFilterCategory] = useState('全部');
  const [parseMode, setParseMode] = useState('local'); // 'local' (本地快速解析) | 'ai' (AI OCR 辨識)

  // --- Invoice State ---
  const [invoiceData, setInvoiceData] = useState([]);
  const [invoiceTotal, setInvoiceTotal] = useState(0);

  // --- Column Mapper Modal State ---
  const [showMapper, setShowMapper] = useState(false);
  const [mapperData, setMapperData] = useState(null);

  // --- Comparison Filter State ---
  const [compareFilter, setCompareFilter] = useState('all'); // 'all' | 'match' | 'mismatch' | 'pdf_only' | 'invoice_only'
  const [compareSearch, setCompareSearch] = useState('');
  const [expandedOrderId, setExpandedOrderId] = useState(null);

  // --- Acceptance Editing State ---
  const [editableOrderIds, setEditableOrderIds] = useState('');
  const [editableDetails, setEditableDetails] = useState('');
  const [editableDetailsWithoutPrefixes, setEditableDetailsWithoutPrefixes] = useState('');
  const [hideProjectPrefixes, setHideProjectPrefixes] = useState(false);
  const displayedDetails = hideProjectPrefixes ? editableDetailsWithoutPrefixes : editableDetails;
  const [copiedOrders, setCopiedOrders] = useState(false);
  const [copiedDetails, setCopiedDetails] = useState(false);

  // Refs for auto-resizing textareas
  const orderIdsRef = useRef(null);
  const detailsRef = useRef(null);

  // Load scripts from CDN
  useEffect(() => {
    if (window.pdfjsLib) {
      setLibsLoaded(prev => ({ ...prev, pdf: true }));
    } else {
      const pdfScript = document.createElement('script');
      pdfScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
      pdfScript.async = true;
      document.head.appendChild(pdfScript);
      pdfScript.onload = () => {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        setLibsLoaded(prev => ({ ...prev, pdf: true }));
      };
    }

    if (window.XLSX) {
      setLibsLoaded(prev => ({ ...prev, xlsx: true }));
    } else {
      const xlsxScript = document.createElement('script');
      xlsxScript.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      xlsxScript.async = true;
      document.head.appendChild(xlsxScript);
      xlsxScript.onload = () => {
        setLibsLoaded(prev => ({ ...prev, xlsx: true }));
      };
    }
  }, []);

  // Reflow after content, viewport width or web-font changes.
  useEffect(() => {
    if (activeTab !== 'acceptance') return;
    const elements = [orderIdsRef.current, detailsRef.current].filter(Boolean);
    let disposed = false;
    let frameId = null;
    const resize = () => {
      if (disposed) return;
      elements.forEach(element => {
        element.style.height = 'auto';
        element.style.height = `${element.scrollHeight + 2}px`;
      });
    };
    const scheduleResize = () => {
      if (disposed || frameId !== null) return;
      frameId = requestAnimationFrame(() => {
        frameId = null;
        resize();
      });
    };
    resize();
    const widths = new WeakMap();
    const observer = new ResizeObserver(entries => {
      let changed = false;
      entries.forEach(({ target, contentRect }) => {
        if (widths.get(target) !== contentRect.width) changed = true;
        widths.set(target, contentRect.width);
      });
      // Defer layout writes; resizing in the observer callback causes loop errors.
      if (changed) scheduleResize();
    });
    elements.forEach(element => observer.observe(element.parentElement));
    document.fonts?.ready.then(scheduleResize);
    return () => {
      disposed = true;
      observer.disconnect();
      if (frameId !== null) cancelAnimationFrame(frameId);
    };
  }, [editableOrderIds, displayedDetails, activeTab]);

  // --- 1. PDF page to image (For AI OCR) ---
  const pdfToImages = async (file) => {
    if (!window.pdfjsLib) throw new Error("PDF.js 尚未加載，請稍候。");
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const images = [];

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const viewport = page.getViewport({ scale: 2.0 });
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d');
      canvas.height = viewport.height;
      canvas.width = viewport.width;
      
      await page.render({ canvasContext: context, viewport }).promise;
      images.push(canvas.toDataURL('image/jpeg', 0.85).split(',')[1]);
    }
    return images;
  };

  // --- 2. AI OCR via Gemini API ---
  const extractInfoAI = async (base64Image) => {
    if (!settings.apiKey) {
      throw new Error("請先在系統設定中設定您的 Gemini API Key。");
    }

    const systemPrompt = `你是一位報價單解析專家。請從圖片中提取資訊並回傳 JSON。
    
    【關鍵任務】
    1. 找到報價單核心行（格式通常為：6位數字:項目名稱）。
    2. orderId: 提取該 6 位純數字。絕對禁止抓取 T 開頭的編號；若是 xxxxxx 等遮蔽範例，請填空字串，不得臆測。
    3. projectName: 提取冒號後的文字。特別注意：
       - 若名稱跨行（如「品\\n檢測試」），請將其無縫合併為單一字串（「品檢測試」）。
       - 完整保留專案名稱中的數字，例如「幸運草金幣7」「明星3缺1」「競技麻將2」「ATG遊戲74」「940串接」；不得刪除數字或改寫。
       - 必須略過並移除名稱結尾的「功能測試」「計時制」「包人制」或「測試器材」。
    4. category: 對比 projectName 從 [${settings.categories.join(", ")}] 擇一，不符填"其他"。
       - 「滿貫」對應「滿貫大亨」；「大滿貫」是獨立分類，不可合併至「滿貫大亨」，「競技麻將」對應「競技麻將2」，「滿貫Web館」對應「滿貫大亨Web館」；僅使用上列已設定的分類。
       - 【重要】若專案名稱中包含 "VF" 或 "vf"，請一律填寫為 "social casino"。
    5. 金額欄位：提取純數字。若圖中找不到該項目，請填 "0"。
       - functionalTestAmount: 功能測試／計時制金額，不包含包人制
       - personnelAmount: 包人費用（包含「功能測試 包人制」），同頁多筆請加總，絕不可同時計入 functionalTestAmount
       - 各費用請取最右側「金額」欄，不要取數量或單價（例如單價 337.5、金額 2,700 時取 2700）
       - deviceAmount: 測試器材金額
       - managementFee: 管理費金額
       - totalExclTax: 合計未稅，包含計時功能測試、包人費用、測試器材及管理費，不包含營業稅；沒有明列未稅合計時將四項相加
    
    【輸出格式】
    {
      "orderId": "string",
      "projectName": "string",
      "category": "string",
      "functionalTestAmount": "string",
      "personnelAmount": "string",
      "deviceAmount": "string",
      "managementFee": "string",
      "totalExclTax": "string"
    }`;

    const payload = {
      contents: [{
        role: "user",
        parts: [
          { text: "請解析此報價單頁面金額。" }, 
          { inlineData: { mimeType: "image/jpeg", data: base64Image } }
        ]
      }],
      systemInstruction: { parts: [{ text: systemPrompt }] },
      generationConfig: { 
        responseMimeType: "application/json",
        temperature: 0 
      }
    };

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${settings.modelName}:generateContent?key=${settings.apiKey}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
      if (response.status === 400 || response.status === 403) {
        throw new Error(`API 金鑰無效或模型設定錯誤 (HTTP ${response.status})`);
      }
      throw new Error(`API 連線失敗 (HTTP ${response.status})`);
    }
    const result = await response.json();
    return JSON.parse(result.candidates[0].content.parts[0].text);
  };

  // --- 3. Local Fast PDF Text Parsing (Keyless fallback) ---
  const processFilesLocal = async (pdfFiles) => {
    const generateId = () => Math.random().toString(36).substring(2, 15);

    for (let fIdx = 0; fIdx < pdfFiles.length; fIdx++) {
      const file = pdfFiles[fIdx];
      try {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        
        for (let pageIdx = 1; pageIdx <= pdf.numPages; pageIdx++) {
          const page = await pdf.getPage(pageIdx);
          const textContent = await page.getTextContent();
          const items = textContent.items;

          setResults(prev => [...prev, {
            id: generateId(),
            fileName: `${file.name} (P${pageIdx})`,
            status: 'success',
            ...parseQuotationPage(items, settings.categories)
          }]);
        }
      } catch (err) {
        console.error(err);
        setResults(prev => [...prev, { 
          id: generateId(), 
          fileName: file.name, 
          status: 'error',
          errorMsg: `本地解析失敗: ${err.message}`
        }]);
      } finally {
        setProgress(p => ({ ...p, current: p.current + 1 }));
      }
    }
  };

  // --- 4. Main PDF Router (Local vs AI OCR) ---
  const processFiles = async (uploadedFiles) => {
    const pdfFiles = uploadedFiles.filter(f => f.name.toLowerCase().endsWith('.pdf'));
    if (pdfFiles.length === 0) {
      alert("請選擇有效的 PDF 檔案！");
      return;
    }

    setIsProcessing(true);

    if (parseMode === 'local') {
      // Local Fast Parsing (Keyless)
      setProgress({ current: 0, total: pdfFiles.length });
      await processFilesLocal(pdfFiles);
      setIsProcessing(false);
      return;
    }

    // AI OCR Parsing (Requires API Key)
    if (!settings.apiKey) {
      alert("請先至「系統設定」填寫 Gemini API Key！");
      setActiveTab('settings');
      setIsProcessing(false);
      return;
    }

    const generateId = () => Math.random().toString(36).substring(2, 15);

    try {
      const allTasks = [];
      for (const file of pdfFiles) {
        try {
          const pages = await pdfToImages(file);
          pages.forEach((img, idx) => {
            allTasks.push({ img, fileName: file.name, pageIdx: idx + 1 });
          });
        } catch (err) {
          console.error(err);
          alert(`讀取 PDF 失敗 (${file.name}): ${err.message}`);
        }
      }

      if (allTasks.length === 0) {
        setIsProcessing(false);
        return;
      }

      setProgress({ current: 0, total: allTasks.length });
      const queue = [...allTasks];

      const runWorker = async () => {
        while (queue.length > 0) {
          const task = queue.shift();
          try {
            const data = await extractInfoAI(task.img);
            
            const identity = normalizeQuotationIdentity(data, settings.categories);

            setResults(prev => [...prev, {
              id: generateId(),
              fileName: `${task.fileName} (P${task.pageIdx})`,
              status: 'success',
              data: {
                ...data,
                ...identity,
                ...normalizeQuotationAmounts(data)
              }
            }]);
          } catch (err) {
            console.error(err);
            setResults(prev => [...prev, { 
              id: generateId(), 
              fileName: `${task.fileName} (P${task.pageIdx})`, 
              status: 'error',
              errorMsg: err.message
            }]);
          } finally {
            setProgress(p => ({ ...p, current: p.current + 1 }));
          }
        }
      };

      const CONCURRENCY = 3;
      await Promise.all(Array(Math.min(CONCURRENCY, allTasks.length)).fill(null).map(runWorker));
    } finally {
      setIsProcessing(false);
    }
  };

  // --- 5. Process Invoice Excel File ---
  const handleExcelUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!window.XLSX) {
      alert("Excel 處理套件尚未完成載入，請稍候！");
      return;
    }

    const reader = new FileReader();
    reader.onload = (evt) => {
      const bstr = evt.target.result;
      const wb = window.XLSX.read(bstr, { type: 'binary' });
      const wsname = wb.SheetNames[0];
      const ws = wb.Sheets[wsname];
      const rows = window.XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

      if (rows.length === 0) {
        alert("Excel 檔案內容為空！");
        return;
      }

      let nameIdx = -1;
      let amountIdx = -1;
      let dataStartIndex = -1;

      const nameKeywords = ['項目名', '項目名稱', '品名', '品項名稱', '專案名稱', '名稱', '單據編號', '案名', '項目'];
      const amountKeywords = ['金額（未稅）', '金額(未稅)', '未稅金額', '金額', '合計', '未稅合計', '未稅'];

      for (let i = 0; i < Math.min(rows.length, 15); i++) {
        const row = rows[i];
        if (!Array.isArray(row)) continue;

        const foundName = row.findIndex(c => c && typeof c === 'string' && nameKeywords.some(k => c.includes(k)));
        const foundAmount = row.findIndex(c => c && typeof c === 'string' && amountKeywords.some(k => c.includes(k)));

        if (foundName !== -1 && foundAmount !== -1) {
          nameIdx = foundName;
          amountIdx = foundAmount;
          dataStartIndex = i + 1;
          break;
        }
      }

      if (nameIdx !== -1 && amountIdx !== -1) {
        parseExcelData(rows, dataStartIndex, nameIdx, amountIdx);
      } else {
        let headersRowIndex = 0;
        for (let i = 0; i < Math.min(rows.length, 10); i++) {
          if (Array.isArray(rows[i]) && rows[i].filter(Boolean).length > 1) {
            headersRowIndex = i;
            break;
          }
        }
        
        const detectedHeaders = rows[headersRowIndex].map((h, colIdx) => h ? h.toString().trim() : `欄位 ${colIdx + 1}`);
        
        const previewData = [];
        for (let i = headersRowIndex + 1; i < Math.min(rows.length, headersRowIndex + 5); i++) {
          const rowObj = {};
          detectedHeaders.forEach((h, idx) => {
            rowObj[h] = rows[i][idx] !== undefined ? rows[i][idx] : '';
          });
          previewData.push(rowObj);
        }

        setMapperData({
          headers: detectedHeaders,
          rawRows: rows,
          headersRowIndex,
          previewRows: previewData
        });
        setShowMapper(true);
      }
    };
    reader.readAsBinaryString(file);
    e.target.value = null; 
  };

  const parseExcelData = (rows, dataStartIndex, nameIdx, amountIdx) => {
    let total = 0;
    const parsedData = [];

    for (let i = dataStartIndex; i < rows.length; i++) {
      const row = rows[i];
      if (!row || !row[nameIdx]) continue;

      const rawName = row[nameIdx].toString().trim();
      let orderId = '';
      let projectName = rawName;

      const match = rawName.match(/^([A-Za-z0-9_]+)\s*[：:]\s*(.*)/);
      if (match) {
        orderId = match[1].trim();
        projectName = match[2].trim();
      } else {
        const digitsMatch = rawName.match(/^([0-9]{6}|[Tt][0-9]{7,11})\b(.*)/);
        if (digitsMatch) {
          orderId = digitsMatch[1].trim();
          projectName = (digitsMatch[2] || '').trim();
        }
      }

      let rawAmount = row[amountIdx] ? row[amountIdx].toString() : '0';
      const amount = parseInt(rawAmount.replace(/[^\d-]/g, ''), 10) || 0;
      total += amount;

      parsedData.push({
        id: `inv-${Math.random().toString(36).substring(2, 11)}`,
        orderId,
        projectName,
        amount
      });
    }

    setInvoiceData(prev => [...prev, ...parsedData]);
    setInvoiceTotal(prev => prev + total);
  };

  const handleMapperConfirm = ({ nameCol, amountCol }) => {
    const { headers, rawRows, headersRowIndex } = mapperData;
    const nameIdx = headers.indexOf(nameCol);
    const amountIdx = headers.indexOf(amountCol);

    if (nameIdx !== -1 && amountIdx !== -1) {
      parseExcelData(rawRows, headersRowIndex + 1, nameIdx, amountIdx);
    }
    setShowMapper(false);
    setMapperData(null);
  };

  // --- 6. Data Actions & Handlers ---
  const handleSaveSettings = (newSettings) => {
    const updatedSettings = { ...newSettings, categorySchemaVersion: 2 };
    setSettings(updatedSettings);
    localStorage.setItem('invoice_tool_settings', JSON.stringify(updatedSettings));
    setResults(prev => prev.map(item => item.status !== 'success' || item.categoryManuallySet ? item : {
      ...item, data: { ...item.data, category: normalizeQuotationIdentity(item.data, newSettings.categories).category }
    }));
  };

  const handlePDFFieldChange = (id, field, value) => {
    setResults(prev => prev.map(item => {
      if (item.id === id) {
        const newData = updateQuotationField(item.data, field, value);
        if (field === 'projectName' && !item.categoryManuallySet) {
          newData.category = inferProjectCategory(newData.projectName, settings.categories);
        }
        const hasWarning = !newData.orderId.trim() || moneyNumber(newData.totalExclTax) === 0;
        return { ...item, data: newData, categoryManuallySet: field === 'category' || item.categoryManuallySet, hasWarning, warningMsg: hasWarning ? '請補齊案件單號與未稅金額後再進行比對。' : null };
      }
      return item;
    }));
  };

  const handleInvoiceFieldChange = (id, field, value) => {
    setInvoiceData(prev => {
      const updated = prev.map(item => {
        if (item.id === id) {
          const val = field === 'amount' ? parseInt(value.toString().replace(/[^\d-]/g, ''), 10) || 0 : value;
          return { ...item, [field]: val };
        }
        return item;
      });
      const newTotal = updated.reduce((sum, item) => sum + item.amount, 0);
      setInvoiceTotal(newTotal);
      return updated;
    });
  };

  const handleAddCustomRow = () => {
    const newId = Math.random().toString(36).substring(2, 15);
    setResults(prev => [...prev, {
      id: newId,
      fileName: '手動新增資料',
      status: 'success',
      data: {
        orderId: '',
        projectName: '新項目名稱',
        category: settings.categories[0] || '其他',
        functionalTestAmount: '0',
        personnelAmount: '0',
        deviceAmount: '0',
        managementFee: '0',
        totalExclTax: '0'
      }
    }]);
  };

  const handleAddCustomInvoiceRow = () => {
    const newId = `inv-${Math.random().toString(36).substring(2, 11)}`;
    setInvoiceData(prev => [...prev, {
      id: newId,
      orderId: '',
      projectName: '新發票項目',
      amount: 0
    }]);
  };

  const handleDeletePDFItem = (id) => {
    if (window.confirm('確定要刪除這筆報價單紀錄嗎？')) {
      setResults(prev => prev.filter(item => item.id !== id));
    }
  };

  const handleDeleteInvoiceItem = (id) => {
    if (window.confirm('確定要刪除這筆發票明細嗎？')) {
      setInvoiceData(prev => {
        const filtered = prev.filter(item => item.id !== id);
        const newTotal = filtered.reduce((sum, item) => sum + item.amount, 0);
        setInvoiceTotal(newTotal);
        return filtered;
      });
    }
  };

  const formatWithCommas = (num) => {
    if (num === null || num === undefined) return '-';
    const val = moneyNumber(num);
    return isNaN(val) ? '0' : new Intl.NumberFormat('zh-TW').format(val);
  };

  // --- 7. Grouped and Filtered PDF Data ---
  const availableCategories = useMemo(() => {
    const cats = new Set(results.map(r => r.status === 'success' ? r.data.category : '解析失敗'));
    return ['全部', ...Array.from(cats)].sort();
  }, [results]);

  const filteredResults = useMemo(() => {
    if (filterCategory === '全部') return results;
    return results.filter(r => {
      const cat = r.status === 'success' ? r.data.category : '解析失敗';
      return cat === filterCategory;
    });
  }, [results, filterCategory]);

  const pdfStats = useMemo(() => {
    const successItems = filteredResults.filter(r => r.status === 'success');
    const totalAmount = successItems.reduce((sum, r) => sum + moneyNumber(r.data.totalExclTax), 0);
    return {
      totalCount: filteredResults.length,
      successCount: successItems.length,
      totalAmount
    };
  }, [filteredResults]);

  const groupedResults = useMemo(() => {
    return filteredResults.reduce((acc, curr) => {
      const category = curr.status === 'success' ? curr.data.category : '解析失敗';
      if (!acc[category]) acc[category] = [];
      acc[category].push(curr);
      return acc;
    }, {});
  }, [filteredResults]);

  const sortedCategories = useMemo(() => {
    return Object.keys(groupedResults).sort((a, b) => {
      if (a === '解析失敗') return 1;
      if (b === '解析失敗') return -1;
      return a.localeCompare(b, 'zh-TW');
    });
  }, [groupedResults]);

  // Export CSV
  const exportToCSV = () => {
    const header = "\uFEFF專案分類,單號,案件名稱,功能測試（計時）,包人費用,測試器材,管理費,合計未稅\n";
    const sortedSuccess = [...filteredResults]
      .filter(r => r.status === 'success')
      .sort((a, b) => {
        const catCompare = a.data.category.localeCompare(b.data.category, 'zh-TW');
        if (catCompare !== 0) return catCompare;
        return (a.data.orderId || '').localeCompare(b.data.orderId || '');
      });

    const rows = sortedSuccess.map(r => {
      return `"${r.data.category}","${r.data.orderId}","${r.data.projectName}",${r.data.functionalTestAmount},${r.data.personnelAmount || 0},${r.data.deviceAmount},${r.data.managementFee},${r.data.totalExclTax}`;
    }).join("\n");

    const blob = new Blob([header + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `報價彙整_${new Date().toLocaleDateString()}.csv`;
    a.click();
  };

  // --- 8. Aggregated Comparison Logic ---
  const comparisonResults = useMemo(() => {
    const pdfValid = results.filter(r => r.status === 'success');
    const pdfMap = {};
    const invoiceMap = {};

    pdfValid.forEach(r => {
      const id = (r.data.orderId || '').trim();
      if (!id) return;
      if (!pdfMap[id]) {
        pdfMap[id] = { total: 0, items: [] };
      }
      pdfMap[id].total += moneyNumber(r.data.totalExclTax);
      pdfMap[id].items.push(r);
    });

    invoiceData.forEach(inv => {
      const id = (inv.orderId || '').trim();
      if (!id) return;
      if (!invoiceMap[id]) {
        invoiceMap[id] = { total: 0, items: [] };
      }
      invoiceMap[id].total += inv.amount;
      invoiceMap[id].items.push(inv);
    });

    const allIds = new Set([...Object.keys(pdfMap), ...Object.keys(invoiceMap)]);

    const compData = Array.from(allIds).map(id => {
      const pData = pdfMap[id];
      const iData = invoiceMap[id];

      const pAmt = pData ? pData.total : 0;
      const iAmt = iData ? iData.total : 0;

      const inPdf = !!pData;
      const inInvoice = !!iData;

      const idMatch = inPdf && inInvoice;
      const amtMatch = pAmt === iAmt;
      const overallMatch = idMatch && amtMatch;

      let status = 'match';
      if (!inPdf) status = 'invoice_only';
      else if (!inInvoice) status = 'pdf_only';
      else if (!amtMatch) status = 'amount_mismatch';

      return {
        orderId: id,
        pAmt: pData ? pAmt : null,
        iAmt: iData ? iAmt : null,
        pItems: pData ? pData.items : [],
        iItems: iData ? iData.items : [],
        idMatch,
        amtMatch,
        overallMatch,
        status
      };
    });

    return compData.sort((a, b) => a.orderId.localeCompare(b.orderId));
  }, [results, invoiceData]);

  const filteredCompareResults = useMemo(() => {
    return comparisonResults.filter(item => {
      if (compareFilter === 'match' && item.status !== 'match') return false;
      if (compareFilter === 'mismatch' && item.status !== 'amount_mismatch') return false;
      if (compareFilter === 'pdf_only' && item.status !== 'pdf_only') return false;
      if (compareFilter === 'invoice_only' && item.status !== 'invoice_only') return false;

      if (compareSearch.trim() !== '') {
        const query = compareSearch.toLowerCase();
        const matchesId = item.orderId.toLowerCase().includes(query);
        const matchesPdfName = item.pItems.some(p => p.data.projectName.toLowerCase().includes(query));
        const matchesInvoiceName = item.iItems.some(i => i.projectName.toLowerCase().includes(query));
        return matchesId || matchesPdfName || matchesInvoiceName;
      }

      return true;
    });
  }, [comparisonResults, compareFilter, compareSearch]);

  const compareStats = useMemo(() => {
    const totalCount = comparisonResults.length;
    const matchCount = comparisonResults.filter(c => c.status === 'match').length;
    const mismatchCount = comparisonResults.filter(c => c.status === 'amount_mismatch').length;
    const pdfOnlyCount = comparisonResults.filter(c => c.status === 'pdf_only').length;
    const invoiceOnlyCount = comparisonResults.filter(c => c.status === 'invoice_only').length;
    
    return {
      totalCount,
      matchCount,
      mismatchCount,
      pdfOnlyCount,
      invoiceOnlyCount,
      matchRate: totalCount ? Math.round((matchCount / totalCount) * 100) : 100
    };
  }, [comparisonResults]);

  // --- 9. Acceptance Sheet Summary Logic ---
  const acceptanceData = useMemo(() => buildAcceptanceSummary(results, settings.deptMap), [results, settings.deptMap]);

  // Sync to textareas
  useEffect(() => {
    setEditableOrderIds(acceptanceData.orderIdsText);
    setEditableDetails(acceptanceData.detailsText);
    setEditableDetailsWithoutPrefixes(acceptanceData.detailsWithoutPrefixesText);
  }, [acceptanceData]);

  const copyToClipboard = (text) => {
    try {
      const textArea = document.createElement("textarea");
      textArea.value = text;
      textArea.style.position = "fixed";
      textArea.style.top = "0";
      textArea.style.left = "-9999px";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
    } catch (err) {
      console.error('複製失敗:', err);
      if (navigator.clipboard) {
        navigator.clipboard.writeText(text).catch(e => console.error(e));
      }
    }
  };

  return (
    <div className="app-container">
      {/* Background Glowing Light Blobs */}
      <div className="bg-glow bg-glow-1"></div>
      <div className="bg-glow bg-glow-2"></div>
      <div className="bg-glow bg-glow-3"></div>
      
      {/* Sidebar Navigation */}
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-icon">
            <Scale size={22} />
          </div>
          <span className="brand-name">精準對帳中心</span>
        </div>

        <nav className="nav-links">
          <button 
            onClick={() => setActiveTab('parser')}
            className={`nav-item ${activeTab === 'parser' ? 'active' : ''}`}
          >
            <FileText size={18} />
            PDF 報價單解析
          </button>
          <button 
            onClick={() => setActiveTab('invoice')}
            className={`nav-item ${activeTab === 'invoice' ? 'active' : ''}`}
          >
            <FileSpreadsheet size={18} />
            XLSX 發票載入
          </button>
          <button 
            onClick={() => setActiveTab('compare')}
            className={`nav-item ${activeTab === 'compare' ? 'active' : ''}`}
          >
            <FileCheck size={18} />
            自動比對中心
          </button>
          <button 
            onClick={() => setActiveTab('acceptance')}
            className={`nav-item ${activeTab === 'acceptance' ? 'active' : ''}`}
          >
            <ClipboardCheck size={18} />
            產出驗收總表
          </button>
          <button 
            onClick={() => setActiveTab('settings')}
            className={`nav-item ${activeTab === 'settings' ? 'active' : ''}`}
          >
            <SettingsIcon size={18} />
            系統核心設定
          </button>
        </nav>

        <div className="sidebar-footer">
          <div className={`api-badge ${settings.apiKey ? 'connected' : 'keyless'}`}>
            <span className="api-badge-dot">●</span>
            <span>{settings.apiKey ? 'AI 辨識模式: 已啟動' : '本地解析模式: 免金鑰'}</span>
          </div>
        </div>
      </aside>

      {/* Main Workspace */}
      <main className="main-content">

        {/* --------------------
            TAB 1: PDF PARSER 
           -------------------- */}
        {activeTab === 'parser' && (
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            
            {/* Header */}
            <div className="page-header">
              <div className="page-title">
                <h1>PDF 報價單解析</h1>
                <p>支援本地免 Key 解析 (電子文字 PDF) 與 AI OCR 解析 (掃描檔 PDF)</p>
              </div>
              <div className="header-actions">
                <button 
                  className="btn btn-secondary"
                  onClick={handleAddCustomRow}
                >
                  <Plus size={16} /> 手動新增項目
                </button>
                {results.length > 0 && (
                  <>
                    <button 
                      className="btn btn-danger"
                      onClick={() => window.confirm('確定要清空所有 PDF 解析紀錄嗎？') && setResults([])}
                    >
                      <Trash2 size={16} /> 清空全部
                    </button>
                    <button 
                      className="btn btn-success"
                      onClick={exportToCSV}
                    >
                      <Download size={16} /> 匯出當前報表
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Parse Mode Selector (Tab Buttons) */}
            <div className="mode-selector">
              <button 
                className={`mode-btn ${parseMode === 'local' ? 'active' : ''}`}
                onClick={() => setParseMode('local')}
              >
                <Zap size={14} /> 本地快速解析 (免 API 金鑰)
              </button>
              <button 
                className={`mode-btn ${parseMode === 'ai' ? 'active' : ''}`}
                onClick={() => setParseMode('ai')}
              >
                <Cpu size={14} /> AI OCR 辨識 (需 API 金鑰)
              </button>
            </div>

            {/* Subtle API warning INSIDE tab, only when AI selected and no key */}
            {parseMode === 'ai' && !settings.apiKey && (
              <div className="subtle-alert">
                <AlertCircle size={18} />
                <span className="subtle-alert-text">
                  ⚠️ 當前選擇了「AI OCR 辨識」模式，但尚未設定 Gemini API Key。請先前往「系統設定」設定金鑰，或切換至「本地快速解析」免金鑰運作。
                </span>
              </div>
            )}

            {/* Drag Zone */}
            <div 
              onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => { e.preventDefault(); setIsDragging(false); processFiles(Array.from(e.dataTransfer.files)); }}
              className={`glass-panel dropzone ${isDragging ? 'active' : ''}`}
              style={{ marginBottom: '2.5rem' }}
            >
              <input 
                type="file" 
                multiple 
                accept=".pdf" 
                onChange={(e) => processFiles(Array.from(e.target.files))} 
                className="dropzone-input"
              />
              <div className="dropzone-icon-container">
                <div className="dropzone-glow"></div>
                <UploadCloud size={48} className="dropzone-icon" />
              </div>
              <span className="dropzone-title">拖曳 PDF 報價單檔案至此，或點擊以選擇檔案</span>
              <span className="dropzone-desc">
                {parseMode === 'local' 
                  ? '目前為「本地解析」模式：將以高速文字辨識讀取，適合一般電子檔，完全無須 API 金鑰。'
                  : '目前為「AI OCR」模式：將把 PDF 轉為影像並透過 Gemini 多模態進行高精度視覺辨識，適合掃描件。'
                }
              </span>
            </div>

            {/* OCR Processing Loader */}
            {isProcessing && (
              <div className="glass-panel progress-panel">
                <div className="progress-header">
                  <span className="progress-title">
                    <Loader2 size={18} className="animate-spin text-purple-light" />
                    正在解析報價單：處理第 {progress.current} 頁 / 共 {progress.total} 頁
                  </span>
                  <span className="progress-pct">
                    {Math.round((progress.current / (progress.total || 1)) * 100)}%
                  </span>
                </div>
                <div className="progress-bar-bg">
                  <div 
                    className="progress-bar-fill"
                    style={{ width: `${(progress.current / (progress.total || 1)) * 100}%` }}
                  ></div>
                </div>
              </div>
            )}

            {/* Stats Summary */}
            {results.length > 0 && (
              <div className="stats-grid">
                <div className="glass-panel stat-card">
                  <div className="stat-icon">
                    <List size={20} />
                  </div>
                  <div className="stat-info">
                    <span className="stat-label">總上傳頁數</span>
                    <span className="stat-value">{pdfStats.totalCount} 頁</span>
                  </div>
                </div>
                <div className="glass-panel stat-card">
                  <div className="stat-icon">
                    <CheckCircle2 size={20} />
                  </div>
                  <div className="stat-info">
                    <span className="stat-label">成功解析數</span>
                    <span className="stat-value" style={{ color: 'var(--success)' }}>{pdfStats.successCount} 頁</span>
                  </div>
                </div>
                <div className="glass-panel stat-card">
                  <div className="stat-icon">
                    <Filter size={20} />
                  </div>
                  <div className="stat-info">
                    <span className="stat-label">專案過濾篩選</span>
                    <select
                      value={filterCategory}
                      onChange={(e) => setFilterCategory(e.target.value)}
                      className="table-input"
                      style={{ fontSize: '0.9rem', padding: '0.2rem 0.5rem', width: '130px', marginTop: '0.25rem' }}
                    >
                      {availableCategories.map(cat => (
                        <option key={cat} value={cat}>{cat}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="glass-panel stat-card amount-summary-card">
                  <div className="stat-icon">
                    <BarChart3 size={20} />
                  </div>
                  <div className="stat-info">
                    <span className="stat-label">總計未稅金額</span>
                    <span className="stat-value">$ {formatWithCommas(pdfStats.totalAmount)}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Parsed List Table */}
            {results.length > 0 && (
              <div className="table-container">
                <table className="quotation-table">
                  <thead>
                    <tr>
                      <th style={{ width: '140px' }}>專案分類</th>
                      <th style={{ width: '120px' }}>單號</th>
                      <th style={{ width: '300px' }}>案件名稱</th>
                      <th style={{ textAlign: 'right', width: '130px' }}>功能測試（計時）</th>
                      <th style={{ textAlign: 'right', width: '110px' }}>包人費用</th>
                      <th style={{ textAlign: 'right', width: '110px' }}>測試器材</th>
                      <th style={{ textAlign: 'right', width: '110px' }}>管理費</th>
                      <th style={{ textAlign: 'right', width: '120px' }}>合計未稅</th>
                      <th style={{ textAlign: 'center', width: '80px' }}>狀態</th>
                      <th style={{ textAlign: 'center', width: '80px' }}>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedCategories.map(category => (
                      <React.Fragment key={category}>
                        <tr className="category-header-row">
                          <td colSpan="10">
                            📁 {category} <span style={{ fontSize: '0.8rem', fontWeight: 'normal', color: 'var(--text-muted)' }}>({groupedResults[category].length} 筆)</span>
                          </td>
                        </tr>
                        {groupedResults[category]
                          .sort((a, b) => {
                            if (a.status !== 'success' || b.status !== 'success') return 0;
                            return (a.data.orderId || '').localeCompare(b.data.orderId || '');
                          })
                          .map((item) => (
                            <tr key={item.id}>
                              {/* Category select */}
                              <td>
                                {item.status === 'success' ? (
                                  <select
                                    value={item.data.category}
                                    onChange={(e) => handlePDFFieldChange(item.id, 'category', e.target.value)}
                                    className="table-input"
                                    style={{ padding: '0.2rem' }}
                                  >
                                    {settings.categories.map(c => (
                                      <option key={c} value={c}>{c}</option>
                                    ))}
                                    <option value="其他">其他</option>
                                    <option value="解析失敗">解析失敗</option>
                                  </select>
                                ) : (
                                  <span className="badge badge-danger">失敗</span>
                                )}
                              </td>

                              {/* Order ID */}
                              <td>
                                {item.status === 'success' ? (
                                  <input 
                                    type="text"
                                    value={item.data.orderId}
                                    onChange={(e) => handlePDFFieldChange(item.id, 'orderId', e.target.value)}
                                    className="table-input mono"
                                    placeholder="雙擊以編輯"
                                  />
                                ) : '-'}
                              </td>

                              {/* Case Name / Filename */}
                              <td>
                                {item.status === 'success' ? (
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                                    <input 
                                      type="text"
                                      value={item.data.projectName}
                                      onChange={(e) => handlePDFFieldChange(item.id, 'projectName', e.target.value)}
                                      className="table-input"
                                      style={{ fontWeight: 500 }}
                                    />
                                    {item.hasWarning && (
                                      <div className="warning-text" title={item.warningMsg}>
                                        ⚠️ {item.warningMsg}
                                      </div>
                                    )}
                                  </div>
                                ) : (
                                  <div style={{ color: 'var(--error)', fontSize: '0.85rem' }}>
                                    <strong>{item.fileName}</strong>: {item.errorMsg || '解析異常'}
                                  </div>
                                )}
                              </td>

                              {/* Functional Test */}
                              <td style={{ textAlign: 'right' }}>
                                {item.status === 'success' ? (
                                  <input 
                                    type="text"
                                    value={item.data.functionalTestAmount}
                                    onChange={(e) => handlePDFFieldChange(item.id, 'functionalTestAmount', e.target.value)}
                                    className="table-input number"
                                  />
                                ) : '-'}
                              </td>

                              {/* Personnel Amount */}
                              <td style={{ textAlign: 'right' }}>
                                {item.status === 'success' ? (
                                  <input
                                    type="text"
                                    aria-label="包人費用"
                                    value={item.data.personnelAmount || '0'}
                                    onChange={(e) => handlePDFFieldChange(item.id, 'personnelAmount', e.target.value)}
                                    className="table-input number"
                                  />
                                ) : '-'}
                              </td>

                              {/* Device Amount */}
                              <td style={{ textAlign: 'right' }}>
                                {item.status === 'success' ? (
                                  <input 
                                    type="text"
                                    value={item.data.deviceAmount}
                                    onChange={(e) => handlePDFFieldChange(item.id, 'deviceAmount', e.target.value)}
                                    className="table-input number"
                                  />
                                ) : '-'}
                              </td>

                              {/* Management Fee */}
                              <td style={{ textAlign: 'right' }}>
                                {item.status === 'success' ? (
                                  <input 
                                    type="text"
                                    value={item.data.managementFee}
                                    onChange={(e) => handlePDFFieldChange(item.id, 'managementFee', e.target.value)}
                                    className="table-input number"
                                  />
                                ) : '-'}
                              </td>

                              {/* Total Excl Tax */}
                              <td style={{ textAlign: 'right', fontWeight: 'bold' }}>
                                {item.status === 'success' ? (
                                  <input 
                                    type="text"
                                    value={item.data.totalExclTax}
                                    onChange={(e) => handlePDFFieldChange(item.id, 'totalExclTax', e.target.value)}
                                    className="table-input number"
                                    style={{ color: '#c084fc', fontWeight: 'bold' }}
                                  />
                                ) : '-'}
                              </td>

                              {/* Status Badge */}
                              <td style={{ textAlign: 'center' }}>
                                {item.status === 'success' ? (
                                  item.hasWarning ? (
                                    <span className="badge badge-warning" style={{ padding: '0.2rem 0.5rem', fontSize: '0.7rem' }} title={item.warningMsg}>⚠️ 警告</span>
                                  ) : (
                                    <span className="badge badge-success" style={{ padding: '0.2rem 0.5rem', fontSize: '0.7rem' }}><Check size={10} /> 成功</span>
                                  )
                                ) : (
                                  <span className="badge badge-danger" style={{ padding: '0.2rem 0.5rem', fontSize: '0.7rem' }}>失敗</span>
                                )}
                              </td>

                              {/* Actions */}
                              <td style={{ textAlign: 'center' }}>
                                <button 
                                  className="btn btn-secondary"
                                  onClick={() => handleDeletePDFItem(item.id)}
                                  style={{ padding: '0.4rem', borderRadius: '0.5rem' }}
                                  title="刪除此列"
                                >
                                  <Trash2 size={14} className="text-error" />
                                </button>
                              </td>
                            </tr>
                          ))}
                      </React.Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* --------------------
            TAB 2: INVOICE LOAD 
           -------------------- */}
        {activeTab === 'invoice' && (
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            
            {/* Header */}
            <div className="page-header">
              <div className="page-title">
                <h1>Excel 發票載入</h1>
                <p>匯入財務開立之發票明細（支援智慧模糊對照，相容客製格式 Excel）</p>
              </div>
              <div className="header-actions">
                <button 
                  className="btn btn-secondary"
                  onClick={handleAddCustomInvoiceRow}
                >
                  <Plus size={16} /> 手動新增發票
                </button>
                {invoiceData.length > 0 && (
                  <button 
                    className="btn btn-danger"
                    onClick={() => window.confirm('確定要清空所有發票明細嗎？') && { ...setInvoiceData([]), ...setInvoiceTotal(0) }}
                  >
                    <Trash2 size={16} /> 清空全部
                  </button>
                )}
              </div>
            </div>

            {/* Drag Zone */}
            <div 
              className="glass-panel dropzone" 
              style={{ marginBottom: '2.5rem', borderColor: 'rgba(59, 130, 246, 0.2)' }}
            >
              <input 
                type="file" 
                accept=".xlsx, .xls, .csv" 
                onChange={handleExcelUpload} 
                className="dropzone-input"
              />
              <div className="dropzone-icon-container">
                <div className="dropzone-glow" style={{ background: 'var(--secondary-glow)' }}></div>
                <FileSpreadsheet size={48} className="dropzone-icon text-secondary" style={{ color: 'var(--secondary)' }} />
              </div>
              <span className="dropzone-title">拖曳 Excel 發票明細至此，或點擊以選擇檔案</span>
              <span className="dropzone-desc">支援隨機表頭。當系統無法辨識時，將彈出對照介面引導對接</span>
            </div>

            {/* Stats Summary */}
            {invoiceData.length > 0 && (
              <div className="stats-grid">
                <div className="glass-panel stat-card">
                  <div className="stat-icon" style={{ color: 'var(--secondary)', background: 'rgba(59, 130, 246, 0.08)', borderColor: 'rgba(59, 130, 246, 0.15)' }}>
                    <List size={22} />
                  </div>
                  <div className="stat-info">
                    <span className="stat-label">載入筆數</span>
                    <span className="stat-value">{invoiceData.length} 筆</span>
                  </div>
                </div>
                <div className="glass-panel stat-card amount-summary-card" style={{ background: 'linear-gradient(135deg, rgba(59, 130, 246, 0.12) 0%, rgba(16, 185, 129, 0.08) 100%)', borderColor: 'rgba(59, 130, 246, 0.2)', boxShadow: '0 4px 30px rgba(59, 130, 246, 0.15)' }}>
                  <div className="stat-icon" style={{ background: 'rgba(255, 255, 255, 0.08)', color: 'var(--text-bright)' }}>
                    <BarChart3 size={22} />
                  </div>
                  <div className="stat-info">
                    <span className="stat-label">發票未稅總額</span>
                    <span className="stat-value">$ {formatWithCommas(invoiceTotal)}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Loaded Data Table */}
            {invoiceData.length > 0 && (
              <div className="table-container">
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: '180px' }}>單號</th>
                      <th>發票案件名稱</th>
                      <th style={{ textAlign: 'right', width: '180px' }}>金額 (未稅)</th>
                      <th style={{ textAlign: 'center', width: '100px' }}>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invoiceData.map((item) => (
                      <tr key={item.id}>
                        {/* Order ID */}
                        <td>
                          <input
                            type="text"
                            value={item.orderId}
                            onChange={(e) => handleInvoiceFieldChange(item.id, 'orderId', e.target.value)}
                            className="table-input mono"
                            placeholder="雙擊以填寫"
                          />
                        </td>

                        {/* Project Name */}
                        <td>
                          <input
                            type="text"
                            value={item.projectName}
                            onChange={(e) => handleInvoiceFieldChange(item.id, 'projectName', e.target.value)}
                            className="table-input"
                            style={{ fontWeight: 500 }}
                          />
                        </td>

                        {/* Amount */}
                        <td style={{ textAlign: 'right' }}>
                          <input
                            type="text"
                            value={item.amount}
                            onChange={(e) => handleInvoiceFieldChange(item.id, 'amount', e.target.value)}
                            className="table-input number"
                            style={{ fontWeight: 'bold', color: '#60a5fa' }}
                          />
                        </td>

                        {/* Actions */}
                        <td style={{ textAlign: 'center' }}>
                          <button
                            className="btn btn-secondary"
                            onClick={() => handleDeleteInvoiceItem(item.id)}
                            style={{ padding: '0.4rem', borderRadius: '0.5rem' }}
                          >
                            <Trash2 size={14} className="text-error" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* --------------------
            TAB 3: COMPARE CENTER
           -------------------- */}
        {activeTab === 'compare' && (
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            
            {/* Header */}
            <div className="page-header">
              <div className="page-title">
                <h1>自動比對檢驗中心</h1>
                <p>將報價單與發票以「單號」自動加總分組，比對雙側金額是否相符</p>
              </div>
            </div>

            {/* Check Empty State */}
            {comparisonResults.length === 0 ? (
              <div className="glass-panel" style={{ padding: '4rem 2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                <Scale size={64} style={{ marginBottom: '1.5rem', color: 'rgba(255,255,255,0.1)' }} />
                <h3>尚無比對資料</h3>
                <p style={{ marginTop: '0.5rem' }}>請先至「PDF 報價單解析」與「Excel 發票載入」上傳資料進行查驗</p>
              </div>
            ) : (
              <>
                {/* Stats cards */}
                <div className="stats-grid" style={{ marginBottom: '2rem' }}>
                  <div className="glass-panel stat-card">
                    <div className="stat-icon">
                      <Scale size={22} />
                    </div>
                    <div className="stat-info">
                      <span className="stat-label">比對總單據數</span>
                      <span className="stat-value">{compareStats.totalCount} 筆</span>
                    </div>
                  </div>
                  <div className="glass-panel stat-card">
                    <div className="stat-icon" style={{ color: 'var(--success)', background: 'rgba(16, 185, 129, 0.08)' }}>
                      <CheckCircle2 size={22} />
                    </div>
                    <div className="stat-info">
                      <span className="stat-label">完全相符數</span>
                      <span className="stat-value" style={{ color: 'var(--success)' }}>
                        {compareStats.matchCount} <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>({compareStats.matchRate}%)</span>
                      </span>
                    </div>
                  </div>
                  <div className="glass-panel stat-card">
                    <div className="stat-icon" style={{ color: 'var(--error)', background: 'rgba(239, 68, 68, 0.08)' }}>
                      <AlertCircle size={22} />
                    </div>
                    <div className="stat-info">
                      <span className="stat-label">金額或單號異常</span>
                      <span className="stat-value" style={{ color: 'var(--error)' }}>
                        {compareStats.mismatchCount + compareStats.pdfOnlyCount + compareStats.invoiceOnlyCount} 筆
                      </span>
                    </div>
                  </div>
                </div>

                {/* Filters toolbar */}
                <div className="table-toolbar">
                  <div className="search-input-wrapper">
                    <Search size={16} className="search-icon" />
                    <input
                      type="text"
                      className="search-input"
                      placeholder="搜尋單號或案件名稱..."
                      value={compareSearch}
                      onChange={(e) => setCompareSearch(e.target.value)}
                    />
                  </div>

                  <div className="toolbar-filters">
                    <button 
                      className={`filter-btn ${compareFilter === 'all' ? 'active' : ''}`}
                      onClick={() => setCompareFilter('all')}
                    >
                      全部 ({compareStats.totalCount})
                    </button>
                    <button 
                      className={`filter-btn ${compareFilter === 'match' ? 'active' : ''}`}
                      onClick={() => setCompareFilter('match')}
                    >
                      相符 ({compareStats.matchCount})
                    </button>
                    <button 
                      className={`filter-btn ${compareFilter === 'mismatch' ? 'active' : ''}`}
                      onClick={() => setCompareFilter('mismatch')}
                    >
                      不符 ({compareStats.mismatchCount})
                    </button>
                    <button 
                      className={`filter-btn ${compareFilter === 'pdf_only' ? 'active' : ''}`}
                      onClick={() => setCompareFilter('pdf_only')}
                    >
                      僅報價單 ({compareStats.pdfOnlyCount})
                    </button>
                    <button 
                      className={`filter-btn ${compareFilter === 'invoice_only' ? 'active' : ''}`}
                      onClick={() => setCompareFilter('invoice_only')}
                    >
                      僅發票 ({compareStats.invoiceOnlyCount})
                    </button>
                  </div>
                </div>

                {/* Compare Results Table */}
                <div className="table-container">
                  <table>
                    <thead>
                      <tr>
                        <th style={{ width: '120px' }}>單號</th>
                        <th>報價單代表專案 (PDF)</th>
                        <th>發票代表專案 (Excel)</th>
                        <th style={{ textAlign: 'right', width: '150px' }}>報價單加總 (未稅)</th>
                        <th style={{ textAlign: 'right', width: '150px' }}>發票金額 (未稅)</th>
                        <th style={{ textAlign: 'center', width: '130px' }}>狀態</th>
                        <th style={{ textAlign: 'center', width: '90px' }}>展開對照</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredCompareResults.length === 0 ? (
                        <tr>
                          <td colSpan="7" style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '2rem' }}>
                            沒有符合搜尋條件的單號
                          </td>
                        </tr>
                      ) : (
                        filteredCompareResults.map((item) => {
                          const isExpanded = expandedOrderId === item.orderId;
                          
                          const pdfName = item.pItems[0]?.data.projectName || '-';
                          const invName = item.iItems[0]?.projectName || '-';

                          return (
                            <React.Fragment key={item.orderId}>
                              <tr 
                                className="compare-row"
                                onClick={() => setExpandedOrderId(isExpanded ? null : item.orderId)}
                                style={{
                                  background: item.status !== 'match' ? 'rgba(239, 68, 68, 0.015)' : 'transparent',
                                  borderLeft: `4px solid ${
                                    item.status === 'match' ? 'transparent' :
                                    item.status === 'amount_mismatch' ? 'var(--warning)' : 'var(--error)'
                                  }`
                                }}
                              >
                                {/* Order ID */}
                                <td className="mono" style={{ fontWeight: 700, color: 'var(--purple-light)' }}>{item.orderId}</td>

                                {/* PDF Case Represent */}
                                <td style={{ color: item.pItems.length === 0 ? 'var(--text-muted)' : 'var(--text-bright)' }}>
                                  {pdfName} {item.pItems.length > 1 && <span className="badge badge-secondary" style={{ padding: '0.1rem 0.4rem', fontSize: '0.7rem' }}>共 {item.pItems.length} 頁</span>}
                                </td>

                                {/* Invoice Represent */}
                                <td style={{ color: item.iItems.length === 0 ? 'var(--text-muted)' : 'var(--text-bright)' }}>
                                  {invName} {item.iItems.length > 1 && <span className="badge badge-secondary" style={{ padding: '0.1rem 0.4rem', fontSize: '0.7rem' }}>共 {item.iItems.length} 筆</span>}
                                </td>

                                {/* PDF Total Amount */}
                                <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                                  {item.pAmt !== null ? `$ ${formatWithCommas(item.pAmt)}` : '-'}
                                </td>

                                {/* Invoice Total Amount */}
                                <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}>
                                  {item.iAmt !== null ? `$ ${formatWithCommas(item.iAmt)}` : '-'}
                                </td>

                                {/* Status Badge */}
                                <td style={{ textAlign: 'center' }}>
                                  {item.status === 'match' && (
                                    <span className="badge badge-success">金額相符</span>
                                  )}
                                  {item.status === 'amount_mismatch' && (
                                    <span className="badge badge-danger">金額不符</span>
                                  )}
                                  {item.status === 'pdf_only' && (
                                    <span className="badge badge-primary">僅報價單</span>
                                  )}
                                  {item.status === 'invoice_only' && (
                                    <span className="badge badge-secondary">僅發票</span>
                                  )}
                                </td>

                                {/* Expand Button */}
                                <td style={{ textAlign: 'center' }}>
                                  <button 
                                    className="btn btn-secondary"
                                    style={{ padding: '0.35rem', borderRadius: '0.5rem' }}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setExpandedOrderId(isExpanded ? null : item.orderId);
                                    }}
                                  >
                                    {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                  </button>
                                </td>
                              </tr>

                              {/* Drilldown details row */}
                              {isExpanded && (
                                <tr>
                                  <td colSpan="7" className="compare-details-cell">
                                    <div className="drilldown-container animate-in fade-in slide-in-from-top-1 duration-200">
                                      
                                      {/* PDF Breakdown */}
                                      <div className="drilldown-pane">
                                        <div className="drilldown-pane-title pdf">
                                          <FileText size={14} />
                                          <span>報價單明細加總 (PDF)</span>
                                        </div>
                                        <div className="drilldown-list">
                                          {item.pItems.length === 0 ? (
                                            <div className="drilldown-empty">報價單中無此單號資料</div>
                                          ) : (
                                            item.pItems.map((p, idx) => (
                                              <div className="drilldown-item" key={p.id || idx}>
                                                <div>
                                                  <div className="drilldown-item-name">{p.data.projectName}</div>
                                                  <div className="drilldown-item-meta">{p.fileName} | {p.data.category}</div>
                                                  <div className="drilldown-item-meta">
                                                    功能測試（計時） $ {formatWithCommas(p.data.functionalTestAmount)} · 包人費用 $ {formatWithCommas(p.data.personnelAmount || 0)}<br />
                                                    測試器材 $ {formatWithCommas(p.data.deviceAmount)} · 管理費 $ {formatWithCommas(p.data.managementFee)}
                                                  </div>
                                                </div>
                                                <div className="drilldown-item-val">$ {formatWithCommas(p.data.totalExclTax)}</div>
                                              </div>
                                            ))
                                          )}
                                        </div>
                                      </div>

                                      {/* Invoice Breakdown */}
                                      <div className="drilldown-pane">
                                        <div className="drilldown-pane-title invoice">
                                          <FileSpreadsheet size={14} />
                                          <span>發票明細加總 (Excel)</span>
                                        </div>
                                        <div className="drilldown-list">
                                          {item.iItems.length === 0 ? (
                                            <div className="drilldown-empty">發票資料中無此單號資料</div>
                                          ) : (
                                            item.iItems.map((i, idx) => (
                                              <div className="drilldown-item" key={i.id || idx}>
                                                <div>
                                                  <div className="drilldown-item-name">{i.projectName}</div>
                                                </div>
                                                <div className="drilldown-item-val">$ {formatWithCommas(i.amount)}</div>
                                              </div>
                                            ))
                                          )}
                                        </div>
                                      </div>

                                    </div>
                                  </td>
                                </tr>
                              )}
                            </React.Fragment>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}

        {/* --------------------
            TAB 4: ACCEPTANCE SHEET
           -------------------- */}
        {activeTab === 'acceptance' && (
          <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
            
            {/* Header */}
            <div className="page-header">
              <div className="page-title">
                <h1>報價單驗收總表</h1>
                <p>自動按部門對照歸類，產生驗收表所需的單號與明細總整理</p>
              </div>
            </div>

            {results.filter(r => r.status === 'success').length === 0 ? (
              <div className="glass-panel" style={{ padding: '4rem 2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                <ClipboardCheck size={64} style={{ marginBottom: '1.5rem', color: 'rgba(255,255,255,0.1)' }} />
                <h3>尚無報價單解析資料</h3>
                <p style={{ marginTop: '0.5rem' }}>請先至「PDF 報價單解析」匯入報價單，以產出驗收報告。</p>
              </div>
            ) : (
              <div className="glass-panel acceptance-card">
                
                {/* 1. Order ids overview */}
                <div className="acceptance-block">
                  <div className="acceptance-block-title">
                    <span>1. 專案單號總覽 (已依部門排序)</span>
                    <button 
                      className={`btn ${copiedOrders ? 'btn-success' : 'btn-secondary'}`}
                      style={{ padding: '0.4rem 1rem', fontSize: '0.8rem', gap: '0.3rem' }}
                      onClick={() => {
                        copyToClipboard(editableOrderIds);
                        setCopiedOrders(true);
                        setTimeout(() => setCopiedOrders(false), 2000);
                      }}
                    >
                      {copiedOrders ? <Check size={14} /> : null}
                      {copiedOrders ? '已複製！' : '複製單號'}
                    </button>
                  </div>
                  <textarea
                    ref={orderIdsRef}
                    value={editableOrderIds}
                    onChange={(e) => setEditableOrderIds(e.target.value)}
                    className="acceptance-textarea"
                    placeholder="無單號資料"
                  />
                </div>

                {/* 2. Details and Amount totals */}
                <div className="acceptance-block">
                  <div className="acceptance-block-title">
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                      <span>2. 費用金額總結</span>
                      <button
                        className="btn btn-secondary"
                        style={{ padding: '0.4rem 0.75rem', fontSize: '0.8rem' }}
                        aria-pressed={hideProjectPrefixes}
                        onClick={() => {
                          setHideProjectPrefixes(hidden => !hidden);
                          setCopiedDetails(false);
                        }}
                      >
                        {hideProjectPrefixes ? '顯示專案前綴' : '隱藏專案前綴'}
                      </button>
                      <span className="badge badge-primary" style={{ padding: '0.4rem 1rem', fontSize: '0.9rem' }}>
                        全部總計: $ {formatWithCommas(acceptanceData.overallTotal)}
                      </span>
                    </div>
                    <button 
                      className={`btn ${copiedDetails ? 'btn-success' : 'btn-secondary'}`}
                      style={{ padding: '0.4rem 1rem', fontSize: '0.8rem', gap: '0.3rem' }}
                      onClick={() => {
                        copyToClipboard(displayedDetails);
                        setCopiedDetails(true);
                        setTimeout(() => setCopiedDetails(false), 2000);
                      }}
                    >
                      {copiedDetails ? <Check size={14} /> : null}
                      {copiedDetails ? '已複製！' : '複製明細'}
                    </button>
                  </div>
                  <div className="acceptance-subtotals" aria-label="各專案未稅小計">
                    {acceptanceData.groups.map(group => (
                      <div className="acceptance-subtotal" key={group.category}>
                        <span>【{group.dept}】{group.category}</span>
                        <strong>$ {formatWithCommas(group.totalAmount)}</strong>
                      </div>
                    ))}
                  </div>
                  <textarea
                    aria-label="驗收明細與總計"
                    ref={detailsRef}
                    value={displayedDetails}
                    onChange={(e) => (hideProjectPrefixes ? setEditableDetailsWithoutPrefixes : setEditableDetails)(e.target.value)}
                    className="acceptance-textarea details"
                    placeholder="無明細資料"
                  />
                </div>

              </div>
            )}
          </div>
        )}

        {/* --------------------
            TAB 5: SYSTEM SETTINGS
           -------------------- */}
        {activeTab === 'settings' && (
          <SettingsPanel 
            settings={settings}
            onSaveSettings={handleSaveSettings}
          />
        )}

      </main>

      {/* --------------------
          COLUMN MAPPER MODAL
         -------------------- */}
      {showMapper && mapperData && (
        <ColumnMapperModal
          headers={mapperData.headers}
          previewRows={mapperData.previewRows}
          onConfirm={handleMapperConfirm}
          onClose={() => {
            setShowMapper(false);
            setMapperData(null);
          }}
        />
      )}

    </div>
  );
};

export default App;
