import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import PageContainer from '../layouts/PageContainer';
import SectionCard from '../components/SectionCard';
import StatusBadge from '../components/StatusBadge';
import WorkflowProgress from '../components/WorkflowProgress';
import { saveCurrentWorkflow, getCurrentWorkflow } from '../store/workflowStore';

/* ==================== 工具 ==================== */
function normLineKey(ln: string): string {
  const s = String(ln).replace(/^Bus\s*/i, '').replace(/\s*区段\s*$/, '').trim();
  const p = s.split('-');
  if (p.length === 2) { const a = parseInt(p[0]), b = parseInt(p[1]); if (!isNaN(a) && !isNaN(b)) return a < b ? `${a}-${b}` : `${b}-${a}`; }
  return s;
}

/* ==================== 类型 ==================== */
interface RiskNode { node: number; voltage_pu: number; load_kw: number; risk_level: 'high' | 'medium' | 'low'; risk_type: string; reason: string; related_lines: string[]; recommended_line: string | null; }
interface RiskSummary { high_count: number; medium_count: number; low_count: number; total_count: number; }
interface SnapshotMeta { timestamp: string; time_index: number; trusted_source: boolean; node_count: number; }
interface BoundaryInfo { algorithm_source?: string; fault_line?: string; energized_boundary_nodes?: (number | string)[]; outage_boundary_nodes?: (number | string)[]; boundary_nodes?: any[]; crossing_ties?: any[]; diagnostics?: any; }
interface BoundaryResponse { success: boolean; action?: string; source?: string; snapshot_meta?: SnapshotMeta; risk_summary?: RiskSummary; risk_nodes?: RiskNode[]; selected_scenario?: any; boundary_result?: BoundaryInfo | null; can_enter_transfer?: boolean; warnings?: string[]; message?: string; }

const LEVEL_LABEL: Record<string, { bg: string; color: string; text: string }> = {
  high: { bg: '#ffebee', color: '#eb5757', text: '高风险' },
  medium: { bg: '#fff8e1', color: '#b8860b', text: '关注' },
  low: { bg: '#e8f5e9', color: '#1f8a4c', text: '正常' },
};

