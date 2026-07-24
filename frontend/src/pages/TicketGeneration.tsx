import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import PageContainer from '../layouts/PageContainer';
import StatusBadge from '../components/StatusBadge';
import SectionCard from '../components/SectionCard';
import WorkflowProgress from '../components/WorkflowProgress';
import { getCurrentWorkflow, saveCurrentWorkflow } from '../store/workflowStore';

// ---- 实时工作流票据结构 ----
interface ApiOperationStep { step: number; action: string; operation_type: string; line?: string; }
interface RealtimeTicket {
  ticket_id: string;
  fault_line: string;
  plan_id: string;
  tie_lines: string[];
  tie_ids?: string[];
  operation_steps: ApiOperationStep[];
  created_at: string;
  source: 'realtime_workflow';
  task_name: string;
  tie_name?: string;
  transfer_status?: string;
  warnings?: string[];
}

/** 历史票据格式（后端 DB） */
interface AnyTicket { ticketNo?: string; ticketId?: string; taskName?: string; title?: string; status?: string; operator?: string; guardian?: string; checkResult?: string; createdAt?: string; steps?: any[]; safetyNotes?: string[]; info?: any; }

function safetyNote(t: string): string {
  switch (t) {
    case 'verify_open': return '确认开关确已断开并有明显断开点，做好防误合措施';
    case 'close': return '合闸前核对开关编号与调度指令一致，确认允许合闸';
    case 'open': return '拉闸后确认开关位置指示正确';
    case 'check': return '核查恢复区电压不低于0.95pu、线路负载不超限';
    default: return '';
  }
}

