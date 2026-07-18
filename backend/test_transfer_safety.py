# -*- coding: utf-8 -*-
"""
第八节测试：转供决策安全性 + 操作序列生成
- 推送 IEEE33 测试数据（source=test，非 mock 自动推送，无真实 token）
- 测试 1: fault_line=27-28 候选排除自身；T4/T5/T4+T5 的 radial_ok/overloaded/is_usable
- 测试 2: fault_line="9-8" 与 "8-9" 等价
- 测试 3: T5 25-29 超 500kW 应 overloaded=true 且不得推荐
- 测试 4: /api/sequence/generate 正常返回 operation_steps，不 404
"""
import json
import sys
import urllib.request

BASE = "http://127.0.0.1:8010"
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

nodes = [{"node": i, "load_kw": LOADS[i], "voltage_pu": 0.985, "pv_kw": 0, "ev_kw": 0,
          "risk_level": "low"} for i in range(1, 34)]
lines = [{"line": f"{a}-{b}", "status": 1, "current_a": 30.0, "power_kw": 100.0} for a, b in TRUNK]
lines += [{"line": f"{a}-{b}", "status": 0, "current_a": 0.0, "power_kw": 0.0} for a, b in TIES]

print("== 推送测试数据 (source=test) ==")
st, r = post("/api/realtime/update", {"source": "test", "nodes": nodes, "lines": lines, "switches": {}})
check("推送成功", st == 200 and r.get("success"), r.get("message", ""))
check("trusted_source=false (test源)", r.get("trusted_source") is False)

# ==== 测试 1 + 3: fault_line = 27-28 ====
print("\n== 测试1/3: fault_line=27-28 ==")
st, r = post("/api/transfer/evaluate-realtime", {"fault_line": "27-28"})
check("HTTP 200 且 success", st == 200 and r.get("success"))
check("warnings 含未验证提示", "当前数据源未验证，结果需人工复核" in (r.get("warnings") or []))
check("停电节点为 28-33", r.get("outage_nodes") == [28, 29, 30, 31, 32, 33], str(r.get("outage_nodes")))
plans = r.get("plans") or []
switches = [p["tie_switch"] for p in plans]
check("候选方案不含故障线 27-28", all("27-28" not in s.split("+") for s in switches), str(switches))
by_sw = {p["tie_switch"]: p for p in plans}
t4, t5, dual = by_sw.get("18-33"), by_sw.get("25-29"), by_sw.get("18-33+25-29") or by_sw.get("25-29+18-33")
check("T4 单方案存在", t4 is not None)
check("T5 单方案存在", t5 is not None)
check("T4+T5 双方案存在", dual is not None)
if t4:
    check("T4 radial_ok=true", t4["radial_ok"] is True)
    check("T4 不过载 (800/1200)", t4["overloaded"] is False and t4["is_usable"] is True,
          f"loading={t4['tie_loading_pct']}%")
if t5:
    check("T5 过载 (800/500) overloaded=true", t5["overloaded"] is True, f"loading={t5['tie_loading_pct']}%")
    check("T5 is_usable=false", t5["is_usable"] is False)
    check("T5 方案含过载警告", any("过载" in w for w in t5.get("warnings", [])))
if dual:
    check("T4+T5 成环 radial_ok=false", dual["radial_ok"] is False)
    check("T4+T5 is_usable=false", dual["is_usable"] is False)
    check("T4+T5 含成环警告", any("环网" in w for w in dual.get("warnings", [])))
rec = r.get("recommended_plan")
check("recommended 为 T4 (18-33)", rec is not None and rec["tie_switch"] == "18-33",
      rec["tie_switch"] if rec else "None")
check("recommended 不过载且辐射状", rec is not None and rec["overloaded"] is False and rec["radial_ok"] is True)
r2728 = r

# ==== 测试 2: "9-8" 与 "8-9" 等价 ====
print("\n== 测试2: fault_line 9-8 与 8-9 等价 ==")
st_a, ra = post("/api/transfer/evaluate-realtime", {"fault_line": "8-9"})
st_b, rb = post("/api/transfer/evaluate-realtime", {"fault_line": "9-8"})
check("两者 fault_line 均归一化为 8-9", ra.get("fault_line") == "8-9" and rb.get("fault_line") == "8-9",
      f"{ra.get('fault_line')} / {rb.get('fault_line')}")
check("停电节点一致且非空", ra.get("outage_nodes") == rb.get("outage_nodes") and len(ra.get("outage_nodes") or []) > 0,
      str(ra.get("outage_nodes")))
check("方案列表一致", [p["tie_switch"] for p in ra.get("plans", [])] == [p["tie_switch"] for p in rb.get("plans", [])])

# ==== 补充: 故障线自身 status=0 (跳闸后) 也不得成为候选 ====
print("\n== 补充: 故障线 27-28 已跳闸(status=0) 仍被排除 ==")
lines2 = [dict(l) for l in lines]
for l in lines2:
    if l["line"] == "27-28":
        l["status"] = 0
st, _ = post("/api/realtime/update", {"source": "test", "nodes": nodes, "lines": lines2, "switches": {}})
st, r = post("/api/transfer/evaluate-realtime", {"fault_line": "27-28"})
switches = [p["tie_switch"] for p in r.get("plans", [])]
check("跳闸态故障线不进入候选", all("27-28" not in s.split("+") for s in switches), str(switches))
check("推荐仍为 18-33", (r.get("recommended_plan") or {}).get("tie_switch") == "18-33")
# 恢复原始数据
post("/api/realtime/update", {"source": "test", "nodes": nodes, "lines": lines, "switches": {}})

