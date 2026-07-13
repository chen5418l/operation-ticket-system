import type { ReactNode } from 'react';

interface Props {
  title?: string;
  extra?: ReactNode;
  children: ReactNode;
  style?: React.CSSProperties;
}

export default function SectionCard({ title, extra, children, style }: Props) {
  return (
    <div style={{
      background: '#fff',
      border: '1px solid #c8d6e5',
      borderRadius: 6,
      boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
      ...style,
    }}>
      {(title || extra) && (
        <div style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '14px 20px',
          borderBottom: '1px solid #e2e8f0',
        }}>
          {title && (
            <h3 style={{ fontSize: 14, fontWeight: 600, color: '#1f2937', margin: 0 }}>
              {title}
            </h3>
          )}
          {extra && <div style={{ display: 'flex', gap: 8 }}>{extra}</div>}
        </div>
      )}
      <div style={{ padding: 20 }}>
        {children}
      </div>
    </div>
  );
}
