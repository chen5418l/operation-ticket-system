"""健康检查"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import text
from app.core.database import get_db

router = APIRouter(prefix="/api", tags=["健康检查"])


@router.get("/health")
def health_check(db: Session = Depends(get_db)):
    """检查后端和 MySQL 连接状态"""
    db_status = "ok"
    db_msg = "MySQL 连接正常"
    try:
        db.execute(text("SELECT 1"))
    except Exception as e:
        db_status = "error"
        db_msg = str(e)

    return {
        "status": "ok",
        "service": "市级配电网智能成票与安全校验系统",
        "version": "2.0",
        "database": {"status": db_status, "message": db_msg},
    }
