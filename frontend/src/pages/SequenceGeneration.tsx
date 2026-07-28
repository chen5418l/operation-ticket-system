import { useState } from 'react';
import PageContainer from '../layouts/PageContainer';
import DataTable from '../components/DataTable';
import SectionCard from '../components/SectionCard';
import WorkflowProgress from '../components/WorkflowProgress';
import { getCurrentWorkflow, saveCurrentWorkflow } from '../store/workflowStore';
import type { OperationStep } from '../types';

const stages = ['故障确认', '安全隔离', '负荷转移', '恢复供电', '方式确认'];
const stageColors: Record<string, string> = { '故障确认': '#ffebee', '安全隔离': '#fff8e1', '负荷转移': '#e3f0ff', '恢复供电': '#e8f5e9', '方式确认': '#f3e5f5' };

export default function SequenceGeneration() {
  const wf = getCurrentWorkflow();
  const selectedPlan = wf?.selected_plan || null;
  const faultLine = wf?.fault_line || '';
  const planId = wf?.selected_plan_id || '';
  const tieLines = wf?.selected_tie_lines || [];
  const hasSelectedPlan = !!selectedPlan;

  const [steps, setSteps] = useState<OperationStep[]>([]);
  const [seqWarnings, setSeqWarnings] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [generated, setGenerated] = useState(false);

  const handleGenerate = async () => {
    if (!selectedPlan) { setError('请先在转供决策页面确认方案。'); return; }
    setLoading(true); setError(''); setGenerated(false);
    try {
      const scoreJobId = wf?.job_id || '';
      const res = await fetch('http://localhost:8000/api/operation-sequence/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          score_job_id: scoreJobId, job_id: scoreJobId,
          fault_line: faultLine, selected_plan_id: planId,
          selected_plan_json: selectedPlan, selected_plan: selectedPlan,
          time_index: wf?.transfer_result?.snapshot_meta?.time_index,
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: any = await res.json();
      if (!json.success) { setError(json.message || '操作序列生成失败'); return; }

      const notice = json.notice || '';
      const isLocalFallback = json.algorithm_source === 'local_fallback' || notice.includes('本地规则');
      const caseId = json.case_id || '';

      // 解析 sequence — 8010 returns {sequence: {sequence: {operations: [...]}}}
      const seq = json.sequence || {};
      const inner = seq.sequence || seq;
      const rawSteps = inner.operations || seq.operations || seq.operation_steps || seq.steps || [];
      const mapped: OperationStep[] = Array.isArray(rawSteps)
        ? rawSteps.map((s: any, i: number) => {
            // 保留 8010 原始字段，同时派生中文展示值
            const rawAction = s.action || s.operation || s.operation_type || '';
            const cnAction = rawAction === 'open' ? '拉开' : rawAction === 'close' ? '合闸' : rawAction === 'check' ? '核查' : rawAction;
            const rawStage = s.risk_level || s.stage || s.phase || '';
            const stageMap: Record<string, string> = { 'high': '安全隔离', 'medium': '负荷转移', 'low': '方式确认' };
            const stage = stageMap[rawStage] || rawStage || (rawAction === 'open' ? '安全隔离' : rawAction === 'close' ? '负荷转移' : '方式确认');
            return {
              stepNo: s.step || s.step_no || (i + 1),
              deviceId: s.device_id || s.line || s.deviceId || '-',
              deviceName: s.operation_text || s.device_name || cnAction || s.description || '-',
              action: cnAction,
              actionRaw: rawAction,          // 保留原始值供安全校验使用
              preState: s.expected_before || s.pre_state || s.before_state || s.initial_state || '-',
              postState: s.expected_after || s.post_state || s.after_state || s.target_state || '-',
              stage,
              ruleTags: s.preconditions || s.tags || [],
              checkItems: s.post_checks || s.checks || [],
              manualConfirm: s.manual_confirm !== false,
            };
          }) : [];

      setSteps(mapped); setSeqWarnings(json.warnings || []); setGenerated(true);
      saveCurrentWorkflow({
        operation_sequence: mapped,
        sequence_result: { case_id: caseId, plan_id: planId, fault_line: faultLine, tie_lines: tieLines,
          operation_count: mapped.length, warnings: json.warnings || [],
          raw_sequence: inner,   // 传 inner sequence（含 device_registry + operations），8010 安全需要
          algorithm_source: json.algorithm_source },
        ticket: undefined, safety_result: undefined,
      });
      if (isLocalFallback) setSeqWarnings(prev => [...prev, '外部算法不可用，已降级本地规则']);
    } catch (e: any) { setError(e.message || '请求失败，请确认后端已启动'); }
    finally { setLoading(false); }
  };

  const manualCount = steps.filter(s => s.manualConfirm).length;

  // 按阶段分组计数
  const stageCounts: Record<string, number> = {};
  steps.forEach(s => { stageCounts[s.stage] = (stageCounts[s.stage] || 0) + 1; });

  const columns = [
    { key: 'stepNo', title: '序号', dataIndex: 'stepNo' as const, width: 42, render: (r: OperationStep) => <span style={{ fontWeight: 700, color: '#1f8a4c' }}>{r.stepNo}</span> },
    { key: 'stage', title: '阶段', dataIndex: 'stage' as const, width: 72, render: (r: OperationStep) => (
      <span style={{ padding: '2px 6px', borderRadius: 3, fontSize: 9, background: stageColors[r.stage] || '#f0f0f0', color: '#1f2937', fontWeight: 500 }}>{r.stage}</span>
    )},
    { key: 'deviceId', title: '设备', dataIndex: 'deviceId' as const, width: 75, render: (r: OperationStep) => <span style={{ fontFamily: 'monospace', fontSize: 9, color: '#667085' }}>{r.deviceId}</span> },
    { key: 'deviceName', title: '操作内容', dataIndex: 'deviceName' as const, width: 220, render: (r: OperationStep) => <span style={{ wordBreak: 'break-all', fontSize: 10 }}>{r.deviceName}</span> },
    { key: 'action', title: '操作', dataIndex: 'action' as const, width: 48, render: (r: OperationStep) => (
      <span style={{ padding:'1px 5px', borderRadius:3, fontSize:9, fontWeight:600,
        background: r.actionRaw === 'open' || r.action === '拉开' ? '#ffebee' : r.actionRaw === 'close' || r.action === '合闸' ? '#e8f5e9' : '#e3f0ff',
        color: r.actionRaw === 'open' || r.action === '拉开' ? '#eb5757' : r.actionRaw === 'close' || r.action === '合闸' ? '#1f8a4c' : '#2f80ed',
      }}>{r.action}</span>
    )},
    { key: 'preState', title: '操作前', dataIndex: 'preState' as const, width: 48, render: (r: OperationStep) => <span style={{ fontSize: 10 }}>{r.preState}</span> },
    { key: 'postState', title: '目标', dataIndex: 'postState' as const, width: 48, render: (r: OperationStep) => <span style={{ fontSize: 10 }}>{r.postState}</span> },
    { key: 'ruleTags', title: '前置条件', dataIndex: 'ruleTags' as const, width: 110, render: (r: OperationStep) => (
      <span style={{ fontSize: 9, color: '#667085' }}>{(Array.isArray(r.ruleTags) ? r.ruleTags : []).slice(0,2).join('; ') || '-'}</span>
    )},
    { key: 'checkItems', title: '事后检查', dataIndex: 'checkItems' as const, width: 110, render: (r: OperationStep) => (
      <span style={{ fontSize: 9, color: '#667085' }}>{(Array.isArray(r.checkItems) ? r.checkItems : []).slice(0,2).join('; ') || '-'}</span>
    )},
    { key: 'manualConfirm', title: '确认', dataIndex: 'manualConfirm' as const, width: 42, render: (r: OperationStep) => (
      <span style={{ color: r.manualConfirm ? '#b8860b' : '#1f8a4c', fontWeight: 500, fontSize: 9, background: r.manualConfirm ? '#fff8e1' : '#e8f5e9', padding: '1px 4px', borderRadius: 2 }}>
        {r.manualConfirm ? '人工' : '自动'}
      </span>
    )},
  ];

  return (
    <PageContainer title="操作序列生成">
      <WorkflowProgress currentStep="sequence" />

      {/* ====== 无方案提示 ====== */}
      {!hasSelectedPlan && (
        <div style={{ background: '#fff8e1', border: '1px solid #ffe082', borderRadius: 6, padding: '10px 16px', marginBottom: 14, fontSize: 12 }}>
          ⚠️ 请先在转供决策中选择并确认方案。
        </div>
      )}

      {/* ====== 方案信息 + 阶段标签 ====== */}
      {hasSelectedPlan && (
        <div style={{ background: '#e8f5e9', border: '1px solid #a5d6a7', borderRadius: 6, padding: '10px 14px', marginBottom: 14, fontSize: 12, color: '#1f2937', display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <span>方案：<strong style={{ color: '#1f8a4c' }}>{planId || '-'}</strong></span>
          <span>联络开关：<strong style={{ color: '#1f8a4c' }}>{selectedPlan.tie_name} ({selectedPlan.tie_switch})</strong></span>
          <span>故障线路：<strong style={{ color: '#eb5757' }}>{faultLine}</strong></span>
          {selectedPlan.confirmed_at && <span style={{ color: '#667085', fontSize: 10 }}>确认：{selectedPlan.confirmed_at}</span>}
        </div>
      )}

      {/* ====== 阶段标签 + 生成按钮 ====== */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        {stages.map(s => (
          <span key={s} style={{ padding: '5px 10px', borderRadius: 4, fontSize: 11, background: stageColors[s], color: '#1f2937', fontWeight: 500, border: '1px solid #e2e8f0' }}>
            {s}{stageCounts[s] ? ` (${stageCounts[s]})` : ''}
          </span>
        ))}
        <button onClick={handleGenerate} disabled={loading || !hasSelectedPlan} style={{ padding: '6px 16px', borderRadius: 4, fontSize: 11, cursor: 'pointer', background: hasSelectedPlan ? '#1f8a4c' : '#94a3b8', color: '#fff', border: 'none', fontWeight: 600, marginLeft: 'auto' }}>
          {loading ? '生成中...' : '生成操作序列'}
        </button>
      </div>
      {error && <div style={{ color: '#eb5757', fontSize: 11, marginBottom: 10 }}>❌ {error}</div>}

      {/* ====== 警告 ====== */}
      {seqWarnings.length > 0 && (
        <div style={{ background: '#fff8e1', border: '1px solid #f2c94c', borderRadius: 6, padding: '6px 14px', marginBottom: 12, fontSize: 11, color: '#b8860b' }}>
          ⚠️ {seqWarnings.join('；')}
        </div>
      )}

      {/* ====== 操作步骤表 ====== */}
      {steps.length > 0 && (
        <>
          <div style={{ background: '#e3f0ff', border: '1px solid #90caf9', borderRadius: 6, padding: '8px 14px', marginBottom: 12, fontSize: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <span>
              共 <strong>{steps.length}</strong> 步，<strong style={{ color: '#b8860b' }}>{manualCount} 步</strong>需人工确认
              {wf?.sequence_result?.algorithm_source === 'external_8010' && (
                <span style={{ marginLeft: 8, fontSize: 10, background: '#e3f0ff', color: '#2f80ed', padding: '1px 6px', borderRadius: 2, border: '1px solid #90caf9' }}>8010算法</span>
              )}
              {wf?.sequence_result?.algorithm_source === 'local_fallback' && (
                <span style={{ marginLeft: 8, fontSize: 10, background: '#fff8e1', color: '#b8860b', padding: '1px 6px', borderRadius: 2, border: '1px solid #f2c94c' }}>本地规则</span>
              )}
            </span>
            {generated && (
              <button onClick={() => window.location.href = '/safety-check'}
                style={{ padding: '5px 14px', borderRadius: 4, fontSize: 11, cursor: 'pointer', background: '#1f8a4c', color: '#fff', border: 'none', fontWeight: 600 }}>
                执行安全校验 →
              </button>
            )}
          </div>
          <div style={{ background: '#fff8e1', border: '1px solid #f2c94c', borderRadius: 4, padding: '6px 10px', marginBottom: 10, fontSize: 10, color: '#b8860b' }}>
            ⚠️ 操作序列草案，不具备现场执行授权。{wf?.sequence_result?.algorithm_source === 'local_fallback' ? '当前为本地规则降级版本，待8010可用后请重新生成。' : ''}
          </div>
          <SectionCard title="操作步骤明细">
            <DataTable columns={columns} data={steps} rowKey={r => String(r.stepNo)} />
          </SectionCard>
        </>
      )}

      {steps.length === 0 && !loading && (
        <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8', fontSize: 12 }}>
          {hasSelectedPlan ? '点击「生成操作序列」根据已确认方案生成操作步骤' : '暂无已确认方案，请先完成转供决策'}
        </div>
      )}
    </PageContainer>
  );
}
