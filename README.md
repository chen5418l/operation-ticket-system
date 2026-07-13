# 国网江苏市级配电网智能成票与安全校验系统

市级配电网故障处置、负荷转供、操作序列生成、模板化成票与安全校验的原型演示系统。IEEE 33 节点标准拓扑，前后端分离架构。

## 技术栈

| 层次 | 技术 |
|------|------|
| 前端 | React 19 + Vite 8 + TypeScript 6 |
| 后端 | Python 3 + FastAPI + SQLAlchemy |
| 数据库 | MySQL 8.0 |
| 导出 | openpyxl (Excel) |
| 部署 | Docker + Docker Compose |

## 快速启动

**Windows：** 双击 `start.bat`
**macOS/Linux：** `chmod +x start.sh && ./start.sh`
**Docker：** `docker compose up -d --build`

## 访问地址

| 服务 | 地址 |
|------|------|
| 前端 | http://localhost:5173 |
| 后端 | http://localhost:8000 |
| 接口文档 | http://localhost:8000/docs |
| 健康检查 | http://localhost:8000/api/health |

## Simulink 实时数据接入

### 数据源模式

环境变量 `DATA_SOURCE_MODE`：
- `static` — 静态拓扑数据
- `mock` (默认) — 自动生成模拟实时数据
- `realtime` — 接收 Simulink/MATLAB 推送

### API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/realtime/status | 连接状态 |
| GET | /api/realtime/latest | 最新节点/线路/开关数据 |
| POST | /api/realtime/update | Simulink 推送数据 |

### 推送格式示例

```json
POST /api/realtime/update
{
  "timestamp": "2026-07-11 12:00:00",
  "nodes": [
    { "node": 1, "load_kw": 100, "voltage_pu": 0.98, "pv_kw": 0, "ev_kw": 0, "risk_level": "low" }
  ],
  "lines": [
    { "line": "13-14", "current_a": 120, "power_kw": 300, "status": 1 }
  ],
  "switches": {
    "Switch1": 1, "Switch2": 1
  }
}
```

### MATLAB 调用示例

```matlab
data = struct();
data.timestamp = datestr(now, 'yyyy-mm-dd HH:MM:SS');
data.nodes = struct('node', 1, 'load_kw', 100, ...);
data.lines = struct('line', '13-14', 'current_a', 120, ...);
data.switches = struct('Switch1', 1, 'Switch2', 1);
jsonstr = jsonencode(data);
webwrite('http://localhost:8000/api/realtime/update', jsonstr, ...
    weboptions('MediaType','application/json'));
```

## 项目结构

```
frontend/src/
  components/topology/    IEEE33 拓扑单线图
  pages/                  9 个业务页面
  services/               API 客户端
backend/app/
  core/                   配置/数据库
  routers/                15 个 API 端点
  services/               BFS故障分析/转供/校验/成票
```

## API 接口

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | /api/health | 健康检查 |
| GET | /api/topology/ieee33 | IEEE33 拓扑 |
| POST | /api/topology/init-ieee33 | 初始化数据 |
| POST | /api/fault/analyze | 故障分析 |
| POST | /api/transfer/plans | 转供方案 |
| POST | /api/safety/isolation_check | 隔离校验 |
| POST | /api/safety/check | 安全校验 |
| POST | /api/ticket/generate | 生成操作票 |
| GET | /api/tickets | 操作票列表 |
| GET | /api/ticket/{id}/export | 导出 Excel |
| GET | /api/realtime/status | 实时数据状态 |
| GET | /api/realtime/latest | 实时数据 |
| POST | /api/realtime/update | Simulink 推送 |

## 版本说明

V2.0 原型演示系统。IEEE 33 节点标准拓扑。模拟数据，不下发控制指令。
