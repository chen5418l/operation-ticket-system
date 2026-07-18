import { useState } from 'react';
import PageContainer from '../layouts/PageContainer';
import StatusBadge from '../components/StatusBadge';
import SectionCard from '../components/SectionCard';

function fmt(v: unknown, d = 1): string { const n = Number(v); return Number.isFinite(n) ? n.toFixed(d) : '--'; }

interface ForecastStep { step: number; time_offset_min: number; forecast_hour?: number; total_load_kw: number; total_pv_kw: number; total_ev_kw: number; total_net_load_kw: number; }
interface NodeSeries { step: number; time_offset_min: number; forecast_hour?: number; forecast_load_kw: number; forecast_pv_kw: number; forecast_ev_kw: number; forecast_net_load_kw: number; }
interface NodeForecast { node: number; current_load_kw: number; current_pv_kw: number; current_ev_kw: number; current_net_load_kw: number; voltage_pu: number; risk_level: string; series: NodeSeries[]; }
interface ForecastResult { success: boolean; has_data?: boolean; message?: string; base_time?: string; base_hour?: number; forecast_mode?: string; time_source?: string; timestamp?: string; horizon?: number; interval_minutes?: number; current_total_load_kw: number; current_total_pv_kw: number; current_total_ev_kw: number; current_total_net_load_kw: number; forecast_series: ForecastStep[]; node_forecasts: NodeForecast[]; warnings: string[]; }

function getRisk(nf: NodeForecast): { reasons: string[]; maxLevel: string; maxNet: number; peakHour: number; growth: number } {
  const reasons: string[] = [];
  if (nf.voltage_pu < 0.97) reasons.push('电压偏低');
  if (nf.risk_level === 'high') reasons.push('高风险');
  if (nf.risk_level === 'medium') reasons.push('中风险');
  let maxNet = nf.current_net_load_kw, peakHour = 0;
  if (nf.series?.length) for (const s of nf.series) { if (s.forecast_net_load_kw > maxNet) { maxNet = s.forecast_net_load_kw; peakHour = s.forecast_hour ?? s.step; } }
  const cur = Math.max(nf.current_net_load_kw, 1);
  const growth = ((maxNet - cur) / cur) * 100;
  if (growth > 10) reasons.push('负荷增长>10%');
  const evPeak = nf.series?.length ? Math.max(...nf.series.map(s => s.forecast_ev_kw)) : nf.current_ev_kw;
  if (evPeak / Math.max(cur, 1) > 0.3) reasons.push('EV高峰占比较高');
  let maxLevel = nf.risk_level || 'low';
  if (nf.voltage_pu < 0.95 || growth > 15) maxLevel = 'high';
  else if (nf.voltage_pu < 0.97 || growth > 10) maxLevel = maxLevel === 'high' ? 'high' : 'medium';
  return { reasons: reasons.length > 0 ? reasons : ['正常'], maxLevel, maxNet, peakHour, growth };
}

