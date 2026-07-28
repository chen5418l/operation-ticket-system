/**
 * 规则版操作票安全校验 — 纯函数模块（无 UI 依赖，可独立测试）
 * 输入：current_ticket / current_operation_steps / current_selected_plan
 */

export interface ApiOperationStep { step: number; action: string; operation_type: string; line?: string; description?: string; actionRaw?: string; }
export interface CheckItem { id: string; item: string; result: '通过' | '不通过' | '警告'; level: 'error' | 'warning'; detail: string; }
export interface SafetyCheckResult {
  success: boolean; passed: boolean; status: 'passed' | 'passed_with_warnings' | 'failed';
  ticket_id: string; fault_line: string; plan_id: string; tie_lines: string[];
  checks: CheckItem[]; warnings: string[]; created_at: string;
  source: 'realtime_workflow';
}

export function normLineKey(ln: string): string {
  const p = String(ln).split('-');
  if (p.length !== 2) return String(ln);
  const a = parseInt(p[0]), b = parseInt(p[1]);
  return isNaN(a) || isNaN(b) ? String(ln) : a < b ? `${a}-${b}` : `${b}-${a}`;
}

/** 从 currentWorkflow 直接读取数据进行校验（不依赖正式票，安全校验在成票之前） */
export function runSafetyChecks(params: {
  workflow_id?: string; fault_line: string; plan_id: string;
  tie_lines: string[]; operation_steps: ApiOperationStep[]; selected_plan: any;
}): SafetyCheckResult {
  const { workflow_id, fault_line, plan_id, tie_lines, operation_steps: steps, selected_plan: plan } = params;
  const wfId = workflow_id || `WF${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}`;
  return runRuleChecks({
    ticket_id: wfId,
    fault_line,
    plan_id,
    tie_lines: tie_lines || [],
    operation_steps: steps,
    created_at: new Date().toLocaleString('zh-CN'),
    source: 'realtime_workflow',
  }, steps, plan);
}

