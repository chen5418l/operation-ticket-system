import { useLocation, useNavigate } from 'react-router-dom';

interface MenuItem {
  key: string;
  label: string;
  icon: string;
}

const menuItems: MenuItem[] = [
  { key: '/dashboard', label: '系统主界面', icon: '📊' },
  { key: '/data-management', label: '数据管理', icon: '🗄️' },
  { key: '/forecast', label: '源荷预测风险', icon: '📈' },
  { key: '/boundary-judgment', label: '边界判定', icon: '🔀' },
  { key: '/transfer-decision', label: '转供决策', icon: '🛣️' },
  { key: '/sequence-generation', label: '操作序列生成', icon: '📋' },
  { key: '/ticket-generation', label: '模板化成票', icon: '📝' },
  { key: '/safety-check', label: '安全校验', icon: '🛡️' },
  { key: '/statistics', label: '测试统计', icon: '📈' },
];

export default function SideNav() {
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <nav style={{
      width: 'var(--sidebar-width)',
      minWidth: 200,
      background: '#f8fafb',
      borderRight: '1px solid #e2e8f0',
      paddingTop: 8,
      position: 'fixed',
      top: 'var(--topbar-height)',
      left: 0,
      bottom: 0,
      overflowY: 'auto',
      zIndex: 90,
    }}>
      {menuItems.map((item) => {
        const isActive = location.pathname === item.key
          || (item.key === '/dashboard' && location.pathname === '/');
        return (
          <div
            key={item.key}
            onClick={() => navigate(item.key)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              height: 42,
              padding: '0 16px',
              margin: '2px 8px',
              cursor: 'pointer',
              fontSize: 13,
              color: isActive ? '#1f8a4c' : '#1f2937',
              transition: 'all 0.15s',
              borderRadius: 6,
              background: isActive ? '#e8f5e9' : 'transparent',
              borderLeft: isActive ? '3px solid #1f8a4c' : '3px solid transparent',
              fontWeight: isActive ? 600 : 400,
            }}
          >
            <span style={{ fontSize: 16, flexShrink: 0 }}>{item.icon}</span>
            <span>{item.label}</span>
          </div>
        );
      })}
    </nav>
  );
}
