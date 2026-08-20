#!/usr/bin/env bash
# 后台启动任务管理器：可关终端，不往当前终端打日志
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
if [[ ! -x bin/taskmgr-re ]]; then
  GOPROXY=https://goproxy.cn,direct go build -o bin/taskmgr-re .
fi
if pgrep -f '[b]in/taskmgr-re$' >/dev/null 2>&1; then
  echo "已在运行 PID=$(pgrep -f '[b]in/taskmgr-re$' | head -1)"
  exit 0
fi
nohup "$ROOT/bin/taskmgr-re" >>/tmp/taskmgr-re.log 2>&1 &
echo $! >/tmp/taskmgr-re.pid
disown $! 2>/dev/null || true
echo "已后台启动 PID=$(cat /tmp/taskmgr-re.pid)"
echo "日志: /tmp/taskmgr-re.log   停止: kill $(cat /tmp/taskmgr-re.pid)"
