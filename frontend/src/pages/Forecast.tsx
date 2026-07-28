import { useState, useMemo } from 'react';
import PageContainer from '../layouts/PageContainer';
import SectionCard from '../components/SectionCard';
import { getCurrentWorkflow } from '../store/workflowStore';

function fmt(v: unknown, d = 1): string { const n = Number(v); return Number.isFinite(n) ? n.toFixed(d) : '--'; }

/* ==================== 类型 ==================== */
interface ForecastStep { step: number; time_offset_min: number; forecast_hour?: number; total_load_kw: number; total_pv_kw: number; total_ev_kw: number; total_net_load_kw: number; }
interface NodeSeries { step: number; time_offset_min: number; forecast_hour?: number; forecast_load_kw: number; forecast_pv_kw: number; forecast_ev_kw: number; forecast_net_load_kw: number; }
interface NodeForecast { node: number; current_load_kw: number; current_pv_kw: number; current_ev_kw: number; current_net_load_kw: number; voltage_pu: number; risk_level: string; series: NodeSeries[]; }
interface RiskNode { node: number; risk_level: string; voltage_pu?: number; current_net_load_kw?: number; peak_net_load_kw?: number; risk_reason?: string[]; reasons?: string[]; }
interface ForecastResult { success: boolean; has_data?: boolean; message?: string; base_time?: string; base_hour?: number; forecast_mode?: string; time_source?: string; timestamp?: string; horizon?: number; interval_minutes?: number; algorithm_source?: string; current_total_load_kw: number; current_total_pv_kw: number; current_total_ev_kw: number; current_total_net_load_kw: number; forecast_series: ForecastStep[]; node_forecasts: NodeForecast[]; risk_nodes?: RiskNode[]; warnings: string[]; }

const LEVEL_CN: Record<string, string> = { low: '正常', medium: '关注', high: '高风险' };
const LEVEL_COLOR: Record<string, string> = { low: '#1f8a4c', medium: '#f2c94c', high: '#eb5757' };
const LEVEL_BG: Record<string, string> = { low: '#e8f5e9', medium: '#fff8e1', high: '#ffebee' };

interface RiskRow { node: number; voltage_pu: number; curNet: number; maxNet: number; peakHour: number; growth: number | null; risk_level: string; reasons: string[]; isRisk: boolean; }

function analyzeRisk(nf: NodeForecast) {
  const reasons: string[] = [];
  if (nf.voltage_pu < 0.95) reasons.push(`电压越限(${nf.voltage_pu.toFixed(3)}<0.950pu)`);
  else if (nf.voltage_pu < 0.97) reasons.push(`电压偏低(${nf.voltage_pu.toFixed(3)}<0.970pu)`);
  let maxNet = nf.current_net_load_kw, peakHour = 0;
  if (nf.series?.length) for (const s of nf.series) { if (s.forecast_net_load_kw > maxNet) { maxNet = s.forecast_net_load_kw; peakHour = s.forecast_hour ?? s.step; } }
  const cur = nf.current_net_load_kw;
  let growth: number | null = null;
  if (cur > 0) { growth = ((maxNet - cur) / cur) * 100; if (growth > 15) reasons.push(`负荷增长${growth.toFixed(1)}%>15%`); else if (growth > 10) reasons.push(`负荷增长${growth.toFixed(1)}%>10%`); }
  let maxLevel = 'low';
  if (nf.voltage_pu < 0.95) maxLevel = 'high';
  else if (nf.voltage_pu < 0.97) maxLevel = 'medium';
  if (growth !== null && growth > 15) maxLevel = 'high';
  else if (growth !== null && growth > 10 && maxLevel !== 'high') maxLevel = 'medium';
  if (reasons.length === 0) reasons.push('正常');
  return { reasons, maxLevel, maxNet, peakHour, growth };
}

