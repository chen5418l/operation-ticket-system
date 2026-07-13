import { useState } from 'react';
import PageContainer from '../layouts/PageContainer';
import DataTable from '../components/DataTable';
import StatusBadge from '../components/StatusBadge';
import SectionCard from '../components/SectionCard';
import { fetchPredictLoad, fmt } from '../services/flaskApi';
import type { PredictNode } from '../services/flaskApi';

/** 电压风险原因 */
function voltReason(v: number | undefined): string {
  if (v == null) return '预测负荷较高';
  if (v < 0.90) return '电压低于0.90pu，严重越限';
  if (v < 0.95) return '电压低于0.95pu，存在低电压风险';
  if (v > 1.10) return '电压高于1.10pu，严重越限';
  if (v > 1.05) return '电压高于1.05pu，存在过电压风险';
  return '预测负荷较高';
}

/** 节点数据行 */
interface RiskRow { key: number; node: number; netP: string; voltage: string; level: string; reason: string; time: string; }

export default function Forecast() {
  const [baseHour, setBaseHour] = useState(14);
  const [horizon, setHorizon] = useState(1);
  const [nodes, setNodes] = useState<PredictNode[]>([]);
  const [targetTime, setTargetTime] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [filterLevel, setFilterLevel] = useState('全部');

  // 只取中高风险节点
  const riskNodes = nodes.filter(n => n.risk_level === 'high' || n.risk_level === 'medium');

  const rows: RiskRow[] = riskNodes.map((n, i) => ({
    key: i,
    node: n.Bus,
    netP: fmt(n.P_Net_kW),
    voltage: n.Voltage_pu != null ? n.Voltage_pu.toFixed(3) : '--',
    level: n.risk_level === 'high' ? '高' : '中',
    reason: voltReason(n.Voltage_pu),
    time: targetTime || '--',
  }));

  const filtered = filterLevel === '全部' ? rows : rows.filter(r => r.level === filterLevel);
  const highCount = rows.filter(r => r.level === '高').length;
  const midCount = rows.filter(r => r.level === '中').length;

  const handleQuery = async () => {
    setLoading(true); setError(''); setNodes([]); setTargetTime('');
    try {
      const r = await fetchPredictLoad(horizon, baseHour);
      setNodes(Array.isArray(r.nodes) ? r.nodes : []);
      setTargetTime(r.target_time_label || '');
    } catch (e: any) {
      setError('预测数据获取失败 (' + (e.message || '') + ')');
    } finally { setLoading(false); }
  };

  const columns = [
    { key: 'node', title: '节点号', dataIndex: 'node' as const, width: 70,
      render: (r: RiskRow) => <span style={{ fontWeight: 700 }}>Bus {r.node}</span> },
    { key: 'netP', title: '净负荷(kW)', dataIndex: 'netP' as const, width: 110,
      render: (r: RiskRow) => <span style={{ color: '#e74c3c', fontWeight: 600 }}>{r.netP}</span> },
    { key: 'voltage', title: '电压(pu)', dataIndex: 'voltage' as const, width: 90 },
    { key: 'level', title: '风险等级', dataIndex: 'level' as const, width: 90,
      render: (r: RiskRow) => <StatusBadge status={r.level} /> },
    { key: 'reason', title: '风险原因', dataIndex: 'reason' as const },
    { key: 'time', title: '预测时间', dataIndex: 'time' as const, width: 100 },
  ];

  return (
    <PageContainer title="源荷预测风险">
      {/* 控制栏 */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16, padding: '10px 14px', background: '#f3f6f9', borderRadius: 6, border: '1px solid #c8d6e5', fontSize: 12 }}>
        <span style={{ fontWeight: 600, color: '#1f2937' }}>风险节点预测:</span>
        <span style={{ fontSize: 11, color: '#667085' }}>基准时间</span>
        <select value={baseHour} onChange={e => setBaseHour(Number(e.target.value))}
          style={sel}>
          {Array.from({ length: 24 }, (_, i) => i).map(h => (
            <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>
          ))}
        </select>
        <span style={{ fontSize: 11, color: '#667085' }}>步长</span>
        <select value={horizon} onChange={e => setHorizon(Number(e.target.value))} style={sel}>
          {Array.from({ length: 12 }, (_, i) => i + 1).map(h => (
            <option key={h} value={h}>未来 {h}h</option>
          ))}
        </select>
        <button onClick={handleQuery} disabled={loading}
          style={{ padding: '5px 14px', borderRadius: 4, fontSize: 11, cursor: 'pointer', background: '#1f8a4c', color: '#fff', border: 'none' }}>
          {loading ? '查询中...' : '查询风险节点'}
        </button>
        {error !== '' && <span style={{ fontSize: 11, color: '#e74c3c', flexBasis: '100%' }}>{error}</span>}
      </div>

      {/* 表格 */}
      <SectionCard title="风险节点列表" extra={
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {['全部', '高', '中'].map(level => (
            <button key={level} onClick={() => setFilterLevel(level)}
              style={{
                padding: '4px 12px', border: `1px solid ${filterLevel === level ? '#1f8a4c' : '#c8d6e5'}`,
                borderRadius: 4, background: filterLevel === level ? '#e8f5e9' : '#fff',
                color: filterLevel === level ? '#1f8a4c' : '#667085', fontSize: 12, cursor: 'pointer',
                fontWeight: filterLevel === level ? 600 : 400,
              }}>{level}</button>
          ))}
          <span style={{ fontSize: 11, color: '#667085', marginLeft: 4 }}>
            全部: {rows.length} | 高: {highCount} | 中: {midCount}
          </span>
        </div>
      }>
        {rows.length > 0 ? (
          <DataTable columns={columns} data={filtered} rowKey={r => String(r.key)} />
        ) : !loading ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8', fontSize: 13 }}>
            {nodes.length > 0 ? '当前预测时刻无中高风险节点' : '请选择基准时间和步长，点击"查询风险节点"'}
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8', fontSize: 13 }}>加载中...</div>
        )}
      </SectionCard>

      {/* 说明 */}
      <div style={{ marginTop: 12, padding: '8px 14px', background: '#e3f0ff', borderRadius: 4, border: '1px solid #90caf9', fontSize: 11, color: '#1f2937' }}>
        💡 风险节点列表基于外部预测接口 <code>/api/predict_load</code> 返回的节点数据，筛选 risk_level 为 high/medium 的节点。电压越限规则：&lt;0.90pu 严重越限，0.90-0.95pu 低电压风险，&gt;1.10pu 严重越限。
      </div>
    </PageContainer>
  );
}

const sel: React.CSSProperties = { padding: '4px 8px', borderRadius: 4, border: '1px solid #c8d6e5', fontSize: 11, background: '#fff' };
