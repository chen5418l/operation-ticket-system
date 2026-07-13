"""
故障分析服务 — 基于 BFS 的失电区域计算
"""
import json
from collections import deque
from sqlalchemy.orm import Session
from app.models.topology import BusNode, Branch, TieSwitch
from app.models.fault import FaultRecord


def _build_adjacency(db: Session, exclude_branch_id: str | None = None):
    """构建当前闭合线路的邻接表（排除故障线路）"""
    adj: dict[int, list[int]] = {}
    buses = db.query(BusNode).all()
    for b in buses:
        adj[b.bus_no] = []

    branches = db.query(Branch).filter(
        Branch.switch_state == "closed",
        Branch.status != "fault",
    ).all()
    for br in branches:
        if br.line_id == exclude_branch_id:
            continue
        adj[br.from_bus].append(br.to_bus)
        adj[br.to_bus].append(br.from_bus)

    return adj


def _bfs_energized(adj: dict[int, list[int]], source: int = 1) -> set[int]:
    """从电源点 BFS，返回所有能访问的节点"""
    visited: set[int] = set()
    q = deque([source])
    while q:
        u = q.popleft()
        if u in visited:
            continue
        visited.add(u)
        for v in adj.get(u, []):
            if v not in visited:
                q.append(v)
    return visited


def analyze_fault(db: Session, fault_line_id: str) -> dict:
    """故障分析：标记故障线路，BFS 计算失电区域和可用联络开关"""
    # 1. 找到故障线路
    branch = db.query(Branch).filter(Branch.line_id == fault_line_id).first()
    if not branch:
        return {"error": f"线路 {fault_line_id} 不存在"}

    # 2. 标记故障线路
    branch.is_fault = True
    branch.status = "fault"
    branch.switch_state = "open"

    # 3. 构建排除故障线路的邻接表
    adj = _build_adjacency(db, exclude_branch_id=fault_line_id)

    # 4. BFS：从 Bus1 出发
    energized = _bfs_energized(adj, source=1)

    # 5. 所有节点 vs 有电节点 → 失电节点
    all_buses = db.query(BusNode).all()
    all_bus_nos = {b.bus_no for b in all_buses}
    affected = sorted(all_bus_nos - energized)

    # 6. 汇总失电负荷
    affected_buses = db.query(BusNode).filter(BusNode.bus_no.in_(affected)).all()
    lost_p = sum(b.load_p for b in affected_buses)
    lost_q = sum(b.load_q for b in affected_buses)

    # 标记失电节点状态
    for b in affected_buses:
        b.status = "outage"
    # 保持有电节点为 normal
    for b in db.query(BusNode).filter(BusNode.bus_no.in_(energized)).all():
        b.status = "normal"

    # 7. 可用联络开关判断
    ties = db.query(TieSwitch).all()
    available_ties: list[str] = []
    for t in ties:
        f_in_energized = t.from_bus in energized
        t_in_energized = t.to_bus in energized
        f_in_affected = t.from_bus in affected
        t_in_affected = t.to_bus in affected
        # 一端有电，一端失电 → 可用于转供
        if (f_in_energized and t_in_affected) or (f_in_affected and t_in_energized):
            available_ties.append(t.tie_id)

    # 8. 隔离开关
    isolation_switches = [f"SW-{fault_line_id}-FROM", f"SW-{fault_line_id}-TO"]

    # 9. 保存故障记录
    record = FaultRecord(
        fault_line_id=fault_line_id,
        from_bus=branch.from_bus,
        to_bus=branch.to_bus,
        fault_type="line_fault",
        affected_nodes=json.dumps(affected),
        lost_load_p=lost_p,
        lost_load_q=lost_q,
        available_tie_switches=json.dumps(available_ties),
        isolation_switches=json.dumps(isolation_switches),
        status="active",
    )
    db.add(record)
    db.commit()
    db.refresh(record)

    return {
        "faultId": record.id,
        "faultLine": fault_line_id,
        "fromBus": branch.from_bus,
        "toBus": branch.to_bus,
        "affectedNodes": affected,
        "lostLoadP": round(lost_p, 2),
        "lostLoadQ": round(lost_q, 2),
        "availableTieSwitches": available_ties,
        "isolationSwitches": isolation_switches,
        "message": "故障影响范围计算完成（BFS 图搜索）",
    }


def reset_topology(db: Session) -> dict:
    """重置全网状态：清除故障、恢复线路、联络开关恢复常开"""
    db.query(Branch).update({"is_fault": False, "status": "normal", "switch_state": "closed"})
    db.query(BusNode).update({"status": "normal"})
    db.query(TieSwitch).update({"status": "open"})
    db.query(FaultRecord).update({"status": "resolved"})
    db.commit()
    return {"message": "全网状态已重置"}
