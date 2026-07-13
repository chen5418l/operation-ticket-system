@echo off
chcp 65001 >nul
title 国网江苏市级配电网智能成票与安全校验系统
echo ============================================
echo   一键启动
echo ============================================
echo.

set ROOT=%~dp0

:: 用经过验证的路径
set PYTHON=D:\schoolpython\python.exe
echo [INFO] Python: %PYTHON%
echo [INFO] npm: npm

echo.
echo [0/6] 清理旧进程...
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr :8000 ^| findstr LISTENING 2^>nul') do taskkill /F /PID %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr :5173 ^| findstr LISTENING 2^>nul') do taskkill /F /PID %%a >nul 2>&1
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr :5000 ^| findstr LISTENING 2^>nul') do taskkill /F /PID %%a >nul 2>&1
echo       已清理

echo [1/6] 启动 MySQL...
start "MySQL" /B C:\mysql-8.0\bin\mysqld.exe --datadir=C:\mysql-8.0\data --port=3306 2>nul
timeout /t 2 /nobreak >nul
echo       MySQL 已启动

echo [2/6] 启动 Flask 数据服务 (端口 5000)...
cd /d "%USERPROFILE%\Desktop"
start "FlaskData" /B %PYTHON% Table.py
timeout /t 3 /nobreak >nul
echo       Flask 数据服务启动中...

echo [3/6] 安装后端依赖...
cd /d "%ROOT%backend"
%PYTHON% -m pip install -r requirements.txt --quiet 2>nul
echo       完成

echo [4/6] 启动后端 (端口 8000)...
start "Backend" /B %PYTHON% -m uvicorn main:app --host 0.0.0.0 --port 8000
timeout /t 4 /nobreak >nul
echo       后端启动中...

echo [5/6] 安装前端依赖...
cd /d "%ROOT%frontend"
call npm install --silent 2>nul
echo       完成

echo [6/6] 启动前端 (端口 5173)...
start "Frontend" /B cmd /c "npm run dev"
timeout /t 6 /nobreak >nul
echo       前端启动中...

start http://localhost:5173

echo.
echo ============================================
echo   前端:     http://localhost:5173
echo   后端:     http://localhost:8000
echo   Flask数据: http://localhost:5000
echo ============================================
echo.
pause
