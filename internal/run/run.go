package run

import (
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

const maxHistory = 10

var histMu sync.Mutex

var dialogMu sync.Mutex
var dialogLast time.Time

func configDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return "/tmp"
	}
	dir := filepath.Join(home, ".config", "taskmgr-re")
	_ = os.MkdirAll(dir, 0755)
	return dir
}

func historyPath() string {
	return filepath.Join(configDir(), "run-history.json")
}

// History returns last commands (newest first), max 10.
func History() []string {
	histMu.Lock()
	defer histMu.Unlock()
	b, err := os.ReadFile(historyPath())
	if err != nil {
		return nil
	}
	var list []string
	if json.Unmarshal(b, &list) != nil {
		return nil
	}
	if len(list) > maxHistory {
		list = list[:maxHistory]
	}
	return list
}

func pushHistory(cmd string) {
	cmd = strings.TrimSpace(cmd)
	if cmd == "" {
		return
	}
	histMu.Lock()
	defer histMu.Unlock()
	b, _ := os.ReadFile(historyPath())
	var list []string
	_ = json.Unmarshal(b, &list)
	out := []string{cmd}
	for _, s := range list {
		if s == cmd {
			continue
		}
		out = append(out, s)
		if len(out) >= maxHistory {
			break
		}
	}
	data, _ := json.MarshalIndent(out, "", "  ")
	_ = os.WriteFile(historyPath(), data, 0644)
}

// PushHistory exports for API.
func PushHistory(cmd string) {
	pushHistory(cmd)
}

// Open executes cmd with system defaults.
// - absolute path to existing file: xdg-open (or exec if executable binary)
// - otherwise: shell -c (supports args like "firefox https://...")
// admin: run via pkexec
func Open(cmd string, admin bool) string {
	cmd = strings.TrimSpace(cmd)
	if cmd == "" {
		return "命令为空"
	}
	pushHistory(cmd)

	var c *exec.Cmd
	if admin {
		// pkexec 需要完整命令；用 sh -c 保留参数
		c = exec.Command("pkexec", "sh", "-c", cmd)
	} else {
		// 若是已有路径且无空格参数，优先按文件打开
		first := strings.Fields(cmd)
		if len(first) == 1 {
			p := first[0]
			if strings.HasPrefix(p, "~/") {
				if home, err := os.UserHomeDir(); err == nil {
					p = filepath.Join(home, p[2:])
				}
			}
			if st, err := os.Stat(p); err == nil && !st.IsDir() {
				// 可执行文件直接启动；否则 xdg-open
				if st.Mode()&0111 != 0 {
					c = exec.Command(p)
				} else {
					c = exec.Command("xdg-open", p)
				}
			}
		}
		if c == nil {
			c = exec.Command("sh", "-c", cmd)
		}
	}
	c.Dir, _ = os.UserHomeDir()
	c.Stdout = nil
	c.Stderr = nil
	if err := c.Start(); err != nil {
		return "启动失败: " + err.Error()
	}
	// 脱离本进程
	_ = c.Process.Release()
	return "已启动"
}

// Browse opens a file picker (zenity/kdialog) and returns selected path.
// 用户点取消时返回 ("", nil)，不报错。
func Browse() (string, error) {
	if path, err := exec.LookPath("zenity"); err == nil {
		cmd := exec.Command(path, "--file-selection", "--title=选择要打开的程序或文件")
		out, err := cmd.Output()
		if err != nil {
			// zenity 取消退出码 1
			if ee, ok := err.(*exec.ExitError); ok && ee.ExitCode() == 1 {
				return "", nil
			}
			return "", nil // 其它失败也静默，避免弹 JS 错误框
		}
		return strings.TrimSpace(string(out)), nil
	}
	if path, err := exec.LookPath("kdialog"); err == nil {
		cmd := exec.Command(path, "--getopenfilename", ".", "*")
		out, err := cmd.Output()
		if err != nil {
			return "", nil
		}
		return strings.TrimSpace(string(out)), nil
	}
	return "", fmt.Errorf("未找到 zenity 或 kdialog，无法浏览文件")
}

// OpenDialog spawns this binary with --run-dialog (separate process).
func OpenDialog() string {
	dialogMu.Lock()
	defer dialogMu.Unlock()
	// 防抖：1.5s 内不重复拉起
	if time.Since(dialogLast) < 1500*time.Millisecond {
		return "ok"
	}
	dialogLast = time.Now()
	exe, err := os.Executable()
	if err != nil {
		return err.Error()
	}
	c := exec.Command(exe, "--run-dialog")
	c.Stdout = nil
	c.Stderr = nil
	if err := c.Start(); err != nil {
		return "无法打开运行对话框: " + err.Error()
	}
	_ = c.Process.Release()
	return "ok"
}


// QuitDialog exits the current process (used by --run-dialog window).
func QuitDialog() {
	go func() {
		time.Sleep(80 * time.Millisecond)
		os.Exit(0)
	}()
}


// MoveBy moves the active window by dx, dy (for frameless drag fallback).
func MoveBy(dx, dy int) {
	if dx == 0 && dy == 0 {
		return
	}
	// xdotool windowmove --relative
	if _, err := exec.LookPath("xdotool"); err == nil {
		_ = exec.Command("xdotool", "getactivewindow", "windowmove", "--relative", "--", fmt.Sprintf("%d", dx), fmt.Sprintf("%d", dy)).Run()
		return
	}
}

// OpenURL opens url with the system default handler (browser etc).
func OpenURL(url string) string {
	url = strings.TrimSpace(url)
	if url == "" {
		return "空链接"
	}
	c := exec.Command("xdg-open", url)
	c.Stdout = nil
	c.Stderr = nil
	if err := c.Start(); err != nil {
		return err.Error()
	}
	_ = c.Process.Release()
	return "ok"
}

// OpenDir opens a directory in the file manager.
func OpenDir(dir string) string {
	dir = strings.TrimSpace(dir)
	if dir == "" {
		return "空路径"
	}
	if st, err := os.Stat(dir); err != nil || !st.IsDir() {
		// try parent
		dir = filepath.Dir(dir)
	}
	c := exec.Command("xdg-open", dir)
	c.Stdout = nil
	c.Stderr = nil
	if err := c.Start(); err != nil {
		return err.Error()
	}
	_ = c.Process.Release()
	return "ok"
}
