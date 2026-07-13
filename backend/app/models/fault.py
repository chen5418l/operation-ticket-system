"""故障记录模型"""
from sqlalchemy import Column, Integer, String, Float, Text, DateTime, func
from app.core.database import Base


class FaultRecord(Base):
    __tablename__ = "fault_records"

    id = Column(Integer, primary_key=True, autoincrement=True)
    fault_line_id = Column(String(8), nullable=False)
    from_bus = Column(Integer, nullable=False)
    to_bus = Column(Integer, nullable=False)
    fault_type = Column(String(32), default="line_fault")
    affected_nodes = Column(Text, default="[]")         # JSON string
    lost_load_p = Column(Float, default=0.0)
    lost_load_q = Column(Float, default=0.0)
    available_tie_switches = Column(Text, default="[]") # JSON string
    isolation_switches = Column(Text, default="[]")     # JSON string
    status = Column(String(16), default="active")       # active / resolved
    created_at = Column(DateTime, server_default=func.now())
