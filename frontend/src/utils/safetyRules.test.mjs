// 规则版安全校验测试（升级版）：8 项校验 + MATPOWER 外部评分可信性
import { runRuleChecks } from './safetyRules.compiled.mjs';

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  [PASS] ${name}${detail ? '  -- ' + detail : ''}`); }
  else { fail++; console.log(`  [FAIL] ${name}${detail ? '  -- ' + detail : ''}`); }
}

// ---- 真实链路数据：27-28 + T4 + 3 步序列 ----
const steps = [
  { step: 1, operation_type: 'verify_open', line: '27-28', action: '确认故障线路 27-28 已隔离（两侧开关处于断开位置）' },
  { step: 2, operation_type: 'close', line: '18-33', action: '合上联络开关 T4 (18-33)，恢复停电区域供电' },
  { step: 3, operation_type: 'check', action: '核查恢复节点电压和线路负载' },
];
const ticket = {
  ticket_id: 'OT20260717120000', fault_line: '27-28', plan_id: 'TP20260717115900',
  tie_lines: ['18-33'], operation_steps: steps, created_at: '2026/7/17 12:00:00', source: 'realtime_workflow',
};
const planLocal = {
  tie_name: 'T4', tie_switch: '18-33', is_usable: true, radial_ok: true, overloaded: false,
  min_restored_voltage_pu: 0.985, tie_loading_pct: 66.7, score_source: 'local_rule',
};
const planMatpower = {
  ...planLocal, score_source: 'external_matpower',
  power_flow: { converged: true, min_voltage_pu: 0.974, max_voltage_pu: 1.0, max_loading_pct: 85.6, loss_kw: 39.1 },
  violations: [],
};

console.log('== 场景1: 27-28 + T4 + 3步 (规则版评分) ==');
let r = runRuleChecks(ticket, steps, planLocal);
check('8 项校验', r.checks.length === 8, r.checks.map(c => c.id).join(','));
check('前 7 项通过, 第 8 项警告 (规则版评分)',
  r.checks.slice(0, 7).every(c => c.result === '通过') && r.checks[7].result === '警告');
check('status=passed_with_warnings', r.status === 'passed_with_warnings', r.status);
check('warnings 含规则版复核建议', r.warnings.includes('当前使用规则版评分，建议结合潮流结果人工复核'));
check('结果含 tie_lines + source=realtime_workflow',
  JSON.stringify(r.tie_lines) === '["18-33"]' && r.source === 'realtime_workflow');

console.log('== 场景2: MATPOWER 评分 + 潮流收敛 → 全通过 passed ==');
r = runRuleChecks(ticket, steps, planMatpower);
check('8 项全通过', r.checks.every(c => c.result === '通过'), r.checks.map(c => `${c.id}:${c.result}`).join(','));
check('status=passed (无警告)', r.status === 'passed' && r.warnings.length === 0, r.status);
check('第8项详情含 MATPOWER 与潮流数据', r.checks[7].detail.includes('已采用 MATPOWER 外部评分') && r.checks[7].detail.includes('0.974'));

console.log('== 场景3: MATPOWER 潮流不收敛 → failed ==');
r = runRuleChecks(ticket, steps, { ...planMatpower, power_flow: { ...planMatpower.power_flow, converged: false } });
check('外部评分可信性不通过', r.checks.find(c => c.id === 'ext_score')?.result === '不通过');
check('status=failed', r.status === 'failed');

console.log('== 场景4: 严重违例 (severity=critical) → failed ==');
r = runRuleChecks(ticket, steps, { ...planMatpower, violations: [{ type: 'voltage_violation', severity: 'critical', detail: 'Bus 31 电压 0.91pu' }] });
check('可用性不通过并列出违例', r.checks.find(c => c.id === 'usability')?.result === '不通过',
  r.checks.find(c => c.id === 'usability')?.detail);
check('status=failed', r.status === 'failed');

console.log('== 场景5: 轻微违例 (severity=low) → 不影响可用性 ==');
r = runRuleChecks(ticket, steps, { ...planMatpower, violations: [{ type: 'minor', severity: 'low' }] });
check('可用性仍通过', r.checks.find(c => c.id === 'usability')?.result === '通过');

console.log('== 场景6: loading_pct 字段兼容 (loading_pct=89.6) ==');
r = runRuleChecks(ticket, steps, { ...planLocal, tie_loading_pct: null, loading_pct: 89.6 });
check('loading_pct<=100 通过', r.checks.find(c => c.id === 'loading')?.result === '通过',
  r.checks.find(c => c.id === 'loading')?.detail);
r = runRuleChecks(ticket, steps, { ...planLocal, tie_loading_pct: null, loading_pct: 160 });
check('loading_pct=160 不通过', r.checks.find(c => c.id === 'loading')?.result === '不通过');

console.log('== 场景7: 电压/负载缺失 → 双警告不判死 ==');
r = runRuleChecks(ticket, steps, { ...planLocal, min_restored_voltage_pu: null, tie_loading_pct: null });
check('电压+负载+评分 3 警告, status=passed_with_warnings',
  r.status === 'passed_with_warnings' && r.warnings.length === 3, r.warnings.join(' | '));

console.log('== 场景8: min_voltage_pu 字段兼容 (0.93 → 不通过) ==');
r = runRuleChecks(ticket, steps, { ...planLocal, min_restored_voltage_pu: undefined, min_voltage_pu: 0.93 });
check('min_voltage_pu<0.95 不通过', r.checks.find(c => c.id === 'voltage')?.result === '不通过');

console.log('== 场景9: 缺票字段/缺合闸/顺序错 (回归) ==');
r = runRuleChecks({ ticket_id: 'X', fault_line: '27-28' }, steps, planLocal);
check('完整性不通过', r.checks.find(c => c.id === 'integrity')?.result === '不通过');
r = runRuleChecks(ticket, [steps[0], steps[2]], planLocal);
check('缺合闸不通过', r.checks.find(c => c.id === 'tie_close')?.result === '不通过');
r = runRuleChecks(ticket, [steps[1], steps[0], steps[2]], planLocal);
check('顺序颠倒不通过', r.checks.find(c => c.id === 'order')?.result === '不通过');
r = runRuleChecks({ ...ticket, tie_lines: ['33-18'] }, steps, planLocal);
check('反序联络线键归一化匹配', r.checks.find(c => c.id === 'tie_close')?.result === '通过');

console.log(`\n===== 结果: ${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail ? 1 : 0);
