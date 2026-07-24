import { useEffect, useState, useMemo } from 'react';
import PageContainer from '../layouts/PageContainer';
import MetricCard from '../components/MetricCard';
import SectionCard from '../components/SectionCard';
import IEEE33Topology from '../components/topology/IEEE33Topology';
import WorkflowProgress from '../components/WorkflowProgress';
import { realtimeApi } from '../services/apiClient';
import { getCurrentWorkflow } from '../store/workflowStore';
import type { RealtimeLatest, RealtimeNode } from '../services/apiClient';
import type { DashboardSummary } from '../types';

const flowSteps = [
  { title: '数据导入', desc: '拓扑/台账/量测' },
  { title: '源荷预测', desc: '短时负荷/风险识别' },
  { title: '边界判定', desc: '故障隔离/解列' },
  { title: '转供决策', desc: '多目标路径优化' },
  { title: '序列生成', desc: '操作步骤编排' },
  { title: '模板化成票', desc: '标准操作票输出' },
  { title: '安全校核', desc: '多维规则校验' },
  { title: '人工审核', desc: '审批/回写/归档' },
];

// 服务状态摘要结构
interface ServiceStatus {
  simulink: { ok: boolean; text: string };
  forecast: { ok: boolean; text: string; detail: string };
  candidates: { ok: boolean; text: string; detail: string };
  scoring: { ok: boolean; text: string; detail: string };
}

function computeRealtimeMetrics(nodes: RealtimeNode[]) {
  const total_load_kw = nodes.reduce((s, n) => s + (n.load_kw || 0), 0);
  const voltages = nodes.map(n => n.voltage_pu).filter(v => v !== undefined && v !== null) as number[];
  const avg_voltage_pu = voltages.length > 0 ? voltages.reduce((s, v) => s + v, 0) / voltages.length : 0;
  const min_voltage_pu = voltages.length > 0 ? Math.min(...voltages) : 0;
  const high_risk_count = nodes.filter(n => n.risk_level === 'high').length;
  const realtime_node_count = nodes.length;
  return { total_load_kw, avg_voltage_pu, min_voltage_pu, high_risk_count, realtime_node_count };
}

function fmtVal(v: number, d = 1): string { return Number.isFinite(v) ? v.toFixed(d) : '--'; }

// 服务状态指示器组件
function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span style={{
      display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
      background: ok ? '#1f8a4c' : '#f2c94c',
      marginRight: 6, verticalAlign: 'middle',
      boxShadow: ok ? '0 0 4px rgba(31,138,76,0.4)' : '0 0 4px rgba(242,201,76,0.4)',
    }} />
  );
}

