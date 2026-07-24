"""
国网江苏市级配电网智能成票与安全校验系统 — 后端入口
FastAPI + MySQL + BFS故障分析
"""
from datetime import datetime
from typing import Optional
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from app.core.database import init_db
from app.routers import topology, fault, transfer, safety, ticket, health, safety_checker, realtime
from app.routers import realtime as realtime_module
from app.routers.realtime import ForecastRealtimeRequest, FaultAnalyzeRealtimeRequest, TransferEvaluateRealtimeRequest, BoundaryAnalyzeRealtimeRequest, TransferRecommendRealtimeRequest, SafetyValidateRealtimeRequest
from app.services.algorithm_client import AlgoCallResult

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


# ==================== 线路归一化工具 + 联络线容量配置 ====================

def parse_line_pair(line):
    """解析线路标识 "27-28" / "28-27" 为排序后的节点对 (27, 28)；非法格式或自环（"5-5"）返回 None"""
    try:
        a, b = str(line).strip().split("-")
        an, bn = int(a), int(b)
        if an == bn:
            return None  # 自环非法，防止污染辐射性校验
        return (min(an, bn), max(an, bn))
    except Exception:
        return None


def normalize_line_key(line) -> str:
    """归一化线路键："28-27" -> "27-28"；非法格式原样去空格返回"""
    pair = parse_line_pair(line)
    return f"{pair[0]}-{pair[1]}" if pair else str(line).strip()


# IEEE33 联络线静态容量配置 (kW)，键为归一化线路键。
# 若实时数据中该线路带有 rated_kw / capacity_kw 字段，则优先使用实时额定值。
TIE_LINE_LIMITS_KW = {
    "8-21": 1200,
    "9-15": 1200,
    "12-22": 1200,
    "18-33": 1200,
    "25-29": 500,
}

# 联络开关名称映射（键为归一化线路键）
TIE_NAME_MAP = {
    "8-21": "T1",
    "9-15": "T2",
    "12-22": "T3",
    "18-33": "T4",
    "25-29": "T5",
}

# ==================== 外部高级评分缓存（MATPOWER 等）====================
# 张同学 MATLAB/MATPOWER 评分结果的内存缓存（仅保留最近一次，暂不写数据库）
_external_score_result: Optional[dict] = None
EXTERNAL_SCORE_TTL_SECONDS = 300  # 外部评分有效期：5 分钟


def _external_score_expired(ext: dict) -> bool:
    """外部评分是否过期：优先按 payload timestamp 判断，解析失败退回服务端接收时间"""
    ts = str(ext.get("timestamp") or "").strip()
    base = None
    for f in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"):
        try:
            base = datetime.strptime(ts, f)
            break
        except ValueError:
            continue
    if base is None:
        base = ext.get("received_at")
    if base is None:
        return False
    return (datetime.now() - base).total_seconds() > EXTERNAL_SCORE_TTL_SECONDS


# ==================== 实时预测 + 故障分析（使用实时数据）====================

