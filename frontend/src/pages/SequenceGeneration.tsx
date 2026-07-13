import { useState } from 'react';
import PageContainer from '../layouts/PageContainer';
import DataTable from '../components/DataTable';
import SectionCard from '../components/SectionCard';
import WorkflowProgress from '../components/WorkflowProgress';
import { saveWorkflowState, getWorkflowState } from '../store/workflowStore';
import type { OperationStep } from '../types';

const stages = ['故障确认', '安全隔离', '负荷转移', '恢复供电', '方式确认'];
const stageColors: Record<string, string> = {
  '故障确认': '#ffebee', '安全隔离': '#fff8e1', '负荷转移': '#e3f0ff', '恢复供电': '#e8f5e9', '方式确认': '#f3e5f5',
};

export default function SequenceGeneration() {
  const existingState = getWorkflowState();
  const hasTransferPlan = !!existingState.transferPlan;
  const [steps, setSteps] = useState<OperationStep[]>(existingState.operationSequence || []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleGenerate = async () => {
    setLoading(true); setError('');
    try {
      const res = await fetch('http://localhost:8000/api/sequence/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenarioId: existingState.scenarioId || 'SC20260705-001' }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.data) { setSteps(json.data); saveWorkflowState({ operationSequence: json.data }); }
    } catch (e: any) { setError(e.message || '请求失败，请确认后端服务已启动'); }
    finally { setLoading(false); }
  };

  const manualCount = steps.filter((s) => s.manualConfirm).length;

  const columns = [
    { key: 'stepNo', title: '步骤', dataIndex: 'stepNo' as const, width: 50, render: (r: OperationStep) => <span style={{ fontWeight: 700, color: '#1f8a4c' }}>{r.stepNo}</span> },
    { key: 'stage', title: '操作阶段', dataIndex: 'stage' as const, width: 90, render: (r: OperationStep) => (
      <span style={{ padding: '2px 8px', borderRadius: 3, fontSize: 11, background: stageColors[r.stage] || '#f0f0f0', color: '#1f2937', fontWeight: 500 }}>{r.stage}</span>
    )},
    { key: 'deviceName', title: '设备名称', dataIndex: 'deviceName' as const, width: 180, render: (r: OperationStep) => <span style={{ wordBreak: 'break-all' }}>{r.deviceName}</span> },
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
          ⚠️ 请先在转供决策页面采用推荐方案。当前将使用默认演示场景。
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

      <button onClick={handleGenerate} disabled={loading} className="btn-primary" style={{ marginBottom: 16 }}>
        {loading ? '生成中...' : '生成操作序列'}
      </button>
      {error && <span style={{ color: '#eb5757', fontSize: 12, marginLeft: 12 }}>❌ {error}</span>}

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
          点击「生成操作序列」根据边界判定和转供决策结果生成结构化操作步骤
        </div>
      )}
    </PageContainer>
  );
}
