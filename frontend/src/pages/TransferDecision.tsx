import { useState, useEffect, useMemo } from 'react';
import PageContainer from '../layouts/PageContainer';
import SectionCard from '../components/SectionCard';
import WorkflowProgress from '../components/WorkflowProgress';
import { saveWorkflowState } from '../store/workflowStore';

// ---- 类型 ----
interface RealtimeLine { line: string; current_a: number; power_kw: number; status: number; }
interface RealtimeLatest { success: boolean; has_data?: boolean; lines?: RealtimeLine[]; }
interface ScoreBreakdown { recovery_score?:number; recovery_max?:number; loading_score?:number; loading_max?:number; loading_score_source?:string; voltage_score?:number; voltage_max?:number; operation_score?:number; operation_max?:number; full_restore_bonus?:number; full_restore_bonus_max?:number; total_score?:number; total_max?:number; loss_score?:number; risk_score?:number; total?:number; }
interface PowerFlow { converged?: boolean; min_voltage_pu?: number; max_voltage_pu?: number; max_loading_pct?: number; loss_kw?: number; }
interface TieLoadingDetail { line: string; estimated_transfer_kw: number | null; limit_kw: number | null; loading_rate: number | null; }
interface TransferPlanItem { rank: number; tie_name: string; tie_switch: string; tie_lines?: string[]; score: number; score_breakdown?: ScoreBreakdown; restored_nodes: number[]; restored_count: number; restored_load_kw: number; restoration_rate_pct: number; min_restored_voltage_pu: number | null; voltage_ok?: boolean | null; radial_ok?: boolean; overloaded?: boolean; is_usable?: boolean; tie_loading_pct: number | null; tie_loading_detail?: TieLoadingDetail[]; tie_current_a: number | null; tie_power_kw: number | null; switch_operations: number; still_outage_nodes: number[]; still_outage_count: number; warnings?: string[]; score_source?: string; external_score_used?: boolean; external_rank?: number | null; power_flow?: PowerFlow | null; violations?: any[]; }
interface EvalDiagnostics { external_score_available?: boolean; external_score_used_count?: number; external_score_algorithm?: string | null; external_score_timestamp?: string | null; score_mode?: string; }
interface EvalResult {
  success: boolean; has_data?: boolean; fault_line: string; outage_nodes: number[]; outage_count: number; outage_load_kw: number; total_load_kw: number;
  boundary_nodes?: string[]; boundary_edges?: {line:string;source_side:number;outage_side:number}[];
  total_plans: number; candidate_count?: number;
  recommended_plan: TransferPlanItem | null; plans: TransferPlanItem[]; warnings: string[]; message?: string;
  diagnostics?: EvalDiagnostics;
}

const TIE_LINES = new Set(['21-8','8-21','9-15','15-9','12-22','22-12','18-33','33-18','25-29','29-25']);
const TIE_NAMES: Record<string,string> = {'21-8':'T1','8-21':'T1','9-15':'T2','15-9':'T2','12-22':'T3','22-12':'T3','18-33':'T4','33-18':'T4','25-29':'T5','29-25':'T5'};

function fmtUnit(v: number, unit: string): string {
  if (!Number.isFinite(v)) return '--';
  if (unit === 'kW' && Math.abs(v) >= 1000) return (v / 1000).toFixed(2) + ' MW';
  if (unit === 'pu') return v.toFixed(3);
  if (unit === 'A') return v.toFixed(1);
  if (unit === '%') return v.toFixed(1) + '%';
  if (unit === 'score') return v.toFixed(2);
  return v.toFixed(1);
}

function normLineKey(ln: string): string { const p = ln.split('-'); if (p.length !== 2) return ln; const a = parseInt(p[0]), b = parseInt(p[1]); return isNaN(a) || isNaN(b) ? ln : a < b ? `${a}-${b}` : `${b}-${a}`; }

