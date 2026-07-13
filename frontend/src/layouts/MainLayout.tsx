import { Outlet } from 'react-router-dom';
import TopBar from './TopBar';
import SideNav from './SideNav';
import BackendStatus from '../components/BackendStatus';

const styles: Record<string, React.CSSProperties> = {
  layout: {
    height: '100%',
    display: 'flex',
    flexDirection: 'column',
  },
  body: {
    display: 'flex',
    flex: 1,
    marginTop: 'var(--topbar-height)',
  },
  main: {
    flex: 1,
    marginLeft: 'var(--sidebar-width)',
    background: '#f0f2f5',
    minHeight: 0,
    overflow: 'auto',
  },
};

export default function MainLayout() {
  return (
    <div style={styles.layout}>
      <TopBar />
      <div style={styles.body}>
        <SideNav />
        <main style={styles.main}>
          <Outlet />
        </main>
      </div>
      <BackendStatus />
    </div>
  );
}
