import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import PageContainer from '../layouts/PageContainer';
import SectionCard from '../components/SectionCard';
import WorkflowProgress from '../components/WorkflowProgress';
import { saveWorkflowState, getWorkflowState } from '../store/workflowStore';
import type { BoundaryResult } from '../types';

export default function BoundaryJudgment() {
  const [searchParams] = useSearchParams();
  const [result, setResult] = useState<BoundaryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [scenarioInput, setScenarioInput] = useState('馈线故障');
  const [faultDevice, setFaultDevice] = useState('');
  const [faultSection, setFaultSection] = useState('');
  const [faultFeeder, setFaultFeeder] = useState('');

  useEffect(() => {
    const device = searchParams.get('faultDevice');
    const section = searchParams.get('faultSection');
    const feeder = searchParams.get('faultFeeder');
    if (device) {
      setFaultDevice(device);
      setFaultSection(section || '');
      setFaultFeeder(feeder || '10kV城中馈线');
    } else {
      const state = getWorkflowState();
      if (state.faultInput?.faultDevice) {
        setFaultDevice(state.faultInput.faultDevice);
        setFaultSection(state.faultInput.faultSection || '');
        setFaultFeeder(state.faultInput.faultFeeder || '10kV城中馈线');
      }
      if (state.boundaryResult) setResult(state.boundaryResult);
    }
  }, [searchParams]);

  const handleJudge = async () => {
    setLoading(true); setError('');
    try {
      const res = await fetch('http://localhost:8000/api/boundary/judge', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scenario: scenarioInput, faultDevice: faultDevice || undefined, faultSection: faultSection || undefined, faultFeeder: faultFeeder || undefined }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      if (json.data) {
        setResult(json.data);
        saveWorkflowState({ scenarioId: json.data.scenarioId, faultInput: { faultDevice, faultSection, faultFeeder, scenarioType: scenarioInput }, boundaryResult: json.data });
      }
    } catch (e: any) { setError(e.message || '请求失败，请确认后端服务已启动'); }
    finally { setLoading(false); }
  };

  return (
    <PageContainer title="边界判定">
      <WorkflowProgress currentStep="boundary" />

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {/* 左侧：输入表单 */}
        <div style={{ flex: '0 0 360px' }}>
          <SectionCard title="故障输入">
            <p style={{ fontSize: 12, color: '#667085', marginBottom: 14 }}>
              输入或从拓扑图选择故障点，系统将根据拓扑连接关系、开关状态和保护动作信息生成隔离边界。
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <FormField label="故障场景">
                <select value={scenarioInput} onChange={(e) => setScenarioInput(e.target.value)}
                  style={inputStyle}>
                  <option value="馈线故障">馈线故障</option>
                  <option value="主变故障">主变故障</option>
                  <option value="母线故障">母线故障</option>
                </select>
              </FormField>
              {faultDevice && (
                <>
                  <FormField label="故障设备"><input value={faultDevice} readOnly style={{ ...inputStyle, background: '#f3f6f9' }} /></FormField>
                  <FormField label="故障区段"><input value={faultSection} readOnly style={{ ...inputStyle, background: '#f3f6f9' }} /></FormField>
                  <FormField label="故障馈线"><input value={faultFeeder} readOnly style={{ ...inputStyle, background: '#f3f6f9' }} /></FormField>
                </>
              )}
              <button onClick={handleJudge} disabled={loading}
                className="btn-primary" style={{ width: '100%' }}>
                {loading ? '判定中...' : '开始边界判定'}
              </button>
              {error && <div style={{ color: '#eb5757', fontSize: 12 }}>❌ {error}</div>}
            </div>
          </SectionCard>
        </div>

        {/* 右侧：判定结果 */}
        <div style={{ flex: 1, minWidth: 400 }}>
          {result ? (
            <SectionCard title="判定结果">
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 20px' }}>
                <ResultItem label="故障区段" value={result.faultSection} color="#eb5757" />
                <ResultItem label="跳闸断路器" value={result.tripBreaker} color="#2f80ed" />
                <ResultItem label="隔离开关" value={result.isolationSwitches.join('、')} />
                <ResultItem label="后备设备" value={result.backupTripDevices.join('、')} />
                <ResultItem label="失电负荷" value={`${result.lostLoad} MW`} color="#eb5757" />
                <ResultItem label="反送电风险" value={result.reversePowerRisk ? '⚠ 存在' : '无'} color={result.reversePowerRisk ? '#eb5757' : '#1f8a4c'} />
                <ResultItem label="边界结论" value="建议隔离后转供" color="#1f8a4c" />
                <ResultItem label="场景编号" value={result.scenarioId} />
              </div>
              <div style={{ marginTop: 16, borderTop: '1px solid #e2e8f0', paddingTop: 12 }}>
                <div style={{ fontSize: 12, color: '#667085', marginBottom: 8 }}>校验项：</div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {result.checkItems.map((item: string, i: number) => (
                    <span key={i} style={{ padding: '4px 10px', borderRadius: 4, fontSize: 12, background: '#e8f5e9', color: '#1f8a4c', border: '1px solid #a5d6a7' }}>
                      ✅ {item}
                    </span>
                  ))}
                </div>
              </div>
            </SectionCard>
          ) : (
            <SectionCard title="判定结果">
              <div style={{ textAlign: 'center', padding: 60, color: '#94a3b8', fontSize: 13 }}>
                在左侧输入故障信息后点击「开始边界判定」，结果将在此显示
              </div>
            </SectionCard>
          )}
        </div>
      </div>
    </PageContainer>
  );
}

function FormField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: 12, color: '#667085', marginBottom: 4 }}>{label}</label>
      {children}
    </div>
  );
}

function ResultItem({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ padding: '8px 0', borderBottom: '1px solid #f3f6f9', fontSize: 13 }}>
      <div style={{ color: '#667085', fontSize: 11, marginBottom: 2 }}>{label}</div>
      <div style={{ color: color || '#1f2937', fontWeight: color ? 600 : 400 }}>{value}</div>
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '8px 10px', border: '1px solid #c8d6e5', borderRadius: 6,
  fontSize: 13, background: '#fff', color: '#1f2937',
};
