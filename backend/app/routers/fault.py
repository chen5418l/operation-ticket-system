"""故障相关 API"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from pydantic import BaseModel
from app.core.database import get_db
from app.models.fault import FaultRecord
from app.services.fault_analysis_service import analyze_fault, reset_topology

router = APIRouter(prefix="/api", tags=["故障"])


class FaultRequest(BaseModel):
    faultLineId: str


@router.post("/fault/analyze")
def fault_analyze(req: FaultRequest, db: Session = Depends(get_db)):
    result = analyze_fault(db, req.faultLineId)
    return {"code": 200, "message": "success", "data": result}


@router.get("/faults")
def list_faults(db: Session = Depends(get_db)):
    records = db.query(FaultRecord).order_by(FaultRecord.created_at.desc()).all()
    return {
        "code": 200,
        "data": [{"id": r.id, "faultLineId": r.fault_line_id,
                   "fromBus": r.from_bus, "toBus": r.to_bus,
                   "affectedNodes": r.affected_nodes, "lostLoadP": r.lost_load_p,
                   "availableTieSwitches": r.available_tie_switches,
                   "status": r.status, "createdAt": str(r.created_at)} for r in records],
    }
