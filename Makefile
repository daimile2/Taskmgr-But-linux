.PHONY: api frontend check tidy run start stop wails-dev wails-build doctor

# ---------- 纯 HTTP 开发模式（浏览器联调，不依赖 Wails） ----------
api:
	go run ./cmd/server

frontend:
	cd frontend && python3 -m http.server 5173

# ---------- 直接用 go 构建 / 运行 ----------
tidy:
	GOPROXY=https://goproxy.cn,direct go mod tidy

build:
	mkdir -p bin
	GOPROXY=https://goproxy.cn,direct go build -o bin/taskmgr-re .

# 前台调试（有日志，占住终端）
run: build
	./bin/taskmgr-re

# 后台启动：不占终端、无日志刷屏；关掉终端进程也继续跑
# 日志写到 /tmp/taskmgr-re.log（需要看时: tail -f /tmp/taskmgr-re.log）
start: build
	@mkdir -p bin
	@if pgrep -f '[b]in/taskmgr-re$$' >/dev/null 2>&1; then \
		echo "taskmgr-re 已在运行 (PID $$(pgrep -f '[b]in/taskmgr-re$$' | head -1))"; \
	else \
		nohup ./bin/taskmgr-re >>/tmp/taskmgr-re.log 2>&1 & \
		echo $$! > /tmp/taskmgr-re.pid; \
		disown $$! 2>/dev/null || true; \
		sleep 0.3; \
		echo "已后台启动 PID=$$(cat /tmp/taskmgr-re.pid)  日志: /tmp/taskmgr-re.log"; \
		echo "关闭本终端不影响程序；停止: make stop"; \
	fi

stop:
	@if [ -f /tmp/taskmgr-re.pid ]; then \
		kill $$(cat /tmp/taskmgr-re.pid) 2>/dev/null || true; \
		rm -f /tmp/taskmgr-re.pid; \
	fi
	@pkill -f '[b]in/taskmgr-re$$' 2>/dev/null || true
	@echo "已停止 taskmgr-re"

check: build
	@echo "build ok -> bin/taskmgr-re"

# ---------- Wails v3 CLI ----------
wails-dev:
	GOPROXY=https://goproxy.cn,direct wails3 dev -config ./build/config.yml

wails-build:
	GOPROXY=https://goproxy.cn,direct wails3 build

doctor:
	wails3 doctor || true
