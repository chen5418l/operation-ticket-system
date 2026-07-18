# -*- coding: utf-8 -*-
"""外部评分适配层测试（第五节）：降级 / 匹配 / 不匹配 / 过期 / 不收敛"""
import json
import sys
import urllib.request
from datetime import datetime, timedelta

BASE = "http://127.0.0.1:8000"
PASS, FAIL = [], []


def check(name, cond, detail=""):
    (PASS if cond else FAIL).append(name)
    print(("  [PASS] " if cond else "  [FAIL] ") + name + (f"  -- {detail}" if detail else ""))


def post(path, body):
    req = urllib.request.Request(BASE + path, data=json.dumps(body).encode("utf-8"),
                                 headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=15) as r:
        return r.status, json.loads(r.read().decode("utf-8"))


# ---- IEEE33 测试数据 ----
LOADS = {1: 0, 2: 100, 3: 90, 4: 120, 5: 60, 6: 60, 7: 200, 8: 200, 9: 60, 10: 60,
         11: 45, 12: 60, 13: 60, 14: 120, 15: 60, 16: 60, 17: 60, 18: 90, 19: 90,
         20: 90, 21: 90, 22: 90, 23: 90, 24: 420, 25: 420, 26: 60, 27: 60, 28: 60,
         29: 120, 30: 200, 31: 150, 32: 210, 33: 60}
TRUNK = [(1,2),(2,3),(3,4),(4,5),(5,6),(6,7),(7,8),(8,9),(9,10),(10,11),(11,12),
         (12,13),(13,14),(14,15),(15,16),(16,17),(17,18),(2,19),(19,20),(20,21),
         (21,22),(3,23),(23,24),(24,25),(6,26),(26,27),(27,28),(28,29),(29,30),
         (30,31),(31,32),(32,33)]
TIES = [(8,21),(9,15),(12,22),(18,33),(25,29)]
nodes = [{"node": i, "load_kw": LOADS[i], "voltage_pu": 0.985, "pv_kw": 0, "ev_kw": 0, "risk_level": "low"} for i in range(1, 34)]
lines = [{"line": f"{a}-{b}", "status": 1, "current_a": 30.0, "power_kw": 100.0} for a, b in TRUNK]
lines += [{"line": f"{a}-{b}", "status": 0, "current_a": 0.0, "power_kw": 0.0} for a, b in TIES]
post("/api/realtime/update", {"source": "test", "nodes": nodes, "lines": lines, "switches": {}})

NOW = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

def ext_payload(fault, ts=NOW, t1_converged=True):
    return {
        "success": True, "fault_line": fault, "timestamp": ts,
        "algorithm": "matpower", "algorithm_version": "v1.0",
        "candidate_scores": [
            {"plan_id": "T1", "tie_lines": ["21-8"], "score": 92.6, "rank": 1,
             "score_breakdown": {"recovery_score": 30.0, "voltage_score": 18.6, "loading_score": 17.5,
                                 "loss_score": 8.9, "operation_score": 10.0, "risk_score": 7.6, "total": 92.6},
             "power_flow": {"converged": t1_converged, "min_voltage_pu": 0.982, "max_voltage_pu": 1.000,
                            "max_loading_pct": 78.4, "loss_kw": 32.5},
             "violations": [], "warnings": []},
            {"plan_id": "T3", "tie_lines": ["12-22"], "score": 84.1, "rank": 3,
             "score_breakdown": {"recovery_score": 30.0, "voltage_score": 15.2, "loading_score": 14.0,
                                 "loss_score": 6.3, "operation_score": 10.0, "risk_score": 8.6, "total": 84.1},
             "power_flow": {"converged": True, "min_voltage_pu": 0.968, "max_voltage_pu": 1.000,
                            "max_loading_pct": 91.2, "loss_kw": 45.8},
             "violations": [], "warnings": []},
            {"plan_id": "T4", "tie_lines": ["18-33"], "score": 88.9, "rank": 2,
             "score_breakdown": {"recovery_score": 30.0, "voltage_score": 17.1, "loading_score": 15.8,
                                 "loss_score": 7.4, "operation_score": 10.0, "risk_score": 8.6, "total": 88.9},
             "power_flow": {"converged": True, "min_voltage_pu": 0.974, "max_voltage_pu": 1.000,
                            "max_loading_pct": 85.6, "loss_kw": 39.1},
             "violations": [], "warnings": []},
        ],
    }

# ==== 测试1: 无外部评分 → 本地规则不报错 ====
print("== 测试1: 无外部评分时 local_rule 降级 ==")
st, r = post("/api/transfer/evaluate-realtime", {"fault_line": "6-7"})
d = r.get("diagnostics", {})
singles = [p for p in r["plans"] if p["switch_operations"] == 1]
check("success 且 3 个单方案 (T1/T3/T4)", r.get("success") and sorted(p["tie_name"] for p in singles) == ["T1", "T3", "T4"],
      str([p["tie_name"] for p in singles]))
