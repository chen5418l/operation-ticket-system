"""
国网江苏市级配电网智能成票与安全校验系统 — 后端入口
FastAPI + MySQL + BFS故障分析
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.database import init_db
from app.routers import topology, fault, transfer, safety, ticket, health, safety_checker, realtime

app = FastAPI(
    title="国网江苏市级配电网智能成票与安全校验系统",
    description="IEEE 33节点配电网故障分析、转供决策、安全校验与操作票生成",
    version="2.0",
)

# CORS — 开发阶段允许所有来源
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173", "*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 注册路由
app.include_router(topology.router)
app.include_router(fault.router)
app.include_router(transfer.router)
app.include_router(safety.router)
app.include_router(ticket.router)
app.include_router(health.router)
app.include_router(safety_checker.router)
app.include_router(realtime.router)


@app.on_event("startup")
def on_startup():
    """启动时自动创建表"""
    try:
        init_db()
        print("数据库表已就绪")
    except Exception as e:
        print(f"警告：数据库连接失败，请检查 MySQL 配置 — {e}")
        print("后端将以只读模式运行，请确保 MySQL 已启动并执行 CREATE DATABASE power_ticket_system")


@app.get("/")
def root():
    return {"message": "国网江苏市级配电网智能成票与安全校验系统 API", "version": "2.0", "docs": "/docs"}
