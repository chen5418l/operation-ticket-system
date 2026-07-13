import { useState } from 'react';
import PageContainer from '../layouts/PageContainer';
import SectionCard from '../components/SectionCard';
import DataTable from '../components/DataTable';
import StatusBadge from '../components/StatusBadge';

function fm(v: unknown, d?: number): string {
  const n = Number(v);
  return Number.isFinite(n) ? (d != null ? n.toFixed(d) : String(n)) : '--';
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

export default function SafetyCheck() {
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
      <div style={{ background: '#e3f0ff', border: '1px solid #90caf9', borderRadius: 6, padding: '10px 16px', marginBottom: 16, fontSize: 12, color: '#1f2937' }}>
        安全校验模块用于对故障隔离与转供方案进行约束校验。配置故障节点和开关状态后，系统调用安全校验模型。
      </div>

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
    </PageContainer>
  );
}

const sLbl: React.CSSProperties = { fontSize: 12, color: '#667085', width: 70, flexShrink: 0 };
const sInp: React.CSSProperties = { padding: '5px 10px', borderRadius: 4, border: '1px solid #c8d6e5', fontSize: 12, background: '#fff' };
const b1: React.CSSProperties = { padding: '6px 16px', borderRadius: 4, fontSize: 12, cursor: 'pointer', background: '#1f8a4c', color: '#fff', border: 'none' };
const b2: React.CSSProperties = { padding: '6px 12px', borderRadius: 4, fontSize: 11, cursor: 'pointer', background: '#fff', color: '#667085', border: '1px solid #c8d6e5' };
