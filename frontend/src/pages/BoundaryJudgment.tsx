import { useState, useEffect, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import PageContainer from '../layouts/PageContainer';
import SectionCard from '../components/SectionCard';
import StatusBadge from '../components/StatusBadge';
import WorkflowProgress from '../components/WorkflowProgress';
import { saveCurrentWorkflow, getCurrentWorkflow } from '../store/workflowStore';

// ========== 工具 ==========
function normLineKey(ln: string): string {
  const s = String(ln).replace(/^Bus\s*/i, '').replace(/\s*区段\s*$/, '').trim();
  const p = s.split('-');
  if (p.length === 2) { const a = parseInt(p[0]), b = parseInt(p[1]); if (!isNaN(a) && !isNaN(b)) return a < b ? `${a}-${b}` : `${b}-${a}`; }
  return s;
}
function safeText(v: unknown, fallback = '-'): string { return (v === undefined || v === null || v === '') ? fallback : String(v); }

// ========== 类型 ==========
interface RiskNode {
  node: number; voltage_pu: number; load_kw: number;
  risk_level: 'high' | 'medium' | 'low'; risk_type: string; reason: string;
  related_lines: string[]; recommended_line: string | null;
}
interface RiskSummary { high_count: number; medium_count: number; low_count: number; total_count: number; }
interface SnapshotMeta { timestamp: string; time_index: number; trusted_source: boolean; node_count: number; }
interface BoundaryInfo {
  algorithm_source?: string; fault_line?: string;
  energized_boundary_nodes?: (number | string)[];
  outage_boundary_nodes?: (number | string)[];
  boundary_nodes?: any[]; crossing_ties?: any[];
  diagnostics?: any;
}
interface BoundaryResponse {
  success: boolean; action?: string; source?: string;
  snapshot_meta?: SnapshotMeta; risk_summary?: RiskSummary;
  risk_nodes?: RiskNode[]; selected_scenario?: any;
  boundary_result?: BoundaryInfo | null;
  can_enter_transfer?: boolean;
  warnings?: string[]; message?: string;
}

// ========== 组件 ==========
const LEVEL_COLORS: Record<string, { bg: string; color: string; border: string; label: string }> = {
  high: { bg: '#ffebee', color: '#eb5757', border: '#ffcdd2', label: '高风险' },
  medium: { bg: '#fff8e1', color: '#b8860b', border: '#ffe082', label: '关注' },
  low: { bg: '#e8f5e9', color: '#1f8a4c', border: '#a5d6a7', label: '正常' },
};

export default function BoundaryJudgment() {
  const [searchParams] = useSearchParams();
  const savedFault = getCurrentWorkflow()?.fault_line || '';
  const [faultLine, setFaultLine] = useState(normLineKey(savedFault || searchParams.get('fault_line') || '8-9'));

  // scan 结果
  const [scanResult, setScanResult] = useState<BoundaryResponse | null>(null);
  const [scanLoading, setScanLoading] = useState(false);
  // evaluate 结果
  const [evalResult, setEvalResult] = useState<BoundaryInfo | null>(null);
  const [evalLoading, setEvalLoading] = useState(false);
  const [error, setError] = useState('');
  // 选择状态
  const [selectedRiskNode, setSelectedRiskNode] = useState<number | null>(null);
  const [selectedLine, setSelectedLine] = useState<string | null>(null);
  const [directMode, setDirectMode] = useState(false);  // 直接输入模式

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const riskNodes: RiskNode[] = scanResult?.risk_nodes || [];
  const riskSummary: RiskSummary = scanResult?.risk_summary || { high_count: 0, medium_count: 0, low_count: 0, total_count: 0 };
  const snapshotMeta = scanResult?.snapshot_meta;
  const canEnterTransfer = scanResult?.can_enter_transfer || false;
  const boundaryResult = evalResult || scanResult?.boundary_result;

  // ========== action=scan：风险筛查 ==========
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
      setScanResult(json);
      setError('');
    } catch (e: any) { setError(e.message || '请求失败'); }
    finally { setScanLoading(false); }
  }, []);

  // ========== action=evaluate：边界判定 ==========
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
      // 更新 scanResult 中的 boundary_result 和 can_enter_transfer
      setScanResult(prev => prev ? { ...prev, boundary_result: json.boundary_result, can_enter_transfer: json.can_enter_transfer, selected_scenario: json.selected_scenario } : json);
      setEvalResult(json.boundary_result || null);
      if (json.boundary_result?.fault_line) {
        setFaultLine(json.boundary_result.fault_line);
        localStorage.setItem('current_fault_line', json.boundary_result.fault_line);
      }
      // 写 currentWorkflow
      saveCurrentWorkflow({
        fault_line: json.boundary_result?.fault_line || line,
        boundary_result: json,
        transfer_result: undefined, transfer_status: undefined, job_id: undefined,
        selected_plan: undefined, selected_plan_id: undefined, selected_tie_ids: undefined, selected_tie_lines: undefined,
        operation_sequence: undefined, sequence_result: undefined, ticket: undefined, safety_result: undefined,
      });
      setError('');
    } catch (e: any) { setError(e.message || '请求失败'); }
    finally { setEvalLoading(false); }
  }, []);

  // ========== 直接输入模式评估 ==========
  const handleDirectEvaluate = async () => {
    const fl = normLineKey(faultLine);
    setEvalLoading(true); setEvalResult(null);
    try {
      const res = await fetch('http://localhost:8000/api/boundary/analyze-realtime', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'evaluate', fault_line: fl }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: BoundaryResponse = await res.json();
      if (!json.success) { setError(json.message || '边界判定失败'); return; }
      setScanResult(json);
      setEvalResult(json.boundary_result || null);
      saveCurrentWorkflow({
        fault_line: fl, boundary_result: json,
        transfer_result: undefined, transfer_status: undefined, job_id: undefined,
        selected_plan: undefined, selected_plan_id: undefined, selected_tie_ids: undefined, selected_tie_lines: undefined,
        operation_sequence: undefined, sequence_result: undefined, ticket: undefined, safety_result: undefined,
      });
      setError('');
    } catch (e: any) { setError(e.message || '请求失败'); }
    finally { setEvalLoading(false); }
  };

  // ========== 生命周期：挂载后自动扫描 + 每5秒刷新 ==========
  useEffect(() => {
    doScan();
    timerRef.current = setInterval(() => {
      if (!evalLoading) doScan();
    }, 5000);
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, []);

  // 选择风险节点时停止自动刷新
  useEffect(() => {
    if (evalLoading || selectedRiskNode != null || selectedLine != null) {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    } else if (!timerRef.current) {
      timerRef.current = setInterval(() => { if (!evalLoading) doScan(); }, 5000);
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [evalLoading, selectedRiskNode, selectedLine]);

  // ========== 筛选要显示的风险节点 ==========
  const visibleRiskNodes = riskNodes.filter(r => r.risk_level !== 'low');
  const selectedNodeData = riskNodes.find(r => r.node === selectedRiskNode);

  return (
    <PageContainer title="边界判定">
      <WorkflowProgress currentStep="boundary" />

      {/* ====== A. 实时风险概况 ====== */}
      {snapshotMeta && (
        <SectionCard title="实时风险概况" extra={
          <button onClick={doScan} disabled={scanLoading} style={{ padding: '3px 12px', borderRadius: 4, fontSize: 11, cursor: 'pointer', background: '#fff', color: '#667085', border: '1px solid #c8d6e5' }}>
            {scanLoading ? '刷新中...' : '刷新风险'}
          </button>
        } style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ flex: 1, minWidth: 120, textAlign: 'center', background: '#ffebee', borderRadius: 6, padding: '10px', border: '1px solid #ffcdd2' }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#eb5757' }}>{riskSummary.high_count}</div>
              <div style={{ fontSize: 11, color: '#eb5757' }}>高风险</div>
            </div>
            <div style={{ flex: 1, minWidth: 120, textAlign: 'center', background: '#fff8e1', borderRadius: 6, padding: '10px', border: '1px solid #ffe082' }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#b8860b' }}>{riskSummary.medium_count}</div>
              <div style={{ fontSize: 11, color: '#b8860b' }}>关注</div>
            </div>
            <div style={{ flex: 1, minWidth: 120, textAlign: 'center', background: '#e8f5e9', borderRadius: 6, padding: '10px', border: '1px solid #a5d6a7' }}>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#1f8a4c' }}>{riskSummary.low_count}</div>
              <div style={{ fontSize: 11, color: '#1f8a4c' }}>正常</div>
            </div>
            <div style={{ flex: 1, minWidth: 180, fontSize: 11, color: '#667085', lineHeight: 1.8 }}>
              <div>数据时间：{snapshotMeta.timestamp || '--'}</div>
              <div>数据源：{snapshotMeta.trusted_source ? <span style={{ color: '#1f8a4c' }}>已验证</span> : <span style={{ color: '#b8860b' }}>未验证</span>}</div>
              <div>节点总数：{snapshotMeta.node_count}</div>
            </div>
          </div>
        </SectionCard>
      )}

      {/* ====== 警告 ====== */}
      {scanResult?.warnings && scanResult.warnings.length > 0 && (
        <div style={{ background: '#fff8e1', border: '1px solid #f2c94c', borderRadius: 6, padding: '8px 14px', marginBottom: 12, fontSize: 12, color: '#b8860b' }}>
          ⚠️ {scanResult.warnings.join('；')}
        </div>
      )}
      {error && <div style={{ background: '#ffebee', border: '1px solid #ffcdd2', borderRadius: 6, padding: '8px 14px', marginBottom: 12, fontSize: 12, color: '#eb5757' }}>❌ {error}</div>}

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        {/* ====== 左侧：风险节点 + 线路选择 ====== */}
        <div style={{ flex: '0 0 380px', minWidth: 300 }}>
          {/* B. 风险节点筛查列表 */}
          <SectionCard title={`风险节点 (${visibleRiskNodes.length})`} style={{ marginBottom: 16 }}>
            {visibleRiskNodes.length > 0 ? (
              <div style={{ maxHeight: 320, overflowY: 'auto' }}>
                {visibleRiskNodes.map(rn => {
                  const sel = selectedRiskNode === rn.node;
                  const lc = LEVEL_COLORS[rn.risk_level] || LEVEL_COLORS.low;
                  return (
                    <div key={rn.node} onClick={() => { setSelectedRiskNode(rn.node); setSelectedLine(null); if (rn.recommended_line) setSelectedLine(rn.recommended_line); }}
                      style={{
                        padding: '8px 10px', cursor: 'pointer', borderRadius: 4, marginBottom: 4,
                        background: sel ? lc.bg : '#fff', border: `1px solid ${sel ? lc.color : '#e2e8f0'}`,
                        fontSize: 12, transition: 'all 0.1s',
                      }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span><strong>Bus {rn.node}</strong> <span style={{ fontSize: 10, color: '#94a3b8' }}>{rn.risk_type}</span></span>
                        <span style={{ fontSize: 10, padding: '1px 8px', borderRadius: 3, fontWeight: 600, background: lc.bg, color: lc.color, border: `1px solid ${lc.border}` }}>{lc.label}</span>
                      </div>
                      <div style={{ fontSize: 11, color: '#667085', marginTop: 2 }}>
                        V={rn.voltage_pu.toFixed(4)} pu | 负荷={rn.load_kw.toFixed(0)} kW
                      </div>
                      <div style={{ fontSize: 10, color: rn.risk_level === 'high' ? '#eb5757' : '#b8860b', marginTop: 2 }}>{rn.reason}</div>
                      {sel && (
                        <div style={{ marginTop: 4, fontSize: 10, color: '#2f80ed' }}>
                          关联线路：{rn.related_lines.join('、')}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : scanLoading ? (
              <div style={{ textAlign: 'center', padding: 30, color: '#94a3b8', fontSize: 12 }}>加载中...</div>
            ) : (
              <div style={{ textAlign: 'center', padding: 30, color: '#1f8a4c', fontSize: 12 }}>
                ✅ 当前未发现高风险或关注节点。所有 {riskNodes.length} 个节点电压正常。
              </div>
            )}
          </SectionCard>

          {/* C. 关联线路确认 */}
          {selectedNodeData && (
            <SectionCard title="关联线路确认" style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, marginBottom: 10 }}>
                <span>选中节点：<strong style={{ color: '#1f8a4c' }}>Bus {selectedNodeData.node}</strong></span>
                <span style={{ marginLeft: 10, color: '#667085' }}>电压：{selectedNodeData.voltage_pu.toFixed(4)} pu</span>
              </div>
              <div style={{ fontSize: 11, color: '#667085', marginBottom: 8 }}>可能关联的故障线路（选择一条执行边界判定）：</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {selectedNodeData.related_lines.map(line => {
                  const sel = selectedLine === line;
                  const isRec = selectedNodeData.recommended_line === line;
                  return (
                    <div key={line} onClick={() => setSelectedLine(line)}
                      style={{
                        padding: '6px 10px', cursor: 'pointer', borderRadius: 4, fontSize: 12,
                        background: sel ? '#e8f5e9' : '#f8fafb', border: `2px solid ${sel ? '#1f8a4c' : '#c8d6e5'}`,
                      }}>
                      <span><strong>{line}</strong></span>
                      {isRec && <span style={{ marginLeft: 8, fontSize: 10, color: '#f2c94c', background: '#fff8e1', padding: '1px 6px', borderRadius: 2 }}>系统推荐</span>}
                    </div>
                  );
                })}
              </div>
              <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
                <button onClick={() => selectedLine && doEvaluate(selectedLine, selectedNodeData.node)} disabled={!selectedLine || evalLoading}
                  className="btn-primary" style={{ fontSize: 12, opacity: selectedLine ? 1 : 0.5 }}>
                  {evalLoading ? '判定中...' : '执行边界判定'}
                </button>
                <button onClick={() => { setSelectedRiskNode(null); setSelectedLine(null); }}
                  style={{ padding: '5px 12px', borderRadius: 4, fontSize: 11, cursor: 'pointer', background: '#fff', color: '#667085', border: '1px solid #c8d6e5' }}>清除选择</button>
              </div>
            </SectionCard>
          )}

          {/* 直接输入模式（保留兼容） */}
          <SectionCard title={<span onClick={() => setDirectMode(!directMode)} style={{ cursor: 'pointer', fontSize: 13 }}>直接输入故障线路 {directMode ? '▲' : '▶'}</span>}>
            {directMode && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <input value={faultLine} onChange={e => setFaultLine(e.target.value)}
                  style={{ padding: '6px 10px', border: '1px solid #c8d6e5', borderRadius: 4, fontSize: 12 }} />
                <button onClick={handleDirectEvaluate} disabled={evalLoading} className="btn-primary" style={{ fontSize: 12 }}>
                  {evalLoading ? '判定中...' : '开始边界判定'}
                </button>
              </div>
            )}
          </SectionCard>
        </div>

        {/* ====== 右侧：边界判定结果 ====== */}
        <div style={{ flex: 1, minWidth: 400 }}>
          {boundaryResult ? (
            <>
              <SectionCard title="判定结果" style={{ marginBottom: 12 }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px 20px', fontSize: 13 }}>
                  <ResultItem label="算法来源" value={boundaryResult.algorithm_source === 'external' ? '外部算法' : '本地兜底'} color={boundaryResult.algorithm_source === 'external' ? '#1f8a4c' : '#b8860b'} />
                  <ResultItem label="故障线路" value={safeText(boundaryResult.fault_line)} color="#eb5757" />
                  <ResultItem label="带电侧边界节点" value={safeText((boundaryResult.energized_boundary_nodes || []).length)} />
                  <ResultItem label="停电侧边界节点" value={safeText((boundaryResult.outage_boundary_nodes || []).length)} />
                  <ResultItem label="可转换联络线" value={safeText((boundaryResult.crossing_ties || []).length)} />
                  {canEnterTransfer && <ResultItem label="转供就绪" value="✅ 可进入转供决策" color="#1f8a4c" />}
                </div>
              </SectionCard>

              {/* 穿越联络线 */}
              {(boundaryResult.crossing_ties || []).length > 0 && (
                <SectionCard title="可转换联络线" style={{ marginBottom: 12 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead><tr style={{ background: '#f3f6f9' }}>
                      <th style={th}>联络线</th><th style={th}>编号</th><th style={th}>带电侧</th><th style={th}>停电侧</th>
                    </tr></thead>
                    <tbody>
                      {(boundaryResult.crossing_ties || []).map((ct: any, i: number) => (
                        <tr key={i} style={{ borderBottom: '1px solid #f0f0f0' }}>
                          <td style={{ ...td, fontWeight: 600 }}>{safeText(ct.line)}</td>
                          <td style={td}>{safeText(ct.tie_id)}</td>
                          <td style={{ ...td, color: '#1f8a4c' }}>Bus {safeText(ct.energized_side_bus)}</td>
                          <td style={{ ...td, color: '#eb5757' }}>Bus {safeText(ct.outage_side_bus)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </SectionCard>
              )}

              {/* 边界节点 */}
              {(boundaryResult.boundary_nodes || []).length > 0 && (
                <SectionCard title="边界节点明细" style={{ marginBottom: 12 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                    <thead><tr style={{ background: '#f3f6f9' }}>
                      <th style={th}>类型</th><th style={th}>节点</th><th style={th}>说明</th>
                    </tr></thead>
                    <tbody>
                      {(boundaryResult.energized_boundary_nodes || []).map((bus: any, i: number) => (
                        <tr key={`e-${i}`} style={{ borderBottom: '1px solid #f0f0f0' }}>
                          <td style={td}><span style={{ background: '#e8f5e9', color: '#1f8a4c', padding: '2px 8px', borderRadius: 3, fontSize: 11 }}>带电侧</span></td>
                          <td style={{ ...td, fontWeight: 600 }}>Bus {safeText(bus)}</td>
                          <td style={td}>带电区域边界节点</td>
                        </tr>
                      ))}
                      {(boundaryResult.outage_boundary_nodes || []).map((bus: any, i: number) => (
                        <tr key={`o-${i}`} style={{ borderBottom: '1px solid #f0f0f0' }}>
                          <td style={td}><span style={{ background: '#ffebee', color: '#eb5757', padding: '2px 8px', borderRadius: 3, fontSize: 11 }}>停电侧</span></td>
                          <td style={{ ...td, fontWeight: 600 }}>Bus {safeText(bus)}</td>
                          <td style={td}>停电区域边界节点</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </SectionCard>
              )}

              {/* 转供决策按钮 */}
              {canEnterTransfer && (
                <div style={{ textAlign: 'right' }}>
                  <button onClick={() => window.location.href = '/transfer-decision'}
                    style={{ padding: '8px 20px', borderRadius: 6, fontSize: 13, cursor: 'pointer', background: '#1f8a4c', color: '#fff', border: 'none', fontWeight: 600 }}>
                    进入转供决策 →
                  </button>
                </div>
              )}
              {!canEnterTransfer && boundaryResult && (
                <div style={{ background: '#f3f6f9', border: '1px solid #c8d6e5', borderRadius: 4, padding: '8px 12px', fontSize: 12, color: '#94a3b8', textAlign: 'center' }}>
                  暂无可用的穿越联络线，无法进入转供决策。请检查故障线路是否有可用的联络开关。
                </div>
              )}
            </>
          ) : scanResult && !evalResult ? (
            <SectionCard title="判定结果">
              <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8', fontSize: 13 }}>
                {selectedRiskNode
                  ? '请选择关联线路后点击「执行边界判定」'
                  : '请从左侧风险节点列表中选择一个节点，或展开「直接输入故障线路」输入线路后执行边界判定'}
              </div>
            </SectionCard>
          ) : !scanResult ? (
            <SectionCard title="判定结果">
              <div style={{ textAlign: 'center', padding: 40, color: '#94a3b8', fontSize: 13 }}>
                {scanLoading ? '正在加载实时风险数据...' : '等待风险筛查数据...'}
              </div>
            </SectionCard>
          ) : null}
        </div>
      </div>
    </PageContainer>
  );
}

function ResultItem({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ padding: '6px 0', borderBottom: '1px solid #f3f6f9', fontSize: 13 }}>
      <div style={{ color: '#667085', fontSize: 11, marginBottom: 2 }}>{label}</div>
      <div style={{ color: color || '#1f2937', fontWeight: color ? 600 : 400 }}>{value}</div>
    </div>
  );
}

const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontWeight: 600, color: '#667085', borderBottom: '2px solid #c8d6e5' };
const td: React.CSSProperties = { padding: '6px 10px', color: '#1f2937' };
