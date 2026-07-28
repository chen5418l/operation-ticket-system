import { useState } from 'react';
import PageContainer from '../layouts/PageContainer';
import MetricCard from '../components/MetricCard';
import DataTable from '../components/DataTable';
import StatusBadge from '../components/StatusBadge';
import SectionCard from '../components/SectionCard';

/* ==================== IEEE33 故障场景测试矩阵 ==================== */
interface TestCase {
  id: string; scenario: string; faultLine: string; faultSection: string;
  outageNodes: number; outageLoadKW: number;
  tiesAvailable: string[]; tiesUsed: string;
  topoCheck: string; powerFlow: string;
  Vmin: number | null; Lmax: number | null;
  safetyStatus: string; flowComplete: boolean; remark: string;
}

const testCases: TestCase[] = [
  { id: 'F1', scenario: '主馈线中段故障', faultLine: '4-5', faultSection: 'L4: Bus4-Bus5',
    outageNodes: 29, outageLoadKW: 2276,
    tiesAvailable: ['T1(8-21)', 'T2(9-15)'], tiesUsed: 'T1',
    topoCheck: '通过', powerFlow: '收敛', Vmin: 0.983, Lmax: 38.2,
    safetyStatus: '通过', flowComplete: true, remark: '单联络线完全恢复' },
  { id: 'F2', scenario: '支线出口故障', faultLine: '8-9', faultSection: 'L8: Bus8-Bus9',
    outageNodes: 10, outageLoadKW: 519,
    tiesAvailable: ['T2(9-15)', 'T3(12-22)', 'T4(18-33)'], tiesUsed: 'T3',
    topoCheck: '通过', powerFlow: '收敛', Vmin: 0.992, Lmax: 41.4,
    safetyStatus: '通过', flowComplete: true, remark: '满分方案，完全恢复' },
  { id: 'F3', scenario: '上游近电源端故障', faultLine: '2-3', faultSection: 'L2: Bus2-Bus3',
    outageNodes: 27, outageLoadKW: 2095,
    tiesAvailable: ['T1-T5 全部'], tiesUsed: 'T1',
    topoCheck: '通过', powerFlow: '收敛', Vmin: 0.966, Lmax: 24.4,
    safetyStatus: '通过', flowComplete: true, remark: 'prepare→generate 10步' },
  { id: 'F4', scenario: '末端分支故障', faultLine: '13-14', faultSection: 'L13: Bus13-Bus14',
    outageNodes: 5, outageLoadKW: 420,
    tiesAvailable: ['T3(12-22)', 'T4(18-33)'], tiesUsed: 'T2(9-15)',
    topoCheck: '通过', powerFlow: '收敛', Vmin: 1.008, Lmax: 24.0,
    safetyStatus: '通过', flowComplete: true, remark: '验收流程 A：ALG-001' },
  { id: 'F5', scenario: '成环拓扑约束校验', faultLine: '4-5', faultSection: 'L4+T3双联络',
    outageNodes: 29, outageLoadKW: 2276,
    tiesAvailable: ['T1', 'T2'], tiesUsed: 'T1+T2（双联络）',
    topoCheck: '阻断(成环)', powerFlow: '—', Vmin: null, Lmax: null,
    safetyStatus: '阻断', flowComplete: false, remark: 'cycle_count=1, radial=false' },
  { id: 'F6', scenario: '电压越限场景', faultLine: '6-26', faultSection: 'L25: Bus6-Bus26',
    outageNodes: 8, outageLoadKW: 630,
    tiesAvailable: ['T4(18-33)', 'T5(25-29)'], tiesUsed: 'T5',
    topoCheck: '通过', powerFlow: '收敛', Vmin: 0.948, Lmax: 52.6,
    safetyStatus: '警告', flowComplete: true, remark: '末端电压偏低(Vmin<0.95)' },
];

