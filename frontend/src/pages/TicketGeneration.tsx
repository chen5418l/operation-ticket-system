import { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import PageContainer from '../layouts/PageContainer';
import StatusBadge from '../components/StatusBadge';
import SectionCard from '../components/SectionCard';
import WorkflowProgress from '../components/WorkflowProgress';
import { saveWorkflowState, getWorkflowState } from '../store/workflowStore';

/** 通用票据格式：兼容新旧后端 */
interface AnyTicket { ticketNo?: string; ticketId?: string; taskName?: string; title?: string; status?: string; operator?: string; guardian?: string; checkResult?: string; createdAt?: string; steps?: any[]; safetyNotes?: string[]; info?: any; }

export default function TicketGeneration() {
  const location = useLocation();
  const existingState = getWorkflowState();
  const [ticket, setTicket] = useState<AnyTicket | null>(existingState.ticket || null);
  const [loading, setLoading] = useState(false);
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
  }, [location.hash, ticket]);

  useEffect(() => { fetchTickets(); }, []);

  const fetchTickets = async () => {
    try {
      const res = await fetch('http://localhost:8000/api/tickets');
      const json = await res.json();
      if (json.data?.length) setTickets(json.data);
    } catch {}
  };

  const handleGenerate = async () => {
    setLoading(true); setError('');
    try {
      // 新版后端用 planId，旧版用 scenarioId
      const body = JSON.stringify(existingState.transferPlan?.planId
        ? { planId: 1 } : { scenarioId: existingState.scenarioId || 'SC20260705-001' });
      const res = await fetch('http://localhost:8000/api/ticket/generate', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      const t = json.data || json;
      setTicket(t); saveWorkflowState({ ticket: t });
      fetchTickets();
    } catch (e: any) { setError(e.message || '请求失败，请确认后端服务已启动'); }
    finally { setLoading(false); }
  };

  const handleExport = async () => {
    if (!ticket) return;
    setExporting(true);
    const id = ticket.ticketNo || ticket.info?.ticketId || ticket.ticketId || '';
    try {
      const res = await fetch(`http://localhost:8000/api/ticket/${encodeURIComponent(id)}/export`);
      if (!res.ok) { alert(`导出失败 (HTTP ${res.status})，请确认后端服务已启动`); return; }
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
  const handleSaveDraft = () => { alert('功能开发中：保存草案将在后续版本支持'); };

  const tId = ticket?.ticketNo || ticket?.info?.ticketId || ticket?.ticketId || '-';
  const tStatus = ticket?.status || ticket?.info?.status || '草稿';
  const tTitle = ticket?.taskName || ticket?.info?.title || '-';
  const tSteps = ticket?.steps || ticket?.info?.steps || [];
  const tNotes = ticket?.safetyNotes || [];

  return (
    <PageContainer title="模板化成票">
      <WorkflowProgress currentStep="ticket" />

      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 500 }}>
          {ticket ? (
            <SectionCard title="操作票预览">
              {/* 票头 */}
              <div style={{ border: '2px solid #1f8a4c', borderRadius: 6, padding: 16, marginBottom: 16, background: '#fafffe' }}>
                <div style={{ textAlign: 'center', marginBottom: 12 }}>
                  <div style={{ fontSize: 18, fontWeight: 700, color: '#1f2937' }}>操作票</div>
                  <div style={{ fontSize: 12, color: '#667085', marginTop: 4 }}>国网江苏市级配电网智能成票与安全校验系统</div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px 20px', fontSize: 13 }}>
                  <div><span style={{ color: '#667085' }}>票号：</span><strong>{tId}</strong></div>
                  <div><span style={{ color: '#667085' }}>状态：</span><StatusBadge status={tStatus} /></div>
                  <div><span style={{ color: '#667085' }}>操作任务：</span>{tTitle}</div>
                  <div><span style={{ color: '#667085' }}>校验结论：</span><StatusBadge status={ticket.checkResult || '通过'} /></div>
                  <div><span style={{ color: '#667085' }}>操作人：</span>{ticket.operator || '-'}</div>
                  <div><span style={{ color: '#667085' }}>监护人：</span>{ticket.guardian || '-'}</div>
                </div>
              </div>
              {/* 步骤表 */}
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead><tr style={{ background: '#f3f6f9' }}>
                  <th style={th}>序号</th><th style={th}>操作内容</th><th style={th}>安全提示</th>
                </tr></thead>
                <tbody>
                  {(Array.isArray(tSteps) ? tSteps : []).map((s: any, i: number) => (
                    <tr key={i} id={`ticket-step-${i+1}`} style={{ borderBottom: '1px solid #e2e8f0' }}>
                      <td style={td}>{i + 1}</td>
                      <td style={td}>{typeof s === 'string' ? s : s.content || s.operation || ''}</td>
                      <td style={{ ...td, color: '#b8860b' }}>{tNotes[i] || ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </SectionCard>
          ) : (
            <SectionCard title="操作票预览">
              <div style={{ textAlign: 'center', padding: 60, color: '#94a3b8', fontSize: 13 }}>点击「生成操作票」后显示</div>
            </SectionCard>
          )}
        </div>

        <div style={{ flex: '0 0 240px' }}>
          <SectionCard title="操作" style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button onClick={handleGenerate} disabled={loading} className="btn-primary" style={{ width: '100%' }}>
                {loading ? '生成中...' : '生成操作票'}
              </button>
              <button onClick={handleSaveDraft} className="btn-ghost" style={{ width: '100%' }}>保存草案</button>
              {ticket && (
                <button onClick={handleExport} disabled={exporting}
                  style={{ width: '100%', padding: '8px 20px', borderRadius: 6, fontSize: 13, cursor: 'pointer', background: '#1f8a4c', color: '#fff', border: 'none' }}>
                  {exporting ? '导出中...' : '📥 导出 Excel'}
                </button>
              )}
              {error && <div style={{ color: '#eb5757', fontSize: 12 }}>{error}</div>}
            </div>
          </SectionCard>

          <SectionCard title="历史操作票">
            {tickets.length > 0 ? (
              <div style={{ fontSize: 12, maxHeight: 300, overflowY: 'auto' }}>
                {tickets.map((t) => (
                  <div key={t.ticketNo} onClick={() => setTicket(t)}
                    style={{ padding: '6px 8px', cursor: 'pointer', borderRadius: 4, marginBottom: 4,
                      background: ticket?.ticketNo === t.ticketNo ? '#e8f5e9' : '#f8fafb',
                      border: '1px solid #e2e8f0' }}>
                    <div style={{ fontWeight: 600, color: '#1f2937' }}>{t.ticketNo}</div>
                    <div style={{ color: '#667085', fontSize: 11 }}>{t.taskName}</div>
                  </div>
                ))}
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
