"""拓扑数据模型：bus_nodes / branches / tie_switches"""
from sqlalchemy import Column, Integer, String, Float, Boolean, DateTime, func
from app.core.database import Base


class BusNode(Base):
    __tablename__ = "bus_nodes"

    id = Column(Integer, primary_key=True, autoincrement=True)
    bus_no = Column(Integer, unique=True, nullable=False, index=True)
    name = Column(String(32), nullable=False)
    node_type = Column(String(16), default="load")  # source / load / branch
    voltage = Column(Float, default=1.0)
    load_p = Column(Float, default=0.0)
    load_q = Column(Float, default=0.0)
    status = Column(String(16), default="normal")  # normal / outage / fault / restored
    feeder = Column(String(64), default="")
    x_coord = Column(Float, default=0.0)
    y_coord = Column(Float, default=0.0)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class Branch(Base):
    __tablename__ = "branches"

    id = Column(Integer, primary_key=True, autoincrement=True)
    line_id = Column(String(8), unique=True, nullable=False)
    from_bus = Column(Integer, nullable=False)
    to_bus = Column(Integer, nullable=False)
    line_type = Column(String(16), default="main")  # main / branch
    status = Column(String(16), default="normal")    # normal / fault / isolated / outage
    switch_state = Column(String(8), default="closed")
    current = Column(Float, default=0.0)
    load_rate = Column(Float, default=0.0)
    is_fault = Column(Boolean, default=False)
    resistance = Column(Float, default=0.0)
    reactance = Column(Float, default=0.0)
    switch_type = Column(String(16), default="none")  # breaker / sectionSwitch / none
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())


class TieSwitch(Base):
    __tablename__ = "tie_switches"

    id = Column(Integer, primary_key=True, autoincrement=True)
    tie_id = Column(String(8), unique=True, nullable=False)
    name = Column(String(64), default="")
    from_bus = Column(Integer, nullable=False)
    to_bus = Column(Integer, nullable=False)
    status = Column(String(8), default="open")      # open / closed
    normally_open = Column(Boolean, default=True)
    capacity = Column(Float, default=0.5)
    risk_level = Column(String(16), default="low")
    from_x = Column(Float, default=0.0)
    from_y = Column(Float, default=0.0)
    to_x = Column(Float, default=0.0)
    to_y = Column(Float, default=0.0)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, server_default=func.now(), onupdate=func.now())
