interface InfoItem {
  label: string;
  value: string | number;
  color?: string;
  badge?: string;
}

interface Props {
  items: InfoItem[];
  title?: string;
}

export default function InfoPanel({ items, title }: Props) {
  return (
    <div style={{
      background: '#fff',
      border: '1px solid #c8d6e5',
      borderRadius: 6,
      overflow: 'hidden',
    }}>
      {title && (
        <div style={{
          padding: '12px 16px',
          borderBottom: '1px solid #e2e8f0',
          fontWeight: 600,
          fontSize: 13,
          color: '#1f2937',
          background: '#f8fafb',
        }}>
          {title}
        </div>
      )}
      <div style={{ padding: '8px 0' }}>
        {items.map((item, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              padding: '7px 16px',
              borderBottom: i < items.length - 1 ? '1px solid #f3f6f9' : 'none',
              fontSize: 13,
            }}
          >
            <span style={{ color: '#667085', width: 100, flexShrink: 0 }}>{item.label}</span>
            <span style={{
              color: item.color || '#1f2937',
              fontWeight: item.color ? 600 : 400,
              flex: 1,
              wordBreak: 'break-all',
            }}>
              {item.value}
            </span>
            {item.badge && (
              <span style={{
                padding: '1px 8px', borderRadius: 4, fontSize: 11,
                background: item.badge === '通过' ? '#e8f5e9' : item.badge === '警告' ? '#fff8e1' : '#ffebee',
                color: item.badge === '通过' ? '#1f8a4c' : item.badge === '警告' ? '#b8860b' : '#eb5757',
                fontWeight: 500, marginLeft: 8,
              }}>
                {item.badge}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
