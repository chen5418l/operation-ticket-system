@echo off
chcp 65001 >nul
echo ========================================
echo  市级配电网智能成票系统 — 后端启动
echo  (含 8010 prepare-generate-safety)
echo ========================================
echo.

REM ====== 1. 杀掉占用 8000 端口的进程 ======
echo [1/3] 关闭 8000 端口旧进程...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8000.*LISTENING"') do (
    echo   发现进程 PID=%%a，正在关闭...
    taskkill /f /pid %%a >nul 2>&1
    if errorlevel 1 (
        echo   警告：无法关闭 PID=%%a（可能需要管理员权限）
    ) else (
        echo   已关闭 PID=%%a
    )
)
timeout /t 3 /nobreak >nul

REM 再次确认端口已释放
netstat -ano | findstr ":8000.*LISTENING" >nul 2>&1
if errorlevel 1 (
    echo   端口 8000 已释放
) else (
    echo   警告：端口 8000 仍被占用，尝试强制关闭...
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8000"') do taskkill /f /pid %%a >nul 2>&1
    timeout /t 2 /nobreak >nul
)
echo.

REM ====== 2. 清理 Python 缓存 ======
echo [2/3] 清理 Python 缓存...
cd /d "%~dp0backend"
for /d /r . %%d in (__pycache__) do @if exist "%%d" rd /s /q "%%d" 2>nul
del /s /q *.pyc 2>nul
echo   缓存已清理
echo.

REM ====== 3. 启动后端（含 8010 端点） ======
echo [3/3] 启动 FastAPI 后端 (http://localhost:8000)...
echo.
echo   后端地址: http://localhost:8000
echo   API 文档: http://localhost:8000/docs
echo   按 Ctrl+C 停止
echo ========================================
echo.

D:\schoolpython\python.exe -m uvicorn main:app --host 0.0.0.0 --port 8000

echo.
echo 后端已停止。
pause
