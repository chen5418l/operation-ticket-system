import { useState } from 'react';
import PageContainer from '../layouts/PageContainer';
import SectionCard from '../components/SectionCard';
import DataTable from '../components/DataTable';
import StatusBadge from '../components/StatusBadge';
import WorkflowProgress from '../components/WorkflowProgress';
import { getCurrentWorkflow, saveCurrentWorkflow } from '../store/workflowStore';
import { runSafetyChecks, runRuleChecks } from '../utils/safetyRules';
import type { ApiOperationStep, CheckItem, SafetyCheckResult } from '../utils/safetyRules';

const STATUS_TEXT: Record<string, string> = { passed: '通过', passed_with_warnings: '有条件通过', failed: '不通过' };

export default function SafetyCheck() {
  const wf = getCurrentWorkflow();
  const ticket = wf?.ticket || null;
  const selectedPlan = wf?.selected_plan || null;
  const currentFault = wf?.fault_line || '';
  const currentPlanId = wf?.selected_plan_id || '';
  const caseId = wf?.sequence_result?.case_id || '';

  // 8010 安全校验
  const [algoSafetyLoading, setAlgoSafetyLoading] = useState(false);
  const [algoSafetyResult, setAlgoSafetyResult] = useState<any>(wf?.safety_result?.algo_result || null);
  const rawSequence = wf?.sequence_result?.raw_sequence || null;
  const runAlgoSafety = async () => {
    if (!caseId) return;
    setAlgoSafetyLoading(true);
    try {
      const safetyBody: any = { case_id: caseId };
      if (rawSequence) safetyBody.sequence = rawSequence;
      if (currentFault) safetyBody.fault_line = currentFault;
      if (currentPlanId) safetyBody.selected_plan_id = currentPlanId;
      if (wf?.job_id) safetyBody.score_job_id = wf.job_id;
      if (wf?.selected_plan) safetyBody.selected_plan = wf.selected_plan;

      const res = await fetch('http://localhost:8000/api/safety/validate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(safetyBody),
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        json._display_status = 'SAFETY_FAILED';
        json._display_message = json.message || json.detail || '安全校验服务执行失败（HTTP ' + res.status + '）';
      } else if (json.passed === true) {
        json._display_status = 'SAFETY_PASSED';
      } else {
        json._display_status = 'SAFETY_BLOCKED';
      }
      setAlgoSafetyResult(json);
      saveCurrentWorkflow({ safety_result: { ...wf?.safety_result, algo_result: json } });
    } catch (e: any) {
      setAlgoSafetyResult({ _display_status: 'SAFETY_FAILED', _display_message: '请求失败：' + (e.message || '网络错误') });
    } finally { setAlgoSafetyLoading(false); }
  };

  // 规则版校验
  const ticketFaultMismatch = ticket && currentFault && String(ticket.fault_line) !== String(currentFault);
  const ticketPlanMismatch = ticket && currentPlanId && String(ticket.plan_id) !== String(currentPlanId);
  const blockCheck = ticketFaultMismatch || ticketPlanMismatch;

  const savedCheck = wf?.safety_result as SafetyCheckResult | null;
  const [ruleResult, setRuleResult] = useState<SafetyCheckResult | null>(
    savedCheck && savedCheck.ticket_id === ticket?.ticket_id ? savedCheck : null
  );

  const opStepsRaw = wf?.operation_sequence || [];
  const opSteps: ApiOperationStep[] = Array.isArray(opStepsRaw) ? opStepsRaw.map((s: any) => {
    // 优先用 actionRaw（8010 原始值 open/close/check/verify_open），回退到中文标签映射
    const raw = s.actionRaw || '';
    const cn = s.action || '';
    const opType = raw
      ? raw  // 8010: 'open'/'close'/'check'/'verify_open'
      : cn === '确认断开' ? 'verify_open' : cn === '合闸' ? 'close' : cn === '拉开' ? 'open' : 'check';
    return {
      step: s.stepNo ?? s.step ?? 0,
      action: s.deviceName ?? cn ?? '',
      operation_type: opType,
      line: s.deviceId ?? s.line ?? '',
      description: s.operation_text || s.deviceName || '',
    };
  }) : [];
  const hasSteps = opSteps.length > 0;

  const runRuleCheck = () => {
    if (!hasSteps) return;
    if (ticket && blockCheck) return;

    // 有正式票 → 用票数据校验；无票 → 从 currentWorkflow 构造校验输入
    let r: SafetyCheckResult;
    if (ticket) {
      r = runRuleChecks(ticket, opSteps, selectedPlan);
    } else {
      const tieLines: string[] = wf?.selected_tie_lines || selectedPlan?.tie_lines || [];
      r = runSafetyChecks({
        workflow_id: wf?.workflow_id,
        fault_line: currentFault,
        plan_id: currentPlanId,
        tie_lines: tieLines,
        operation_steps: opSteps,
        selected_plan: selectedPlan,
      });
    }
    saveCurrentWorkflow({ safety_result: r });
    setRuleResult(r);
  };

  const ruleCols = [
    { key: 'item', title: '校验项', dataIndex: 'item' as const, width: 150 },
    { key: 'result', title: '结论', dataIndex: 'result' as const, width: 80, render: (r: CheckItem) => <StatusBadge status={r.result} /> },
    { key: 'detail', title: '详细说明', dataIndex: 'detail' as const },
  ];

  // 故障场景模型校验（折叠）
  const [showModel, setShowModel] = useState(false);
  const [faultNode, setFaultNode] = useState(18);
  const [faultType, setFaultType] = useState('三相短路');
  const [faultDuration, setFaultDuration] = useState(0.1);
  const [switches, setSwitches] = useState<Record<string, number>>(
    Object.fromEntries(Array.from({ length: 37 }, (_, i) => [`Switch${i + 1}`, 1]))
  );
  const [modelResult, setModelResult] = useState<any>(null);
  const [modelLoading, setModelLoading] = useState(false);
  const [modelError, setModelError] = useState('');

  async function runModelCheck() {
    setModelLoading(true); setModelError(''); setModelResult(null);
    try {
      const body = JSON.stringify({ FaultNode: faultNode, FaultType: faultType, FaultDuration: faultDuration, Switches: switches });
      const r = await fetch('http://localhost:8000/api/safety/isolation_check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      const d = await r.json();
      if (!d.success) { setModelError(d.error || '校验失败'); return; }
      setModelResult(d);
    } catch (e: any) { setModelError('请求失败: ' + (e.message || '')); }
    finally { setModelLoading(false); }
  }

  return (
    <PageContainer title="安全校验">
      <WorkflowProgress currentStep="safety" />

      {/* ====== 安全校验（统一入口：有 case_id→8010，无→规则版） ====== */}
      <SectionCard title="安全校验" style={{ marginBottom: 14 }}>
        {!hasSteps ? (
          <div style={{ background: '#fff8e1', border: '1px solid #ffe082', borderRadius: 4, padding: '10px 14px', fontSize: 12 }}>
            ⚠️ 请先生成操作序列后再执行安全校验。
          </div>
        ) : ticket && blockCheck ? (
          <div style={{ background: '#ffebee', border: '2px solid #eb5757', borderRadius: 6, padding: '10px 14px', fontSize: 12, color: '#eb5757' }}>
            🚫 操作票与当前流程不一致，请重新生成操作票。
            <ul style={{ margin: '6px 0 0 16px', padding: 0 }}>
              {ticketFaultMismatch && <li>票故障线路 <strong>{String(ticket.fault_line)}</strong> ≠ 当前流程 <strong>{currentFault}</strong></li>}
              {ticketPlanMismatch && <li>票方案 <strong>{String(ticket.plan_id)}</strong> ≠ 当前流程 <strong>{currentPlanId}</strong></li>}
            </ul>
          </div>
        ) : (
          <>
            {/* 校验输入摘要 — 统一含 8010 case_id */}
            <div style={{ background: '#e8f5e9', border: '1px solid #a5d6a7', borderRadius: 4, padding: '8px 14px', marginBottom: 10, fontSize: 12 }}>
              {ticket ? (
                <span>票号：<strong style={{ color: '#1f8a4c' }}>{ticket.ticket_id}</strong></span>
              ) : (
                <span>流程：<strong style={{ color: '#1f8a4c' }}>{wf?.workflow_id || '-'}</strong></span>
              )}
              <span style={{ marginLeft: 14 }}>故障：<strong style={{ color: '#eb5757' }}>{currentFault}</strong></span>
              <span style={{ marginLeft: 14 }}>方案：<strong style={{ color: '#1f8a4c' }}>{currentPlanId}</strong></span>
              <span style={{ marginLeft: 14 }}>步骤：<strong>{opSteps.length} 步</strong></span>
              {caseId && <span style={{ marginLeft: 14, fontSize: 10, color: '#2f80ed' }}>8010案例：{caseId}</span>}
              {!ticket && <span style={{ marginLeft: 14, fontSize: 10, color: '#94a3b8' }}>（未成票，直接校验操作序列）</span>}
            </div>

            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <button onClick={async () => { if (caseId) await runAlgoSafety(); runRuleCheck(); }} disabled={!hasSteps}
                style={{ padding: '5px 14px', borderRadius: 4, fontSize: 11, cursor: 'pointer', background: hasSteps ? '#1f8a4c' : '#94a3b8', color: '#fff', border: 'none', fontWeight: 600 }}>
                {algoSafetyLoading ? '8010校验中...' : caseId ? '执行安全校验（8010 + 规则）' : '执行安全校验（规则版）'}
              </button>
            </div>

            {/* 8010 校验结果（有 case_id 时嵌入显示） */}
            {algoSafetyResult && (
              <div style={{ background: algoSafetyResult.passed ? '#e8f5e9' : '#ffebee', border: `1px solid ${algoSafetyResult.passed ? '#a5d6a7' : '#ffcdd2'}`, borderRadius: 4, padding: '8px 12px', marginBottom: 10, fontSize: 11 }}>
                <strong>8010算法：</strong>
                <span style={{ color: algoSafetyResult._display_status === 'SAFETY_PASSED' ? '#1f8a4c' : '#eb5757', fontWeight: 600 }}>
                  {algoSafetyResult._display_status === 'SAFETY_PASSED' ? '✅ 通过' : algoSafetyResult._display_status === 'SAFETY_BLOCKED' ? '🚫 阻断' : '❌ 失败'}
                </span>
                {algoSafetyResult._display_message && <span style={{ marginLeft: 8, color: '#667085' }}>{algoSafetyResult._display_message}</span>}
              </div>
            )}

            {ruleResult && (
              <>
                <div style={{
                  display: 'flex', gap: 10, alignItems: 'center', marginBottom: 10, padding: '10px 14px', borderRadius: 6,
                  background: ruleResult.status === 'failed' ? '#ffebee' : ruleResult.status === 'passed_with_warnings' ? '#fff8e1' : '#e8f5e9',
                  border: `2px solid ${ruleResult.status === 'failed' ? '#e74c3c' : ruleResult.status === 'passed_with_warnings' ? '#f2c94c' : '#1f8a4c'}`,
                }}>
                  <span style={{ fontSize: 16, fontWeight: 700, color: ruleResult.status === 'failed' ? '#e74c3c' : ruleResult.status === 'passed_with_warnings' ? '#b8860b' : '#1f8a4c' }}>
                    {ruleResult.status === 'failed' ? '🚫 不通过' : ruleResult.status === 'passed_with_warnings' ? '⚠️ 有条件通过' : '✅ 通过'}
                  </span>
                  <StatusBadge status={STATUS_TEXT[ruleResult.status]} />
                  <span style={{ fontSize: 11, color: '#667085' }}>{ruleResult.ticket_id} | {ruleResult.created_at}</span>
                </div>
                {ruleResult.warnings.length > 0 && (
                  <div style={{ background: '#fff8e1', border: '1px solid #f2c94c', borderRadius: 4, padding: '6px 12px', marginBottom: 10, fontSize: 11, color: '#b8860b' }}>
                    ⚠️ {ruleResult.warnings.join('；')}
                  </div>
                )}
                <DataTable columns={ruleCols} data={ruleResult.checks} rowKey={(r: CheckItem) => r.id} />
                {ruleResult.status !== 'failed' && (
                  <div style={{ marginTop: 12, textAlign: 'right' }}>
                    <button onClick={() => window.location.href = '/ticket-generation'}
                      style={{ padding: '6px 16px', borderRadius: 4, fontSize: 11, cursor: 'pointer', background: '#1f8a4c', color: '#fff', border: 'none', fontWeight: 600 }}>
                      {ruleResult.status === 'passed_with_warnings' ? '有条件通过，进入模板化成票 →' : '校验通过，进入模板化成票 →'}
                    </button>
                  </div>
                )}
              </>
            )}
            {!ruleResult && <div style={{ textAlign: 'center', padding: 24, color: '#94a3b8', fontSize: 12 }}>点击「执行安全校验」对操作序列进行完整性、隔离确认、合闸对应、操作顺序、方案可用性、电压与负载率校验</div>}
          </>
        )}
      </SectionCard>

      {/* ====== 故障场景模型校验（高级，折叠） ====== */}
      <div style={{ marginBottom: 14 }}>
        <div onClick={() => setShowModel(!showModel)} style={{ cursor: 'pointer', fontSize: 12, color: '#94a3b8', padding: '6px 10px', background: '#f3f6f9', borderRadius: 4, border: '1px solid #c8d6e5' }}>
          故障场景模型校验（高级，可选）{showModel ? ' ▲' : ' ▶'}
        </div>
        {showModel && (
          <div style={{ marginTop: 10, display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <div style={{ flex: '0 0 280px' }}>
              <SectionCard title="场景配置">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 11, color: '#667085', width: 60 }}>故障节点</span>
                    <select value={faultNode} onChange={e => setFaultNode(Number(e.target.value))} style={sel}>
                      {Array.from({ length: 33 }, (_, i) => <option key={i + 1} value={i + 1}>Bus {i + 1}</option>)}
                    </select>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 11, color: '#667085', width: 60 }}>故障类型</span>
                    <select value={faultType} onChange={e => setFaultType(e.target.value)} style={sel}>
                      {['三相短路', '单相接地', '两相短路'].map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 11, color: '#667085', width: 60 }}>持续时间</span>
                    <input type="number" value={faultDuration} min={0.01} max={10} step={0.01} onChange={e => setFaultDuration(Number(e.target.value))} style={{ ...sel, width: 70 }} />
                  </div>
                </div>
              </SectionCard>
              <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
                <button onClick={runModelCheck} disabled={modelLoading} style={{ padding: '5px 12px', borderRadius: 4, fontSize: 11, cursor: 'pointer', background: '#1f8a4c', color: '#fff', border: 'none' }}>
                  {modelLoading ? '校验中...' : '运行校验'}
                </button>
                <button onClick={() => setSwitches(Object.fromEntries(Array.from({ length: 37 }, (_, i) => [`Switch${i + 1}`, 1])))} style={{ padding: '5px 12px', borderRadius: 4, fontSize: 11, cursor: 'pointer', background: '#fff', color: '#667085', border: '1px solid #c8d6e5' }}>重置</button>
              </div>
            </div>
            <div style={{ flex: 1, minWidth: 320 }}>
              {modelResult ? (
                <>
                  <div style={{ padding: '10px 14px', borderRadius: 6, marginBottom: 10,
                    background: modelResult.check_passed === false ? '#ffebee' : modelResult.risk_level === '中风险' ? '#fff8e1' : '#e8f5e9',
                    border: `2px solid ${modelResult.check_passed === false ? '#e74c3c' : modelResult.risk_level === '中风险' ? '#f2c94c' : '#1f8a4c'}` }}>
                    <span style={{ fontSize: 14, fontWeight: 700 }}>{modelResult.check_passed === false ? '🚫' : modelResult.risk_level === '中风险' ? '⚠️' : '✅'} {modelResult.overall_result ?? '--'}</span>
                    <StatusBadge status={modelResult.risk_level ?? '--'} />
                  </div>
                  {modelResult.summary && <div style={{ marginBottom: 10, padding: '6px 10px', background: '#f3f6f9', borderRadius: 4, fontSize: 11, color: '#1f2937' }}>{modelResult.summary}</div>}
                  <DataTable columns={[
                    { key: 'item', title: '检查项', dataIndex: 'item' as const },
                    { key: 'result', title: '结论', dataIndex: 'result' as const, width: 80, render: (r: any) => <StatusBadge status={r.result} /> },
                    { key: 'detail', title: '说明', dataIndex: 'detail' as const },
                  ]} data={modelResult.checks ?? []} rowKey={(_r: any, i: number) => String(i)} />
                </>
              ) : !modelLoading && !modelError ? (
                <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8', fontSize: 12 }}>配置参数后点击「运行校验」</div>
              ) : null}
              {modelError && <div style={{ padding: '8px 12px', background: '#ffebee', borderRadius: 4, color: '#e74c3c', fontSize: 11 }}>❌ {modelError}</div>}
            </div>
          </div>
        )}
      </div>
    </PageContainer>
  );
}

const sel: React.CSSProperties = { padding: '4px 8px', borderRadius: 4, border: '1px solid #c8d6e5', fontSize: 11, background: '#fff' };
