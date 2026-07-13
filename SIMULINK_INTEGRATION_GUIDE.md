# MATLAB/Simulink 联调说明

> 请张同学按本文档将 Simulink 仿真数据推送到成票系统后端。

---

## 1. 接口地址

```
POST http://<Tailscale_IP>:8000/api/realtime/update
```

> Tailscale IP 由我这边的 `tailscale status` 获取，请先确认双方在同一 Tailscale 网络。

## 2. 请求头

| Header | 值 |
|--------|-----|
| `Content-Type` | `application/json` |
| `X-Simulink-Token` | `我单独发给你的 token` |

> **重要**：不带 token 或 token 错误时，系统会显示 **"未验证Simulink数据"**（红色警告）。只有 token 匹配后，前端才显示 **"Simulink实时数据"**（绿色标签）。

## 3. JSON 请求体

```json
{
  "source": "simulink",
  "timestamp": "2026-07-13 15:30:00",
  "nodes": [
    {
      "node": 1,
      "load_kw": 100.0,
      "voltage_pu": 0.99,
      "pv_kw": 20.0,
      "ev_kw": 5.0,
      "risk_level": "low"
    }
  ],
  "lines": [
    {
      "line": "1-2",
      "current_a": 80.0,
      "power_kw": 150.0,
      "status": 1
    }
  ],
  "switches": {
    "Switch1": 1,
    "Switch17": 0,
    "Switch18": 0,
    "Switch36": 0
  }
}
```

## 4. 字段说明

### nodes 数组（每个节点）

| 字段 | 类型 | 说明 | 示例 |
|------|------|------|------|
| `node` | int | 节点编号 (1-33) | `1` |
| `load_kw` | float | 有功负荷 (kW) | `100.0` |
| `voltage_pu` | float | 电压标幺值 (pu) | `0.99` |
| `pv_kw` | float | 光伏出力 (kW)，无为 0 | `20.0` |
| `ev_kw` | float | 电动汽车充电 (kW)，无为 0 | `5.0` |
| `risk_level` | string | 风险等级：`low` / `medium` / `high` | `"low"` |

### lines 数组（每条线路）

| 字段 | 类型 | 说明 | 示例 |
|------|------|------|------|
| `line` | string | 线路名称 (两端节点编号) | `"1-2"` |
| `current_a` | float | 电流 (A) | `80.0` |
| `power_kw` | float | 传输功率 (kW) | `150.0` |
| `status` | int | 状态：1=闭合, 0=断开 | `1` |

### switches 对象（开关状态）

37 个开关的键值对：`"Switch1"` 到 `"Switch37"`。1=闭合，0=断开。

联络开关通常为 0（断开）：`Switch17, Switch18, Switch36` 建议设为 0。

## 5. MATLAB 示例代码

### 方式 A：使用 `webwrite`

