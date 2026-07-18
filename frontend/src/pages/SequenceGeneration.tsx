import { useState } from 'react';
import PageContainer from '../layouts/PageContainer';
import DataTable from '../components/DataTable';
import SectionCard from '../components/SectionCard';
import WorkflowProgress from '../components/WorkflowProgress';
import { saveWorkflowState } from '../store/workflowStore';
import type { OperationStep } from '../types';

const stages = ['故障确认', '安全隔离', '负荷转移', '恢复供电', '方式确认'];
const stageColors: Record<string, string> = {
  '故障确认': '#ffebee', '安全隔离': '#fff8e1', '负荷转移': '#e3f0ff', '恢复供电': '#e8f5e9', '方式确认': '#f3e5f5',
};

// 后端 /api/sequence/generate 返回的步骤结构
interface ApiOperationStep { step: number; action: string; operation_type: string; line?: string; }
interface SequenceResponse { success: boolean; message?: string; fault_line?: string; plan_id?: string; tie_lines?: string[]; operation_steps: ApiOperationStep[]; warnings: string[]; }

/** 后端操作步骤 → 页面表格行 */
function mapStep(s: ApiOperationStep): OperationStep {
  const base = { stepNo: s.step, deviceId: s.line || '-', ruleTags: [] as string[], checkItems: [] as string[], manualConfirm: true };
  switch (s.operation_type) {
    case 'verify_open':
      return { ...base, stage: '安全隔离', deviceName: s.action, action: '确认断开', preState: '断开', postState: '断开' };
    case 'close':
      return { ...base, stage: '负荷转移', deviceName: s.action, action: '合闸', preState: '断开', postState: '合闸' };
    case 'open':
      return { ...base, stage: '安全隔离', deviceName: s.action, action: '拉开', preState: '合闸', postState: '断开' };
    case 'check':
    default:
      return { ...base, stage: '方式确认', deviceName: s.action, action: '核查', preState: '-', postState: '-' };
  }
}

