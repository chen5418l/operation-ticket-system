import type { Ticket } from '../types';

interface Props {
  ticket: Ticket;
}

const stageColors: Record<string, string> = {
  '故障确认': '#fff2f0',
  '安全隔离': '#fffbe6',
  '负荷转移': '#e6f4ff',
  '恢复供电': '#f6ffed',
  '方式确认': '#f9f0ff',
};

export default function TicketPreview({ ticket }: Props) {
  const { info, steps } = ticket;

  return (
    <div style={{
      border: '1px solid #d9d9d9',
      borderRadius: 6,
      overflow: 'hidden',
    }}>
      {/* 票头 */}
      <div style={{
        background: '#fafafa',
        borderBottom: '2px solid #1677ff',
        padding: '16px 20px',
      }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, color: '#262626', marginBottom: 10 }}>
          {info.title}
        </h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '6px 24px', fontSize: 12 }}>
          <div><span style={{ color: '#8c8c8c' }}>票号：</span>{info.ticketId}</div>
          <div><span style={{ color: '#8c8c8c' }}>创建时间：</span>{info.createTime}</div>
          <div><span style={{ color: '#8c8c8c' }}>审核人：</span>{info.reviewer}</div>
          <div><span style={{ color: '#8c8c8c' }}>当前运行方式：</span>{info.preMode}</div>
          <div><span style={{ color: '#8c8c8c' }}>版本：</span>{info.version}</div>
          <div><span style={{ color: '#8c8c8c' }}>状态：</span>
            <span style={{
              color: info.status === '已校核' ? '#52c41a' : info.status === '草稿' ? '#8c8c8c' : '#1677ff',
              fontWeight: 500,
            }}>
              {info.status}
            </span>
          </div>
        </div>
        <div style={{ fontSize: 12, marginTop: 6 }}>
          <span style={{ color: '#8c8c8c' }}>目标运行方式：</span>
          <span style={{ color: '#262626' }}>{info.targetMode}</span>
        </div>
      </div>

      {/* 操作步骤 */}
      <div style={{ padding: '0' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: '#fafafa' }}>
              <th style={thStyle}>序号</th>
              <th style={thStyle}>阶段</th>
              <th style={thStyle}>操作</th>
              <th style={thStyle}>设备</th>
              <th style={thStyle}>操作内容</th>
              <th style={thStyle}>安全注意事项</th>
            </tr>
          </thead>
          <tbody>
            {steps.map((step) => (
              <tr key={step.seqNo} style={{ borderBottom: '1px solid #f0f0f0' }}>
                <td style={tdStyle}>{step.seqNo}</td>
                <td style={tdStyle}>
                  <span style={{
                    padding: '1px 6px', borderRadius: 3, fontSize: 11,
                    background: stageColors[step.stage] || '#f0f0f0', color: '#595959',
                  }}>
                    {step.stage}
                  </span>
                </td>
                <td style={{ ...tdStyle, fontWeight: 600, color: '#1677ff' }}>{step.operation}</td>
                <td style={tdStyle}>{step.device}</td>
                <td style={tdStyle}>{step.content}</td>
                <td style={{ ...tdStyle, color: '#faad14' }}>{step.safetyNote || '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  textAlign: 'left', padding: '8px 10px', fontWeight: 600, color: '#595959',
  borderBottom: '1px solid #e8e8e8', whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = {
  padding: '8px 10px', color: '#262626', verticalAlign: 'top',
};
