import { useEffect, useState, useMemo } from 'react';
import PageContainer from '../layouts/PageContainer';
import MetricCard from '../components/MetricCard';
import SectionCard from '../components/SectionCard';
import IEEE33Topology from '../components/topology/IEEE33Topology';
import { realtimeApi } from '../services/apiClient';
import { getCurrentWorkflow } from '../store/workflowStore';
import type { RealtimeLatest, RealtimeNode } from '../services/apiClient';

/* ============ 调度核心指标 ============ */
interface CoreMetrics {
  total_load_kw: number;
  min_voltage_pu: number;
  min_voltage_node: number;
  voltage_below_095: number;
  voltage_below_097: number;
  overloaded_lines: { line: string; load_pct: number }[];
  max_load_pct: number;
  max_load_line: string;
  node_count: number;
  line_count: number;
}

function computeCoreMetrics(nodes: RealtimeNode[], lines: any[]): CoreMetrics {
  const total_load_kw = nodes.reduce((s, n) => s + (n.load_kw || 0), 0);
  const voltages = nodes
    .filter(n => n.voltage_pu != null)
    .map(n => ({ node: n.node, v: n.voltage_pu as number }));
  const minEntry = voltages.length > 0
    ? voltages.reduce((a, b) => (a.v < b.v ? a : b))
    : { node: 0, v: 1.0 };
  const below_095 = voltages.filter(x => x.v < 0.95).length;
  const below_097 = voltages.filter(x => x.v < 0.97).length;

  // 线路负载率（简单估算：负荷/额定容量，缺额定值时按节点负荷之和比例估算）
  const overloaded_lines: { line: string; load_pct: number }[] = [];
  let max_load_pct = 0;
  let max_load_line = '-';
  const RATED_DEFAULT = 5000; // 缺额定值时默认容量 kW
  for (const l of lines) {
    const lineName = l.line || l.name || '';
    const rated = l.rated_kw || l.capacity_kw || RATED_DEFAULT;
    const current = l.current_load_kw || l.load_kw || l.power_kw || 0;
    const load_pct = rated > 0 ? Math.round((current / rated) * 1000) / 10 : 0;
    if (load_pct > 80) overloaded_lines.push({ line: lineName, load_pct });
    if (load_pct > max_load_pct) { max_load_pct = load_pct; max_load_line = lineName; }
  }
  overloaded_lines.sort((a, b) => b.load_pct - a.load_pct);

  return {
    total_load_kw, min_voltage_pu: minEntry.v, min_voltage_node: minEntry.node,
    voltage_below_095: below_095, voltage_below_097: below_097,
    overloaded_lines, max_load_pct, max_load_line,
    node_count: nodes.length, line_count: lines.length,
  };
}

function fmt(v: number, d = 1): string { return Number.isFinite(v) ? v.toFixed(d) : '--'; }

/* ============ 辅助组件 ============ */

/** 紧凑状态条 — 4 项挤在一行 */
function CompactStatusBar({ services }: { services: any }) {
  const items = [
    { label: '实时数据', ok: services.simulink?.ok, text: services.simulink?.text || '-' },
    { label: '源荷预测', ok: services.forecast?.ok, text: services.forecast?.text || '-' },
    { label: '候选生成', ok: services.candidates?.ok, text: services.candidates?.text || '-' },
    { label: '潮流评分', ok: services.scoring?.ok, text: services.scoring?.text || '-' },
  ];
  return (
    <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: 11, color: '#667085' }}>
      {items.map(it => (
        <span key={it.label}>
          <span style={{
            display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
            background: it.ok ? '#1f8a4c' : '#f2c94c',
            marginRight: 4, verticalAlign: 'middle',
          }} />
          {it.label}：<span style={{ color: it.ok ? '#1f8a4c' : '#b8860b', fontWeight: 500 }}>{it.text}</span>
        </span>
      ))}
    </div>
  );
}