check("全部 score_source=local_rule", all(p.get("score_source") == "local_rule" for p in r["plans"]))
check("diagnostics.score_mode=local_rule, available=false",
      d.get("score_mode") == "local_rule" and d.get("external_score_available") is False, str(d))
check("本地评分区分度不足 (三者同分, 问题复现)", len({p["score"] for p in singles}) == 1,
      str({p["tie_name"]: p["score"] for p in singles}))

# ==== 测试2: 推送外部评分 → 匹配并产生区分度 ====
print("\n== 测试2: 推送 MATPOWER 评分 (fault=6-7) ==")
st, r = post("/api/transfer/external-score/update", ext_payload("6-7"))
check("推送成功并返回摘要", r.get("success") and r.get("fault_line") == "6-7" and r.get("candidate_count") == 3
      and r.get("algorithm") == "matpower", str({k: r.get(k) for k in ("fault_line","candidate_count","algorithm")}))

st, r = post("/api/transfer/evaluate-realtime", {"fault_line": "6-7"})
d = r.get("diagnostics", {})
singles = {p["tie_name"]: p for p in r["plans"] if p["switch_operations"] == 1}
check("T1/T3/T4 分数出现区分度", len({singles[t]["score"] for t in ("T1","T3","T4")}) == 3,
      str({t: singles[t]["score"] for t in ("T1","T3","T4")}))
check("单方案 score_source=external_matpower", all(singles[t]["score_source"] == "external_matpower" for t in ("T1","T3","T4")))
check("diagnostics.external_score_used_count=3", d.get("external_score_used_count") == 3, str(d))
check("diagnostics.score_mode=external_matpower", d.get("score_mode") == "external_matpower")
rec = r.get("recommended_plan")
check("recommended 按外部 rank 选 T1 (92.6, rank1)", rec is not None and rec["tie_name"] == "T1" and rec["score"] == 92.6,
      f"{rec and rec['tie_name']} {rec and rec['score']}")
check("推荐方案带 power_flow (min_v=0.982)", rec is not None and (rec.get("power_flow") or {}).get("min_voltage_pu") == 0.982)
check("外部潮流负载率覆盖显示 (T1=78.4%)", singles["T1"]["tie_loading_pct"] == 78.4)
check("plan_id 反序键 21-8 也能匹配 (T1 归一化)", singles["T1"]["external_score_used"] is True)

# ==== 测试3: fault_line 不匹配 → 降级 ====
print("\n== 测试3: 外部评分 fault=27-28, 分析 6-7 → 降级 ==")
post("/api/transfer/external-score/update", ext_payload("27-28"))
st, r = post("/api/transfer/evaluate-realtime", {"fault_line": "6-7"})
d = r.get("diagnostics", {})
check("不使用外部评分 (used_count=0)", d.get("external_score_used_count") == 0 and d.get("score_mode") == "local_rule")
check("available=true (缓存存在但未匹配)", d.get("external_score_available") is True)
check("方案回到 local_rule", all(p.get("score_source") == "local_rule" for p in r["plans"]))

# ==== 测试4: 外部评分过期 (>5分钟) → 降级 ====
print("\n== 测试4: 过期评分 (10分钟前) → 降级 ==")
old_ts = (datetime.now() - timedelta(minutes=10)).strftime("%Y-%m-%d %H:%M:%S")
post("/api/transfer/external-score/update", ext_payload("6-7", ts=old_ts))
st, r = post("/api/transfer/evaluate-realtime", {"fault_line": "6-7"})
d = r.get("diagnostics", {})
check("过期评分不使用 (score_mode=local_rule)", d.get("score_mode") == "local_rule" and d.get("external_score_used_count") == 0)

# ==== 测试5: converged=false → 不可用不可推荐 ====
print("\n== 测试5: T1 潮流不收敛 → 不可推荐 ==")
post("/api/transfer/external-score/update", ext_payload("6-7", t1_converged=False))
st, r = post("/api/transfer/evaluate-realtime", {"fault_line": "6-7"})
singles = {p["tie_name"]: p for p in r["plans"] if p["switch_operations"] == 1}
rec = r.get("recommended_plan")
check("T1 is_usable=false", singles["T1"]["is_usable"] is False)
check("T1 含不收敛警告", any("不收敛" in w for w in singles["T1"].get("warnings", [])))
check("recommended 不是 T1, 按外部 rank 选 T4 (rank2)", rec is not None and rec["tie_name"] == "T4",
      rec and rec["tie_name"])

# ==== 归一化补充: 9-8 评分推送对 8-9 分析生效 ====
print("\n== 补充: fault_line=7-6 推送 → 6-7 分析可匹配 ==")
post("/api/transfer/external-score/update", ext_payload("7-6"))
st, r = post("/api/transfer/evaluate-realtime", {"fault_line": "6-7"})
check("反序 fault 键归一化后匹配", r.get("diagnostics", {}).get("external_score_used_count", 0) > 0)

print(f"\n===== 结果: {len(PASS)} 通过 / {len(FAIL)} 失败 =====")
if FAIL:
    print("失败项: " + "; ".join(FAIL))
    sys.exit(1)