export default function SequenceGeneration() {
  // 读取转供决策页面确认采用的方案（localStorage 优先）
  const savedPlan = (() => { try { const v = localStorage.getItem('current_selected_plan'); return v ? JSON.parse(v) : null; } catch { return null; } })();
  const savedFault = savedPlan?.fault_line || localStorage.getItem('current_fault_line') || '';
  const hasTransferPlan = !!savedPlan;

  const [steps, setSteps] = useState<OperationStep[]>([]);
  const [seqWarnings, setSeqWarnings] = useState<string[]>([]);
  const [planId, setPlanId] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleGenerate = async () => {
    if (!savedPlan) { setError('请先在转供决策页面选择并确认采用一个转供方案。'); return; }
    setLoading(true); setError('');
    try {
      const res = await fetch('http://localhost:8000/api/sequence/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fault_line: savedFault, selected_plan: savedPlan }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: SequenceResponse = await res.json();
      if (!json.success) { setError(json.message || '操作序列生成失败'); return; }
      const mapped = (json.operation_steps || []).map(mapStep);
      setSteps(mapped);
      setSeqWarnings(json.warnings || []);
      setPlanId(json.plan_id || '');
      localStorage.setItem('current_operation_steps', JSON.stringify(json.operation_steps || []));
      // 供模板化成票页读取 plan_id / tie_lines / fault_line
      localStorage.setItem('current_sequence_result', JSON.stringify({
        plan_id: json.plan_id || '', fault_line: json.fault_line || savedFault,
        tie_lines: json.tie_lines || [], warnings: json.warnings || [],
      }));
      saveWorkflowState({ operationSequence: mapped });
    } catch (e: any) { setError(e.message || '请求失败，请确认后端服务已启动'); }
    finally { setLoading(false); }
  };

  const manualCount = steps.filter((s) => s.manualConfirm).length;

  const columns = [
    { key: 'stepNo', title: '步骤', dataIndex: 'stepNo' as const, width: 50, render: (r: OperationStep) => <span style={{ fontWeight: 700, color: '#1f8a4c' }}>{r.stepNo}</span> },
    { key: 'stage', title: '操作阶段', dataIndex: 'stage' as const, width: 90, render: (r: OperationStep) => (
      <span style={{ padding: '2px 8px', borderRadius: 3, fontSize: 11, background: stageColors[r.stage] || '#f0f0f0', color: '#1f2937', fontWeight: 500 }}>{r.stage}</span>
    )},
    { key: 'deviceName', title: '操作内容', dataIndex: 'deviceName' as const, width: 260, render: (r: OperationStep) => <span style={{ wordBreak: 'break-all' }}>{r.deviceName}</span> },
    { key: 'action', title: '操作', dataIndex: 'action' as const, width: 70 },
    { key: 'preState', title: '操作前', dataIndex: 'preState' as const, width: 60 },
    { key: 'postState', title: '操作后', dataIndex: 'postState' as const, width: 60 },
    { key: 'manualConfirm', title: '确认', dataIndex: 'manualConfirm' as const, width: 60, render: (r: OperationStep) => (
      <span style={{ color: r.manualConfirm ? '#b8860b' : '#1f8a4c', fontWeight: 500, fontSize: 12, background: r.manualConfirm ? '#fff8e1' : '#e8f5e9', padding: '2px 6px', borderRadius: 3 }}>
        {r.manualConfirm ? '人工' : '自动'}
      </span>
    )},
  ];

  return (
    <PageContainer title="操作序列生成">
      <WorkflowProgress currentStep="sequence" />

      {!hasTransferPlan && (
        <div style={{ background: '#fff8e1', border: '1px solid #ffe082', borderRadius: 6, padding: '12px 16px', marginBottom: 16, fontSize: 13 }}>
          ⚠️ 请先在转供决策页面选择并确认采用一个转供方案。
        </div>
      )}

      {hasTransferPlan && (
        <div style={{ background: '#e8f5e9', border: '1px solid #a5d6a7', borderRadius: 6, padding: '10px 16px', marginBottom: 16, fontSize: 13, color: '#1f2937', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <span>当前采用方案：<strong style={{ color: '#1f8a4c' }}>{savedPlan.tie_name} ({savedPlan.tie_switch})</strong></span>
          {savedFault && <span>故障线路：<strong style={{ color: '#eb5757' }}>{savedFault}</strong></span>}
          <span>恢复率：<strong>{savedPlan.restoration_rate_pct != null ? `${savedPlan.restoration_rate_pct}%` : '--'}</strong></span>
          {savedPlan.confirmed_at && <span style={{ color: '#667085' }}>确认时间：{savedPlan.confirmed_at}（如实时拓扑已变化请重新评估）</span>}
          {planId && <span>序列编号：<strong>{planId}</strong></span>}
        </div>
      )}

      {/* 阶段标签 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {stages.map((s) => (
          <span key={s} style={{ padding: '5px 12px', borderRadius: 6, fontSize: 12, background: stageColors[s], color: '#1f2937', fontWeight: 500, border: '1px solid #e2e8f0' }}>
            {s}
          </span>
        ))}
      </div>

      <button onClick={handleGenerate} disabled={loading || !hasTransferPlan} className="btn-primary" style={{ marginBottom: 16, opacity: hasTransferPlan ? 1 : 0.5 }}>
        {loading ? '生成中...' : '生成操作序列'}
      </button>
      {error && <span style={{ color: '#eb5757', fontSize: 12, marginLeft: 12 }}>❌ {error}</span>}

      {seqWarnings.length > 0 && (
        <div style={{ background: '#fff8e1', border: '1px solid #f2c94c', borderRadius: 6, padding: '8px 14px', marginBottom: 12, fontSize: 12, color: '#b8860b' }}>
          ⚠️ {seqWarnings.join('；')}
        </div>
      )}

      {steps.length > 0 && (
        <>
          <div style={{ background: '#e3f0ff', border: '1px solid #90caf9', borderRadius: 6, padding: '10px 16px', marginBottom: 16, fontSize: 13, color: '#1f2937' }}>
            共生成 <strong>{steps.length}</strong> 个操作步骤，其中 <strong style={{ color: '#b8860b' }}>{manualCount} 个</strong>需要人工确认。
          </div>
          <SectionCard title="操作步骤明细">
            <DataTable columns={columns} data={steps} rowKey={(r) => String(r.stepNo)} />
          </SectionCard>
        </>
      )}

      {steps.length === 0 && !loading && (
        <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8', fontSize: 13 }}>
          {hasTransferPlan
            ? '点击「生成操作序列」根据已确认的转供方案生成结构化操作步骤'
            : '暂无已确认的转供方案，请先完成转供决策'}
        </div>
      )}
    </PageContainer>
  );
}
