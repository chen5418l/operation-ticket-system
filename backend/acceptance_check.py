# -*- coding: utf-8 -*-
"""运行态验收：针对正式端口 8000 验证修复结果（验收项 1/2/3）"""
import json
import sys
import urllib.request

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


# ---- IEEE33 测试数据（source=test 显式推送）----
LOADS = {1: 0, 2: 100, 3: 90, 4: 120, 5: 60, 6: 60, 7: 200, 8: 200, 9: 60, 10: 60,
         11: 45, 12: 60, 13: 60, 14: 120, 15: 60, 16: 60, 17: 60, 18: 90, 19: 90,
         20: 90, 21: 90, 22: 90, 23: 90, 24: 420, 25: 420, 26: 60, 27: 60, 28: 60,
         29: 120, 30: 200, 31: 150, 32: 210, 33: 60}
TRUNK = [(1,2),(2,3),(3,4),(4,5),(5,6),(6,7),(7,8),(8,9),(9,10),(10,11),(11,12),
         (12,13),(13,14),(14,15),(15,16),(16,17),(17,18),(2,19),(19,20),(20,21),
         (21,22),(3,23),(23,24),(24,25),(6,26),(26,27),(27,28),(28,29),(29,30),
         (30,31),(31,32),(32,33)]
TIES = [(8,21),(9,15),(12,22),(18,33),(25,29)]

nodes = [{"node": i, "load_kw": LOADS[i], "voltage_pu": 0.985, "pv_kw": 0, "ev_kw": 0,
          "risk_level": "low"} for i in range(1, 34)]
lines = [{"line": f"{a}-{b}", "status": 1, "current_a": 30.0, "power_kw": 100.0} for a, b in TRUNK]
lines += [{"line": f"{a}-{b}", "status": 0, "current_a": 0.0, "power_kw": 0.0} for a, b in TIES]

st, r = post("/api/realtime/update", {"source": "test", "nodes": nodes, "lines": lines, "switches": {}})
print(f"数据推送: {r.get('message')} (trusted={r.get('trusted_source')})\n")

# ==== 验收项 1: fault_line=27-28 ====
print("== 验收1: POST /api/transfer/evaluate-realtime fault_line=27-28 ==")
st, r = post("/api/transfer/evaluate-realtime", {"fault_line": "27-28"})
plans = {p["tie_switch"]: p for p in r.get("plans", [])}
rec = r.get("recommended_plan")
t5 = plans.get("25-29")
dual = plans.get("18-33+25-29") or plans.get("25-29+18-33")
check("recommended_plan = T4 (18-33)", rec is not None and rec["tie_switch"] == "18-33" and rec["tie_name"] == "T4",
      f"实际: {rec and rec.get('tie_name')} ({rec and rec.get('tie_switch')}) 得分 {rec and rec.get('score')}")
check("T5 (25-29) overloaded=true", t5 is not None and t5["overloaded"] is True, f"loading={t5 and t5['tie_loading_pct']}%")
check("T5 (25-29) is_usable=false", t5 is not None and t5["is_usable"] is False)
check("T4+T5 radial_ok=false 或 is_usable=false", dual is not None and (dual["radial_ok"] is False or dual["is_usable"] is False),
      f"radial_ok={dual and dual['radial_ok']}, is_usable={dual and dual['is_usable']}")
check("recommended_plan 不是 T4+T5", rec is not None and "+" not in rec["tie_switch"])
rec_t4 = rec

# ==== 验收项 2: 8-9 与 9-8 等价 ====
print("\n== 验收2: fault_line=8-9 vs 9-8 ==")
_, ra = post("/api/transfer/evaluate-realtime", {"fault_line": "8-9"})
_, rb = post("/api/transfer/evaluate-realtime", {"fault_line": "9-8"})
same_outage = ra.get("outage_nodes") == rb.get("outage_nodes")
same_plans = [(p["tie_switch"], p["score"]) for p in ra.get("plans", [])] == [(p["tie_switch"], p["score"]) for p in rb.get("plans", [])]
same_rec = (ra.get("recommended_plan") or {}).get("tie_switch") == (rb.get("recommended_plan") or {}).get("tie_switch")
check("归一化一致 (均为 8-9)", ra.get("fault_line") == "8-9" and rb.get("fault_line") == "8-9")
check("停电节点/方案/推荐完全一致", same_outage and same_plans and same_rec,
      f"outage={ra.get('outage_nodes')}, rec={(ra.get('recommended_plan') or {}).get('tie_switch')}")

# ==== 验收项 3: /api/sequence/generate (selected_plan=T4) ====
print("\n== 验收3: POST /api/sequence/generate selected_plan=T4 ==")
st, r = post("/api/sequence/generate", {"fault_line": "27-28", "selected_plan": rec_t4})
steps = r.get("operation_steps") or []
texts = [s.get("action", "") for s in steps]
check("HTTP 200 且 success=true", st == 200 and r.get("success") is True)
check("步骤a: 确认故障线路 27-28 已隔离", any("27-28" in t and "隔离" in t for t in texts), texts[0] if texts else "")
check("步骤b: 合上联络开关 18-33", any("合上联络开关" in t and "18-33" in t for t in texts))
check("步骤c: 核查恢复节点电压和线路负载", any("核查恢复节点电压和线路负载" in t for t in texts))
print("  操作步骤:")
for s in steps:
    print(f"    {s['step']}. [{s['operation_type']}] {s['action']}")

print(f"\n===== 验收结果: {len(PASS)} 通过 / {len(FAIL)} 失败 =====")
if FAIL:
    print("失败项: " + "; ".join(FAIL))
    sys.exit(1)
