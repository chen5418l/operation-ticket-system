import { useState } from 'react';
import { fetchPredictLoad, fmt } from '../services/flaskApi';
import type { PredictResult } from '../services/flaskApi';

function safeStr(v: unknown, d = '--'): string { return v != null ? String(v) : d; }
function safeArr<T>(v: unknown): T[] { return Array.isArray(v) ? (v as T[]) : []; }

export default function PredictPanel({ onPredict }: { onPredict?: (r: PredictResult) => void }) {
  const [baseHour, setBaseHour] = useState(14);
  const [horizon, setHorizon] = useState(1);
  const [result, setResult] = useState<PredictResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleQuery = async () => {
    setLoading(true); setError(''); setResult(null);
    try {
      const r = await fetchPredictLoad(horizon, baseHour);
      setResult(r);
      if (onPredict) onPredict(r);
    } catch (e: any) {
      setError('预测数据获取失败，请检查外部数据服务是否启动 (' + (e.message || '') + ')');
    } finally { setLoading(false); }
  };

  return (
    <div style={{ marginTop: 16 }}>
      {/* 输入栏 */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10, padding: '10px 14px', background: '#f3f6f9', borderRadius: 6, border: '1px solid #c8d6e5' }}>
        <span style={{ fontWeight: 600, fontSize: 12, color: '#1f2937' }}>📈 未来12小时负荷预测:</span>
        <span style={{ fontSize: 11, color: '#667085' }}>基准时间</span>
        <select value={baseHour} onChange={e => setBaseHour(Number(e.target.value))}
          style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #c8d6e5', fontSize: 11, background: '#fff' }}>
          {Array.from({ length: 24 }, (_, i) => i).map(h => (
            <option key={h} value={h}>{String(h).padStart(2,'0')}:00</option>
          ))}
        </select>
        <span style={{ fontSize: 11, color: '#667085' }}>预测步长</span>
        <select value={horizon} onChange={e => setHorizon(Number(e.target.value))}
          style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #c8d6e5', fontSize: 11, background: '#fff' }}>
          {Array.from({ length: 12 }, (_, i) => i + 1).map(h => (
            <option key={h} value={h}>未来 {h} 小时</option>
          ))}
        </select>
        <button onClick={handleQuery} disabled={loading}
          style={{ padding: '5px 14px', borderRadius: 4, fontSize: 11, cursor: 'pointer', background: '#1f8a4c', color: '#fff', border: 'none' }}>
          {loading ? '预测中...' : '开始预测'}
        </button>
        <button onClick={() => { setResult(null); setError(''); if (onPredict) onPredict({}); }}
          style={{ padding: '5px 10px', borderRadius: 4, fontSize: 11, cursor: 'pointer', background: '#fff', color: '#667085', border: '1px solid #c8d6e5' }}>
          清除预测
        </button>
        {error !== '' && <span style={{ fontSize: 11, color: '#e74c3c', flexBasis: '100%' }}>{error}</span>}
      </div>

      {/* 结果行 */}
      {result != null && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10, padding: '8px 14px', background: '#e8f5e9', borderRadius: 4, border: '1px solid #a5d6a7', fontSize: 12 }}>
          <span style={{ fontWeight: 600, color: '#1f2937' }}>
            基准: <span style={{ color: '#1f8a4c' }}>{safeStr(result.base_hour ?? baseHour)}:00</span>
            {' → '}
            目标: <span style={{ color: '#e74c3c' }}>{safeStr(result.target_time_label)}</span>
            (步长: <span style={{ color: '#2f80ed' }}>{safeStr(result.horizon ?? horizon)}h</span>)
          </span>
          <span style={{ color: '#c8d6e5' }}>|</span>
          <span>总净负荷: <strong style={{ color: '#e74c3c' }}>{fmt(result.total?.total_P_Net_kW)} kW</strong></span>
          {result.total?.total_loss_MW != null && (
            <span>总网损: <strong style={{ color: '#eb5757' }}>{fmt(result.total.total_loss_MW, 4)} MW</strong></span>
          )}
          <span style={{ color: '#c8d6e5' }}>|</span>
          <span>节点数: <strong>{safeArr(result.nodes).length}</strong></span>
          <span style={{ fontSize: 10, color: '#667085' }}>
            💡 拓扑图节点按风险着色：绿=正常 黄=中等 红=高风险
          </span>
        </div>
      )}

      {/* 风险图例 */}
      {result != null && (
        <div style={{ display: 'flex', gap: 14, marginBottom: 10, padding: '6px 12px', background: '#fff', borderRadius: 4, border: '1px solid #c8d6e5', fontSize: 11 }}>
          <span style={{ fontWeight: 600, color: '#1f2937' }}>风险图例:</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: '#2ecc71' }} /> 正常</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: '#f1c40f' }} /> 中等风险</span>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}><span style={{ width: 10, height: 10, borderRadius: 2, background: '#e74c3c' }} /> 高风险</span>
        </div>
      )}
    </div>
  );
}
