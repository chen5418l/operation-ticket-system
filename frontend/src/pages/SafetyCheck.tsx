import { useState } from 'react';
import PageContainer from '../layouts/PageContainer';
import SectionCard from '../components/SectionCard';
import DataTable from '../components/DataTable';
import StatusBadge from '../components/StatusBadge';
import WorkflowProgress from '../components/WorkflowProgress';
import { saveWorkflowState } from '../store/workflowStore';
import { runRuleChecks } from '../utils/safetyRules';
import type { ApiOperationStep, CheckItem, SafetyCheckResult } from '../utils/safetyRules';

function fm(v: unknown, d?: number): string {
  const n = Number(v);
  return Number.isFinite(n) ? (d != null ? n.toFixed(d) : String(n)) : '--';
}

function readJson<T>(key: string): T | null {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) as T : null; } catch { return null; }
}

const FAULT_TYPES = ['三相短路', '单相接地', '两相短路'];

function MetricMini({ label, value, unit, color }: { label: string; value: string; unit: string; color: string }) {
  return (
    <div style={{ background: '#fff', borderRadius: 6, border: '1px solid #c8d6e5', padding: '14px 18px', flex: 1, minWidth: 140 }}>
      <div style={{ fontSize: 11, color: '#667085', marginBottom: 6 }}>{label}</div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
        <span style={{ fontSize: 24, fontWeight: 700, color }}>{value}</span>
        <span style={{ fontSize: 12, color: '#94a3b8' }}>{unit}</span>
      </div>
    </div>
  );
}

const STATUS_TEXT: Record<string, string> = { passed: '通过', passed_with_warnings: '有条件通过', failed: '不通过' };

