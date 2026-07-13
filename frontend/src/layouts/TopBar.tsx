import { useState, useEffect } from 'react';

const styles: Record<string, React.CSSProperties> = {
  topbar: {
    height: 'var(--topbar-height)',
    background: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 24px',
    borderBottom: '2px solid #1677ff',
    boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
  },
  title: {
    fontSize: 18,
    fontWeight: 600,
    color: '#262626',
    letterSpacing: '0.5px',
  },
  right: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
    fontSize: 13,
    color: '#595959',
  },
  divider: {
    color: '#d9d9d9',
  },
};

export default function TopBar() {
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const formatTime = (d: Date) => {
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    const s = String(d.getSeconds()).padStart(2, '0');
    return `${y}-${mo}-${day} ${h}:${mi}:${s}`;
  };

  return (
    <header style={styles.topbar}>
      <div style={styles.title}>市级配电网操作票智能成票与安全校验系统</div>
      <div style={styles.right}>
        <span>管理员</span>
        <span style={styles.divider}>|</span>
        <span>张迁</span>
        <span style={styles.divider}>|</span>
        <span>{formatTime(time)}</span>
      </div>
    </header>
  );
}
