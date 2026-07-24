# -*- coding: utf-8 -*-
"""
外部算法服务适配器
统一封装对张同学 MATLAB/MATPOWER 算法服务的 HTTP 调用：
- 读取环境变量中的各算法 URL
- 统一超时、异常捕获、降级返回
- 不向调用方抛异常，前端永不看到 502
"""
import os
import json as json_mod
import urllib.request
import urllib.error
from datetime import datetime
from typing import Optional

# ---- 环境变量配置 ----
ALGO_FORECAST_URL        = os.getenv("ALGO_FORECAST_URL",        "").strip()
ALGO_FAULT_ANALYZE_URL   = os.getenv("ALGO_FAULT_ANALYZE_URL",   "").strip()
ALGO_BOUNDARY_ANALYZE_URL = os.getenv("ALGO_BOUNDARY_ANALYZE_URL", "").strip()
ALGO_TRANSFER_RECOMMEND_URL = os.getenv("ALGO_TRANSFER_RECOMMEND_URL", "").strip()
ALGO_SAFETY_VALIDATE_URL = os.getenv("ALGO_SAFETY_VALIDATE_URL", "").strip()

_ALGO_TIMEOUT = int(os.getenv("ALGO_TIMEOUT_SECONDS", "5") or "5")

# ---- IEEE33 联络线编号 ↔ 线路键双向映射（需与张同学最终确认编号约定）----
ZHANG_TIE_NUM_TO_KEY: dict = {
    33: "8-21",
    34: "9-15",
    35: "12-22",
    36: "18-33",
    37: "25-29",
}
ZHANG_KEY_TO_TIE_NUM: dict = {v: k for k, v in ZHANG_TIE_NUM_TO_KEY.items()}


# ---- 统一调用接口 ----

class AlgoCallResult:
    """外部算法调用结果。available=False 时降级本地规则，不抛异常。"""
    def __init__(self, available: bool, data: Optional[dict] = None,
                 error_type: str = "", warning: str = ""):
        self.available = available
        self.data = data or {}
        self.error_type = error_type
        self.warning = warning

    def to_dict(self) -> dict:
        return {
            "available": self.available,
            "error_type": self.error_type,
            "warning": self.warning,
        }

    def __bool__(self) -> bool:
        return self.available


def _call(url: str, body: dict) -> AlgoCallResult:
    """
    向指定 URL 发送 POST JSON 请求。
    成功返回 AlgoCallResult(available=True, data={...})，
    任何失败返回 AlgoCallResult(available=False, ...)，不抛异常。
    """
    if not url:
        return AlgoCallResult(
            available=False,
            error_type="not_configured",
            warning="外部算法服务未配置，结果需人工复核",
        )
    try:
        payload = json_mod.dumps(body, ensure_ascii=False).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=payload,
            headers={"Content-Type": "application/json; charset=utf-8"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=_ALGO_TIMEOUT) as resp:
            raw = resp.read().decode("utf-8")
            data = json_mod.loads(raw)
            return AlgoCallResult(available=True, data=data)
    except urllib.error.HTTPError as e:
        # 非 2xx — 不在适配层暴露对方错误体
        return AlgoCallResult(
            available=False,
            error_type="bad_response",
            warning="外部算法服务返回异常，结果需人工复核",
        )
    except urllib.error.URLError as e:
        # 连接失败 / DNS 失败等
        reason = str(e.reason or "").lower()
        if "time" in reason:
            err_type = "timeout"
            warning = "外部算法服务响应超时，结果需人工复核"
        else:
            err_type = "connection_error"
            warning = "外部算法服务暂不可用，结果需人工复核"
        return AlgoCallResult(available=False, error_type=err_type, warning=warning)
    except (json_mod.JSONDecodeError, ValueError) as e:
        return AlgoCallResult(
            available=False,
            error_type="bad_response",
            warning="外部算法服务返回格式异常，结果需人工复核",
        )
    except Exception as e:
        return AlgoCallResult(
            available=False,
            error_type="connection_error",
            warning="外部算法服务暂不可用，结果需人工复核",
        )


# ---- 按用途的便捷函数 ----

def call_forecast(body: dict) -> AlgoCallResult:
    """调用源荷预测算法"""
    return _call(ALGO_FORECAST_URL, body)


def call_fault_analyze(body: dict) -> AlgoCallResult:
    """调用故障分析算法"""
    return _call(ALGO_FAULT_ANALYZE_URL, body)


def call_boundary_analyze(body: dict) -> AlgoCallResult:
    """调用边界判定算法"""
    return _call(ALGO_BOUNDARY_ANALYZE_URL, body)


def call_transfer_recommend(body: dict) -> AlgoCallResult:
    """调用转供推荐/评分算法"""
    return _call(ALGO_TRANSFER_RECOMMEND_URL, body)


def call_safety_validate(body: dict) -> AlgoCallResult:
    """调用安全校验算法"""
    return _call(ALGO_SAFETY_VALIDATE_URL, body)
