# taskmgr-re

Linux 上的 Windows 风格任务管理器（Wails v3 版）。

## 快速开始（推荐顺序）

### 0. 环境

- **Go 1.25+**（Wails v3 要求）
- 清华源加速：
  ```bash
  export GOPROXY=https://goproxy.cn,direct
  go env -w GOPROXY=https://goproxy.cn,direct
  ```
- 安装 Wails CLI：
  ```bash
  go install github.com/wailsapp/wails/v3/cmd/wails3@latest
  ```
- Linux 依赖（Ubuntu 24.04+ 示例）：
  ```bash
  sudo apt install build-essential pkg-config libgtk-4-dev libwebkitgtk-6.0-dev
  ```

### 1. 拉依赖

```bash
cd taskmgr-re
export GOPROXY=https://goproxy.cn,direct
go get github.com/wailsapp/wails/v3@latest
go mod tidy
```

### 2. 直接运行（最稳，不依赖 wails3 task）

```bash
make build          # 或 go build -o bin/taskmgr-re .
./bin/taskmgr-re    # 或 make run
```

### 3. 用 Wails CLI（可选）

```bash
make wails-dev      # 等价于 wails3 dev -config ./build/config.yml
make wails-build
```

如果仍报 `Taskfile` / `config.yml` 相关错误，优先用上面的 `make build` / `make run`。

### 4. 纯 HTTP + 浏览器联调

```bash
# 终端 1
make api
# 终端 2
make frontend
# 浏览器打开 http://127.0.0.1:5173
```

## 目录说明

```
taskmgr-re/
  main.go              # Wails 入口（embed 前端 + 挂载 /api Service）
  internal/            # 后端逻辑
  frontend/            # 前端（静态，无 npm 构建）
  cmd/server/          # 纯 HTTP 开发服务器
  build/
    config.yml         # Wails 项目配置（wails3 dev 需要）
  Taskfile.yml         # 简化构建任务
  Makefile
```

## 修改代码

- **前端**：改 `frontend/src/`（页面、样式、api.js）
- **后端能力**：改 `internal/` 下对应包
- **API 接口**：改 `internal/api/api.go`
- **窗口 / Wails**：改 `main.go`

两种运行方式共用同一套 `frontend/` 和 `internal/`，改一处两边都能用。
