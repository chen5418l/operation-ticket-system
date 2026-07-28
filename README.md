# 市级配电网操作票智能成票与安全校验系统

基于 IEEE 33 节点标准拓扑的配电自动化系统，实现故障感知、边界判定、负荷转供决策、操作序列生成、安全校验、模板化成票全流程闭环。

> **当前阶段**：仿真验证。所有操作序列和操作票均为草案，不具备现场执行授权（`formal_ticket_authorized=false`）。

## 业务流程

```
故障输入 → 边界判定 → 转供决策 → 操作序列生成 → 安全校验 → 模板化成票 → 演示归档
```

## 技术架构

| 层 | 技术栈 |
|---|---|
| 前端 | React 19 + TypeScript + Vite |
| 后端 | Python 3.13 + FastAPI |
| 数据库 | MySQL 8.0 |
| 外部算法 | 8010 算法服务 (MATPOWER/MATLAB) |
| 实时数据 | Simulink 推送 → `/api/realtime/update` |
| 状态管理 | currentWorkflow (localStorage 唯一数据源) |

## 快速启动

### 一键启动

```bash
# MySQL
C:\mysql-8.0\bin\mysqld.exe --console

# 后端（含 8010 prepare→generate→safety 端点）
cd backend
D:\schoolpython\python.exe -m uvicorn main:app --host 0.0.0.0 --port 8000

# 前端
cd frontend
npm run dev -- --host 0.0.0.0 --port 5173
```

或双击 `start_all.bat`（需根据实际环境调整 Python 和 MySQL 路径）。

### 访问地址

| 服务 | 地址 |
|---|---|
| 前端 | http://localhost:5173 |
| 后端 API | http://localhost:8000 |
| 接口文档 | http://localhost:8000/docs |
| 8010 算法 | http://100.73.79.86:8010 |

## 项目结构

```
operation-ticket-system/
├── frontend/src/
│   ├── pages/             9 个业务页面
│   │   ├── Dashboard.tsx          系统主界面
│   │   ├── DataManagement.tsx     数据管理
│   │   ├── Forecast.tsx           源荷预测风险
│   │   ├── BoundaryJudgment.tsx   边界判定
│   │   ├── TransferDecision.tsx   转供决策
│   │   ├── SequenceGeneration.tsx 操作序列生成
│   │   ├── SafetyCheck.tsx        安全校验
│   │   ├── TicketGeneration.tsx   模板化成票
│   │   └── Statistics.tsx         测试统计
│   ├── components/        拓扑图、进度条、指标卡等
│   ├── store/             workflowStore (currentWorkflow)
│   ├── services/          API 客户端
│   ├── utils/             safetyRules (8项规则引擎)
│   └── types/             TypeScript 类型定义
├── backend/
│   ├── main.py            所有业务端点 (2600+ 行)
│   ├── app/
│   │   ├── routers/       子路由 (7 个模块)
│   │   ├── services/      算法客户端 + 业务服务
│   │   ├── models/        数据模型
│   │   └── core/          配置/数据库
│   └── .env               数据库 + 8010 配置 + Simulink Token
├── start_all.bat          一键启动脚本 (Windows)
├── start_backend.bat      后端单独启动
└── docker-compose.yml     Docker 部署配置
```

## API 接口清单