export default function SafetyCheck() {
  // ---- 实时工作流数据（优先读取）----
  const ticket = readJson<any>('current_ticket');
  const opSteps = readJson<ApiOperationStep[]>('current_operation_steps') || ticket?.operation_steps || [];
  const savedPlan = readJson<any>('current_selected_plan');
  const currentFault = localStorage.getItem('current_fault_line') || '';

  // 已有校验结果且与当前故障线路一致 → 恢复显示（流程条据此显示完成）
  const savedCheck = readJson<SafetyCheckResult>('current_safety_check');
  const [ruleResult, setRuleResult] = useState<SafetyCheckResult | null>(
    savedCheck && savedCheck.fault_line === (ticket?.fault_line || currentFault) ? savedCheck : null
  );

  const runRuleCheck = () => {
    if (!ticket) return;
    const r = runRuleChecks(ticket, Array.isArray(opSteps) ? opSteps : [], savedPlan);
    localStorage.setItem('current_safety_check', JSON.stringify(r));
    setRuleResult(r);
    // 流程条：故障线路一致时记入工作流状态，安全校验步骤即显示完成
    if (r.fault_line === (currentFault || r.fault_line)) {
      saveWorkflowState({ safetyCheckResult: r.checks });
    }
  };

  const ruleCols = [
    { key: 'item', title: '校验项', dataIndex: 'item' as const, width: 150 },
    { key: 'result', title: '结论', dataIndex: 'result' as const, width: 80, render: (r: CheckItem) => <StatusBadge status={r.result} /> },
    { key: 'detail', title: '详细说明', dataIndex: 'detail' as const },
  ];

  // ================= 以下为原有"故障场景模型校验"（保留，可折叠） =================
  const [showModel, setShowModel] = useState(false);
  const [faultNode, setFaultNode] = useState(18);
  const [faultType, setFaultType] = useState('三相短路');
  const [faultDuration, setFaultDuration] = useState(0.1);
  const [switches, setSwitches] = useState<Record<string, number>>(
    Object.fromEntries(Array.from({ length: 37 }, (_, i) => [`Switch${i + 1}`, 1]))
  );
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const closed = Object.values(switches).filter(v => v === 1).length;
  const opened = Object.values(switches).filter(v => v === 0).length;

  async function loadDefault() {
    try {
      const r = await fetch('http://localhost:8000/api/safety/default_scenario');
      const d = await r.json();
      if (d.success?.scenario) {
        setFaultNode(d.scenario.FaultNode);
        setFaultType(d.scenario.FaultType);
        setFaultDuration(d.scenario.FaultDuration);
        if (d.scenario.Switches) setSwitches(d.scenario.Switches);
      }
    } catch { alert('加载默认场景失败'); }
  }

  function resetSwitches() {
    setSwitches(Object.fromEntries(Array.from({ length: 37 }, (_, i) => [`Switch${i + 1}`, 1])));
  }

  async function runCheck() {
    setLoading(true); setError(''); setResult(null);
    try {
      const body = JSON.stringify({ FaultNode: faultNode, FaultType: faultType, FaultDuration: faultDuration, Switches: switches });
      const r = await fetch('http://localhost:8000/api/safety/isolation_check', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
      const d = await r.json();
      if (!d.success) { setError(d.error || '校验失败'); return; }
      setResult(d);
    } catch (e: any) { setError('请求失败: ' + (e.message || '')); }
    finally { setLoading(false); }
  }

  const checks: any[] = result?.checks ?? [];
  const m: any = result?.metrics ?? {};

  const checkCols = [
    { key: 'item', title: '检查项', dataIndex: 'item' as const },
    { key: 'result', title: '结论', dataIndex: 'result' as const, width: 80, render: (r: any) => <StatusBadge status={r.result} /> },
    { key: 'detail', title: '详细说明', dataIndex: 'detail' as const },
    { key: 'risk_level', title: '风险', dataIndex: 'risk_level' as const, width: 60, render: (r: any) => {
      const lv = r.risk_level === '高' ? '高' : r.risk_level === '中' ? '中' : '低';
      return <StatusBadge status={lv} />;
    }},
  ];

  return (
    <PageContainer title="安全校验">
      <WorkflowProgress currentStep="safety" />

      {/* ============ 一、操作票安全校验（规则版，基于实时工作流） ============ */}
      {!ticket ? (
        <div style={{ background: '#fff8e1', border: '1px solid #ffe082', borderRadius: 6, padding: '12px 16px', marginBottom: 16, fontSize: 13 }}>
          ⚠️ 请先完成模板化成票。
        </div>
      ) : (
        <div style={{ background: '#e8f5e9', border: '1px solid #a5d6a7', borderRadius: 6, padding: '10px 16px', marginBottom: 16, fontSize: 13, color: '#1f2937' }}>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <span>操作票：<strong style={{ color: '#1f8a4c' }}>{ticket.ticket_id}</strong></span>
            <span>故障线路：<strong style={{ color: '#eb5757' }}>{ticket.fault_line}</strong></span>
            {savedPlan?.tie_name && <span>转供方案：<strong style={{ color: '#1f8a4c' }}>{savedPlan.tie_name} ({savedPlan.tie_switch})</strong></span>}
            <span>联络线：<strong>{(ticket.tie_lines || []).join('、') || '-'}</strong></span>
            <span>步骤数：<strong>{(ticket.operation_steps || []).length}</strong></span>
            {savedPlan?.score_source === 'external_matpower'
              ? <span style={{ fontSize: 11, background: '#e3f0ff', color: '#2f80ed', border: '1px solid #90caf9', borderRadius: 3, padding: '1px 8px' }}>已采用 MATPOWER 外部评分</span>
              : savedPlan && <span style={{ fontSize: 11, background: '#f3f6f9', color: '#667085', border: '1px solid #c8d6e5', borderRadius: 3, padding: '1px 8px' }}>规则版评分</span>}
          </div>
          {savedPlan?.power_flow && (
            <div style={{ marginTop: 6, fontSize: 12, color: '#2f80ed' }}>
              MATPOWER 潮流：{savedPlan.power_flow.converged === false ? '✗ 不收敛' : '✓ 收敛'}
              {savedPlan.power_flow.min_voltage_pu != null && ` | 最低电压 ${savedPlan.power_flow.min_voltage_pu} pu`}
              {savedPlan.power_flow.max_loading_pct != null && ` | 最大负载率 ${savedPlan.power_flow.max_loading_pct}%`}
              {savedPlan.power_flow.loss_kw != null && ` | 网损 ${savedPlan.power_flow.loss_kw} kW`}
            </div>
          )}
        </div>
      )}

      <SectionCard title="操作票安全校验（规则版）" style={{ marginBottom: 16 }}>
        <div style={{ marginBottom: 12 }}>
          <button onClick={runRuleCheck} disabled={!ticket} className="btn-primary" style={{ opacity: ticket ? 1 : 0.5 }}>
            执行安全校验
          </button>
          {!ticket && <span style={{ fontSize: 12, color: '#94a3b8', marginLeft: 10 }}>请先完成模板化成票。</span>}
        </div>

        {ruleResult && (
          <>
            {/* 结论横幅 */}
            <div style={{
              display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12, padding: '12px 16px', borderRadius: 6,
              background: ruleResult.status === 'failed' ? '#ffebee' : ruleResult.status === 'passed_with_warnings' ? '#fff8e1' : '#e8f5e9',
              border: `2px solid ${ruleResult.status === 'failed' ? '#e74c3c' : ruleResult.status === 'passed_with_warnings' ? '#f2c94c' : '#1f8a4c'}`,
            }}>
              <span style={{ fontSize: 17, fontWeight: 700, color: ruleResult.status === 'failed' ? '#e74c3c' : ruleResult.status === 'passed_with_warnings' ? '#b8860b' : '#1f8a4c' }}>
                {ruleResult.status === 'failed' ? '🚫 不通过' : ruleResult.status === 'passed_with_warnings' ? '⚠️ 有条件通过' : '✅ 通过'}
              </span>
              <span style={{ fontSize: 12, color: '#667085' }}>票号 {ruleResult.ticket_id} | 故障线路 {ruleResult.fault_line} | 序列编号 {ruleResult.plan_id} | 校验时间 {ruleResult.created_at}</span>
              <StatusBadge status={STATUS_TEXT[ruleResult.status]} />
            </div>

            {/* warnings */}
            {ruleResult.warnings.length > 0 && (
              <div style={{ background: '#fff8e1', border: '1px solid #f2c94c', borderRadius: 4, padding: '8px 12px', marginBottom: 12, fontSize: 12, color: '#b8860b' }}>
                ⚠️ {ruleResult.warnings.join('；')}
              </div>
            )}

            {/* 校验明细 */}
            <DataTable columns={ruleCols} data={ruleResult.checks} rowKey={(r: CheckItem) => r.id} />

            {ruleResult.status !== 'failed' && (
              <div style={{ marginTop: 10, fontSize: 12, color: '#1f8a4c', background: '#e8f5e9', padding: '6px 10px', borderRadius: 4 }}>
                校验结果已保存（current_safety_check），可进入导出归档环节。
              </div>
            )}
          </>
        )}

        {!ruleResult && ticket && (
          <div style={{ textAlign: 'center', padding: 30, color: '#94a3b8', fontSize: 13 }}>
            点击「执行安全校验」，对操作票 {ticket.ticket_id} 进行完整性、隔离确认、合闸对应、操作顺序、方案可用性、电压与负载率校验
          </div>
        )}
      </SectionCard>

      {/* ============ 二、故障场景模型校验（保留原功能，可折叠） ============ */}
      <SectionCard title={
        <span onClick={() => setShowModel(!showModel)} style={{ cursor: 'pointer' }}>
          故障场景模型校验（高级，可选） {showModel ? '▲' : '▶'}
        </span>
      }>
        {!showModel ? (
          <div style={{ fontSize: 12, color: '#94a3b8' }}>展开后可配置故障节点与开关状态，调用后端隔离校验模型进行仿真校验。</div>
        ) : (
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            <div style={{ flex: '0 0 380px' }}>
              <SectionCard title="故障场景配置">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={sLbl}>故障节点</span>
                    <select value={faultNode} onChange={e => setFaultNode(Number(e.target.value))} style={sInp}>
                      {Array.from({ length: 33 }, (_, i) => <option key={i + 1} value={i + 1}>Bus {i + 1}</option>)}
                    </select>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={sLbl}>故障类型</span>
                    <select value={faultType} onChange={e => setFaultType(e.target.value)} style={sInp}>
                      {FAULT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={sLbl}>持续时间</span>
                    <input type="number" value={faultDuration} min={0.01} max={10} step={0.01}
                      onChange={e => setFaultDuration(Number(e.target.value))}
                      style={{ ...sInp, width: 80 }} />
                  </div>
                </div>
              </SectionCard>

              <SectionCard title={`开关 (${closed}合/${opened}开)`} style={{ marginTop: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 3, maxHeight: 260, overflowY: 'auto' }}>
                  {Object.entries(switches).map(([k, v]) => (
                    <div key={k} onClick={() => setSwitches(prev => ({ ...prev, [k]: prev[k] === 1 ? 0 : 1 }))}
                      style={{
                        padding: '3px 4px', borderRadius: 3, cursor: 'pointer', textAlign: 'center', fontSize: 9,
                        background: v === 1 ? '#e8f5e9' : '#ffebee',
                        color: v === 1 ? '#1f8a4c' : '#e74c3c',
                        border: `1px solid ${v === 1 ? '#a5d6a7' : '#ffcdd2'}`,
                        fontWeight: 600, userSelect: 'none' as const,
                      }}>
                      {k.replace('Switch', 'S')}:{v === 1 ? '合' : '开'}
                    </div>
                  ))}
                </div>
              </SectionCard>

              <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
                <button onClick={loadDefault} style={b2}>加载默认</button>
                <button onClick={resetSwitches} style={b2}>重置开关</button>
                <button onClick={runCheck} disabled={loading} style={b1}>
                  {loading ? '校验中...' : '运行校验'}
                </button>
              </div>
            </div>

            <div style={{ flex: 1, minWidth: 400 }}>
              {result ? (
                <>
                  <div style={{
                    display: 'flex', gap: 10, marginBottom: 14, padding: '12px 16px', borderRadius: 6,
                    background: result.check_passed === false ? '#ffebee' : result.risk_level === '中风险' ? '#fff8e1' : '#e8f5e9',
                    border: `2px solid ${result.check_passed === false ? '#e74c3c' : result.risk_level === '中风险' ? '#f2c94c' : '#1f8a4c'}`,
                  }}>
                    <span style={{ fontSize: 18, fontWeight: 700, color: result.check_passed === false ? '#e74c3c' : result.risk_level === '中风险' ? '#b8860b' : '#1f8a4c' }}>
                      {result.check_passed === false ? '🚫' : result.risk_level === '中风险' ? '⚠️' : '✅'} {result.overall_result ?? '--'}
                    </span>
                    <span style={{ fontSize: 13, color: '#667085' }}>风险: <StatusBadge status={result.risk_level ?? '--'} /></span>
                  </div>

                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
                    <MetricMini label="失供负荷" value={fm(m.lost_load_kw)} unit="kW" color="#eb5757" />
                    <MetricMini label="重要用户恢复率" value={fm(m.important_restore_rate)} unit="%" color="#2f80ed" />
                    <MetricMini label="加权恢复率" value={fm(m.weighted_restore_rate)} unit="%" color="#1f8a4c" />
                    <MetricMini label="开关动作" value={fm(m.switch_action_count, 0)} unit="次" color="#f2c94c" />
                    <MetricMini label="远方操作" value={fm(m.remote_operation_rate)} unit="%" color="#2f80ed" />
                    <MetricMini label="可信度" value={fm(m.data_confidence)} unit="%" color="#1f8a4c" />
                  </div>

                  {result.summary ? (
                    <div style={{ marginBottom: 14, padding: '8px 12px', background: '#f3f6f9', borderRadius: 4, fontSize: 12, color: '#1f2937' }}>
                      {result.summary}
                    </div>
                  ) : null}

                  <SectionCard title="检查明细">
                    {checks.length > 0 ? (
                      <DataTable columns={checkCols} data={checks} rowKey={(_r: any, i: number) => String(i)} />
                    ) : (
                      <div style={{ textAlign: 'center', padding: 30, color: '#94a3b8', fontSize: 12 }}>暂无检查明细</div>
                    )}
                  </SectionCard>

                  <button onClick={() => window.open('http://localhost:8000/api/safety/download_report', '_blank')}
                    style={{ marginTop: 10, ...b2 }}>下载报告</button>
                </>
              ) : !loading && !error ? (
                <div style={{ textAlign: 'center', padding: 60, color: '#94a3b8', fontSize: 13, background: '#fff', borderRadius: 6, border: '1px solid #c8d6e5' }}>
                  配置故障场景和开关状态后，点击"运行校验"
                </div>
              ) : null}

              {error ? (
                <div style={{ padding: '12px 16px', background: '#ffebee', borderRadius: 6, border: '1px solid #ffcdd2', color: '#e74c3c', fontSize: 12 }}>
                  ❌ {error}
                </div>
              ) : null}
            </div>
          </div>
        )}
      </SectionCard>
    </PageContainer>
  );
}

const sLbl: React.CSSProperties = { fontSize: 12, color: '#667085', width: 70, flexShrink: 0 };
const sInp: React.CSSProperties = { padding: '5px 10px', borderRadius: 4, border: '1px solid #c8d6e5', fontSize: 12, background: '#fff' };
const b1: React.CSSProperties = { padding: '6px 16px', borderRadius: 4, fontSize: 12, cursor: 'pointer', background: '#1f8a4c', color: '#fff', border: 'none' };
const b2: React.CSSProperties = { padding: '6px 12px', borderRadius: 4, fontSize: 11, cursor: 'pointer', background: '#fff', color: '#667085', border: '1px solid #c8d6e5' };
