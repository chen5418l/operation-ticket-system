"""转供方案生成服务"""
import json
from sqlalchemy.orm import Session
from app.models.topology import BusNode, TieSwitch
from app.models.fault import FaultRecord
from app.models.transfer import TransferPlan


def generate_transfer_plans(db: Session, fault_id: int) -> dict:
    """根据故障记录生成转供方案"""
    fault = db.query(FaultRecord).filter(FaultRecord.id == fault_id).first()
    if not fault:
        return {"error": "故障记录不存在"}

    affected = json.loads(fault.affected_nodes) if isinstance(fault.affected_nodes, str) else fault.affected_nodes
    available_ties = json.loads(fault.available_tie_switches) if isinstance(fault.available_tie_switches, str) else fault.available_tie_switches

    if not available_ties:
        return {"faultId": fault_id, "plans": [], "message": "无可用的联络开关"}

    plans = []
    for tie_id in available_ties:
        tie = db.query(TieSwitch).filter(TieSwitch.tie_id == tie_id).first()
        if not tie:
            continue

        # 计算可恢复的节点（联络开关失电侧的节点）
        # 简化规则：只恢复直接相连的后若干节点
        buses = {b.bus_no: b for b in db.query(BusNode).all()}
        restored = [n for n in affected if n in [tie.from_bus, tie.to_bus]]

        # 估算恢复负荷
        restored_p = sum(buses[n].load_p for n in restored if n in buses) if restored else fault.lost_load_p * 0.5
        restored_q = sum(buses[n].load_q for n in restored if n in buses) if restored else fault.lost_load_q * 0.5

        # 负载率估算
        max_rate = round(min((restored_p / (tie.capacity * 1000)) * 100 if tie.capacity > 0 else 80, 100), 1)
        min_v = round(0.95 - (max_rate - 50) * 0.001 if max_rate > 50 else 0.95, 3)

        # 风险判断
        if max_rate > 100:
            risk = "high"
            check = "failed"
        elif max_rate > 80:
            risk = "medium"
            check = "warning"
        else:
            risk = "low"
            check = "passed"

        plan = TransferPlan(
            fault_id=fault_id,
            plan_name=f"方案：闭合{tie.name}",
            close_tie_switch=tie_id,
            open_switches=json.dumps([]),
            restored_nodes=json.dumps(restored[:15]),
            restored_load_p=round(restored_p, 2),
            restored_load_q=round(restored_q, 2),
            max_load_rate=max_rate,
            min_voltage=min_v,
            risk_level=risk,
            check_result=check,
            is_recommended=False,
        )
        db.add(plan)
        plans.append(plan)

    # 标记推荐方案（风险最低的 pass 方案中恢复负荷最大者）
    passed = [p for p in plans if p.check_result == "passed"]
    candidates = passed if passed else plans
    if candidates:
        best = max(candidates, key=lambda p: p.restored_load_p)
        best.is_recommended = True

    db.commit()

    return {
        "faultId": fault_id,
        "plans": [
            {
                "id": p.id,
                "name": p.plan_name,
                "closeTieSwitch": p.close_tie_switch,
                "restoredNodes": json.loads(p.restored_nodes) if isinstance(p.restored_nodes, str) else p.restored_nodes,
                "restoredLoadP": p.restored_load_p,
                "restoredLoadQ": p.restored_load_q,
                "maxLoadRate": p.max_load_rate,
                "minVoltage": p.min_voltage,
                "riskLevel": p.risk_level,
                "checkResult": p.check_result,
                "recommended": p.is_recommended,
            }
            for p in plans
        ],
    }
