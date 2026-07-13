import { useState } from 'react';
import { fetchFaultAnalysis, pingFlask, fmt, nodeBus, nodeP, nodePV, nodeQ } from '../services/flaskApi';
import type { FlaskFaultResult, FlaskNodeDetail } from '../services/flaskApi';

const times = ['00:00','00:10','00:20','00:30','00:40','00:50','01:00','02:00','04:00','06:00','08:00','10:00','12:00','14:00','16:00','18:00','20:00','22:00'];
const presetFaults = ['8-9','13-14','4-5','6-26','2-3','18-33'];

function safe<T>(v: T | undefined | null, d: T): T { return v != null ? v : d; }
function safeStr(v: unknown, d = '--'): string { return v != null ? String(v) : d; }
function safeArr<T>(v: unknown): T[] { return Array.isArray(v) ? (v as T[]) : []; }

export default function FlaskPanel() {
  const [time, setTime] = useState('00:10');
  const [fault, setFault] = useState('13-14');
  const [result, setResult] = useState<FlaskFaultResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [flaskOnline, setFlaskOnline] = useState<boolean | null>(null);

  const handleQuery = async () => {
    setLoading(true); setError(''); setResult(null);
    try {
      const r = await fetchFaultAnalysis(time, fault);
      setResult(r);
    } catch (e: any) {
      setError('Flask 服务不可达 (' + (e.message || 'Unknown') + ')，请确认服务运行在 http://127.0.0.1:5000');
    } finally { setLoading(false); }
  };

  const handlePing = async () => {
    const ok = await pingFlask();
    setFlaskOnline(ok);
    setError(ok ? '' : 'Flask 服务未连接');
  };

  const nodes = safe<number[]>(result?.affected_nodes, safe<number[]>(result?.outage_nodes, []));
  const details = safeArr<FlaskNodeDetail>(result?.affected_node_details);

  return (
    <div style={{ marginTop: 16 }}>
      {/* 输入栏 */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 10, padding: '10px 14px', background: '#f3f6f9', borderRadius: 6, border: '1px solid #c8d6e5' }}>
        <span style={{ fontWeight: 600, fontSize: 12, color: '#1f2937' }}>🔗 外部数据服务:</span>
        <span style={{ fontSize: 11, color: '#667085' }}>时间</span>
        <select value={time} onChange={e => setTime(e.target.value)} style={sel}>
          {times.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <span style={{ fontSize: 11, color: '#667085' }}>故障线路</span>
        <select value={fault} onChange={e => setFault(e.target.value)} style={sel}>
          {presetFaults.map(f => <option key={f} value={f}>{f}</option>)}
        </select>
        <input value={fault} onChange={e => setFault(e.target.value)} style={{ ...sel, width: 80 }} placeholder="如 13-14" />
        <button onClick={handleQuery} disabled={loading}
          style={{ padding: '5px 14px', borderRadius: 4, fontSize: 11, cursor: 'pointer', background: '#1f8a4c', color: '#fff', border: 'none' }}>
          {loading ? '查询中...' : '查询'}
        </button>
        <button onClick={handlePing}
          style={{ padding: '5px 10px', borderRadius: 4, fontSize: 11, cursor: 'pointer',
            background: flaskOnline === true ? '#e8f5e9' : flaskOnline === false ? '#ffebee' : '#f3f6f9',
            color: flaskOnline === true ? '#1f8a4c' : flaskOnline === false ? '#e74c3c' : '#667085',
            border: '1px solid #c8d6e5' }}>
          {flaskOnline === true ? '✅ 已连接' : flaskOnline === false ? '❌ 未连接' : '检测连接'}
        </button>
        {error !== '' && <span style={{ fontSize: 11, color: '#e74c3c', flexBasis: '100%' }}>{error}</span>}
      </div>

      {/* 结果卡片 */}
      {result != null && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          {/* 左侧：摘要 */}
          <div style={{ flex: 1, minWidth: 300, background: '#fff', border: '1px solid #c8d6e5', borderRadius: 6, padding: 14 }}>
            <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: '#1f2937' }}>故障分析结果</h4>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 20px', fontSize: 12 }}>
              <Row l="时间" v={safeStr(result.time)} />
              <Row l="故障线路" v={safeStr(result.fault)} c="#e74c3c" />
              <Row l="受影响节点" v={safeStr(result.affected_count ?? nodes.length)} c="#e74c3c" />
              <Row l="停电节点列表" v={nodes.length > 0 ? nodes.join(', ') : '--'} />
              <Row l="总有功负荷" v={fmt(result.total_P_Load_Total_kW) + ' kW'} c="#eb5757" />
              <Row l="光伏出力" v={fmt(result.total_P_PV_kW) + ' kW'} c="#2f80ed" />
              <Row l="净有功负荷(主)" v={fmt(result.total_P_Net_kW) + ' kW'} c="#e74c3c" h />
              <Row l="总无功负荷" v={fmt(result.total_Q_Load_Total_kVar) + ' kVar'} c="#eb5757" />
              <Row l="净无功负荷" v={fmt(result.total_Q_Net_kVar) + ' kVar'} c="#eb5757" />
              <Row l="可通电节点" v={safeStr(result.reachable_count)} c="#2ecc71" />
            </div>
          </div>

          {/* 右侧：节点详情表 */}
          <div style={{ flex: 1, minWidth: 350, background: '#fff', border: '1px solid #c8d6e5', borderRadius: 6, padding: 14 }}>
            <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 10, color: '#1f2937' }}>受影响节点详情</h4>
            {details.length > 0 ? (
              <div style={{ maxHeight: 260, overflowY: 'auto', fontSize: 11 }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr style={{ background: '#f3f6f9' }}>
                    <th style={th}>节点</th><th style={th}>净有功(kW)</th><th style={th}>光伏(kW)</th><th style={th}>负荷(kW)</th><th style={th}>无功(kVar)</th>
                  </tr></thead>
                  <tbody>
                    {details.map((d, i) => (
                      <tr key={nodeBus(d) || i} style={{ borderBottom: '1px solid #f0f0f0' }}>
                        <td style={td}>Bus {nodeBus(d)}</td>
                        <td style={{ ...td, color: '#e74c3c', fontWeight: 700 }}>{fmt(nodeP(d))}</td>
                        <td style={{ ...td, color: '#2f80ed' }}>{fmt(nodePV(d))}</td>
                        <td style={td}>{fmt(d.P_Load_Total_kW)}</td>
                        <td style={td}>{fmt(nodeQ(d))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: 30, color: '#94a3b8', fontSize: 12 }}>暂无节点详情数据</div>
            )}
          </div>
        </div>
      )}

      {result == null && !loading && error === '' && (
        <div style={{ textAlign: 'center', padding: 20, color: '#94a3b8', fontSize: 12, background: '#fff', borderRadius: 6, border: '1px solid #c8d6e5' }}>
          选择时间和故障线路后点击"查询"，结果将在此展示
        </div>
      )}
    </div>
  );
}

function Row({ l, v, c, h }: { l: string; v: string; c?: string; h?: boolean }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px solid #f3f6f9', fontSize: 12 }}>
      <span style={{ color: '#667085' }}>{l}</span>
      <span style={{ color: c || '#1f2937', fontWeight: (h || c) ? 600 : 400 }}>{v}</span>
    </div>
  );
}
const sel: React.CSSProperties = { padding: '4px 8px', borderRadius: 4, border: '1px solid #c8d6e5', fontSize: 11, background: '#fff' };
const th: React.CSSProperties = { textAlign: 'left', padding: '6px 8px', fontWeight: 600, color: '#667085', fontSize: 11 };
const td: React.CSSProperties = { padding: '5px 8px', color: '#1f2937' };
