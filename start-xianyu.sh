#!/bin/bash
# 闲鱼管家 xianyu-admin.xyz — 持久化启动脚本 (production mode)
# xianyu-admin Nuxt 直接运行在 :3000，Caddy :81 反向代理到 :3000
# 用法: bash /home/z/my-project/start-xianyu.sh

XIANYU_DIR="/home/z/my-project/xianyu-admin"
LOG="/home/z/my-project/xianyu-admin-dev.log"

echo ">>> 停止旧进程..."
pkill -f "node .output/server/index.mjs" 2>/dev/null
sleep 2

echo ">>> 检查 production build..."
if [ ! -f "$XIANYU_DIR/.output/server/index.mjs" ]; then
  echo "  xianyu-admin build 缺失, 重新构建..."
  cd "$XIANYU_DIR"
  [ -d node_modules ] || bun install
  NODE_OPTIONS="--max-old-space-size=2048" bun run build
fi

echo ">>> 检查 Mysql 数据库服务..."
if ! pgrep -f "mysql" > /dev/null; then
  echo "  启动 Mysql..."
  bash /home/z/my-project/services/start-mysql.sh
fi

echo ">>> 启动 xianyu-admin (Nuxt production, :3000)..."
cd "$XIANYU_DIR"
setsid node .output/server/index.mjs > "$LOG" 2>&1 < /dev/null &
disown

sleep 3

echo ">>> 首次运行需要 seed 数据..."
curl -s -X POST http://localhost:3000/api/seed > /dev/null 2>&1 && echo "  seed 完成" || echo "  seed 已存在或跳过"

echo ""
echo "==========================="
echo "闲鱼管家 xianyu-admin 已启动"
echo "==========================="
echo "前台:    http://localhost:3000/  (或通过预览面板 :81)"
echo "后台:    http://localhost:3000/admin  (admin/admin123)"
echo "下载源码: http://localhost:3000/download"
echo ""
ps aux | grep "node .output/server" | grep -v grep | \
  awk '{printf "  PID:%s  RSS:%sKB\n", $2, $6}'
echo ""
echo "日志: tail -f $LOG"
echo "停止: pkill -f 'node .output/server/index.mjs'"