function apiRiskToRow(rn: RiskNode): RiskRow {
  const reasons = rn.risk_reason || rn.reasons || [];
  const curNet = rn.current_net_load_kw ?? 0, maxNet = rn.peak_net_load_kw ?? 0;
  let growth: number | null = null;
  if (curNet > 0 && maxNet > 0) growth = ((maxNet - curNet) / curNet) * 100;
  return { node: rn.node, voltage_pu: rn.voltage_pu ?? 0, curNet, maxNet, peakHour: 0, growth, risk_level: rn.risk_level || 'low', reasons: reasons.length > 0 ? reasons : ['正常'], isRisk: rn.risk_level === 'high' || rn.risk_level === 'medium' };
}

const HORIZON_OPTIONS = [{ v: 1, label: '1h' }, { v: 6, label: '6h' }, { v: 12, label: '12h' }, { v: 24, label: '24h' }];

export default function Forecast() {
  const [horizon, setHorizon] = useState(24);
  const [scenarioMode, setScenarioMode] = useState(false);
  const [baseHour, setBaseHour] = useState(14);
  const [result, setResult] = useState<ForecastResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [filterLevel, setFilterLevel] = useState('全部');
  const [showDetail, setShowDetail] = useState(false);

  const handleQuery = async () => {
    setLoading(true); setError(''); setResult(null);
    try {
      const body: any = { horizon, interval_minutes: 60 };
      if (scenarioMode) body.base_hour = baseHour;
      const res = await fetch('http://localhost:8000/api/forecast/realtime', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: ForecastResult = await res.json();
      if (!json.success) { setError(json.message || '预测失败'); return; }
      setResult(json);
    } catch (e: any) { setError('预测接口调用失败：' + (e.message || '')); }
    finally { setLoading(false); }
  };

  const apiRiskNodes: RiskNode[] = result?.risk_nodes ?? [];
  const nodes: NodeForecast[] = result?.node_forecasts ?? [];
  const steps = result?.forecast_series ?? [];

  const riskRows: RiskRow[] = apiRiskNodes.length > 0
    ? apiRiskNodes.map(apiRiskToRow).filter(r => r.isRisk)
    : nodes.map(nf => { const r = analyzeRisk(nf); return { node: nf.node, voltage_pu: nf.voltage_pu, curNet: nf.current_net_load_kw, maxNet: r.maxNet, peakHour: r.peakHour, growth: r.growth, risk_level: r.maxLevel, reasons: r.reasons, isRisk: r.maxLevel !== 'low' || r.reasons[0] !== '正常' }; }).filter(r => r.isRisk);

  const filtered = filterLevel === '全部' ? riskRows : riskRows.filter(r => r.risk_level === filterLevel);
  const highCount = riskRows.filter(r => r.risk_level === 'high').length;
  const midCount = riskRows.filter(r => r.risk_level === 'medium').length;
  const isLocalFallback = result?.algorithm_source === 'local_fallback';
  const hLabel = `未来${horizon}h`;

  // currentWorkflow 影响
  const wf = useMemo(() => getCurrentWorkflow(), [result]);
  const wfImpact = useMemo(() => {
    if (!wf?.fault_line) return null;
    const outageNodes: number[] = wf.transfer_result?.outage_nodes ?? [];
    const hitHigh = riskRows.filter(r => r.risk_level === 'high' && outageNodes.includes(r.node));
    const hitMedium = riskRows.filter(r => r.risk_level === 'medium' && outageNodes.includes(r.node));
    return { faultLine: wf.fault_line, outageNodes, hitHigh, hitMedium };
  }, [wf, riskRows]);

  return (
    <PageContainer title="源荷预测风险">
      {/* ====== 控制栏 ====== */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 14, padding: '10px 14px', background: '#fff', borderRadius: 6, border: '1px solid #c8d6e5', fontSize: 12 }}>
        <span style={{ fontWeight: 600, color: '#1f2937' }}>源荷预测</span>
        <select value={horizon} onChange={e => setHorizon(Number(e.target.value))} style={sel}>
          {HORIZON_OPTIONS.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
        </select>
        <button onClick={handleQuery} disabled={loading} style={{ padding: '5px 14px', borderRadius: 4, fontSize: 11, cursor: 'pointer', background: '#1f8a4c', color: '#fff', border: 'none', fontWeight: 600 }}>
          {loading ? '计算中...' : '开始预测'}
        </button>
        <label style={{ fontSize: 11, color: '#667085', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4, marginLeft: 8 }}>
          <input type="checkbox" checked={scenarioMode} onChange={e => setScenarioMode(e.target.checked)} />
          场景推演
        </label>
        {scenarioMode && (
          <select value={baseHour} onChange={e => setBaseHour(Number(e.target.value))} style={sel}>
            {[0, 6, 8, 10, 12, 14, 16, 18, 20, 22].map(h => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
          </select>
        )}
        {isLocalFallback && <span style={{ fontSize: 10, color: '#b8860b', background: '#fff8e1', padding: '2px 8px', borderRadius: 3 }}>本地规则 · 低置信度</span>}
        {error && <span style={{ fontSize: 11, color: '#e74c3c' }}>{error}</span>}
      </div>

      {/* ====== 场景推演提示 ====== */}
      {scenarioMode && (
        <div style={{ background: '#fff8e1', border: '1px solid #f2c94c', borderRadius: 4, padding: '6px 12px', marginBottom: 12, fontSize: 11, color: '#b8860b' }}>
          ⚠️ 场景推演模式，基准时间由用户指定，结果仅用于分析参考。
        </div>
      )}

      {/* ====== 预测元信息 ====== */}
      {result && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12, padding: '8px 12px', background: isLocalFallback ? '#fff8e1' : '#e8f5e9', borderRadius: 4, border: `1px solid ${isLocalFallback ? '#f2c94c' : '#a5d6a7'}`, fontSize: 11, color: isLocalFallback ? '#b8860b' : '#1f8a4c' }}>
          <span>数据时间：{result.timestamp || result.base_time || '--'}</span>
          <span>|</span>
          <span>来源：<strong>{isLocalFallback ? '本地规则（外部算法不可用）' : '外部算法'}</strong></span>
          <span>|</span>
          <span>时域：{hLabel} · {result.interval_minutes ?? 60}min间隔 · {steps.length}点</span>
          {scenarioMode && result.base_hour != null && <><span>|</span><span>基准：{result.base_hour}:00</span></>}
        </div>
      )}

      {/* ====== 当前负荷总览 ====== */}
      {result && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
          {[
            { l: '当前总负荷', v: result.current_total_load_kw, u: 'kW', c: '#2f80ed' },
            { l: '光伏出力', v: result.current_total_pv_kw, u: 'kW', c: '#f2c94c' },
            { l: 'EV 负荷', v: result.current_total_ev_kw, u: 'kW', c: '#eb5757' },
            { l: '净负荷', v: result.current_total_net_load_kw, u: 'kW', c: '#1f8a4c' },
          ].map(card => (
            <div key={card.l} style={{ flex: 1, minWidth: 130, background: '#fff', borderRadius: 6, border: '1px solid #c8d6e5', padding: '12px 16px' }}>
              <div style={{ fontSize: 11, color: '#667085', marginBottom: 4 }}>{card.l}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: card.c }}>{fmt(card.v)} <span style={{ fontSize: 11, fontWeight: 400, color: '#94a3b8' }}>{card.u}</span></div>
            </div>
          ))}
        </div>
      )}

      {/* ====== 处置流程影响（紧凑） ====== */}
      {wfImpact && (
        <div style={{ background: wfImpact.hitHigh.length > 0 ? '#fff5f5' : wfImpact.hitMedium.length > 0 ? '#fffdf5' : '#f3f6f9', border: '1px solid #c8d6e5', borderRadius: 6, padding: '8px 14px', marginBottom: 14, fontSize: 12 }}>
          <span>故障 <strong style={{ color: '#eb5757' }}>{wfImpact.faultLine}</strong> · 受影响 <strong>{wfImpact.outageNodes.length || '?'}</strong> 节点</span>
          {wfImpact.hitHigh.length > 0 && <span style={{ marginLeft: 12, color: '#eb5757' }}>🚫 {wfImpact.hitHigh.map(r => `Bus${r.node}`).join(' ')} 高风险</span>}
          {wfImpact.hitMedium.length > 0 && <span style={{ marginLeft: 12, color: '#b8860b' }}>⚠️ {wfImpact.hitMedium.map(r => `Bus${r.node}`).join(' ')} 关注</span>}
          {wfImpact.hitHigh.length === 0 && wfImpact.hitMedium.length === 0 && <span style={{ marginLeft: 12, color: '#1f8a4c' }}>✅ 无风险命中</span>}
        </div>
      )}

      {/* ====== 预测序列表 ====== */}
      {steps.length > 0 && (
        <SectionCard title={`${hLabel}预测序列 (${steps.length}点)`} style={{ marginBottom: 14 }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead><tr style={{ background: '#f3f6f9' }}>
                <th style={th}>步</th><th style={th}>小时</th><th style={th}>负荷(kW)</th><th style={th}>PV(kW)</th><th style={th}>EV(kW)</th><th style={th}>净负荷(kW)</th>
              </tr></thead>
              <tbody>
                {steps.map(s => (
                  <tr key={s.step} style={{ borderBottom: '1px solid #f0f0f0' }}>
                    <td style={{ ...td, fontWeight: 600 }}>{s.step}</td>
                    <td style={td}>T+{s.step}h ({s.forecast_hour ?? '-'}:00)</td>
                    <td style={td}>{fmt(s.total_load_kw)}</td>
                    <td style={{ ...td, color: '#f2c94c' }}>{fmt(s.total_pv_kw)}</td>
                    <td style={{ ...td, color: '#eb5757' }}>{fmt(s.total_ev_kw)}</td>
                    <td style={{ ...td, fontWeight: 700, color: '#1f8a4c' }}>{fmt(s.total_net_load_kw)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {/* ====== 风险节点列表 ====== */}
      <SectionCard title="风险节点" extra={
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {['全部', 'high', 'medium'].map(lv => (
            <button key={lv} onClick={() => setFilterLevel(lv)}
              style={{ padding: '3px 10px', border: `1px solid ${filterLevel === lv ? '#1f8a4c' : '#c8d6e5'}`, borderRadius: 3, background: filterLevel === lv ? '#e8f5e9' : '#fff', color: filterLevel === lv ? '#1f8a4c' : '#667085', fontSize: 11, cursor: 'pointer', fontWeight: filterLevel === lv ? 600 : 400 }}>
              {lv === '全部' ? `全部(${riskRows.length})` : lv === 'high' ? `高风险(${highCount})` : `关注(${midCount})`}
            </button>
          ))}
        </div>
      } style={{ marginBottom: 14 }}>
        {riskRows.length > 0 ? (
          <div style={{ maxHeight: 380, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead><tr style={{ background: '#f3f6f9' }}>
                <th style={th}>节点</th><th style={th}>电压(pu)</th><th style={th}>当前净负荷</th><th style={th}>{hLabel}峰值</th><th style={th}>峰值时刻</th><th style={th}>增长率</th><th style={th}>风险</th><th style={th}>原因</th>
              </tr></thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={r.node} style={{ borderBottom: '1px solid #f0f0f0', background: LEVEL_BG[r.risk_level] || 'transparent' }}>
                    <td style={td}><strong>Bus {r.node}</strong></td>
                    <td style={{ ...td, color: r.voltage_pu < 0.95 ? '#eb5757' : r.voltage_pu < 0.97 ? '#f2c94c' : '#1f2937', fontWeight: 600 }}>{r.voltage_pu > 0 ? r.voltage_pu.toFixed(4) : '--'}</td>
                    <td style={td}>{fmt(r.curNet)} kW</td>
                    <td style={td}>{fmt(r.maxNet)} kW</td>
                    <td style={td}>{r.peakHour > 0 ? `${r.peakHour}:00` : '--'}</td>
                    <td style={{ ...td, color: r.growth !== null && r.growth > 10 ? '#eb5757' : r.growth !== null && r.growth > 5 ? '#f2c94c' : '#1f2937' }}>{r.growth !== null ? `${r.growth > 0 ? '+' : ''}${r.growth.toFixed(1)}%` : '--'}</td>
                    <td style={td}><span style={{ padding: '2px 8px', borderRadius: 3, fontSize: 10, fontWeight: 600, background: LEVEL_BG[r.risk_level] || '#f3f6f9', color: LEVEL_COLOR[r.risk_level] || '#667085', border: `1px solid ${LEVEL_COLOR[r.risk_level] || '#c8d6e5'}` }}>{LEVEL_CN[r.risk_level] || r.risk_level}</span></td>
                    <td style={{ ...td, maxWidth: 200, wordBreak: 'break-all' }}>{r.reasons.join('；')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : !loading ? (
          <div style={{ textAlign: 'center', padding: 32, color: result ? '#1f8a4c' : '#94a3b8', fontSize: 12 }}>
            {result ? '✅ 当前预测时段未发现风险节点' : '点击「开始预测」查看风险节点'}
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: 32, color: '#94a3b8', fontSize: 12 }}>加载中...</div>
        )}
      </SectionCard>

      {/* ====== 节点明细（可折叠） ====== */}
      {nodes.length > 0 && (
        <SectionCard title={<span onClick={() => setShowDetail(!showDetail)} style={{ cursor: 'pointer' }}>节点预测明细 ({nodes.length}节点) {showDetail ? '▲' : '▶'}</span>}>
          {showDetail && (
            <div style={{ maxHeight: 500, overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead><tr style={{ background: '#f3f6f9' }}>
                  <th style={th}>节点</th><th style={th}>负荷</th><th style={th}>PV</th><th style={th}>EV</th><th style={th}>净负荷</th><th style={th}>峰值</th><th style={th}>时刻</th><th style={th}>电压</th><th style={th}>风险</th>
                </tr></thead>
                <tbody>
                  {nodes.map(nf => {
                    const r = analyzeRisk(nf);
                    return (
                      <tr key={nf.node} style={{ borderBottom: '1px solid #f0f0f0', background: LEVEL_BG[r.maxLevel] || 'transparent' }}>
                        <td style={td}><strong>Bus {nf.node}</strong></td>
                        <td style={td}>{fmt(nf.current_load_kw)}</td>
                        <td style={td}>{fmt(nf.current_pv_kw)}</td>
                        <td style={td}>{fmt(nf.current_ev_kw)}</td>
                        <td style={{ ...td, fontWeight: 600 }}>{fmt(nf.current_net_load_kw)}</td>
                        <td style={{ ...td, fontWeight: 600, color: '#1f8a4c' }}>{fmt(r.maxNet)}</td>
                        <td style={td}>{r.peakHour > 0 ? `${r.peakHour}:00` : '--'}</td>
                        <td style={{ ...td, color: nf.voltage_pu < 0.95 ? '#eb5757' : nf.voltage_pu < 0.97 ? '#f2c94c' : '#1f2937' }}>{nf.voltage_pu.toFixed(4)}</td>
                        <td style={td}><span style={{ padding: '2px 8px', borderRadius: 3, fontSize: 10, fontWeight: 600, background: LEVEL_BG[r.maxLevel] || '#f3f6f9', color: LEVEL_COLOR[r.maxLevel] || '#667085' }}>{LEVEL_CN[r.maxLevel] || r.maxLevel}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}
    </PageContainer>
  );
}

const sel: React.CSSProperties = { padding: '4px 8px', borderRadius: 4, border: '1px solid #c8d6e5', fontSize: 11, background: '#fff' };
const th: React.CSSProperties = { textAlign: 'left', padding: '6px 8px', fontWeight: 600, color: '#667085', fontSize: 11 };
const td: React.CSSProperties = { padding: '5px 8px', color: '#1f2937' };
