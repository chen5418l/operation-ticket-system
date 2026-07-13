import type { ReactNode } from 'react';

interface Props {
  title: string;
  children: ReactNode;
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    padding: 24,
    height: '100%',
    overflowY: 'auto',
  },
  header: {
    marginBottom: 20,
  },
  title: {
    fontSize: 20,
    fontWeight: 600,
    color: '#262626',
  },
  content: {
    background: '#fff',
    borderRadius: 6,
    border: '1px solid #e8e8e8',
    padding: 24,
    boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
  },
};

export default function PageContainer({ title, children }: Props) {
  return (
    <div style={styles.wrapper}>
      <div style={styles.header}>
        <h2 style={styles.title}>{title}</h2>
      </div>
      <div style={styles.content}>
        {children}
      </div>
    </div>
  );
}
