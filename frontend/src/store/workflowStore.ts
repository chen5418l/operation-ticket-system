/**
 * 全局流程状态管理 — currentWorkflow 作为唯一数据源
 *
 * 页面间数据流（单向）：
 *   TransferDecision → selected_plan
 *   SequenceGeneration → operation_sequence
 *   TicketGeneration → ticket
 *   SafetyCheck → safety_result
 *
 * 禁止：
 * - 直接从 localStorage 读 current_ticket / current_operation_steps / current_selected_plan
 * - 用旧票 OTxxx 冒充当前票
 * - 默认使用 T4 方案
 */

// ==================== CurrentWorkflow 完整结构 ====================
export interface CurrentWorkflow {
  workflow_id: string;
  fault_line: string;
  boundary_result?: any;
  transfer_result?: any;
  transfer_status?: string;       // 'external_pending' | 'completed' | 'local_fallback'
  job_id?: string;
  selected_plan_id?: string;      // 已确认方案编号：外部候选 ALG-001/ALG-002/ALG-003，或本地方案 tie_switch 如 9-15
  selected_plan?: any;            // 完整的 TransferPlanItem
  selected_tie_ids?: string[];    // ['T2'] 或 ['T5']
  selected_tie_lines?: string[];  // ['9-15'] 或 ['25-29']
  operation_sequence?: any[];     // OperationStep[]
  sequence_result?: any;          // 序列生成 API 返回的 plan_id / tie_lines
  ticket?: any;                   // RealtimeTicket
  safety_result?: any;            // SafetyCheckResult
  updated_at: string;
}

// 向后兼容的旧接口（逐步废弃）
export interface WorkflowState {
  scenarioId?: string;
  faultInput?: { faultDevice?: string; faultSection?: string; faultFeeder?: string; scenarioType?: string; };
  boundaryResult?: any;
  transferPlan?: any;
  operationSequence?: any[];
  ticket?: any;
  safetyCheckResult?: any[];
}

const WF_KEY = 'currentWorkflow';
const LEGACY_KEY = 'workflow_state';

// ==================== 工厂函数 ====================
function makeWorkflowId(): string {
  const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  return `WF${ts}`;
}

// ==================== currentWorkflow CRUD ====================
export function getCurrentWorkflow(): CurrentWorkflow | null {
  try {
    const raw = localStorage.getItem(WF_KEY);
    return raw ? JSON.parse(raw) as CurrentWorkflow : null;
  } catch {
    return null;
  }
}

export function saveCurrentWorkflow(partial: Partial<CurrentWorkflow>): CurrentWorkflow {
  const current = getCurrentWorkflow();
  const next: CurrentWorkflow = current
    ? { ...current, ...partial, updated_at: new Date().toISOString() }
    : {
        workflow_id: makeWorkflowId(),
        fault_line: partial.fault_line || '',
        updated_at: new Date().toISOString(),
        ...partial,
      };
  try {
    localStorage.setItem(WF_KEY, JSON.stringify(next));
  } catch { /* localStorage 满 */ }
  // 同步写入旧 workflow_state 以保持流程进度条兼容
  syncToLegacy(next);
  return next;
}

export function clearCurrentWorkflow(): void {
  try {
    localStorage.removeItem(WF_KEY);
    localStorage.removeItem(LEGACY_KEY);
  } catch { /* ignore */ }
}

// ==================== 向后兼容桥接 ====================
/** 将 currentWorkflow 的字段映射回 workflow_state，保证 WorkflowProgress 正常工作 */
function syncToLegacy(wf: CurrentWorkflow): void {
  try {
    const legacy: WorkflowState = {};
    if (wf.boundary_result) legacy.boundaryResult = wf.boundary_result;
    if (wf.selected_plan) legacy.transferPlan = wf.selected_plan;
    if (wf.operation_sequence) legacy.operationSequence = wf.operation_sequence;
    if (wf.ticket) legacy.ticket = wf.ticket;
    if (wf.safety_result?.checks) legacy.safetyCheckResult = wf.safety_result.checks;
    localStorage.setItem(LEGACY_KEY, JSON.stringify(legacy));
  } catch { /* ignore */ }
}

/** 初始化：尝试从旧 workflow_state 迁移到 currentWorkflow（仅当 currentWorkflow 不存在时） */
export function migrateFromLegacy(): CurrentWorkflow | null {
  if (getCurrentWorkflow()) return getCurrentWorkflow();
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    if (!raw) return null;
    const old: WorkflowState = JSON.parse(raw);
    // 只迁移有 transferPlan 且非空壳的旧数据
    if (!old.transferPlan || !old.transferPlan.fault_line) return null;
    const wf = saveCurrentWorkflow({
      fault_line: old.transferPlan.fault_line || '',
      selected_plan: old.transferPlan,
      selected_plan_id: old.transferPlan.plan_id || old.transferPlan.tie_switch || '',
      selected_tie_ids: old.transferPlan.tie_name ? [old.transferPlan.tie_name] : [],
      selected_tie_lines: old.transferPlan.tie_lines || [],
      operation_sequence: old.operationSequence,
      ticket: old.ticket,
      boundary_result: old.boundaryResult,
    });
    return wf;
  } catch {
    return null;
  }
}

// ==================== 旧接口（保留兼容，标记 deprecated） ====================
/** @deprecated 使用 getCurrentWorkflow() 代替 */
export function getWorkflowState(): WorkflowState {
  try {
    const raw = localStorage.getItem(LEGACY_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/** @deprecated 使用 saveCurrentWorkflow() 代替 */
export function saveWorkflowState(partial: Partial<WorkflowState>): WorkflowState {
  const current = getWorkflowState();
  const next = { ...current, ...partial };
  try { localStorage.setItem(LEGACY_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  return next;
}

/** @deprecated 使用 clearCurrentWorkflow() 代替 */
export function clearWorkflowState(): void {
  clearCurrentWorkflow();
}

/** 根据 state 判断当前流程步骤索引 (0-based) */
export function getCurrentStepIndex(): number {
  // 步骤索引：0=故障输入, 1=边界判定, 2=转供决策, 3=操作序列, 4=安全校验, 5=模板成票, 6=归档
  const wf = getCurrentWorkflow();
  if (!wf || !wf.fault_line) return 0;           // 待故障输入
  if (!wf.selected_plan) return 1;               // 待转供决策（边界判定后）
  if (!wf.operation_sequence) return 2;           // 待操作序列
  if (!wf.safety_result) return 3;               // 待安全校验
  if (!wf.ticket) return 4;                      // 待模板成票
  return 5;                                       // 全部完成（归档）
}
