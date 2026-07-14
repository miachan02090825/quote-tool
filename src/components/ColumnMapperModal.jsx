import React, { useState, useEffect } from 'react';
import { FileSpreadsheet, Check, X, AlertCircle } from 'lucide-react';

const ColumnMapperModal = ({ headers, previewRows, onConfirm, onClose }) => {
  const [nameCol, setNameCol] = useState('');
  const [amountCol, setAmountCol] = useState('');

  // Auto-detect headers on mount
  useEffect(() => {
    if (headers && headers.length > 0) {
      // Find candidate name column
      const nameKeywords = ['項目', '品名', '案件', '名稱', '品項', 'name', 'title', 'subject'];
      const foundName = headers.find(h => 
        nameKeywords.some(key => h.toLowerCase().includes(key))
      );
      if (foundName) setNameCol(foundName);
      else setNameCol(headers[0]);

      // Find candidate amount column
      const amountKeywords = ['金額', '未稅', '未稅金額', '合計', 'amount', 'total', 'price', 'value'];
      const foundAmount = headers.find(h => 
        amountKeywords.some(key => h.toLowerCase().includes(key))
      );
      if (foundAmount) setAmountCol(foundAmount);
      else setAmountCol(headers[1] || headers[0]);
    }
  }, [headers]);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!nameCol || !amountCol) {
      alert('請選擇欄位對應！');
      return;
    }
    if (nameCol === amountCol) {
      if (!window.confirm('您選擇了相同的欄位作為項目名稱與金額，確定要繼續嗎？')) {
        return;
      }
    }
    onConfirm({ nameCol, amountCol });
  };

  return (
    <div className="modal-overlay">
      <div className="glass-panel modal-content" style={{ background: '#0e1428', border: '1px solid rgba(255,255,255,0.1)' }}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <FileSpreadsheet className="text-secondary" size={24} />
            <span className="modal-title">Excel 欄位智慧映射</span>
          </div>
          <button className="modal-close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="badge badge-warning" style={{ marginBottom: '1.5rem', width: '100%', display: 'flex', justifyContent: 'flex-start', padding: '0.75rem 1rem', borderRadius: '0.75rem' }}>
          <AlertCircle size={16} style={{ marginRight: '0.25rem' }} />
          <span>找不到預設欄位名稱（需要「項目名」與「金額（未稅）」），請手動指派對應欄位。</span>
        </div>

        <form onSubmit={handleSubmit}>
          {/* Mapping dropdowns */}
          <div className="form-group">
            <label className="form-label" htmlFor="nameColumnSelect">項目名稱 / 單號 欄位</label>
            <select
              id="nameColumnSelect"
              value={nameCol}
              onChange={(e) => setNameCol(e.target.value)}
              style={{ width: '100%', padding: '0.75rem' }}
            >
              {headers.map(h => (
                <option key={h} value={h}>{h}</option>
              ))}
            </select>
            <p className="form-desc">此欄位應包含如：「123456:專案測試」或「T12345678:案件名稱」的字串。</p>
          </div>

          <div className="form-group" style={{ marginBottom: '2rem' }}>
            <label className="form-label" htmlFor="amountColumnSelect">金額 (未稅) 欄位</label>
            <select
              id="amountColumnSelect"
              value={amountCol}
              onChange={(e) => setAmountCol(e.target.value)}
              style={{ width: '100%', padding: '0.75rem' }}
            >
              {headers.map(h => (
                <option key={h} value={h}>{h}</option>
              ))}
            </select>
            <p className="form-desc">此欄位應包含未稅金額數值。</p>
          </div>

          {/* Excel Row Preview */}
          {previewRows && previewRows.length > 0 && (
            <div className="form-group">
              <label className="form-label">Excel 內容預覽 (前 {previewRows.length} 筆)</label>
              <div className="table-container" style={{ maxHeight: '180px', overflowY: 'auto' }}>
                <table style={{ fontSize: '0.8rem' }}>
                  <thead>
                    <tr>
                      {headers.map(h => (
                        <th 
                          key={h} 
                          style={{ 
                            padding: '0.5rem 0.75rem',
                            background: h === nameCol ? 'rgba(59, 130, 246, 0.15)' : h === amountCol ? 'rgba(16, 185, 129, 0.15)' : 'rgba(15, 23, 42, 0.5)',
                            color: h === nameCol ? '#93c5fd' : h === amountCol ? '#34d399' : 'var(--text-muted)'
                          }}
                        >
                          {h} {h === nameCol ? '(名稱)' : h === amountCol ? '(金額)' : ''}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, idx) => (
                      <tr key={idx}>
                        {headers.map(h => (
                          <td 
                            key={h} 
                            style={{ 
                              padding: '0.5rem 0.75rem', 
                              fontFamily: h === amountCol ? 'var(--font-mono)' : 'inherit',
                              color: h === nameCol ? 'var(--text-bright)' : h === amountCol ? 'var(--success)' : 'inherit',
                              background: h === nameCol ? 'rgba(59, 130, 246, 0.03)' : h === amountCol ? 'rgba(16, 185, 129, 0.03)' : 'transparent'
                            }}
                          >
                            {row[h] !== undefined && row[h] !== null ? row[h].toString() : ''}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div style={{ display: 'flex', gap: '1rem', marginTop: '2rem', justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              取消
            </button>
            <button type="submit" className="btn btn-success">
              <Check size={18} /> 確認對應並解析
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ColumnMapperModal;
