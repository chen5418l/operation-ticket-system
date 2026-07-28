import { useState, useEffect, useMemo, useRef } from 'react';
import PageContainer from '../layouts/PageContainer';
import SectionCard from '../components/SectionCard';
import WorkflowProgress from '../components/WorkflowProgress';
import { saveCurrentWorkflow, getCurrentWorkflow } from '../store/workflowStore';

/* ==================== 类型 ==================== */
interface RealtimeLine { line: string; current_a: number; power_kw: number; status: number; }
interface ScoreBreakdown { recovery_score?:number; recovery_max?:number; loading_score?:number; loading_max?:number; loading_score_source?:string; voltage_score?:number; voltage_max?:number; operation_score?:number; operation_max?:number; full_restore_bonus?:number; full_restore_bonus_max?:number; total_score?:number; total_max?:number; loss_score?:number; risk_score?:number; total?:number; }
interface PowerFlow { converged?: boolean; min_voltage_pu?: number; max_loading_pct?: number; loss_kw?: number; }
interface TieLoadingDetail { line: string; estimated_transfer_kw: number | null; limit_kw: number | null; loading_rate: number | null; }
interface TransferPlanItem { rank: number; tie_name: string; tie_switch: string; tie_lines?: string[]; score: number; score_breakdown?: ScoreBreakdown; restored_nodes: number[]; restored_count: number; restored_load_kw: number; restoration_rate_pct: number; min_restored_voltage_pu: number | null | undefined; radial_ok?: boolean; overloaded?: boolean; is_usable?: boolean; tie_loading_pct: number | null | undefined; tie_loading_detail?: TieLoadingDetail[]; switch_operations: number; still_outage_nodes: number[]; still_outage_count: number; warnings?: string[]; score_source?: string; external_score_used?: boolean; power_flow?: PowerFlow | null; violations?: any[]; plan_id?: string; }
interface ExternalCandidate { plan_id: string; tie_ids: string[]; tie_lines: string[]; restored_nodes?: number[]; topology_feasible?: boolean; radial?: boolean; is_feasible?: boolean; source?: string; reject_reason?: string; }
interface EvalResult { success: boolean; fault_line: string; outage_nodes: number[]; outage_count: number; outage_load_kw: number; total_load_kw: number; total_plans: number; recommended_plan: TransferPlanItem | null; plans: TransferPlanItem[]; candidate_plans?: TransferPlanItem[]; external_feasible_candidates?: ExternalCandidate[]; external_rejected_candidates?: ExternalCandidate[]; warnings: string[]; message?: string; diagnostics?: any; algorithm_source?: string; status?: string; job_id?: string; }
interface PendingJobResult { success: boolean; status?: string; job_state?: string; result_available?: boolean; scored_plans?: TransferPlanItem[] | null; candidate_plans?: TransferPlanItem[] | null; recommended_plan_id?: string | null; warnings?: string[]; error_message?: string; }

const TIE_LINES = new Set(['21-8','8-21','9-15','15-9','12-22','22-12','18-33','33-18','25-29','29-25']);
const TIE_NAMES: Record<string,string> = {'21-8':'T1','8-21':'T1','9-15':'T2','15-9':'T2','12-22':'T3','22-12':'T3','18-33':'T4','33-18':'T4','25-29':'T5','29-25':'T5'};

function fmtUnit(v: number, unit: string): string {
  if (!Number.isFinite(v)) return '--';
  if (unit === 'kW' && Math.abs(v) >= 1000) return (v / 1000).toFixed(2) + ' MW';
  if (unit === 'pu') return v.toFixed(3); if (unit === 'A') return v.toFixed(1);
  if (unit === '%') return v.toFixed(1) + '%'; return v.toFixed(1);
}
function normLineKey(ln: string): string { const p = ln.split('-'); if (p.length !== 2) return ln; const a = parseInt(p[0]), b = parseInt(p[1]); return isNaN(a) || isNaN(b) ? ln : a < b ? `${a}-${b}` : `${b}-${a}`; }

