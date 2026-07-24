# -*- coding: utf-8 -*-
"""
IEEE33 算法服务适配器（基于 docs/algorithm-service-contract.md 正式接口清单）

设计：
- X-Algorithm-Key 仅用于调用算法服务业务接口，与 Simulink 推送的 X-Simulink-Token 完全隔离
- 所有 HTTP 异常统一捕获，返回结构化 Result，不在调用方抛异常（前端永不看到 502）
- 异步任务采用轮询模式，支持超时中断
"""
import os
import json as json_mod
import urllib.request
import urllib.error
import time
import threading
from datetime import datetime
from typing import Optional, Callable

# ---- 环境变量（优先读取张同学文档约定的键名，回退兼容旧键名）----
_ALGO_SERVICE_BASE_URL = os.getenv("ALGO_SERVICE_BASE_URL", "").strip()
if not _ALGO_SERVICE_BASE_URL:
    _ALGO_SERVICE_BASE_URL = os.getenv("ALGO_BASE_URL", "").strip()
ALGO_BASE_URL = _ALGO_SERVICE_BASE_URL.rstrip("/") if _ALGO_SERVICE_BASE_URL else ""

_ALGO_SERVICE_KEY = os.getenv("ALGO_SERVICE_KEY", "").strip()
if not _ALGO_SERVICE_KEY:
    _ALGO_SERVICE_KEY = os.getenv("ALGORITHM_KEY", "").strip()
ALGORITHM_KEY = _ALGO_SERVICE_KEY

_raw_to = os.getenv("ALGO_SERVICE_TIMEOUT_MS") or os.getenv("ALGO_TIMEOUT_MS") or "30000"
ALGO_TIMEOUT_MS          = int(_raw_to)
ALGO_JOB_POLL_INTERVAL_MS = int(os.getenv("ALGO_JOB_POLL_INTERVAL_MS", "1000") or "1000")
_raw_jt = os.getenv("ALGO_JOB_MAX_WAIT_MS") or os.getenv("ALGO_JOB_TIMEOUT_MS") or "20000"
ALGO_JOB_TIMEOUT_MS      = int(_raw_jt)


# ---- 统一返回结构 ----
class AlgoResult:
    """算法调用返回。available=False 时调用方应降级本地规则。"""
    def __init__(self, available: bool = False, ok: bool = False,
                 status: Optional[int] = None, data: Optional[dict] = None,
                 error: str = "", warning: str = ""):
        self.available = available
        self.ok = ok
        self.status = status
        self.data = data or {}
        self.error = error
        self.warning = warning

    def to_dict(self) -> dict:
        return {
            "available": self.available, "ok": self.ok,
            "status": self.status,
            "error": self.error, "warning": self.warning,
        }

    def __bool__(self) -> bool:
        return self.available and self.ok


# ---- 内部 HTTP 封装 ----
def _request(method: str, path: str, body: Optional[dict] = None,
             timeout_ms: Optional[int] = None) -> AlgoResult:
    """统一 HTTP 调用。永不抛异常。"""
    if not ALGO_BASE_URL:
        return AlgoResult(available=False, ok=False,
                          error="not_configured",
                          warning="IEEE33 算法服务未配置，结果需人工复核")
    url = f"{ALGO_BASE_URL}{path}"
    timeout_sec = (timeout_ms or ALGO_TIMEOUT_MS) / 1000.0
    try:
        data_bytes = None
        if body is not None:
            data_bytes = json_mod.dumps(body, ensure_ascii=False).encode("utf-8")
        headers = {
            "Content-Type": "application/json; charset=utf-8",
            "X-Algorithm-Key": ALGORITHM_KEY,
        }
        req = urllib.request.Request(url, data=data_bytes, headers=headers, method=method)
        with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
            raw = resp.read().decode("utf-8")
            return AlgoResult(available=True, ok=True, status=resp.status,
                              data=json_mod.loads(raw) if raw else {})
    except urllib.error.HTTPError as e:
        return AlgoResult(available=False, ok=False, status=e.code,
                          error="bad_response",
                          warning="算法服务返回异常，结果需人工复核")
    except urllib.error.URLError as e:
        reason = str(e.reason or "").lower()
        if "time" in reason:
            return AlgoResult(available=False, ok=False, error="timeout",
                              warning="算法服务响应超时，结果需人工复核")
        return AlgoResult(available=False, ok=False, error="connection_error",
                          warning="算法服务暂不可用，结果需人工复核")
    except (json_mod.JSONDecodeError, ValueError):
        return AlgoResult(available=False, ok=False, error="bad_response",
                          warning="算法服务返回格式异常，结果需人工复核")
    except Exception as e:
        return AlgoResult(available=False, ok=False, error="connection_error",
                          warning="算法服务暂不可用，结果需人工复核")


def postJson(path: str, body: dict, timeout_ms: Optional[int] = None) -> AlgoResult:
    return _request("POST", path, body, timeout_ms)


def getJson(path: str, timeout_ms: Optional[int] = None) -> AlgoResult:
    return _request("GET", path, None, timeout_ms)


