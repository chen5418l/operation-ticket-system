"""操作票模型"""
from sqlalchemy import Column, Integer, String, Text, DateTime, func
from app.core.database import Base


class OperationTicket(Base):
    __tablename__ = "operation_tickets"

    id = Column(Integer, primary_key=True, autoincrement=True)
    ticket_no = Column(String(32), unique=True, nullable=False)
    fault_id = Column(Integer, nullable=True)
    plan_id = Column(Integer, nullable=True)
    task_name = Column(String(256), default="")
    operation_steps = Column(Text, default="[]")        # JSON string
    safety_notes = Column(Text, default="[]")            # JSON string
    operator = Column(String(32), default="")
    guardian = Column(String(32), default="")
    check_result = Column(String(16), default="passed")
    status = Column(String(16), default="draft")        # draft / generated / approved / executed
    created_at = Column(DateTime, server_default=func.now())
