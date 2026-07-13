"""拓扑相关 API"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.core.database import get_db
from app.models.topology import BusNode, Branch, TieSwitch
from app.data.ieee33_seed import seed_ieee33
from app.services.fault_analysis_service import reset_topology

router = APIRouter(prefix="/api", tags=["拓扑"])


@router.get("/topology/ieee33")
def get_topology(db: Session = Depends(get_db)):
    nodes = db.query(BusNode).all()
    branches = db.query(Branch).all()
    ties = db.query(TieSwitch).all()
    return {
        "code": 200,
        "data": {
            "nodes": [{"busNo": n.bus_no, "name": n.name, "nodeType": n.node_type,
                        "voltage": n.voltage, "loadP": n.load_p, "loadQ": n.load_q,
                        "status": n.status, "feeder": n.feeder,
                        "xCoord": n.x_coord, "yCoord": n.y_coord} for n in nodes],
            "branches": [{"lineId": b.line_id, "fromBus": b.from_bus, "toBus": b.to_bus,
                           "lineType": b.line_type, "status": b.status,
                           "switchState": b.switch_state, "loadRate": b.load_rate,
                           "isFault": b.is_fault, "resistance": b.resistance, "reactance": b.reactance,
                           "switchType": b.switch_type} for b in branches],
            "tieSwitches": [{"tieId": t.tie_id, "name": t.name, "fromBus": t.from_bus, "toBus": t.to_bus,
                              "status": t.status, "normallyOpen": t.normally_open,
                              "capacity": t.capacity, "riskLevel": t.risk_level,
                              "fromX": t.from_x, "fromY": t.from_y, "toX": t.to_x, "toY": t.to_y} for t in ties],
        },
    }


@router.post("/topology/init-ieee33")
def init_topology(db: Session = Depends(get_db)):
    result = seed_ieee33(db)
    return {"code": 200, "message": "success", "data": result}


@router.post("/topology/reset")
def reset(db: Session = Depends(get_db)):
    result = reset_topology(db)
    return {"code": 200, "message": "success", "data": result}
