package users

import (
	"os/exec"
	"strings"
	"taskmgr-re/internal/process"
)

// Row aggregates processes by username.
type Row struct {
	Name         string  `json:"name"`
	ProcessCount int     `json:"processCount"`
	CPU          float64 `json:"cpu"`
	Memory       uint64  `json:"memory"`
}

// List groups current process.List() by user.
func List() []Row {
	procs := process.List()
	m := map[string]*Row{}
	order := []string{}
	for _, p := range procs {
		u := p.User
		if u == "" {
			u = "?"
		}
		r, ok := m[u]
		if !ok {
			r = &Row{Name: u}
			m[u] = r
			order = append(order, u)
		}
		r.ProcessCount++
		r.CPU += p.CPU
		r.Memory += p.Memory
	}
	out := make([]Row, 0, len(order))
	for _, name := range order {
		out = append(out, *m[name])
	}
	return out
}

// Logout terminates user sessions.
func Logout(name string) string {
	if name == "" {
		return "未指定用户"
	}
	out, err := exec.Command("loginctl", "terminate-user", name).CombinedOutput()
	if err != nil {
		out2, err2 := exec.Command("pkexec", "loginctl", "terminate-user", name).CombinedOutput()
		if err2 != nil {
			return strings.TrimSpace(string(out)) + " | " + strings.TrimSpace(string(out2))
		}
		return "已请求注销 " + name
	}
	return "已请求注销 " + name
}

// OpenAccountSettings launches desktop user settings.
func OpenAccountSettings() string {
	candidates := [][]string{
		{"gnome-control-center", "user-accounts"},
		{"systemsettings5", "kcm_users"},
		{"systemsettings", "kcm_users"},
		{"xdg-open", "settings://system/users"},
	}
	for _, c := range candidates {
		cmd := exec.Command(c[0], c[1:]...)
		if err := cmd.Start(); err == nil {
			return "已启动 " + c[0]
		}
	}
	return "未找到账户设置程序"
}