# ---- 业务接口封装 ----
def forecastRealtime(payload: dict) -> AlgoResult:
    """POST /api/v1/forecast/realtime — 源荷预测"""
    return postJson("/api/v1/forecast/realtime", payload)


def faultAnalyze(payload: dict) -> AlgoResult:
    """POST /api/v1/fault/analyze — 故障分析"""
    return postJson("/api/v1/fault/analyze", payload)


def boundaryAnalyze(payload: dict) -> AlgoResult:
    """POST /api/v1/boundary/evaluate — 边界判定"""
    return postJson("/api/v1/boundary/evaluate", payload)


def candidatesGenerate(payload: dict, timeout_ms: Optional[int] = None) -> AlgoResult:
    """POST /api/v1/candidates/generate — 候选方案生成"""
    return postJson("/api/v1/candidates/generate", payload, timeout_ms=timeout_ms)


def pipelineEvaluate(payload: dict) -> AlgoResult:
    """POST /api/v1/pipeline/evaluate — 全链路评估（可能返回 job_id 走异步）"""
    return postJson("/api/v1/pipeline/evaluate", payload)


def safetyValidate(payload: dict) -> AlgoResult:
    """POST /api/v1/safety/validate — 安全校验"""
    return postJson("/api/v1/safety/validate", payload)


# ---- 异步任务轮询 ----
def getJob(job_id: str) -> AlgoResult:
    """GET /api/v1/jobs/{job_id} — 查询任务状态"""
    return getJson(f"/api/v1/jobs/{job_id}")


def getJobResult(job_id: str) -> AlgoResult:
    """GET /api/v1/jobs/{job_id}/result — 获取任务结果"""
    return getJson(f"/api/v1/jobs/{job_id}/result")


def pollJobUntilDone(job_id: str,
                     on_progress: Optional[Callable[[dict], None]] = None) -> AlgoResult:
    """
    轮询异步任务直至完成/失败/超时。
    - 每 ALGO_JOB_POLL_INTERVAL_MS 查询一次状态
    - 总超时 ALGO_JOB_TIMEOUT_MS
    - 返回最终 result（成功）或可用性告警（失败/超时）
    """
    deadline = time.time() + ALGO_JOB_TIMEOUT_MS / 1000.0
    while time.time() < deadline:
        status_r = getJob(job_id)
        if not status_r.ok:
            return AlgoResult(available=False, ok=False, error="job_status_fetch_failed",
                              warning="无法获取算法任务状态，结果需人工复核",
                              data={"job_id": job_id})
        state = (status_r.data.get("status") or status_r.data.get("state") or "").lower()
        if on_progress:
            on_progress(status_r.data)
        if state in ("completed", "done", "success"):
            # 获取最终结果
            result_r = getJobResult(job_id)
            return result_r
        if state in ("failed", "error", "cancelled"):
            return AlgoResult(available=False, ok=False, error=f"job_{state}",
                              warning="算法任务执行失败，结果需人工复核",
                              data={"job_id": job_id, "state": state})
        time.sleep(ALGO_JOB_POLL_INTERVAL_MS / 1000.0)

    # 超时
    return AlgoResult(available=False, ok=False, error="job_timeout",
                      warning="算法任务执行超时，结果需人工复核",
                      data={"job_id": job_id})


def submitPipelineEvaluate(payload: dict,
                           on_progress: Optional[Callable[[dict], None]] = None) -> AlgoResult:
    """
    提交全链路评估 pipeline：
    1. POST /api/v1/pipeline/evaluate → 获取 job_id
    2. 轮询直至完成/超时
    3. 返回最终 result
    """
    submit_r = pipelineEvaluate(payload)
    if not submit_r.ok:
        return submit_r
    job_id = submit_r.data.get("job_id") or submit_r.data.get("id") or ""
    if not job_id:
        return AlgoResult(available=False, ok=False, error="no_job_id",
                          warning="算法服务未返回任务 ID，结果需人工复核")
    return pollJobUntilDone(job_id, on_progress=on_progress)


# ---- 健康检查 ----
def checkAlgorithmHealth() -> dict:
    """
    健康检查：先后调用 GET /api/v1/health 和 GET /api/v1/capabilities。
    不在内部抛异常，调用方始终拿到 dict。
    """
    if not ALGO_BASE_URL:
        return {"available": False, "status": "not_configured"}
    r = getJson("/api/v1/health", timeout_ms=3000)
    caps = getJson("/api/v1/capabilities", timeout_ms=3000)
    if r.ok:
        result = {"available": True, "status": "healthy", "health": r.data}
        if caps.ok:
            result["capabilities"] = caps.data
        else:
            result["capabilities"] = {"note": "未获取到能力列表"}
        return result
    if r.error in ("connection_error", "timeout"):
        return {"available": True, "status": "unknown",
                "note": "算法服务未响应 /api/v1/health，当前仅能通过业务接口探测可用性"}
    return {"available": True, "status": "degraded", "error": r.error, "warning": r.warning}


def checkCapabilities() -> AlgoResult:
    """GET /api/v1/capabilities — 获取算法服务能力列表"""
    return getJson("/api/v1/capabilities", timeout_ms=3000)
