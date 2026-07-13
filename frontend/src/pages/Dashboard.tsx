import { useEffect, useState } from 'react';
import PageContainer from '../layouts/PageContainer';
import MetricCard from '../components/MetricCard';
import SectionCard from '../components/SectionCard';
import IEEE33Topology from '../components/topology/IEEE33Topology';
import WorkflowProgress from '../components/WorkflowProgress';
import PredictPanel from '../components/PredictPanel';
import FlaskPanel from '../components/FlaskPanel';
import { realtimeApi } from '../services/apiClient';
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

/** 从实时节点列表计算汇总指标 */
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

export default function Dashboard() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [predictData, setPredictData] = useState<any>(null);
  const [realtimeData, setRealtimeData] = useState<RealtimeLatest | null>(null);
  const [dataSource, setDataSource] = useState<'realtime' | 'fallback'>('fallback');
  const [rtMetrics, setRtMetrics] = useState<ReturnType<typeof computeRealtimeMetrics> | null>(null);

  useEffect(() => {
    // 优先尝试实时数据
    realtimeApi.getLatest().then((data) => {
      if (data?.success && data.has_data && data.nodes && data.nodes.length > 0) {
        setRealtimeData(data);
        setDataSource('realtime');
        setRtMetrics(computeRealtimeMetrics(data.nodes));
        // 同时仍获取 summary 作为后备展示
        fetch('http://localhost:8000/api/dashboard/summary')
          .then((r) => r.json())
          .then((res) => { if (res.data) setSummary(res.data); })
          .catch(() => {});
      } else {
        // 实时数据为空或 has_data=false，回退 summary
        setRealtimeData(data); // 保留以便显示状态标签
        setDataSource('fallback');
        fetchSummary();
      }
    }).catch(() => {
      // 实时接口异常，回退 summary
      setDataSource('fallback');
      fetchSummary();
    });
  }, []);

  function fetchSummary() {
    fetch('http://localhost:8000/api/dashboard/summary')
      .then((r) => r.json())
      .then((res) => { if (res.data) setSummary(res.data); })
      .catch(() => {
        setSummary({ totalEvents: 12, totalTickets: 28, safetyPassRate: 92.5, manualInterventionRate: 7.5 });
      });
  }

  // 数据来源标签：根据 source_tag + trusted_source 联合判定
  function getSourceLabel(): { text: string; bg: string; color: string; border: string } {
    if (dataSource === 'fallback') {
      // 检查是否有 realtime 返回的状态信息
      const tag = realtimeData?.source_tag || '';
      if (tag === 'none') {
        return { text: '📭 暂无实时数据', bg: '#f3f6f9', color: '#667085', border: '#c8d6e5' };
      }
      return { text: '⚠ 演示数据', bg: '#fff8e1', color: '#b8860b', border: '#f2c94c' };
    }
    const tag = realtimeData?.source_tag || '';
    const trusted = realtimeData?.trusted_source === true;

    // simulink/matlab + token 验证通过 → 真正实时数据
    if ((tag === 'simulink' || tag === 'matlab') && trusted) {
      return { text: '📡 Simulink实时数据', bg: '#e8f5e9', color: '#1f8a4c', border: '#a5d6a7' };
    }
    // simulink 声称但 token 未通过
    if (tag === 'unverified_simulink') {
      return { text: '⚠ 未验证Simulink数据', bg: '#ffebee', color: '#e74c3c', border: '#ffcdd2' };
    }
    // simulink 声称但无 token (旧版兼容：source_tag=simulink 但 trusted_source=false)
    if ((tag === 'simulink' || tag === 'matlab') && !trusted) {
      return { text: '⚠ 未验证Simulink数据', bg: '#ffebee', color: '#e74c3c', border: '#ffcdd2' };
    }
    if (tag === 'test') {
      return { text: '🧪 测试实时数据', bg: '#e3f0ff', color: '#2f80ed', border: '#90caf9' };
    }
    if (tag === 'manual') {
      return { text: '🔧 手动测试数据', bg: '#fff8e1', color: '#e67e22', border: '#f2c94c' };
    }
    if (tag === 'mock') {
      return { text: '🔬 模拟实时数据', bg: '#e3f0ff', color: '#2f80ed', border: '#90caf9' };
    }
    if (tag === 'none') {
      return { text: '📭 暂无实时数据', bg: '#f3f6f9', color: '#667085', border: '#c8d6e5' };
    }
    if (tag === 'static') {
      return { text: '📋 静态拓扑数据', bg: '#f3f6f9', color: '#667085', border: '#c8d6e5' };
    }
    // 未知 tag
    return { text: `🔧 测试数据(${tag || '未知'})`, bg: '#fff8e1', color: '#e67e22', border: '#f2c94c' };
  }

  const sourceLabel = getSourceLabel();

  // 数据来源标签样式
  const sourceTagStyle: React.CSSProperties = {
    display: 'inline-block',
    padding: '2px 10px',
    borderRadius: 10,
    fontSize: 10,
    fontWeight: 600,
    marginLeft: 8,
    verticalAlign: 'middle',
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
          点击<strong>联络开关(T1-T5)</strong>查看转供能力 |
          点击 <strong>"▶ 开始演示"</strong> 一键跑通故障→转供完整流程
        </span>
        <span style={{
          ...sourceTagStyle,
          background: sourceLabel.bg,
          color: sourceLabel.color,
          border: `1px solid ${sourceLabel.border}`,
        }}>
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
            <MetricCard label="已导出操作票" value={summary?.totalTickets ?? 28} unit="张" color="#1f8a4c" trend="本月累计" trendColor="#1f8a4c" />
          </>
        ) : (
          <>
            <MetricCard label="今日故障事件" value={summary?.totalEvents ?? 12} unit="起" color="#eb5757" trend="较昨日 +2" trendColor="#eb5757" />
            <MetricCard label="待成票任务" value={5} unit="张" color="#2f80ed" trend="处理中" trendColor="#2f80ed" />
            <MetricCard label="安全校验通过率" value={summary?.safetyPassRate ?? 92.5} unit="%" color="#1f8a4c" trend="正常" trendColor="#1f8a4c" />
            <MetricCard label="高危馈线数" value={3} unit="条" color="#f2c94c" trend="需关注" trendColor="#f2c94c" />
            <MetricCard label="待人工复核" value={3} unit="项" color="#f2c94c" trend="3 项待处理" trendColor="#f2c94c" />
            <MetricCard label="已导出操作票" value={summary?.totalTickets ?? 28} unit="张" color="#1f8a4c" trend="本月累计" trendColor="#1f8a4c" />
          </>
        )}
      </div>

      {/* 交互式 IEEE 33 单线图 */}
      <SectionCard title="配电网拓扑图 · IEEE 33 节点单线图" style={{ marginBottom: 20 }}>
        <IEEE33Topology predictData={predictData} realtimeData={realtimeData} />
      </SectionCard>

      {/* 预测面板 */}
      <PredictPanel onPredict={setPredictData} />

      {/* 外部 Flask 数据服务 */}
      <FlaskPanel />

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
