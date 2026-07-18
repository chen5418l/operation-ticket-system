"""
实时数据适配接口 — 为 Simulink/MATLAB 推送数据预留
支持三种模式: static / mock / realtime

Simulink 联调密钥:
  请求头 X-Simulink-Token 必须匹配环境变量 SIMULINK_SOURCE_TOKEN
  只有通过验证后，source_tag 才会被设为 "simulink" 且 trusted_source=true
"""

import os, json, time, random
from datetime import datetime
from fastapi import APIRouter, Request
from pydantic import BaseModel
from typing import List, Dict, Optional

# 确保 .env 已加载
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

router = APIRouter(prefix="/api/realtime", tags=["实时数据"])

# ==================== 内存缓存 ====================
_latest_data: Optional[dict] = None
_last_update: Optional[str] = None
_latest_source: Optional[str] = None       # source_tag
_latest_trusted: bool = False              # 是否通过 token 验证


def _get_mode() -> str:
    """每次调用时重新读取环境变量，确保 .env 修改后生效"""
    return os.getenv("DATA_SOURCE_MODE", "mock")


def _get_simulink_token() -> str:
    """读取约定的 Simulink 联调密钥"""
    return os.getenv("SIMULINK_SOURCE_TOKEN", "")


def _verify_simulink_token(request: Request) -> bool:
    """
    验证请求头中的 Simulink 联调密钥。
    检查 X-Simulink-Token 或 X-Source-Token 是否匹配环境变量。
    如果环境变量未配置（空字符串），则永不通过验证。
    """
    expected = _get_simulink_token()
    if not expected:
        return False  # 未配置密钥，拒绝所有 simulink 标记
    token = request.headers.get("X-Simulink-Token", "") or request.headers.get("X-Source-Token", "")
    return token == expected


# ==================== Schemas ====================
class NodeItem(BaseModel):
    node: int
    load_kw: float = 0
    voltage_pu: float = 1.0
    pv_kw: float = 0
    ev_kw: float = 0
    risk_level: str = "low"


class LineItem(BaseModel):
    line: str          # 如 "13-14"
    current_a: float = 0
    power_kw: float = 0
    status: int = 1    # 1=闭合, 0=断开


class UpdatePayload(BaseModel):
    timestamp: Optional[str] = None
    nodes: List[NodeItem] = []
    lines: List[LineItem] = []
    switches: Dict[str, int] = {}
    source: Optional[str] = None       # 请求体中的来源标识（不可信）
    source_tag: Optional[str] = None   # 同上，兼容字段名


# ==================== Mock 数据生成 ====================
def _mock_nodes():
    nodes = []
    for i in range(1, 34):
        load = round(random.uniform(40, 200), 2) if i > 1 else 0
        v = round(random.uniform(0.93, 1.02), 3)
        pv = round(random.uniform(0, 50), 2) if i in (6, 14, 30) else 0
        ev = round(random.uniform(0, 100), 2) if i in (8, 14, 24, 30, 32) else 0
        risk = "high" if v < 0.94 else "medium" if v < 0.96 else "low"
        nodes.append({"node": i, "load_kw": load, "voltage_pu": v, "pv_kw": pv, "ev_kw": ev, "risk_level": risk})
    return nodes


def _mock_lines():
    pairs = [(1,2),(2,3),(3,4),(4,5),(5,6),(6,7),(7,8),(8,9),(9,10),(10,11),(11,12),(12,13),(13,14),(14,15),(15,16),(16,17),(17,18),(2,19),(19,20),(20,21),(21,22),(3,23),(23,24),(24,25),(6,26),(26,27),(27,28),(28,29),(29,30),(30,31),(31,32),(32,33)]
    return [{"line": f"{a}-{b}", "current_a": round(random.uniform(50, 200), 1), "power_kw": round(random.uniform(100, 500), 1), "status": 1} for a, b in pairs]


def _mock_switches():
    sw = {f"Switch{i}": 1 for i in range(1, 38)}
    sw["Switch17"] = sw["Switch18"] = sw["Switch36"] = 0
    return sw


def _generate_mock():
    return {
        "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "nodes": _mock_nodes(),
        "lines": _mock_lines(),
        "switches": _mock_switches(),
        "source_tag": "mock",
        "trusted_source": False,
        "message": "Mock演示数据",
    }


# ==================== 端点 ====================

@router.get("/status")
def realtime_status():
    """返回实时数据连接状态"""
    global _latest_data, _last_update, _latest_source, _latest_trusted

    mode = _get_mode()

    if mode == "realtime":
        if _latest_data is None:
            return {
                "success": True,
                "has_data": False,
                "source": "realtime",
                "source_tag": "none",
                "trusted_source": False,
                "connected": False,
                "last_update": None,
                "message": "暂无实时数据",
            }

        src_tag = _latest_source or "unknown"
        trusted = _latest_trusted

        if src_tag == "simulink" and trusted:
            msg = "Simulink/MATLAB 实时数据已连接"
        elif src_tag == "unverified_simulink":
            msg = "未验证的 Simulink 标识，按测试数据处理"
        elif src_tag in ("test", "manual"):
            msg = "测试实时数据"
        elif src_tag == "mock":
            msg = "Mock演示数据"
        else:
            msg = f"实时数据 ({src_tag})"

        return {
            "success": True,
            "has_data": True,
            "source": "realtime",
            "source_tag": src_tag,
            "trusted_source": trusted,
            "connected": True,
            "last_update": _last_update,
            "message": msg,
        }

    elif mode == "mock":
        data = _generate_mock()
        _latest_data = data
        _last_update = data["timestamp"]
        _latest_source = "mock"
        _latest_trusted = False
        return {
            "success": True,
            "has_data": True,
            "source": "mock",
            "source_tag": "mock",
            "trusted_source": False,
            "connected": True,
            "last_update": data["timestamp"],
            "message": "Mock演示数据",
        }

    else:  # static
        return {
            "success": True,
            "has_data": False,
            "source": "static",
            "source_tag": "static",
            "trusted_source": False,
            "connected": False,
            "last_update": None,
            "message": "使用静态拓扑数据",
        }