export function runRuleChecks(ticket: any, steps: ApiOperationStep[], plan: any): SafetyCheckResult {
  const checks: CheckItem[] = [];
  const warnings: string[] = [];

  // 1. 操作票完整性
  const required = ['ticket_id', 'fault_line', 'plan_id', 'tie_lines', 'operation_steps', 'created_at', 'source'];
  const missing = required.filter(k => ticket?.[k] == null || (Array.isArray(ticket[k]) && ticket[k].length === 0 && k !== 'tie_lines'));
  checks.push(missing.length === 0
    ? { id: 'integrity', item: '操作票完整性', result: '通过', level: 'error', detail: `包含全部必要字段（${required.join('、')}）` }
    : { id: 'integrity', item: '操作票完整性', result: '不通过', level: 'error', detail: `缺少字段: ${missing.join('、')}` });

  // 2. 故障隔离确认（operation_type=verify_open，或 action/description 含关键词）
  const isoSteps = steps.filter(s => s.operation_type === 'verify_open'
    || (s.action || '').includes('确认故障线路') || (s.action || '').includes('已隔离')
    || (s.description || '').includes('确认故障线路') || (s.description || '').includes('已隔离'));
  checks.push(isoSteps.length > 0
    ? { id: 'isolation', item: '故障隔离确认', result: '通过', level: 'error', detail: `第 ${isoSteps.map(s => s.step).join('、')} 步确认故障线路 ${ticket?.fault_line || ''} 已隔离` }
    : { id: 'isolation', item: '故障隔离确认', result: '不通过', level: 'error', detail: '操作序列中缺少故障隔离确认步骤（verify_open）' });

  // 3. 联络开关闭合操作（逐条联络线核对，线路键归一化比较）
  const tieLines: string[] = Array.isArray(ticket?.tie_lines) ? ticket.tie_lines : [];
  const closeSteps = steps.filter(s => s.operation_type === 'close');
  if (tieLines.length === 0) {
    checks.push({ id: 'tie_close', item: '联络开关闭合操作', result: '不通过', level: 'error', detail: '操作票中无联络线信息' });
  } else {
    const missingTies = tieLines.filter(t => !closeSteps.some(s => normLineKey(s.line || '') === normLineKey(t)));
    checks.push(missingTies.length === 0
      ? { id: 'tie_close', item: '联络开关闭合操作', result: '通过', level: 'error', detail: `联络线 ${tieLines.join('、')} 均有对应合闸步骤` }
      : { id: 'tie_close', item: '联络开关闭合操作', result: '不通过', level: 'error', detail: `联络线 ${missingTies.join('、')} 缺少对应的合闸（close）步骤` });
  }

  // 4. 操作顺序：verify_open 早于 close；close 早于 check
  const idxOf = (t: string, last = false) => {
    const arr = steps.map((s, i) => ({ s, i })).filter(x => x.s.operation_type === t);
    if (!arr.length) return -1;
    return last ? arr[arr.length - 1].i : arr[0].i;
  };
  const lastVerify = idxOf('verify_open', true);
  const firstClose = idxOf('close');
  const lastClose = idxOf('close', true);
  const firstCheck = idxOf('check');
  let orderOk = true; const orderProblems: string[] = [];
  if (lastVerify >= 0 && firstClose >= 0 && lastVerify > firstClose) { orderOk = false; orderProblems.push('存在合闸操作先于故障隔离确认'); }
  if (lastClose >= 0 && firstCheck >= 0 && lastClose > firstCheck) { orderOk = false; orderProblems.push('存在核查步骤先于合闸操作'); }
  if (firstClose >= 0 && firstCheck < 0) { orderOk = false; orderProblems.push('合闸后缺少核查步骤'); }
  checks.push(orderOk
    ? { id: 'order', item: '操作顺序校验', result: '通过', level: 'error', detail: '隔离确认 → 合闸 → 核查 顺序正确' }
    : { id: 'order', item: '操作顺序校验', result: '不通过', level: 'error', detail: orderProblems.join('；') });

  // 5. 方案可用性（含严重约束违例判定）
  if (!plan) {
    warnings.push('缺少转供方案信息，需人工复核');
    checks.push({ id: 'usability', item: '转供方案可用性', result: '警告', level: 'warning', detail: '未读取到 current_selected_plan，需人工复核' });
  } else {
    const problems: string[] = [];
    if (plan.is_usable === false) problems.push('is_usable=false');
    if (plan.radial_ok === false) problems.push('radial_ok=false（可能成环）');
    if (plan.overloaded === true) problems.push('overloaded=true（过载）');
    const severeViolations = Array.isArray(plan.violations)
      ? plan.violations.filter((v: any) => v && typeof v === 'object'
          && ['critical', 'severe', 'high'].includes(String(v.severity || '').toLowerCase()))
      : [];
    if (severeViolations.length > 0) {
      problems.push(`存在严重约束违例 ${severeViolations.length} 项: ${severeViolations.map((v: any) => v.type || v.item || '违例').join('、')}`);
    }
    checks.push(problems.length === 0
      ? { id: 'usability', item: '转供方案可用性', result: '通过', level: 'error', detail: `方案 ${plan.tie_name || plan.tie_switch || ''} 辐射状运行、无过载、无严重违例` }
      : { id: 'usability', item: '转供方案可用性', result: '不通过', level: 'error', detail: problems.join('；') });
  }

  // 6. 电压校验（兼容 min_voltage_pu / min_restored_voltage_pu；缺失 → 人工复核）
  const minV = plan?.min_voltage_pu ?? plan?.min_restored_voltage_pu;
  if (minV != null) {
    checks.push(minV >= 0.95
      ? { id: 'voltage', item: '电压校验', result: '通过', level: 'error', detail: `恢复区最低电压 ${Number(minV).toFixed(4)} pu ≥ 0.95 pu` }
      : { id: 'voltage', item: '电压校验', result: '不通过', level: 'error', detail: `恢复区最低电压 ${Number(minV).toFixed(4)} pu < 0.95 pu` });
  } else {
    warnings.push('缺少转供后电压结果，需人工复核');
    checks.push({ id: 'voltage', item: '电压校验', result: '警告', level: 'warning', detail: '缺少转供后电压结果，需人工复核' });
  }

  // 7. 负载率/潮流校验（兼容 loading_rate / loading_pct / tie_loading_pct；null → 不判失败，人工复核）
  let loadingRate: number | null = null;
  if (plan?.loading_rate != null) loadingRate = plan.loading_rate;
  else if (plan?.loading_pct != null) loadingRate = plan.loading_pct / 100;
  else if (plan?.tie_loading_pct != null) loadingRate = plan.tie_loading_pct / 100;
  if (loadingRate != null) {
    checks.push(loadingRate <= 1.0
      ? { id: 'loading', item: '负载率/潮流校验', result: '通过', level: 'error', detail: `联络线负载率 ${(loadingRate * 100).toFixed(1)}% ≤ 100%` }
      : { id: 'loading', item: '负载率/潮流校验', result: '不通过', level: 'error', detail: `联络线负载率 ${(loadingRate * 100).toFixed(1)}% > 100%，存在过载风险` });
  } else {
    warnings.push('负载率待潮流校验，需人工复核');
    checks.push({ id: 'loading', item: '负载率/潮流校验', result: '警告', level: 'warning', detail: '负载率待潮流校验，需人工复核' });
  }

  // 8. 外部评分可信性
  const pf = plan?.power_flow || null;
  if (plan?.score_source === 'external_matpower') {
    if (pf && pf.converged === false) {
      checks.push({ id: 'ext_score', item: '外部评分可信性', result: '不通过', level: 'error', detail: 'MATPOWER潮流不收敛，方案不可执行' });
    } else {
      const pfInfo = pf
        ? `（潮流收敛${pf.min_voltage_pu != null ? `，最低电压 ${pf.min_voltage_pu} pu` : ''}${pf.max_loading_pct != null ? `，最大负载率 ${pf.max_loading_pct}%` : ''}${pf.loss_kw != null ? `，网损 ${pf.loss_kw} kW` : ''}）`
        : '';
      checks.push({ id: 'ext_score', item: '外部评分可信性', result: '通过', level: 'error', detail: `已采用 MATPOWER 外部评分${pfInfo}` });
    }
  } else if (plan) {
    warnings.push('当前使用规则版评分，建议结合潮流结果人工复核');
    checks.push({ id: 'ext_score', item: '外部评分可信性', result: '警告', level: 'warning', detail: '当前使用规则版评分，建议结合潮流结果人工复核' });
  } else {
    checks.push({ id: 'ext_score', item: '外部评分可信性', result: '警告', level: 'warning', detail: '无方案评分信息，需人工复核' });
  }

  const hasFailed = checks.some(c => c.result === '不通过');
  const status: SafetyCheckResult['status'] = hasFailed ? 'failed' : warnings.length > 0 ? 'passed_with_warnings' : 'passed';
  return {
    success: true,
    passed: !hasFailed,
    status,
    ticket_id: ticket?.ticket_id || '-',
    fault_line: ticket?.fault_line || '-',
    plan_id: ticket?.plan_id || '-',
    tie_lines: Array.isArray(ticket?.tie_lines) ? ticket.tie_lines : [],
    checks, warnings,
    created_at: new Date().toLocaleString('zh-CN'),
    source: 'realtime_workflow',
  };
}