def _build_local_forecast(data, nodes, horizon, interval, base_hour, base_time, forecast_mode, time_source, warnings):
    """本地规则版源荷预测（日负荷系数 × 风险因子 × 电压因子），供外部算法不可用时兜底"""
    HOURLY_LOAD = {0:0.78,1:0.75,2:0.73,3:0.72,4:0.74,5:0.80,6:0.88,7:0.96,8:1.02,9:1.05,10:1.08,11:1.10,12:1.06,13:1.03,14:1.00,15:1.02,16:1.08,17:1.15,18:1.22,19:1.20,20:1.14,21:1.05,22:0.95,23:0.85}
    HOURLY_PV   = {0:0.00,1:0.00,2:0.00,3:0.00,4:0.00,5:0.05,6:0.15,7:0.35,8:0.55,9:0.75,10:0.90,11:1.00,12:1.00,13:0.92,14:0.80,15:0.65,16:0.45,17:0.20,18:0.05,19:0.00,20:0.00,21:0.00,22:0.00,23:0.00}
    HOURLY_EV   = {0:0.60,1:0.55,2:0.50,3:0.45,4:0.45,5:0.50,6:0.60,7:0.75,8:0.85,9:0.80,10:0.75,11:0.70,12:0.75,13:0.78,14:0.80,15:0.85,16:0.95,17:1.15,18:1.35,19:1.45,20:1.40,21:1.25,22:1.05,23:0.80}
    def lf(h): return HOURLY_LOAD.get(h % 24, 1.0)
    def pf(h): return HOURLY_PV.get(h % 24, 0.0)
    def ef(h): return HOURLY_EV.get(h % 24, 1.0)
    def rf(r): return {"low": 1.00, "medium": 1.03, "high": 1.06}.get(r, 1.00)
    def vf(v): return 1.05 if v < 0.95 else (1.02 if v < 0.97 else 1.00)
    cur_load = round(sum(n.get("load_kw", 0) for n in nodes), 3)
    cur_pv = round(sum(n.get("pv_kw", 0) for n in nodes), 3)
    cur_ev = round(sum(n.get("ev_kw", 0) for n in nodes), 3)
    node_forecasts = []
    for n in nodes:
        nd = n.get("node", 0); v = n.get("voltage_pu", 1.0); rl = n.get("risk_level", "low")
        l0, pv0, ev0 = n.get("load_kw", 0), n.get("pv_kw", 0), n.get("ev_kw", 0)
        series = []
        for s in range(1, horizon + 1):
            fh = (base_hour + s * interval // 60) % 24; t_off = s * interval
            fl = round(l0 * lf(fh) * rf(rl) * vf(v), 3)
            fp = round(pv0 * pf(fh), 3); fe = round(ev0 * ef(fh), 3)
            series.append({"step": s, "time_offset_min": t_off, "forecast_hour": fh,
                           "forecast_load_kw": fl, "forecast_pv_kw": fp, "forecast_ev_kw": fe,
                           "forecast_net_load_kw": round(fl + fe - fp, 3)})
        node_forecasts.append({"node": nd, "current_load_kw": l0, "current_pv_kw": pv0,
                               "current_ev_kw": ev0, "current_net_load_kw": round(l0 + ev0 - pv0, 3),
                               "voltage_pu": v, "risk_level": rl, "series": series})
    forecast_series = []
    for s in range(1, horizon + 1):
        fh = (base_hour + s * interval // 60) % 24; t_off = s * interval
        tl = round(sum(n.get("load_kw",0)*lf(fh)*rf(n.get("risk_level","low"))*vf(n.get("voltage_pu",1.0)) for n in nodes), 3)
        tp = round(sum(n.get("pv_kw",0)*pf(fh) for n in nodes), 3)
        te = round(sum(n.get("ev_kw",0)*ef(fh) for n in nodes), 3)
        forecast_series.append({"step": s, "time_offset_min": t_off, "forecast_hour": fh,
                                "total_load_kw": tl, "total_pv_kw": tp, "total_ev_kw": te,
                                "total_net_load_kw": round(tl+te-tp, 3)})
    # 风险节点：净负荷峰值增长率 > 10% 或电压 < 0.97
    risk_nodes = []
    for nf in node_forecasts:
        max_net = max((s["forecast_net_load_kw"] for s in nf["series"]), default=nf["current_net_load_kw"])
        r = nf["risk_level"]
        if r == "high" or r == "medium" or nf["voltage_pu"] < 0.97 or (
           nf["current_net_load_kw"] > 0 and (max_net - nf["current_net_load_kw"]) / max(nf["current_net_load_kw"], 1) > 0.1):
            risk_nodes.append({"node": nf["node"], "risk_level": r, "voltage_pu": nf["voltage_pu"],
                               "current_net_load_kw": nf["current_net_load_kw"], "peak_net_load_kw": max_net})
    return {
        "success": True, "has_data": True,
        "algorithm_source": "local_fallback",
        "confidence": "low",
        "source": "realtime",
        "source_tag": realtime_module._latest_source or "none",
        "trusted_source": realtime_module._latest_trusted or False,
        "timestamp": data.get("timestamp", "") or (realtime_module._last_update or ""),
        "base_time": base_time, "base_hour": base_hour,
        "forecast_mode": forecast_mode, "time_source": time_source,
        "horizon": horizon, "interval_minutes": interval,
        "message": "本地规则版源荷预测（未接入外部预测算法，结果需人工复核）",
        "current_total_load_kw": cur_load,
        "current_total_pv_kw": cur_pv,
        "current_total_ev_kw": cur_ev,
        "current_total_net_load_kw": round(cur_load + cur_ev - cur_pv, 3),
        "forecast_series": forecast_series, "node_forecasts": node_forecasts,
        "risk_nodes": risk_nodes,
        "diagnostics": {
            "realtime_node_count": len(nodes),
            "realtime_total_load_kw": cur_load, "realtime_total_pv_kw": cur_pv,
            "realtime_total_ev_kw": cur_ev, "used_realtime_nodes": True,
            "used_static_fallback": False,
            "field_check": {"has_pv_kw": cur_pv > 0, "has_ev_kw": cur_ev > 0},
        },
        "warnings": warnings,
    }


def compute_time_index(ts: Optional[str] = None) -> int:
    """一天 288 点（5分钟粒度），范围 1~288。公式: floor((h*60+m)/5) + 1"""
    if ts:
        for f in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%H:%M:%S", "%H:%M"):
            try: dt = datetime.strptime(str(ts).strip(), f); break
            except ValueError: pass
        else: dt = datetime.now()
    else:
        dt = datetime.now()
    return (dt.hour * 60 + dt.minute) // 5 + 1


def _map_forecast_risk_level(level: str) -> str:
    """外部算法 risk_level: High/Medium → high/medium/low"""
    v = str(level or "").strip().lower()
    return v if v in ("high", "medium", "low") else "low"


def _normalize_external_forecast(ext: dict, nodes: list, warnings: list) -> dict:
    """将 IEEE33 算法服务 /api/v1/forecast/realtime 返回值标准化为业务前端结构"""
    ext_ts = ext.get("timestamp") or realtime_module._last_update or ""

    # forecast_series：兼容 forecasts[] 包裹结构
    series = ext.get("forecast_series") or ext.get("series") or []
    if not series and isinstance(ext.get("forecasts"), list):
        series = ext["forecasts"]

    # node_forecasts：兼容 forecasts[].nodes[] 扁平化
    node_fcasts = ext.get("node_forecasts") or []
    if not node_fcasts and isinstance(ext.get("forecasts"), list):
        flat = []
        for f in ext["forecasts"]:
            for n in (f.get("nodes") or []):
                flat.append({
                    "node": n.get("node") or n.get("bus", 0),
                    "forecast_hour": f.get("forecast_hour") or f.get("step", 0),
                    "forecast_load_kw": n.get("p_load_kw") or n.get("forecast_load_kw", 0),
                    "forecast_pv_kw": n.get("p_pv_kw") or n.get("forecast_pv_kw", 0),
                    "forecast_ev_kw": n.get("p_ev_kw") or n.get("forecast_ev_kw", 0),
                    "forecast_net_load_kw": (n.get("p_load_kw") or n.get("forecast_load_kw", 0))
                                           + (n.get("p_ev_kw") or n.get("forecast_ev_kw", 0))
                                           - (n.get("p_pv_kw") or n.get("forecast_pv_kw", 0)),
                })
        node_fcasts = flat

    # risk_nodes：标准化 risk_level + reasons → risk_reason
    risk = ext.get("risk_nodes") or ext.get("risk_nodes_list") or []
    norm_risk = []
    for rn in risk:
        nr = dict(rn)
        nr["risk_level"] = _map_forecast_risk_level(nr.get("risk_level", "low"))
        reasons = nr.get("reasons") or nr.get("risk_reason") or []
        if isinstance(reasons, str):
            reasons = [reasons]
        nr["risk_reason"] = reasons
        norm_risk.append(nr)

    cur_load = ext.get("current_total_load_kw") or round(sum(n.get("load_kw",0) for n in nodes), 3)

    return {
        "success": True, "has_data": True,
        "algorithm_source": "external",
        "algorithm": ext.get("algorithm") or "ieee33",
        "algorithm_version": ext.get("algorithm_version") or "",
        "trusted_source": realtime_module._latest_trusted or False,
        "timestamp": ext_ts,
        "current_total_load_kw": cur_load,
        "current_total_pv_kw": ext.get("current_total_pv_kw", 0),
        "current_total_ev_kw": ext.get("current_total_ev_kw", 0),
        "current_total_net_load_kw": ext.get("current_total_net_load_kw") or (cur_load + ext.get("current_total_ev_kw", 0) - ext.get("current_total_pv_kw", 0)),
        "forecast_series": series,
        "node_forecasts": node_fcasts,
        "risk_nodes": norm_risk,
        "message": "基于 IEEE33 算法服务完成源荷预测",
        "warnings": warnings,
    }


@app.post("/api/forecast/realtime")
def forecast_realtime(req: ForecastRealtimeRequest):
    """源荷预测统一接口：优先调用 IEEE33 算法服务 POST /api/v1/forecast/realtime"""
    data = realtime_module._latest_data
    if data is None or not data.get("nodes"):
        return {
            "success": False, "has_data": False,
            "message": "暂无实时数据，请先接入Simulink数据",
            "forecast_series": [], "node_forecasts": [],
            "warnings": ["暂无实时数据，请先接入Simulink数据"],
        }

    nodes = data["nodes"]
    warnings = []
    if not realtime_module._latest_trusted:
        warnings.append("当前数据源未验证，结果需人工复核")

    # ---- 基准时间解析 ----
    horizon = max(1, min(48, getattr(req, 'horizon_hours', 0) or req.horizon))
    interval = max(5, min(120, req.interval_minutes))
    ts_str = realtime_module._last_update or ""
    base_time, time_source, forecast_mode = "", "server_time", "realtime"
    if req.base_hour >= 0:
        base_hour = req.base_hour % 24; base_time = f"{base_hour:02d}:00"
        time_source = "manual_override"; forecast_mode = "scenario"
    elif ts_str:
        try:
            for fmt_str in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%H:%M:%S", "%H:%M"):
                try:
                    dt = datetime.strptime(ts_str.strip(), fmt_str)
                    base_hour = dt.hour
                    base_time = dt.strftime("%Y-%m-%d %H:%M:%S") if dt.year > 2000 else dt.strftime("%H:%M:%S")
                    time_source = "realtime_timestamp"; break
                except ValueError: continue
            else:
                base_hour = datetime.now().hour; base_time = datetime.now().strftime("%H:%M:%S")
        except Exception:
            base_hour = datetime.now().hour; base_time = datetime.now().strftime("%H:%M:%S")
    else:
        base_hour = datetime.now().hour; base_time = datetime.now().strftime("%H:%M:%S")
    base_hour = base_hour % 24

    # ---- IEEE33 算法服务桥接：源荷预测 ----
    from app.services.ieee33_algorithm_client import forecastRealtime as algo_forecast
    ti = compute_time_index(ts_str)
    algo_payload = {
        "request_id": f"fcst_{datetime.now().strftime('%Y%m%d%H%M%S')}",
        "timestamp": ts_str,
        "time_index": ti,
        "horizon_steps": horizon,
        "step_minutes": interval,
        "include_risk": True,
        "snapshot": {
            "timestamp": ts_str,
            "time_index": ti,
            "nodes": nodes,
            "lines": data.get("lines", []),
            "switches": data.get("switches", {}),
        },
    }
    algo_result = algo_forecast(algo_payload)
    if algo_result.available and algo_result.ok:
        normalized = _normalize_external_forecast(algo_result.data, nodes, warnings)
        normalized["diagnostics"] = {**algo_result.to_dict(), "algorithm_source": "external"}
        return normalized

    # ---- 本地规则兜底（未配置或外部调用失败均走此路径）----
    if algo_result.available is not None and not algo_result.available and algo_result.error == "not_configured":
        warnings.append("外部预测算法接口暂未接入，当前使用本地规则预测，结果需人工复核")
    else:
        warnings.append("外部预测算法服务暂不可用，已降级本地规则预测，结果需人工复核")
    return _build_local_forecast(data, nodes, horizon, interval, base_hour, base_time,
                                  forecast_mode, time_source, warnings)


def _run_local_fault_bfs(data, nodes, lines_data, fault_key, src_tag, trusted, warnings, parse_errors):
    """本地 BFS 故障分析（拓扑兜底）。algorithm_source=local_fallback"""
    node_map = {n.get("node", 0): n for n in nodes}
    # ---- 构建邻接表 ----
    adj = {}
    all_pairs = set()
    tie_candidates = []
    for l in lines_data:
        ln = l.get("line", ""); st = l.get("status", 1)
        pair = parse_line_pair(ln)
        if pair is None:
            parse_errors.append(f"无法解析线路: {ln}")
            continue
        key = f"{pair[0]}-{pair[1]}"
        all_pairs.add(pair)
        if key == fault_key:
            continue  # 故障线路本身断开
        if st == 0:
            tie_candidates.append({**l, "line": key})
        if st == 1:
            aid, bid = f"BUS-{pair[0]:02d}", f"BUS-{pair[1]:02d}"
            adj.setdefault(aid, []).append(bid); adj.setdefault(bid, []).append(aid)
    if parse_errors:
        warnings.extend(parse_errors[:5])

    # ---- BFS ----
    visited = set(); q = ["BUS-01"]
    while q:
        u = q.pop(0)
        if u in visited: continue
        visited.add(u)
        for v in adj.get(u, []):
            if v not in visited: q.append(v)

    all_ids = {f"BUS-{n.get('node', 0):02d}" for n in nodes}
    outage_nums = [int(x.replace("BUS-", "")) for x in sorted(all_ids - visited)]
    reachable_nums = [int(x.replace("BUS-", "")) for x in sorted(visited)]

    # ---- 边界 ----
    boundary_nodes = []
    boundary_edges = []
    for (a, b) in all_pairs:
        a_live, b_live = a in reachable_nums, b in reachable_nums
        if a_live != b_live:
            boundary_nodes.append(f"{a}-{b}")
            boundary_edges.append({"line": f"{a}-{b}", "source_side": a if a_live else b, "outage_side": b if a_live else a})

    # ---- 候选联络开关 ----
    candidate_tie_switches = []
    seen = set()
    for l in tie_candidates:
        ln = l.get("line", "")
        pair = parse_line_pair(ln)
        if pair is None or ln in seen: continue
        seen.add(ln)
        an, bn = pair
        if (an in reachable_nums) != (bn in reachable_nums):
            candidate_tie_switches.append({
                "line": ln, "from": an, "to": bn, "status": l.get("status", 0),
                "current_a": l.get("current_a", 0), "power_kw": l.get("power_kw", 0),
                "reason": "该联络线连接带电区域与停电区域，可作为转供候选",
            })

    current_total = round(sum(n.get("load_kw", 0) for n in nodes), 2)
    affected_load = round(sum(node_map.get(nid, {}).get("load_kw", 0) for nid in outage_nums), 2)

    # 安全计算 min/max voltage node（节点编号来自 node 字段，非列表索引）
    min_entry = min(nodes, key=lambda n: float(n.get("voltage_pu", 1.0)), default=None)
    max_entry = max(nodes, key=lambda n: float(n.get("voltage_pu", 1.0)), default=None)
    min_v = float(min_entry.get("voltage_pu", 1.0)) if min_entry else 0
    max_v = float(max_entry.get("voltage_pu", 1.0)) if max_entry else 0
    min_v_node = int(min_entry.get("node", 0)) if min_entry else None
    max_v_node = int(max_entry.get("node", 0)) if max_entry else None

    return {
        "success": True, "has_data": True,
        "algorithm_source": "local_fallback",
        "source": "realtime", "source_tag": src_tag, "trusted_source": trusted,
        "timestamp": data.get("timestamp", "") or (realtime_module._last_update or ""),
        "message": "本地 BFS 拓扑分析（仅为拓扑兜底，外部故障分析算法未配置；结果需人工复核）",
        "fault_line": fault_key, "source_node": 1,
        "reachable_nodes": reachable_nums, "outage_nodes": outage_nums,
        "boundary_nodes": boundary_nodes, "boundary_edges": boundary_edges,
        "candidate_tie_switches": candidate_tie_switches,
        "current_total_load_kW": current_total, "affected_load_kW": affected_load,
        "affected_count": len(outage_nums), "reachable_count": len(reachable_nums),
        "powered_nodes": reachable_nums,
        "affected_node_details": [
            {"node": nid, "load_kw": node_map.get(nid, {}).get("load_kw", 0),
             "voltage_pu": node_map.get(nid, {}).get("voltage_pu", 0),
             "pv_kw": node_map.get(nid, {}).get("pv_kw", 0),
             "ev_kw": node_map.get(nid, {}).get("ev_kw", 0),
             "risk_level": node_map.get(nid, {}).get("risk_level", "low")}
            for nid in outage_nums
        ],
        "power_flow_summary": {
            "min_voltage_pu": round(min_v, 4), "min_voltage_node": min_v_node,
            "max_voltage_pu": round(max_v, 4), "max_voltage_node": max_v_node,
        },
        "diagnostics": {"algorithm_source": "local_fallback"},
        "warnings": warnings,
    }


@app.post("/api/fault/analyze-realtime")
def fault_analyze_realtime(req: FaultAnalyzeRealtimeRequest):
    """故障分析统一接口：外部算法优先，不可用时按是否配置分流"""
    data = realtime_module._latest_data
    if data is None or not data.get("nodes"):
        return {
            "success": False, "has_data": False,
            "message": "暂无实时数据，请先接入Simulink数据",
            "warnings": ["暂无实时数据，请先接入Simulink数据"],
        }

    nodes = data.get("nodes", [])
    lines_data = data.get("lines", [])
    fault_str = req.fault_line.strip()
    src_tag = realtime_module._latest_source or "none"
    trusted = realtime_module._latest_trusted or False
    node_map = {n.get("node", 0): n for n in nodes}

    if parse_line_pair(fault_str) is None:
        return {"success": False, "message": f"故障线路格式非法: {fault_str}，需为数字-数字"}
    fault_key = normalize_line_key(fault_str)

    warnings = []
    parse_errors = []
    if not trusted:
        warnings.append("当前数据源未验证，结果需人工复核")

    # ---- IEEE33 算法服务桥接：故障分析 ----
    from app.services.ieee33_algorithm_client import faultAnalyze as algo_fault_analyze
    algo_result = algo_fault_analyze({
        "request_id": f"fault_{datetime.now().strftime('%Y%m%d%H%M%S')}",
        "fault_line": fault_key,
        "timestamp": realtime_module._last_update or "",
        "snapshot": {"nodes": nodes, "lines": lines_data, "switches": data.get("switches", {})},
    })
    if algo_result.available and algo_result.ok:
        ext = algo_result.data
        # 标准化字段：fault_analysis.dead_buses → outage_nodes；fault_analysis.outage_nodes → outage_nodes
        fa = ext.get("fault_analysis") or {}
        outage_raw = (ext.get("outage_nodes") or fa.get("outage_nodes") or
                      fa.get("dead_buses") or ext.get("dead_buses") or [])
        if isinstance(outage_raw, list) and outage_raw:
            outage_nums = [int(x) for x in outage_raw]
            reachable_nums = [i for i in range(1, 34) if i not in outage_nums]
            affected_load = ext.get("affected_load_kw") or fa.get("affected_load_kw") or round(
                sum(node_map.get(nid, {}).get("load_kw", 0) for nid in outage_nums), 2)
            cur_total = round(sum(n.get("load_kw", 0) for n in nodes), 2)
            # 候选联络开关标准化
            cands = (ext.get("candidate_tie_switches") or fa.get("candidate_tie_switches") or
                     ext.get("candidates") or [])
            candidate_tie_switches = []
            for tc in cands:
                tl = tc.get("line") or tc.get("tie_line") or ""
                pair = parse_line_pair(str(tl))
                if pair:
                    candidate_tie_switches.append({
                        "line": f"{pair[0]}-{pair[1]}", "from": pair[0], "to": pair[1],
                        "status": tc.get("status", 0),
                        "current_a": tc.get("current_a") or tc.get("current", 0),
                        "power_kw": tc.get("power_kw") or tc.get("power", 0),
                        "reason": tc.get("reason", "外部算法推荐"),
                    })
            return {
                "success": True, "has_data": True,
                "algorithm_source": "external",
                "source": "realtime", "source_tag": src_tag, "trusted_source": trusted,
                "timestamp": ext.get("timestamp") or realtime_module._last_update or "",
                "message": "基于 IEEE33 算法服务完成故障分析",
                "fault_line": fault_key,
                "fault_analysis": fa,
                "outage_nodes": outage_nums,
                "dead_buses": fa.get("dead_buses") or outage_nums,
                "affected_load_kW": affected_load,
                "service_interruption": ext.get("service_interruption") or fa.get("service_interruption") or False,
                "affected_count": len(outage_nums),
                "reachable_nodes": reachable_nums, "reachable_count": len(reachable_nums),
                "powered_nodes": reachable_nums,
                "boundary_nodes": ext.get("boundary_nodes") or [],
                "boundary_edges": ext.get("boundary_edges") or [],
                "candidate_tie_switches": candidate_tie_switches,
                "current_total_load_kW": cur_total,
                "affected_node_details": [
                    {"node": nid, "load_kw": node_map.get(nid, {}).get("load_kw", 0),
                     "voltage_pu": node_map.get(nid, {}).get("voltage_pu", 0),
                     "pv_kw": node_map.get(nid, {}).get("pv_kw", 0), "ev_kw": node_map.get(nid, {}).get("ev_kw", 0),
                     "risk_level": node_map.get(nid, {}).get("risk_level", "low")}
                    for nid in outage_nums
                ],
                "power_flow_summary": ext.get("power_flow_summary") or {},
                "diagnostics": {**algo_result.to_dict(), "algorithm_source": "external"},
                "warnings": warnings + ([algo_result.warning] if algo_result.warning else []),
            }
        # 返回无有效数据 → 走 fallback

    # 外部已配置但不可用
    if not algo_result.available and algo_result.error != "not_configured":
        return {
            "success": False, "has_data": True,
            "algorithm_source": "external_unavailable",
            "message": "外部故障分析算法服务暂不可用，结果需人工复核",
            "fault_line": fault_key,
            "outage_nodes": [], "candidate_tie_switches": [],
            "diagnostics": algo_result.to_dict(),
            "warnings": warnings + ["外部故障分析算法服务暂不可用，结果需人工复核"],
        }

    # ---- 本地 BFS 拓扑兜底 ----
    warnings.append("外部故障分析算法服务暂不可用，已使用本地拓扑算法兜底，结果需人工复核")
    return _run_local_fault_bfs(data, nodes, lines_data, fault_key, src_tag, trusted, warnings, parse_errors)


# ---- IEEE33 固定拓扑线路（用于节点→关联线路映射）----
_IEEE33_TOPOLOGY_LINES = [
    (1,2),(2,3),(3,4),(4,5),(5,6),(6,7),(7,8),(8,9),(9,10),(10,11),(11,12),
    (12,13),(13,14),(14,15),(15,16),(16,17),(17,18),(2,19),(19,20),(20,21),
    (21,22),(3,23),(23,24),(24,25),(6,26),(26,27),(27,28),(28,29),(29,30),
    (30,31),(31,32),(32,33),(21,8),(9,15),(12,22),(18,33),(25,29),
]
_IEEE33_NODE_LINES_CACHE = {}  # node_id → [line_str, ...]
def _get_related_lines_for_node(node_id: int) -> list:
    if node_id not in _IEEE33_NODE_LINES_CACHE:
        lines = []
        for a, b in _IEEE33_TOPOLOGY_LINES:
            if node_id == a or node_id == b:
                lines.append(f"{min(a,b)}-{max(a,b)}")
        _IEEE33_NODE_LINES_CACHE[node_id] = lines
    return _IEEE33_NODE_LINES_CACHE[node_id]

def _evaluate_realtime_risk(nodes: list, lines_data: list = None) -> list:
    """实时电压风险筛查（第一层：仅电压）"""
    result = []
    for node in nodes:
        node_id = int(node.get("node", 0))
        voltage = float(node.get("voltage_pu") or 1.0)
        load_kw = float(node.get("load_kw") or 0)
        # 电压风险判定
        if voltage < 0.95:
            level, risk_type = "high", "undervoltage"
            reason = f"节点电压 {voltage:.4f} pu，低于0.95 pu"
        elif voltage > 1.05:
            level, risk_type = "high", "overvoltage"
            reason = f"节点电压 {voltage:.4f} pu，高于1.05 pu"
        elif voltage < 0.97:
            level, risk_type = "medium", "voltage_margin"
            reason = f"节点电压 {voltage:.4f} pu，低于关注阈值 0.970 pu"
        elif voltage > 1.03:
            level, risk_type = "medium", "voltage_margin"
            reason = f"节点电压 {voltage:.4f} pu，高于关注阈值 1.030 pu"
        else:
            level, risk_type = "low", "normal"
            reason = "当前电压在正常范围"
        # 关联线路
        related = _get_related_lines_for_node(node_id)
        # 推荐线路：第一条关联线路
        recommended = related[0] if related else None
        result.append({
            "node": node_id,
            "voltage_pu": voltage,
            "load_kw": load_kw,
            "risk_level": level,
            "risk_type": risk_type,
            "reason": reason,
            "related_lines": related,
            "recommended_line": recommended,
        })
    return result


@app.post("/api/boundary/analyze-realtime")
def boundary_analyze_realtime(req: BoundaryAnalyzeRealtimeRequest):
    """边界判定统一接口（扩展 action=scan/evaluate）

    action=scan: 仅返回实时风险筛查节点 + 关联线路，不调边界算法
    action=evaluate: 使用 fault_line 或 selected_related_line 执行边界判定
    """
    data = realtime_module._latest_data
    if data is None or not data.get("nodes"):
        return {"success": False, "has_data": False,
                "message": "暂无实时数据，请先接入Simulink数据",
                "warnings": ["暂无实时数据，请先接入Simulink数据"]}

    nodes = data.get("nodes", [])
    lines_data = data.get("lines", [])
    trusted = realtime_module._latest_trusted or False
    ts_str = realtime_module._last_update or ""
    ti = compute_time_index(ts_str)
    warnings = []
    if not trusted:
        warnings.append("当前数据源未验证，结果需人工复核")

    # ====== 实时风险筛查（scan 和 evaluate 均执行） ======
    risk_nodes = _evaluate_realtime_risk(nodes, lines_data)
    high_nodes = [r for r in risk_nodes if r["risk_level"] == "high"]
    medium_nodes = [r for r in risk_nodes if r["risk_level"] == "medium"]
    low_nodes = [r for r in risk_nodes if r["risk_level"] == "low"]
    risk_summary = {
        "high_count": len(high_nodes),
        "medium_count": len(medium_nodes),
        "low_count": len(low_nodes),
        "total_count": len(risk_nodes),
    }
    snapshot_meta = {
        "timestamp": ts_str,
        "time_index": ti,
        "trusted_source": trusted,
        "node_count": len(nodes),
    }

    # ====== action=scan: 仅返回风险筛查 ======
    if req.action == "scan":
        return {
            "success": True,
            "action": "scan",
            "source": "realtime",
            "snapshot_meta": snapshot_meta,
            "risk_summary": risk_summary,
            "risk_nodes": risk_nodes,
            "selected_scenario": None,
            "boundary_result": None,
            "can_enter_transfer": False,
            "warnings": warnings,
        }

    # ====== action=evaluate: 执行边界判定 ======
    selected_line = req.selected_related_line or req.fault_line
    if not selected_line:
        return {"success": False, "message": "evaluate 模式需提供 fault_line 或 selected_related_line"}

    fault_str = str(selected_line).strip()
    if parse_line_pair(fault_str) is None:
        return {"success": False, "message": f"线路格式非法: {fault_str}，需为数字-数字"}
    fault_key = normalize_line_key(fault_str)

    # ---- 记录用户选择的场景 ----
    selected_scenario = {
        "scenario_id": f"RISK-{datetime.now().strftime('%Y%m%d')}-{req.selected_risk_node or 'DIRECT'}",
        "scenario_type": "preventive_transfer" if req.selected_risk_node else "direct_fault",
        "source_node": req.selected_risk_node,
        "analysis_line": fault_key,
        "risk_source": req.risk_source,
    }

    # ---- IEEE33 算法服务桥接：边界判定 ----
    from app.services.ieee33_algorithm_client import boundaryAnalyze as algo_boundary
    algo_result = algo_boundary({
        "request_id": f"bnd_{datetime.now().strftime('%Y%m%d%H%M%S')}",
        "fault_line": fault_key,
        "timestamp": ts_str,
    })
    boundary_result = None
    can_enter_transfer = False
    if algo_result.available and algo_result.ok:
        ext = algo_result.data
        bnd = ext.get("boundary") or {}
        energized = (bnd.get("energized_boundary_nodes") or bnd.get("energized_boundary_buses") or [])
        outage_b = (bnd.get("outage_boundary_nodes") or bnd.get("dead_boundary_buses") or
                     bnd.get("outage_boundary_buses") or [])
        b_nodes = ext.get("boundary_nodes") or bnd.get("boundary_nodes") or []
        if not b_nodes and (energized or outage_b):
            b_nodes = []
            for eb in (energized if isinstance(energized, list) else []):
                b_nodes.append({"energized_bus": eb, "side": "energized"})
            for ob in (outage_b if isinstance(outage_b, list) else []):
                existing = [n for n in b_nodes if n.get("outage_bus") == ob]
                if existing:
                    existing[0]["outage_bus"] = ob
                else:
                    b_nodes.append({"outage_bus": ob, "side": "outage"})
        crossing = ext.get("crossing_ties") or bnd.get("crossing_ties") or []
        boundary_result = {
            "algorithm_source": "external",
            "fault_line": fault_key,
            "boundary": bnd,
            "energized_boundary_nodes": energized,
            "outage_boundary_nodes": outage_b,
            "boundary_nodes": b_nodes,
            "crossing_ties": crossing,
            "diagnostics": {**algo_result.to_dict(), "algorithm_source": "external"},
        }
        can_enter_transfer = len(crossing) > 0
        warnings.append(algo_result.warning) if algo_result.warning else None
    elif not algo_result.available and algo_result.error != "not_configured":
        warnings.append("外部边界判定算法服务暂不可用，结果需人工复核")
    else:
        # 本地拓扑兜底
        warnings.append("外部边界判定算法服务暂不可用，已使用本地拓扑算法兜底")
        b_nodes, b_lines, crossing = [], [], []
        try:
            adj = {}; all_pairs = set()
            for l in lines_data:
                ln = l.get("line", ""); st = l.get("status", 1)
                pair = parse_line_pair(ln)
                if pair is None: continue
                key = f"{pair[0]}-{pair[1]}"
                all_pairs.add(pair)
                if key == fault_key: continue
                if st == 1:
                    aid, bid = f"BUS-{pair[0]:02d}", f"BUS-{pair[1]:02d}"
                    adj.setdefault(aid, []).append(bid); adj.setdefault(bid, []).append(aid)
            visited = set(); q = ["BUS-01"]
            while q:
                u = q.pop(0)
                if u in visited: continue
                visited.add(u)
                for v in adj.get(u, []):
                    if v not in visited: q.append(v)
            reachable = {int(x.replace("BUS-", "")) for x in visited}
            for l in lines_data:
                ln = l.get("line", ""); pair = parse_line_pair(ln)
                if pair is None: continue
                a, b = pair
                if (a in reachable) != (b in reachable):
                    b_nodes.append({"energized_bus": a if a in reachable else b,
                                    "outage_bus": b if a in reachable else a})
                    b_lines.append({"line": f"{a}-{b}",
                                    "source_side": a if a in reachable else b,
                                    "outage_side": b if a in reachable else a})
                if l.get("status", 1) == 0:
                    key = f"{a}-{b}"
                    if (a in reachable) != (b in reachable):
                        crossing.append({"line": key, "from": a, "to": b, "status": 0})
        except Exception:
            pass
        boundary_result = {
            "algorithm_source": "local_fallback",
            "fault_line": fault_key,
            "boundary_nodes": b_nodes,
            "crossing_ties": crossing,
        }
        can_enter_transfer = len(crossing) > 0

    return {
        "success": True,
        "action": "evaluate",
        "source": "realtime",
        "snapshot_meta": snapshot_meta,
        "risk_summary": risk_summary,
        "risk_nodes": risk_nodes,
        "selected_scenario": selected_scenario,
        "boundary_result": boundary_result,
        "can_enter_transfer": can_enter_transfer,
        "warnings": warnings,
    }


@app.post("/api/transfer/recommend-realtime")
def transfer_recommend_realtime(req: TransferRecommendRealtimeRequest):
    """转供决策统一接口：外部算法优先，不可用时返回本地拓扑候选（非评分推荐）"""
    data = realtime_module._latest_data
    if data is None or not data.get("nodes"):
        return {"success": False, "has_data": False,
                "message": "暂无实时数据，请先接入Simulink数据",
                "warnings": ["暂无实时数据，请先接入Simulink数据"]}

    nodes = data.get("nodes", [])
    lines_data = data.get("lines", [])
    fault_str = req.fault_line.strip()
    if parse_line_pair(fault_str) is None:
        return {"success": False, "message": f"故障线路格式非法: {fault_str}，需为数字-数字"}
    fault_key = normalize_line_key(fault_str)
    outage_nums = list(req.outage_nodes or [])
    boundary_nums = list(req.boundary_nodes or [])
    trusted = realtime_module._latest_trusted or False

    warnings = []
    if not trusted:
        warnings.append("当前数据源未验证，结果需人工复核")

    # ---- IEEE33 算法服务桥接：pipeline/evaluate（异步任务）----
    from app.services.ieee33_algorithm_client import submitPipelineEvaluate as algo_pipeline
    ti = compute_time_index(realtime_module._last_update or "")
    pipeline_payload = {
        "request_id": f"tr_{datetime.now().strftime('%Y%m%d%H%M%S')}",
        "fault_line": fault_key,
        "outage_nodes": outage_nums,
        "timestamp": realtime_module._last_update or "",
        "time_index": ti,
        "evaluation_mode": "auto",
        "allow_nearest_library_time": True,
        "max_ties": 2,
        "snapshot": {
            "timestamp": realtime_module._last_update or "",
            "time_index": ti,
            "nodes": nodes, "lines": lines_data,
            "switches": data.get("switches", {}),
        },
    }
    algo_result = algo_pipeline(pipeline_payload)
    if algo_result.available and algo_result.ok:
        ext = algo_result.data
        # 标准化候选方案
        cands = (ext.get("candidate_tie_switches") or ext.get("candidate_plans") or
                 ext.get("candidates") or [])
        cand_plans = ext.get("candidate_plans") or cands
        # 推荐方案：有完整对象直接用；只有 plan_id 则从 candidate_plans 中查找
        rec = ext.get("recommended_plan") or None
        rec_id = ext.get("recommended_plan_id") or (rec.get("plan_id") if isinstance(rec, dict) else None)
        if not isinstance(rec, dict) and rec_id and isinstance(cand_plans, list):
            for cp in cand_plans:
                if str(cp.get("plan_id") or cp.get("id") or "") == str(rec_id):
                    rec = cp
                    break
        # switching_plan 补全：如果候选方案有 tie_lines 但没有 switching_plan，临时生成
        for cp in (cand_plans if isinstance(cand_plans, list) else []):
            if not cp.get("switching_plan") and cp.get("tie_lines"):
                cp["switching_plan"] = {
                    "open_lines": [fault_key],
                    "close_lines": cp["tie_lines"],
                }
                warnings.append("算法服务未显式返回 switching_plan，业务后端根据 fault_line 和 tie_lines 生成临时 switching_plan，需复核")
        if isinstance(cands, list) and cands:
            return {
                "success": True, "has_data": True,
                "algorithm_source": "external",
                "fault_analysis": ext.get("fault_analysis") or {},
                "boundary": ext.get("boundary") or {},
                "candidate_tie_switches": cands,
                "candidate_plans": cand_plans,
                "recommended_plan": rec,
                "recommended_plan_id": rec_id,
                "fault_line": fault_key,
                "outage_nodes": outage_nums,
                "diagnostics": {**algo_result.to_dict(), "algorithm_source": "external"},
                "warnings": warnings + ([algo_result.warning] if algo_result.warning else []),
            }

    if not algo_result.available and algo_result.error != "not_configured":
        from app.services.ieee33_algorithm_client import ALGO_JOB_TIMEOUT_MS as _jt_ms
        job_id = algo_result.data.get("job_id") or ""
        if algo_result.error in ("job_timeout", "job_status_fetch_failed") and job_id:
            # pipeline 已提交但轮询超时 → pending，保留 job_id 供后续查询
            return {
                "success": True, "has_data": True,
                "algorithm_source": "external_pending",
                "status": "pending",
                "job_id": job_id,
                "fault_line": fault_key, "outage_nodes": outage_nums,
                "candidate_tie_switches": [], "candidate_plans": [],
                "recommended_plan": None, "recommended_plan_id": None,
                "switching_plan": None,
                "diagnostics": {**algo_result.to_dict(), "algorithm_source": "external_pending"},
                "warnings": warnings + [
                    "转供决策任务仍在计算中，请稍后继续查询",
                    f"可调用 GET /api/transfer/jobs/{job_id} 查询任务状态",
                    f"可调用 GET /api/transfer/jobs/{job_id}/result 获取结果",
                    "结果需人工复核",
                ],
            }
        # job_failed / timeout (无 job_id) / connection_error → 降级本地拓扑候选
        w = warnings + ["外部转供决策算法服务暂不可用，未生成可信推荐方案"]
        if job_id:
            w.append(f"已提交任务 job_id={job_id}，但执行失败，已降级为本地规则评估")
        else:
            w.append("算法服务不可用，已降级为本地规则评估")
        # 不立即返回，继续执行下面的本地拓扑候选兜底
        warnings = w

    # ---- 本地拓扑候选兜底（仅标注 topology_candidate，不是推荐方案）----
    topology_cands = []
    try:
        adj = {}; all_pairs = set()
        for l in lines_data:
            ln = l.get("line", ""); st = l.get("status", 1)
            pair = parse_line_pair(ln)
            if pair is None: continue
            key = f"{pair[0]}-{pair[1]}"
            all_pairs.add(pair)
            if key == fault_key: continue
            if st == 1:
                aid, bid = f"BUS-{pair[0]:02d}", f"BUS-{pair[1]:02d}"
                adj.setdefault(aid, []).append(bid); adj.setdefault(bid, []).append(aid)
        visited = set(); q = ["BUS-01"]
        while q:
            u = q.pop(0)
            if u in visited: continue
            visited.add(u)
            for v in adj.get(u, []):
                if v not in visited: q.append(v)
        reachable = {int(x.replace("BUS-", "")) for x in visited}
        outage_set = set(outage_nums)
        for l in lines_data:
            ln = l.get("line", "")
            pair = parse_line_pair(ln)
            if pair is None: continue
            key = f"{pair[0]}-{pair[1]}"
            if key == fault_key: continue
            if l.get("status", 1) == 0:
                a_live = pair[0] in reachable
                b_live = pair[1] in reachable
                if a_live != b_live:
                    topology_cands.append({
                        "line": key,
                        "from": pair[0], "to": pair[1],
                        "status": 0,
                        "type": "topology_candidate",
                        "caveat": "仅为拓扑候选，不是评分推荐方案；请使用 evaluate-realtime 获取完整评分",
                    })
    except Exception:
        pass

    return {
        "success": True, "has_data": True,
        "algorithm_source": "local_fallback",
        "fault_line": fault_key, "outage_nodes": outage_nums, "boundary_nodes": boundary_nums,
        "candidate_tie_switches": topology_cands,
        "recommended_plan": None,
        "switching_plan": None,
        "message": "本地拓扑候选兜底（仅为拓扑候选，外部转供决策算法未配置；请使用 evaluate-realtime 获取完整评分推荐）",
        "diagnostics": {"algorithm_source": "local_fallback", "candidate_type": "topology_only"},
        "warnings": warnings,
    }


# ==================== 算法任务状态查询（包装外部 /api/v1/jobs，不暴露 Key）====================

@app.get("/api/transfer/jobs/{job_id}")
def transfer_job_status(job_id: str):
    """查询转供决策异步任务状态（包装 GET /api/v1/jobs/{job_id}）"""
    from app.services.ieee33_algorithm_client import getJob
    # 已完成状态列表（外部服务可能使用不同命名）
    COMPLETED_STATES = ("completed", "done", "success", "succeeded")
    r = getJob(job_id)
    if r.ok:
        raw_state = (r.data.get("status") or r.data.get("state") or "unknown").lower()
        # 归一化：succeeded → completed
        normalized = "completed" if raw_state in COMPLETED_STATES else raw_state
        return {
            "success": True,
            "algorithm_source": "external",
            "job_id": job_id,
            "status": normalized,
            "data": r.data,
            "warnings": [r.warning] if r.warning else [],
        }
    return {
        "success": False,
        "algorithm_source": "external_unavailable",
        "job_id": job_id,
        "status": "unknown",
        "diagnostics": r.to_dict(),
        "warnings": ["无法查询算法任务状态，服务不可用或未配置", "结果需人工复核"],
    }


@app.get("/api/transfer/jobs/{job_id}/result")
def transfer_job_result(job_id: str):
    """查询转供决策异步任务结果（包装 GET /api/v1/jobs/{job_id}/result）

    修正逻辑：
    - 识别 succeeded 为 completed
    - 提取 candidate_scores → 按 tie_lines 映射到 candidate_plans 形成 scored_plans
    - HTTP 200 但 body.success=false → status=failed
    """
    from app.services.ieee33_algorithm_client import getJob, getJobResult
    COMPLETED_STATES = ("completed", "done", "success", "succeeded")
    # 先查状态
    status_r = getJob(job_id)
    if status_r.ok:
        state = (status_r.data.get("status") or status_r.data.get("state") or "").lower()
        if state not in COMPLETED_STATES:
            return {
                "success": True,
                "algorithm_source": "external_pending",
                "job_id": job_id,
                "status": "pending",
                "job_state": state,
                "result_available": False,
                "candidate_tie_switches": None, "candidate_plans": None,
                "recommended_plan": None, "recommended_plan_id": None,
                "switching_plan": None,
                "warnings": ["转供决策任务仍在计算中，请稍后继续查询"],
            }
    # 查询结果
    result_r = getJobResult(job_id)
    if result_r.ok:
        ext = result_r.data
        ext_success = ext.get("success")
        ext_error = ext.get("error") or ""
        if ext_success is False:
            error_type = "matpower_failed" if ("matpower" in ext_error.lower() or "exit" in ext_error.lower()) else "job_failed"
            return {
                "success": False,
                "algorithm_source": "external_unavailable",
                "job_id": job_id,
                "status": "failed",
                "error_type": error_type,
                "error_message": ext_error,
                "candidate_plans": None,
                "recommended_plan": None, "recommended_plan_id": None,
                "warnings": [
                    "外部潮流评分失败：" + ext_error,
                    "当前仅展示候选方案/规则版预评估，需人工复核",
                ],
            }
        # ====== 成功：提取 candidate_scores 并映射到 candidate_plans ======
        candidate_plans = ext.get("candidate_plans") or []
        candidate_scores = ext.get("candidate_scores") or []
        ext_recommended_id = ext.get("recommended_plan_id") or ""

        # 构建 tie_lines → plan_id 的查表（候选方案）
        candidate_by_tie = {}
        for cp in candidate_plans:
            if not isinstance(cp, dict): continue
            tls = cp.get("tie_lines") or []
            key = frozenset(tls)
            if key: candidate_by_tie[key] = cp.get("plan_id") or cp.get("algorithm_plan_id") or ""

        # 将 candidate_scores 转换为 scored_plans，同时做 plan_id 映射
        scored_plans = []
        mapped_recommended_id = ""
        for cs in candidate_scores:
            if not isinstance(cs, dict): continue
            tls = cs.get("tie_lines") or []
            score_id = cs.get("plan_id") or ""
            # 按 tie_lines 匹配候选方案
            matched_cand_id = candidate_by_tie.get(frozenset(tls)) or ""
            # 降级：按编号后缀匹配 (ALG-SCORE-001 → ALG-001)
            if not matched_cand_id and score_id:
                import re
                m = re.search(r'(\d+)$', str(score_id))
                if m:
                    suffix = m.group(1)
                    for cp in candidate_plans:
                        cid = cp.get("plan_id") or ""
                        if cid.endswith(suffix) and "SCORE" not in str(cid):
                            matched_cand_id = cid
                            break
            mapped_id = matched_cand_id or score_id
            # 映射 recommended_plan_id
            if ext_recommended_id and score_id == ext_recommended_id:
                mapped_recommended_id = mapped_id
            # 提取评分指标
            pf = cs.get("power_flow") or {}
            sb = cs.get("score_breakdown") or {}
            scored_plans.append({
                "plan_id": mapped_id,
                "source_score_id": score_id,
                "score": cs.get("score"),
                "rank": cs.get("rank"),
                "score_source": "external_powerflow",
                "external_score_used": True,
                "power_flow": {
                    "converged": pf.get("converged"),
                    "min_voltage_pu": pf.get("min_voltage_pu"),
                    "max_loading_pct": pf.get("max_loading_pct"),
                    "loss_kw": pf.get("loss_kw"),
                },
                "score_breakdown": {
                    "recovery_score": round((sb.get("restoration_rate") or {}).get("total_weight", 0) * 50, 1) if sb.get("restoration_rate") else None,
                    "voltage_score": round((sb.get("voltage_quality") or {}).get("weight", 0) * 100, 1) if sb.get("voltage_quality") else None,
                    "loading_score": round((sb.get("line_loading") or {}).get("weight", 0) * 100, 1) if sb.get("line_loading") else None,
                    "loss_score": round((sb.get("loss") or {}).get("weight", 0) * 100, 1) if sb.get("loss") else None,
                    "operation_score": round((sb.get("operation_complexity") or {}).get("weight", 0) * 100, 1) if sb.get("operation_complexity") else None,
                    "total_score": cs.get("score"),
                    "total_max": 100,
                },
                "min_restored_voltage_pu": pf.get("min_voltage_pu"),
                "voltage_ok": pf.get("min_voltage_pu") is not None and pf.get("min_voltage_pu", 0) >= 0.95,
                "tie_loading_pct": pf.get("max_loading_pct"),
                "overloaded": pf.get("max_loading_pct") is not None and pf.get("max_loading_pct", 0) > 100.0,
                "is_usable": True,
                "violations": cs.get("violations") or [],
                "warnings": cs.get("warnings") or [],
            })
        # 如果 scored_plans 未通过 tie_lines 匹配到，也保留原始 candidate_plans 中已匹配的
        return {
            "success": True,
            "algorithm_source": "external",
            "job_id": job_id,
            "status": "completed",
            "score_source": "external_powerflow",
            "result_available": True,
            "candidate_tie_switches": ext.get("candidate_tie_switches") or ext.get("candidates") or [],
            "candidate_plans": candidate_plans,
            "scored_plans": scored_plans,
            "recommended_plan_id": mapped_recommended_id or ext_recommended_id,
            "warnings": (ext.get("warnings") or []) + ([result_r.warning] if result_r.warning else []),
        }
    # HTTP 非 200
    diag = result_r.to_dict()
    err = diag.get("error") or ""
    if err == "timeout":
        return {
            "success": False,
            "algorithm_source": "external_unavailable",
            "job_id": job_id,
            "status": "timeout",
            "error_type": "timeout",
            "candidate_plans": None,
            "warnings": ["外部算法服务响应超时，评分结果未就绪，需人工复核"],
        }
    if err == "connection_error":
        return {
            "success": False,
            "algorithm_source": "external_unavailable",
            "job_id": job_id,
            "status": "failed",
            "error_type": "connection_error",
            "candidate_plans": None,
            "warnings": ["外部算法服务暂不可用，无法获取评分结果，需人工复核"],
        }
    return {
        "success": False,
        "algorithm_source": "external_unavailable",
        "job_id": job_id,
        "status": "unknown",
        "diagnostics": diag,
        "warnings": ["无法获取算法任务结果，服务不可用或任务未完成", "结果需人工复核"],
    }


@app.post("/api/transfer/evaluate-realtime")
def transfer_evaluate_realtime(req: TransferEvaluateRealtimeRequest):
    """基于实时故障分析结果，评估并排序转供方案"""
    data = realtime_module._latest_data
    if data is None or not data.get("nodes"):
        return {
            "success": False, "has_data": False,
            "message": "暂无实时数据，请先接入Simulink数据",
            "warnings": ["暂无实时数据，请先接入Simulink数据"],
        }

    nodes = data.get("nodes", [])
    lines_data = data.get("lines", [])
    fault_str = req.fault_line.strip()
    src_tag = realtime_module._latest_source or "none"
    trusted = realtime_module._latest_trusted or False
    node_map = {n.get("node", 0): n for n in nodes}

    # 校验并归一化 fault_line（"9-8" 与 "8-9" 等价）
    if parse_line_pair(fault_str) is None:
        return {"success": False, "message": f"故障线路格式非法: {fault_str}，需为数字-数字"}
    fault_key = normalize_line_key(fault_str)

    warnings = []
    if not trusted:
        warnings.append("当前数据源未验证，结果需人工复核")

    # ---- 构建故障后基础图（线路键全部归一化，故障线路强制断开）----
    base_adj = {}
    base_pairs = set()   # status=1 且非故障线的归一化节点对（供辐射性校验计数）
    tie_lines = []       # status=0 的联络线候选（已排除故障线路本身）
    seen_tie_keys = set()
    parse_errors = []

    for l in lines_data:
        ln = l.get("line", "")
        st = l.get("status", 1)
        pair = parse_line_pair(ln)
        if pair is None:
            if str(ln).strip():
                parse_errors.append(f"无法解析线路: {ln}")
            continue
        key = f"{pair[0]}-{pair[1]}"
        if key == fault_key:
            # 故障线路本身：从基础图断开，且不得作为联络候选（即使 status=0）
            continue
        if st == 0 and key not in seen_tie_keys:
            seen_tie_keys.add(key)
            tie_lines.append({**l, "line": key, "from": pair[0], "to": pair[1]})
        if st == 1 and pair not in base_pairs:
            base_pairs.add(pair)
            aid, bid = f"BUS-{pair[0]:02d}", f"BUS-{pair[1]:02d}"
            base_adj.setdefault(aid, []).append(bid)
            base_adj.setdefault(bid, []).append(aid)

    # ---- 静态联络线兜底 ----
    STATIC_TIES = [(8,21),(9,15),(12,22),(18,33),(25,29)]
    static_tie_fallback_used = False
    if parse_errors:
        warnings.extend(parse_errors[:5])
    if not tie_lines:
        static_tie_fallback_used = True
        warnings.append("实时数据未包含全部 IEEE33 联络线，已使用静态联络线定义补充候选方案，结果需结合现场开关状态复核")
        for ta, tb in STATIC_TIES:
            key = f"{ta}-{tb}"
            if key == fault_key:
                continue
            # 静态兜底无实测值：current_a/power_kw 置 None，前端显示"待潮流校验"
            tie_lines.append({"line": key, "status": 0, "current_a": None, "power_kw": None, "from": ta, "to": tb})

    # ---- BFS 辅助函数 ----
    def bfs(adj, start="BUS-01"):
        visited = set()
        q = [start]
        while q:
            u = q.pop(0)
            if u in visited:
                continue
            visited.add(u)
            for v in adj.get(u, []):
                if v not in visited:
                    q.append(v)
        return visited

    def component_is_radial(pairs, visited_ids):
        """辐射性校验：BFS 可达分量为树 ⟺ 分量内边数 == 节点数 - 1（否则成环）"""
        visited_nums = {int(x.replace("BUS-", "")) for x in visited_ids}
        edge_count = sum(1 for (a, b) in pairs if a in visited_nums and b in visited_nums)
        return edge_count == max(len(visited_nums) - 1, 0)

    # ---- 故障后可达节点 ----
    fault_reachable = bfs(base_adj)
    all_ids = {f"BUS-{n.get('node', 0):02d}" for n in nodes}
    outage_ids = all_ids - fault_reachable
    outage_nums = sorted([int(x.replace("BUS-", "")) for x in outage_ids])
    reachable_nums = sorted([int(x.replace("BUS-", "")) for x in fault_reachable])

    total_load = round(sum(n.get("load_kw", 0) for n in nodes), 2)
    outage_load = round(sum(node_map.get(nid, {}).get("load_kw", 0) for nid in outage_nums), 2)

    # ---- 识别可用的跨区联络开关（线路键已归一化、已排除故障线路）----
    candidates = []
    for tl in tie_lines:
        ln = tl.get("line", "")
        pair = parse_line_pair(ln)
        if pair is None:
            continue
        an, bn = pair
        aid, bid = f"BUS-{an:02d}", f"BUS-{bn:02d}"
        a_live = aid in fault_reachable
        b_live = bid in fault_reachable
        if a_live != b_live:  # 跨带电/停电区
            candidates.append({
                "line": ln,
                "from": an, "to": bn,
                "live_side": an if a_live else bn,
                "outage_side": bn if a_live else an,
                "data": tl,
            })

    # ---- 统一评估函数（单/双联络开关共用，含辐射性与逐线过载校验）----
    def evaluate_plan(plan_ties):
        plan_warnings = []

        # 模拟闭合方案内联络开关（trial_pairs 同步维护，供辐射性校验计数）
        trial_adj = {k: list(v) for k, v in base_adj.items()}
        trial_pairs = set(base_pairs)
        for c in plan_ties:
            pair = (min(c["from"], c["to"]), max(c["from"], c["to"]))
            if pair in trial_pairs:
                continue
            trial_pairs.add(pair)
            aid, bid = f"BUS-{pair[0]:02d}", f"BUS-{pair[1]:02d}"
            trial_adj.setdefault(aid, []).append(bid)
            trial_adj.setdefault(bid, []).append(aid)

        trial_reachable = bfs(trial_adj)
        restored_ids = trial_reachable - fault_reachable
        restored_nums = sorted(int(x.replace("BUS-", "")) for x in restored_ids)
        still_outage_ids = all_ids - trial_reachable

        restored_load = round(sum(node_map.get(nid, {}).get("load_kw", 0) for nid in restored_nums), 2)
        restoration_rate = round(restored_load / outage_load * 100, 1) if outage_load > 0 else 0

        # ---- 恢复区电压评估 ----
        # 注意：快照中的停电节点电压可能是失电实测值（≈0），不代表转供后电压；
        # 低于 0.5pu 的读数视为失电态，排除后若无有效读数 → 电压待潮流校验（不武断否决）
        r_volts = [node_map.get(nid, {}).get("voltage_pu", 1.0) for nid in restored_nums]
        valid_volts = [v for v in r_volts if v is not None and v >= 0.5]
        if valid_volts:
            min_restored_v = round(min(valid_volts), 4)
            voltage_ok = min_restored_v >= 0.95
        else:
            min_restored_v = None
            voltage_ok = None  # 未知：快照电压均为失电态实测值
            if restored_nums:
                plan_warnings.append("停电区快照电压为失电状态实测值，转供后电压待潮流校验")

        # ---- 辐射性（成环）校验 ----
        radial_ok = component_is_radial(trial_pairs, trial_reachable)
        if not radial_ok:
            plan_warnings.append("该方案可能形成环网，需增加解环开关操作后方可执行")

        # ---- 逐线转供功率估算 ----
        # 单联络线：全部恢复负荷经该线转供；
        # 双联络线：若两线各自独供互不相交区域，逐线取各自单独恢复的负荷；
        #           若供电区域交叠或成环，潮流分配无法可靠估算 → loading_rate=None（待潮流校验）
        if len(plan_ties) == 1:
            per_tie_kw = {plan_ties[0]["line"]: restored_load}
        else:
            solo_sets = []
            for c in plan_ties:
                solo_adj = {k: list(v) for k, v in base_adj.items()}
                aid, bid = f"BUS-{c['from']:02d}", f"BUS-{c['to']:02d}"
                solo_adj.setdefault(aid, []).append(bid)
                solo_adj.setdefault(bid, []).append(aid)
                solo_sets.append(bfs(solo_adj) - fault_reachable)
            if radial_ok and solo_sets[0].isdisjoint(solo_sets[1]):
                per_tie_kw = {}
                for c, s in zip(plan_ties, solo_sets):
                    nums = [int(x.replace("BUS-", "")) for x in s]
                    per_tie_kw[c["line"]] = round(sum(node_map.get(nid, {}).get("load_kw", 0) for nid in nums), 2)
            else:
                per_tie_kw = {c["line"]: None for c in plan_ties}

        # ---- 逐线过载校验（实时额定值优先，其次静态容量表；均无 → 待潮流校验）----
        # 注：当前 /api/realtime/update 的 LineItem 模式暂不透传 rated_kw/capacity_kw，
        #     此链路为实时额定值接入预留；额定值 <=0 或非法一律按未知处理，不得回退错误容量
        tie_loading_detail = []
        overloaded = False
        max_loading_rate = None
        any_loading_unknown = False
        for c in plan_ties:
            key = c["line"]
            est_kw = per_tie_kw.get(key)
            raw_limit = c["data"].get("rated_kw")
            if raw_limit is None:
                raw_limit = c["data"].get("capacity_kw")
            if raw_limit is None:
                raw_limit = TIE_LINE_LIMITS_KW.get(key)
            try:
                limit_kw = float(raw_limit) if raw_limit is not None else None
            except Exception:
                limit_kw = None
            if limit_kw is not None and limit_kw <= 0:
                limit_kw = None
            if est_kw is None or limit_kw is None:
                any_loading_unknown = True
                tie_loading_detail.append({"line": key, "estimated_transfer_kw": est_kw,
                                           "limit_kw": limit_kw, "loading_rate": None})
                plan_warnings.append(f"联络线 {key} 负载率待潮流校验（容量或转供功率未知）")
                continue
            rate = round(est_kw / limit_kw, 4)
            tie_loading_detail.append({"line": key, "estimated_transfer_kw": est_kw,
                                       "limit_kw": limit_kw, "loading_rate": rate})
            if rate > 1.0:
                overloaded = True
                plan_warnings.append(f"联络线 {key} 预计转供 {est_kw}kW，超过容量 {limit_kw}kW，存在过载风险")
            if max_loading_rate is None or rate > max_loading_rate:
                max_loading_rate = rate

        # ---- 100分制评分 ----
        recovery_score = round(45 * restoration_rate / 100.0, 2)

        if max_loading_rate is None:
            loading_pct = None
            loading_score = 10.0
            loading_score_source = "unknown_neutral"
        else:
            loading_pct = round(max_loading_rate * 100, 1)
            if loading_pct <= 80:
                loading_score = 20.0
                loading_score_source = "normal"
            elif loading_pct <= 100:
                loading_score = round(20 * (1.0 - (loading_pct - 80) / 20), 2)
                loading_score_source = "elevated"
            else:
                loading_score = 0.0
                loading_score_source = "overload"
        # 双线方案中只要有一条线负载未知，整体负载率显示为"待潮流校验"，避免掩盖未校验线路
        if any_loading_unknown and not overloaded:
            loading_pct = None

        if min_restored_v is None:
            voltage_score = 10.0  # 电压未知：中性分，待潮流校验
        elif min_restored_v >= 0.97:
            voltage_score = 20.0
        elif min_restored_v >= 0.95:
            voltage_score = round(20 * (min_restored_v - 0.95) / 0.02, 2)
        else:
            voltage_score = 0.0

        full_restore_bonus = 5.0 if len(still_outage_ids) == 0 else 0.0
        operation_score = 10.0 if len(plan_ties) == 1 else 8.0
        total_score = round(recovery_score + loading_score + voltage_score + operation_score + full_restore_bonus, 2)

        is_usable = radial_ok and not overloaded
        tie_keys = [c["line"] for c in plan_ties]

        return {
            "rank": 0,
            "score": total_score,
            "score_breakdown": {
                "recovery_score": recovery_score, "recovery_max": 45,
                "loading_score": loading_score, "loading_max": 20, "loading_score_source": loading_score_source,
                "voltage_score": voltage_score, "voltage_max": 20,
                "operation_score": operation_score, "operation_max": 10,
                "full_restore_bonus": full_restore_bonus, "full_restore_bonus_max": 5,
                "total_score": total_score, "total_max": 100,
            },
            "tie_switch": "+".join(tie_keys),
            "tie_name": "+".join(TIE_NAME_MAP.get(k, k) for k in tie_keys),
            "tie_lines": tie_keys,
            "from": plan_ties[0]["from"], "to": plan_ties[0]["to"],
            "restored_nodes": restored_nums,
            "restored_count": len(restored_nums),
            "restored_load_kw": restored_load,
            "restoration_rate_pct": restoration_rate,
            "still_outage_nodes": sorted([int(x.replace("BUS-", "")) for x in still_outage_ids]),
            "still_outage_count": len(still_outage_ids),
            "min_restored_voltage_pu": min_restored_v,
            "voltage_ok": voltage_ok,
            "radial_ok": radial_ok,
            "overloaded": overloaded,
            "is_usable": is_usable,
            "tie_loading_pct": loading_pct,
            "tie_loading_detail": tie_loading_detail,
            # 联络开关合闸前电流/功率对方案无参考意义，置 None（前端显示"待潮流校验"）
            "tie_current_a": None,
            "tie_power_kw": None,
            "switch_operations": len(plan_ties),
            "warnings": plan_warnings,
            # 评分来源（默认本地规则；匹配外部评分后被覆盖）
            "score_source": "local_rule",
            "external_score_used": False,
            "external_rank": None,
            "power_flow": None,
            "violations": [],
        }

    # ---- 单联络开关方案 ----
    plans = [evaluate_plan([c]) for c in candidates]

    # ---- 双联络开关组合方案 ----
    if len(candidates) >= 2:
        for i in range(len(candidates)):
            for j in range(i + 1, len(candidates)):
                plans.append(evaluate_plan([candidates[i], candidates[j]]))

    # ---- 外部算法桥接：优先调用 candidates/generate → 过滤 → 评分 ----
    # 安全初始化，防止 diagnostics 合并时引用未定义变量
    from app.services.ieee33_algorithm_client import candidatesGenerate as algo_candidates, AlgoResult as IeeeAlgoResult
    algo_transfer_result = IeeeAlgoResult(available=False, error="not_configured")
    algo_transfer_result = algo_candidates({
        "request_id": f"ev_{datetime.now().strftime('%Y%m%d%H%M%S')}",
        "fault_line": fault_key,
        "timestamp": realtime_module._last_update or "",
    }, timeout_ms=5000)
    ext_candidates_source = "local_rule"
    if algo_transfer_result.available and algo_transfer_result.ok:
        algo_data = algo_transfer_result.data
        raw_cands = algo_data.get("candidates") or algo_data.get("candidate_plans") or []
        if isinstance(raw_cands, list) and raw_cands:
            feasible = []; rejected = []
            for rc in raw_cands:
                if not isinstance(rc, dict): continue
                pid = str(rc.get("plan_id") or rc.get("algorithm_plan_id") or "").strip()
                tids = rc.get("tie_ids") or rc.get("tie_branch_indices") or []
                tlines = rc.get("tie_lines") or []
                restored = rc.get("restored_buses") or rc.get("restored_nodes") or []
                topo_ok = rc.get("topology_feasible")
                radial_ok = rc.get("radial")
                cycle = rc.get("cycle_count")
                is_ok = (topo_ok is True and radial_ok is True and cycle == 0)
                item = {
                    "plan_id": pid,
                    "tie_ids": tids if isinstance(tids, list) else [tids],
                    "tie_lines": tlines if isinstance(tlines, list) else [tlines],
                    "restored_nodes": restored if isinstance(restored, list) else [restored],
                    "topology_feasible": topo_ok, "radial": radial_ok, "cycle_count": cycle,
                    "is_feasible": is_ok,
                    "source": "external_candidates",
                    "score_source": "external_candidates",
                }
                if is_ok:
                    feasible.append(item)
                else:
                    item["reject_reason"] = "形成环网，不满足辐射状运行约束" if not radial_ok and cycle > 0 else "拓扑不可行"
                    rejected.append(item)
            if feasible:
                ext_candidates_source = "external_candidates"
                # 将可行外部候选方案归一化为 candidate_scores 写入缓存，供下方合并逻辑处理
                norm_scores = []
                for item in feasible:
                    norm_scores.append({
                        "plan_id": item["plan_id"],
                        "tie_lines": item["tie_lines"],
                        "tie_ids": item["tie_ids"],
                        "score_source": "external_candidates",
                        "is_feasible": True,
                    })
                global _external_score_result
                _external_score_result = {
                    "fault_line": fault_key,
                    "timestamp": algo_data.get("timestamp") or datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                    "algorithm": algo_data.get("algorithm") or "external_algo",
                    "algorithm_version": algo_data.get("algorithm_version") or "",
                    "candidate_scores": norm_scores,
                    "feasible_candidates": feasible,
                    "rejected_candidates": rejected,
                    "received_at": datetime.now(),
                }
            # 外部候选结果写入 warnings
            if not feasible:
                warnings.append("外部候选方案接口返回了候选方案，但均不满足拓扑可行性条件")
        else:
            warnings.append("外部候选方案接口返回为空，使用本地规则版预评估")
    else:
        warnings.append("外部候选方案接口暂不可用，当前使用规则版预评估")

    # ---- 合并外部高级评分（MATPOWER 等）----
    # 条件：缓存存在 + fault_line 归一化一致 + 未过期（5分钟）；按 plan_id 或 tie_lines 集合匹配
    ext = _external_score_result
    ext_available = ext is not None
    ext_used_count = 0
    ext_algo = ext.get("algorithm") if ext else None
    ext_ts = ext.get("timestamp") if ext else None
    if ext is not None and ext.get("fault_line") == fault_key and not _external_score_expired(ext):
        by_plan_id = {}
        by_tie_set = {}
        for cs in ext.get("candidate_scores", []):
            pid = str(cs.get("plan_id", "")).strip()
            if pid:
                by_plan_id[pid] = cs
            tset = frozenset(cs.get("tie_lines") or [])
            if tset:
                by_tie_set[tset] = cs
        for p in plans:
            cs = by_plan_id.get(p["tie_name"]) or by_plan_id.get(p["tie_switch"]) \
                 or by_tie_set.get(frozenset(p["tie_lines"]))
            if cs is None:
                continue
            ext_used_count += 1
            p["score_source"] = "external_matpower"
            p["external_score_used"] = True
            if cs.get("score") is not None:
                p["score"] = cs["score"]
            p["external_rank"] = cs.get("rank")
            if cs.get("score_breakdown"):
                p["score_breakdown"] = cs["score_breakdown"]
            pf = cs.get("power_flow") or {}
            p["power_flow"] = pf
            p["violations"] = cs.get("violations") or []
            for w in (cs.get("warnings") or []):
                if w not in p["warnings"]:
                    p["warnings"].append(w)
            # 外部潮流结果覆盖电压/负载展示与判定（真实潮流优于本地估算）
            if pf.get("min_voltage_pu") is not None:
                p["min_restored_voltage_pu"] = pf["min_voltage_pu"]
                p["voltage_ok"] = pf["min_voltage_pu"] >= 0.95
            if pf.get("max_loading_pct") is not None:
                p["tie_loading_pct"] = pf["max_loading_pct"]
                p["overloaded"] = pf["max_loading_pct"] > 100.0
                if p["overloaded"] and "外部潮流结果显示线路过载" not in p["warnings"]:
                    p["warnings"].append("外部潮流结果显示线路过载")
            # 潮流不收敛 → 不可用、不可推荐
            if pf.get("converged") is False and "MATPOWER潮流不收敛，方案不可推荐" not in p["warnings"]:
                p["warnings"].append("MATPOWER潮流不收敛，方案不可推荐")
            # 严重违例 → 不可用
            severe = any(isinstance(v, dict) and str(v.get("severity", "")).lower() in ("critical", "severe", "high")
                         for v in p["violations"])
            if severe and "存在严重约束违例，方案不可推荐" not in p["warnings"]:
                p["warnings"].append("存在严重约束违例，方案不可推荐")
            # 基于外部结果重算可用性
            p["is_usable"] = bool(
                p["radial_ok"] and not p["overloaded"]
                and pf.get("converged") is not False and not severe
            )

    # ---- 展示排序（按综合评分）----
    plans.sort(key=lambda p: p["score"], reverse=True)
    for idx, p in enumerate(plans):
        p["rank"] = idx + 1

    # ---- 推荐方案：仅从安全可用方案中选择 ----
    # 条件：is_usable / radial_ok / 不过载 / 电压合格（或未知但附警告）/ 外部潮流未判不收敛
    usable = [
        p for p in plans
        if p["is_usable"] and p["radial_ok"] and not p["overloaded"]
        and p["voltage_ok"] is not False
        and (p.get("power_flow") or {}).get("converged") is not False
    ]
    if ext_used_count > 0:
        # 存在外部评分：外部评分方案优先，按外部 rank（升序）> 外部 score（降序）
        usable.sort(key=lambda p: (
            0 if p.get("external_score_used") else 1,
            p["external_rank"] if isinstance(p.get("external_rank"), (int, float)) else 10**6,
            -(p["score"] or 0),
        ))
    else:
        # 本地规则：恢复率高 > 不过载（usable 内均满足）> 电压质量好 > 操作次数少 > 综合评分高
        usable.sort(key=lambda p: (-p["restoration_rate_pct"], -(p["min_restored_voltage_pu"] or 0),
                                   p["switch_operations"], -p["score"]))
    recommended = usable[0] if usable else None
    if recommended is None and plans:
        warnings.append("暂无安全可推荐方案，需人工复核")

    # 返回前 10 个方案；若推荐方案被评分排序挤出，强制附加，保证前端可定位选中
    returned_plans = plans[:10]
    if recommended is not None and all(p["tie_switch"] != recommended["tie_switch"] for p in returned_plans):
        returned_plans = returned_plans + [recommended]

    return {
        "success": True,
        "has_data": True,
        "source": "realtime",
        "source_tag": src_tag,
        "trusted_source": trusted,
        "timestamp": data.get("timestamp", "") or (realtime_module._last_update or ""),
        "message": f"共评估 {len(plans)} 个转供方案",
        "fault_line": fault_key,
        "outage_nodes": outage_nums,
        "outage_count": len(outage_nums),
        "total_load_kw": total_load,
        "outage_load_kw": outage_load,
        "candidate_count": len(candidates),
        "total_plans": len(plans),
        "static_tie_fallback_used": static_tie_fallback_used,
        "recommended_plan": recommended,
        "plans": returned_plans,
        "external_feasible_candidates": (_external_score_result or {}).get("feasible_candidates") if ext_candidates_source == "external_candidates" else None,
        "external_rejected_candidates": (_external_score_result or {}).get("rejected_candidates") if ext_candidates_source == "external_candidates" else None,
        "diagnostics": {
            "external_score_available": ext_available,
            "external_score_used_count": ext_used_count,
            "external_score_algorithm": ext_algo,
            "external_score_timestamp": ext_ts,
            "score_mode": "external_matpower" if ext_used_count > 0 else "local_rule",
            "candidates_source": ext_candidates_source,
            **algo_transfer_result.to_dict(),
        },
        "warnings": warnings,
    }


@app.get("/api/dashboard/summary")
def dashboard_summary():
    """返回 Dashboard 摘要统计（基于内存实时数据）"""
    data = realtime_module._latest_data
    nodes = data.get("nodes", []) if data else []
    lines_data = data.get("lines", []) if data else []

    total_load = round(sum(n.get("load_kw", 0) for n in nodes), 2)
    voltages = [n.get("voltage_pu", 1.0) for n in nodes if n.get("voltage_pu") is not None]
    avg_voltage = round(sum(voltages) / len(voltages), 4) if voltages else 0
    min_voltage = round(min(voltages), 4) if voltages else 0
    high_risk = sum(1 for n in nodes if n.get("risk_level") == "high")
    medium_risk = sum(1 for n in nodes if n.get("risk_level") == "medium")
    active_lines = sum(1 for l in lines_data if l.get("status", 1) == 1)
    disconnected = sum(1 for l in lines_data if l.get("status", 1) == 0)

    return {
        "data": {
            "totalEvents": high_risk,
            "totalTickets": 0,
            "safetyPassRate": 100.0,
            "manualInterventionRate": 0.0,
            "total_load_kw": total_load,
            "avg_voltage_pu": avg_voltage,
            "min_voltage_pu": min_voltage,
            "high_risk_count": high_risk,
            "medium_risk_count": medium_risk,
            "realtime_node_count": len(nodes),
            "active_lines": active_lines,
            "disconnected_lines": disconnected,
            "data_source": realtime_module._latest_source or "none",
            "trusted_source": realtime_module._latest_trusted,
        },
    }


# ==================== 安全校验统一接口（外部算法适配层）====================

@app.post("/api/safety/validate-realtime")
def safety_validate_realtime(req: SafetyValidateRealtimeRequest):
    """安全校验/潮流校验统一接口：外部算法优先，不可用时严格拒绝生成正式操作票"""
    data = realtime_module._latest_data
    if data is None or not data.get("nodes"):
        return {
            "success": False, "has_data": False,
            "message": "暂无实时数据，请先接入Simulink数据",
            "warnings": ["暂无实时数据，请先接入Simulink数据"],
        }

    nodes = data.get("nodes", [])
    lines_data = data.get("lines", [])
    fault_str = req.fault_line.strip()
    if parse_line_pair(fault_str) is None:
        return {"success": False, "message": f"故障线路格式非法: {fault_str}，需为数字-数字"}
    fault_key = normalize_line_key(fault_str)
    tie_switch = normalize_line_key(req.candidate_tie_switch) if req.candidate_tie_switch else ""
    switching_plan = list(req.switching_plan or [])
    trusted = realtime_module._latest_trusted or False

    warnings = []
    if not trusted:
        warnings.append("当前数据源未验证，结果需人工复核")

    # ---- 构造 switching_plan：支持完整对象 / candidate_tie_switch 自动生成 ----
    switching_plan = (req.switching_plan or {})
    if isinstance(switching_plan, list):
        switching_plan = {"open_lines": [], "close_lines": []}
    if not isinstance(switching_plan, dict) or (not switching_plan.get("open_lines") and not switching_plan.get("close_lines")):
        tie_str = str(req.candidate_tie_switch or "").strip()
        if tie_str and parse_line_pair(tie_str):
            switching_plan = {
                "open_lines": [fault_key],
                "close_lines": [normalize_line_key(tie_str)],
            }
        elif not switching_plan:
            return {"success": False, "has_data": True,
                    "message": "缺少 switching_plan 或 candidate_tie_switch，请传入转供操作方案",
                    "warnings": warnings}

    limits = {"min_voltage_pu": 0.95, "max_voltage_pu": 1.05, "max_loading_pct": 100.0}
    if isinstance(req.switching_plan, dict) and req.switching_plan.get("limits"):
        limits.update(req.switching_plan["limits"])

    # ---- IEEE33 算法服务桥接：安全/潮流校验 ----
    from app.services.ieee33_algorithm_client import safetyValidate as algo_safety
    ti = compute_time_index(realtime_module._last_update or "")
    algo_result = algo_safety({
        "request_id": f"safety_{datetime.now().strftime('%Y%m%d%H%M%S')}",
        "timestamp": realtime_module._last_update or "",
        "time_index": ti,
        "snapshot": {
            "timestamp": realtime_module._last_update or "",
            "time_index": ti,
            "nodes": nodes, "lines": lines_data, "switches": data.get("switches", {}),
        },
        "switching_plan": switching_plan,
        "limits": limits,
    })
    if algo_result.available and algo_result.ok:
        ext = algo_result.data
        conv = ext.get("converged")
        safe = ext.get("safe")
        violations = ext.get("violations") or []
        # 安全只有全部条件满足才能出正式票
        can_ticket = bool(trusted and conv is True and safe is True and len(violations) == 0)
        return {
            "success": True, "has_data": True,
            "algorithm_source": "external",
            "converged": conv,
            "safe": safe,
            "topology": ext.get("topology") or {},
            "power_flow": ext.get("power_flow") or {},
            "nodes": ext.get("nodes") or [],
            "lines": ext.get("lines") or [],
            "violations": violations,
            "electrical_credibility": {
                "level": "high" if can_ticket else "low",
                "powerflow_validated": conv is True,
                "can_generate_formal_ticket": can_ticket,
            },
            "diagnostics": {**algo_result.to_dict(), "algorithm_source": "external"},
            "warnings": warnings + (ext.get("warnings") or []) + ([algo_result.warning] if algo_result.warning else []),
        }

    # ---- 外部不可用 / 未配置 → 严格拒绝（不返回 502）----
    return {
        "success": False, "has_data": True,
        "algorithm_source": "unavailable",
        "converged": None, "safe": None,
        "message": "外部潮流安全校验服务暂不可用，不能生成正式操作票",
        "electrical_credibility": {
            "level": "low",
            "powerflow_validated": False,
            "can_generate_formal_ticket": False,
        },
        "diagnostics": algo_result.to_dict() if algo_result else {},
        "warnings": warnings + [
            "安全/潮流校验接口尚未接入",
            "未完成重构后潮流计算，结果不可用于正式操作票",
            "结果需人工复核",
        ],
    }


# ==================== 外部高级评分接入（MATPOWER 适配层）====================

class ExternalScoreUpdateRequest(BaseModel):
    success: bool = True
    fault_line: str = ""
    timestamp: str = ""
    algorithm: str = ""
    algorithm_version: str = ""
    candidate_scores: list = []


@app.post("/api/transfer/external-score/update")
def external_score_update(req: ExternalScoreUpdateRequest):
    """
    接收外部算法（MATLAB/MATPOWER）的转供方案评分结果，缓存最近一次到内存。
    仅作为评分增强数据源，不影响 /api/realtime/update 与 token 校验逻辑。
    """
    global _external_score_result
    if parse_line_pair(req.fault_line) is None:
        return {"success": False, "message": f"故障线路格式非法: {req.fault_line}，需为数字-数字"}
    fault_key = normalize_line_key(req.fault_line)

    cands = []
    for cs in (req.candidate_scores or []):
        if not isinstance(cs, dict):
            continue
        c = dict(cs)
        # tie_lines 全部归一化（丢弃非法项）
        c["tie_lines"] = [normalize_line_key(t) for t in (cs.get("tie_lines") or [])
                          if parse_line_pair(t) is not None]
        cands.append(c)

    _external_score_result = {
        "fault_line": fault_key,
        "timestamp": (req.timestamp or "").strip() or datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "algorithm": (req.algorithm or "").strip() or "external",
        "algorithm_version": (req.algorithm_version or "").strip(),
        "candidate_scores": cands,
        "received_at": datetime.now(),
    }
    return {
        "success": True,
        "message": "外部评分结果已缓存",
        "fault_line": fault_key,
        "candidate_count": len(cands),
        "algorithm": _external_score_result["algorithm"],
        "timestamp": _external_score_result["timestamp"],
    }


# ==================== 操作序列生成（基于已确认的转供方案）====================

class SequenceGenerateRequest(BaseModel):
    fault_line: str = ""
    selected_plan: Optional[dict] = None


@app.post("/api/sequence/generate")
def sequence_generate(req: SequenceGenerateRequest):
    """
    根据转供决策页面确认采用的方案生成结构化操作序列。
    不依赖外部 5000 Flask 服务，不使用静态演示方案。
    """
    plan = req.selected_plan
    if not plan:
        return {
            "success": False,
            "message": "缺少 selected_plan，请先在转供决策页面选择并确认采用一个转供方案",
            "operation_steps": [], "warnings": [],
        }

    # 故障线路：请求体优先，其次方案内记录；强制归一化
    fault_raw = (req.fault_line or "").strip() or str(plan.get("fault_line", "")).strip()
    if parse_line_pair(fault_raw) is None:
        return {
            "success": False,
            "message": f"故障线路格式非法: {fault_raw or '(空)'}，需为数字-数字",
            "operation_steps": [], "warnings": [],
        }
    fault_key = normalize_line_key(fault_raw)

    warnings = []
    plan_warnings = plan.get("warnings") or []

    # 方案可用性校验（fail-closed：缺失评估标志的旧方案/篡改数据一律拒绝，要求重新评估）
    if plan.get("is_usable") is not True:
        return {
            "success": False,
            "message": "该方案不可用或缺少有效性评估（过载/成环风险未排除），请返回转供决策页面重新评估并确认方案",
            "operation_steps": [], "warnings": plan_warnings,
        }
    sectionalizing = [normalize_line_key(s) for s in (plan.get("sectionalizing_open_lines") or [])
                      if parse_line_pair(s) is not None]
    if plan.get("radial_ok") is not True and not sectionalizing:
        return {
            "success": False,
            "message": "该方案可能形成环网，需增加解环开关操作后方可执行",
            "operation_steps": [], "warnings": plan_warnings,
        }

    # 提取方案联络线（兼容 tie_lines 数组与 "18-33+25-29" 组合字符串），全部归一化
    tie_keys = plan.get("tie_lines") or [s for s in str(plan.get("tie_switch", "")).split("+") if s.strip()]
    tie_keys = [normalize_line_key(k) for k in tie_keys if parse_line_pair(k) is not None]
    # 去重且保持顺序
    tie_keys = list(dict.fromkeys(tie_keys))
    if not tie_keys:
        return {
            "success": False,
            "message": "方案中未包含有效联络线，无法生成操作序列",
            "operation_steps": [], "warnings": plan_warnings,
        }
    if fault_key in tie_keys:
        return {
            "success": False,
            "message": f"方案联络线包含故障线路 {fault_key} 本身，禁止生成操作序列",
            "operation_steps": [], "warnings": plan_warnings,
        }

    # ---- 生成操作步骤 ----
    steps = []
    n = 1
    steps.append({
        "step": n, "operation_type": "verify_open", "line": fault_key,
        "action": f"确认故障线路 {fault_key} 已隔离（两侧开关处于断开位置）",
    })
    n += 1
    for k in tie_keys:
        name = TIE_NAME_MAP.get(k, "")
        label = f"{name} ({k})" if name else k
        steps.append({
            "step": n, "operation_type": "close", "line": k,
            "action": f"合上联络开关 {label}，恢复停电区域供电",
        })
        n += 1
    for k in sectionalizing:
        steps.append({
            "step": n, "operation_type": "open", "line": k,
            "action": f"断开分段开关 {k}（解环，恢复辐射状运行）",
        })
        n += 1
    steps.append({
        "step": n, "operation_type": "check",
        "action": "核查恢复节点电压和线路负载",
    })

    # ---- 附加提示 ----
    still = plan.get("still_outage_nodes") or []
    if still:
        warnings.append(f"方案执行后仍有 {len(still)} 个节点停电: {', '.join(map(str, still))}，需另行安排恢复")
    if plan.get("tie_loading_pct") is None:
        warnings.append("联络线负载率待潮流校验，合闸后需现场核查线路负载")
    warnings.extend(w for w in plan_warnings if w not in warnings)

    plan_id = f"TP{datetime.now().strftime('%Y%m%d%H%M%S')}"
    return {
        "success": True,
        "fault_line": fault_key,
        "plan_id": plan_id,
        "tie_lines": tie_keys,
        "operation_steps": steps,
        "warnings": warnings,
    }


@app.on_event("startup")
def on_startup():
    """启动时自动创建表"""
    try:
        init_db()
        print("数据库表已就绪")
    except Exception as e:
        print(f"警告：数据库连接失败，请检查 MySQL 配置 — {e}")
        print("后端将以只读模式运行，请确保 MySQL 已启动并执行 CREATE DATABASE power_ticket_system")


@app.get("/api/algorithm/health")
def algorithm_health():
    """算法服务健康检查：代理后端调用 GET /api/v1/health + /api/v1/capabilities"""
    from app.services.ieee33_algorithm_client import checkAlgorithmHealth
    return checkAlgorithmHealth()


@app.get("/")
def root():
    return {"message": "国网江苏市级配电网智能成票与安全校验系统 API", "version": "2.0", "docs": "/docs"}
