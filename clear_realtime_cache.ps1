# ============================================================
# clear_realtime_cache.ps1
# 清空后端内存中的实时数据缓存
# 预期: GET /api/realtime/latest → has_data=false, source_tag="none", nodes=[]
# ============================================================

# ---- 配置（可改为 Tailscale 地址）----
$BASE_URL = "http://localhost:8000"

Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  clear_realtime_cache" -ForegroundColor Cyan
Write-Host "  清空实时数据内存缓存" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""

# ---- 1) 清空前状态 ----
Write-Host "[1] 清空前 /api/realtime/latest" -ForegroundColor Yellow

try {
    $before = Invoke-RestMethod -Uri "$BASE_URL/api/realtime/latest" -Method Get
    Write-Host "    has_data      : $($before.has_data)" -ForegroundColor Gray
    Write-Host "    source_tag    : $($before.source_tag)" -ForegroundColor Gray
    Write-Host "    trusted_source: $($before.trusted_source)" -ForegroundColor Gray
    Write-Host "    nodes         : $(if ($before.nodes) { $before.nodes.Count } else { 0 })" -ForegroundColor Gray
} catch {
    Write-Host "    (无法获取清空前状态)" -ForegroundColor DarkGray
}

# ---- 2) POST /clear ----
Write-Host ""
Write-Host "[2] POST $BASE_URL/api/realtime/clear" -ForegroundColor Yellow

$clearResult = Invoke-RestMethod -Uri "$BASE_URL/api/realtime/clear" -Method Post

Write-Host "    success : $($clearResult.success)" -ForegroundColor Green
Write-Host "    message : $($clearResult.message)" -ForegroundColor Green

# ---- 3) 清空后状态 ----
Write-Host ""
Write-Host "[3] 清空后 /api/realtime/latest" -ForegroundColor Yellow

$after = Invoke-RestMethod -Uri "$BASE_URL/api/realtime/latest" -Method Get

Write-Host "    has_data      : $($after.has_data)" -ForegroundColor Green
Write-Host "    source_tag    : $($after.source_tag)" -ForegroundColor Green
Write-Host "    trusted_source: $($after.trusted_source)" -ForegroundColor Green
Write-Host "    nodes         : $(if ($after.nodes) { $after.nodes.Count } else { 0 })" -ForegroundColor Green
Write-Host "    lines         : $(if ($after.lines) { $after.lines.Count } else { 0 })" -ForegroundColor Green
Write-Host "    timestamp     : $($after.timestamp)" -ForegroundColor Green
Write-Host "    message       : $($after.message)" -ForegroundColor Green

# ---- 4) 清空后 status ----
Write-Host ""
Write-Host "[4] 清空后 /api/realtime/status" -ForegroundColor Yellow

$statusAfter = Invoke-RestMethod -Uri "$BASE_URL/api/realtime/status" -Method Get

Write-Host "    has_data      : $($statusAfter.has_data)" -ForegroundColor Green
Write-Host "    source_tag    : $($statusAfter.source_tag)" -ForegroundColor Green
Write-Host "    trusted_source: $($statusAfter.trusted_source)" -ForegroundColor Green
Write-Host "    message       : $($statusAfter.message)" -ForegroundColor Green

# ---- 5) 判定 ----
Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan

$pass = $true

if ($after.has_data -eq $false) {
    Write-Host "  ✅ 通过: has_data=false" -ForegroundColor Green
} else {
    Write-Host "  ❌ 失败: 预期 has_data=false, 实际 $($after.has_data)" -ForegroundColor Red
    $pass = $false
}

if ($after.source_tag -eq "none") {
    Write-Host "  ✅ 通过: source_tag=none" -ForegroundColor Green
} else {
    Write-Host "  ❌ 失败: 预期 source_tag=none, 实际 $($after.source_tag)" -ForegroundColor Red
    $pass = $false
}

if ($after.trusted_source -eq $false) {
    Write-Host "  ✅ 通过: trusted_source=false" -ForegroundColor Green
} else {
    Write-Host "  ❌ 失败: 预期 trusted_source=false" -ForegroundColor Red
    $pass = $false
}

if ($after.nodes.Count -eq 0) {
    Write-Host "  ✅ 通过: nodes 已清空 (0)" -ForegroundColor Green
} else {
    Write-Host "  ❌ 失败: 预期 nodes=[], 实际 $($after.nodes.Count) 个节点" -ForegroundColor Red
    $pass = $false
}

if ($pass) {
    Write-Host ""
    Write-Host "  缓存已清空，前端显示: 📭 暂无实时数据" -ForegroundColor Green
    Write-Host "  重启后端效果与此相同" -ForegroundColor Green
}

Write-Host "============================================" -ForegroundColor Cyan
