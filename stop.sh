#!/bin/bash
# 停止前后端服务 (Mac/Linux)

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "============================================"
echo "  停止前后端服务 (Mac/Linux)"
echo "============================================"

# 从 PID 文件读取
if [ -f "$ROOT_DIR/.running_pids.txt" ]; then
    read -r BACKEND_PID FRONTEND_PID < "$ROOT_DIR/.running_pids.txt"
    kill "$BACKEND_PID" 2>/dev/null && echo "后端进程 $BACKEND_PID 已终止"
    kill "$FRONTEND_PID" 2>/dev/null && echo "前端进程 $FRONTEND_PID 已终止"
    rm -f "$ROOT_DIR/.running_pids.txt"
fi

# 备用：按端口清理
echo "按端口清理残留进程..."
lsof -ti:8000 2>/dev/null | xargs kill 2>/dev/null && echo "  端口 8000 已释放"
lsof -ti:5173 2>/dev/null | xargs kill 2>/dev/null && echo "  端口 5173 已释放"

echo "============================================"
echo "  服务已停止"
echo "============================================"
