import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import PageContainer from '../layouts/PageContainer';
import StatusBadge from '../components/StatusBadge';
import SectionCard from '../components/SectionCard';
import WorkflowProgress from '../components/WorkflowProgress';
import { getCurrentWorkflow, saveCurrentWorkflow } from '../store/workflowStore';

interface ApiOperationStep { step: number; action: string; operation_type: string; line?: string; }
interface RealtimeTicket { ticket_id: string; fault_line: string; plan_id: string; tie_lines: string[]; tie_ids?: string[]; operation_steps: ApiOperationStep[]; created_at: string; source: 'realtime_workflow'; task_name: string; tie_name?: string; transfer_status?: string; warnings?: string[]; }
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
  const wf = getCurrentWorkflow();
  const seqResult = wf?.sequence_result || null;
  const selectedPlan = wf?.selected_plan || null;
  const faultLine = wf?.fault_line || '';
  const planId = wf?.selected_plan_id || '';
  const transferStatus = wf?.transfer_status || '';
  const opStepsRaw = wf?.operation_sequence;
  const opSteps: ApiOperationStep[] = Array.isArray(opStepsRaw) ? opStepsRaw.map((s: any) => ({
    step: s.stepNo ?? s.step ?? 0,
    action: s.deviceName ?? s.action ?? '',
    operation_type: s.action === '确认断开' ? 'verify_open' : s.action === '合闸' ? 'close' : s.action === '拉开' ? 'open' : 'check',
    line: s.deviceId ?? s.line ?? '',
  })) : [];
  const hasSteps = opSteps.length > 0;

  const savedTicket = wf?.ticket || null;
  const [rtTicket, setRtTicket] = useState<RealtimeTicket | null>(savedTicket as RealtimeTicket | null);
  const [histTicket, setHistTicket] = useState<AnyTicket | null>(null);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [tickets, setTickets] = useState<AnyTicket[]>([]);
  const isExternalPending = transferStatus === 'external_pending';

  useEffect(() => { fetchTickets(); }, []);

  const fetchTickets = async () => {
    try {
      const res = await fetch('http://localhost:8000/api/tickets');
      const json = await res.json();
      if (json.data?.length) setTickets(json.data);
    } catch {}
  };

  const handleGenerate = () => {
    setError('');
    if (!hasSteps) { setError('请先生成操作序列。'); return; }
    const now = new Date();
    const ts = now.toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const tieLines: string[] = seqResult?.tie_lines || selectedPlan?.tie_lines || [];
    const tieName = selectedPlan?.tie_name || tieLines.join('+') || '-';
    const ticket: RealtimeTicket = {
      ticket_id: `OT${ts}`, fault_line: faultLine || '-', plan_id: planId || seqResult?.plan_id || '-',
      tie_lines: tieLines, tie_ids: wf?.selected_tie_ids || [], operation_steps: opSteps,
      created_at: now.toLocaleString('zh-CN'), source: 'realtime_workflow',
      task_name: `故障线路 ${faultLine || '-'} 隔离及经联络开关 ${tieName} 转供恢复操作`,
      tie_name: tieName, transfer_status: transferStatus, warnings: seqResult?.warnings || [],
    };
    saveCurrentWorkflow({ ticket });
    setRtTicket(ticket); setHistTicket(null);
  };

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
      a.href = url; a.download = `操作票_${id}_${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}.xlsx`;
      document.body.appendChild(a); a.click(); document.body.removeChild(a); window.URL.revokeObjectURL(url);
    } catch { alert('导出失败'); }
    finally { setExporting(false); }
  };

  const showingHist = histTicket != null;

  return (
    <PageContainer title="模板化成票">
      <WorkflowProgress currentStep="ticket" />

      {/* ====== 无步骤提示 ====== */}
      {!hasSteps && (
        <div style={{ background: '#fff8e1', border: '1px solid #ffe082', borderRadius: 6, padding: '10px 14px', marginBottom: 14, fontSize: 12 }}>
          ⚠️ 请先生成操作序列。
        </div>
      )}

      {/* ====== 方案信息 ====== */}
      {hasSteps && (
        <div style={{ background: '#e8f5e9', border: '1px solid #a5d6a7', borderRadius: 6, padding: '8px 14px', marginBottom: 12, fontSize: 12, display: 'flex', gap: 16, flexWrap: 'wrap', alignItems: 'center' }}>
          <span>步骤：<strong>{opSteps.length} 步</strong></span>
          <span>方案：<strong style={{ color: '#1f8a4c' }}>{planId || '-'}</strong></span>
          <span>故障：<strong style={{ color: '#eb5757' }}>{faultLine}</strong></span>
          {selectedPlan?.tie_name && <span>联络：<strong style={{ color: '#1f8a4c' }}>{selectedPlan.tie_name}</strong></span>}
        </div>
      )}

      {/* ====== 外部评分待确认 ====== */}
      {isExternalPending && hasSteps && (
        <div style={{ background: '#fff8e1', border: '1px solid #f2c94c', borderRadius: 6, padding: '8px 14px', marginBottom: 12, fontSize: 11, color: '#b8860b' }}>
          ⚠️ 待外部评分确认，当前只能生成预案草稿。
        </div>
      )}

      {/* ====== 主布局：左(票预览) + 右(操作区) ====== */}
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 480 }}>
          {showingHist ? (
            <SectionCard title="操作票预览（历史票）">
              <TicketHeader ticket={histTicket} />
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead><tr style={{ background: '#f3f6f9' }}>
                  <th style={th}>序号</th><th style={th}>操作内容</th><th style={th}>安全提示</th>
                </tr></thead>
                <tbody>
                  {(Array.isArray(histTicket.steps) ? histTicket.steps : []).map((s: any, i: number) => (
                    <tr key={i} style={{ borderBottom: '1px solid #e2e8f0' }}>
                      <td style={{ ...td, width: 40, fontWeight: 600, color: '#1f8a4c' }}>{i + 1}</td>
                      <td style={td}>{typeof s === 'string' ? s : s.content || s.operation || ''}</td>
                      <td style={{ ...td, color: '#b8860b', fontSize: 10 }}>{(histTicket.safetyNotes || [])[i] || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </SectionCard>
          ) : rtTicket ? (
            <SectionCard title="操作票预览（草案）">
              <div style={{ border: `2px solid ${isExternalPending ? '#f2c94c' : '#1f8a4c'}`, borderRadius: 6, padding: 16, marginBottom: 14, background: '#fafffe' }}>
                <div style={{ textAlign: 'center', marginBottom: 12 }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#1f2937' }}>配电网转供操作票（草案）</div>
                  <div style={{ fontSize: 11, color: '#667085', marginTop: 4 }}>国网江苏市级配电网智能成票与安全校验系统</div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', fontSize: 12 }}>
                  <div><span style={{ color: '#667085' }}>票号：</span><strong>{rtTicket.ticket_id}</strong></div>
                  <div><span style={{ color: '#667085' }}>生成时间：</span>{rtTicket.created_at}</div>
                  <div style={{ gridColumn: '1 / -1' }}><span style={{ color: '#667085' }}>操作任务：</span>{rtTicket.task_name}</div>
                  <div><span style={{ color: '#667085' }}>故障线路：</span><strong style={{ color: '#eb5757' }}>{rtTicket.fault_line}</strong></div>
                  <div><span style={{ color: '#667085' }}>转供方案：</span><strong style={{ color: '#1f8a4c' }}>{rtTicket.plan_id}</strong></div>
                </div>
                {isExternalPending && (
                  <div style={{ marginTop: 6, background: '#fff8e1', padding: '4px 8px', borderRadius: 3, fontSize: 10, color: '#b8860b' }}>
                    ⚠️ 待外部潮流评分确认 — 不可作为正式操作依据
                  </div>
                )}
              </div>
              {rtTicket.warnings && rtTicket.warnings.length > 0 && (
                <div style={{ background: '#fff8e1', border: '1px solid #f2c94c', borderRadius: 4, padding: '6px 12px', marginBottom: 12, fontSize: 11, color: '#b8860b' }}>
                  ⚠️ {rtTicket.warnings.join('；')}
                </div>
              )}
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead><tr style={{ background: '#f3f6f9' }}>
                  <th style={th}>序号</th><th style={th}>操作内容</th><th style={th}>安全提示</th><th style={{ ...th, width: 40, textAlign: 'center' }}>✓</th>
                </tr></thead>
                <tbody>
                  {rtTicket.operation_steps.map(s => (
                    <tr key={s.step} style={{ borderBottom: '1px solid #e2e8f0' }}>
                      <td style={{ ...td, width: 40, fontWeight: 600, color: '#1f8a4c' }}>{s.step}</td>
                      <td style={td}>{s.action}</td>
                      <td style={{ ...td, color: '#b8860b', fontSize: 10 }}>{safetyNote(s.operation_type)}</td>
                      <td style={{ ...td, textAlign: 'center', color: '#c8d6e5', width: 40 }}>□</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </SectionCard>
          ) : (
            <SectionCard title="操作票预览">
              <div style={{ textAlign: 'center', padding: 50, color: '#94a3b8', fontSize: 12 }}>
                {hasSteps ? '点击「生成操作票草稿」后显示' : '请先生成操作序列'}
              </div>
            </SectionCard>
          )}
        </div>

        {/* ====== 右侧操作区 ====== */}
        <div style={{ flex: '0 0 220px' }}>
          <SectionCard title="操作" style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button onClick={handleGenerate} disabled={!hasSteps}
                style={{ width: '100%', padding: '8px', borderRadius: 4, fontSize: 12, cursor: 'pointer', background: hasSteps ? '#1f8a4c' : '#94a3b8', color: '#fff', border: 'none', fontWeight: 600 }}>
                {isExternalPending ? '生成预案草稿' : '生成操作票草稿'}
              </button>
              {showingHist && (
                <button onClick={handleExport} disabled={exporting}
                  style={{ width: '100%', padding: '8px', borderRadius: 4, fontSize: 12, cursor: 'pointer', background: '#1f8a4c', color: '#fff', border: 'none' }}>
                  {exporting ? '导出中...' : '📥 导出 Excel'}
                </button>
              )}
              {rtTicket && !showingHist && (
                <div style={{ fontSize: 10, color: '#667085', background: '#f3f6f9', padding: '6px 8px', borderRadius: 4 }}>
                  草案已生成（不具备现场执行授权）。
                </div>
              )}
              {error && <div style={{ color: '#eb5757', fontSize: 11 }}>{error}</div>}
            </div>
          </SectionCard>

          <SectionCard title="历史操作票">
            {tickets.length > 0 ? (
              <div style={{ fontSize: 11, maxHeight: 300, overflowY: 'auto' }}>
                {tickets.map(t => (
                  <div key={t.ticketNo} onClick={() => setHistTicket(t)}
                    style={{ padding: '6px 8px', cursor: 'pointer', borderRadius: 4, marginBottom: 4,
                      background: histTicket?.ticketNo === t.ticketNo ? '#e8f5e9' : '#f8fafb', border: '1px solid #e2e8f0' }}>
                    <div style={{ fontWeight: 600, color: '#1f2937' }}>{t.ticketNo}</div>
                    <div style={{ color: '#667085', fontSize: 10 }}>{t.taskName}</div>
                  </div>
                ))}
                {showingHist && (
                  <button onClick={() => setHistTicket(null)} style={{ width: '100%', marginTop: 6, padding: '4px', borderRadius: 3, fontSize: 11, cursor: 'pointer', background: '#f3f6f9', color: '#667085', border: '1px solid #c8d6e5' }}>
                    ← 返回实时票
                  </button>
                )}
              </div>
            ) : <div style={{ textAlign: 'center', padding: 16, color: '#94a3b8', fontSize: 11 }}>暂无记录</div>}
          </SectionCard>
        </div>
      </div>
    </PageContainer>
  );
}

function TicketHeader({ ticket }: { ticket: AnyTicket }) {
  return (
    <div style={{ border: '2px solid #c8d6e5', borderRadius: 6, padding: 14, marginBottom: 12, background: '#fafffe' }}>
      <div style={{ textAlign: 'center', marginBottom: 10 }}>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#1f2937' }}>操作票</div>
        <div style={{ fontSize: 10, color: '#667085', marginTop: 2 }}>国网江苏市级配电网智能成票与安全校验系统</div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', fontSize: 12 }}>
        <div><span style={{ color: '#667085' }}>票号：</span><strong>{ticket.ticketNo || ticket.ticketId || '-'}</strong></div>
        <div><span style={{ color: '#667085' }}>状态：</span><StatusBadge status={ticket.status || '草稿'} /></div>
        <div style={{ gridColumn: '1 / -1' }}><span style={{ color: '#667085' }}>操作任务：</span>{ticket.taskName || ticket.title || '-'}</div>
        <div><span style={{ color: '#667085' }}>校验结论：</span><StatusBadge status={ticket.checkResult || '通过'} /></div>
      </div>
    </div>
  );
}

const th: React.CSSProperties = { textAlign: 'left', padding: '6px 8px', fontWeight: 600, color: '#667085', fontSize: 10, borderBottom: '2px solid #c8d6e5' };
const td: React.CSSProperties = { padding: '6px 8px', verticalAlign: 'top', wordBreak: 'break-all', fontSize: 11 };