export default function BoundaryJudgment() {
  const [searchParams] = useSearchParams();
  const savedFault = getCurrentWorkflow()?.fault_line || '';
  const [faultLine, setFaultLine] = useState(normLineKey(savedFault || searchParams.get('fault_line') || ''));
  const [scanResult, setScanResult] = useState<BoundaryResponse | null>(null);
  const [scanLoading, setScanLoading] = useState(false);
  const [evalResult, setEvalResult] = useState<BoundaryInfo | null>(null);
  const [evalLoading, setEvalLoading] = useState(false);
  const [error, setError] = useState('');
  const [selectedRiskNode, setSelectedRiskNode] = useState<number | null>(null);
  const [selectedLine, setSelectedLine] = useState<string | null>(null);
  const [directMode, setDirectMode] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const riskNodes: RiskNode[] = scanResult?.risk_nodes || [];
  const riskSummary: RiskSummary = scanResult?.risk_summary || { high_count: 0, medium_count: 0, low_count: 0, total_count: 0 };
  const snapshotMeta = scanResult?.snapshot_meta;
  const canEnterTransfer = scanResult?.can_enter_transfer || false;
  const boundaryResult = evalResult || scanResult?.boundary_result;

  // ====== action=scan ======
  const doScan = useCallback(async () => {
    setScanLoading(true);
    try {
      const res = await fetch('http://localhost:8000/api/boundary/analyze-realtime', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'scan', risk_source: 'realtime' }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: BoundaryResponse = await res.json();
      if (!json.success) { setError(json.message || '风险筛查失败'); return; }
      setScanResult(json); setError('');
    } catch (e: any) { setError(e.message || '请求失败'); }
    finally { setScanLoading(false); }
  }, []);

  // ====== action=evaluate ======
  const doEvaluate = useCallback(async (line: string, riskNode: number | null) => {
    setEvalLoading(true); setEvalResult(null);
    try {
      const body: any = { action: 'evaluate', selected_related_line: line, risk_source: 'realtime' };
      if (riskNode != null) body.selected_risk_node = riskNode;
      const res = await fetch('http://localhost:8000/api/boundary/analyze-realtime', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: BoundaryResponse = await res.json();
      if (!json.success) { setError(json.message || '边界判定失败'); return; }
      setScanResult(prev => prev ? { ...prev, boundary_result: json.boundary_result, can_enter_transfer: json.can_enter_transfer, selected_scenario: json.selected_scenario } : json);
      setEvalResult(json.boundary_result || null);
      if (json.boundary_result?.fault_line) { setFaultLine(json.boundary_result.fault_line); }
      saveCurrentWorkflow({ fault_line: json.boundary_result?.fault_line || line, boundary_result: json, transfer_result: undefined, transfer_status: undefined, job_id: undefined, selected_plan: undefined, selected_plan_id: undefined, selected_tie_ids: undefined, selected_tie_lines: undefined, operation_sequence: undefined, sequence_result: undefined, ticket: undefined, safety_result: undefined });
      setError('');
    } catch (e: any) { setError(e.message || '请求失败'); }
    finally { setEvalLoading(false); }
  }, []);

  // ====== 直接输入评估 ======
  const handleDirectEvaluate = async () => {
    const fl = normLineKey(faultLine);
    if (!fl) { setError('请输入有效故障线路'); return; }
    setEvalLoading(true); setEvalResult(null);
    try {
      const res = await fetch('http://localhost:8000/api/boundary/analyze-realtime', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'evaluate', fault_line: fl }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: BoundaryResponse = await res.json();
      if (!json.success) { setError(json.message || '边界判定失败'); return; }
      setScanResult(json); setEvalResult(json.boundary_result || null);
      saveCurrentWorkflow({ fault_line: fl, boundary_result: json, transfer_result: undefined, transfer_status: undefined, job_id: undefined, selected_plan: undefined, selected_plan_id: undefined, selected_tie_ids: undefined, selected_tie_lines: undefined, operation_sequence: undefined, sequence_result: undefined, ticket: undefined, safety_result: undefined });
      setError('');
    } catch (e: any) { setError(e.message || '请求失败'); }
    finally { setEvalLoading(false); }
  };

  // ====== 生命周期 ======
  useEffect(() => { doScan(); timerRef.current = setInterval(() => { if (!evalLoading) doScan(); }, 5000); return () => { if (timerRef.current) clearInterval(timerRef.current); }; }, []);
  useEffect(() => {
    if (evalLoading || selectedRiskNode != null || selectedLine != null) { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } }
    else if (!timerRef.current) { timerRef.current = setInterval(() => { if (!evalLoading) doScan(); }, 5000); }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [evalLoading, selectedRiskNode, selectedLine]);

  const visibleRiskNodes = riskNodes.filter(r => r.risk_level !== 'low');
  const selectedNodeData = riskNodes.find(r => r.node === selectedRiskNode);

  return (
    <PageContainer title="边界判定">
      <WorkflowProgress currentStep="boundary" />

      {/* ====== 错误/警告 ====== */}
      {scanResult?.warnings && scanResult.warnings.length > 0 && (
        <div style={{ background: '#fff8e1', border: '1px solid #f2c94c', borderRadius: 6, padding: '6px 14px', marginBottom: 12, fontSize: 11, color: '#b8860b' }}>⚠️ {scanResult.warnings.join('；')}</div>
      )}
      {error && <div style={{ background: '#ffebee', border: '1px solid #ffcdd2', borderRadius: 6, padding: '6px 14px', marginBottom: 12, fontSize: 11, color: '#eb5757' }}>❌ {error}</div>}

      {/* ====== 风险概况卡片 ====== */}
      {snapshotMeta && (
        <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'stretch' }}>
          {[
            { n: riskSummary.high_count, label: '高风险', bg: '#ffebee', color: '#eb5757' },
            { n: riskSummary.medium_count, label: '关注', bg: '#fff8e1', color: '#b8860b' },
            { n: riskSummary.low_count, label: '正常', bg: '#e8f5e9', color: '#1f8a4c' },
          ].map(c => (
            <div key={c.label} style={{ flex: 1, minWidth: 80, textAlign: 'center', background: c.bg, borderRadius: 6, padding: '10px 16px', border: `1px solid ${c.color}33` }}>
              <div style={{ fontSize: 24, fontWeight: 700, color: c.color }}>{c.n}</div>
              <div style={{ fontSize: 10, color: c.color }}>{c.label}</div>
            </div>
          ))}
          <div style={{ flex: 2, minWidth: 180, fontSize: 11, color: '#667085', display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 2, padding: '4px 0' }}>
            <div>数据时间：{snapshotMeta.timestamp || '--'} · {snapshotMeta.node_count}节点</div>
            <div>数据源：{snapshotMeta.trusted_source ? <span style={{ color: '#1f8a4c' }}>已验证</span> : <span style={{ color: '#b8860b' }}>未验证</span>}</div>
            <button onClick={doScan} disabled={scanLoading} style={{ padding: '3px 8px', borderRadius: 3, fontSize: 10, cursor: 'pointer', background: '#fff', color: '#667085', border: '1px solid #c8d6e5', marginTop: 2, alignSelf: 'flex-start' }}>{scanLoading ? '刷新中...' : '刷新'}</button>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        {/* ====== 左侧：风险节点 + 线路选择 ====== */}
        <div style={{ flex: '0 0 350px', minWidth: 280 }}>
          <SectionCard title="风险节点列表" style={{ marginBottom: 12 }}>
            {visibleRiskNodes.length > 0 ? (
              <div style={{ maxHeight: 300, overflowY: 'auto' }}>
                {visibleRiskNodes.map(rn => {
                  const sel = selectedRiskNode === rn.node;
                  const lc = LEVEL_LABEL[rn.risk_level] || LEVEL_LABEL.low;
                  return (
                    <div key={rn.node} onClick={() => { setSelectedRiskNode(rn.node); setSelectedLine(null); if (rn.recommended_line) setSelectedLine(rn.recommended_line); }}
                      style={{ padding: '8px 10px', cursor: 'pointer', borderRadius: 4, marginBottom: 4, background: sel ? lc.bg : '#fff', border: `1px solid ${sel ? lc.color : '#e2e8f0'}`, fontSize: 11, transition: 'all 0.1s' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span><strong>Bus {rn.node}</strong> <span style={{ fontSize: 10, color: '#94a3b8' }}>{rn.risk_type}</span></span>
                        <span style={{ fontSize: 9, padding: '1px 6px', borderRadius: 2, fontWeight: 600, background: lc.bg, color: lc.color }}>{lc.text}</span>
                      </div>
                      <div style={{ fontSize: 10, color: '#667085', marginTop: 2 }}>V={rn.voltage_pu.toFixed(4)}pu | P={rn.load_kw.toFixed(0)}kW</div>
                      <div style={{ fontSize: 9, color: rn.risk_level === 'high' ? '#eb5757' : '#b8860b', marginTop: 1 }}>{rn.reason}</div>
                      {sel && <div style={{ marginTop: 3, fontSize: 9, color: '#2f80ed' }}>关联线路：{rn.related_lines.join('、')}</div>}
                    </div>
                  );
                })}
              </div>
            ) : scanLoading ? (
              <div style={{ textAlign: 'center', padding: 30, color: '#94a3b8', fontSize: 12 }}>加载中...</div>
            ) : (
              <div style={{ textAlign: 'center', padding: 30, color: '#1f8a4c', fontSize: 12 }}>✅ {riskNodes.length} 个节点均正常</div>
            )}
          </SectionCard>

          {/* 线路确认 */}
          {selectedNodeData && (
            <SectionCard title="选择故障线路" style={{ marginBottom: 12 }}>
              <div style={{ fontSize: 11, marginBottom: 8 }}>选中 <strong style={{ color: '#1f8a4c' }}>Bus {selectedNodeData.node}</strong>（V={selectedNodeData.voltage_pu.toFixed(4)}pu）</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
                {selectedNodeData.related_lines.map(line => {
                  const sel = selectedLine === line;
                  return (
                    <div key={line} onClick={() => setSelectedLine(line)}
                      style={{ padding: '5px 10px', cursor: 'pointer', borderRadius: 3, fontSize: 11, background: sel ? '#e8f5e9' : '#f8fafb', border: `2px solid ${sel ? '#1f8a4c' : '#c8d6e5'}` }}>
                      <strong>{line}</strong>
                      {selectedNodeData.recommended_line === line && <span style={{ marginLeft: 8, fontSize: 9, color: '#f2c94c', background: '#fff8e1', padding: '1px 5px', borderRadius: 2 }}>推荐</span>}
                    </div>
                  );
                })}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={() => selectedLine && doEvaluate(selectedLine, selectedNodeData.node)} disabled={!selectedLine || evalLoading}
                  style={{ padding: '5px 14px', borderRadius: 4, fontSize: 11, cursor: 'pointer', background: selectedLine ? '#1f8a4c' : '#94a3b8', color: '#fff', border: 'none', fontWeight: 600 }}>
                  {evalLoading ? '判定中...' : '执行边界判定'}
                </button>
                <button onClick={() => { setSelectedRiskNode(null); setSelectedLine(null); }}
                  style={{ padding: '5px 10px', borderRadius: 4, fontSize: 10, cursor: 'pointer', background: '#fff', color: '#667085', border: '1px solid #c8d6e5' }}>清除</button>
              </div>
            </SectionCard>
          )}

          {/* 直接输入（折叠） */}
          <div style={{ marginBottom: 12 }}>
            <div onClick={() => setDirectMode(!directMode)} style={{ cursor: 'pointer', fontSize: 11, color: '#94a3b8', padding: '6px 10px', background: '#f3f6f9', borderRadius: 4, border: '1px solid #c8d6e5' }}>
              直接输入故障线路 {directMode ? '▲' : '▶'}
            </div>
            {directMode && (
              <div style={{ marginTop: 6, display: 'flex', gap: 6, alignItems: 'center' }}>
                <input value={faultLine} onChange={e => setFaultLine(e.target.value)} placeholder="如 8-9"
                  style={{ padding: '5px 10px', border: '1px solid #c8d6e5', borderRadius: 4, fontSize: 12, width: 100 }} />
                <button onClick={handleDirectEvaluate} disabled={evalLoading} style={{ padding: '5px 12px', borderRadius: 4, fontSize: 11, cursor: 'pointer', background: '#1f8a4c', color: '#fff', border: 'none' }}>
                  {evalLoading ? '判定中...' : '判定'}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ====== 右侧：判定结果 ====== */}
        <div style={{ flex: 1, minWidth: 380 }}>
          {boundaryResult ? (
            <>
              {/* 判定摘要 */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
                {[
                  { l: '算法来源', v: boundaryResult.algorithm_source === 'external' ? '外部算法' : '本地兜底', c: boundaryResult.algorithm_source === 'external' ? '#1f8a4c' : '#b8860b' },
                  { l: '故障线路', v: boundaryResult.fault_line || '-', c: '#eb5757' },
                  { l: '带电侧边界', v: (boundaryResult.energized_boundary_nodes || []).length + ' 节点', c: '#1f8a4c' },
                  { l: '停电侧边界', v: (boundaryResult.outage_boundary_nodes || []).length + ' 节点', c: '#eb5757' },
                  { l: '可转换联络线', v: (boundaryResult.crossing_ties || []).length + ' 条', c: '#2f80ed' },
                  { l: '转供就绪', v: canEnterTransfer ? '✅ 可进入' : '❌ 不可用', c: canEnterTransfer ? '#1f8a4c' : '#eb5757' },
                ].map(item => (
                  <div key={item.l} style={{ background: '#fff', border: '1px solid #c8d6e5', borderRadius: 4, padding: '8px 12px' }}>
                    <div style={{ fontSize: 10, color: '#667085' }}>{item.l}</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: item.c }}>{item.v}</div>
                  </div>
                ))}
              </div>

              {/* 穿越联络线 */}
              {(boundaryResult.crossing_ties || []).length > 0 && (
                <SectionCard title="可转换联络线" style={{ marginBottom: 12 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                    <thead><tr style={{ background: '#f3f6f9' }}>
                      <th style={th}>联络线</th><th style={th}>编号</th><th style={th}>带电侧</th><th style={th}>停电侧</th>
                    </tr></thead>
                    <tbody>
                      {(boundaryResult.crossing_ties || []).map((ct: any, i: number) => (
                        <tr key={i} style={{ borderBottom: '1px solid #f0f0f0' }}>
                          <td style={{ ...td, fontWeight: 600 }}>{ct.line || '-'}</td>
                          <td style={td}>{ct.tie_id || '-'}</td>
                          <td style={{ ...td, color: '#1f8a4c' }}>Bus {ct.energized_side_bus || '-'}</td>
                          <td style={{ ...td, color: '#eb5757' }}>Bus {ct.outage_side_bus || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </SectionCard>
              )}

              {/* 边界节点明细 */}
              {(boundaryResult.boundary_nodes || []).length > 0 && (
                <SectionCard title="边界节点明细" style={{ marginBottom: 12 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                    <thead><tr style={{ background: '#f3f6f9' }}>
                      <th style={th}>类型</th><th style={th}>节点</th><th style={th}>说明</th>
                    </tr></thead>
                    <tbody>
                      {(boundaryResult.energized_boundary_nodes || []).map((bus: any, i: number) => (
                        <tr key={`e-${i}`} style={{ borderBottom: '1px solid #f0f0f0' }}>
                          <td style={td}><span style={{ background: '#e8f5e9', color: '#1f8a4c', padding: '1px 6px', borderRadius: 2, fontSize: 10 }}>带电</span></td>
                          <td style={{ ...td, fontWeight: 600 }}>Bus {bus}</td>
                          <td style={{ ...td, color: '#667085' }}>带电区域边界节点</td>
                        </tr>
                      ))}
                      {(boundaryResult.outage_boundary_nodes || []).map((bus: any, i: number) => (
                        <tr key={`o-${i}`} style={{ borderBottom: '1px solid #f0f0f0' }}>
                          <td style={td}><span style={{ background: '#ffebee', color: '#eb5757', padding: '1px 6px', borderRadius: 2, fontSize: 10 }}>停电</span></td>
                          <td style={{ ...td, fontWeight: 600 }}>Bus {bus}</td>
                          <td style={{ ...td, color: '#667085' }}>停电区域边界节点</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </SectionCard>
              )}

              {/* 转供跳转 */}
              {canEnterTransfer && (
                <div style={{ textAlign: 'right' }}>
                  <button onClick={() => window.location.href = '/transfer-decision'}
                    style={{ padding: '8px 20px', borderRadius: 6, fontSize: 13, cursor: 'pointer', background: '#1f8a4c', color: '#fff', border: 'none', fontWeight: 600 }}>
                    进入转供决策 →
                  </button>
                </div>
              )}
              {!canEnterTransfer && (
                <div style={{ background: '#f3f6f9', border: '1px solid #c8d6e5', borderRadius: 4, padding: '8px 12px', fontSize: 12, color: '#94a3b8', textAlign: 'center' }}>
                  暂无可用的穿越联络线，无法进入转供决策
                </div>
              )}
            </>
          ) : (
            <SectionCard title="判定结果">
              <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8', fontSize: 12 }}>
                {scanResult && !evalResult
                  ? (selectedRiskNode ? '请选择关联线路后点击「执行边界判定」' : '请从左侧选择风险节点，或使用直接输入')
                  : (scanLoading ? '正在获取实时数据...' : '等待风险筛查...')}
              </div>
            </SectionCard>
          )}
        </div>
      </div>
    </PageContainer>
  );
}

const th: React.CSSProperties = { textAlign: 'left', padding: '6px 8px', fontWeight: 600, color: '#667085', fontSize: 10, borderBottom: '2px solid #c8d6e5' };
const td: React.CSSProperties = { padding: '5px 8px', color: '#1f2937', fontSize: 11 };
