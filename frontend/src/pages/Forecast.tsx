import { useState, useMemo } from 'react';
import PageContainer from '../layouts/PageContainer';
import StatusBadge from '../components/StatusBadge';
import SectionCard from '../components/SectionCard';
import { getCurrentWorkflow } from '../store/workflowStore';

function fmt(v: unknown, d = 1): string { const n = Number(v); return Number.isFinite(n) ? n.toFixed(d) : '--'; }

interface ForecastStep { step: number; time_offset_min: number; forecast_hour?: number; total_load_kw: number; total_pv_kw: number; total_ev_kw: number; total_net_load_kw: number; }
interface NodeSeries { step: number; time_offset_min: number; forecast_hour?: number; forecast_load_kw: number; forecast_pv_kw: number; forecast_ev_kw: number; forecast_net_load_kw: number; }
interface NodeForecast { node: number; current_load_kw: number; current_pv_kw: number; current_ev_kw: number; current_net_load_kw: number; voltage_pu: number; risk_level: string; series: NodeSeries[]; }
interface RiskNode { node: number; risk_level: string; voltage_pu?: number; current_net_load_kw?: number; peak_net_load_kw?: number; risk_reason?: string[]; reasons?: string[]; }

interface ForecastResult { success: boolean; has_data?: boolean; message?: string; base_time?: string; base_hour?: number; forecast_mode?: string; time_source?: string; timestamp?: string; horizon?: number; interval_minutes?: number; algorithm_source?: string; current_total_load_kw: number; current_total_pv_kw: number; current_total_ev_kw: number; current_total_net_load_kw: number; forecast_series: ForecastStep[]; node_forecasts: NodeForecast[]; risk_nodes?: RiskNode[]; warnings: string[]; }

// ========== 风险等级中文映射 ==========
const LEVEL_CN: Record<string, string> = { low: '正常', medium: '关注', high: '高风险' };
const LEVEL_COLOR: Record<string, string> = { low: '#1f8a4c', medium: '#f2c94c', high: '#eb5757' };
const LEVEL_BG: Record<string, string> = { low: '#e8f5e9', medium: '#fff8e1', high: '#ffebee' };

// ========== 本地风险分析（用于 API 未返回 risk_nodes 的降级） ==========
interface RiskRow {
  node: number; voltage_pu: number; curNet: number; maxNet: number;
  peakHour: number; growth: number | null;   // growth 可为 null（当前负荷为0）
  risk_level: string; reasons: string[]; isRisk: boolean;
}

function analyzeRisk(nf: NodeForecast): { reasons: string[]; maxLevel: string; maxNet: number; peakHour: number; growth: number | null } {
  const reasons: string[] = [];
  // 电压阈值判定
  if (nf.voltage_pu < 0.95) {
    reasons.push(`电压越限 (${nf.voltage_pu.toFixed(3)} < 0.950 pu)`);
  } else if (nf.voltage_pu < 0.97) {
    reasons.push(`电压低于关注阈值 (${nf.voltage_pu.toFixed(3)} < 0.970 pu)`);
  }
  // 峰值与增长
  let maxNet = nf.current_net_load_kw, peakHour = 0;
  if (nf.series?.length) {
    for (const s of nf.series) {
      if (s.forecast_net_load_kw > maxNet) { maxNet = s.forecast_net_load_kw; peakHour = s.forecast_hour ?? s.step; }
    }
  }
  const cur = nf.current_net_load_kw;
  let growth: number | null = null;
  if (cur > 0) {
    growth = ((maxNet - cur) / cur) * 100;
    if (growth > 15) reasons.push(`预测峰值负荷增长 ${growth.toFixed(1)}% > 15%`);
    else if (growth > 10) reasons.push(`预测峰值负荷增长 ${growth.toFixed(1)}% > 10%`);
  }
  // EV 高峰占比
  const evPeak = nf.series?.length ? Math.max(...nf.series.map(s => s.forecast_ev_kw)) : nf.current_ev_kw;
  if (cur > 0 && evPeak / cur > 0.3) reasons.push('EV 高峰占比较高 (>30%)');

  // 风险等级
  let maxLevel: string = 'low';
  if (nf.voltage_pu < 0.95) maxLevel = 'high';
  else if (nf.voltage_pu < 0.97) maxLevel = 'medium';
  if (growth !== null && growth > 15) maxLevel = 'high';
  else if (growth !== null && growth > 10 && maxLevel !== 'high') maxLevel = 'medium';

  if (reasons.length === 0) reasons.push('正常');
  return { reasons, maxLevel, maxNet, peakHour, growth };
}

