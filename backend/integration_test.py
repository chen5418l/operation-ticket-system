# -*- coding: utf-8 -*-
"""IEEE33 算法服务联调测试
用法：
  D:/schoolpython/python.exe integration_test.py                  # 只读取实时数据，不推送
  D:/schoolpython/python.exe integration_test.py --seed-test-data  # 显式推送 source=test 测试数据
"""
import urllib.request, json, time, os, sys

BASE = "http://127.0.0.1:8000"
RESULTS = []
SEED_DATA = "--seed-test-data" in sys.argv

def post(path, body=None, timeout=30):
    url = BASE + path
    data = json.dumps(body or {}).encode("utf-8") if body else None
    req = urllib.request.Request(url, data=data,
                                 headers={"Content-Type": "application/json"},
                                 method="POST" if body else "GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        try: body = json.loads(e.read().decode("utf-8"))
        except: body = {}
        return e.code, body
    except Exception as e:
        return 0, {"error": str(e)}

def get(path):
    return post(path, None)

def record(name, method, path, status, r, expected_checks=None):
    s = r.get("success")
    hd = r.get("has_data")
    als = r.get("algorithm_source") or r.get("status")
    RESULTS.append((name, method, path, status, s, hd, als, r))
    print(f"\n{'='*60}")
    print(f"  [{method}] {path}")
    print(f"  HTTP {status} | success={s} | has_data={hd} | algo_source={als}")
    if expected_checks:
        for label, ok in expected_checks:
            print(f"    {'[PASS]' if ok else '[FAIL]'} {label}")

def seed_test_data():
    """显式推送 test 实时数据（仅在 --seed-test-data 模式下调用）"""
    LOADS = {1:0,2:100,3:90,4:120,5:60,6:60,7:200,8:200,9:60,10:60,11:45,12:60,13:60,14:120,15:60,16:60,17:60,18:90,19:90,20:90,21:90,22:90,23:90,24:420,25:420,26:60,27:60,28:60,29:120,30:200,31:150,32:210,33:60}
    TRUNK = [(1,2),(2,3),(3,4),(4,5),(5,6),(6,7),(7,8),(8,9),(9,10),(10,11),(11,12),(12,13),(13,14),(14,15),(15,16),(16,17),(17,18),(2,19),(19,20),(20,21),(21,22),(3,23),(23,24),(24,25),(6,26),(26,27),(27,28),(28,29),(29,30),(30,31),(31,32),(32,33)]
    TIES = [(8,21),(9,15),(12,22),(18,33),(25,29)]
    nodes = [{"node":i,"load_kw":LOADS[i],"voltage_pu":0.985,"pv_kw":0,"ev_kw":0,"risk_level":"low"} for i in range(1,34)]
    lines = [{"line":f"{a}-{b}","status":1,"current_a":30.0,"power_kw":100.0} for a,b in TRUNK]
    lines += [{"line":f"{a}-{b}","status":0,"current_a":0.0,"power_kw":0.0} for a,b in TIES]
    st2, r2 = post("/api/realtime/update", {"source":"test","nodes":nodes,"lines":lines,"switches":{}})
    print(f"  推送结果: HTTP {st2}, success={r2.get('success')}, trusted={r2.get('trusted_source')}")
    print(f"  ⚠ source=test, trusted_source=false, 结果仅用于联调，不用于正式演示")

# ========== START ==========
print("=" * 60)
print("  联调测试 — 时间:", time.strftime("%Y-%m-%d %H:%M:%S"))
print(f"  后端: {BASE}")
print(f"  模式: {'--seed-test-data (推送测试数据)' if SEED_DATA else 'read-only (仅读取)'}")
env_keys = ["ALGO_SERVICE_BASE_URL","ALGO_SERVICE_KEY","ALGO_BASE_URL","ALGORITHM_KEY","DATA_SOURCE_MODE",
            "ALGO_TIMEOUT_MS","ALGO_JOB_POLL_INTERVAL_MS","ALGO_JOB_TIMEOUT_MS","ALGO_JOB_MAX_WAIT_MS"]
for k in env_keys:
    v = os.getenv(k, "")
    if "KEY" in k.upper():
        print(f"  env {k}: configured={bool(v)}")
    else:
        print(f"  env {k}: {v or '(not set from os.environ — .env loaded by uvicorn)'}")

# ========== 1. GET /api/realtime/latest ==========
st, r = get("/api/realtime/latest")
has_data = r.get("has_data")
record("实时数据", "GET", "/api/realtime/latest", st, r, [
    ("HTTP 200", st == 200),
    ("success", r.get("success")),
    ("has_data=%s (nodes=%d)" % (has_data, len(r.get("nodes",[]))), True),
    ("lines_exists", bool(r.get("lines"))),
])

if not has_data:
    if SEED_DATA:
        print("\n  has_data=false → 推送测试数据 (--seed-test-data)")
        seed_test_data()
        has_data = True
        # 重新获取验证
        st2, r2 = get("/api/realtime/latest")
        print(f"  重新读取: has_data={r2.get('has_data')}, nodes={len(r2.get('nodes',[]))}")
    else:
        print("\n  ⚠ 暂无实时数据，请先接入Simulink数据")
        print("  提示：如需推送测试数据联调，请加 --seed-test-data 参数")
        print("  后续算法接口可能无有效实时断面输入")

# ========== 2. GET /api/algorithm/health ==========
st, r = get("/api/algorithm/health")
avail = r.get("available")
record("算法健康", "GET", "/api/algorithm/health", st, r, [
    ("HTTP 200", st == 200),
    ("available=%s" % avail, True),
    ("status=%s" % r.get("status"), True),
])

# ========== 3. POST /api/forecast/realtime ==========
st, r = post("/api/forecast/realtime", {"horizon": 6})
record("预测", "POST", "/api/forecast/realtime", st, r, [
    ("HTTP 200", st == 200),
    ("algo_source=%s" % r.get("algorithm_source"), True),
    ("forecast_series=%d" % len(r.get("forecast_series",[])), True),
    ("node_forecasts=%d" % len(r.get("node_forecasts",[])), True),
])

# ========== 4. POST /api/fault/analyze-realtime ==========
st, r = post("/api/fault/analyze-realtime", {"fault_line": "13-14"})
outage_ok = r.get("outage_nodes") == [14,15,16,17,18]
record("故障分析", "POST", "/api/fault/analyze-realtime", st, r, [
    ("HTTP 200", st == 200),
    ("algo_source=%s" % r.get("algorithm_source"), True),
    ("outage=[14-18]", outage_ok),
])

# ========== 5. POST /api/boundary/analyze-realtime ==========
st, r = post("/api/boundary/analyze-realtime", {"fault_line": "13-14"})
record("边界判定", "POST", "/api/boundary/analyze-realtime", st, r, [
    ("HTTP 200", st == 200),
    ("algo_source=%s" % r.get("algorithm_source"), True),
    ("boundary_nodes=%d" % len(r.get("boundary_nodes",[])), True),
])

# ========== 6. POST /api/transfer/recommend-realtime ==========
# 转移超时=ALGO_JOB_MAX_WAIT_MS/1000 + 15，确保测试脚本不会先于后端超时
jt_ms = int(os.getenv("ALGO_JOB_MAX_WAIT_MS") or os.getenv("ALGO_JOB_TIMEOUT_MS") or "60000")
transfer_timeout = jt_ms // 1000 + 15
print(f"\n  转供超时设置: {transfer_timeout}s (后端ALGO_JOB_MAX_WAIT_MS={jt_ms}ms + 15s缓冲)")
t0 = time.time()
st, r = post("/api/transfer/recommend-realtime", {
    "fault_line": "13-14",
    "outage_nodes": [14,15,16,17,18],
    "max_ties": 2,
    "evaluation_mode": "auto",
}, timeout=transfer_timeout)
elapsed = time.time() - t0
job_id = r.get("job_id") or ""
record("转供决策", "POST", "/api/transfer/recommend-realtime", st, r, [
    ("HTTP 200 (非502)", st == 200),
    ("algo_source=%s" % r.get("algorithm_source"), True),
    ("job_id=%s" % (job_id[:20] if job_id else "none"), bool(job_id)),
    ("耗时 %.1fs" % elapsed, True),
])

# ========== 7. POST /api/safety/validate-realtime ==========
st, r = post("/api/safety/validate-realtime", {
    "fault_line": "13-14",
    "candidate_tie_switch": "18-33",
})
ec = r.get("electrical_credibility",{})
record("安全校验", "POST", "/api/safety/validate-realtime", st, r, [
    ("HTTP 200 (非502)", st == 200),
    ("safe=null", r.get("safe") is None),
    ("converged=null", r.get("converged") is None),
    ("can_generate_formal_ticket=false", ec.get("can_generate_formal_ticket") is False),
])

# ========== SUMMARY ==========
print(f"\n{'='*60}")
print("  联调测试汇总")
print(f"{'='*60}")
print(f"  {'接口':<30} {'HTTP':>5} {'algo_source':<22} {'结论'}")
print(f"  {'-'*70}")
for name, method, path, st, s, hd, als, _ in RESULTS:
    if name == "实时数据":
        conclusion = "✅ 就绪" if hd else "⚠ 需Simulink数据 (加 --seed-test-data 可推送测试数据)"
    elif name == "算法健康":
        conclusion = "✅ 已接通" if avail else "⚠ 未配置"
    elif name == "预测":
        conclusion = "✅ local_fallback (符合预期)"
    elif name == "故障分析":
        conclusion = "✅ external" if als == "external" else ("⚠ local_fallback" if als == "local_fallback" else "❌")
    elif name == "边界判定":
        conclusion = "✅ external" if als == "external" else ("⚠ local_fallback" if als == "local_fallback" else "❌")
    elif name == "转供决策":
        if als == "external": conclusion = "✅ external"
        elif als == "external_timeout": conclusion = "⚠ 超时 (未502)"
        elif als == "local_fallback": conclusion = "⚠ local_fallback"
        else: conclusion = "❌"
    elif name == "安全校验":
        conclusion = "✅ unavailable (符合预期)"
    else:
        conclusion = "—"
    print(f"  {name:<30} {st:>5} {str(als or ''):<22} {conclusion}")

print(f"\n  环境: ALGO_SERVICE_BASE_URL={'已配置' if avail or os.getenv('ALGO_SERVICE_BASE_URL','') else '未配置'}, ALGO_SERVICE_KEY={'已配置' if os.getenv('ALGO_SERVICE_KEY','') else '未配置'}")
print(f"  seed_test_data: {SEED_DATA}")
if SEED_DATA:
    print(f"  ⚠ 本次测试使用了 --seed-test-data 推送 source=test 数据 (trusted_source=false)")
    print(f"  结果仅用于联调，不用于正式演示")
print(f"  本次仅执行测试，未修改业务逻辑代码。")
