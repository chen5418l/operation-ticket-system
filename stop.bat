@echo off
chcp 65001 >nul
echo ============================================
echo   停止前后端服务
echo ============================================

echo 正在关闭后端 (端口 8000)...
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr :8000 ^| findstr LISTENING 2^>nul') do (
    taskkill /F /PID %%a >nul 2>&1 && echo   后端 PID %%a 已终止
)

echo 正在关闭前端 (端口 5173)...
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr :5173 ^| findstr LISTENING 2^>nul') do (
    taskkill /F /PID %%a >nul 2>&1 && echo   前端 PID %%a 已终止
)

echo 正在关闭 MySQL (端口 3306)...
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr :3306 ^| findstr LISTENING 2^>nul') do (
    taskkill /F /PID %%a >nul 2>&1 && echo   MySQL PID %%a 已终止
)

echo.
echo ============================================
echo   所有服务已停止
echo ============================================
pause
