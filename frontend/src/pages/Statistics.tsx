import { useEffect, useState } from 'react';
import PageContainer from '../layouts/PageContainer';
import MetricCard from '../components/MetricCard';
import DataTable from '../components/DataTable';
import StatusBadge from '../components/StatusBadge';
import SectionCard from '../components/SectionCard';
import type { TestStatistics, TicketInfo } from '../types';

interface TestCaseItem {
  caseId: string;
  scenarioName: string;
  faultSection: string;
  expectedResult: string;
  actualResult: string;
  safetyConclusion: string;
  oneTimePass: boolean;
  remark: string;
}

const defaultTestCases: TestCaseItem[] = [
  { caseId: 'TC-001', scenarioName: '馈线故障隔离', faultSection: '城中馈线#12-#18', expectedResult: '正确隔离', actualResult: '通过', safetyConclusion: '通过', oneTimePass: true, remark: '' },
  { caseId: 'TC-002', scenarioName: '联络开关转供', faultSection: '城东馈线联络', expectedResult: '路径推荐正确', actualResult: '通过', safetyConclusion: '警告', oneTimePass: true, remark: '容量接近预警' },
  { caseId: 'TC-003', scenarioName: 'N-1约束校验', faultSection: '城北馈线重载', expectedResult: '正确阻断', actualResult: '阻断', safetyConclusion: '阻断', oneTimePass: false, remark: '无可行路径' },
  { caseId: 'TC-004', scenarioName: '五防规则校验', faultSection: '城中馈线', expectedResult: '正确阻断', actualResult: '阻断', safetyConclusion: '阻断', oneTimePass: false, remark: '相序校验未通过' },
];

export default function Statistics() {
  const [stats, setStats] = useState<TestStatistics | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('http://localhost:8000/api/test/statistics')
      .then((r) => r.json())
      .then((res) => { if (res.data) setStats(res.data); })
      .catch(() => setError('加载失败，请确认后端服务已启动'));
  }, []);

  const handleExportReport = async () => {
    try {
      const res = await fetch('http://localhost:8000/api/test/statistics');
      const json = await res.json();
      const blob = new Blob([JSON.stringify(json.data, null, 2)], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `测试报告_${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a); window.URL.revokeObjectURL(url);
    } catch { alert('导出失败'); }
  };

  const passCount = stats?.checkResults?.filter((c) => c.result === '通过').length || 0;
  const warnCount = stats?.checkResults?.filter((c) => c.result === '警告').length || 0;
  const blockCount = stats?.checkResults?.filter((c) => c.result === '阻断').length || 0;
  const total = passCount + warnCount + blockCount || 1;

  const ticketColumns = [
    { key: 'ticketId', title: '票号', dataIndex: 'ticketId' as const },
    { key: 'createTime', title: '创建时间', dataIndex: 'createTime' as const },
    { key: 'reviewer', title: '审核人', dataIndex: 'reviewer' as const },
    { key: 'status', title: '状态', dataIndex: 'status' as const, render: (r: TicketInfo) => <StatusBadge status={r.status} /> },
    { key: 'version', title: '版本', dataIndex: 'version' as const },
  ];

  const testCaseColumns = [
    { key: 'caseId', title: '用例编号', dataIndex: 'caseId' as const },
    { key: 'scenarioName', title: '场景名称', dataIndex: 'scenarioName' as const },
    { key: 'faultSection', title: '故障区段', dataIndex: 'faultSection' as const },
    { key: 'expectedResult', title: '期望结果', dataIndex: 'expectedResult' as const },
    { key: 'actualResult', title: '实际结果', dataIndex: 'actualResult' as const },
    { key: 'safetyConclusion', title: '安全校验', dataIndex: 'safetyConclusion' as const, render: (r: TestCaseItem) => <StatusBadge status={r.safetyConclusion} /> },
    { key: 'oneTimePass', title: '一次通过', dataIndex: 'oneTimePass' as const, render: (r: TestCaseItem) => <StatusBadge status={r.oneTimePass ? '通过' : '阻断'} /> },
    { key: 'remark', title: '备注', dataIndex: 'remark' as const },
  ];

  return (
    <PageContainer title="测试统计">
      {/* 6 指标卡片 */}
      <div style={{ display: 'flex', gap: 14, marginBottom: 20, flexWrap: 'wrap' }}>
        <MetricCard label="测试用例数" value={4} unit="个" color="#2f80ed" />
        <MetricCard label="自动通过数" value={passCount} unit="项" color="#1f8a4c" />
        <MetricCard label="警告数" value={warnCount} unit="项" color="#f2c94c" />
        <MetricCard label="阻断数" value={blockCount} unit="项" color="#eb5757" />
        <MetricCard label="一次通过率" value={stats?.oneTimePassRate ?? 82.1} unit="%" color="#1f8a4c" trend="目标≥90%" trendColor="#2f80ed" />
        <MetricCard label="人工修改比例" value={stats?.manualModifyRate ?? 10.7} unit="%" color="#f2c94c" />
      </div>

      {/* CSS 进度条：校验结果分布 */}
      <SectionCard title="校验结果分布" style={{ marginBottom: 20 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <ProgressBar label="通过" count={passCount} total={total} color="#1f8a4c" bg="#e8f5e9" />
          <ProgressBar label="警告" count={warnCount} total={total} color="#b8860b" bg="#fff8e1" />
          <ProgressBar label="阻断" count={blockCount} total={total} color="#eb5757" bg="#ffebee" />
        </div>
      </SectionCard>

      {/* 一次通过率说明 */}
      <div style={{ background: '#e3f0ff', border: '1px solid #90caf9', borderRadius: 6, padding: '12px 16px', marginBottom: 20, fontSize: 12, color: '#1f2937' }}>
        <strong style={{ color: '#2f80ed' }}>一次通过率口径：</strong>
        系统生成的操作票经自动安全校核无阻断项，且人工审核不需要修改设备对象、操作动作和步骤顺序。
      </div>

      {/* 操作票列表 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, color: '#1f2937' }}>操作票列表</h3>
        <button onClick={handleExportReport} className="btn-secondary" style={{ fontSize: 12 }}>
          导出测试报告
        </button>
      </div>
      <div style={{ marginBottom: 24 }}>
        {stats?.tickets && stats.tickets.length > 0 ? (
          <DataTable columns={ticketColumns} data={stats.tickets} rowKey={(r) => r.ticketId} />
        ) : (
          <div style={{ textAlign: 'center', padding: 24, color: '#94a3b8', fontSize: 12 }}>暂无数据</div>
        )}
      </div>

      {/* 测试用例表 */}
      <SectionCard title="测试用例">
        <DataTable columns={testCaseColumns} data={defaultTestCases} rowKey={(r) => r.caseId} />
      </SectionCard>

      {error && <div style={{ color: '#eb5757', fontSize: 12, textAlign: 'center', marginTop: 12 }}>❌ {error}</div>}
    </PageContainer>
  );
}

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