export default function TransferDecision() {
  const initWf = getCurrentWorkflow();
  if (initWf && !initWf.fault_line) { try { localStorage.removeItem('currentWorkflow'); } catch {} }
  const savedFault = normLineKey(initWf?.fault_line || '8-9');
  const [faultLine, setFaultLine] = useState(savedFault);
  const [showOpenLines, setShowOpenLines] = useState(false);
  const [realtimeLines, setRealtimeLines] = useState<RealtimeLine[]>([]);
  const [result, setResult] = useState<EvalResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedPlan, setSelectedPlan] = useState<TransferPlanItem | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [pendingJobId, setPendingJobId] = useState('');
  const [queryingJob, setQueryingJob] = useState(false);
  const [pendingResult, setPendingResult] = useState<TransferPlanItem[] | null>(null);
  const [jobFailed, setJobFailed] = useState(false);
  const [jobFailedMsg, setJobFailedMsg] = useState('');

  function enrichScoredPlans(scored: any[], candidates: ExternalCandidate[], evalResult: EvalResult | null) {
    const outageNodes: number[] = (evalResult as any)?.outage_nodes || [];
    const outageLoad: number = (evalResult as any)?.outage_load_kw || 0;
    return scored.map((sp: any) => {
      const spTls = sp.tie_lines || sp.power_flow?.tie_lines || [];
      const spId = sp.plan_id || '';
      let cand = candidates.find(c => { const cTls = c.tie_lines || []; return cTls.length === spTls.length && cTls.every((tl: string) => spTls.includes(tl)); });
      if (!cand && spId) { const m = spId.match(/(\d+)$/); if (m) cand = candidates.find(c => (c.plan_id || '').endsWith(m[1])); }
      const tieName = cand ? (cand.tie_ids || []).join('+') : (sp.tie_name || '');
      const tieSwitch = cand ? (cand.tie_lines || []).join('+') : (sp.tie_switch || spTls.join('+'));
      const restoredNodes = cand?.restored_nodes || sp.restored_nodes || [];
      const nodeRatio = outageNodes.length > 0 ? restoredNodes.length / outageNodes.length : 0;
      const estLoad = restoredNodes.length > 0 && outageLoad > 0 ? Math.round(outageLoad * nodeRatio) : 0;
      return { ...sp, rank: sp.rank || 0, plan_id: cand?.plan_id || spId, tie_name: tieName, tie_switch: tieSwitch, tie_lines: cand?.tie_lines || spTls, restored_nodes: restoredNodes, restored_count: restoredNodes.length, restored_load_kw: estLoad || sp.restored_load_kw || 0, restoration_rate_pct: Math.min(100.0, Math.round((sp.restoration_rate_pct || (outageLoad > 0 ? (estLoad / outageLoad) * 100 : nodeRatio * 100)) * 10) / 10), min_restored_voltage_pu: (sp.power_flow || {}).min_voltage_pu ?? sp.min_restored_voltage_pu, tie_loading_pct: (sp.power_flow || {}).max_loading_pct ?? sp.tie_loading_pct, switch_operations: cand ? (cand.tie_ids || []).length : (sp.switch_operations || 1), still_outage_nodes: [], still_outage_count: 0, radial_ok: true, overloaded: (sp.power_flow || {}).max_loading_pct != null && (sp.power_flow || {}).max_loading_pct > 100, is_usable: true, score_source: sp.score_source || 'external_powerflow', external_score_used: true, power_flow: sp.power_flow || {}, violations: sp.violations || [], warnings: sp.warnings || [] } as TransferPlanItem;
    });
  }

  useEffect(() => { fetch('http://localhost:8000/api/realtime/latest').then(r => r.json()).then((d: any) => { if (d.lines) setRealtimeLines(d.lines); }).catch(() => {}); }, []);

  const autoQueryTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!pendingJobId || pendingResult || jobFailed) return;
    const queryOnce = async () => {
      try {
        const res = await fetch(`http://localhost:8000/api/transfer/jobs/${pendingJobId}/result`);
        if (!res.ok) return;
        const json: PendingJobResult = await res.json();
        if (json.status === 'pending' || json.job_state === 'pending' || json.job_state === 'running' || json.result_available === false) return;
        if (autoQueryTimer.current) { clearInterval(autoQueryTimer.current); autoQueryTimer.current = null; }
        if (json.status === 'failed' || json.status === 'timeout' || json.success === false) { setJobFailed(true); setJobFailedMsg((json as any).error_message || (json.warnings || ['外部评分失败']).join('；')); return; }
        if (json.status === 'completed') {
          const scored = json.scored_plans || json.candidate_plans || [];
          if (scored.length > 0) {
            const merged = enrichScoredPlans(scored, extFeasible, result);
            setPendingResult(merged);
            const recId = json.recommended_plan_id;
            if (recId) { const rec = merged.find((p: any) => p.plan_id === recId); if (rec) setSelectedPlan(rec as TransferPlanItem); }
          }
        }
      } catch {}
    };
    queryOnce();
    autoQueryTimer.current = setInterval(queryOnce, 5000);
    return () => { if (autoQueryTimer.current) { clearInterval(autoQueryTimer.current); autoQueryTimer.current = null; } };
  }, [pendingJobId, pendingResult, jobFailed]);

  const availableLines = useMemo(() => realtimeLines.filter(l => showOpenLines || l.status === 1).map(l => ({ ...l, normKey: normLineKey(l.line), isTie: TIE_LINES.has(l.line), tieName: TIE_NAMES[l.line] || '', label: `${l.line} | ${TIE_LINES.has(l.line) ? '联络线' : '主干线'} | ${l.status === 1 ? '合' : '开'} | ${l.current_a?.toFixed(1) || 0}A | ${l.power_kw?.toFixed(1) || 0}kW` })).sort((a, b) => (a.isTie ? 1 : 0) - (b.isTie ? 1 : 0)), [realtimeLines, showOpenLines]);
  const lineExists = useMemo(() => { if (!realtimeLines.length) return true; return realtimeLines.some(l => normLineKey(l.line) === normLineKey(faultLine)); }, [faultLine, realtimeLines]);

  const handleDecide = async () => {
    if (realtimeLines.length > 0 && !lineExists) { setError('线路不存在'); return; }
    const posted = normLineKey(faultLine);
    setLoading(true); setError(''); setResult(null); setPendingJobId(''); setPendingResult(null); setJobFailed(false); setJobFailedMsg('');
    try {
      const [recResp, evalResp] = await Promise.all([
        fetch('http://localhost:8000/api/transfer/recommend-realtime', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fault_line: posted, evaluation_mode: 'auto', max_ties: 2 }) }),
        fetch('http://localhost:8000/api/transfer/evaluate-realtime', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fault_line: posted }) }),
      ]);
      const recJson = await recResp.json(); const evalJson = evalResp.ok ? await evalResp.json() : null;
      const recOk = recJson.success !== false || (recJson as any).algorithm_source === 'external_pending';
      const evalOk = evalJson?.success !== false;
      const base = evalOk ? evalJson : recJson;
      const merged: any = { ...(base || {}), ...(recOk ? recJson : {}), success: evalOk ? true : (recOk ? recJson.success : false),
        recommended_plan: evalOk ? (evalJson as any)?.recommended_plan : (recOk ? (recJson as any)?.recommended_plan : null),
        plans: evalOk ? ((evalJson as any)?.plans ?? []) : (recOk ? ((recJson as any)?.plans ?? []) : []),
        external_feasible_candidates: (evalJson as any)?.external_feasible_candidates ?? (recJson as any)?.external_feasible_candidates ?? [],
        external_rejected_candidates: (evalJson as any)?.external_rejected_candidates ?? (recJson as any)?.external_rejected_candidates ?? [],
        fault_line: (evalJson as any)?.fault_line || (recJson as any)?.fault_line || posted,
        outage_nodes: (evalJson as any)?.outage_nodes ?? (recJson as any)?.outage_nodes ?? [],
        outage_count: (evalJson as any)?.outage_count ?? (recJson as any)?.outage_count ?? 0,
        outage_load_kw: (evalJson as any)?.outage_load_kw ?? (recJson as any)?.outage_load_kw ?? 0,
        total_load_kw: (evalJson as any)?.total_load_kw ?? (recJson as any)?.total_load_kw ?? 0,
        total_plans: Math.max((evalJson as any)?.total_plans ?? 0, (recJson as any)?.total_plans ?? 0),
      };
      const evalWarns: string[] = (evalJson as any)?.warnings ?? []; const recWarns: string[] = (recJson as any)?.warnings ?? [];
      merged.warnings = [...evalWarns, ...recWarns.filter((w: string) => !evalWarns.includes(w))];
      if (!merged.success && !(merged as any).algorithm_source && !(merged as any).job_id && !(merged as any).plans?.length) { setError((merged as any).message || '转供评估失败'); return; }
      if (merged.fault_line) setFaultLine(merged.fault_line);
      if ((recJson as any).algorithm_source === 'external_pending' || (recJson as any).status === 'pending' || (evalJson as any)?.algorithm_source === 'external_pending') { setPendingJobId(((recJson as any).job_id || (evalJson as any)?.job_id) || ''); }
      if ((evalJson as any)?.diagnostics?.candidates_source === 'external_candidates') { merged.diagnostics = { ...(merged.diagnostics || {}), candidates_source: 'external_candidates' }; }
      setResult(merged as EvalResult);
      const bestPlan = (merged as any).recommended_plan || ((merged as any).plans?.length > 0 ? (merged as any).plans.find((p: any) => p.is_usable !== false) ?? (merged as any).plans[0] : null);
      setSelectedPlan(bestPlan || null); setConfirmed(false); setPendingResult(null);
      const algoSource = (recJson as any).algorithm_source || (evalJson as any)?.algorithm_source || '';
      saveCurrentWorkflow({ fault_line: merged.fault_line || posted, transfer_result: merged, transfer_status: algoSource === 'external_pending' ? 'external_pending' : algoSource === 'external' ? 'completed' : 'local_fallback', job_id: (recJson as any).job_id || (evalJson as any)?.job_id || undefined, selected_plan: undefined, selected_plan_id: undefined, selected_tie_ids: undefined, selected_tie_lines: undefined, operation_sequence: undefined, sequence_result: undefined, ticket: undefined, safety_result: undefined });
    } catch (e: any) { setError('转供评估失败：' + (e.message || '请确认后端已启动')); }
    finally { setLoading(false); }
  };

  const handleQueryJob = async (jobId: string) => { /* same as useEffect poll */ setQueryingJob(true); setJobFailed(false); setJobFailedMsg(''); try { const res = await fetch(`http://localhost:8000/api/transfer/jobs/${jobId}/result`); if (!res.ok) throw new Error(`HTTP ${res.status}`); const json: PendingJobResult = await res.json(); const isStillPending = json.status === 'pending' || json.job_state === 'pending' || json.job_state === 'running' || json.result_available === false; if (isStillPending) { setPendingResult(null); return; } if (json.status === 'failed' || json.status === 'timeout' || json.success === false) { setJobFailed(true); setJobFailedMsg((json as any).error_message || (json.warnings || ['外部评分失败']).join('；')); setPendingResult(null); return; } if (json.status === 'completed') { const scored = json.scored_plans || json.candidate_plans || []; if (scored.length > 0) { const merged = enrichScoredPlans(scored, extFeasible, result); setPendingResult(merged); const recId = json.recommended_plan_id; if (recId) { const rec = merged.find((p: any) => p.plan_id === recId); if (rec) setSelectedPlan(rec as TransferPlanItem); } } else { setPendingResult(null); } } } catch (e: any) { console.warn('查询失败:', e.message); } finally { setQueryingJob(false); } };

  const changeFaultLine = (v: string) => { setFaultLine(v); setResult(null); setSelectedPlan(null); setConfirmed(false); setPendingJobId(''); setPendingResult(null); setJobFailed(false); setJobFailedMsg(''); setError(''); };

  const isPending = !pendingResult && ((result as any)?.algorithm_source === 'external_pending' || (result as any)?.status === 'pending');
  const jobId = (result as any)?.job_id || pendingJobId;
  const extFeasible: ExternalCandidate[] = (result as any)?.external_feasible_candidates ?? [];
  const extRejected: ExternalCandidate[] = (result as any)?.external_rejected_candidates ?? [];
  const scoredReady = pendingResult !== null && pendingResult.length > 0;
  const hasExternalCands = !scoredReady && (extFeasible.length > 0 || extRejected.length > 0);
  const localPlans: TransferPlanItem[] = result?.plans ?? [];
  const plans: TransferPlanItem[] = scoredReady ? pendingResult : (hasExternalCands ? [] : localPlans);
  const recommended = result?.recommended_plan;
  const boundaryEdges = result?.boundary_edges ?? [];

  const handleConfirm = () => {
    if (!selectedPlan || !result) return;
    const planId = (selectedPlan as any).plan_id || selectedPlan.tie_switch;
    const tieIds = selectedPlan.tie_name ? selectedPlan.tie_name.split('+').map((t: string) => t.trim()) : [];
    const tieLines = selectedPlan.tie_lines || [selectedPlan.tie_switch];
    const planToSave = { ...selectedPlan, fault_line: result.fault_line || faultLine, confirmed_at: new Date().toLocaleString('zh-CN') };
    saveCurrentWorkflow({ fault_line: result.fault_line || faultLine, transfer_result: result as any, transfer_status: scoredReady ? 'completed' : isPending ? 'external_pending' : 'local_fallback', job_id: (result as any)?.job_id || pendingJobId || undefined, selected_plan_id: planId, selected_plan: planToSave, selected_tie_ids: tieIds, selected_tie_lines: tieLines, operation_sequence: undefined, sequence_result: undefined, ticket: undefined, safety_result: undefined });
    setConfirmed(true);
  };

  return (
    <PageContainer title="转供决策">
      <WorkflowProgress currentStep="transfer" />

      {/* ====== 统一状态横幅 ====== */}
      {(() => {
        if (scoredReady) return <div style={{ background:'#e8f5e9', border:'2px solid #1f8a4c', borderRadius:6, padding:'8px 14px', marginBottom:12, fontSize:12, color:'#1f8a4c' }}>✅ 外部潮流评分已完成 · 推荐 <strong>{pendingResult![0]?.plan_id}</strong> · 评分 <strong>{pendingResult![0]?.score?.toFixed(1)}/100</strong> · 后续需操作序列、安全校验和人工审核</div>;
        if (jobFailed) return <div style={{ background:'#ffebee', border:'2px solid #eb5757', borderRadius:6, padding:'8px 14px', marginBottom:12, fontSize:12, color:'#eb5757' }}>🚫 外部评分失败：{jobFailedMsg || '未知错误'} — 不可生成正式操作票</div>;
        if (isPending && jobId) return <div style={{ background:'#e3f0ff', border:'1px solid #90caf9', borderRadius:6, padding:'6px 14px', marginBottom:12, fontSize:12, color:'#2f80ed' }}>🔬 外部评分计算中，当前展示规则版预评估，完成后自动更新</div>;
        if (result?.warnings) {
          const hasPlans = (result.plans?.length ?? 0) > 0 || (pendingResult?.length ?? 0) > 0;
          const extDownKeywords = ['外部转供决策算法服务暂不可用', '外部候选方案接口暂不可用', '已提交任务 job_id='];
          const substantive = result.warnings.filter(w => { if (w === '暂无实时数据，请先接入Simulink数据') return false; if (hasPlans && extDownKeywords.some(kw => w.includes(kw))) return false; return true; });
          if (substantive.length > 0) return <div style={{ background:'#fff8e1', border:'1px solid #f2c94c', borderRadius:6, padding:'6px 14px', marginBottom:12, fontSize:11, color:'#b8860b' }}>⚠️ {substantive.join('；')}</div>;
        }
        return null;
      })()}

      {/* ====== 故障线路 + 执行按钮（紧凑行） ====== */}
      <div style={{ display:'flex', gap:10, flexWrap:'wrap', alignItems:'center', marginBottom:14, padding:'10px 14px', background:'#fff', borderRadius:6, border:'1px solid #c8d6e5', fontSize:12 }}>
        <span style={{ fontWeight:600, color:'#1f2937' }}>故障线路</span>
        <select value={faultLine} onChange={e => changeFaultLine(e.target.value)} style={{ padding:'5px 8px', borderRadius:4, border:'1px solid #c8d6e5', fontSize:11, maxWidth:380 }}>
          {realtimeLines.length === 0 && <option value="8-9">8-9 (默认)</option>}
          {availableLines.map(l => <option key={l.line} value={l.normKey}>{l.label}</option>)}
        </select>
        <label style={{ fontSize:10, color:'#667085', cursor:'pointer', display:'flex', alignItems:'center', gap:3 }}><input type="checkbox" checked={showOpenLines} onChange={e => setShowOpenLines(e.target.checked)} /> 断开/联络线</label>
        <button onClick={handleDecide} disabled={loading || (!lineExists && realtimeLines.length > 0)} style={{ padding:'5px 16px', borderRadius:4, fontSize:11, cursor:'pointer', background:'#1f8a4c', color:'#fff', border:'none', fontWeight:600, marginLeft:'auto' }}>{loading ? '计算中...' : '执行转供决策'}</button>
        {error && <span style={{ color:'#eb5757', fontSize:11, flexBasis:'100%' }}>❌ {error}</span>}
      </div>

      {/* ====== 故障分析摘要（紧凑） ====== */}
      {result && (
        <div style={{ display:'flex', gap:16, flexWrap:'wrap', fontSize:12, marginBottom:14, padding:'6px 14px', background:'#f3f6f9', borderRadius:4, border:'1px solid #c8d6e5', color:'#667085' }}>
          <span>故障：<strong style={{ color:'#eb5757' }}>{result.fault_line}</strong></span>
          <span>停电：<strong style={{ color:'#eb5757' }}>{result.outage_count} 节点</strong></span>
          <span>负荷：<strong style={{ color:'#eb5757' }}>{fmtUnit(result.outage_load_kw, 'kW')}</strong></span>
          <span>候选方案：<strong style={{ color:'#1f8a4c' }}>{scoredReady ? pendingResult!.length : hasExternalCands ? extFeasible.length + extRejected.length : result.total_plans} 个</strong></span>
          {result.outage_nodes.length > 0 && <span style={{ flexBasis:'100%', fontSize:11 }}>停电节点：{result.outage_nodes.join(', ')}</span>}
          {boundaryEdges.length > 0 && <span style={{ flexBasis:'100%', fontSize:11 }}>边界边：{boundaryEdges.map(e => `${e.line}(${e.source_side}→${e.outage_side})`).join(', ')}</span>}
        </div>
      )}

      {/* ====== 主布局：左(方案列表) + 右(选中方案) ====== */}
      <div style={{ display:'flex', gap:14, flexWrap:'wrap' }}>
        <div style={{ flex:1, minWidth:380 }}>
          {/* 外部候选方案（优先） */}
          {hasExternalCands && (
            <SectionCard title={`外部候选方案 (${extFeasible.length}+${extRejected.length})`} style={{ marginBottom:12, border:'2px solid #2f80ed' }}>
              {extFeasible.map(c => {
                const extSel = !!(selectedPlan && (selectedPlan as any)?.plan_id === c.plan_id);
                const restoredNodeList: number[] = c.restored_nodes || [];
                const outageNodes: number[] = (result as any)?.outage_nodes || [];
                const outageLoad: number = (result as any)?.outage_load_kw || 0;
                const nodeRatio = outageNodes.length > 0 ? restoredNodeList.length / outageNodes.length : 0;
                const estLoad = restoredNodeList.length > 0 && outageLoad > 0 ? Math.round(outageLoad * nodeRatio) : 0;
                const estRate = outageLoad > 0 ? (estLoad / outageLoad) * 100 : (outageNodes.length > 0 ? nodeRatio * 100 : 0);
                return (
                <div key={c.plan_id} onClick={() => { setSelectedPlan({ rank:0, tie_name: c.tie_ids?.join('+') || c.plan_id, tie_switch: c.tie_lines?.join('+') || '', tie_lines: c.tie_lines || [], score:0, score_source:'external_candidates', restored_nodes: restoredNodeList, restored_count: restoredNodeList.length, restored_load_kw: estLoad, restoration_rate_pct: Math.min(100.0, Math.round(estRate * 10) / 10), min_restored_voltage_pu:undefined, tie_loading_pct:undefined, switch_operations: (c.tie_ids||[]).length, still_outage_nodes:[], still_outage_count:0, radial_ok:true, overloaded:false, is_usable:true, plan_id: c.plan_id } as any); setConfirmed(false); }}
                  style={{ background: extSel ? '#e8f5e9' : '#f8fdf8', border: extSel ? '2px solid #1f8a4c' : '1px solid #a5d6a7', borderRadius:6, padding:10, marginBottom:6, fontSize:11, cursor:'pointer' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', marginBottom:3 }}>
                    <strong style={{ color:'#1f8a4c', fontSize:13 }}><input type="radio" checked={extSel} readOnly style={{ marginRight:6 }} />{c.plan_id}</strong>
                    <span style={{ fontSize:9, background: jobFailed?'#ffebee':'#e3f0ff', color: jobFailed?'#eb5757':'#2f80ed', borderRadius:3, padding:'1px 6px' }}>{jobFailed?'评分失败':'待评分'}</span>
                  </div>
                  <div style={{ color:'#667085' }}>联络开关：<strong>{c.tie_ids?.join('、') || '-'}</strong> | 线路：<strong>{c.tie_lines?.join('、') || '-'}</strong></div>
                  {restoredNodeList.length > 0 && <div style={{ color:'#667085', fontSize:10, marginTop:2 }}>恢复节点 <strong>{restoredNodeList.length}</strong> 个 | 估算恢复负荷 <strong>{estLoad > 1000 ? `${(estLoad/1000).toFixed(2)} MW` : `${estLoad} kW`}</strong> | 估算恢复率 <strong>{estRate.toFixed(1)}%</strong></div>}
                </div>);
              })}
              {extRejected.map(c => (
                <div key={c.plan_id} style={{ background:'#fff5f5', border:'1px solid #ffcdd2', borderRadius:6, padding:10, marginBottom:6, fontSize:11, opacity:0.85 }}>
                  <div style={{ display:'flex', justifyContent:'space-between' }}><strong style={{ color:'#eb5757' }}>{c.plan_id}</strong><span style={{ fontSize:9, background:'#ffebee', color:'#eb5757', borderRadius:3, padding:'1px 6px' }}>不可行</span></div>
                  <div style={{ color:'#667085' }}>联络开关：<strong>{c.tie_ids?.join('、') || '-'}</strong> | {c.reject_reason || '不满足拓扑约束'}</div>
                </div>
              ))}
            </SectionCard>
          )}

          {/* 本地方案列表 */}
          {hasExternalCands ? (
            <details style={{ marginBottom:12 }}><summary style={{ cursor:'pointer', fontSize:11, color:'#94a3b8' }}>规则版候选方案（{localPlans.length} 个）</summary>
              <div style={{ marginTop:8, opacity:0.85 }}>{plans.length > 0 ? plans.map(p => <PlanCard key={`${p.tie_switch}-${p.rank}`} p={p} isSel={selectedPlan?.tie_switch === p.tie_switch} onSelect={() => { setSelectedPlan(p); setConfirmed(false); }} />) : localPlans.map(p => <PlanCard key={`${p.tie_switch}-${p.rank}`} p={p} isSel={selectedPlan?.tie_switch === p.tie_switch} onSelect={() => { setSelectedPlan(p); setConfirmed(false); }} />)}</div>
            </details>
          ) : plans.length > 0 ? plans.map(p => (
            <PlanCard key={`${p.tie_switch}-${p.rank}`} p={p} isSel={selectedPlan?.tie_switch === p.tie_switch} onSelect={() => { setSelectedPlan(p); setConfirmed(false); }} />
          )) : result ? (
            <SectionCard title="候选方案"><div style={{ textAlign:'center',padding:30,color:'#94a3b8',fontSize:12 }}>未发现可用候选方案</div></SectionCard>
          ) : (
            <SectionCard title="候选方案"><div style={{ textAlign:'center',padding:30,color:'#94a3b8',fontSize:12 }}>点击「执行转供决策」后显示</div></SectionCard>
          )}
        </div>

        {/* ====== 右侧：选中方案 ====== */}
        <div style={{ flex:'0 0 300px' }}>
          {selectedPlan ? (
            <SectionCard title={scoredReady ? '⭐ 外部算法推荐' : recommended?.tie_switch === selectedPlan.tie_switch ? '⭐ 系统推荐' : '📋 选中方案'} style={{ border:'2px solid #1f8a4c' }}>
              <div style={{ fontSize:12, lineHeight:2 }}>
                <Row l="方案" v={(selectedPlan as any).plan_id || selectedPlan.tie_name} c="#1f8a4c" />
                <Row l="联络开关" v={`${selectedPlan.tie_name} (${selectedPlan.tie_switch})`} c="#1f8a4c" />
                <Row l="恢复负荷" v={fmtUnit(selectedPlan.restored_load_kw,'kW')} />
                <Row l="恢复率" v={fmtUnit(selectedPlan.restoration_rate_pct,'%')} c="#1f8a4c" />
                <Row l="恢复节点" v={`${selectedPlan.restored_count} 个`} />
                <Row l="最低电压" v={selectedPlan.min_restored_voltage_pu != null ? `${fmtUnit(selectedPlan.min_restored_voltage_pu,'pu')} pu` : '待校验'} c={selectedPlan.min_restored_voltage_pu != null && selectedPlan.min_restored_voltage_pu < 0.95 ? '#eb5757' : undefined} />
                <Row l="负载率" v={selectedPlan.tie_loading_pct != null ? fmtUnit(selectedPlan.tie_loading_pct,'%') : '待校验'} c={selectedPlan.overloaded ? '#eb5757' : undefined} />
                <Row l="开关操作" v={`${selectedPlan.switch_operations} 次`} />

                {/* 评分 */}
                <div style={{ background: scoredReady ? '#e8f5e9' : '#f3f6f9', borderRadius:6, padding:'10px 12px', marginTop:8 }}>
                  <span style={{ fontSize:11, color:'#667085' }}>综合评分</span>
                  <div style={{ fontSize:24, fontWeight:700, color: scoredReady ? '#1f8a4c' : '#94a3b8' }}>
                    {jobFailed ? '失败' : (selectedPlan.score_source === 'external_candidates' && !scoredReady) ? '待评分' : `${selectedPlan.score?.toFixed(1) ?? '--'} / 100`}
                  </div>
                </div>

                {/* 风险提示 */}
                {(selectedPlan.overloaded || selectedPlan.radial_ok === false) && (
                  <div style={{ background:'#ffebee', border:'1px solid #ffcdd2', borderRadius:4, padding:'6px 10px', marginTop:6, fontSize:11, color:'#eb5757' }}>
                    {selectedPlan.overloaded && <div>⚠ 过载风险</div>}
                    {selectedPlan.radial_ok === false && <div>⚠ 可能成环</div>}
                  </div>
                )}

                {/* 确认按钮 */}
                <button onClick={handleConfirm} disabled={selectedPlan.is_usable === false || isPending || jobFailed}
                  style={{ width:'100%', marginTop:10, padding:'8px', borderRadius:4, fontSize:12, cursor: (selectedPlan.is_usable === false || isPending || jobFailed) ? 'not-allowed' : 'pointer', background: confirmed ? '#e8f5e9' : '#1f8a4c', color: confirmed ? '#1f8a4c' : '#fff', border: confirmed ? '2px solid #1f8a4c' : 'none', fontWeight:600, opacity: (selectedPlan.is_usable === false || isPending || jobFailed) ? 0.5 : 1 }}>
                  {confirmed ? '✅ 已确认' : jobFailed ? '🚫 评分失败' : isPending ? '⏳ 待外部评分' : '确认方案并生成操作序列'}
                </button>
                {confirmed && <div style={{ marginTop:4, fontSize:10, color:'#1f8a4c', textAlign:'center' }}>可进入「操作序列生成」→</div>}
              </div>
            </SectionCard>
          ) : result ? (
            <SectionCard title="选中方案"><div style={{ textAlign:'center',padding:30,color:'#94a3b8',fontSize:12 }}>请从左侧选择方案</div></SectionCard>
          ) : (
            <SectionCard title="选中方案"><div style={{ textAlign:'center',padding:30,color:'#94a3b8',fontSize:12 }}>点击「执行转供决策」开始</div></SectionCard>
          )}
        </div>
      </div>
    </PageContainer>
  );
}

function Row({ l, v, c }: { l: string; v: string; c?: string }) {
  return <div><span style={{ color:'#667085', fontSize:11 }}>{l}：</span><strong style={{ color: c || '#1f2937' }}>{v}</strong></div>;
}

function PlanCard({ p, isSel, onSelect }: { p: TransferPlanItem; isSel: boolean; onSelect: () => void }) {
  return (
    <div onClick={onSelect} style={{ background: isSel ? '#e8f5e9' : '#fff', border: isSel ? '2px solid #1f8a4c' : '1px solid #c8d6e5', borderRadius:6, padding:10, marginBottom:6, fontSize:11, cursor:'pointer' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
        <strong style={{ color: '#1f8a4c', fontSize:13 }}>{(p as any).plan_id ? `${(p as any).plan_id} · ` : ''}{p.tie_name} ({p.tie_switch})</strong>
        <span style={{ background: '#e8f5e9', color:'#1f8a4c', borderRadius:4, padding:'2px 8px', fontSize:12, fontWeight:700 }}>{p.score?.toFixed(1) ?? '--'} / 100</span>
      </div>
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'3px 12px', color:'#667085' }}>
        <span>恢复节点：<strong style={{ color:'#1f2937' }}>{p.restored_count} 个</strong></span>
        <span>恢复负荷：<strong style={{ color:'#1f2937' }}>{fmtUnit(p.restored_load_kw, 'kW')}</strong></span>
        <span>恢复率：<strong style={{ color:'#1f8a4c' }}>{fmtUnit(p.restoration_rate_pct, '%')}</strong></span>
        <span>电压：<strong style={{ color: p.min_restored_voltage_pu != null && p.min_restored_voltage_pu < 0.95 ? '#eb5757' : '#1f8a4c' }}>{p.min_restored_voltage_pu != null ? `${fmtUnit(p.min_restored_voltage_pu, 'pu')} pu` : '待校验'}</strong></span>
        <span>负载率：<strong style={{ color: p.overloaded ? '#eb5757' : '#1f2937' }}>{p.tie_loading_pct != null ? fmtUnit(p.tie_loading_pct, '%') : '待校验'}</strong></span>
        <span>开关：<strong>{p.switch_operations} 次</strong></span>
      </div>
      {p.power_flow?.converged === false && <div style={{ marginTop:4, fontSize:9, color:'#eb5757', background:'#ffebee', padding:'2px 6px', borderRadius:2 }}>潮流不收敛</div>}
    </div>
  );
}
