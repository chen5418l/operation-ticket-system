import { useState } from 'react';
import PageContainer from '../layouts/PageContainer';
import StatusBadge from '../components/StatusBadge';
import DataTable from '../components/DataTable';
import SectionCard from '../components/SectionCard';
import WorkflowProgress from '../components/WorkflowProgress';
import { saveWorkflowState, getWorkflowState } from '../store/workflowStore';
import type { TransferPlan } from '../types';

export default function TransferDecision() {
  const existingState = getWorkflowState();
  const hasBoundaryResult = !!existingState.boundaryResult;
  const [plan, setPlan] = useState<TransferPlan | null>(existingState.transferPlan || null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleDecide = async () => {
    setLoading(true); setError('');
    try {
      const res = await fetch('http://localhost:8000/api/transfer/decide', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenarioId: existingState.scenarioId || 'SC20260705-001' }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.data) { setPlan(json.data); saveWorkflowState({ transferPlan: json.data }); }
    } catch (e: any) { setError(e.message || '请求失败，请确认后端服务已启动'); }
    finally { setLoading(false); }
  };

  const pathData = plan?.candidatePaths.map((path: string, i: number) => ({ key: i, path, isRecommended: path === plan.recommendedPath })) ?? [];
  const pathColumns = [
    { key: 'path', title: '候选路径', dataIndex: 'path' as const, render: (r: any) => (
      <span style={{ fontWeight: r.isRecommended ? 600 : 400, color: r.isRecommended ? '#1f8a4c' : '#1f2937' }}>
        {r.isRecommended ? '★ ' : ''}{r.path}
      </span>
    )},
    { key: 'tag', title: '', width: 80, render: (r: any) => r.isRecommended ? <StatusBadge status="推荐" /> : null },
  ];

  return (
    <PageContainer title="转供决策">
      <WorkflowProgress currentStep="transfer" />

      {!hasBoundaryResult && (
        <div style={{ background: '#fff8e1', border: '1px solid #ffe082', borderRadius: 6, padding: '12px 16px', marginBottom: 16, fontSize: 13, color: '#1f2937' }}>
          ⚠️ 请先完成边界判定，再生成转供方案。当前将使用默认演示场景。
        </div>
      )}

      {/* 边界判定摘要 */}
      {existingState.boundaryResult && (
        <SectionCard title="边界判定摘要" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', fontSize: 13 }}>
            <span><span style={{ color: '#667085' }}>故障：</span><strong style={{ color: '#eb5757' }}>{existingState.boundaryResult.faultSection}</strong></span>
            <span><span style={{ color: '#667085' }}>断路器：</span><strong>{existingState.boundaryResult.tripBreaker}</strong></span>
            <span><span style={{ color: '#667085' }}>失电：</span><strong style={{ color: '#eb5757' }}>{existingState.boundaryResult.lostLoad} MW</strong></span>
          </div>
        </SectionCard>
      )}

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {/* 左侧：候选方案表 */}
        <div style={{ flex: 1, minWidth: 400 }}>
          <SectionCard title="候选方案对比">
            <button onClick={handleDecide} disabled={loading} className="btn-primary" style={{ marginBottom: 16 }}>
              {loading ? '决策中...' : '执行转供决策'}
            </button>
            {error && <span style={{ color: '#eb5757', fontSize: 12, marginLeft: 12 }}>❌ {error}</span>}
            {plan && <DataTable columns={pathColumns} data={pathData} rowKey={(r) => String(r.key)} />}
          </SectionCard>

          {/* 风险提示 */}
          {plan && (
            <SectionCard title="约束校验" style={{ marginTop: 16 }}>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <CheckTag label="N-1校验" result={plan.N1Result} />
                <CheckTag label="FA策略" result={plan.FAResult} />
                {plan.riskTags.map((tag: string) => (
                  <span key={tag} style={{ padding: '4px 12px', borderRadius: 4, fontSize: 12, background: '#fff8e1', color: '#b8860b', border: '1px solid #ffe082' }}>{tag}</span>
                ))}
              </div>
            </SectionCard>
          )}
        </div>

        {/* 右侧：推荐方案卡片 */}
        <div style={{ flex: '0 0 320px' }}>
          {plan ? (
            <SectionCard title="⭐ 推荐方案" style={{ border: '2px solid #1f8a4c', borderLeft: '4px solid #1f8a4c' }}>
              <div style={{ fontSize: 13, lineHeight: 2.1 }}>
                <div><span style={{ color: '#667085' }}>方案编号：</span><strong>{plan.planId}</strong></div>
                <div><span style={{ color: '#667085' }}>候选路径：</span><strong style={{ color: '#1f8a4c' }}>{plan.recommendedPath}</strong></div>
                <div><span style={{ color: '#667085' }}>转供负荷：</span><strong>{plan.transferLoad} MW</strong></div>
                <div><span style={{ color: '#667085' }}>转供后负载率：</span><strong style={{ color: plan.loadRateAfter >= 80 ? '#eb5757' : '#1f8a4c' }}>{plan.loadRateAfter}%</strong></div>
                <div><span style={{ color: '#667085' }}>N-1结果：</span><StatusBadge status={plan.N1Result} /></div>
                <div><span style={{ color: '#667085' }}>FA结果：</span><StatusBadge status={plan.FAResult} /></div>
                <div style={{ background: '#e8f5e9', borderRadius: 6, padding: '10px 14px', marginTop: 8 }}>
                  <span style={{ fontSize: 12, color: '#667085' }}>综合评分：</span>
                  <span style={{ fontSize: 22, fontWeight: 700, color: '#1f8a4c' }}>{plan.score}</span>
                </div>
                <div style={{ marginTop: 12, fontSize: 12, color: '#667085' }}>
                  <strong style={{ color: '#1f8a4c' }}>推荐理由：</strong>负载率最低，路径最短，无高危馈线，N-1裕度充足
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 16 }}>
                <button className="btn-primary" style={{ width: '100%' }}
                  onClick={() => { saveWorkflowState({ transferPlan: plan }); }}>
                  采用推荐方案
                </button>
              </div>
            </SectionCard>
          ) : (
            <SectionCard title="⭐ 推荐方案">
              <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8', fontSize: 13 }}>
                点击「执行转供决策」后，推荐方案将在此显示
              </div>
            </SectionCard>
          )}
        </div>
      </div>
    </PageContainer>
  );
}

function CheckTag({ label, result }: { label: string; result: string }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px', borderRadius: 6,
      background: result === '通过' || result === '一致' ? '#e8f5e9' : result === '冲突' ? '#ffebee' : '#f3f6f9',
      border: `1px solid ${result === '通过' || result === '一致' ? '#a5d6a7' : result === '冲突' ? '#ffcdd2' : '#c8d6e5'}`, fontSize: 13,
    }}>
      <span style={{ color: '#667085' }}>{label}</span>
      <StatusBadge status={result} />
    </div>
  );
}