@router.get("/latest")
def realtime_latest():
    """返回最新节点、线路、开关数据"""
    global _latest_data, _last_update, _latest_source, _latest_trusted

    mode = _get_mode()

    if mode == "realtime":
        if _latest_data is None:
            # realtime 模式无数据时不自动生成 mock
            return {
                "success": True,
                "has_data": False,
                "source": "realtime",
                "source_tag": "none",
                "trusted_source": False,
                "timestamp": None,
                "nodes": [],
                "lines": [],
                "switches": {},
                "message": "暂无实时数据",
            }
        return {
            "success": True,
            "has_data": True,
            "source": "realtime",
            "source_tag": _latest_source or "unknown",
            "trusted_source": _latest_trusted,
            "timestamp": _last_update,
            "message": _latest_data.get("message", ""),
            "nodes": _latest_data.get("nodes", []),
            "lines": _latest_data.get("lines", []),
            "switches": _latest_data.get("switches", {}),
        }

    elif mode == "mock":
        data = _generate_mock()
        _latest_data = data
        _last_update = data["timestamp"]
        _latest_source = "mock"
        _latest_trusted = False
        return {
            "success": True,
            "has_data": True,
            "source": "mock",
            "source_tag": "mock",
            "trusted_source": False,
            "timestamp": data["timestamp"],
            "message": "Mock演示数据",
            "nodes": data["nodes"],
            "lines": data["lines"],
            "switches": data["switches"],
        }

    else:  # static
        return {
            "success": True,
            "has_data": False,
            "source": "static",
            "source_tag": "static",
            "trusted_source": False,
            "timestamp": "static",
            "nodes": [{"node": i, "load_kw": 0, "voltage_pu": 1.0, "pv_kw": 0, "ev_kw": 0, "risk_level": "low"} for i in range(1, 34)],
            "lines": [],
            "switches": {f"Switch{i}": 1 for i in range(1, 38)},
            "message": "静态拓扑数据",
        }


@router.post("/update")
async def realtime_update(payload: UpdatePayload, request: Request):
    """
    Simulink/MATLAB 推送实时数据。

    安全性：仅当请求头 X-Simulink-Token 匹配 SIMULINK_SOURCE_TOKEN 时，
    才接受 source=simulink/matlab 并设置 trusted_source=true。
    否则即使请求体声称 source=simulink，也会降级为 unverified_simulink。
    """
    global _latest_data, _last_update, _latest_source, _latest_trusted

    # 1) 读取请求体中的 source 标识（不可信）
    claimed_source = (payload.source or payload.source_tag or "").strip().lower()

    # 2) 验证 Simulink 联调密钥
    token_ok = _verify_simulink_token(request)

    # 3) 判定 source_tag 和 trusted_source
    if claimed_source in ("simulink", "matlab"):
        if token_ok:
            source_tag = "simulink"
            trusted = True
            msg = "Simulink/MATLAB 实时数据已接入"
        else:
            source_tag = "unverified_simulink"
            trusted = False
            msg = "未验证的 Simulink 标识，已按测试数据处理"
    elif claimed_source == "test":
        source_tag = "test"
        trusted = False
        msg = "测试实时数据"
    elif claimed_source == "mock":
        source_tag = "mock"
        trusted = False
        msg = "Mock演示数据"
    elif claimed_source == "manual":
        source_tag = "manual"
        trusted = False
        msg = "手动测试数据"
    else:
        source_tag = "manual"
        trusted = False
        msg = "手动测试数据"

    # 4) 存储
    _latest_data = {
        "nodes": [n.model_dump() for n in payload.nodes],
        "lines": [l.model_dump() for l in payload.lines],
        "switches": payload.switches,
        "message": msg,
    }
    _last_update = payload.timestamp or datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    _latest_source = source_tag
    _latest_trusted = trusted

    print(f"[Realtime] 收到数据推送 (source_tag={source_tag}, trusted={trusted}): "
          f"{len(_latest_data['nodes'])} 节点, {len(_latest_data['lines'])} 线路")

    return {
        "success": True,
        "message": msg,
        "timestamp": _last_update,
        "source_tag": source_tag,
        "trusted_source": trusted,
    }


@router.post("/clear")
def realtime_clear():
    """
    [开发调试] 清空当前内存中的实时数据缓存。
    用于测试重启和清空状态，不应用于生产环境。
    """
    global _latest_data, _last_update, _latest_source, _latest_trusted
    _latest_data = None
    _last_update = None
    _latest_source = None
    _latest_trusted = False
    print("[Realtime] 实时数据缓存已清空")
    return {
        "success": True,
        "message": "实时数据缓存已清空",
    }


# ==================== 共享请求模型（供 main.py 使用）====================

class ForecastRealtimeRequest(BaseModel):
    horizon: int = 24
    interval_minutes: int = 60
    base_hour: int = -1  # -1 表示使用 realtime timestamp 或服务器小时
    horizon_hours: int = 0  # 兼容字段


class FaultAnalyzeRealtimeRequest(BaseModel):
    fault_line: str = "8-9"


class TransferEvaluateRealtimeRequest(BaseModel):
    fault_line: str = "8-9"
