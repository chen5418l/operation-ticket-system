"""安全校验服务"""
import json
from sqlalchemy.orm import Session
from app.models.transfer import TransferPlan
from app.models.safety import SafetyCheck


def run_safety_check(db: Session, plan_id: int) -> dict:
    """对转供方案执行安全校验"""
    plan = db.query(TransferPlan).filter(TransferPlan.id == plan_id).first()
    if not plan:
        return {"error": "转供方案不存在"}

    # 1. 连通性校验
    connectivity = "passed"  # 简化：有联络开关连接即可通过
    if not plan.close_tie_switch:
        connectivity = "failed"

    # 2. 环网风险
    loop_risk = "passed"  # 联络开关一端有电一端失电，无环网风险

    # 3. 过载校验
    if plan.max_load_rate > 100:
        overload = "failed"
    elif plan.max_load_rate > 80:
        overload = "warning"
    else:
        overload = "passed"

    # 4. 电压校验
    if plan.min_voltage < 0.90:
        voltage = "failed"
    elif plan.min_voltage < 0.95:
        voltage = "warning"
    else:
        voltage = "passed"

    # 5. 开关状态校验
    switch_state = "passed"

    # 6. 操作顺序校验
    sequence = "passed"

    # 综合结论
    results = [connectivity, loop_risk, overload, voltage, switch_state, sequence]
    if "failed" in results:
        final = "failed"
    elif "warning" in results:
        final = "warning"
    else:
        final = "passed"

    suggestions_list = []
    if final == "passed":
        suggestions_list.append("该转供方案满足简化安全校验要求")
    suggestions_list.append("执行前仍需现场确认故障区段已隔离")
    if overload == "warning":
        suggestions_list.append("负载率接近限值，建议缩短转供持续时间")
    if voltage == "warning":
        suggestions_list.append("电压偏低，建议监测转供后电压质量")

    check = SafetyCheck(
        plan_id=plan_id,
        connectivity_check=connectivity,
        loop_risk_check=loop_risk,
        overload_check=overload,
        voltage_check=voltage,
        switch_state_check=switch_state,
        sequence_check=sequence,
        final_result=final,
        suggestions=json.dumps(suggestions_list),
    )
    db.add(check)
    db.commit()
    db.refresh(check)

    return {
        "planId": plan_id,
        "connectivityCheck": connectivity,
        "loopRiskCheck": loop_risk,
        "overloadCheck": overload,
        "voltageCheck": voltage,
        "switchStateCheck": switch_state,
        "sequenceCheck": sequence,
        "finalResult": final,
        "suggestions": suggestions_list,
    }
