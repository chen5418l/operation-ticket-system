/**
 * Flask 外部数据服务 API 客户端
 * 通过 Vite proxy (/api/flask) 转发到 http://127.0.0.1:5000
 */

const FLASK_BASE = '/api/flask';

// ——— 安全格式化 ——
export function fmt(value: unknown, digits = 2): string {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : '--';
}

// ——— 节点详情 ———
export interface FlaskNodeDetail {
  Bus?: number;
  node?: number;
  P_Load_Total_kW?: number;
  P_Net_kW?: number;
  P_PV_kW?: number;
  P?: number;
  Q_detail_kVar?: number;
  Q_Load_Total_kVar?: number;
  Q_Net_kVar?: number;
  Q?: number;
}

// ——— 故障分析结果 ———
export interface FlaskFaultResult {
  fault?: string;
  time?: string;
  affected_nodes?: number[];
  affected_count?: number;
  outage_nodes?: number[];
  powered_nodes?: number[];
  reachable_nodes?: number[];
  reachable_count?: number;
  total_P_Load_Total_kW?: number;
  total_P_PV_kW?: number;
  total_P_Net_kW?: number;
  total_Q_Load_Total_kVar?: number;
  total_Q_Net_kVar?: number;
  affected_node_details?: FlaskNodeDetail[];
  p_main_column?: string;
  q_main_column?: string;
}

// ——— 从节点详情中安全提取字段 ———
export function nodeBus(d: FlaskNodeDetail): number { return d.Bus ?? d.node ?? 0; }
export function nodeP(d: FlaskNodeDetail): number { return d.P_Net_kW ?? d.P_Load_Total_kW ?? d.P ?? 0; }
export function nodePV(d: FlaskNodeDetail): number { return d.P_PV_kW ?? 0; }
export function nodeQ(d: FlaskNodeDetail): number { return d.Q_Net_kVar ?? d.Q_detail_kVar ?? d.Q_Load_Total_kVar ?? d.Q ?? 0; }

// ——— API 调用 ———
export async function fetchFaultAnalysis(time: string, fault: string): Promise<FlaskFaultResult> {
  const url = `${FLASK_BASE}/api/fault_analysis?time=${encodeURIComponent(time)}&fault=${encodeURIComponent(fault)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  console.log('fault_analysis result:', data);
  return data;
}

// ——— 负荷预测 ———
export interface PredictNode {
  Bus: number;
  P_Load_Total_kW?: number;
  P_PV_kW?: number;
  P_Net_kW?: number;
  Voltage_pu?: number;
  risk_level?: string;
  risk_text?: string;
  risk_color?: string;
}

export interface PredictResult {
  success?: boolean;
  base_hour?: number;
  horizon?: number;
  target_time_hours?: number;
  matched_time_hours?: number;
  target_time_label?: string;
  nodes?: PredictNode[];
  total?: { total_P_Net_kW?: number; total_loss_MW?: number };
}

export async function fetchPredictLoad(horizon: number, baseHour: number): Promise<PredictResult> {
  const url = `${FLASK_BASE}/api/predict_load?horizon=${horizon}&base_hour=${baseHour}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  console.log('predict_load result:', data);
  return data;
}

export async function pingFlask(): Promise<boolean> {
  try {
    const res = await fetch(`${FLASK_BASE}/api/fault_analysis?time=00:10&fault=8-9`, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch { return false; }
}
