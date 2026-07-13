# ============================================================
# test_realtime_manual.ps1
# 测试普通手动数据推送 — 不声明为 Simulink
# 预期: source_tag="test"  trusted_source=false  前端显示"测试实时数据"
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
    source    = "test"
    timestamp = (Get-Date -Format "yyyy-MM-dd HH:mm:ss")
    nodes     = $nodes
    lines     = @()
    switches  = @{}
} | ConvertTo-Json -Depth 3

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  test_realtime_manual" -ForegroundColor Cyan
Write-Host "  推送 source=test (普通手动数据)" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# ---- 1) POST /update ----
Write-Host "[1] POST $BASE_URL/api/realtime/update" -ForegroundColor Yellow
Write-Host "    Body: source=test, nodes=$($nodes.Count)" -ForegroundColor Gray

$updateResult = Invoke-RestMethod -Uri "$BASE_URL/api/realtime/update" `
    -Method Post `
    -ContentType "application/json" `
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
Write-Host "    timestamp     : $($latestResult.timestamp)" -ForegroundColor Green
Write-Host "    message       : $($latestResult.message)" -ForegroundColor Green

# ---- 3) 判定 ----
Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
if ($latestResult.source_tag -eq "test" -and $latestResult.trusted_source -eq $false) {
    Write-Host "  ✅ 通过: source_tag=test, trusted_source=false" -ForegroundColor Green
    Write-Host "  前端显示: 🧪 测试实时数据" -ForegroundColor Green
} else {
    Write-Host "  ❌ 失败: 预期 source_tag=test, trusted_source=false" -ForegroundColor Red
    Write-Host "  实际: source_tag=$($latestResult.source_tag), trusted_source=$($latestResult.trusted_source)" -ForegroundColor Red
}
Write-Host "============================================" -ForegroundColor Cyan
