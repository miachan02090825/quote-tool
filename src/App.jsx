import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  FileText, Loader2, CheckCircle2, AlertCircle, Download, UploadCloud, 
  BarChart3, Filter, FileSpreadsheet, List, FileCheck, Scale, 
  ClipboardCheck, Trash2, Settings as SettingsIcon, Search, 
  ChevronDown, ChevronUp, Plus, Check, HelpCircle, Edit, Cpu, Zap
} from 'lucide-react';
import SettingsPanel from './components/SettingsPanel';
import ColumnMapperModal from './components/ColumnMapperModal';

const DEFAULT_CATEGORIES = [
  "滿貫大亨Web館", "網頁組", "明星3缺1", "滿貫大亨", 
  "競技麻將2", "唯舞獨尊", "玩星派對", "social casino"
];

const DEFAULT_DEPT_MAP = {
  '明星3缺1': '研五',
  '競技麻將2': '研五',
  'social casino': '研五',
  '滿貫大亨': '研二',
  '滿貫大亨Web館': '研二',
  '玩星派對': '研三',
  '唯舞獨尊': '研三'
};

const App = () => {
  // --- Tab & Lib state ---
  const [activeTab, setActiveTab] = useState('parser'); // 'parser' | 'invoice' | 'compare' | 'acceptance' | 'settings'
  const [libsLoaded, setLibsLoaded] = useState({ pdf: false, xlsx: false });

  // --- Settings state ---
  const [settings, setSettings] = useState(() => {
    const saved = localStorage.getItem('invoice_tool_settings');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return {
          apiKey: parsed.apiKey || '',
          modelName: parsed.modelName || 'gemini-3.5-flash',
          categories: parsed.categories || DEFAULT_CATEGORIES,
          deptMap: parsed.deptMap || DEFAULT_DEPT_MAP
        };
      } catch (e) {
        console.error('Error parsing saved settings', e);
      }
    }
    return {
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

  // Auto-resize textarea heights
  useEffect(() => {
    if (activeTab === 'acceptance') {
      if (orderIdsRef.current) {
        orderIdsRef.current.style.height = 'auto';
        orderIdsRef.current.style.height = `${orderIdsRef.current.scrollHeight}px`;
      }
      if (detailsRef.current) {
        detailsRef.current.style.height = 'auto';
        detailsRef.current.style.height = `${detailsRef.current.scrollHeight}px`;
      }
    }
  }, [editableOrderIds, editableDetails, activeTab]);

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
    2. orderId: 提取該 6 位純數字。絕對禁止抓取 T 開頭的編號。
    3. projectName: 提取冒號後的文字。特別注意：
       - 若名稱跨行（如「品\\n檢測試」），請將其無縫合併為單一字串（「品檢測試」）。
       - 必須略過並移除名稱結尾的「功能測試」或「測試器材」。
    4. category: 對比 projectName 從 [${settings.categories.join(", ")}] 擇一，不符填"其他"。
       - 【重要】若專案名稱中包含 "VF" 或 "vf"，請一律填寫為 "social casino"。
    5. 金額欄位：提取純數字。若圖中找不到該項目，請填 "0"。
       - functionalTestAmount: 功能測試金額
       - deviceAmount: 測試器材金額
       - managementFee: 管理費金額
       - totalExclTax: 合計未稅
    
    【輸出格式】
    {
      "orderId": "string",
      "projectName": "string",
      "category": "string",
      "functionalTestAmount": "string",
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
    const cleanVal = (v) => {
      if (v === undefined || v === null) return '0';
      const s = v.toString().replace(/[.,元 ]/g, '').replace(/[^\d]/g, '');
      return s || '0';
    };

    const extractNumber = (text, excludeId) => {
      const regex = /\b\d{1,3}(?:,\d{3})*(?:\.\d+)?\b/g;
      let matches = [...text.matchAll(regex)].map(m => m[0].replace(/,/g, ''));
      if (excludeId) {
        matches = matches.filter(m => m !== excludeId);
      }
      if (matches.length === 0) {
        const digits = text.replace(/[^\d]/g, '');
        return digits || '0';
      }
      
      const numbers = matches.map(m => parseInt(m, 10)).filter(n => !isNaN(n));
      if (numbers.length === 0) return '0';
      
      let chosen = numbers[numbers.length - 1];
      if (chosen <= 10 && numbers.length > 1) {
        const larger = numbers.slice(0, -1).reverse().find(n => n > 100);
        if (larger !== undefined) {
          chosen = larger;
        }
      }
      return chosen.toString();
    };

    const generateId = () => Math.random().toString(36).substring(2, 15);

    const makeFlexRegex = (keyword) => {
      const chars = keyword.split('').map(c => c.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&'));
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

    const cleanProjectNameCandidate = (line, orderId) => {
      let s = line;
      if (orderId) {
        const escapedId = orderId.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        s = s.replace(new RegExp(escapedId, 'gi'), '');
      }
      // Remove numbers
      s = s.replace(/\b\d{1,3}(?:,\d{3})*(?:\.\d+)?\b/g, '');
      s = s.replace(/\d+/g, '');
      
      // Remove keywords
      const wordsToRemove = [
        '功能測試', '測試器材', '管理費', '行政費', '服務費', '合計', '未稅', '總計', '小計',
        '品名', '專案名稱', '專案管理', '專案', '案件名稱', '案名', '單號', '報價', '聯絡人', '電話'
      ];
      for (const w of wordsToRemove) {
        s = s.replace(makeFlexRegex(w), '');
      }
      
      s = s.replace(/[：:_\-–—\/\\*()（）\[\]「」{}|,\.\s]+/g, ' ').trim();
      return s;
    };

    const compressSpaces = (str) => {
      let s = str.replace(/(?<=[\u4e00-\u9fa5])\s+(?=[\u4e00-\u9fa5])/g, '');
      s = s.replace(/(?<=[\u4e00-\u9fa5])\s+(?=\d)/g, '');
      s = s.replace(/(?<=\d)\s+(?=[\u4e00-\u9fa5])/g, '');
      s = s.replace(/\s+/g, ' ');
      return s.trim();
    };

    const extractAmountWithNeighbors = (line, lineIdx, cleanLines, orderId) => {
      let amt = extractNumber(line, orderId);
      if (parseInt(amt, 10) === 0) {
        // Check line above
        if (lineIdx > 0) {
          const prevLine = cleanLines[lineIdx - 1];
          const prevClean = prevLine.replace(/\s+/g, '');
          const isMeta = METADATA_KEYWORDS.some(kw => makeFlexRegex(kw).test(prevLine));
          const isAnotherKeyword = [
            '功能測試', '功能', '測試器材', '器材', '設備', '租借', 
            '管理費', '行政', '服務費', '合計', '未稅', '總計', '小計'
          ].some(kw => makeFlexRegex(kw).test(prevClean));
          
          if (!isMeta && !isAnotherKeyword) {
            const candidateAmt = extractNumber(prevLine, orderId);
            if (parseInt(candidateAmt, 10) > 0) {
              amt = candidateAmt;
            }
          }
        }
        // Check line below
        if (parseInt(amt, 10) === 0 && lineIdx < cleanLines.length - 1) {
          const nextLine = cleanLines[lineIdx + 1];
          const nextClean = nextLine.replace(/\s+/g, '');
          const isMeta = METADATA_KEYWORDS.some(kw => makeFlexRegex(kw).test(nextLine));
          const isAnotherKeyword = [
            '功能測試', '功能', '測試器材', '器材', '設備', '租借', 
            '管理費', '行政', '服務費', '合計', '未稅', '總計', '小計'
          ].some(kw => makeFlexRegex(kw).test(nextClean));
          
          if (!isMeta && !isAnotherKeyword) {
            const candidateAmt = extractNumber(nextLine, orderId);
            if (parseInt(candidateAmt, 10) > 0) {
              amt = candidateAmt;
            }
          }
        }
      }
      return amt;
    };

    for (let fIdx = 0; fIdx < pdfFiles.length; fIdx++) {
      const file = pdfFiles[fIdx];
      try {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        
        for (let pageIdx = 1; pageIdx <= pdf.numPages; pageIdx++) {
          const page = await pdf.getPage(pageIdx);
          const textContent = await page.getTextContent();
          const items = textContent.items;

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
          const lines = sortedY.map(y => {
            const lineItems = linesMap[y].sort((a, b) => a.transform[4] - b.transform[4]);
            return lineItems.map(item => item.str).join(' ');
          });

          const cleanLines = lines.map(l => l.trim()).filter(Boolean);

          let orderId = '';
          let projectName = '';
          let functionalTestAmount = '0';
          let deviceAmount = '0';
          let managementFee = '0';
          let totalExclTax = '0';

          // Heuristic 1: Extract Order ID (ONLY 6-digit pure numbers, exclude years)
          let matchedLineIdx = -1;
          for (let i = 0; i < cleanLines.length; i++) {
            const line = cleanLines[i];
            const orderIdMatch = line.match(/\b\d{6}\b/);
            if (orderIdMatch) {
              const idCandidate = orderIdMatch[0];
              const isYear = idCandidate.startsWith('202') || idCandidate.startsWith('199');
              if (!isYear) {
                orderId = idCandidate;
                matchedLineIdx = i;
                break;
              }
            }
          }

          // Heuristic 2: Extract Project Name
          // Pass 1: Look for lines with project keywords
          for (const line of cleanLines) {
            const isMeta = METADATA_KEYWORDS.some(kw => makeFlexRegex(kw).test(line));
            if (isMeta) continue;
            
            const matchedKw = projectKeywords.find(kw => makeFlexRegex(kw).test(line));
            if (matchedKw) {
              const regex = makeFlexRegex(matchedKw);
              const match = line.match(regex);
              if (match) {
                const idx = match.index + match[0].length;
                let candidate = line.substring(idx).trim();
                candidate = cleanProjectNameCandidate(candidate, orderId);
                candidate = compressSpaces(candidate);
                if (candidate && candidate.length > 2) {
                  projectName = candidate;
                  break;
                }
              }
            }
          }

          // Pass 2: Fallback - scan all lines for the first line that yields a valid project name
          if (!projectName) {
            for (const line of cleanLines) {
              const isMeta = METADATA_KEYWORDS.some(kw => makeFlexRegex(kw).test(line));
              if (isMeta) continue;
              
              let candidate = cleanProjectNameCandidate(line, orderId);
              candidate = compressSpaces(candidate);
              if (candidate && candidate.length > 2) {
                projectName = candidate;
                break;
              }
            }
          }

          // Heuristic 3: Extract amounts
          for (let i = 0; i < cleanLines.length; i++) {
            const line = cleanLines[i];
            // Skip general metadata header lines to avoid extracting dates as amounts
            const isMeta = METADATA_KEYWORDS.some(kw => makeFlexRegex(kw).test(line));
            if (isMeta) continue;

            const cleanLine = line.replace(/\s+/g, '');

            if (makeFlexRegex('功能測試').test(cleanLine) || makeFlexRegex('功能').test(cleanLine)) {
              const amt = extractAmountWithNeighbors(line, i, cleanLines, orderId);
              if (parseInt(amt, 10) > 0) {
                functionalTestAmount = amt;
              }
            }
            if (makeFlexRegex('測試器材').test(cleanLine) || makeFlexRegex('器材').test(cleanLine) || makeFlexRegex('設備').test(cleanLine) || makeFlexRegex('租借').test(cleanLine)) {
              const amt = extractAmountWithNeighbors(line, i, cleanLines, orderId);
              if (parseInt(amt, 10) > 0) {
                deviceAmount = amt;
              }
            }
            if (makeFlexRegex('管理費').test(cleanLine) || makeFlexRegex('行政').test(cleanLine) || makeFlexRegex('服務費').test(cleanLine)) {
              const amt = extractAmountWithNeighbors(line, i, cleanLines, orderId);
              if (parseInt(amt, 10) > 0) {
                managementFee = amt;
              }
            }
            if ((makeFlexRegex('合計').test(cleanLine) || makeFlexRegex('未稅').test(cleanLine) || makeFlexRegex('總計').test(cleanLine) || makeFlexRegex('小計').test(cleanLine)) && !makeFlexRegex('金額').test(cleanLine)) {
              const amt = extractAmountWithNeighbors(line, i, cleanLines, orderId);
              if (parseInt(amt, 10) > 0) {
                totalExclTax = amt;
              }
            }
          }

          // Recalculate total if parts found but total not explicitly matched
          if (parseInt(totalExclTax, 10) === 0) {
            const f = parseInt(functionalTestAmount, 10) || 0;
            const d = parseInt(deviceAmount, 10) || 0;
            const m = parseInt(managementFee, 10) || 0;
            totalExclTax = (f + d + m).toString();
          }

          // Clean project name suffix
          let finalProjectName = projectName
            .replace(/T\d{7,11}/g, "")
            .replace(/(功能測試|測試器材)$/, "")
            .trim();

          // Assign category
          let category = '其他';
          for (const cat of settings.categories) {
            const cleanProj = finalProjectName.replace(/\s+/g, '');
            const cleanCat = cat.replace(/\s+/g, '');
            if (cleanProj.includes(cleanCat)) {
              category = cat;
              break;
            }
          }
          if (finalProjectName.toUpperCase().includes('VF')) {
            category = 'social casino';
          }

          const hasText = items.length > 0;
          const hasParsedFields = orderId || parseInt(totalExclTax, 10) > 0;

          setResults(prev => [...prev, {
            id: generateId(),
            fileName: `${file.name} (P${pageIdx})`,
            status: 'success',
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
              functionalTestAmount: cleanVal(functionalTestAmount),
              deviceAmount: cleanVal(deviceAmount),
              managementFee: cleanVal(managementFee),
              totalExclTax: cleanVal(totalExclTax)
            }
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

    const cleanVal = (v) => {
      if (v === undefined || v === null) return '0';
      const s = v.toString().replace(/[.,元 ]/g, '').replace(/[^\d]/g, '');
      return s || '0';
    };

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
            
            let finalProjectName = (data.projectName || "")
              .replace(/T\d{7,11}/g, "")
              .replace(/\n|\r/g, "")
              .replace(/(功能測試|測試器材)$/, "")
              .trim();

            let finalCategory = data.category;
            if (finalProjectName.toUpperCase().includes("VF")) {
              finalCategory = "social casino";
            }

            setResults(prev => [...prev, {
              id: generateId(),
              fileName: `${task.fileName} (P${task.pageIdx})`,
              status: 'success',
              data: {
                ...data,
                category: finalCategory,
                projectName: finalProjectName,
                functionalTestAmount: cleanVal(data.functionalTestAmount),
                deviceAmount: cleanVal(data.deviceAmount),
                managementFee: cleanVal(data.managementFee),
                totalExclTax: cleanVal(data.totalExclTax)
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
    setSettings(newSettings);
    localStorage.setItem('invoice_tool_settings', JSON.stringify(newSettings));
  };

  const handlePDFFieldChange = (id, field, value) => {
    setResults(prev => prev.map(item => {
      if (item.id === id) {
        const newData = { ...item.data, [field]: value };
        if (field === 'functionalTestAmount' || field === 'deviceAmount' || field === 'managementFee') {
          const fAmt = parseInt(newData.functionalTestAmount || 0, 10) || 0;
          const dAmt = parseInt(newData.deviceAmount || 0, 10) || 0;
          const mAmt = parseInt(newData.managementFee || 0, 10) || 0;
          newData.totalExclTax = (fAmt + dAmt + mAmt).toString();
        }
        return { ...item, data: newData };
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
    const val = typeof num === 'string' ? parseInt(num, 10) : num;
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
    const totalAmount = successItems.reduce((sum, r) => sum + (parseInt(r.data.totalExclTax, 10) || 0), 0);
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
    const header = "\uFEFF專案分類,單號,案件名稱,功能測試,測試器材,管理費,合計未稅\n";
    const sortedSuccess = [...filteredResults]
      .filter(r => r.status === 'success')
      .sort((a, b) => {
        const catCompare = a.data.category.localeCompare(b.data.category, 'zh-TW');
        if (catCompare !== 0) return catCompare;
        return (a.data.orderId || '').localeCompare(b.data.orderId || '');
      });

    const rows = sortedSuccess.map(r => {
      return `"${r.data.category}","${r.data.orderId}","${r.data.projectName}",${r.data.functionalTestAmount},${r.data.deviceAmount},${r.data.managementFee},${r.data.totalExclTax}`;
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
      pdfMap[id].total += parseInt(r.data.totalExclTax || 0, 10);
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
  const acceptanceData = useMemo(() => {
    const validResults = results.filter(r => r.status === 'success');
    const deptOrder = { '研五': 1, '研二': 2, '研三': 3, '其他': 4 };
    let overallTotal = 0;

    const grouped = validResults.reduce((acc, curr) => {
      const cat = curr.data.category;
      const dept = settings.deptMap[cat] || '其他';
      
      if (!acc[cat]) {
        acc[cat] = {
          dept,
          category: cat,
          orderIds: [],
          projectNames: [],
          totalAmount: 0,
          deptRank: deptOrder[dept] || 99
        };
      }
      
      if (curr.data.orderId) acc[cat].orderIds.push(curr.data.orderId);
      if (curr.data.projectName) acc[cat].projectNames.push(curr.data.projectName);
      acc[cat].totalAmount += (parseInt(curr.data.totalExclTax || 0, 10) || 0);
      return acc;
    }, {});

    const sortedCats = Object.values(grouped).sort((a, b) => {
      if (a.deptRank !== b.deptRank) return a.deptRank - b.deptRank;
      return a.category.localeCompare(b.category, 'zh-TW');
    });

    const allOrderIds = sortedCats.flatMap(g => g.orderIds).filter(Boolean);

    const cleanProjectName = (name, category) => {
      if (category === 'social casino') return name;

      let cleaned = name;
      const prefixes = [
        `${category}_`, `${category}-`, `${category} `,
        `【${category}】`, `[${category}]`,
        `滿貫Web館_`
      ];
      for (const p of prefixes) {
        if (cleaned.startsWith(p)) {
          cleaned = cleaned.substring(p.length).trim();
          break;
        }
      }
      return cleaned;
    };

    const boxLines = sortedCats.map(g => {
      const cleanedNames = g.projectNames.map(name => cleanProjectName(name, g.category));
      const uniqueProjects = [...new Set(cleanedNames.filter(n => n))];
      
      let prefix = g.category;
      if (g.category === '滿貫大亨' || g.category === 'social casino') prefix = '';
      
      const displayName = prefix ? `${prefix}_${uniqueProjects.join('、')}` : uniqueProjects.join('、');
      overallTotal += g.totalAmount;

      return `【${g.dept}】【${g.category}】${displayName}  共${formatWithCommas(g.totalAmount)}`;
    });

    return {
      orderIdsText: allOrderIds.join('、'),
      detailsText: boxLines.join('\n'),
      overallTotal
    };
  }, [results, settings]);

  // Sync to textareas
  useEffect(() => {
    setEditableOrderIds(acceptanceData.orderIdsText);
    setEditableDetails(acceptanceData.detailsText);
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
                <table>
                  <thead>
                    <tr>
                      <th style={{ width: '140px' }}>專案分類</th>
                      <th style={{ width: '120px' }}>單號</th>
                      <th>案件名稱</th>
                      <th style={{ textAlign: 'right', width: '110px' }}>功能測試</th>
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
                          <td colSpan="9">
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
                      <span className="badge badge-primary" style={{ padding: '0.4rem 1rem', fontSize: '0.9rem' }}>
                        全部總計: $ {formatWithCommas(acceptanceData.overallTotal)}
                      </span>
                    </div>
                    <button 
                      className={`btn ${copiedDetails ? 'btn-success' : 'btn-secondary'}`}
                      style={{ padding: '0.4rem 1rem', fontSize: '0.8rem', gap: '0.3rem' }}
                      onClick={() => {
                        copyToClipboard(editableDetails);
                        setCopiedDetails(true);
                        setTimeout(() => setCopiedDetails(false), 2000);
                      }}
                    >
                      {copiedDetails ? <Check size={14} /> : null}
                      {copiedDetails ? '已複製！' : '複製明細'}
                    </button>
                  </div>
                  <textarea
                    ref={detailsRef}
                    value={editableDetails}
                    onChange={(e) => setEditableDetails(e.target.value)}
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
