#!/bin/bash
# 国网江苏市级配电网智能成票与安全校验系统 — 一键启动脚本 (Mac/Linux)

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

echo -e "${GREEN}============================================"
echo -e "  国网江苏市级配电网智能成票与安全校验系统"
echo -e "  一键启动脚本 (Mac/Linux)"
echo -e "============================================${NC}"
echo ""

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR"

command -v node >/dev/null 2>&1 || { echo "[ERROR] 未找到 Node.js，请先安装"; exit 1; }
command -v python3 >/dev/null 2>&1 || { echo "[ERROR] 未找到 Python3，请先安装"; exit 1; }

echo -e "${YELLOW}[1/4] 安装后端依赖...${NC}"
cd "$ROOT_DIR/backend"
pip3 install -r requirements.txt > /dev/null 2>&1
echo -e "${GREEN}      后端依赖安装完成${NC}"

echo -e "${YELLOW}[2/4] 启动后端服务 (端口 8000)...${NC}"
python3 -m uvicorn main:app --reload --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!

echo -e "${YELLOW}[3/4] 安装前端依赖...${NC}"
cd "$ROOT_DIR/frontend"
npm install > /dev/null 2>&1
echo -e "${GREEN}      前端依赖安装完成${NC}"

echo -e "${YELLOW}[4/4] 启动前端服务 (端口 5173)...${NC}"
npm run dev &
FRONTEND_PID=$!

echo "$BACKEND_PID $FRONTEND_PID" > "$ROOT_DIR/.running_pids.txt"

echo ""
echo -e "${YELLOW}等待服务启动...${NC}"
sleep 6

echo -e "${CYAN}正在打开浏览器...${NC}"
if command -v open >/dev/null 2>&1; then open http://localhost:5173
elif command -v xdg-open >/dev/null 2>&1; then xdg-open http://localhost:5173; fi

echo ""
echo -e "${GREEN}============================================"
echo -e "  启动完成！"
echo -e ""
echo -e "  前端页面：${CYAN}http://localhost:5173${GREEN}"
echo -e "  后端接口：${CYAN}http://localhost:8000${GREEN}"
echo -e "  接口文档：${CYAN}http://localhost:8000/docs${GREEN}"
echo -e "  健康检查：${CYAN}http://localhost:8000/api/health${GREEN}"
echo -e "============================================${NC}"
echo ""
echo "按 Ctrl+C 停止所有服务"
echo ""

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; rm -f $ROOT_DIR/.running_pids.txt; exit" SIGINT SIGTERM
wait