export default function TicketGeneration() {
  const location = useLocation();

  // ====== 仅从 currentWorkflow 读取 ======
  const wf = getCurrentWorkflow();
  const seqResult = wf?.sequence_result || null;
  const selectedPlan = wf?.selected_plan || null;
  const faultLine = wf?.fault_line || '';
  const planId = wf?.selected_plan_id || '';
  const transferStatus = wf?.transfer_status || '';
  const opStepsRaw = wf?.operation_sequence;
  // 兼容旧 operation_sequence 结构：可能是 OperationStep[] 或 ApiOperationStep[]
  const opSteps: ApiOperationStep[] = Array.isArray(opStepsRaw) ? opStepsRaw.map((s: any) => ({
    step: s.stepNo ?? s.step ?? 0,
    action: s.deviceName ?? s.action ?? '',
    operation_type: s.action === '确认断开' ? 'verify_open' : s.action === '合闸' ? 'close' : s.action === '拉开' ? 'open' : 'check',
    line: s.deviceId ?? s.line ?? '',
  })) : [];
  const hasSteps = opSteps.length > 0;

  // 从 currentWorkflow.ticket 恢复（永不从旧 localStorage 直接读）
  const savedTicket = wf?.ticket || null;
  const [rtTicket, setRtTicket] = useState<RealtimeTicket | null>(savedTicket as RealtimeTicket | null);
  const [histTicket, setHistTicket] = useState<AnyTicket | null>(null);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [tickets, setTickets] = useState<AnyTicket[]>([]);

  useEffect(() => {
    const hash = location.hash;
    if (hash?.startsWith('#step-')) {
      const stepNo = parseInt(hash.replace('#step-', ''));
      if (!isNaN(stepNo)) setTimeout(() => {
        document.getElementById(`ticket-step-${stepNo}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 300);
    }
  }, [location.hash, rtTicket, histTicket]);

  useEffect(() => { fetchTickets(); }, []);

  const fetchTickets = async () => {
    try {
      const res = await fetch('http://localhost:8000/api/tickets');
      const json = await res.json();
      if (json.data?.length) setTickets(json.data);
    } catch {}
  };

  /** 基于 currentWorkflow 数据生成操作票（不使用旧 localStorage 数据） */
  const handleGenerate = () => {
    setError('');
    if (!hasSteps) { setError('请先生成操作序列。'); return; }
    const now = new Date();
    const ts = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const tieLines: string[] = seqResult?.tie_lines || selectedPlan?.tie_lines || [];
    const tieName = selectedPlan?.tie_name || tieLines.join('+') || '-';
    const ticket: RealtimeTicket = {
      ticket_id: `OT${ts}`,
      fault_line: faultLine || '-',
      plan_id: planId || seqResult?.plan_id || '-',
      tie_lines: tieLines,
      tie_ids: wf?.selected_tie_ids || [],
      operation_steps: opSteps,
      created_at: now.toLocaleString('zh-CN'),
      source: 'realtime_workflow',
      task_name: `故障线路 ${faultLine || '-'} 隔离及经联络开关 ${tieName} 转供恢复操作`,
      tie_name: tieName,
      transfer_status: transferStatus,
      warnings: seqResult?.warnings || [],
    };
    // 写入 currentWorkflow.ticket
    saveCurrentWorkflow({ ticket });
    setRtTicket(ticket);
    setHistTicket(null);
    // 同步旧 key（兼容未迁移页面）
    localStorage.setItem('current_ticket', JSON.stringify(ticket));
  };

  /** Excel 导出 */
  const handleExport = async () => {
    if (!histTicket) return;
    setExporting(true);
    const id = histTicket.ticketNo || histTicket.info?.ticketId || histTicket.ticketId || '';
    try {
      const res = await fetch(`http://localhost:8000/api/ticket/${encodeURIComponent(id)}/export`);
      if (!res.ok) { alert(`导出失败 (HTTP ${res.status})`); return; }
      const blob = await res.blob();
      if (blob.type.includes('json')) { const text = await blob.text(); alert('导出失败: ' + text); return; }
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      const ts = new Date().toISOString().replace(/[-:T]/g,'').slice(0,14);
      a.href = url; a.download = `操作票_${id}_${ts}.xlsx`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a); window.URL.revokeObjectURL(url);
    } catch { alert('导出失败，请确认后端服务已启动'); }
    finally { setExporting(false); }
  };

  const showingHist = histTicket != null;
  const hSteps = histTicket?.steps || histTicket?.info?.steps || [];
  const hNotes = histTicket?.safetyNotes || [];
  const isExternalPending = transferStatus === 'external_pending';

  return (
    <PageContainer title="模板化成票">
      <WorkflowProgress currentStep="ticket" />

      {!hasSteps && (
        <div style={{ background: '#fff8e1', border: '1px solid #ffe082', borderRadius: 6, padding: '12px 16px', marginBottom: 16, fontSize: 13 }}>
          ⚠️ 请先生成操作序列。
        </div>
      )}

      {hasSteps && (
        <div style={{ background: '#e8f5e9', border: '1px solid #a5d6a7', borderRadius: 6, padding: '10px 16px', marginBottom: 16, fontSize: 13, color: '#1f2937', display: 'flex', gap: 16, flexWrap: 'wrap' }}>
          <span>操作序列：<strong style={{ color: '#1f8a4c' }}>{opSteps.length} 步</strong></span>
          <span>方案编号：<strong style={{ color: '#1f8a4c' }}>{planId || '-'}</strong></span>
          {faultLine && <span>故障线路：<strong style={{ color: '#eb5757' }}>{faultLine}</strong></span>}
          {selectedPlan?.tie_name && <span>联络开关：<strong style={{ color: '#1f8a4c' }}>{selectedPlan.tie_name} ({selectedPlan.tie_switch})</strong></span>}
          {selectedPlan?.tie_lines && <span>联络线：<strong>{(Array.isArray(selectedPlan.tie_lines) ? selectedPlan.tie_lines : []).join('、') || '-'}</strong></span>}
          {seqResult?.plan_id && <span>序列编号：<strong>{seqResult.plan_id}</strong></span>}
        </div>
      )}

      {/* external_pending 警告 */}
      {isExternalPending && hasSteps && (
        <div style={{ background: '#fff8e1', border: '1px solid #f2c94c', borderRadius: 6, padding: '10px 14px', marginBottom: 16, fontSize: 12, color: '#b8860b' }}>
          ⚠️ <strong>待外部潮流评分确认</strong>：当前 transfer_status=external_pending，只能生成<strong>预案草稿/规则版预校验</strong>，不能生成正式操作票。待外部评分完成后请返回转供决策页面刷新结果。
        </div>
      )}

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 500 }}>
          {showingHist ? (
            /* ---- 历史票预览（后端 DB） ---- */
            <SectionCard title="操作票预览（历史票）">
              <div style={{ border: '2px solid #c8d6e5', borderRadius: 6, padding: 16, marginBottom: 16, background: '#fafffe' }}>
                <div style={{ textAlign: 'center', marginBottom: 12 }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#1f2937' }}>操作票</div>
                  <div style={{ fontSize: 12, color: '#667085', marginTop: 4 }}>国网江苏市级配电网智能成票与安全校验系统</div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 20px', fontSize: 13 }}>
                  <div><span style={{ color: '#667085' }}>票号：</span><strong>{histTicket!.ticketNo || histTicket!.ticketId || '-'}</strong></div>
                  <div><span style={{ color: '#667085' }}>状态：</span><StatusBadge status={histTicket!.status || '草稿'} /></div>
                  <div style={{ gridColumn: '1 / -1' }}><span style={{ color: '#667085' }}>操作任务：</span>{histTicket!.taskName || histTicket!.title || '-'}</div>
                  <div><span style={{ color: '#667085' }}>校验结论：</span><StatusBadge status={histTicket!.checkResult || '通过'} /></div>
                </div>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead><tr style={{ background: '#f3f6f9' }}>
                  <th style={th}>序号</th><th style={th}>操作内容</th><th style={th}>安全提示</th>
                </tr></thead>
                <tbody>
                  {(Array.isArray(hSteps) ? hSteps : []).map((s: any, i: number) => (
                    <tr key={i} style={{ borderBottom: '1px solid #e2e8f0' }}>
                      <td style={td}>{i + 1}</td>
                      <td style={td}>{typeof s === 'string' ? s : s.content || s.operation || ''}</td>
                      <td style={{ ...td, color: '#b8860b' }}>{hNotes[i] || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </SectionCard>
          ) : rtTicket ? (
            /* ---- 实时工作流票预览 ---- */
            <SectionCard title={`操作票预览${isExternalPending ? '（预案草稿）' : ''}`}>
              <div style={{ border: `2px solid ${isExternalPending ? '#f2c94c' : '#1f8a4c'}`, borderRadius: 6, padding: 16, marginBottom: 16, background: '#fafffe' }}>
                <div style={{ textAlign: 'center', marginBottom: 12 }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#1f2937' }}>
                    配电网转供操作票{isExternalPending ? '（预案草稿）' : ''}
                  </div>
                  <div style={{ fontSize: 12, color: '#667085', marginTop: 4 }}>国网江苏市级配电网智能成票与安全校验系统 · 实时工作流</div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 20px', fontSize: 13 }}>
                  <div><span style={{ color: '#667085' }}>票号：</span><strong>{rtTicket.ticket_id}</strong></div>
                  <div><span style={{ color: '#667085' }}>状态：</span><StatusBadge status={isExternalPending ? '草稿' : '草稿'} /></div>
                  <div style={{ gridColumn: '1 / -1' }}><span style={{ color: '#667085' }}>操作任务：</span>{rtTicket.task_name}</div>
                  <div><span style={{ color: '#667085' }}>故障线路：</span><strong style={{ color: '#eb5757' }}>{rtTicket.fault_line}</strong></div>
                  <div><span style={{ color: '#667085' }}>转供方案：</span><strong style={{ color: '#1f8a4c' }}>{rtTicket.plan_id}</strong></div>
                  <div><span style={{ color: '#667085' }}>联络线：</span><strong style={{ color: '#1f8a4c' }}>{rtTicket.tie_lines.join('、') || '-'}</strong></div>
                  <div><span style={{ color: '#667085' }}>生成时间：</span>{rtTicket.created_at}</div>
                  {isExternalPending && (
                    <div style={{ gridColumn: '1 / -1', marginTop: 4, background: '#fff8e1', padding: '4px 8px', borderRadius: 3, fontSize: 11, color: '#b8860b' }}>
                      ⚠️ 待外部潮流评分确认 — 不可作为正式操作依据
                    </div>
                  )}
                </div>
              </div>
              {rtTicket.warnings && rtTicket.warnings.length > 0 && (
                <div style={{ background: '#fff8e1', border: '1px solid #f2c94c', borderRadius: 4, padding: '6px 12px', marginBottom: 12, fontSize: 12, color: '#b8860b' }}>
                  ⚠️ {rtTicket.warnings.join('；')}
                </div>
              )}
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead><tr style={{ background: '#f3f6f9' }}>
                  <th style={th}>序号</th><th style={th}>操作内容</th><th style={th}>安全提示</th><th style={th}>执行 ✓</th>
                </tr></thead>
                <tbody>
                  {rtTicket.operation_steps.map((s) => (
                    <tr key={s.step} id={`ticket-step-${s.step}`} style={{ borderBottom: '1px solid #e2e8f0' }}>
                      <td style={td}>{s.step}</td>
                      <td style={td}>{s.action}</td>
                      <td style={{ ...td, color: '#b8860b' }}>{safetyNote(s.operation_type)}</td>
                      <td style={{ ...td, textAlign: 'center', color: '#c8d6e5' }}>□</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </SectionCard>
          ) : (
            <SectionCard title="操作票预览">
              <div style={{ textAlign: 'center', padding: 60, color: '#94a3b8', fontSize: 13 }}>
                {hasSteps ? '点击「生成操作票」后显示' : '请先生成操作序列。'}
              </div>
            </SectionCard>
          )}
        </div>

        <div style={{ flex: '0 0 240px' }}>
          <SectionCard title="操作" style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button onClick={handleGenerate} disabled={!hasSteps} className="btn-primary" style={{ width: '100%', opacity: hasSteps ? 1 : 0.5 }}>
                {isExternalPending ? '生成预案草稿' : '生成操作票'}
              </button>
              {showingHist && (
                <button onClick={handleExport} disabled={exporting}
                  style={{ width: '100%', padding: '8px 20px', borderRadius: 6, fontSize: 13, cursor: 'pointer', background: '#1f8a4c', color: '#fff', border: 'none' }}>
                  {exporting ? '导出中...' : '📥 导出 Excel'}
                </button>
              )}
              {rtTicket && !showingHist && (
                <div style={{ fontSize: 11, color: '#667085', background: '#f3f6f9', padding: '6px 8px', borderRadius: 4 }}>
                  已保存至 currentWorkflow，可进入安全校验环节。
                  {isExternalPending && <span style={{ color: '#b8860b', display: 'block', marginTop: 4 }}>⚠️ 当前为预案草稿，待外部评分确认。</span>}
                </div>
              )}
              {error && <div style={{ color: '#eb5757', fontSize: 12 }}>{error}</div>}
            </div>
          </SectionCard>

          <SectionCard title="历史操作票">
            {tickets.length > 0 ? (
              <div style={{ fontSize: 12, maxHeight: 300, overflowY: 'auto' }}>
                {tickets.map((t) => (
                  <div key={t.ticketNo} onClick={() => setHistTicket(t)}
                    style={{ padding: '6px 8px', cursor: 'pointer', borderRadius: 4, marginBottom: 4,
                      background: histTicket?.ticketNo === t.ticketNo ? '#e8f5e9' : '#f8fafb',
                      border: '1px solid #e2e8f0' }}>
                    <div style={{ fontWeight: 600, color: '#1f2937' }}>{t.ticketNo}</div>
                    <div style={{ color: '#667085', fontSize: 11 }}>{t.taskName}</div>
                  </div>
                ))}
                {showingHist && (
                  <button onClick={() => setHistTicket(null)} className="btn-ghost" style={{ width: '100%', marginTop: 6, fontSize: 12 }}>
                    ← 返回实时工作流票
                  </button>
                )}
              </div>
            ) : <div style={{ textAlign: 'center', padding: 20, color: '#94a3b8', fontSize: 12 }}>暂无记录</div>}
          </SectionCard>
        </div>
      </div>
    </PageContainer>
  );
}

const th: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', fontWeight: 600, color: '#667085', borderBottom: '2px solid #c8d6e5' };
const td: React.CSSProperties = { padding: '8px 10px', verticalAlign: 'top', wordBreak: 'break-all' };
