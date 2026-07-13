@echo off
chcp 65001 >nul
title 快速启动

echo 正在启动...
set ROOT=%~dp0

:: 用已知正确的路径
set PYTHON=D:\schoolpython\python.exe

:: 启动 MySQL
start "M" /B C:\mysql-8.0\bin\mysqld.exe --datadir=C:\mysql-8.0\data --port=3306
timeout /t 2 /nobreak >nul

:: 启动后端
cd /d "%ROOT%backend"
start "API" /B %PYTHON% -m uvicorn main:app --host 0.0.0.0 --port 8000
timeout /t 3 /nobreak >nul

:: 启动前端
cd /d "%ROOT%frontend"
start "Web" /B cmd /c "npm run dev"
timeout /t 5 /nobreak >nul

:: 打开浏览器
start http://localhost:5173

echo.
echo 前端: http://localhost:5173
echo 后端: http://localhost:8000/docs
pause