/** 快捷跳转按钮 */
function JumpBtn({ label, to }: { label: string; to: string }) {
  return (
    <button
      onClick={() => window.location.href = to}
      style={{
        padding: '4px 12px', borderRadius: 4, border: '1px solid #1f8a4c',
        background: '#e8f5e9', color: '#1f8a4c', fontSize: 11, fontWeight: 600,
        cursor: 'pointer', whiteSpace: 'nowrap',
      }}
    >
      {label} →
    </button>
  );
}

export default function Dashboard() {
  const [realtimeData, setRealtimeData] = useState<RealtimeLatest | null>(null);
  const [dataSource, setDataSource] = useState<'realtime' | 'fallback'>('fallback');
  const [metrics, setMetrics] = useState<CoreMetrics | null>(null);
  const [services, setServices] = useState({
    simulink: { ok: false, text: '检测中...' },
    forecast: { ok: false, text: '检测中...' },
    candidates: { ok: false, text: '检测中...' },
    scoring: { ok: false, text: '检测中...' },
  });

  // ---- 实时数据轮询 ----
  useEffect(() => {
    let mounted = true;
    function poll() {
      realtimeApi.getLatest().then((data) => {
        if (!mounted) return;
        if (data?.success && data.nodes?.length) {
          setRealtimeData(data);
          setDataSource('realtime');
          setMetrics(computeCoreMetrics(data.nodes, data.lines || []));
          setServices(prev => ({
            ...prev,
            simulink: { ok: true, text: `${data.nodes.length}节点·${data.lines?.length || 0}线路` },
          }));
        } else {
          setRealtimeData(data);
          setDataSource('fallback');
          setServices(prev => ({
            ...prev,
            simulink: data?.source_tag === 'none'
              ? { ok: false, text: '等待推送' }
              : { ok: false, text: '仿真数据' },
          }));
        }
      }).catch(() => {
        if (!mounted) setDataSource('fallback');
      });
    }
    // 算法服务状态
    function checkAlgo() {
      fetch('http://localhost:8000/api/algorithm/health')
        .then(r => r.json()).then(d => {
          if (!mounted) return;
          const caps = d.capabilities?.modules || {};
          const ok = d.available === true;
          setServices(prev => ({
            ...prev,
            forecast: ok && caps.forecast ? { ok: true, text: '可用' } : { ok: false, text: '本地' },
            candidates: ok && caps.candidate_generation ? { ok: true, text: '可用' } : { ok: false, text: '离线' },
            scoring: ok && (caps.full_pipeline || caps.matpower_online) ? { ok: true, text: '在线' } : { ok: false, text: '离线' },
          }));
        }).catch(() => {});
    }
    poll(); checkAlgo();
    const t1 = setInterval(poll, 5000);
    const t2 = setInterval(checkAlgo, 30000);
    return () => { mounted = false; clearInterval(t1); clearInterval(t2); };
  }, []);

  // ---- 数据来源标签 ----
  function getSourceTag() {
    if (dataSource === 'fallback') {
      const tag = realtimeData?.source_tag || '';
      if (tag === 'none') return { text: '暂无实时数据', bg: '#f3f6f9', color: '#667085' };
      return { text: '仿真验证模式 · IEEE33', bg: '#fff8e1', color: '#b8860b' };
    }
    const tag = realtimeData?.source_tag || '';
    const trusted = realtimeData?.trusted_source === true;
    if ((tag === 'simulink' || tag === 'matlab') && trusted) {
      return { text: 'Simulink 实时数据', bg: '#e8f5e9', color: '#1f8a4c' };
    }
    return { text: '实时数据（未验证）', bg: '#fff8e1', color: '#b8860b' };
  }
  const sourceTag = getSourceTag();

  // ---- 当前处置流程 ----
  const wf = useMemo(() => getCurrentWorkflow(), [realtimeData]);
  const wfStage = useMemo(() => {
    if (!wf?.fault_line) return null;
    if (!wf.selected_plan) return '转供决策';
    if (!wf.operation_sequence) return '操作序列生成';
    if (!wf.safety_result) return '安全校验';
    if (!wf.ticket) return '模板化成票';
    return '已完成';
  }, [wf]);

  const stageJumpMap: Record<string, string> = {
    '转供决策': '/transfer-decision',
    '操作序列生成': '/sequence-generation',
    '安全校验': '/safety-check',
    '模板化成票': '/ticket-generation',
    '已完成': '/ticket-generation',
  };

  return (
    <PageContainer title="系统主界面">
      {/* ====== 1. 交互提示 + 数据来源 ====== */}
      <div style={{
        background: '#e3f0ff', border: '1px solid #90caf9', borderRadius: 6,
        padding: '8px 16px', marginBottom: 14, fontSize: 11, color: '#1f2937',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8,
      }}>
        <span>
          💡 <strong>交互提示：</strong>点击拓扑图中的<strong>节点</strong>查看负荷与电压详情 |
          点击<strong>线路</strong>查看参数并可设为故障 |
          点击<strong>联络开关 T1-T5</strong> 查看转供能力
        </span>
        <span style={{
          padding: '2px 10px', borderRadius: 10, fontSize: 10, fontWeight: 600,
          background: sourceTag.bg, color: sourceTag.color, border: `1px solid ${sourceTag.color}33`,
        }}>
          {sourceTag.text}
        </span>
      </div>

      {/* ====== 2. 核心指标卡（4 项，纯实时数据驱动） ====== */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        {metrics ? (
          <>
            <MetricCard
              label="系统总负荷" value={fmt(metrics.total_load_kw)} unit="kW"
              color="#2f80ed" trend={metrics.total_load_kw > 3000 ? '重载' : '正常'}
              trendColor={metrics.total_load_kw > 3000 ? '#f2c94c' : '#1f8a4c'}
            />
            <MetricCard
              label="最低电压" value={fmt(metrics.min_voltage_pu, 3)} unit="pu"
              color={metrics.min_voltage_pu < 0.95 ? '#eb5757' : '#1f8a4c'}
              trend={`节点 ${metrics.min_voltage_node} · ${metrics.min_voltage_pu < 0.95 ? '⚠ 越限' : metrics.min_voltage_pu < 0.97 ? '偏低' : '正常'}`}
              trendColor={metrics.min_voltage_pu < 0.95 ? '#eb5757' : metrics.min_voltage_pu < 0.97 ? '#f2c94c' : '#1f8a4c'}
            />
            <MetricCard
              label="电压偏低节点" value={metrics.voltage_below_097} unit="个"
              color={metrics.voltage_below_095 > 0 ? '#eb5757' : metrics.voltage_below_097 > 0 ? '#f2c94c' : '#1f8a4c'}
              trend={metrics.voltage_below_095 > 0 ? `其中 ${metrics.voltage_below_095} 个低于 0.95 pu` : ' ≥0.97 pu 正常'}
              trendColor={metrics.voltage_below_095 > 0 ? '#eb5757' : '#1f8a4c'}
            />
            <MetricCard
              label="线路重载" value={metrics.overloaded_lines.length} unit="条"
              color={metrics.overloaded_lines.length > 0 ? '#eb5757' : '#1f8a4c'}
              trend={metrics.overloaded_lines.length > 0 ? `最重载: ${metrics.max_load_line} ${metrics.max_load_pct}%` : '全部 80% 以下'}
              trendColor={metrics.overloaded_lines.length > 0 ? '#eb5757' : '#1f8a4c'}
            />
          </>
        ) : (
          <>
            <MetricCard label="系统总负荷" value="--" unit="kW" color="#94a3b8" trend="等待实时数据" trendColor="#94a3b8" />
            <MetricCard label="最低电压" value="--" unit="pu" color="#94a3b8" trend="等待实时数据" trendColor="#94a3b8" />
            <MetricCard label="电压偏低节点" value="--" unit="个" color="#94a3b8" trend="等待实时数据" trendColor="#94a3b8" />
            <MetricCard label="线路重载" value="--" unit="条" color="#94a3b8" trend="等待实时数据" trendColor="#94a3b8" />
          </>
        )}
      </div>

      {/* ====== 3. 紧凑状态栏 + 当前处置流程（同行） ====== */}
      <div style={{
        display: 'flex', gap: 12, marginBottom: 14, flexWrap: 'wrap',
        background: '#fff', border: '1px solid #c8d6e5', borderRadius: 6,
        padding: '8px 16px', alignItems: 'center',
      }}>
        <CompactStatusBar services={services} />
        <span style={{ color: '#c8d6e5' }}>|</span>
        {wf?.fault_line ? (
          <span style={{ fontSize: 11, color: '#1f2937', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span>故障线路：<strong style={{ color: '#eb5757' }}>{wf.fault_line}</strong></span>
            <span style={{ color: '#c8d6e5' }}>|</span>
            <span>阶段：<strong style={{ color: '#1f8a4c' }}>{wfStage}</strong></span>
            {wf.selected_plan_id && (
              <>
                <span style={{ color: '#c8d6e5' }}>|</span>
                <span>方案：<strong>{wf.selected_plan_id}</strong></span>
                <span style={{ color: '#c8d6e5' }}>|</span>
                <span>联络线：<strong style={{ color: '#1f8a4c' }}>{(wf.selected_tie_lines || []).join('、') || '-'}</strong></span>
              </>
            )}
            {wf.safety_result && (
              <>
                <span style={{ color: '#c8d6e5' }}>|</span>
                <span style={{
                  fontSize: 10, fontWeight: 600, padding: '1px 6px', borderRadius: 3,
                  background: wf.safety_result.status === 'passed' ? '#e8f5e9' : '#ffebee',
                  color: wf.safety_result.status === 'passed' ? '#1f8a4c' : '#eb5757',
                }}>
                  {wf.safety_result.status === 'failed' ? '不通过' : wf.safety_result.status === 'passed_with_warnings' ? '有条件通过' : '安全通过'}
                </span>
              </>
            )}
            {stageJumpMap[wfStage || ''] && (
              <JumpBtn label={`进入${wfStage}`} to={stageJumpMap[wfStage!]} />
            )}
          </span>
        ) : (
          <span style={{ fontSize: 11, color: '#94a3b8' }}>
            暂无处置流程 — 在拓扑图中选择线路开始故障处置
          </span>
        )}
      </div>

      {/* ====== 4. 电网拓扑图 — 核心视觉锚点 ====== */}
      <SectionCard title="配电网拓扑图 · IEEE 33 节点" style={{ marginBottom: 14 }}>
        <IEEE33Topology predictData={null} realtimeData={realtimeData} />
      </SectionCard>

      {/* ====== 5. 告警摘要（当存在越限/重载时显示） ====== */}
      {metrics && (metrics.voltage_below_095 > 0 || metrics.overloaded_lines.length > 0) && (
        <div style={{
          background: '#fff5f5', border: '1px solid #ffcdd2', borderRadius: 6,
          padding: '10px 16px', fontSize: 12, color: '#e74c3c',
        }}>
          <strong>⚠ 运行风险提示：</strong>
          {metrics.voltage_below_095 > 0 && (
            <span style={{ marginRight: 16 }}>
              {metrics.voltage_below_095} 个节点电压低于 0.95 pu（最低 Bus-{metrics.min_voltage_node} = {fmt(metrics.min_voltage_pu, 3)} pu）
            </span>
          )}
          {metrics.overloaded_lines.length > 0 && (
            <span>
              {metrics.overloaded_lines.length} 条线路负载率超 80%：{metrics.overloaded_lines.slice(0, 3).map(l => `${l.line}(${l.load_pct}%)`).join('、')}
            </span>
          )}
        </div>
      )}
    </PageContainer>
  );
}
