# ============================================================
# test_realtime_simulink_verified.ps1
# 模拟张同学的真实 Simulink 推送 — 带正确密钥
# 预期: source_tag="simulink"  trusted_source=true  前端显示"Simulink实时数据"
# ============================================================

# ---- 配置（可改为 Tailscale 地址）----
$BASE_URL = "http://localhost:8000"

# ---- Simulink 联调密钥 ----
# 从环境变量读取，绝不硬编码真实 token
# 使用前请先设置: $env:SIMULINK_SOURCE_TOKEN = "你的密钥"
if ($env:SIMULINK_SOURCE_TOKEN) {
    $SIMULINK_TOKEN = $env:SIMULINK_SOURCE_TOKEN
} else {
    Write-Host "ERROR: 请先设置环境变量 SIMULINK_SOURCE_TOKEN" -ForegroundColor Red
    Write-Host '  例如: $env:SIMULINK_SOURCE_TOKEN = "your_token_here"' -ForegroundColor Yellow
    exit 1
}

# ---- 构造 33 节点测试数据 ----
$nodes = @()
for ($i = 1; $i -le 33; $i++) {
    $load = if ($i -eq 1) { 0 } else { [math]::Round((Get-Random -Min 40 -Max 200), 2) }
    $v    = [math]::Round((Get-Random -Min 0.93 -Max 1.02), 3)
    $pv   = if ($i -in @(6, 14, 30)) { [math]::Round((Get-Random -Min 0 -Max 50), 2) } else { 0 }
    $ev   = if ($i -in @(8, 14, 24, 30, 32)) { [math]::Round((Get-Random -Min 0 -Max 100), 2) } else { 0 }
    $risk = if ($v -lt 0.94) { "high" } elseif ($v -lt 0.96) { "medium" } else { "low" }
    $nodes += @{
        node       = $i
        load_kw    = $load
        voltage_pu = $v
        pv_kw      = $pv
        ev_kw      = $ev
        risk_level = $risk
    }
}

# 构造 32 条线路
$linePairs = @(
    (1,2),(2,3),(3,4),(4,5),(5,6),(6,7),(7,8),(8,9),(9,10),(10,11),(11,12),(12,13),
    (13,14),(14,15),(15,16),(16,17),(17,18),(2,19),(19,20),(20,21),(21,22),
    (3,23),(23,24),(24,25),(6,26),(26,27),(27,28),(28,29),(29,30),(30,31),(31,32),(32,33)
)
$lines = @()
foreach ($pair in $linePairs) {
    $a, $b = $pair
    $lines += @{
        line      = "$a-$b"
        current_a = [math]::Round((Get-Random -Min 50 -Max 200), 1)
        power_kw  = [math]::Round((Get-Random -Min 100 -Max 500), 1)
        status    = 1
    }
}

# 37 个开关
$switches = @{}
for ($i = 1; $i -le 37; $i++) {
    $switches["Switch$i"] = 1
}
$switches["Switch17"] = 0
$switches["Switch18"] = 0
$switches["Switch36"] = 0

$body = @{
    source    = "simulink"
    timestamp = (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
    nodes     = $nodes
    lines     = $lines
    switches  = $switches
} | ConvertTo-Json -Depth 3

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  test_realtime_simulink_verified" -ForegroundColor Cyan
Write-Host "  模拟张同学 Simulink 推送 — 带正确密钥" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# ---- 1) POST /update with token ----
Write-Host "[1] POST $BASE_URL/api/realtime/update" -ForegroundColor Yellow
Write-Host "    Body: source=simulink, nodes=$($nodes.Count), lines=$($lines.Count), switches=$($switches.Count)" -ForegroundColor Gray
Write-Host "    Header: X-Simulink-Token: $SIMULINK_TOKEN" -ForegroundColor Gray

$updateResult = Invoke-RestMethod -Uri "$BASE_URL/api/realtime/update" `
    -Method Post `
    -ContentType "application/json" `
    -Headers @{ "X-Simulink-Token" = $SIMULINK_TOKEN } `
    -Body $body

Write-Host "    source_tag    : $($updateResult.source_tag)" -ForegroundColor Green
Write-Host "    trusted_source: $($updateResult.trusted_source)" -ForegroundColor Green
Write-Host "    message       : $($updateResult.message)" -ForegroundColor Green

# ---- 2) GET /latest ----
Write-Host ""
Write-Host "[2] GET $BASE_URL/api/realtime/latest" -ForegroundColor Yellow

$latestResult = Invoke-RestMethod -Uri "$BASE_URL/api/realtime/latest" -Method Get

Write-Host "    has_data      : $($latestResult.has_data)" -ForegroundColor Green
Write-Host "    source_tag    : $($latestResult.source_tag)" -ForegroundColor Green
Write-Host "    trusted_source: $($latestResult.trusted_source)" -ForegroundColor Green
Write-Host "    nodes         : $(if ($latestResult.nodes) { $latestResult.nodes.Count } else { 0 })" -ForegroundColor Green
Write-Host "    lines         : $(if ($latestResult.lines) { $latestResult.lines.Count } else { 0 })" -ForegroundColor Green
Write-Host "    switches      : $(if ($latestResult.switches) { $latestResult.switches.Keys.Count } else { 0 })" -ForegroundColor Green
Write-Host "    timestamp     : $($latestResult.timestamp)" -ForegroundColor Green
Write-Host "    message       : $($latestResult.message)" -ForegroundColor Green

# ---- 3) GET /status ----
Write-Host ""
Write-Host "[3] GET $BASE_URL/api/realtime/status" -ForegroundColor Yellow

$statusResult = Invoke-RestMethod -Uri "$BASE_URL/api/realtime/status" -Method Get

Write-Host "    has_data      : $($statusResult.has_data)" -ForegroundColor Green
Write-Host "    source_tag    : $($statusResult.source_tag)" -ForegroundColor Green
Write-Host "    trusted_source: $($statusResult.trusted_source)" -ForegroundColor Green
Write-Host "    message       : $($statusResult.message)" -ForegroundColor Green

# ---- 4) 判定 ----
Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan

$pass = $true

if ($latestResult.source_tag -eq "simulink") {
    Write-Host "  ✅ 通过: source_tag=simulink" -ForegroundColor Green
} else {
    Write-Host "  ❌ 失败: 预期 source_tag=simulink, 实际 $($latestResult.source_tag)" -ForegroundColor Red
    $pass = $false
}

if ($latestResult.trusted_source -eq $true) {
    Write-Host "  ✅ 通过: trusted_source=true" -ForegroundColor Green
} else {
    Write-Host "  ❌ 失败: 预期 trusted_source=true, 实际 $($latestResult.trusted_source)" -ForegroundColor Red
    $pass = $false
}

if ($latestResult.nodes.Count -eq 33) {
    Write-Host "  ✅ 通过: 33 节点数据完整" -ForegroundColor Green
} else {
    Write-Host "  ⚠ 警告: 节点数=$($latestResult.nodes.Count) (预期33)" -ForegroundColor Yellow
}

if ($pass) {
    Write-Host ""
    Write-Host "  前端显示: 📡 Simulink实时数据 (绿)" -ForegroundColor Green
    Write-Host "  数据已成功标记为可信 Simulink 来源" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "  ⚠ 验证失败，请检查:" -ForegroundColor Red
    Write-Host "    1) 后端 .env 中 SIMULINK_SOURCE_TOKEN 是否为 你的约定密钥" -ForegroundColor Red
    Write-Host "    2) 请求头 X-Simulink-Token 是否正确" -ForegroundColor Red
}

Write-Host "============================================" -ForegroundColor Cyan
