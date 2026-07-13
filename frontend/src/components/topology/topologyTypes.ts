/** IEEE33 拓扑类型定义 */

export interface BusNode {
  id: string;
  num: number;
  label: string;
  name: string;
  x: number;
  y: number;
  loadMw: number;
  loadKvar: number;
  voltagePu: number;
  status: 'normal' | 'fault' | 'outage' | 'restored';
  feeder: '主馈线' | '分支1' | '分支2' | '分支3';
  parent?: string;
  children?: string[];
}

export interface BranchLine {
  id: string;
  from: string;
  to: string;
  fromNum: number;
  toNum: number;
  name: string;
  lineType: 'main' | 'branch' | 'tie';
  resistance: number;
  reactance: number;
  loadRate: number;
  status: 'normal' | 'fault' | 'open' | 'overload';
  switchType?: 'breaker' | 'sectionSwitch' | 'none';
  switchStatus?: 'closed' | 'open';
}

export interface TieSwitchData {
  id: string;
  name: string;
  fromBus: string;
  toBus: string;
  fromNum: number;
  toNum: number;
  status: 'open' | 'closed';
  transferCapacityMw: number;
  estimatedLoadRate: number;
  minVoltagePu: number;
  safetyCheck: { result: 'pass' | 'warn' | 'block'; reason: string };
  fromX: number; fromY: number;
  toX: number; toY: number;
}

export interface FaultScenario {
  id: string;
  label: string;
  lineId: string;
  faultSection: string;
  lostBuses: number[];
  availableTies: string[];
  description: string;
}

export interface TransferOption {
  tie: TieSwitchData;
  score: number;
  restoredNodes: number[];
  restoredLoadMw: number;
  riskLevel: string;
}
