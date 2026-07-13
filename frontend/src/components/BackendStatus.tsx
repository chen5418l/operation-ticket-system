import { useEffect, useState } from 'react';

export default function BackendStatus() {
  const [status, setStatus] = useState<'checking' | 'online' | 'offline'>('checking');
  const [dbStatus, setDbStatus] = useState<string>('');

  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch('http://localhost:8000/api/health', { signal: AbortSignal.timeout(5000) });
        if (res.ok) {
          const data = await res.json();
          setStatus('online');
          setDbStatus(data?.database?.status || 'ok');
        } else {
          setStatus('offline');
        }
      } catch {
        setStatus('offline');
      }
    };
    check();
    const interval = setInterval(check, 30000); // 每30秒检测
    return () => clearInterval(interval);
  }, []);

  if (status === 'checking') return null;
  if (status === 'online') return null;

  return (
    <div style={{
      position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 9999,
      background: '#fff3cd', borderTop: '2px solid #ffc107',
      padding: '10px 20px', display: 'flex', alignItems: 'center', justifyContent: 'center',
      gap: 12, fontSize: 13, color: '#856404',
    }}>
      <span style={{ fontSize: 16 }}>⚠️</span>
      <span>
        <strong>后端服务未连接</strong>
        {dbStatus === 'error' && ' — MySQL 数据库连接异常'}
      </span>
      <span style={{ color: '#666', fontSize: 12 }}>
        请启动 FastAPI 服务：
      </span>
      <code style={{
        background: '#f8f9fa', padding: '4px 8px', borderRadius: 4,
        fontSize: 12, border: '1px solid #ddd',
      }}>
        cd backend && uvicorn main:app --reload --port 8000
      </code>
      <button
        onClick={() => { setStatus('checking'); setTimeout(() => window.location.reload(), 1000); }}
        style={{
          padding: '4px 12px', borderRadius: 4, border: '1px solid #ffc107',
          background: '#fff', color: '#856404', fontSize: 12, cursor: 'pointer',
        }}>
        重新检测
      </button>
    </div>
  );
}