### 实时数据

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/realtime/latest` | 最新节点/线路数据 |
| GET | `/api/realtime/status` | 数据源连接状态 |
| POST | `/api/realtime/update` | Simulink 推送（需 Token 验证） |

### 业务接口

| 方法 | 路径 | 说明 | 8010依赖 |
|---|---|---|---|
| GET | `/api/health` | 健康检查 + 数据库状态 | 否 |
| GET | `/api/algorithm/health` | 8010 算法服务状态 | 是 |
| POST | `/api/forecast/realtime` | 源荷预测 | 是→fallback |
| POST | `/api/boundary/analyze-realtime` | 边界判定 (scan/evaluate) | 是→fallback |
| POST | `/api/transfer/recommend-realtime` | 转供推荐（异步 job） | 是→fallback |
| POST | `/api/transfer/evaluate-realtime` | 转供评估（本地规则） | 否 |
| GET | `/api/transfer/jobs/{id}` | 查询异步任务状态 | 是 |
| GET | `/api/transfer/jobs/{id}/result` | 获取异步任务结果 | 是 |
| POST | `/api/transfer/external-score/update` | 外部评分结果回填 | 否 |

### 8010 操作序列 + 安全校验（case_id 体系）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/operation-sequence/generate` | 8010 prepare→generate 链路，失败降级本地 |
| POST | `/api/safety/validate` | 8010 case_id 安全校验，支持 auto-rebuild |
| POST | `/api/sequence/generate` | ⚠️ [DEPRECATED] 纯本地规则，请用 `/api/operation-sequence/generate` |

### 模板化成票

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/ticket/generate` | 生成操作票 |
| GET | `/api/tickets` | 操作票列表 |
| GET | `/api/ticket/{id}/export` | 导出 Excel |

### 安全校验（独立）

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/safety/validate-realtime` | 实时数据安全校验 |
| POST | `/api/safety/isolation_check` | 故障场景模型校验 |

## 8010 算法接入

### 配置

`.env` 文件：
```env
ALGO_SERVICE_BASE_URL=http://100.73.79.86:8010
ALGO_SERVICE_KEY=ieee33-test-20260719-A7m4Q9x2L6p8
```

### 调用链路

```
prepareSequence() → POST /api/v1/ticket-cases/prepare   (同步方案)
generateSequence() → POST /api/v1/operation-sequence/generate (生成序列)
validateSafety() → POST /api/v1/safety/validate           (安全校验)
```

- Key 仅存在 `.env`，不暴露给前端
- 8010 不可用时自动降级本地规则（BFS 拓扑 + 100 点评分引擎 + 规则版序列）
- 异步评分通过 job 轮询实现

## Simulink 实时数据接入

Simulink/MATLAB 通过 POST `/api/realtime/update` 推送实时数据，需携带 `X-Simulink-Token` 验证。

推送格式：
```json
{
  "timestamp": "2026-07-28 12:00:00",
  "nodes": [{ "node": 1, "load_kw": 100, "voltage_pu": 0.98, "pv_kw": 0, "ev_kw": 0, "risk_level": "low" }],
  "lines": [{ "line": "13-14", "current_a": 120, "power_kw": 300, "status": 1 }]
}
```

## 安全校验规则（8 项）

| # | 规则 | 级别 | 类别 |
|---|---|---|---|
| R1 | 设备状态校验 | 阻断 | 五防 |
| R2 | 倒闸顺序校验 | 阻断 | 操作顺序 |
| R3 | 拓扑关系校验 | 阻断 | 拓扑 |
| R4 | 容量约束校验 | 阻断 | 潮流 |
| R5 | N-1 约束校验 | 警告 | 潮流 |
| R6 | FA 策略校验 | 警告 | 自动化 |
| R7 | 五防互锁校验 | 阻断 | 五防 |
| R8 | 人工修改复校 | 警告 | 审核 |

## 状态管理

`currentWorkflow` 为全系统唯一数据源，存储在 localStorage：

```
fault_line → boundary_result → transfer_result/selected_plan
  → operation_sequence/sequence_result(case_id)
  → safety_result → ticket
```

每个页面写入时清除下游字段，确保数据一致性。不再使用旧 `current_ticket` / `current_selected_plan` 等 key。

## 限制

- 不修改 8010 算法服务
- 不修改 `/api/realtime/update` 和 Simulink Token
- `formal_ticket_authorized=false`，不生成正式操作票
- 前端不直连 8010，Key 不暴露
- 当前为 IEEE33 仿真验证阶段

## License

Internal use.
