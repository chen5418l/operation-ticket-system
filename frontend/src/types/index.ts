/* 全局类型定义 */

// ============ 仪表盘 ============
export interface DashboardSummary {
  totalEvents: number;
  totalTickets: number;
  safetyPassRate: number;
  manualInterventionRate: number;
}

// ============ 数据管理 ============
export interface DataObject {
  id: string;
  objectName: string;
  maintenanceRule: string;
  status: '已同步' | '待更新' | '异常';
}

export interface RuleTemplate {
  id: string;
  name: string;
  purpose: string;
  version: string;
}

// ============ 源荷预测 ============
export interface RiskItem {
  feederId: string;
  feederName: string;
  currentLoad: number;
  forecastLoad: number;
  loadRate: number;
  riskLevel: '高' | '中' | '低';
  riskReason: string;
  confidence: number;
  forecastWindow: string;
}

// ============ 边界判定 ============
export interface BoundaryResult {
  scenarioId: string;
  faultSection: string;
  faultDevice: string;
  tripBreaker: string;
  isolationSwitches: string[];
  backupTripDevices: string[];
  isolationBoundary: string;
  lostLoad: number;
  reversePowerRisk: boolean;
  checkItems: string[];
}

// ============ 转供决策 ============
export interface TransferPlan {
  planId: string;
  scenarioId: string;
  candidatePaths: string[];
  recommendedPath: string;
  targetFeeder: string;
  tieSwitch: string;
  transferLoad: number;
  loadRateAfter: number;
  voltageRange: string;
  N1Result: '通过' | '警告' | '阻断';
  FAResult: '一致' | '冲突' | '未配置';
  riskTags: string[];
  score: number;
  operationOrder: string[];
}

// ============ 操作序列 ============
export interface OperationStep {
  stepNo: number;
  stage: string;
  deviceId: string;
  deviceName: string;
  action: string;
  preState: string;
  postState: string;
  ruleTags: string[];
  checkItems: string[];
  manualConfirm: boolean;
}

// ============ 操作票 ============
export interface TicketInfo {
  ticketId: string;
  title: string;
  createTime: string;
  preMode: string;
  targetMode: string;
  reviewer: string;
  status: '草稿' | '已校核' | '已审核' | '已归档';
  version: string;
}

export interface TicketStep {
  seqNo: number;
  stage: string;
  operation: string;
  device: string;
  content: string;
  safetyNote: string;
}

export interface Ticket {
  info: TicketInfo;
  steps: TicketStep[];
}

// ============ 安全校核 ============
export interface SafetyCheckItem {
  checkId: string;
  ticketId: string;
  checkType: string;
  result: '通过' | '警告' | '阻断';
  riskReason: string;
  suggestion: string;
  confirmer: string;
  checkTime: string;
}

// ============ 审核统计 ============
export interface TestStatistics {
  totalTickets: number;
  autoCheckPassRate: number;
  oneTimePassRate: number;
  manualModifyRate: number;
  tickets: TicketInfo[];
  checkResults: SafetyCheckItem[];
  modifyRecords: ModifyRecord[];
}

export interface ModifyRecord {
  ticketId: string;
  stepNo: number;
  field: string;
  originalValue: string;
  newValue: string;
  modifier: string;
  modifyTime: string;
  reason: string;
}

// ============ 通用 ============
export interface ApiResponse<T> {
  code: number;
  message: string;
  data: T;
}
