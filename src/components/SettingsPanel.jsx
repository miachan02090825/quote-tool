import React, { useState } from 'react';
import { Save, RotateCcw, Key, Cpu, Tag, Network, Eye, EyeOff } from 'lucide-react';

const DEFAULT_CATEGORIES = [
  "滿貫大亨Web館",
  "網頁組",
  "明星3缺1",
  "滿貫大亨",
  "競技麻將2",
  "唯舞獨尊",
  "玩星派對",
  "social casino"
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

const SettingsPanel = ({ settings, onSaveSettings }) => {
  const [apiKey, setApiKey] = useState(settings.apiKey || '');
  const [modelName, setModelName] = useState(settings.modelName || 'gemini-3.5-flash');
  const [categories, setCategories] = useState(settings.categories || DEFAULT_CATEGORIES);
  const [deptMap, setDeptMap] = useState(settings.deptMap || DEFAULT_DEPT_MAP);
  const [newCategory, setNewCategory] = useState('');
  const [showKey, setShowKey] = useState(false);

  const handleAddCategory = () => {
    const trimmed = newCategory.trim();
    if (trimmed && !categories.includes(trimmed)) {
      setCategories([...categories, trimmed]);
      setDeptMap({ ...deptMap, [trimmed]: '其他' });
      setNewCategory('');
    }
  };

  const handleRemoveCategory = (catToRemove) => {
    setCategories(categories.filter(cat => cat !== catToRemove));
    const newMap = { ...deptMap };
    delete newMap[catToRemove];
    setDeptMap(newMap);
  };

  const handleDeptChange = (cat, dept) => {
    setDeptMap({
      ...deptMap,
      [cat]: dept
    });
  };

  const handleSave = () => {
    onSaveSettings({
      apiKey,
      modelName,
      categories,
      deptMap
    });
    alert('設定已成功儲存！');
  };

  const handleReset = () => {
    if (window.confirm('確定要恢復為預設設定嗎？（這將會清除您目前輸入的金鑰與自訂專案）')) {
      setApiKey('');
      setModelName('gemini-3.5-flash');
      setCategories(DEFAULT_CATEGORIES);
      setDeptMap(DEFAULT_DEPT_MAP);
      onSaveSettings({
        apiKey: '',
        modelName: 'gemini-3.5-flash',
        categories: DEFAULT_CATEGORIES,
        deptMap: DEFAULT_DEPT_MAP
      });
      alert('已恢復預設設定！');
    }
  };

  return (
    <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
      <div className="stats-grid">
        <div className="glass-panel stat-card">
          <div className="stat-icon">
            <Key size={24} />
          </div>
          <div className="stat-info">
            <span className="stat-label">金鑰狀態</span>
            <span className="stat-value" style={{ fontSize: '1.2rem', color: apiKey ? 'var(--success)' : 'var(--error)' }}>
              {apiKey ? '● 已設定' : '○ 未設定'}
            </span>
          </div>
        </div>
        <div className="glass-panel stat-card">
          <div className="stat-icon">
            <Cpu size={24} />
          </div>
          <div className="stat-info">
            <span className="stat-label">當前模型</span>
            <span className="stat-value" style={{ fontSize: '1.2rem' }}>{modelName}</span>
          </div>
        </div>
        <div className="glass-panel stat-card">
          <div className="stat-icon">
            <Tag size={24} />
          </div>
          <div className="stat-info">
            <span className="stat-label">專案分類數</span>
            <span className="stat-value" style={{ fontSize: '1.2rem' }}>{categories.length} 個</span>
          </div>
        </div>
      </div>

      <div className="glass-panel" style={{ padding: '2rem', marginBottom: '2rem' }}>
        <h2 className="brand-name" style={{ fontSize: '1.5rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          ⚙️ 系統核心設定
        </h2>

        {/* API KEY */}
        <div className="form-group" style={{ position: 'relative' }}>
          <label className="form-label" htmlFor="apiKeyInput">Gemini API Key</label>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <input
              id="apiKeyInput"
              type={showKey ? "text" : "password"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="table-input"
              placeholder="請在此貼入您的 Gemini API Key"
              style={{
                background: 'var(--bg-input)',
                border: '1px solid var(--border-color)',
                padding: '0.8rem 1rem',
                flexGrow: 1,
                fontSize: '1rem',
                fontFamily: 'var(--font-mono)'
              }}
            />
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              className="btn btn-secondary"
              style={{ padding: '0.8rem', minHeight: '46px' }}
              title={showKey ? "隱藏金鑰" : "顯示金鑰"}
            >
              {showKey ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
          <p className="form-desc">此金鑰只會保存在您的本機瀏覽器 localStorage 中，不會上傳到任何第三方伺服器。</p>
        </div>

        {/* MODEL SELECT */}
        <div className="form-group">
          <label className="form-label" htmlFor="modelNameSelect">Gemini 運算模型</label>
          <select
            id="modelNameSelect"
            value={modelName}
            onChange={(e) => setModelName(e.target.value)}
            style={{ width: '100%', padding: '0.8rem 1rem', fontSize: '1rem' }}
          >
            <option value="gemini-3.5-flash">gemini-3.5-flash (推薦：最新高效旗艦模型，速度最快、辨識力極強)</option>
            <option value="gemini-3.1-pro">gemini-3.1-pro (最強：最新專業大模型，推理與複雜視覺分析能力一流)</option>
            <option value="gemini-2.0-flash">gemini-2.0-flash (經典：高速度、低延遲)</option>
            <option value="gemini-1.5-flash">gemini-1.5-flash (舊版：相容性備用)</option>
            <option value="gemini-1.5-pro">gemini-1.5-pro (舊版：相容性備用)</option>
          </select>
          <p className="form-desc">設定用於解析 PDF 報價單的語言大模型。</p>
        </div>

        {/* CATEGORIES MANAGEMENT */}
        <div className="form-group">
          <label className="form-label">專案分類設定</label>
          <div className="tag-container">
            {categories.map(cat => (
              <span className="tag" key={cat}>
                {cat}
                <button className="tag-remove" onClick={() => handleRemoveCategory(cat)}>×</button>
              </span>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <input
              type="text"
              value={newCategory}
              onChange={(e) => setNewCategory(e.target.value)}
              placeholder="新增專案分類名稱 (例如: VF_全新專案)"
              style={{ flexGrow: 1 }}
              onKeyDown={(e) => e.key === 'Enter' && handleAddCategory()}
            />
            <button className="btn btn-secondary" onClick={handleAddCategory}>新增分類</button>
          </div>
          <p className="form-desc">這些分類會提供給 Gemini 進行對比匹配。當報價單名稱與分類相符時，系統會自動歸類。</p>
        </div>

        {/* DEPARTMENT MAPPING */}
        <div className="form-group">
          <label className="form-label">部門對應與排序設定</label>
          <div className="table-container" style={{ maxHeight: '300px', overflowY: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th style={{ padding: '0.75rem 1rem' }}>專案分類</th>
                  <th style={{ padding: '0.75rem 1rem' }}>對應驗收部門</th>
                </tr>
              </thead>
              <tbody>
                {categories.map(cat => (
                  <tr key={cat}>
                    <td style={{ padding: '0.5rem 1rem', fontWeight: 'bold' }}>{cat}</td>
                    <td style={{ padding: '0.5rem 1rem' }}>
                      <select
                        value={deptMap[cat] || '其他'}
                        onChange={(e) => handleDeptChange(cat, e.target.value)}
                        style={{ padding: '0.4rem 2.25rem 0.4rem 0.85rem', width: '160px' }}
                      >
                        <option value="研五">研五</option>
                        <option value="研二">研二</option>
                        <option value="研三">研三</option>
                        <option value="其他">其他</option>
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="form-desc">設定各專案分類對應的部門，驗收單將會依據 部門順序 (研五 ➔ 研二 ➔ 研三 ➔ 其他) 自動排列與彙總。</p>
        </div>

        {/* ACTIONS */}
        <div style={{ display: 'flex', gap: '1rem', marginTop: '2.5rem', justifyContent: 'flex-end' }}>
          <button className="btn btn-secondary" onClick={handleReset}>
            <RotateCcw size={18} /> 恢復預設
          </button>
          <button className="btn btn-primary" onClick={handleSave}>
            <Save size={18} /> 儲存設定
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsPanel;
