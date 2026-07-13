"""转供相关 API"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from pydantic import BaseModel
from app.core.database import get_db
from app.services.transfer_service import generate_transfer_plans

router = APIRouter(prefix="/api", tags=["转供"])


class TransferRequest(BaseModel):
    faultId: int


@router.post("/transfer/plans")
def get_transfer_plans(req: TransferRequest, db: Session = Depends(get_db)):
    result = generate_transfer_plans(db, req.faultId)
    return {"code": 200, "message": "success", "data": result}
