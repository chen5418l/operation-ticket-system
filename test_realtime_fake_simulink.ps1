# ============================================================
# test_realtime_fake_simulink.ps1
# 测试伪造 Simulink 推送 — 声称 simulink 但不带密钥
# 预期: source_tag="unverified_simulink"  trusted_source=false
#       前端显示"未验证Simulink数据"，绝不能显示"Simulink实时数据"
# ============================================================

# ---- 配置（可改为 Tailscale 地址）----
$BASE_URL = "http://localhost:8000"

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

$body = @{
    source    = "simulink"
    timestamp = (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
    nodes     = $nodes
    lines     = @()
    switches  = @{}
} | ConvertTo-Json -Depth 3

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  test_realtime_fake_simulink" -ForegroundColor Cyan
Write-Host "  伪造 Simulink 推送 — 带 source=simulink 但无密钥" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# ---- 1) 伪造 Simulink（无 token）----
Write-Host "[1] 伪造 Simulink 推送 (无 X-Simulink-Token)" -ForegroundColor Yellow
Write-Host "    Body: source=simulink, nodes=$($nodes.Count)" -ForegroundColor Gray
Write-Host "    Headers: (无 X-Simulink-Token)" -ForegroundColor Gray

$updateResult = Invoke-RestMethod -Uri "$BASE_URL/api/realtime/update" `
    -Method Post `
    -ContentType "application/json" `
    -Body $body

Write-Host "    source_tag    : $($updateResult.source_tag)" -ForegroundColor Yellow
Write-Host "    trusted_source: $($updateResult.trusted_source)" -ForegroundColor Yellow
Write-Host "    message       : $($updateResult.message)" -ForegroundColor Yellow

$fake1Pass = ($updateResult.source_tag -eq "unverified_simulink" -and $updateResult.trusted_source -eq $false)

# ---- 2) 伪造 Simulink（错误 token）----
Write-Host ""
Write-Host "[2] 伪造 Simulink 推送 (错误 X-Simulink-Token)" -ForegroundColor Yellow
Write-Host "    Headers: X-Simulink-Token: wrong-fake-token" -ForegroundColor Gray

$updateResult2 = Invoke-RestMethod -Uri "$BASE_URL/api/realtime/update" `
    -Method Post `
    -ContentType "application/json" `
    -Headers @{ "X-Simulink-Token" = "wrong-fake-token" } `
    -Body $body

Write-Host "    source_tag    : $($updateResult2.source_tag)" -ForegroundColor Yellow
Write-Host "    trusted_source: $($updateResult2.trusted_source)" -ForegroundColor Yellow
Write-Host "    message       : $($updateResult2.message)" -ForegroundColor Yellow

$fake2Pass = ($updateResult2.source_tag -eq "unverified_simulink" -and $updateResult2.trusted_source -eq $false)

# ---- 3) GET /latest ----
Write-Host ""
Write-Host "[3] GET $BASE_URL/api/realtime/latest" -ForegroundColor Yellow

$latestResult = Invoke-RestMethod -Uri "$BASE_URL/api/realtime/latest" -Method Get

Write-Host "    has_data      : $($latestResult.has_data)" -ForegroundColor Green
Write-Host "    source_tag    : $($latestResult.source_tag)" -ForegroundColor Yellow
Write-Host "    trusted_source: $($latestResult.trusted_source)" -ForegroundColor Yellow
Write-Host "    nodes         : $(if ($latestResult.nodes) { $latestResult.nodes.Count } else { 0 })" -ForegroundColor Green
Write-Host "    timestamp     : $($latestResult.timestamp)" -ForegroundColor Green
Write-Host "    message       : $($latestResult.message)" -ForegroundColor Green

# ---- 4) 安全断言 ----
Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan

$allPass = $true

if ($fake1Pass) {
    Write-Host "  ✅ 测试1通过: 无token → unverified_simulink" -ForegroundColor Green
} else {
    Write-Host "  ❌ 测试1失败: 预期 unverified_simulink, 实际 $($updateResult.source_tag)" -ForegroundColor Red
    $allPass = $false
}

if ($fake2Pass) {
    Write-Host "  ✅ 测试2通过: 错误token → unverified_simulink" -ForegroundColor Green
} else {
    Write-Host "  ❌ 测试2失败: 预期 unverified_simulink, 实际 $($updateResult2.source_tag)" -ForegroundColor Red
    $allPass = $false
}

if ($latestResult.source_tag -ne "simulink") {
    Write-Host "  ✅ 安全断言: latest 未返回 source_tag=simulink" -ForegroundColor Green
} else {
    Write-Host "  ❌ 安全漏洞: latest 返回了 source_tag=simulink！" -ForegroundColor Red
    $allPass = $false
}

if ($allPass) {
    Write-Host ""
    Write-Host "  前端显示: ⚠ 未验证Simulink数据 (红)" -ForegroundColor Yellow
    Write-Host "  绝不会显示: 📡 Simulink实时数据" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "  ⚠ 存在安全风险，请检查后端 token 验证逻辑" -ForegroundColor Red
}

Write-Host "============================================" -ForegroundColor Cyan