/* ==================== 汇总 ==================== */
const total = testCases.length;
const passCount = testCases.filter(t => t.safetyStatus === '通过').length;
const warnCount = testCases.filter(t => t.safetyStatus === '警告').length;
const blockCount = testCases.filter(t => t.safetyStatus === '阻断').length;
const flowComplete = testCases.filter(t => t.flowComplete).length;
const topoPass = testCases.filter(t => t.topoCheck === '通过').length;
const pfConverged = testCases.filter(t => t.powerFlow === '收敛').length;
const vminList = testCases.filter(t => t.Vmin != null).map(t => t.Vmin as number);
const avgVmin = vminList.length > 0 ? vminList.reduce((a, b) => a + b, 0) / vminList.length : 0;
const worstVmin = vminList.length > 0 ? Math.min(...vminList) : 0;
const lmaxList = testCases.filter(t => t.Lmax != null).map(t => t.Lmax as number);
const avgLmax = lmaxList.length > 0 ? lmaxList.reduce((a, b) => a + b, 0) / lmaxList.length : 0;

/* ==================== 流程覆盖 ==================== */
const flowCoverage = [
  { step: '故障输入', coverage: '6/6', status: '已验证', detail: '全部故障场景可输入并识别' },
  { step: '边界判定', coverage: '6/6', status: '已验证', detail: 'BFS 辐射状分析 + 外部算法评估' },
  { step: '转供决策', coverage: '5/6', status: '已验证', detail: 'F5 成环场景正确阻断，其余推荐方案合理' },
  { step: '外部评分', coverage: '4/6', status: '已联调', detail: 'F3/F4 经 8010 pipeline 完成评分' },
  { step: '操作序列(8010)', coverage: '3/6', status: '已联调', detail: 'F3/F4/F2 通过 prepare→generate 流程' },
  { step: '安全校验(8010)', coverage: '3/6', status: '已联调', detail: 'F1/F2/F3 通过 8010 安全校验' },
];

/* ==================== 导出 ==================== */
function buildReport() {
  return {
    generatedAt: new Date().toISOString(),
    system: 'IEEE33 仿真验证 · 市级配电网智能成票与安全校验系统',
    summary: {
      total, passCount, warnCount, blockCount, flowComplete,
      topoPassRate: `${Math.round(topoPass / total * 100)}%`,
      pfConvergeRate: `${Math.round(pfConverged / testCases.filter(t => t.powerFlow !== '—').length * 100)}%`,
      avgVmin: avgVmin.toFixed(3), worstVmin: worstVmin.toFixed(3), avgLmax: avgLmax.toFixed(1),
    },
    testCases,
    flowCoverage,
    note: '当前为 IEEE33 仿真验证阶段测试报告，数据基于标准测试模型。',
  };
}

/* ==================== 进度条 ==================== */
function ProgressBar({ label, count, total, color, bg }: { label: string; count: number; total: number; color: string; bg: string }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={{ width: 50, fontSize: 12, color: '#667085' }}>{label}</span>
      <div style={{ flex: 1, height: 18, background: '#f3f6f9', borderRadius: 9, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, background: bg, borderRadius: 9, borderRight: `2px solid ${color}`, transition: 'width 0.3s' }} />
      </div>
      <span style={{ width: 60, fontSize: 12, color, fontWeight: 600, textAlign: 'right' }}>{count} ({pct}%)</span>
    </div>
  );
}

