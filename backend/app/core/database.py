"""数据库连接 — SQLAlchemy（延迟初始化）"""
import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base
from app.core.config import DATABASE_URL

engine = None
SessionLocal = None
Base = declarative_base()


def _ensure_engine():
    global engine, SessionLocal
    if engine is None:
        try:
            engine = create_engine(DATABASE_URL, echo=False, pool_pre_ping=True, pool_recycle=3600)
            SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
        except Exception as e:
            raise RuntimeError(f"数据库连接失败，请检查 MySQL 配置: {e}")


def get_db():
    """FastAPI 依赖注入"""
    _ensure_engine()
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    """创建所有表"""
    _ensure_engine()
    Base.metadata.create_all(bind=engine)