export default function TransferDecision() {
  // 从 localStorage 读取边界判定结果（归一化，与 option value / 后端键一致）
  const savedFault = normLineKey(localStorage.getItem('current_fault_line') || '8-9');
  const [faultLine, setFaultLine] = useState(savedFault);
  const [faultSource, setFaultSource] = useState(savedFault !== '8-9' || localStorage.getItem('current_fault_line') ? '边界判定结果' : '默认值');
  const [manualInput, setManualInput] = useState(false);
  const [showOpenLines, setShowOpenLines] = useState(false);

  const [realtimeLines, setRealtimeLines] = useState<RealtimeLine[]>([]);
  const [result, setResult] = useState<EvalResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedPlan, setSelectedPlan] = useState<TransferPlanItem | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  // 加载实时线路列表
  useEffect(() => {
    fetch('http://localhost:8000/api/realtime/latest')
      .then(r => r.json())
      .then((d: RealtimeLatest) => { if (d.lines) setRealtimeLines(d.lines); })
      .catch(() => {});
  }, []);

  // 可选线路
  const availableLines = useMemo(() => {
    return realtimeLines
      .filter(l => showOpenLines || l.status === 1)
      .map(l => ({
        ...l,
        normKey: normLineKey(l.line),
        isTie: TIE_LINES.has(l.line),
        tieName: TIE_NAMES[l.line] || '',
        label: `${l.line}｜${TIE_LINES.has(l.line) ? '联络线' : '主干线'}｜${l.status === 1 ? '闭合' : '断开'}｜I=${l.current_a?.toFixed(1) || 0}A｜P=${l.power_kw?.toFixed(1) || 0}kW`,
      }))
      .sort((a, b) => (a.isTie ? 1 : 0) - (b.isTie ? 1 : 0));
  }, [realtimeLines, showOpenLines]);

  // 校验线路是否存在
  const lineExists = useMemo(() => {
    if (!realtimeLines.length) return true; // 还没加载，先放行
    const nk = normLineKey(faultLine);
    return realtimeLines.some(l => normLineKey(l.line) === nk);
  }, [faultLine, realtimeLines]);

  const handleDecide = async () => {
    // 校验
    if (realtimeLines.length > 0 && !lineExists) {
      setError('线路不存在，请从实时线路列表中选择');
      return;
    }
    const posted = normLineKey(faultLine); // 以当前下拉框/输入框选中值为准
    setLoading(true); setError(''); setResult(null);
    try {
      const res = await fetch('http://localhost:8000/api/transfer/evaluate-realtime', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fault_line: posted }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: EvalResult = await res.json();
      if (!json.success) { setError(json.message || '转供评估失败'); return; }
      // 接口返回与当前选择不一致 → console.warn 并以接口返回为准
      if (json.fault_line && json.fault_line !== posted) {
        console.warn(`[transfer] 接口返回 fault_line=${json.fault_line} 与当前选择 ${posted} 不一致，以接口返回为准`);
      }
      if (json.fault_line) setFaultLine(json.fault_line);
      setResult(json);
      setSelectedPlan(json.recommended_plan);
      setConfirmed(false);
      // 成功返回后才写入 localStorage（避免旧值覆盖当前选择）
      localStorage.setItem('current_fault_line', json.fault_line || posted);
      localStorage.setItem('current_transfer_result', JSON.stringify(json));
    } catch (e: any) { setError('转供评估失败：' + (e.message || '请确认后端已启动')); }
    finally { setLoading(false); }
  };

  /** 统一处理故障线路变更：切换线路立即清除旧分析结果，保证顶栏/摘要/候选方案一致 */
  const changeFaultLine = (v: string, source: string) => {
    setFaultLine(v);
    setFaultSource(source);
    if (result && result.fault_line !== normLineKey(v)) {
      setResult(null);
      setSelectedPlan(null);
      setConfirmed(false);
    }
  };

  const plans: TransferPlanItem[] = result?.plans ?? [];
  const recommended = result?.recommended_plan;
  const boundaryEdges = result?.boundary_edges ?? [];
  const allTieCandidates = ['21-8','9-15','12-22','18-33','25-29'];

  return (
    <PageContainer title="转供决策">
      <WorkflowProgress currentStep="transfer" />

      {/* warnings */}
      {result?.warnings && result.warnings.length > 0 && result.warnings[0] !== '暂无实时数据，请先接入Simulink数据' && (
        <div style={{ background: '#fff8e1', border: '1px solid #f2c94c', borderRadius: 6, padding: '8px 14px', marginBottom: 12, fontSize: 12, color: '#b8860b' }}>
          ⚠️ {result.warnings.join('；')}
        </div>
      )}

      {/* 评分模式提示 */}
      {result?.diagnostics && (
        result.diagnostics.score_mode === 'external_matpower' ? (
          <div style={{ background: '#e3f0ff', border: '1px solid #90caf9', borderRadius: 6, padding: '6px 14px', marginBottom: 12, fontSize: 12, color: '#2f80ed' }}>
            🔬 评分模式：MATPOWER 外部评分（算法 {result.diagnostics.external_score_algorithm || '-'}，数据时间 {result.diagnostics.external_score_timestamp || '-'}，匹配 {result.diagnostics.external_score_used_count} 个方案）
          </div>
        ) : result.diagnostics.external_score_available ? (
          <div style={{ background: '#fff8e1', border: '1px solid #f2c94c', borderRadius: 6, padding: '6px 14px', marginBottom: 12, fontSize: 12, color: '#b8860b' }}>
            ⚠️ 外部评分结果未匹配当前故障或已过期，当前使用规则版评分
          </div>
        ) : (
          <div style={{ background: '#f3f6f9', border: '1px solid #c8d6e5', borderRadius: 6, padding: '6px 14px', marginBottom: 12, fontSize: 12, color: '#667085' }}>
            当前使用规则版评分（尚未接入外部 MATPOWER 评分结果）
          </div>
        )
      )}

      {/* 故障线路来源 */}
      <div style={{ marginBottom: 12, fontSize: 12, color: '#667085', background: '#f3f6f9', padding: '6px 12px', borderRadius: 4, display: 'flex', alignItems: 'center', gap: 8 }}>
        <span>当前故障线路：<strong style={{ color: '#eb5757' }}>{faultLine}</strong></span>
        <span>|</span>
        <span>来源：{faultSource}</span>
        {faultSource === '默认值' && <span style={{ fontSize: 10, color: '#94a3b8' }}>（可在边界判定页面设置后自动继承）</span>}
      </div>

      {/* 故障线路选择器 */}
      <SectionCard title="故障线路选择" style={{ marginBottom: 16 }}>
        {/* 实时线路下拉框 */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
          <span style={{ fontSize: 12, color: '#667085' }}>从实时线路选择：</span>
          <select value={faultLine} onChange={e => changeFaultLine(e.target.value, '手动选择')}
            style={{ padding: '5px 8px', borderRadius: 4, border: '1px solid #c8d6e5', fontSize: 11, background: '#fff', maxWidth: 400 }}>
            {realtimeLines.length === 0 && <option value="8-9">8-9 (默认，等待实时数据)</option>}
            {availableLines.map(l => (
              /* value 用归一化键，与后端返回/localStorage 保存的 fault_line 保持一致，避免受控 select 失配显示空白 */
              <option key={l.line} value={l.normKey}>{l.label}</option>
            ))}
          </select>
          <label style={{ fontSize: 11, color: '#667085', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
            <input type="checkbox" checked={showOpenLines} onChange={e => setShowOpenLines(e.target.checked)} />
            显示断开/联络线
          </label>
        </div>
        {/* 手动输入 */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <label style={{ fontSize: 11, color: '#667085', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
            <input type="checkbox" checked={manualInput} onChange={e => setManualInput(e.target.checked)} />
            手动输入线路
          </label>
          {manualInput && (
            <input value={faultLine} onChange={e => changeFaultLine(e.target.value, '手动输入')}
              style={{ padding: '5px 10px', borderRadius: 4, border: '1px solid #c8d6e5', fontSize: 12, width: 100 }} />
          )}
          {!lineExists && realtimeLines.length > 0 && (
            <span style={{ fontSize: 11, color: '#eb5757' }}>⚠ 线路不存在于实时数据中</span>
          )}
        </div>
        <div style={{ marginTop: 10 }}>
          <button onClick={handleDecide} disabled={loading || (!lineExists && realtimeLines.length > 0)} className="btn-primary">
            {loading ? '正在计算转供方案...' : '执行转供决策'}
          </button>
          {error && <span style={{ color: '#eb5757', fontSize: 12, marginLeft: 12 }}>❌ {error}</span>}
        </div>
      </SectionCard>

      {/* 故障摘要 */}
      {result && (
        <SectionCard title="故障分析摘要" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', fontSize: 13 }}>
            <span><span style={{ color: '#667085' }}>故障：</span><strong style={{ color: '#eb5757' }}>{result.fault_line}</strong></span>
            <span><span style={{ color: '#667085' }}>停电节点：</span><strong style={{ color: '#eb5757' }}>{result.outage_count} 个</strong></span>
            <span><span style={{ color: '#667085' }}>影响负荷：</span><strong style={{ color: '#eb5757' }}>{fmtUnit(result.outage_load_kw, 'kW')}</strong></span>
            <span><span style={{ color: '#667085' }}>候选方案：</span><strong style={{ color: '#1f8a4c' }}>{result.total_plans} 个</strong></span>
          </div>
          {result.outage_nodes.length > 0 && (
            <div style={{ marginTop: 6, fontSize: 12, color: '#667085' }}>
              停电节点：{result.outage_nodes.join(', ')}
            </div>
          )}
          {boundaryEdges.length > 0 && (
            <div style={{ marginTop: 4, fontSize: 12, color: '#667085' }}>
              边界边：{boundaryEdges.map(e => `${e.line}(live:${e.source_side}→out:${e.outage_side})`).join(', ')}
            </div>
          )}
        </SectionCard>
      )}

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {/* 左侧：候选方案 */}
        <div style={{ flex: 1, minWidth: 400 }}>
          <SectionCard title={`候选方案 (${plans.length})`}>
            {plans.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {plans.map(p => {
                  const isSel = selectedPlan?.tie_switch === p.tie_switch;
                  const isRec = recommended != null && recommended.tie_switch === p.tie_switch;
                  const unusable = p.is_usable === false;
                  const sb = p.score_breakdown;
                  return (
                  <div key={`${p.tie_switch}-${p.rank}`} onClick={() => { setSelectedPlan(p); setConfirmed(false); }} style={{
                    background: isSel ? '#e8f5e9' : '#fff',
                    border: isSel ? '2px solid #1f8a4c' : unusable ? '1px solid #f2c94c' : '1px solid #c8d6e5',
                    borderRadius: 6, padding: 12, fontSize: 12, cursor: 'pointer',
                    opacity: unusable ? 0.92 : 1,
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <input type="radio" checked={isSel} onChange={() => { setSelectedPlan(p); setConfirmed(false); }} style={{ cursor:'pointer' }} />
                        <strong style={{ color: unusable ? '#b8860b' : '#1f8a4c', fontSize: 14 }}>
                          #{p.rank} {p.tie_name} ({p.tie_switch})
                          {isRec && <span style={{fontSize:10,color:'#f2c94c',marginLeft:4}}>★系统推荐</span>}
                        </strong>
                        {p.score_source === 'external_matpower'
                          ? <span style={{ fontSize:10, background:'#e3f0ff', color:'#2f80ed', border:'1px solid #90caf9', borderRadius:3, padding:'1px 6px' }}>MATPOWER评分</span>
                          : <span style={{ fontSize:10, background:'#f3f6f9', color:'#667085', border:'1px solid #c8d6e5', borderRadius:3, padding:'1px 6px' }}>规则评分</span>}
                        {p.power_flow?.converged === false && <span style={{ fontSize:10, background:'#ffebee', color:'#eb5757', border:'1px solid #ffcdd2', borderRadius:3, padding:'1px 6px' }}>潮流不收敛</span>}
                        {p.overloaded && <span style={{ fontSize:10, background:'#ffebee', color:'#eb5757', border:'1px solid #ffcdd2', borderRadius:3, padding:'1px 6px' }}>过载风险</span>}
                        {p.radial_ok === false && <span style={{ fontSize:10, background:'#fff8e1', color:'#b8860b', border:'1px solid #ffe082', borderRadius:3, padding:'1px 6px' }}>可能成环，需解环操作</span>}
                        {unusable && <span style={{ fontSize:10, background:'#f3f6f9', color:'#667085', border:'1px solid #c8d6e5', borderRadius:3, padding:'1px 6px' }}>不可推荐</span>}
                      </div>
                      <span style={{ background: unusable ? '#94a3b8' : '#1f8a4c', color: '#fff', borderRadius: 4, padding: '2px 10px', fontSize: 13, fontWeight: 700 }}>
                        {p.score?.toFixed(1) ?? p.score} / 100
                      </span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', color: '#667085' }}>
                      <span>恢复节点：<strong style={{ color: '#1f2937' }}>{p.restored_count} 个</strong></span>
                      <span>恢复负荷：<strong style={{ color: '#1f2937' }}>{fmtUnit(p.restored_load_kw, 'kW')}</strong></span>
                      <span>恢复率：<strong style={{ color: '#1f8a4c' }}>{fmtUnit(p.restoration_rate_pct, '%')}</strong></span>
                      <span>最低电压：<strong style={{ color: p.min_restored_voltage_pu != null && p.min_restored_voltage_pu < 0.95 ? '#eb5757' : '#1f8a4c' }}>{p.min_restored_voltage_pu != null ? `${fmtUnit(p.min_restored_voltage_pu, 'pu')} pu` : '待潮流校验'}</strong></span>
                      <span>负载率：<strong style={{ color: p.overloaded ? '#eb5757' : '#1f2937' }}>{p.tie_loading_pct != null ? fmtUnit(p.tie_loading_pct, '%') : '待潮流校验'}</strong></span>
                      <span>开关操作：<strong>{p.switch_operations} 次</strong></span>
                    </div>
                    {p.tie_loading_detail && p.tie_loading_detail.length > 0 && (
                      <div style={{ marginTop: 4, fontSize: 10, color: '#94a3b8' }}>
                        {p.tie_loading_detail.map(d => (
                          <span key={d.line} style={{ marginRight: 10 }}>
                            {d.line}: {d.loading_rate != null ? `${d.estimated_transfer_kw}kW / ${d.limit_kw}kW (${(d.loading_rate * 100).toFixed(1)}%)` : '待潮流校验'}
                          </span>
                        ))}
                      </div>
                    )}
                    {p.power_flow && (
                      <div style={{ marginTop: 4, fontSize: 10, color: '#2f80ed', background: '#f0f7ff', padding: '3px 8px', borderRadius: 3 }}>
                        潮流：{p.power_flow.converged === false ? '✗ 不收敛' : '✓ 收敛'}
                        {p.power_flow.min_voltage_pu != null && ` | 最低电压 ${p.power_flow.min_voltage_pu.toFixed(3)} pu`}
                        {p.power_flow.max_voltage_pu != null && ` | 最高电压 ${p.power_flow.max_voltage_pu.toFixed(3)} pu`}
                        {p.power_flow.max_loading_pct != null && ` | 最大负载率 ${p.power_flow.max_loading_pct.toFixed(1)}%`}
                        {p.power_flow.loss_kw != null && ` | 网损 ${p.power_flow.loss_kw.toFixed(1)} kW`}
                      </div>
                    )}
                    {p.violations && p.violations.length > 0 && (
                      <div style={{ marginTop: 4, fontSize: 10, color: '#eb5757', background: '#fff5f5', padding: '3px 8px', borderRadius: 3 }}>
                        约束违例：{p.violations.map((v: any, vi: number) => (
                          <span key={vi} style={{ marginRight: 8 }}>
                            {typeof v === 'string' ? v : `${v.type || v.item || '违例'}${v.detail ? `: ${v.detail}` : ''}${v.severity ? ` [${v.severity}]` : ''}`}
                          </span>
                        ))}
                      </div>
                    )}
                    {p.warnings && p.warnings.length > 0 && (
                      <div style={{ marginTop: 4, fontSize: 10, color: '#b8860b' }}>⚠ {p.warnings.join('；')}</div>
                    )}
                    {sb && (
                      <details style={{ marginTop: 6, fontSize: 10, color: '#94a3b8' }}>
                        <summary style={{ cursor: 'pointer' }}>评分明细{p.score_source === 'external_matpower' ? '（MATPOWER）' : '（规则版）'}</summary>
                        <div style={{ padding: '4px 8px' }}>
                          {p.score_source === 'external_matpower' ? (
                            <>恢复 {sb.recovery_score ?? '--'} | 电压 {sb.voltage_score ?? '--'} | 负载 {sb.loading_score ?? '--'} | 网损 {sb.loss_score ?? '--'} | 操作 {sb.operation_score ?? '--'} | 风险 {sb.risk_score ?? '--'} | 合计 {sb.total ?? p.score}</>
                          ) : (
                            <>恢复率 {sb.recovery_score}/{sb.recovery_max} | 负载率 {sb.loading_score}/{sb.loading_max} ({sb.loading_score_source}) | 电压 {sb.voltage_score}/{sb.voltage_max} | 操作 {sb.operation_score}/{sb.operation_max} | 完全恢复奖励 {sb.full_restore_bonus}/{sb.full_restore_bonus_max}</>
                          )}
                        </div>
                      </details>
                    )}
                  </div>
                );})}
              </div>
            ) : result ? (
              /* 候选方案为 0 的诊断信息 */
              <div style={{ fontSize: 12, color: '#667085', lineHeight: 1.8 }}>
                <div style={{ marginBottom: 8, color: '#eb5757', fontWeight: 600 }}>未发现可用联络线</div>
                <table style={{ width: '100%' }}>
                  <tbody>
                    <tr><td style={{ color: '#94a3b8', width: 130 }}>故障线路</td><td><strong>{result.fault_line}</strong></td></tr>
                    <tr><td style={{ color: '#94a3b8' }}>停电节点</td><td>{result.outage_nodes?.join(', ') || '无'} ({result.outage_count} 个)</td></tr>
                    <tr><td style={{ color: '#94a3b8' }}>边界节点</td><td>{result.boundary_nodes?.join(', ') || '无'}</td></tr>
                    <tr><td style={{ color: '#94a3b8' }}>IEEE33 联络线</td><td>{allTieCandidates.join(', ')}</td></tr>
                    <tr><td style={{ color: '#94a3b8' }}>实时 status=0 线路</td><td>{realtimeLines.filter(l => l.status === 0).map(l => l.line).join(', ') || '无'}</td></tr>
                  </tbody>
                </table>
                <div style={{ marginTop: 10, padding: '8px 12px', background: '#e3f0ff', borderRadius: 4, border: '1px solid #90caf9', fontSize: 11 }}>
                  <strong>可能原因：</strong>
                  <ul style={{ margin: '4px 0 0 16px', padding: 0 }}>
                    <li>没有 status=0 的联络线连接停电区域和带电区域</li>
                    <li>实时 lines 中缺少联络线数据（当前{realtimeLines.length}条）</li>
                    <li>故障线路 downstream 全部断开，联络线不在停电区边界</li>
                    <li>当前实时拓扑非标准 IEEE 33 径向结构</li>
                  </ul>
                </div>
              </div>
            ) : (
              <div style={{ textAlign: 'center', padding: 30, color: '#94a3b8', fontSize: 13 }}>
                点击「执行转供决策」后，候选方案将在此显示
              </div>
            )}
          </SectionCard>
        </div>

        {/* 右侧：当前选中方案 */}
        <div style={{ flex: '0 0 320px' }}>
          {selectedPlan ? (
            <SectionCard title={recommended != null && selectedPlan.tie_switch === recommended.tie_switch ? '⭐ 当前选中方案 (系统推荐)' : '📋 当前选中方案 (人工选择)'} style={{ border: '2px solid #1f8a4c', borderLeft: '4px solid #1f8a4c' }}>
              <div style={{ fontSize: 13, lineHeight: 2.1 }}>
                <div><span style={{ color:'#667085' }}>来源：</span><strong>{recommended != null && selectedPlan.tie_switch === recommended.tie_switch ? '系统推荐' : '人工选择'}</strong></div>
                <div><span style={{ color:'#667085' }}>联络开关：</span><strong style={{ color:'#1f8a4c' }}>{selectedPlan.tie_name} ({selectedPlan.tie_switch})</strong></div>
                <div><span style={{ color:'#667085' }}>恢复负荷：</span><strong>{fmtUnit(selectedPlan.restored_load_kw,'kW')}</strong></div>
                <div><span style={{ color:'#667085' }}>恢复率：</span><strong style={{ color:'#1f8a4c' }}>{fmtUnit(selectedPlan.restoration_rate_pct,'%')}</strong></div>
                <div><span style={{ color:'#667085' }}>恢复节点数：</span><strong>{selectedPlan.restored_count} 个</strong></div>
                <div><span style={{ color:'#667085' }}>最低电压：</span><strong style={{ color:selectedPlan.min_restored_voltage_pu!=null&&selectedPlan.min_restored_voltage_pu<0.95?'#eb5757':'#1f8a4c' }}>{selectedPlan.min_restored_voltage_pu!=null?`${fmtUnit(selectedPlan.min_restored_voltage_pu,'pu')} pu`:'待潮流校验'}</strong></div>
                <div><span style={{ color:'#667085' }}>负载率：</span><strong style={{ color:selectedPlan.overloaded?'#eb5757':'#1f2937' }}>{selectedPlan.tie_loading_pct!=null?fmtUnit(selectedPlan.tie_loading_pct,'%'):'待潮流校验'}</strong></div>
                <div><span style={{ color:'#667085' }}>开关操作：</span><strong>{selectedPlan.switch_operations} 次</strong></div>
                {(selectedPlan.overloaded || selectedPlan.radial_ok === false) && (
                  <div style={{ background:'#ffebee', border:'1px solid #ffcdd2', borderRadius:4, padding:'6px 10px', marginTop:6, fontSize:11, color:'#eb5757' }}>
                    {selectedPlan.overloaded && <div>⚠ 过载风险：联络线预计转供功率超过容量限值</div>}
                    {selectedPlan.radial_ok === false && <div>⚠ 可能成环，需解环操作</div>}
                  </div>
                )}
                <div style={{ background:'#e8f5e9',borderRadius:6,padding:'10px 14px',marginTop:8 }}>
                  <span style={{fontSize:12,color:'#667085'}}>综合评分：</span>
                  <span style={{fontSize:22,fontWeight:700,color:'#1f8a4c'}}>{selectedPlan.score?.toFixed(1)??selectedPlan.score} / 100</span>
                </div>
                <div style={{ marginTop:8, fontSize:12, color:'#667085' }}>
                  {selectedPlan.restoration_rate_pct>=100?'完全恢复停电区域':''}
                  {selectedPlan.still_outage_count===0?'，无剩余停电节点':''}
                  {selectedPlan.min_restored_voltage_pu==null?'，电压待潮流校验':selectedPlan.min_restored_voltage_pu>=0.95?'，电压质量合格':'，需关注电压'}
                </div>
                <button className="btn-primary" style={{ width:'100%', marginTop:12, opacity: selectedPlan.is_usable === false ? 0.5 : 1, cursor: selectedPlan.is_usable === false ? 'not-allowed' : 'pointer' }}
                  disabled={selectedPlan.is_usable === false}
                  onClick={() => {
                    const planToSave = { ...selectedPlan, fault_line: result?.fault_line || faultLine, confirmed_at: new Date().toLocaleString('zh-CN') };
                    localStorage.setItem('current_selected_plan', JSON.stringify(planToSave));
                    localStorage.setItem('current_transfer_result', JSON.stringify(result));
                    saveWorkflowState({ transferPlan: planToSave });
                    setConfirmed(true);
                  }}>
                  {confirmed ? '✅ 已确认采用' : selectedPlan.is_usable === false ? '该方案不可采用' : '确认采用该方案'}
                </button>
                {selectedPlan.is_usable === false && (
                  <div style={{ marginTop:6, fontSize:11, color:'#b8860b', background:'#fff8e1', padding:'4px 8px', borderRadius:4 }}>
                    该方案存在{selectedPlan.overloaded ? '过载' : ''}{selectedPlan.overloaded && selectedPlan.radial_ok === false ? '和' : ''}{selectedPlan.radial_ok === false ? '成环' : ''}风险，不能确认采用，仅供分析参考。
                  </div>
                )}
                {confirmed && (
                  <div style={{ marginTop:6, fontSize:11, color:'#1f8a4c', background:'#e8f5e9', padding:'4px 8px', borderRadius:4 }}>
                    已采用方案 {selectedPlan.tie_name}，后续操作序列将基于该方案生成。
                  </div>
                )}
              </div>
            </SectionCard>
          ) : result ? (
            <SectionCard title="当前选中方案">
              <div style={{ textAlign:'center',padding:30,color:'#94a3b8',fontSize:13 }}>
                {plans.length > 0 && !recommended
                  ? '暂无安全可推荐方案，需人工复核。可从左侧人工选择方案查看详情。'
                  : '请从左侧候选方案中选择'}
              </div>
            </SectionCard>
          ) : (
            <SectionCard title="当前选中方案">
              <div style={{ textAlign:'center',padding:40,color:'#94a3b8',fontSize:13 }}>点击「执行转供决策」后，在此选择方案</div>
            </SectionCard>
          )}
        </div>
      </div>
    </PageContainer>
  );
}
