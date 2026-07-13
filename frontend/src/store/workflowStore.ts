/**
 * 全局流程状态管理 — localStorage 持久化
 * 用于页面间传递边界判定→转供决策→操作序列→成票→校核的数据
 */

export interface WorkflowState {
  scenarioId?: string;
  faultInput?: {
    faultDevice?: string;
    faultSection?: string;
    faultFeeder?: string;
    scenarioType?: string;
  };
  boundaryResult?: any;
  transferPlan?: any;
  operationSequence?: any[];
  ticket?: any;
  safetyCheckResult?: any[];
}

const STORAGE_KEY = 'workflow_state';

function load(): WorkflowState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function save(state: WorkflowState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage 满或不可用
  }
}

export function getWorkflowState(): WorkflowState {
  return load();
}

export function saveWorkflowState(partial: Partial<WorkflowState>): WorkflowState {
  const current = load();
  const next = { ...current, ...partial };
  save(next);
  return next;
}

export function clearWorkflowState(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/** 根据 state 判断当前流程步骤索引 (0-based) */
export function getCurrentStepIndex(state: WorkflowState): number {
  if (!state.boundaryResult) return 1;       // 故障输入已完成，待边界判定
  if (!state.transferPlan) return 2;          // 边界判定已完成，待转供决策
  if (!state.operationSequence) return 3;     // 转供决策已完成，待操作序列
  if (!state.ticket) return 4;                // 操作序列已完成，待模板成票
  if (!state.safetyCheckResult) return 5;     // 成票已完成，待安全校验
  return 6;                                    // 全部完成，待导出归档
}
