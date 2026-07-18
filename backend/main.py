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
from app.routers.realtime import ForecastRealtimeRequest, FaultAnalyzeRealtimeRequest, TransferEvaluateRealtimeRequest

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

@app.post("/api/forecast/realtime")
def forecast_realtime(req: ForecastRealtimeRequest):
    """基于实时 Simulink 数据做多步源荷预测"""
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
    base_time = ""
    time_source = "server_time"
    forecast_mode = "realtime"

    if req.base_hour >= 0:
        base_hour = req.base_hour % 24
        base_time = f"{base_hour:02d}:00"
        time_source = "manual_override"
        forecast_mode = "scenario"
    elif ts_str:
        try:
            for fmt_str in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%H:%M:%S", "%H:%M"):
                try:
                    dt = datetime.strptime(ts_str.strip(), fmt_str)
                    base_hour = dt.hour
                    base_time = dt.strftime("%Y-%m-%d %H:%M:%S") if dt.year > 2000 else dt.strftime("%H:%M:%S")
                    time_source = "realtime_timestamp"
                    break
                except ValueError:
                    continue
            else:
                base_hour = datetime.now().hour; base_time = datetime.now().strftime("%H:%M:%S")
        except Exception:
            base_hour = datetime.now().hour; base_time = datetime.now().strftime("%H:%M:%S")
    else:
        base_hour = datetime.now().hour; base_time = datetime.now().strftime("%H:%M:%S")

    base_hour = base_hour % 24

    # ---- 24小时日负荷系数 ----
    HOURLY_LOAD = {0:0.78,1:0.75,2:0.73,3:0.72,4:0.74,5:0.80,6:0.88,7:0.96,8:1.02,9:1.05,10:1.08,11:1.10,12:1.06,13:1.03,14:1.00,15:1.02,16:1.08,17:1.15,18:1.22,19:1.20,20:1.14,21:1.05,22:0.95,23:0.85}
    HOURLY_PV   = {0:0.00,1:0.00,2:0.00,3:0.00,4:0.00,5:0.05,6:0.15,7:0.35,8:0.55,9:0.75,10:0.90,11:1.00,12:1.00,13:0.92,14:0.80,15:0.65,16:0.45,17:0.20,18:0.05,19:0.00,20:0.00,21:0.00,22:0.00,23:0.00}
    HOURLY_EV   = {0:0.60,1:0.55,2:0.50,3:0.45,4:0.45,5:0.50,6:0.60,7:0.75,8:0.85,9:0.80,10:0.75,11:0.70,12:0.75,13:0.78,14:0.80,15:0.85,16:0.95,17:1.15,18:1.35,19:1.45,20:1.40,21:1.25,22:1.05,23:0.80}

    def load_factor_for_hour(h: int) -> float: return HOURLY_LOAD.get(h % 24, 1.0)
    def pv_factor_for_hour(h: int) -> float: return HOURLY_PV.get(h % 24, 0.0)
    def ev_factor_for_hour(h: int) -> float: return HOURLY_EV.get(h % 24, 1.0)

    def risk_factor(risk: str) -> float:
        m = {"low": 1.00, "medium": 1.03, "high": 1.06}
        return m.get(risk, 1.00)

    def voltage_factor(v: float) -> float:
        if v < 0.95:
            return 1.05
        elif v < 0.97:
            return 1.02
        return 1.00

    # ---- 当前汇总 ----
    cur_load = round(sum(n.get("load_kw", 0) for n in nodes), 3)
    cur_pv = round(sum(n.get("pv_kw", 0) for n in nodes), 3)
    cur_ev = round(sum(n.get("ev_kw", 0) for n in nodes), 3)
    cur_net = round(cur_load + cur_ev - cur_pv, 3)

    # ---- 逐节点 + 全网预测 ----
    node_forecasts = []
    for n in nodes:
        nd = n.get("node", 0)
        v = n.get("voltage_pu", 1.0)
        risk = n.get("risk_level", "low")
        l0 = n.get("load_kw", 0)
        pv0 = n.get("pv_kw", 0)
        ev0 = n.get("ev_kw", 0)
        vf = voltage_factor(v)
        rf = risk_factor(risk)
        series = []
        for s in range(1, horizon + 1):
            fh = (base_hour + s * interval // 60) % 24
            t_off = s * interval
            ltf = load_factor_for_hour(fh)
            ptf = pv_factor_for_hour(fh)
            etf = ev_factor_for_hour(fh)
            fl = round(l0 * ltf * rf * vf, 3)
            fp = round(pv0 * ptf, 3)
            fe = round(ev0 * etf, 3)
            series.append({
                "step": s, "time_offset_min": t_off, "forecast_hour": fh,
                "forecast_load_kw": fl, "forecast_pv_kw": fp, "forecast_ev_kw": fe,
                "forecast_net_load_kw": round(fl + fe - fp, 3),
            })
        node_forecasts.append({
            "node": nd,
            "current_load_kw": l0, "current_pv_kw": pv0,
            "current_ev_kw": ev0, "current_net_load_kw": round(l0 + ev0 - pv0, 3),
            "voltage_pu": v, "risk_level": risk, "series": series,
        })

    # ---- 全网预测序列 ----
    forecast_series = []
    for s in range(1, horizon + 1):
        fh = (base_hour + s * interval // 60) % 24
        t_off = s * interval
        ltf = load_factor_for_hour(fh)
        ptf = pv_factor_for_hour(fh)
        etf = ev_factor_for_hour(fh)
        tl = round(sum(n.get("load_kw",0)*ltf*risk_factor(n.get("risk_level","low"))*voltage_factor(n.get("voltage_pu",1.0)) for n in nodes),3)
        tp = round(sum(n.get("pv_kw",0)*ptf for n in nodes),3)
        te = round(sum(n.get("ev_kw",0)*etf for n in nodes),3)
        forecast_series.append({
            "step": s, "time_offset_min": t_off, "forecast_hour": fh,
            "total_load_kw": tl, "total_pv_kw": tp, "total_ev_kw": te,
            "total_net_load_kw": round(tl+te-tp,3),
        })

    return {
        "success": True, "has_data": True,
        "source": "realtime",
        "source_tag": realtime_module._latest_source or "none",
        "trusted_source": realtime_module._latest_trusted or False,
        "timestamp": data.get("timestamp", ""),
        "base_time": base_time,
        "base_hour": base_hour,
        "forecast_mode": forecast_mode,
        "time_source": time_source,
        "horizon": horizon, "interval_minutes": interval,
        "message": "基于 Simulink 实时数据完成24小时源荷预测" if forecast_mode == "realtime" else "场景推演模式：基准时间由用户手动指定",
        "current_total_load_kw": cur_load,
        "current_total_pv_kw": cur_pv,
        "current_total_ev_kw": cur_ev,
        "current_total_net_load_kw": cur_net,
        "forecast_series": forecast_series,
        "node_forecasts": node_forecasts,
        "diagnostics": {
            "realtime_node_count": len(nodes),
            "realtime_total_load_kw": cur_load,
            "realtime_total_pv_kw": cur_pv,
            "realtime_total_ev_kw": cur_ev,
            "used_realtime_nodes": True,
            "used_static_fallback": False,
            "field_check": {"has_pv_kw": cur_pv > 0, "has_ev_kw": cur_ev > 0},
        },
        "warnings": warnings,
    }


@app.post("/api/fault/analyze-realtime")
def fault_analyze_realtime(req: FaultAnalyzeRealtimeRequest):
    """
    基于实时 Simulink 数据做 IEEE 33节点 BFS 故障分析。
    lines[].line 格式 "13-14" 解析 from/to；
    lines[].status 判断闭合/断开。
    """
    data = realtime_module._latest_data
    if data is None or not data.get("nodes"):
        return {
            "success": False,
            "has_data": False,
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
    parse_errors = []
    if not trusted:
        warnings.append("当前数据源未验证，结果需人工复核")

    # ---- 构建邻接表 ----
    adj = {}
    all_pairs = set()
    tie_candidates = []

    for l in lines_data:
        ln = l.get("line", "")
        st = l.get("status", 1)
        pair = parse_line_pair(ln)
        if pair is None:
            parse_errors.append(f"无法解析线路: {ln}")
            continue
        key = f"{pair[0]}-{pair[1]}"
        all_pairs.add(pair)
        if key == fault_key:
            # 故障线路本身：从基础图中断开，且不得作为联络候选
            continue
        if st == 0:
            tie_candidates.append({**l, "line": key})
        if st == 1:
            aid, bid = f"BUS-{pair[0]:02d}", f"BUS-{pair[1]:02d}"
            adj.setdefault(aid, []).append(bid)
            adj.setdefault(bid, []).append(aid)

    if parse_errors:
        warnings.extend(parse_errors[:5])

    # ---- BFS 从 BUS-01 ----
    visited = set()
    queue = ["BUS-01"]
    while queue:
        u = queue.pop(0)
        if u in visited:
            continue
        visited.add(u)
        for v in adj.get(u, []):
            if v not in visited:
                queue.append(v)

    all_ids = {f"BUS-{n.get('node', 0):02d}" for n in nodes}
    outage = sorted(all_ids - visited)
    powered = sorted(visited)
    outage_nums = [int(x.replace("BUS-", "")) for x in outage]
    reachable_nums = [int(x.replace("BUS-", "")) for x in powered]

    # ---- 边界节点 + 边界边 ----
    boundary_nodes = []
    boundary_edges = []
    for (a, b) in all_pairs:
        a_live = a in reachable_nums
        b_live = b in reachable_nums
        if a_live != b_live:
            boundary_nodes.append(f"{a}-{b}")
            boundary_edges.append({
                "line": f"{a}-{b}",
                "source_side": a if a_live else b,
                "outage_side": b if a_live else a,
            })

    # ---- 候选联络开关（已排除故障线路本身）----
    candidate_tie_switches = []
    seen_tie_keys = set()
    for l in tie_candidates:
        ln = l.get("line", "")
        pair = parse_line_pair(ln)
        if pair is None or ln in seen_tie_keys:
            continue
        seen_tie_keys.add(ln)
        an, bn = pair
        a_live = an in reachable_nums
        b_live = bn in reachable_nums
        if a_live != b_live:
            candidate_tie_switches.append({
                "line": ln,
                "from": an, "to": bn,
                "status": l.get("status", 0),
                "current_a": l.get("current_a", 0),
                "power_kw": l.get("power_kw", 0),
                "reason": "该联络线连接带电区域与停电区域，可作为转供候选",
            })

    # ---- 负荷 ----
    current_total_load_kw = round(sum(n.get("load_kw", 0) for n in nodes), 2)
    affected_load_kw = round(sum(
        node_map.get(nid, {}).get("load_kw", 0) for nid in outage_nums
    ), 2)

    # ---- 潮流摘要 ----
    voltages = [n.get("voltage_pu", 1.0) for n in nodes]
    min_v = min(voltages) if voltages else 0
    max_v = max(voltages) if voltages else 0
    min_v_node = nodes[voltages.index(min_v)].get("node", 0) if voltages else 0
    max_v_node = nodes[voltages.index(max_v)].get("node", 0) if voltages else 0

    max_current, max_current_line = 0.0, ""
    max_power, max_power_line = 0.0, ""
    for l in lines_data:
        ca = abs(l.get("current_a", 0) or 0)
        pk = abs(l.get("power_kw", 0) or 0)
        if ca > max_current:
            max_current, max_current_line = ca, l.get("line", "")
        if pk > max_power:
            max_power, max_power_line = pk, l.get("line", "")

    power_flow_summary = {
        "min_voltage_pu": round(min_v, 4),
        "min_voltage_node": min_v_node,
        "max_voltage_pu": round(max_v, 4),
        "max_voltage_node": max_v_node,
        "max_current_a": round(max_current, 2),
        "max_current_line": max_current_line,
        "max_power_kw": round(max_power, 2),
        "max_power_line": max_power_line,
        "total_load_kw": current_total_load_kw,
        "affected_load_kw": affected_load_kw,
    }

    # ---- 失电节点详情 ----
    details = []
    for nid in outage_nums:
        n = node_map.get(nid, {})
        details.append({
            "node": nid,
            "load_kw": n.get("load_kw", 0),
            "voltage_pu": n.get("voltage_pu", 0),
            "pv_kw": n.get("pv_kw", 0),
            "ev_kw": n.get("ev_kw", 0),
            "risk_level": n.get("risk_level", "low"),
        })

    return {
        "success": True,
        "has_data": True,
        "source": "realtime",
        "source_tag": src_tag,
        "trusted_source": trusted,
        "timestamp": data.get("timestamp", ""),
        "message": "基于实时拓扑完成故障分析",
        "fault_line": fault_key,
        "source_node": 1,
        "reachable_nodes": reachable_nums,
        "outage_nodes": outage_nums,
        "boundary_nodes": boundary_nodes,
        "boundary_edges": boundary_edges,
        "candidate_tie_switches": candidate_tie_switches,
        "current_total_load_kW": current_total_load_kw,
        "affected_load_kW": affected_load_kw,
        "affected_count": len(outage_nums),
        "reachable_count": len(reachable_nums),
        "powered_nodes": reachable_nums,
        "affected_node_details": details,
        "power_flow_summary": power_flow_summary,
        "warnings": warnings,
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
        "plans": returned_plans,  # 最多 10 个 + 必含推荐方案
        "diagnostics": {
            "external_score_available": ext_available,
            "external_score_used_count": ext_used_count,
            "external_score_algorithm": ext_algo,
            "external_score_timestamp": ext_ts,
            "score_mode": "external_matpower" if ext_used_count > 0 else "local_rule",
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


@app.get("/")
def root():
    return {"message": "国网江苏市级配电网智能成票与安全校验系统 API", "version": "2.0", "docs": "/docs"}
