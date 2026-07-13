"""安全校验 API"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from pydantic import BaseModel
from app.core.database import get_db
from app.services.safety_check_service import run_safety_check

router = APIRouter(prefix="/api", tags=["安全校验"])


class SafetyRequest(BaseModel):
    planId: int


@router.post("/safety/check")
def safety_check(req: SafetyRequest, db: Session = Depends(get_db)):
    result = run_safety_check(db, req.planId)
    return {"code": 200, "message": "success", "data": result}