export default function Statistics() {
  const [exportMsg, setExportMsg] = useState('');

  const doExport = () => {
    const report = buildReport();
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `IEEE33_测试报告_${new Date().toISOString().slice(0, 10)}.json`;
    a.click(); URL.revokeObjectURL(url);
    setExportMsg('已导出');
    setTimeout(() => setExportMsg(''), 2000);
  };

  // ---- 测试用例列 ----
  const tcColumns = [
    { key: 'id', title: 'ID', dataIndex: 'id' as const, width: 30, render: (r: TestCase) => <span style={{ fontWeight: 700, color: '#1f8a4c', fontSize: 11 }}>{r.id}</span> },
    { key: 'scenario', title: '场景', dataIndex: 'scenario' as const, width: 110 },
    { key: 'faultLine', title: '故障线路', dataIndex: 'faultLine' as const, width: 60, render: (r: TestCase) => <span style={{ fontFamily: 'monospace', fontSize: 11, color: '#eb5757', fontWeight: 600 }}>{r.faultLine}</span> },
    { key: 'outageNodes', title: '失电节点', dataIndex: 'outageNodes' as const, width: 60, render: (r: TestCase) => <span style={{ fontSize: 11 }}>{r.outageNodes} 个</span> },
    { key: 'outageLoadKW', title: '失电负荷', dataIndex: 'outageLoadKW' as const, width: 68, render: (r: TestCase) => <span style={{ fontSize: 11 }}>{r.outageLoadKW} kW</span> },
    { key: 'tiesUsed', title: '联络方案', dataIndex: 'tiesUsed' as const, width: 100, render: (r: TestCase) => <span style={{ fontSize: 10 }}>{r.tiesUsed}</span> },
    { key: 'topoCheck', title: '拓扑', dataIndex: 'topoCheck' as const, width: 75, render: (r: TestCase) => (
      <span style={{ fontSize: 10, fontWeight: 600, color: r.topoCheck === '通过' ? '#1f8a4c' : '#eb5757' }}>{r.topoCheck}</span>
    )},
    { key: 'powerFlow', title: '潮流', dataIndex: 'powerFlow' as const, width: 48, render: (r: TestCase) => (
      <span style={{ fontSize: 10, fontWeight: 600, color: r.powerFlow === '收敛' ? '#1f8a4c' : r.powerFlow === '—' ? '#94a3b8' : '#eb5757' }}>{r.powerFlow}</span>
    )},
    { key: 'Vmin', title: 'Vmin(pu)', dataIndex: 'Vmin' as const, width: 70, render: (r: TestCase) => (
      <span style={{ fontSize: 11, fontWeight: 600, color: r.Vmin != null && r.Vmin < 0.95 ? '#eb5757' : '#1f8a4c' }}>
        {r.Vmin != null ? r.Vmin.toFixed(3) : '—'}
      </span>
    )},
    { key: 'Lmax', title: 'Lmax(%)', dataIndex: 'Lmax' as const, width: 65, render: (r: TestCase) => (
      <span style={{ fontSize: 11, fontWeight: 600, color: r.Lmax != null && r.Lmax > 80 ? '#eb5757' : '#1f2937' }}>
        {r.Lmax != null ? r.Lmax.toFixed(1) : '—'}
      </span>
    )},
    { key: 'safetyStatus', title: '安全', dataIndex: 'safetyStatus' as const, width: 48, render: (r: TestCase) => <StatusBadge status={r.safetyStatus} /> },
    { key: 'remark', title: '备注', dataIndex: 'remark' as const, width: 150, render: (r: TestCase) => <span style={{ fontSize: 10, color: '#667085' }}>{r.remark}</span> },
  ];

  // ---- 流程覆盖列 ----
  const fcColumns = [
    { key: 'step', title: '流程步骤', dataIndex: 'step' as const, width: 120 },
    { key: 'coverage', title: '覆盖', dataIndex: 'coverage' as const, width: 52, render: (r: typeof flowCoverage[0]) => <strong style={{ color: '#1f8a4c' }}>{r.coverage}</strong> },
    { key: 'status', title: '状态', dataIndex: 'status' as const, width: 72, render: (r: typeof flowCoverage[0]) => (
      <StatusBadge status={r.status === '已验证' ? '通过' : r.status === '已联调' ? '已校核' : '待验证'} />
    )},
    { key: 'detail', title: '说明', dataIndex: 'detail' as const, render: (r: typeof flowCoverage[0]) => <span style={{ fontSize: 11, color: '#667085' }}>{r.detail}</span> },
  ];

  return (
    <PageContainer title="测试统计">
      {/* ====== 顶部提示 ====== */}
      <div style={{
        background: '#fff8e1', border: '1px solid #f2c94c', borderRadius: 6,
        padding: '6px 14px', marginBottom: 14, fontSize: 11, color: '#b8860b',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8,
      }}>
        <span>IEEE33 仿真验证阶段 · 测试数据基于标准 33 节点模型，不作为正式验收依据。</span>
        <button onClick={doExport}
          style={{ padding: '3px 12px', borderRadius: 3, fontSize: 10, cursor: 'pointer', background: '#fff', color: '#1f8a4c', border: '1px solid #1f8a4c', fontWeight: 600 }}>
          {exportMsg || '📥 导出测试报告'}
        </button>
      </div>

      {/* ====== 系统级指标 ====== */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <MetricCard label="测试用例" value={total} unit="个" color="#2f80ed" trend="IEEE33 故障场景" trendColor="#2f80ed" />
        <MetricCard label="拓扑校验通过" value={topoPass} unit={`/ ${total}`} color="#1f8a4c" trend={`${Math.round(topoPass / total * 100)}% · BFS 辐射状校核`} trendColor="#1f8a4c" />
        <MetricCard label="潮流收敛" value={pfConverged} unit={`/ ${testCases.filter(t => t.powerFlow !== '—').length}`} color="#2f80ed" trend="MATPOWER/本地计算" trendColor="#2f80ed" />
        <MetricCard label="流程闭环" value={flowComplete} unit={`/ ${total}`} color="#1f8a4c" trend="故障→转供→序列→校验" trendColor="#1f8a4c" />
      </div>

      {/* ====== 电能质量指标 ====== */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        <MetricCard label="平均最低电压" value={avgVmin.toFixed(3)} unit="pu"
          color={avgVmin >= 0.97 ? '#1f8a4c' : '#f2c94c'}
          trend={avgVmin >= 0.97 ? '合格 (≥0.97pu)' : '偏低'}
          trendColor={avgVmin >= 0.97 ? '#1f8a4c' : '#f2c94c'} />
        <MetricCard label="最差电压" value={worstVmin.toFixed(3)} unit="pu"
          color={worstVmin >= 0.95 ? '#1f8a4c' : '#eb5757'}
          trend={worstVmin >= 0.95 ? '≥0.95pu 正常' : '⚠ 越限 <0.95pu'}
          trendColor={worstVmin >= 0.95 ? '#1f8a4c' : '#eb5757'} />
        <MetricCard label="平均负载率" value={avgLmax.toFixed(1)} unit="%"
          color={avgLmax <= 80 ? '#1f8a4c' : '#f2c94c'}
          trend={avgLmax <= 80 ? '正常 (≤80%)' : '偏高'}
          trendColor={avgLmax <= 80 ? '#1f8a4c' : '#f2c94c'} />
        <MetricCard label="安全通过率" value={Math.round(passCount / total * 100)} unit="%"
          color={passCount / total >= 0.8 ? '#1f8a4c' : '#f2c94c'}
          trend={`${passCount}/${total} 通过`} trendColor="#1f8a4c" />
      </div>

      {/* ====== IEEE33 故障场景测试矩阵 ====== */}
      <SectionCard title="IEEE33 故障场景测试矩阵" style={{ marginBottom: 14 }}>
        <div style={{ overflowX: 'auto' }}>
          <DataTable columns={tcColumns} data={testCases} rowKey={r => r.id} />
        </div>
      </SectionCard>

      {/* ====== 安全校验分布 + 流程覆盖 并排 ====== */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 14 }}>
        {/* 安全校验分布 */}
        <div style={{ flex: '1 1 260px' }}>
          <SectionCard title="安全校验分布">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <ProgressBar label="通过" count={passCount} total={total} color="#1f8a4c" bg="#e8f5e9" />
              <ProgressBar label="警告" count={warnCount} total={total} color="#b8860b" bg="#fff8e1" />
              <ProgressBar label="阻断" count={blockCount} total={total} color="#eb5757" bg="#ffebee" />
            </div>
            <div style={{ marginTop: 12, fontSize: 10, color: '#667085', lineHeight: 1.7 }}>
              <div><strong>通过：</strong>拓扑辐射状 + 潮流收敛 + Vmin ≥ 0.95 pu + Lmax ≤ 100%</div>
              <div><strong>警告：</strong>拓扑通过但电压偏低 (0.95-0.97pu) 或负载偏高 (80-100%)</div>
              <div><strong>阻断：</strong>成环/潮流不收敛/严重电压越限 (Vmin &lt; 0.95pu)</div>
            </div>
          </SectionCard>
        </div>

        {/* 流程覆盖 */}
        <div style={{ flex: '1 1 380px' }}>
          <SectionCard title="流程覆盖">
            <DataTable columns={fcColumns} data={flowCoverage} rowKey={r => r.step} />
          </SectionCard>
        </div>
      </div>
    </PageContainer>
  );
}
