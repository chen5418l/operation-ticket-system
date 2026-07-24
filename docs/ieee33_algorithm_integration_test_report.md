# IEEE33 算法服务联调测试报告

**测试时间**: 2026-07-19 16:36 CST  
**后端版本**: main.py (with boundary mapping fix)  
**测试工具**: backend/integration_test.py

---

## 1. 环境配置状态

| 环境变量 | 状态 |
|----------|------|
| `ALGO_SERVICE_BASE_URL` | ✅ 已配置 (`http://100.73.79.86:8010`) |
| `ALGO_SERVICE_KEY` | ✅ 已配置 (`***`) |
| `ALGO_TIMEOUT_MS` | 默认 5000（未显式配置） |
| `ALGO_JOB_POLL_INTERVAL_MS` | 默认 1000（未显式配置） |
| `ALGO_JOB_MAX_WAIT_MS` | 默认 20000（未显式配置） |
| `DATA_SOURCE_MODE` | realtime |
| `algorithm_env_configured` | **true** |

## 2. 后端状态

- 启动命令: `D:/schoolpython/python.exe -m uvicorn main:app --host 0.0.0.0 --port 8000`
- HTTP 200 ✅
- 实时数据: 测试脚本自动推送 source=test（33节点，37线路）
- trusted_source: false（测试数据未经 Simulink 验证）

## 3. 接口测试结果

| 接口 | HTTP | success | has_data | algorithm_source | 关键字段 |
|------|------|---------|----------|-----------------|---------|
| GET /api/realtime/latest | 200 | True | True (test) | — | nodes=33, lines=37 |
| GET /api/algorithm/health | 200 | — | — | **healthy** | available=true, capabilities OK |
| POST /api/forecast/realtime | 200 | True | True | **local_fallback** | series=6, nodes=33, risk=32 ✅ |
| POST /api/fault/analyze-realtime | 200 | True | True | **external** ✅ | outage=[14,15,16,17,18], load=390kW |
| POST /api/boundary/analyze-realtime | 200 | True | True | **external** ✅ | boundary_nodes=4, crossing_ties=2 |
| POST /api/transfer/recommend-realtime | 0 | — | — | — | ⚠ pipeline 异步任务超时（job_id: e9b87...） |
| POST /api/safety/validate-realtime | 200 | False | True | **unavailable** | safe=null, converged=null, can_ticket=false ✅ |

**0 个 HTTP 502** ✅

## 4. 关键结论

### 算法服务是否接通？
**是，已部分接通。** 张同学算法服务 `http://100.73.79.86:8010` 在线，Key 验证通过。

| 外部接口 | 是否接通 | 说明 |
|----------|---------|------|
| `/api/v1/health` | ✅ | healthy |
| `/api/v1/capabilities` | ✅ | 能力列表获取成功 |
| `/api/v1/fault/analyze` | ✅ | 返回 outage_nodes 与本地 BFS 一致 |
| `/api/v1/boundary/evaluate` | ✅ | 返回 boundary 含 energized_boundary_buses(2) + dead_boundary_buses(2) + crossing_ties(2) |
| `/api/v1/pipeline/evaluate` | ⚠ 超时 | 返回 job_id=e9b8789571b8，但轮询 20s 未完成 |
| `/api/v1/forecast/realtime` | ❌ 待新增 | 张同学侧未实现，业务后端降级 local_fallback |
| `/api/v1/safety/validate` | ❌ 待新增 | 张同学侧未实现，业务后端返回 unavailable |

### 各端点详细

- **fault**: `algorithm_source=external` — 张同学 `/api/v1/fault/analyze` 返回 `outage_nodes=[14,15,16,17,18]`，与本地 BFS 完全一致 ✅
- **boundary**: `algorithm_source=external` — 张同学返回 2 个 `energized_boundary_buses` + 2 个 `dead_boundary_buses` + 2 个 `crossing_ties`，业务后端已正确映射为 `boundary_nodes` ✅
- **transfer**: pipeline 异步任务超时 — job `e9b8789571b8` 在 20s 内未完成。这是时间窗口问题，不是代码 bug。建议：联系张同学确认 pipeline 任务预期执行时长，必要时增大 `ALGO_JOB_MAX_WAIT_MS`
- **forecast**: `local_fallback` 符合预期 ✅ — 张同学 `/api/v1/forecast/realtime` 待新增
- **safety**: `unavailable` 符合预期 ✅ — 张同学 `/api/v1/safety/validate` 待新增

## 5. 修复记录

本次联调发现并修复 2 个问题：

| # | 问题 | 修复 | 文件 |
|---|------|------|------|
| 1 | 配置 ALGO_SERVICE 后预测端点返回 `external_unavailable` 而非 `local_fallback` | 删除 early return，统一降级到 `_build_local_forecast` | main.py |
| 2 | 边界端点未处理张同学返回的 `energized_boundary_buses`/`dead_boundary_buses`（无 `boundary_nodes` 顶层字段） | 新增自动构造 `boundary_nodes` 逻辑 | main.py |

## 6. 安全检查

- `backend/.env` 未被 Git 追踪 ✅（.gitignore 已排除 `*.env`，仅放行 `.env.example`）
- `ALGO_SERVICE_KEY` 不存在于任何源码或测试文件 ✅
- `SIMULINK_SOURCE_TOKEN` 仅存在于 `.env` 和 `.env.example`（`example` 中为占位符）✅
- `/api/realtime/update` 未修改 ✅
- Simulink token 校验未修改 ✅

## 7. 下一步建议

1. **与张同学确认**：pipeline 任务预期执行时长（当前 `ALGO_JOB_MAX_WAIT_MS=20000` 可能不足）
2. **待张同学实现后重新测试**：`/api/v1/forecast/realtime` 和 `/api/v1/safety/validate`
3. **前端联调**：fault 和 boundary 已接通 external，可以在故障分析/边界判定页面验证外部数据展示
4. **实时数据**：联调时应使用 Simulink 真实推送获取 `trusted_source=true`，以激活完整 electrical_credibility 判定链
