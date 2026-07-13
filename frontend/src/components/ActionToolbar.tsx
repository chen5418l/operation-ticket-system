import type { ReactNode } from 'react';

interface Props {
  children: ReactNode;
  style?: React.CSSProperties;
}

export default function ActionToolbar({ children, style }: Props) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      flexWrap: 'wrap',
      padding: '12px 0',
      ...style,
    }}>
      {children}
    </div>
  );
}