export default function Dashboard() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [realtimeData, setRealtimeData] = useState<RealtimeLatest | null>(null);
  const [dataSource, setDataSource] = useState<'realtime' | 'fallback'>('fallback');
  const [rtMetrics, setRtMetrics] = useState<ReturnType<typeof computeRealtimeMetrics> | null>(null);
  const [services, setServices] = useState<ServiceStatus>({
    simulink: { ok: false, text: '检测中...' },
    forecast: { ok: false, text: '检测中...', detail: '' },
    candidates: { ok: false, text: '检测中...', detail: '' },
    scoring: { ok: false, text: '检测中...', detail: '' },
  });

  // 获取算法服务健康状态
  const fetchAlgoHealth = async () => {
    try {
      const r = await fetch('http://localhost:8000/api/algorithm/health');
      const d = await r.json();
      if (d.available) {
        const caps = d.capabilities?.modules || {};
        setServices(prev => ({
          ...prev,
          forecast: caps.forecast
            ? { ok: true, text: '可用', detail: '外部算法服务正常' }
            : { ok: false, text: '不可用', detail: '接口待实现' },
          candidates: caps.candidate_generation
            ? { ok: true, text: '可用', detail: '外部候选方案生成可用' }
            : { ok: false, text: '不可用', detail: '暂未接入' },
          scoring: caps.full_pipeline || caps.matpower_online
            ? { ok: true, text: '可用', detail: 'MATPOWER 在线模式' }
            : { ok: false, text: '不可用', detail: '计算中或未接入' },
        }));
      } else {
        setServices(prev => ({
          ...prev,
          forecast: { ok: false, text: '不可用', detail: '外部服务未连接' },
          candidates: { ok: false, text: '不可用', detail: '外部服务未连接' },
          scoring: { ok: false, text: '不可用', detail: '外部服务未连接' },
        }));
      }
    } catch {
      setServices(prev => ({
        ...prev,
        forecast: { ok: false, text: '不可用', detail: '外部服务未连接' },
        candidates: { ok: false, text: '不可用', detail: '外部服务未连接' },
        scoring: { ok: false, text: '不可用', detail: '外部服务未连接' },
      }));
    }
  };

  useEffect(() => {
    let mounted = true;

    function pollRealtime() {
      realtimeApi.getLatest().then((data) => {
        if (!mounted) return;
        if (data?.success && data.has_data && data.nodes && data.nodes.length > 0) {
          setRealtimeData(data);
          setDataSource('realtime');
          setRtMetrics(computeRealtimeMetrics(data.nodes));
          setServices(prev => ({
            ...prev,
            simulink: { ok: true, text: '正常', detail: `实时同步 · ${data.nodes.length} 节点 · ${data.lines?.length || 0} 线路` },
          }));
        } else {
          setRealtimeData(data);
          setDataSource('fallback');
          setServices(prev => ({
            ...prev,
            simulink: data?.source_tag === 'none'
              ? { ok: false, text: '暂无数据', detail: '等待 Simulink 推送' }
              : { ok: false, text: '演示数据', detail: '使用本地静态拓扑' },
          }));
          fetchSummary();
        }
      }).catch(() => {
        if (!mounted) return;
        setDataSource('fallback');
        setServices(prev => ({
          ...prev,
          simulink: { ok: false, text: '未连接', detail: '后端未返回实时数据' },
        }));
        fetchSummary();
      });
    }

    pollRealtime();
    fetchAlgoHealth();
    const timer = setInterval(pollRealtime, 4000);
    const healthTimer = setInterval(fetchAlgoHealth, 30000);
    return () => { mounted = false; clearInterval(timer); clearInterval(healthTimer); };
  }, []);

  function fetchSummary() {
    fetch('http://localhost:8000/api/dashboard/summary')
      .then((r) => r.json())
      .then((res) => { if (res.data) setSummary(res.data); })
      .catch(() => {
        setSummary({ totalEvents: 12, totalTickets: 28, safetyPassRate: 92.5, manualInterventionRate: 7.5 });
      });
  }

  function getSourceLabel(): { text: string; bg: string; color: string; border: string } {
    if (dataSource === 'fallback') {
      const tag = realtimeData?.source_tag || '';
      if (tag === 'none') return { text: '📭 暂无实时数据', bg: '#f3f6f9', color: '#667085', border: '#c8d6e5' };
      return { text: '⚠ 演示数据', bg: '#fff8e1', color: '#b8860b', border: '#f2c94c' };
    }
    const tag = realtimeData?.source_tag || '';
    const trusted = realtimeData?.trusted_source === true;
    if ((tag === 'simulink' || tag === 'matlab') && trusted) {
      return { text: '📡 Simulink实时数据', bg: '#e8f5e9', color: '#1f8a4c', border: '#a5d6a7' };
    }
    if (tag === 'unverified_simulink') {
      return { text: '⚠ 未验证Simulink数据', bg: '#ffebee', color: '#e74c3c', border: '#ffcdd2' };
    }
    if ((tag === 'simulink' || tag === 'matlab') && !trusted) {
      return { text: '⚠ 未验证Simulink数据', bg: '#ffebee', color: '#e74c3c', border: '#ffcdd2' };
    }
    if (tag === 'test') return { text: '🧪 测试实时数据', bg: '#e3f0ff', color: '#2f80ed', border: '#90caf9' };
    if (tag === 'manual') return { text: '🔧 手动测试数据', bg: '#fff8e1', color: '#e67e22', border: '#f2c94c' };
    if (tag === 'mock') return { text: '🔬 模拟实时数据', bg: '#e3f0ff', color: '#2f80ed', border: '#90caf9' };
    if (tag === 'none') return { text: '📭 暂无实时数据', bg: '#f3f6f9', color: '#667085', border: '#c8d6e5' };
    if (tag === 'static') return { text: '📋 静态拓扑数据', bg: '#f3f6f9', color: '#667085', border: '#c8d6e5' };
    return { text: `🔧 测试数据(${tag || '未知'})`, bg: '#fff8e1', color: '#e67e22', border: '#f2c94c' };
  }

  const sourceLabel = getSourceLabel();

  // 当前处置流程摘要
  const wf = useMemo(() => getCurrentWorkflow(), [realtimeData]);
  const wfStage = useMemo(() => {
    if (!wf) return null;
    if (!wf.selected_plan) return '转供决策';
    if (!wf.operation_sequence) return '操作序列生成';
    if (!wf.ticket) return '模板化成票';
    if (!wf.safety_result) return '安全校验';
    return '已完成';
  }, [wf]);

  // 操作票数据来源标注
  const ticketTrend = dataSource === 'realtime' && realtimeData?.trusted_source
    ? '本月真实归档' : '演示统计';

  const sourceTagStyle: React.CSSProperties = {
    display: 'inline-block', padding: '2px 10px', borderRadius: 10,
    fontSize: 10, fontWeight: 600, marginLeft: 8, verticalAlign: 'middle',
  };

  return (
    <PageContainer title="系统主界面">
      {/* 快捷说明 + 数据来源指示 */}
      <div style={{
        background: '#e3f0ff', border: '1px solid #90caf9', borderRadius: 6,
        padding: '10px 16px', marginBottom: 16, fontSize: 12, color: '#1f2937',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8,
      }}>
        <span>
          💡 <strong>交互提示：</strong>点击拓扑图中的<strong>节点</strong>查看负荷与电压详情 |
          点击<strong>线路</strong>查看参数并可设为故障 |
          点击<strong>联络开关(T1-T5)</strong>查看转供能力
        </span>
        <span style={{ ...sourceTagStyle, background: sourceLabel.bg, color: sourceLabel.color, border: `1px solid ${sourceLabel.border}` }}>
          {sourceLabel.text}
        </span>
      </div>

      {/* 指标卡片 */}
      <div style={{ display: 'flex', gap: 14, marginBottom: 20, flexWrap: 'wrap' }}>
        {dataSource === 'realtime' && rtMetrics ? (
          <>
            <MetricCard label="实时节点数量" value={rtMetrics.realtime_node_count} unit="个" color="#1f8a4c" trend="实时同步" trendColor="#1f8a4c" />
            <MetricCard label="系统总负荷" value={fmtVal(rtMetrics.total_load_kw)} unit="kW" color="#2f80ed" trend="实时计算" trendColor="#2f80ed" />
            <MetricCard label="平均电压" value={fmtVal(rtMetrics.avg_voltage_pu, 3)} unit="pu" color="#1f8a4c" trend={rtMetrics.avg_voltage_pu < 0.97 ? '偏低' : '正常'} trendColor={rtMetrics.avg_voltage_pu < 0.97 ? '#f2c94c' : '#1f8a4c'} />
            <MetricCard label="最低电压" value={fmtVal(rtMetrics.min_voltage_pu, 3)} unit="pu" color={rtMetrics.min_voltage_pu < 0.95 ? '#eb5757' : '#f2c94c'} trend={rtMetrics.min_voltage_pu < 0.95 ? '⚠ 越限' : '关注'} trendColor={rtMetrics.min_voltage_pu < 0.95 ? '#eb5757' : '#f2c94c'} />
            <MetricCard label="高风险节点" value={rtMetrics.high_risk_count} unit="个" color={rtMetrics.high_risk_count > 0 ? '#eb5757' : '#1f8a4c'} trend={rtMetrics.high_risk_count > 0 ? '需关注' : '正常'} trendColor={rtMetrics.high_risk_count > 0 ? '#eb5757' : '#1f8a4c'} />
            <MetricCard label="已导出操作票" value={summary?.totalTickets ?? 28} unit="张" color="#1f8a4c" trend={ticketTrend} trendColor="#1f8a4c" />
          </>
        ) : (
          <>
            <MetricCard label="今日故障事件" value={summary?.totalEvents ?? 12} unit="起" color="#eb5757" trend="较昨日 +2" trendColor="#eb5757" />
            <MetricCard label="待成票任务" value={5} unit="张" color="#2f80ed" trend="处理中" trendColor="#2f80ed" />
            <MetricCard label="安全校验通过率" value={summary?.safetyPassRate ?? 92.5} unit="%" color="#1f8a4c" trend="正常" trendColor="#1f8a4c" />
            <MetricCard label="高危馈线数" value={3} unit="条" color="#f2c94c" trend="需关注" trendColor="#f2c94c" />
            <MetricCard label="待人工复核" value={3} unit="项" color="#f2c94c" trend="3 项待处理" trendColor="#f2c94c" />
            <MetricCard label="已导出操作票" value={summary?.totalTickets ?? 28} unit="张" color="#1f8a4c" trend={ticketTrend} trendColor="#1f8a4c" />
          </>
        )}
      </div>

      {/* 服务状态摘要 —— 替代原 PredictPanel + FlaskPanel */}
      <SectionCard title="服务状态" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 12 }}>
          <div style={{ flex: 1, minWidth: 180 }}>
            <StatusDot ok={services.simulink.ok} />
            <span style={{ fontWeight: 600, color: '#1f2937' }}>Simulink 实时数据：</span>
            <span style={{ color: services.simulink.ok ? '#1f8a4c' : '#b8860b' }}>{services.simulink.text}</span>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2, marginLeft: 14 }}>{services.simulink.detail || ''}</div>
          </div>
          <div style={{ flex: 1, minWidth: 180 }}>
            <StatusDot ok={services.forecast.ok} />
            <span style={{ fontWeight: 600, color: '#1f2937' }}>源荷预测：</span>
            <span style={{ color: services.forecast.ok ? '#1f8a4c' : '#b8860b' }}>{services.forecast.text}</span>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2, marginLeft: 14 }}>{services.forecast.detail || '当前使用本地规则版'}</div>
          </div>
          <div style={{ flex: 1, minWidth: 180 }}>
            <StatusDot ok={services.candidates.ok} />
            <span style={{ fontWeight: 600, color: '#1f2937' }}>候选生成：</span>
            <span style={{ color: services.candidates.ok ? '#1f8a4c' : '#b8860b' }}>{services.candidates.text}</span>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2, marginLeft: 14 }}>{services.candidates.detail || ''}</div>
          </div>
          <div style={{ flex: 1, minWidth: 180 }}>
            <StatusDot ok={services.scoring.ok} />
            <span style={{ fontWeight: 600, color: '#1f2937' }}>潮流评分：</span>
            <span style={{ color: services.scoring.ok ? '#1f8a4c' : '#b8860b' }}>{services.scoring.text}</span>
            <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 2, marginLeft: 14 }}>{services.scoring.detail || ''}</div>
          </div>
        </div>
      </SectionCard>

      {/* 当前处置流程摘要 */}
      <SectionCard title="当前处置流程" style={{ marginBottom: 16 }}>
        {wf ? (
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12, alignItems: 'center' }}>
            <span><span style={{ color: '#667085' }}>故障线路：</span><strong style={{ color: '#eb5757' }}>{wf.fault_line || '-'}</strong></span>
            <span style={{ color: '#c8d6e5' }}>|</span>
            <span><span style={{ color: '#667085' }}>当前阶段：</span><strong style={{ color: '#1f8a4c' }}>{wfStage}</strong></span>
            <span style={{ color: '#c8d6e5' }}>|</span>
            <span><span style={{ color: '#667085' }}>方案编号：</span><strong style={{ color: wf.selected_plan_id ? '#1f8a4c' : '#94a3b8' }}>{wf.selected_plan_id || '未选择'}</strong></span>
            <span style={{ color: '#c8d6e5' }}>|</span>
            <span><span style={{ color: '#667085' }}>联络线：</span><strong style={{ color: '#1f8a4c' }}>{(wf.selected_tie_lines || []).join('、') || '未选择'}</strong></span>
            {wf.sequence_result?.plan_id && (
              <><span style={{ color: '#c8d6e5' }}>|</span>
              <span><span style={{ color: '#667085' }}>序列编号：</span><strong>{wf.sequence_result.plan_id}</strong></span></>
            )}
            {wf.ticket?.ticket_id && (
              <><span style={{ color: '#c8d6e5' }}>|</span>
              <span><span style={{ color: '#667085' }}>票号：</span><strong style={{ color: '#1f8a4c' }}>{wf.ticket.ticket_id}</strong></span></>
            )}
            {wf.safety_result && (
              <><span style={{ color: '#c8d6e5' }}>|</span>
              <span><span style={{ color: '#667085' }}>安全校验：</span>
              <span style={{
                fontSize: 11, fontWeight: 600, padding: '1px 8px', borderRadius: 3,
                background: wf.safety_result.status === 'passed' ? '#e8f5e9' : wf.safety_result.status === 'passed_with_warnings' ? '#fff8e1' : '#ffebee',
                color: wf.safety_result.status === 'passed' ? '#1f8a4c' : wf.safety_result.status === 'passed_with_warnings' ? '#b8860b' : '#eb5757',
              }}>{wf.safety_result.status === 'failed' ? '不通过' : wf.safety_result.status === 'passed_with_warnings' ? '有条件通过' : '通过'}</span></span></>
            )}
            {wf.transfer_status === 'external_pending' && (
              <span style={{ fontSize: 10, background: '#fff8e1', color: '#b8860b', borderRadius: 3, padding: '1px 6px', border: '1px solid #f2c94c' }}>待外部评分</span>
            )}
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: 16, color: '#94a3b8', fontSize: 12 }}>
            暂无当前处置流程。请从拓扑图选择故障线路后前往「边界判定」开始流程。
          </div>
        )}
      </SectionCard>

      {/* IEEE 33 单线图 */}
      <SectionCard title="配电网拓扑图 · IEEE 33 节点单线图" style={{ marginBottom: 20 }}>
        <IEEE33Topology predictData={null} realtimeData={realtimeData} />
      </SectionCard>

      {/* 系统业务流程 */}
      <SectionCard title="系统业务流程">
        <WorkflowProgress currentStep="fault" />
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
          {flowSteps.map((step, i) => (
            <div key={step.title} style={{ display: 'flex', alignItems: 'center', flex: 1, minWidth: 0 }}>
              <div style={{
                background: '#fff', border: '1px solid #c8d6e5', borderRadius: 6,
                padding: '10px 8px', textAlign: 'center', flex: 1,
              }}>
                <div style={{ fontWeight: 600, fontSize: 12, color: '#1f8a4c', marginBottom: 2 }}>{step.title}</div>
                <div style={{ fontSize: 10, color: '#94a3b8' }}>{step.desc}</div>
              </div>
              {i < flowSteps.length - 1 && (
                <div style={{ color: '#c8d6e5', fontSize: 14, padding: '0 2px', flexShrink: 0 }}>→</div>
              )}
            </div>
          ))}
        </div>
      </SectionCard>
    </PageContainer>
  );
}
