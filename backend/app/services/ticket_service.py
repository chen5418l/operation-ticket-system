"""操作票生成服务"""
import json
from datetime import datetime
from sqlalchemy.orm import Session
from app.models.fault import FaultRecord
from app.models.transfer import TransferPlan
from app.models.ticket import OperationTicket


def generate_ticket(db: Session, plan_id: int, operator: str = "操作人", guardian: str = "监护人") -> dict:
    """根据转供方案生成操作票"""
    plan = db.query(TransferPlan).filter(TransferPlan.id == plan_id).first()
    if not plan:
        return {"error": "转供方案不存在"}

    fault = db.query(FaultRecord).filter(FaultRecord.id == plan.fault_id).first()
    if not fault:
        return {"error": "关联故障记录不存在"}

    # 生成票号
    now = datetime.now()
    ticket_no = f"OP-{now.strftime('%Y%m%d')}-{now.strftime('%H%M%S')}"

    # 任务名称
    task_name = f"{fault.fault_line_id}故障隔离及{plan.close_tie_switch}联络转供操作"

    # 操作步骤
    steps = [
        f"确认{fault.fault_line_id}线路故障，核实保护动作信号",
        f"拉开Bus{fault.from_bus}侧隔离开关",
        f"拉开Bus{fault.to_bus}侧隔离开关",
        "确认故障区段已隔离，两侧有明显断开点",
        f"合上{plan.close_tie_switch}联络开关",
        "检查相关节点供电恢复情况",
        "复核电压、电流和负载率在允许范围内",
        "确认无异常信号，完成操作并归档",
    ]

    # 安全注意事项
    safety_notes = [
        "操作前确认无人员在故障线路作业",
        f"合上{plan.close_tie_switch}联络开关前必须确认故障区段已隔离",
        "转供后检查馈线负载率不得超过限值",
        "操作全过程应由监护人复核",
        "如发现异常，立即停止操作并汇报调度",
    ]

    ticket = OperationTicket(
        ticket_no=ticket_no,
        fault_id=plan.fault_id,
        plan_id=plan_id,
        task_name=task_name,
        operation_steps=json.dumps(steps),
        safety_notes=json.dumps(safety_notes),
        operator=operator,
        guardian=guardian,
        check_result=plan.check_result,
        status="generated",
    )
    db.add(ticket)
    db.commit()
    db.refresh(ticket)

    return {
        "ticketId": ticket.id,
        "ticketNo": ticket.ticket_no,
        "taskName": ticket.task_name,
        "steps": json.loads(ticket.operation_steps) if isinstance(ticket.operation_steps, str) else ticket.operation_steps,
        "safetyNotes": json.loads(ticket.safety_notes) if isinstance(ticket.safety_notes, str) else ticket.safety_notes,
        "operator": ticket.operator,
        "guardian": ticket.guardian,
        "checkResult": ticket.check_result,
        "status": ticket.status,
    }
