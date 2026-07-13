"""安全校验模型"""
from sqlalchemy import Column, Integer, String, Text, DateTime, func
from app.core.database import Base


class SafetyCheck(Base):
    __tablename__ = "safety_checks"

    id = Column(Integer, primary_key=True, autoincrement=True)
    plan_id = Column(Integer, nullable=False, index=True)
    connectivity_check = Column(String(16), default="passed")
    loop_risk_check = Column(String(16), default="passed")
    overload_check = Column(String(16), default="passed")
    voltage_check = Column(String(16), default="passed")
    switch_state_check = Column(String(16), default="passed")
    sequence_check = Column(String(16), default="passed")
    final_result = Column(String(16), default="passed")  # passed / warning / failed
    suggestions = Column(Text, default="[]")             # JSON string
    created_at = Column(DateTime, server_default=func.now())
