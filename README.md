# 任务管理器 for Linux (Wails)

仿 Windows 11 任务管理器 · 真 /proc 数据 · 不依赖 GNOME

## 在 Ubuntu 上构建

```bash
sudo apt install golang-go nodejs npm build-essential pkg-config \
  libgtk-3-dev libwebkit2gtk-4.1-dev

go install github.com/wailsapp/wails/v2/cmd/wails@latest
export PATH="$PATH:$(go env GOPATH)/bin"

cd taskmgr
wails build
./build/bin/taskmgr
```

开发模式：`wails dev`

## 功能

- 进程：搜索/排序/结束任务
- 性能：CPU·内存曲线
- 启动应用：autostart 启用禁用
- 用户 / 详细信息
- 应用历史：占位整活页