# ==== 测试 4: /api/sequence/generate ====
print("\n== 测试4: /api/sequence/generate ==")
rec = r2728.get("recommended_plan")
st, r = post("/api/sequence/generate", {"fault_line": "27-28", "selected_plan": rec})
check("接口存在且 success (不 404)", st == 200 and r.get("success"), r.get("message", ""))
steps = r.get("operation_steps") or []
check("返回 operation_steps 非空", len(steps) >= 3, f"{len(steps)} 步")
check("步骤1为隔离确认 verify_open", steps and steps[0]["operation_type"] == "verify_open" and steps[0]["line"] == "27-28")
check("含合闸 18-33 步骤", any(s.get("operation_type") == "close" and s.get("line") == "18-33" for s in steps))
check("末步为核查 check", steps and steps[-1]["operation_type"] == "check")

# 不可用方案应被拒绝
t5_plan = {p["tie_switch"]: p for p in r2728.get("plans", [])}.get("25-29")
st, r = post("/api/sequence/generate", {"fault_line": "27-28", "selected_plan": t5_plan})
check("过载方案 (is_usable=false) 被拒绝", r.get("success") is False, r.get("message", ""))
dual_plan = next((p for p in r2728.get("plans", []) if p["switch_operations"] == 2), None)
st, r = post("/api/sequence/generate", {"fault_line": "27-28", "selected_plan": dual_plan})
check("成环方案 (radial_ok=false) 被拒绝", r.get("success") is False, r.get("message", ""))
st, r = post("/api/sequence/generate", {"fault_line": "27-28", "selected_plan": None})
check("缺少 selected_plan 被拒绝", r.get("success") is False, r.get("message", ""))
st, r = post("/api/sequence/generate", {"fault_line": "28-27", "selected_plan": rec})
check("fault_line=28-27 归一化为 27-28", r.get("success") is True and r.get("fault_line") == "27-28")

# ==== 复审修复回归: 自环脏数据不得击穿辐射性校验 ====
print("\n== 复审回归: 自环脏数据 5-5 ==")
lines3 = [dict(l) for l in lines] + [{"line": "5-5", "status": 1, "current_a": 0, "power_kw": 0}]
post("/api/realtime/update", {"source": "test", "nodes": nodes, "lines": lines3, "switches": {}})
st, r = post("/api/transfer/evaluate-realtime", {"fault_line": "27-28"})
t4b = {p["tie_switch"]: p for p in r.get("plans", [])}.get("18-33")
check("自环记录被忽略, T4 仍 radial_ok=true", t4b is not None and t4b["radial_ok"] is True)
check("自环故障线 9-9 被拒绝", post("/api/transfer/evaluate-realtime", {"fault_line": "9-9"})[1].get("success") is False)

# ==== 复审修复回归: 真实故障态数据（停电区电压≈0）仍能给出推荐 ====
print("\n== 复审回归: 故障态电压快照 ==")
nodes_fault = [dict(n) for n in nodes]
for n in nodes_fault:
    if n["node"] >= 28:
        n["voltage_pu"] = 0.0  # 停电区失电实测
lines_fault = [dict(l) for l in lines]
for l in lines_fault:
    if l["line"] == "27-28":
        l["status"] = 0
post("/api/realtime/update", {"source": "test", "nodes": nodes_fault, "lines": lines_fault, "switches": {}})
st, r = post("/api/transfer/evaluate-realtime", {"fault_line": "27-28"})
rec_f = r.get("recommended_plan")
check("故障态数据下仍有推荐方案", rec_f is not None, str(rec_f and rec_f.get("tie_switch")))
check("推荐方案电压为待潮流校验 (null)", rec_f is not None and rec_f.get("min_restored_voltage_pu") is None)
check("含电压待校验警告", rec_f is not None and any("待潮流校验" in w for w in rec_f.get("warnings", [])))
post("/api/realtime/update", {"source": "test", "nodes": nodes, "lines": lines, "switches": {}})

# ==== 复审修复回归: sequence 门禁 fail-closed ====
print("\n== 复审回归: sequence 门禁 fail-closed ==")
st, r = post("/api/sequence/generate", {"fault_line": "27-28", "selected_plan": {"tie_switch": "18-33+25-29"}})
check("缺 is_usable 字段的方案被拒绝 (fail-closed)", r.get("success") is False, r.get("message", ""))

# ==== 无数据行为 (清空后) ====
print("\n== 约束: 无实时数据提示 ==")
req = urllib.request.Request(BASE + "/api/realtime/clear", data=b"{}",
                             headers={"Content-Type": "application/json"}, method="POST")
urllib.request.urlopen(req, timeout=10)
st, r = post("/api/transfer/evaluate-realtime", {"fault_line": "8-9"})
check("无数据时返回固定提示", r.get("success") is False and r.get("message") == "暂无实时数据，请先接入Simulink数据")

print(f"\n===== 结果: {len(PASS)} 通过 / {len(FAIL)} 失败 =====")
if FAIL:
    print("失败项: " + "; ".join(FAIL))
    sys.exit(1)
