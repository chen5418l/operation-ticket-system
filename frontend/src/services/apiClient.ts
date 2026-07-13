/**
 * API 客户端 — 统一处理 DEMO_MODE 切换和后端调用
 *
 * VITE_DEMO_MODE=true  → 返回前端 mock 数据
 * VITE_DEMO_MODE=false → 调用 FastAPI 后端
 */

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
const IS_DEMO = import.meta.env.VITE_DEMO_MODE !== 'false';

export const apiConfig = {
  baseUrl: API_BASE,
  isDemo: IS_DEMO,
};

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const err = await res.text().catch(() => 'Unknown error');
    throw new Error(`API ${res.status}: ${err}`);
  }
  return res.json();
}

/** 后端不可用时的 fallback */
function handleApiError(err: any, fallback: any) {
  console.warn('API 调用失败，使用 fallback 数据:', err.message);
  return fallback;
}

export const topologyApi = {
  getIEEE33: async () => {
    if (IS_DEMO) return (await import('../components/topology/topologyData')).defaultMockData;
    try {
      const r = await request<any>('/api/topology/ieee33');
      return r.data || r;
    } catch (e) { return handleApiError(e, (await import('../components/topology/topologyData')).defaultMockData); }
  },
  initIEEE33: () => request<any>('/api/topology/init-ieee33', { method: 'POST' }),
  reset: async () => {
    if (IS_DEMO) return { message: 'DEMO 模式：拓扑已重置' };
    try { const r = await request<any>('/api/topology/reset', { method: 'POST' }); return r; }
    catch (e) { return handleApiError(e, { message: '重置失败' }); }
  },
};

export const faultApi = {
  analyze: async (faultLineId: string) => {
    if (IS_DEMO) {
      const { computeOutageBuses, getTransferOptions } = await import('../components/topology/topologyData');
      const lost = computeOutageBuses(faultLineId);
      const ties = getTransferOptions(faultLineId).map(t => t.id);
      return { faultId: 0, faultLine: faultLineId, affectedNodes: lost.map(id => parseInt(id.replace('BUS-',''))),
        lostLoadP: lost.length * 45, lostLoadQ: lost.length * 22, availableTieSwitches: ties,
        isolationSwitches: [`SW-${faultLineId}-FROM`, `SW-${faultLineId}-TO`],
        message: 'DEMO模式：前端BFS计算结果' };
    }
    try { const r = await request<any>('/api/fault/analyze', { method: 'POST', body: JSON.stringify({ faultLineId }) }); return r.data || r; }
    catch (e) { return handleApiError(e, null); }
  },
  list: async () => {
    if (IS_DEMO) return [];
    try { const r = await request<any>('/api/faults'); return r.data || []; }
    catch (e) { return []; }
  },
};

export const transferApi = {
  getPlans: async (faultId: number) => {
    if (IS_DEMO) {
      const { tieSwitches } = await import('../components/topology/topologyData');
      return { faultId, plans: tieSwitches.slice(0, 2).map((t, i) => ({
        id: i+1, name: `方案：闭合${t.name}`, closeTieSwitch: t.id,
        restoredNodes: [t.fromBus, t.toBus], restoredLoadP: t.transferCapacityMw * 1000,
        restoredLoadQ: t.transferCapacityMw * 500, maxLoadRate: t.estimatedLoadRate * 100,
        minVoltage: t.minVoltagePu, riskLevel: t.safetyCheck.result === 'pass' ? 'low' : 'medium',
        checkResult: t.safetyCheck.result === 'pass' ? 'passed' : 'warning',
        recommended: i === 0 })) };
    }
    try { const r = await request<any>('/api/transfer/plans', { method: 'POST', body: JSON.stringify({ faultId }) }); return r.data || r; }
    catch (e) { return handleApiError(e, { plans: [] }); }
  },
};

export const safetyApi = {
  check: async (planId: number) => {
    if (IS_DEMO) return { planId, connectivityCheck:'passed', loopRiskCheck:'passed', overloadCheck:'passed',
      voltageCheck:'passed', switchStateCheck:'passed', sequenceCheck:'passed', finalResult:'passed',
      suggestions: ['DEMO模式校验结果'] };
    try { const r = await request<any>('/api/safety/check', { method: 'POST', body: JSON.stringify({ planId }) }); return r.data || r; }
    catch (e) { return handleApiError(e, null); }
  },
};

// ==================== 实时数据 API ====================
export interface RealtimeNode {
  node: number;
  load_kw: number;
  voltage_pu: number;
  pv_kw: number;
  ev_kw: number;
  risk_level: string;
}

export interface RealtimeLine {
  line: string;
  current_a: number;
  power_kw: number;
  status: number;
}

export interface RealtimeLatest {
  success: boolean;
  has_data?: boolean;
  timestamp?: string;
  nodes?: RealtimeNode[];
  lines?: RealtimeLine[];
  switches?: Record<string, number>;
  message?: string;
  connected?: boolean;
  /** 数据来源标识：simulink | unverified_simulink | mock | test | manual | static | none */
  source_tag?: string;
  /** 是否通过 Simulink token 验证 */
  trusted_source?: boolean;
  /** 数据源模式 */
  source?: string;
}

export const realtimeApi = {
  /** 获取最新实时数据（节点、线路、开关），失败返回 null */
  getLatest: async (): Promise<RealtimeLatest | null> => {
    try {
      const r = await request<RealtimeLatest>('/api/realtime/latest');
      return r;
    } catch (e) {
      console.warn('获取实时数据失败，将使用 fallback:', e);
      return null;
    }
  },
};

export const ticketApi = {
  generate: async (planId: number, operator = '操作人', guardian = '监护人') => {
    if (IS_DEMO) return { ticketId: 0, ticketNo: `OP-DEMO-${Date.now()}`, taskName: 'DEMO模式操作票',
      steps: ['步骤1：确认故障','步骤2：隔离故障','步骤3：合联络开关','步骤4：恢复供电','步骤5：归档'],
      safetyNotes: ['操作前确认安全','操作后复核'], operator, guardian, checkResult:'passed' };
    try { const r = await request<any>('/api/ticket/generate', { method: 'POST', body: JSON.stringify({ planId, operator, guardian }) }); return r.data || r; }
    catch (e) { return handleApiError(e, null); }
  },
  list: async () => {
    if (IS_DEMO) return [];
    try { const r = await request<any>('/api/tickets'); return r.data || []; }
    catch (e) { return []; }
  },
  getDetail: async (ticketId: number) => {
    if (IS_DEMO) return null;
    try { const r = await request<any>(`/api/ticket/${ticketId}`); return r.data; }
    catch (e) { return null; }
  },
};
