# 国网江苏市级配电网智能成票与安全校验系统 — PowerShell 启动脚本
$ErrorActionPreference = "Stop"
$Host.UI.RawUI.WindowTitle = "国网江苏市级配电网智能成票与安全校验系统"

Write-Host "============================================" -ForegroundColor Green
Write-Host "  国网江苏市级配电网智能成票与安全校验系统" -ForegroundColor Green
Write-Host "  一键启动脚本 (PowerShell)" -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
Write-Host ""

$ROOT = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ROOT

# 1. 安装后端依赖
Write-Host "[1/4] 安装后端依赖..." -ForegroundColor Yellow
Set-Location "$ROOT\backend"
pip install -r requirements.txt 2>&1 | Out-Null
Write-Host "      后端依赖安装完成" -ForegroundColor Green

# 2. 启动后端
Write-Host "[2/4] 启动后端服务 (端口 8000)..." -ForegroundColor Yellow
$backendJob = Start-Process -FilePath "python" -ArgumentList "-m","uvicorn","main:app","--reload","--host","0.0.0.0","--port","8000" -NoNewWindow -PassThru

# 3. 安装前端依赖
Write-Host "[3/4] 安装前端依赖..." -ForegroundColor Yellow
Set-Location "$ROOT\frontend"
npm install 2>&1 | Out-Null
Write-Host "      前端依赖安装完成" -ForegroundColor Green

# 4. 启动前端
Write-Host "[4/4] 启动前端服务 (端口 5173)..." -ForegroundColor Yellow
$frontendJob = Start-Process -FilePath "cmd" -ArgumentList "/c","npm run dev" -NoNewWindow -PassThru

# 等待启动
Write-Host ""
Write-Host "等待服务启动..." -ForegroundColor Yellow
Start-Sleep -Seconds 6

# 打开浏览器
Write-Host "正在打开浏览器..." -ForegroundColor Cyan
Start-Process "http://localhost:5173"

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host "  启动完成！" -ForegroundColor Green
Write-Host ""
Write-Host "  前端页面：http://localhost:5173" -ForegroundColor Cyan
Write-Host "  后端接口：http://localhost:8000" -ForegroundColor Cyan
Write-Host "  接口文档：http://localhost:8000/docs" -ForegroundColor Cyan
Write-Host "  健康检查：http://localhost:8000/api/health" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Green

# 保存 PID 以便停止
$backendJob.Id, $frontendJob.Id | Out-File -FilePath "$ROOT\.running_pids.txt"
Write-Host ""
Write-Host "按 Enter 退出此窗口（不影响前后端运行）"
Read-Host
