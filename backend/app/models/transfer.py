"""转供方案模型"""
from sqlalchemy import Column, Integer, String, Float, Text, Boolean, DateTime, func
from app.core.database import Base


class TransferPlan(Base):
    __tablename__ = "transfer_plans"

    id = Column(Integer, primary_key=True, autoincrement=True)
    fault_id = Column(Integer, nullable=False, index=True)
    plan_name = Column(String(128), default="")
    close_tie_switch = Column(String(8), default="")
    open_switches = Column(Text, default="[]")           # JSON string
    restored_nodes = Column(Text, default="[]")          # JSON string
    restored_load_p = Column(Float, default=0.0)
    restored_load_q = Column(Float, default=0.0)
    max_load_rate = Column(Float, default=0.0)
    min_voltage = Column(Float, default=1.0)
    risk_level = Column(String(16), default="low")
    check_result = Column(String(16), default="passed")  # passed / warning / failed
    is_recommended = Column(Boolean, default=False)
    created_at = Column(DateTime, server_default=func.now())