```matlab
% === 配置 ===
url = 'http://<Tailscale_IP>:8000/api/realtime/update';
token = '我单独发给你的 token';  % 从环境变量或配置文件读取

% === 构造节点数据 ===
nodes = struct();
for i = 1:33
    nodes(i).node = i;
    nodes(i).load_kw = load_data(i);      % 你的 Simulink 负荷数据
    nodes(i).voltage_pu = voltage_data(i); % 你的 Simulink 电压数据
    nodes(i).pv_kw = pv_data(i);           % 光伏
    nodes(i).ev_kw = ev_data(i);           % 电动汽车
    % 风险等级判定
    v = voltage_data(i);
    if v < 0.94
        nodes(i).risk_level = 'high';
    elseif v < 0.96
        nodes(i).risk_level = 'medium';
    else
        nodes(i).risk_level = 'low';
    end
end

% === 构造线路数据 (32 条) ===
line_pairs = {1,2; 2,3; 3,4; 4,5; 5,6; 6,7; 7,8; 8,9; 9,10; ...
              10,11; 11,12; 12,13; 13,14; 14,15; 15,16; 16,17; 17,18; ...
              2,19; 19,20; 20,21; 21,22; ...
              3,23; 23,24; 24,25; ...
              6,26; 26,27; 27,28; 28,29; 29,30; 30,31; 31,32; 32,33};
lines = struct();
for i = 1:32
    lines(i).line = sprintf('%d-%d', line_pairs{i,1}, line_pairs{i,2});
    lines(i).current_a = current_data(i);   % 你的电流数据
    lines(i).power_kw = power_data(i);      % 你的功率数据
    lines(i).status = 1;
end

% === 构造开关 (37 个) ===
switches = struct();
for i = 1:37
    key = sprintf('Switch%d', i);
    switches.(key) = 1;  % 默认闭合
end
switches.Switch17 = 0;
switches.Switch18 = 0;
switches.Switch36 = 0;

% === 组装 + 发送 ===
body = struct();
body.source = 'simulink';
body.timestamp = datestr(now, 'yyyy-mm-dd HH:MM:SS');
body.nodes = nodes;
body.lines = lines;
body.switches = switches;

% 设置请求头
options = weboptions('MediaType', 'application/json');
options.RequestMethod = 'post';
options.HeaderFields = {
    'X-Simulink-Token', token;
    'Content-Type', 'application/json'
};

% 发送
response = webwrite(url, body, options);
disp(response);
```

### 方式 B：使用 `send` + `matlab.net.http`

```matlab
url = 'http://<Tailscale_IP>:8000/api/realtime/update';
token = '我单独发给你的 token';

body_json = jsonencode(body);  % body 构造同上

request = matlab.net.http.RequestMessage('POST', ...
    [matlab.net.http.HeaderField('Content-Type', 'application/json'), ...
     matlab.net.http.HeaderField('X-Simulink-Token', token)], ...
    matlab.net.http.MessageBody(body_json));

uri = matlab.net.URI(url);
response = send(request, uri);
disp(response.Body.Data);
```

## 6. 测试步骤

### 第一步：小规模验证（1-2 节点）

先用 1-2 个节点测试连通性：

```matlab
body.source = 'simulink';
body.timestamp = datestr(now, 'yyyy-mm-dd HH:MM:SS');
body.nodes = [
    struct('node',1,'load_kw',100,'voltage_pu',0.99,'pv_kw',20,'ev_kw',5,'risk_level','low'),
    struct('node',2,'load_kw',50,'voltage_pu',1.00,'pv_kw',10,'ev_kw',2,'risk_level','low')
];
body.lines = [
    struct('line','1-2','current_a',80,'power_kw',150,'status',1)
];
body.switches = struct('Switch1', 1);

options.HeaderFields = {'X-Simulink-Token', token; 'Content-Type', 'application/json'};
response = webwrite(url, body, options);
disp(response);
```

**预期返回**：
```json
{
  "success": true,
  "source_tag": "simulink",
  "trusted_source": true,
  "message": "Simulink/MATLAB 实时数据已接入"
}
```

### 第二步：扩展到 33 节点

确认第一步成功后，将完整的 33 节点、32 线路、37 开关数据一次性推送。

## 7. 预期行为

| 推送方式 | source_tag | trusted | 系统前端显示 |
|----------|:---|:---:|------|
| 带正确 token | `simulink` | `true` | 📡 Simulink实时数据 (绿) |
| 不带 token | `unverified_simulink` | `false` | ⚠ 未验证Simulink数据 (红) |
| 带错误 token | `unverified_simulink` | `false` | ⚠ 未验证Simulink数据 (红) |

## 8. 注意事项

1. Token 请妥善保管，不要提交到 Git 仓库
2. 每推送一次，系统内存缓存中的旧数据会被覆盖
3. 后端重启后缓存清空，需要重新推送
4. 推送间隔建议不超过实际仿真步长
5. 如遇问题先检查 `http://<Tailscale_IP>:8000/docs` 确认后端在线