const HORIZON_OPTIONS = [{ v:1, label:'未来1h' },{ v:6, label:'未来6h' },{ v:12, label:'未来12h' },{ v:24, label:'未来24h' }];

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

  const nodes: NodeForecast[] = result?.node_forecasts ?? [];
  const riskRows = nodes.map(nf => { const r = getRisk(nf); return { ...r, node: nf.node, voltage_pu: nf.voltage_pu, curNet: nf.current_net_load_kw, risk_level: nf.risk_level, isRisk: r.maxLevel !== 'low' || r.reasons[0] !== '正常' }; }).filter(r => r.isRisk);
  const filtered = filterLevel === '全部' ? riskRows : riskRows.filter(r => r.risk_level === filterLevel);
  const highCount = riskRows.filter(r => r.risk_level === 'high').length;
  const midCount = riskRows.filter(r => r.risk_level === 'medium').length;
  const steps = result?.forecast_series ?? [];
  const hLabel = `未来${horizon}小时`;

  // 数据时间：优先 API 返回的 timestamp (realtime 原始时间)
  const dataTime = result?.timestamp || result?.base_time || '--';
  const diag = (result as any)?.diagnostics;
  const pvZero = diag && !diag.field_check?.has_pv_kw;
  const evZero = diag && !diag.field_check?.has_ev_kw;

  return (
    <PageContainer title="源荷预测风险">
      {result?.warnings && result.warnings.length > 0 && result.warnings[0] !== '暂无实时数据，请先接入Simulink数据' && (
        <div style={{ background:'#fff8e1', border:'1px solid #f2c94c', borderRadius:6, padding:'8px 14px', marginBottom:12, fontSize:12, color:'#b8860b' }}>⚠️ {result.warnings.join('；')}</div>
      )}

      {/* 控制栏 */}
      <div style={{ display:'flex', gap:10, flexWrap:'wrap', alignItems:'center', marginBottom:12, padding:'10px 14px', background:'#f3f6f9', borderRadius:6, border:'1px solid #c8d6e5', fontSize:12 }}>
        <span style={{ fontWeight:600, color:'#1f2937' }}>{hLabel}源荷预测</span>
        <span style={{ fontSize:11, color:'#667085' }}>预测时域</span>
        <select value={horizon} onChange={e => setHorizon(Number(e.target.value))} style={sel}>
          {HORIZON_OPTIONS.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
        </select>
        <button onClick={handleQuery} disabled={loading} style={{ padding:'5px 14px', borderRadius:4, fontSize:11, cursor:'pointer', background:'#1f8a4c', color:'#fff', border:'none' }}>
          {loading ? '计算中...' : `刷新${hLabel}预测`}
        </button>
        <span style={{ color:'#c8d6e5' }}>|</span>
        <label style={{ fontSize:11, color:'#667085', cursor:'pointer', display:'flex', alignItems:'center', gap:4 }}>
          <input type="checkbox" checked={scenarioMode} onChange={e => setScenarioMode(e.target.checked)} style={{ cursor:'pointer' }} />
          场景推演模式
        </label>
        {scenarioMode && (
          <>
            <span style={{ fontSize:11, color:'#667085' }}>基准小时</span>
            <select value={baseHour} onChange={e => setBaseHour(Number(e.target.value))} style={sel}>
              {[0,6,8,10,12,14,16,18,20,22].map(h => <option key={h} value={h}>{String(h).padStart(2,'0')}:00</option>)}
            </select>
          </>
        )}
        {error && <span style={{ fontSize:11, color:'#e74c3c', flexBasis:'100%' }}>{error}</span>}
      </div>

      {scenarioMode && (
        <div style={{ background:'#fff8e1', border:'1px solid #f2c94c', borderRadius:4, padding:'6px 12px', marginBottom:12, fontSize:11, color:'#b8860b' }}>
          ⚠️ 当前为场景推演模式，基准时间由用户手动指定，结果仅用于分析参考。
        </div>
      )}

      {/* 数据信息条 */}
      {result && (
        <div style={{ display:'flex', gap:16, flexWrap:'wrap', alignItems:'center', marginBottom:12, padding:'6px 12px', background:'#e8f5e9', borderRadius:4, border:'1px solid #a5d6a7', fontSize:11, color:'#1f8a4c' }}>
          <span>📡 Simulink 实时数据</span><span>|</span>
          <span>实时数据时间：{dataTime}</span>
          {scenarioMode && result.base_hour != null && <><span>|</span><span>场景基准小时：{result.base_hour}:00</span></>}
          <span>|</span>
          <span>模式：{result.forecast_mode === 'scenario' ? '🔧 场景推演' : '🔄 实时滚动预测'}</span><span>|</span>
          <span>时域：{hLabel} (间隔{result.interval_minutes ?? 60}分钟)</span>
        </div>
      )}

      {(pvZero || evZero) && result && (
        <div style={{ marginBottom:10, padding:'6px 10px', background:'#e3f0ff', borderRadius:4, border:'1px solid #90caf9', fontSize:11, color:'#2f80ed' }}>
          💡 Simulink 实时数据中 {[pvZero&&'光伏出力',evZero&&'EV负荷'].filter(Boolean).join('和')} 为 0，预测中 PV/EV 将均为 0，待张同学 Simulink 模型加入光伏/电动车数据后将自动更新。
        </div>
      )}

      {/* 当前总览 */}
      {result && (
        <div style={{ display:'flex', gap:12, flexWrap:'wrap', marginBottom:16 }}>
          {[
            { l:'当前总负荷 (33节点合计)', v:result.current_total_load_kw, u:'kW', c:'#2f80ed' },
            { l:'光伏出力', v:result.current_total_pv_kw, u:'kW', c:'#f2c94c' },
            { l:'EV负荷', v:result.current_total_ev_kw, u:'kW', c:'#eb5757' },
            { l:'净负荷', v:result.current_total_net_load_kw, u:'kW', c:'#1f8a4c' },
          ].map(card => (
            <div key={card.l} style={{ flex:1, minWidth:140, background:'#fff', borderRadius:6, border:'1px solid #c8d6e5', padding:'12px 16px' }}>
              <div style={{ fontSize:11, color:'#667085', marginBottom:4 }}>{card.l}</div>
              <div style={{ fontSize:20, fontWeight:700, color:card.c }}>{fmt(card.v)} <span style={{fontSize:11,fontWeight:400,color:'#94a3b8'}}>{card.u}</span></div>
            </div>
          ))}
        </div>
      )}

      {/* 预测序列表 */}
      {steps.length > 0 && (
        <SectionCard title={`${hLabel}预测序列 (${steps.length}点)`} style={{ marginBottom:16 }}>
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
              <thead><tr style={{ background:'#f3f6f9' }}>
                <th style={th}>步</th><th style={th}>小时</th><th style={th}>总负荷(kW)</th><th style={th}>PV(kW)</th><th style={th}>EV(kW)</th><th style={th}>净负荷(kW)</th>
              </tr></thead>
              <tbody>
                {steps.map(s => (
                  <tr key={s.step} style={{ borderBottom:'1px solid #f0f0f0' }}>
                    <td style={td}>{s.step}</td>
                    <td style={{...td, fontWeight:600}}>T+{s.step}h ({s.forecast_hour ?? '-'}:00)</td>
                    <td style={{...td, fontWeight:600}}>{fmt(s.total_load_kw)}</td>
                    <td style={{...td, color:'#f2c94c'}}>{fmt(s.total_pv_kw)}</td>
                    <td style={{...td, color:'#eb5757'}}>{fmt(s.total_ev_kw)}</td>
                    <td style={{...td, fontWeight:700, color:'#1f8a4c'}}>{fmt(s.total_net_load_kw)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      )}

      {/* 风险节点 */}
      <SectionCard title="风险节点列表" extra={
        <div style={{ display:'flex', gap:6, alignItems:'center' }}>
          {['全部','high','medium'].map(lv => (
            <button key={lv} onClick={() => setFilterLevel(lv)}
              style={{ padding:'4px 12px', border:`1px solid ${filterLevel===lv?'#1f8a4c':'#c8d6e5'}`, borderRadius:4, background:filterLevel===lv?'#e8f5e9':'#fff', color:filterLevel===lv?'#1f8a4c':'#667085', fontSize:12, cursor:'pointer', fontWeight:filterLevel===lv?600:400 }}>{lv==='全部'?'全部':lv==='high'?'高风险':'中风险'}</button>
          ))}
          <span style={{ fontSize:11, color:'#667085', marginLeft:4 }}>全部:{riskRows.length} | 高:{highCount} | 中:{midCount}</span>
        </div>
      } style={{ marginBottom:16 }}>
        {riskRows.length > 0 ? (
          <div style={{ maxHeight:400, overflowY:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
              <thead><tr style={{ background:'#f3f6f9' }}>
                <th style={th}>节点</th><th style={th}>电压(pu)</th><th style={th}>当前净负荷</th><th style={th}>{hLabel}峰值净负荷</th><th style={th}>峰值时刻</th><th style={th}>增长率</th><th style={th}>风险</th><th style={th}>原因</th>
              </tr></thead>
              <tbody>
                {filtered.map(r => (
                  <tr key={r.node} style={{ borderBottom:'1px solid #f0f0f0' }}>
                    <td style={td}><strong>Bus {r.node}</strong></td>
                    <td style={{...td, color:r.voltage_pu<0.95?'#eb5757':r.voltage_pu<0.97?'#f2c94c':'#1f2937', fontWeight:600}}>{r.voltage_pu.toFixed(4)}</td>
                    <td style={td}>{fmt(r.curNet)} kW</td>
                    <td style={td}>{fmt(r.maxNet)} kW</td>
                    <td style={td}>{r.peakHour}:00</td>
                    <td style={{...td, color:r.growth>10?'#eb5757':r.growth>5?'#f2c94c':'#1f2937'}}>{r.growth>0?'+':''}{r.growth.toFixed(1)}%</td>
                    <td style={td}><StatusBadge status={r.risk_level} /></td>
                    <td style={td}>{r.reasons}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : !loading ? (
          <div style={{ textAlign:'center', padding:40, color:'#94a3b8', fontSize:13 }}>点击"刷新{hLabel}预测"后，风险节点将在此显示</div>
        ) : (
          <div style={{ textAlign:'center', padding:40, color:'#94a3b8', fontSize:13 }}>加载中...</div>
        )}
      </SectionCard>

      {/* 节点明细 */}
      {nodes.length > 0 && (
        <SectionCard title={<span onClick={() => setShowDetail(!showDetail)} style={{ cursor:'pointer' }}>节点预测明细 ({nodes.length}节点) {showDetail?'▲':'▶'}</span>} style={{ marginBottom:16 }}>
          {showDetail && (
            <div style={{ maxHeight:500, overflowY:'auto' }}>
              <table style={{ width:'100%', borderCollapse:'collapse', fontSize:11 }}>
                <thead><tr style={{ background:'#f3f6f9' }}>
                  <th style={th}>节点</th><th style={th}>负荷</th><th style={th}>PV</th><th style={th}>EV</th><th style={th}>净负荷</th><th style={th}>{hLabel}峰值净负荷</th><th style={th}>峰值时刻</th><th style={th}>电压</th><th style={th}>风险</th>
                </tr></thead>
                <tbody>
                  {nodes.map(nf => { const r = getRisk(nf); return (
                    <tr key={nf.node} style={{ borderBottom:'1px solid #f0f0f0', background:nf.risk_level==='high'?'#fff5f5':nf.risk_level==='medium'?'#fffff0':'transparent' }}>
                      <td style={td}><strong>Bus {nf.node}</strong></td>
                      <td style={td}>{fmt(nf.current_load_kw)}</td><td style={td}>{fmt(nf.current_pv_kw)}</td><td style={td}>{fmt(nf.current_ev_kw)}</td>
                      <td style={{...td, fontWeight:600}}>{fmt(nf.current_net_load_kw)}</td>
                      <td style={{...td, fontWeight:600, color:'#1f8a4c'}}>{fmt(r.maxNet)}</td>
                      <td style={td}>{r.peakHour}:00</td>
                      <td style={{...td, color:nf.voltage_pu<0.95?'#eb5757':nf.voltage_pu<0.97?'#f2c94c':'#1f2937'}}>{nf.voltage_pu.toFixed(4)}</td>
                      <td style={td}><StatusBadge status={nf.risk_level} /></td>
                    </tr>
                  );})}
                </tbody>
              </table>
            </div>
          )}
        </SectionCard>
      )}

      <div style={{ marginTop:12, padding:'8px 14px', background:'#e3f0ff', borderRadius:4, border:'1px solid #90caf9', fontSize:11, color:'#1f2937' }}>
        💡 预测时域最长支持24小时。风险节点基于 <code>/api/forecast/realtime</code> 返回的实时源荷预测结果生成，综合考虑节点电压、风险等级、所选预测时域内净负荷峰值增长率和EV负荷高峰。
      </div>
    </PageContainer>
  );
}

const sel: React.CSSProperties = { padding:'4px 8px', borderRadius:4, border:'1px solid #c8d6e5', fontSize:11, background:'#fff' };
const th: React.CSSProperties = { textAlign:'left', padding:'6px 8px', fontWeight:600, color:'#667085', fontSize:11 };
const td: React.CSSProperties = { padding:'5px 8px', color:'#1f2937' };
