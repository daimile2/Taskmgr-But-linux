package services

import (
	"os/exec"
	"strconv"
	"strings"
)

// Row is one systemd unit (user-visible subset).
type Row struct {
	Name        string `json:"name"`
	Load        string `json:"load"`
	Active      string `json:"active"`
	Sub         string `json:"sub"`
	Description string `json:"description"`
	Pid         int    `json:"pid"`
}

func mainPID(unit string) int {
	out, err := exec.Command("systemctl", "show", "-p", "MainPID", "--value", unit).Output()
	if err != nil {
		return 0
	}
	v, err := strconv.Atoi(strings.TrimSpace(string(out)))
	if err != nil {
		return 0
	}
	return v
}

// List runs systemctl list-units --type=service --all.
func List() []Row {
	out, err := exec.Command("systemctl", "list-units", "--type=service", "--all", "--no-pager", "--no-legend").CombinedOutput()
	if err != nil {
		// still try parse partial
	}
	var rows []Row
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		// UNIT LOAD ACTIVE SUB DESCRIPTION
		fields := strings.Fields(line)
		if len(fields) < 4 {
			continue
		}
		name := fields[0]
		if strings.HasPrefix(name, "●") && len(fields) >= 5 {
			name = fields[1]
			fields = fields[1:]
		}
		desc := ""
		if len(fields) > 4 {
			desc = strings.Join(fields[4:], " ")
		}
		rows = append(rows, Row{
			Name:        name,
			Load:        fields[1],
			Active:      fields[2],
			Sub:         fields[3],
			Description: desc,
			Pid:         mainPID(name),
		})
	}
	return rows
}

// Action is start|stop|restart via pkexec systemctl.
func Action(action, unit string) string {
	unit = strings.TrimSpace(unit)
	if unit == "" {
		return "未指定服务"
	}
	switch action {
	case "start", "stop", "restart", "status":
	default:
		return "未知操作"
	}
	out, err := exec.Command("pkexec", "systemctl", action, unit).CombinedOutput()
	if err != nil {
		return action + " 失败: " + string(out)
	}
	if len(out) == 0 {
		return action + " 成功"
	}
	return string(out)
}