// API risk_node → RiskRow
function apiRiskToRow(rn: RiskNode): RiskRow {
  const reasons = rn.risk_reason || rn.reasons || [];
  const curNet = rn.current_net_load_kw ?? 0;
  const maxNet = rn.peak_net_load_kw ?? 0;
  let growth: number | null = null;
  if (curNet > 0 && maxNet > 0) growth = ((maxNet - curNet) / curNet) * 100;
  return {
    node: rn.node, voltage_pu: rn.voltage_pu ?? 0,
    curNet, maxNet, peakHour: 0,
    growth, risk_level: rn.risk_level || 'low',
    reasons: reasons.length > 0 ? reasons : ['正常'],
    isRisk: rn.risk_level === 'high' || rn.risk_level === 'medium',
  };
}

const HORIZON_OPTIONS = [{ v: 1, label: '未来1h' }, { v: 6, label: '未来6h' }, { v: 12, label: '未来12h' }, { v: 24, label: '未来24h' }];

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
      const res = await fetch('http://localhost:8000/api/forecast/realtime', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
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
  const hLabel = `未来${horizon}小时`;

  // 风险行：优先 API，降级本地分析
  const riskRows: RiskRow[] = apiRiskNodes.length > 0
    ? apiRiskNodes.map(apiRiskToRow).filter(r => r.isRisk)
    : nodes.map(nf => {
        const r = analyzeRisk(nf);
        return { node: nf.node, voltage_pu: nf.voltage_pu, curNet: nf.current_net_load_kw, maxNet: r.maxNet, peakHour: r.peakHour, growth: r.growth, risk_level: r.maxLevel, reasons: r.reasons, isRisk: r.maxLevel !== 'low' || r.reasons[0] !== '正常' };
      }).filter(r => r.isRisk);

  const filtered = filterLevel === '全部' ? riskRows : riskRows.filter(r => r.risk_level === filterLevel);
  const highCount = riskRows.filter(r => r.risk_level === 'high').length;
  const midCount = riskRows.filter(r => r.risk_level === 'medium').length;

  const isLocalFallback = result?.algorithm_source === 'local_fallback';
  const dataTime = result?.timestamp || result?.base_time || '--';
  const predictTime = new Date().toLocaleString('zh-CN');

  // ========== currentWorkflow 影响摘要 ==========
  const wf = useMemo(() => getCurrentWorkflow(), [result]);
  const wfImpact = useMemo(() => {
    if (!wf || !wf.fault_line) return null;
    const faultLine = wf.fault_line;
    // 从 transfer_result 获取停电节点
    const outageNodes: number[] = wf.transfer_result?.outage_nodes ?? [];
    // 找出停电节点中命中风险列表的
    const hitHigh = riskRows.filter(r => r.risk_level === 'high' && outageNodes.includes(r.node));
    const hitMedium = riskRows.filter(r => r.risk_level === 'medium' && outageNodes.includes(r.node));
    return { faultLine, outageNodes, hitHigh, hitMedium };
  }, [wf, riskRows]);

  return (
    <PageContainer title="源荷预测风险">
      {/* ====== 警告横幅 ====== */}
      {result?.warnings && result.warnings.length > 0 && result.warnings[0] !== '暂无实时数据，请先接入Simulink数据' && (
        <div style={{ background: '#fff8e1', border: '1px solid #f2c94c', borderRadius: 6, padding: '8px 14px', marginBottom: 12, fontSize: 12, color: '#b8860b' }}>
          ⚠️ {result.warnings.join('；')}
        </div>
      )}

      {/* ====== 控制栏 ====== */}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12, padding: '10px 14px', background: '#f3f6f9', borderRadius: 6, border: '1px solid #c8d6e5', fontSize: 12 }}>
        <span style={{ fontWeight: 600, color: '#1f2937' }}>{hLabel}源荷预测</span>
        <span style={{ fontSize: 11, color: '#667085' }}>预测时域</span>
        <select value={horizon} onChange={e => setHorizon(Number(e.target.value))} style={sel}>
          {HORIZON_OPTIONS.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
        </select>
        <button onClick={handleQuery} disabled={loading} style={{ padding: '5px 14px', borderRadius: 4, fontSize: 11, cursor: 'pointer', background: '#1f8a4c', color: '#fff', border: 'none' }}>
          {loading ? '计算中...' : isLocalFallback ? '刷新本地规则预测' : `刷新${hLabel}预测`}
        </button>
        <span style={{ color: '#c8d6e5' }}>|</span>
        <label style={{ fontSize: 11, color: '#667085', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
          <input type="checkbox" checked={scenarioMode} onChange={e => setScenarioMode(e.target.checked)} style={{ cursor: 'pointer' }} />
          场景推演模式
        </label>
        {scenarioMode && (
          <>
            <span style={{ fontSize: 11, color: '#667085' }}>基准小时</span>
            <select value={baseHour} onChange={e => setBaseHour(Number(e.target.value))} style={sel}>
              {[0, 6, 8, 10, 12, 14, 16, 18, 20, 22].map(h => <option key={h} value={h}>{String(h).padStart(2, '0')}:00</option>)}
            </select>
          </>
        )}
        {error && <span style={{ fontSize: 11, color: '#e74c3c', flexBasis: '100%' }}>{error}</span>}
      </div>

      {scenarioMode && (
        <div style={{ background: '#fff8e1', border: '1px solid #f2c94c', borderRadius: 4, padding: '6px 12px', marginBottom: 12, fontSize: 11, color: '#b8860b' }}>
          ⚠️ 当前为场景推演模式，基准时间由用户手动指定，结果仅用于分析参考。
        </div>
      )}

      {/* ====== 预测元信息条 ====== */}
      {result && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12, padding: '8px 12px', background: '#e8f5e9', borderRadius: 4, border: '1px solid #a5d6a7', fontSize: 11, color: '#1f8a4c' }}>
          <span>📡 实时数据时间：{dataTime}</span><span>|</span>
          <span>预测生成时间：{predictTime}</span><span>|</span>
          <span>预测来源：<strong>{result.algorithm_source === 'external' ? '外部算法' : '本地规则'}</strong></span><span>|</span>
          <span>算法版本：<strong>{result.algorithm_source === 'external' ? 'ieee33-v1' : 'fallback-v1'}</strong></span><span>|</span>
          <span>置信度：
            <span style={{
              fontWeight: 600, padding: '1px 6px', borderRadius: 3, fontSize: 10,
              background: result.algorithm_source === 'external' ? '#e8f5e9' : '#fff8e1',
              color: result.algorithm_source === 'external' ? '#1f8a4c' : '#b8860b',
            }}>
              {result.algorithm_source === 'external' ? 'medium' : 'low'}
            </span>
          </span>
          <span>|</span>
          <span>模式：{result.forecast_mode === 'scenario' ? '🔧 场景推演' : '🔄 实时滚动'}</span>
          <span>|</span>
          <span>时域：{hLabel} (间隔{result.interval_minutes ?? 60}分钟)</span>
          {scenarioMode && result.base_hour != null && <><span>|</span><span>场景基准：{result.base_hour}:00</span></>}
        </div>
      )}

      {/* ====== 外部不可用提示 ====== */}
      {result && isLocalFallback && (
        <div style={{ marginBottom: 10, padding: '8px 12px', background: '#fff8e1', borderRadius: 4, border: '1px solid #f2c94c', fontSize: 11, color: '#b8860b' }}>
          ⚠️ 外部预测算法服务暂不可用，已降级本地规则预测，结果需人工复核。
          <span style={{ display: 'block', marginTop: 3, color: '#94a3b8' }}>
            本地规则预测仅供风险预警参考，不作为正式操作依据。PV/EV 曲线为内置示例曲线。
          </span>
        </div>
      )}

      {/* ====== currentWorkflow 影响摘要 ====== */}
      <SectionCard title="当前处置流程影响" style={{ marginBottom: 16 }}>
        {wfImpact ? (
          <div style={{ fontSize: 12, lineHeight: 1.8 }}>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginBottom: 8 }}>
              <span>故障线路：<strong style={{ color: '#eb5757' }}>{wfImpact.faultLine}</strong></span>
              <span>受影响节点：<strong>{wfImpact.outageNodes.length > 0 ? wfImpact.outageNodes.join('、') : '未知（请先执行边界判定）'}</strong></span>
            </div>
            {wfImpact.hitHigh.length > 0 && (
              <div style={{ background: '#ffebee', border: '1px solid #ffcdd2', borderRadius: 4, padding: '6px 10px', marginBottom: 4 }}>
                🚫 高风险节点（转供后需重点校验）：<strong style={{ color: '#eb5757' }}>{wfImpact.hitHigh.map(r => `Bus ${r.node}`).join('、')}</strong>
                <div style={{ fontSize: 10, color: '#667085', marginTop: 2 }}>
                  这些节点在转供后电压可能低于安全阈值，安全校验中的电压项可能不通过。
                </div>
              </div>
            )}
            {wfImpact.hitMedium.length > 0 && (
              <div style={{ background: '#fff8e1', border: '1px solid #ffe082', borderRadius: 4, padding: '6px 10px', marginBottom: 4 }}>
                ⚠️ 关注节点（转供方案需评估）：<strong style={{ color: '#b8860b' }}>{wfImpact.hitMedium.map(r => `Bus ${r.node}`).join('、')}</strong>
                <div style={{ fontSize: 10, color: '#667085', marginTop: 2 }}>
                  建议选恢复率高的转供方案，并在安全校验中关注电压与负载率。
                </div>
              </div>
            )}
            {wfImpact.hitHigh.length === 0 && wfImpact.hitMedium.length === 0 && wfImpact.outageNodes.length > 0 && (
              <div style={{ background: '#e8f5e9', border: '1px solid #a5d6a7', borderRadius: 4, padding: '6px 10px', color: '#1f8a4c' }}>
                ✅ 受影响的 {wfImpact.outageNodes.length} 个节点当前预测均正常，转供后风险较低。
              </div>
            )}
            {wfImpact.outageNodes.length === 0 && (
              <div style={{ color: '#94a3b8', fontSize: 11 }}>请先完成边界判定以获取受影响节点列表。</div>
            )}
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: 16, color: '#94a3b8', fontSize: 12 }}>
            暂无当前处置流程，仅展示全网预测风险。
          </div>
        )}
      </SectionCard>

      {/* ====== 当前总览 ====== */}
      {result && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 16 }}>
          {[
            { l: '当前总负荷 (33节点合计)', v: result.current_total_load_kw, u: 'kW', c: '#2f80ed' },
            { l: '光伏出力', v: result.current_total_pv_kw, u: 'kW', c: '#f2c94c' },
            { l: 'EV负荷', v: result.current_total_ev_kw, u: 'kW', c: '#eb5757' },
            { l: '净负荷', v: result.current_total_net_load_kw, u: 'kW', c: '#1f8a4c' },
          ].map(card => (
            <div key={card.l} style={{ flex: 1, minWidth: 140, background: '#fff', borderRadius: 6, border: '1px solid #c8d6e5', padding: '12px 16px' }}>
              <div style={{ fontSize: 11, color: '#667085', marginBottom: 4 }}>{card.l}</div>
              <div style={{ fontSize: 20, fontWeight: 700, color: card.c }}>{fmt(card.v)} <span style={{ fontSize: 11, fontWeight: 400, color: '#94a3b8' }}>{card.u}</span></div>
              {card.l === '光伏出力' && isLocalFallback && <div style={{ fontSize: 9, color: '#94a3b8', marginTop: 2 }}>内置示例曲线</div>}
              {card.l === 'EV负荷' && isLocalFallback && <div style={{ fontSize: 9, color: '#94a3b8', marginTop: 2 }}>内置示例曲线</div>}
            </div>
          ))}
        </div>
      )}

      {/* ====== 预测序列表 ====== */}
      {steps.length > 0 && (
        <SectionCard title={`${hLabel}预测序列 (${steps.length}点)`} style={{ marginBottom: 16 }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead><tr style={{ background: '#f3f6f9' }}>
                <th style={th}>步</th><th style={th}>小时</th><th style={th}>总负荷(kW)</th><th style={th}>PV(kW){isLocalFallback ? <span style={{fontSize:9,color:'#94a3b8',fontWeight:400}}> 示例</span> : ''}</th>
                <th style={th}>EV(kW){isLocalFallback ? <span style={{fontSize:9,color:'#94a3b8',fontWeight:400}}> 示例</span> : ''}</th>
                <th style={th}>净负荷(kW)</th>
              </tr></thead>
              <tbody>
                {steps.map(s => (
                  <tr key={s.step} style={{ borderBottom: '1px solid #f0f0f0' }}>
                    <td style={td}>{s.step}</td>
                    <td style={{ ...td, fontWeight: 600 }}>T+{s.step}h ({s.forecast_hour ?? '-'}:00)</td>
                    <td style={{ ...td, fontWeight: 600 }}>{fmt(s.total_load_kw)}</td>
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
      <SectionCard title="风险节点列表" extra={
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          {['全部', 'high', 'medium'].map(lv => (
            <button key={lv} onClick={() => setFilterLevel(lv)}
              style={{ padding: '4px 12px', border: `1px solid ${filterLevel === lv ? '#1f8a4c' : '#c8d6e5'}`, borderRadius: 4, background: filterLevel === lv ? '#e8f5e9' : '#fff', color: filterLevel === lv ? '#1f8a4c' : '#667085', fontSize: 12, cursor: 'pointer', fontWeight: filterLevel === lv ? 600 : 400 }}>
              {lv === '全部' ? '全部' : lv === 'high' ? '高风险' : '关注'}
            </button>
          ))}
          <span style={{ fontSize: 11, color: '#667085', marginLeft: 4 }}>全部:{riskRows.length} | 高风险:{highCount} | 关注:{midCount}</span>
        </div>
      } style={{ marginBottom: 16 }}>
        {riskRows.length > 0 ? (
          <div style={{ maxHeight: 400, overflowY: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
              <thead><tr style={{ background: '#f3f6f9' }}>
                <th style={th}>节点</th>
                <th style={th}>电压(pu)</th>
                <th style={th}>当前净负荷</th>
                <th style={th}>{hLabel}峰值净负荷</th>
                <th style={th}>峰值时刻</th>
                <th style={th}>增长率</th>
                <th style={th}>风险</th>
                <th style={th}>原因</th>
              </tr></thead>
              <tbody>
                {filtered.map(r => {
                  const levelCn = LEVEL_CN[r.risk_level] || r.risk_level;
                  return (
                    <tr key={r.node} style={{ borderBottom: '1px solid #f0f0f0', background: LEVEL_BG[r.risk_level] || 'transparent' }}>
                      <td style={td}><strong>Bus {r.node}</strong></td>
                      <td style={{ ...td, color: r.voltage_pu < 0.95 ? '#eb5757' : r.voltage_pu < 0.97 ? '#f2c94c' : '#1f2937', fontWeight: 600 }}>{r.voltage_pu > 0 ? r.voltage_pu.toFixed(4) : '--'}</td>
                      <td style={td}>{fmt(r.curNet)} kW</td>
                      <td style={td}>{fmt(r.maxNet)} kW</td>
                      <td style={td}>{r.peakHour > 0 ? `${r.peakHour}:00` : '--'}</td>
                      <td style={{ ...td, color: r.growth !== null && r.growth > 10 ? '#eb5757' : r.growth !== null && r.growth > 5 ? '#f2c94c' : '#1f2937' }}>
                        {r.growth !== null ? `${r.growth > 0 ? '+' : ''}${r.growth.toFixed(1)}%` : '--'}
                      </td>
                      <td style={td}>
                        <span style={{
                          padding: '2px 8px', borderRadius: 3, fontSize: 10, fontWeight: 600,
                          background: LEVEL_BG[r.risk_level] || '#f3f6f9',
                          color: LEVEL_COLOR[r.risk_level] || '#667085',
                          border: `1px solid ${LEVEL_COLOR[r.risk_level] || '#c8d6e5'}`,
                        }}>{levelCn}</span>
                      </td>
                      <td style={{ ...td, maxWidth: 220, wordBreak: 'break-all' }}>{r.reasons.join('；')}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : !loading ? (
          <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8', fontSize: 13 }}>
            {result ? '当前预测时段未发现高风险或关注节点。' : `点击"刷新${hLabel}预测"后，风险节点将在此显示`}
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8', fontSize: 13 }}>加载中...</div>
        )}
      </SectionCard>

      {/* ====== 节点明细 ====== */}
      {nodes.length > 0 && (
        <SectionCard title={<span onClick={() => setShowDetail(!showDetail)} style={{ cursor: 'pointer' }}>节点预测明细 ({nodes.length}节点) {showDetail ? '▲' : '▶'}</span>} style={{ marginBottom: 16 }}>
          {showDetail && (
            <div style={{ maxHeight: 500, overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead><tr style={{ background: '#f3f6f9' }}>
                  <th style={th}>节点</th><th style={th}>负荷</th><th style={th}>PV</th><th style={th}>EV</th><th style={th}>净负荷</th><th style={th}>{hLabel}峰值净负荷</th><th style={th}>峰值时刻</th><th style={th}>电压</th><th style={th}>风险</th>
                </tr></thead>
                <tbody>
                  {nodes.map(nf => {
                    const r = analyzeRisk(nf);
                    const levelCn = LEVEL_CN[r.maxLevel] || r.maxLevel;
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
                        <td style={td}><span style={{ padding: '2px 8px', borderRadius: 3, fontSize: 10, fontWeight: 600, background: LEVEL_BG[r.maxLevel] || '#f3f6f9', color: LEVEL_COLOR[r.maxLevel] || '#667085' }}>{levelCn}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}

      {/* ====== 风险阈值说明 ====== */}
      <SectionCard title="风险阈值说明" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 11 }}>
          <div style={{ flex: 1, minWidth: 200, background: '#e8f5e9', borderRadius: 4, padding: '8px 12px', border: '1px solid #a5d6a7' }}>
            <strong style={{ color: '#1f8a4c' }}>正常</strong>
            <div style={{ color: '#667085', marginTop: 2 }}>V ≥ 0.970 pu 且负载率未越限，预测负荷增长 ≤ 10%</div>
          </div>
          <div style={{ flex: 1, minWidth: 200, background: '#fff8e1', borderRadius: 4, padding: '8px 12px', border: '1px solid #ffe082' }}>
            <strong style={{ color: '#b8860b' }}>关注</strong>
            <div style={{ color: '#667085', marginTop: 2 }}>0.950 pu ≤ V &lt; 0.970 pu，或预测负荷增长 10%~15%</div>
          </div>
          <div style={{ flex: 1, minWidth: 200, background: '#ffebee', borderRadius: 4, padding: '8px 12px', border: '1px solid #ffcdd2' }}>
            <strong style={{ color: '#eb5757' }}>高风险</strong>
            <div style={{ color: '#667085', marginTop: 2 }}>V &lt; 0.950 pu，或预测负荷增长 &gt; 15%，或负载率越限</div>
          </div>
        </div>
      </SectionCard>

      {/* ====== 底部说明 ====== */}
      <div style={{ marginTop: 12, padding: '8px 14px', background: '#e3f0ff', borderRadius: 4, border: '1px solid #90caf9', fontSize: 11, color: '#1f2937' }}>
        💡 风险节点列表基于 <code>/api/forecast/realtime</code> 返回的实时预测结果；业务后端优先调用 IEEE33 算法服务，服务不可用时使用本地规则版兜底。
        {isLocalFallback && <span style={{ color: '#b8860b' }}> 当前为本地规则预测（<strong>置信度 low</strong>），PV/EV 为内置示例曲线，仅供风险预警参考，不作为正式操作依据。</span>}
      </div>
    </PageContainer>
  );
}

const sel: React.CSSProperties = { padding: '4px 8px', borderRadius: 4, border: '1px solid #c8d6e5', fontSize: 11, background: '#fff' };
const th: React.CSSProperties = { textAlign: 'left', padding: '6px 8px', fontWeight: 600, color: '#667085', fontSize: 11 };
const td: React.CSSProperties = { padding: '5px 8px', color: '#1f2937' };
