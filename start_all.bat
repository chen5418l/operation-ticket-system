@echo off
chcp 65001 >nul
echo ============================================
echo  配电网智能成票系统 — 一键启动
echo ============================================

REM 1. MySQL
echo [1/3] 启动 MySQL...
start "MySQL" /MIN C:\mysql-8.0\bin\mysqld.exe --console
timeout /t 5 /nobreak >nul
echo   MySQL 已启动

REM 2. FastAPI 后端
echo [2/3] 启动后端 (FastAPI :8000)...
start "Backend" /MIN D:\schoolpython\python.exe -m uvicorn main:app --host 0.0.0.0 --port 8000
cd /d "%~dp0backend"
timeout /t 5 /nobreak >nul
echo   后端已启动

REM 3. Vue/React 前端
echo [3/3] 启动前端 (Vite :5173)...
cd /d "%~dp0frontend"
start "Frontend" /MIN cmd /c "npm run dev -- --host 0.0.0.0 --port 5173"
timeout /t 6 /nobreak >nul
echo   前端已启动

echo ============================================
echo  全部启动完成！
echo  后端: http://localhost:8000
echo  前端: http://localhost:5173
echo  按任意键打开浏览器...
pause >nul
start http://localhost:5173
