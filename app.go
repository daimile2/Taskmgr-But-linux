package main

import (
	"path"
	"bufio"
	"context"
	"fmt"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
)

// App is the Wails backend.
type App struct {
	ctx context.Context

	efficiencyMu sync.Mutex
	efficiencyPIDs map[int]bool

	mu       sync.Mutex
	prevCPU  map[int]cpuSample // pid -> sample
	prevSys  sysCPUSample
	hasPrev  bool
}

type cpuSample struct {
	total uint64
	at    time.Time
}

type sysCPUSample struct {
	idle  uint64
	total uint64
	at    time.Time
}

// Process is one row in 进程 / 详细信息.
type Process struct {
	PID     int     `json:"pid"`
	PPID    int     `json:"ppid"`
	Name    string  `json:"name"`
	User    string  `json:"user"`
	State   string  `json:"state"`
	CPU     float64 `json:"cpu"`    // percent
	Memory  uint64  `json:"memory"` // RSS bytes
	MemPct  float64 `json:"memPct"`
	Threads int     `json:"threads"`
	Cmdline string  `json:"cmdline"`
}

// SystemStats for performance page and status bar.
type SystemStats struct {
	CPUPercent   float64 `json:"cpuPercent"`
	MemUsed      uint64  `json:"memUsed"`
	MemTotal     uint64  `json:"memTotal"`
	MemPercent   float64 `json:"memPercent"`
	ProcessCount int     `json:"processCount"`
	CPUModel     string  `json:"cpuModel"`
	CPUCores     int     `json:"cpuCores"`
	CPUMhz       float64 `json:"cpuMhz"`
	UptimeSec    float64 `json:"uptimeSec"`
	Load1        float64 `json:"load1"`
	Load5        float64 `json:"load5"`
	Load15       float64 `json:"load15"`
	// simple net counters (bytes total since boot)
	NetRx uint64 `json:"netRx"`
	NetTx uint64 `json:"netTx"`
}

// StartupApp from .desktop autostart files.
type StartupApp struct {
	Name    string `json:"name"`
	Exec    string `json:"exec"`
	Path    string `json:"path"`
	Enabled bool   `json:"enabled"`
	Comment string `json:"comment"`
}

// UserRow aggregated by username.
type UserRow struct {
	Name         string  `json:"name"`
	UID          string  `json:"uid"`
	ProcessCount int     `json:"processCount"`
	CPU          float64 `json:"cpu"`
	Memory       uint64  `json:"memory"`
}

func NewApp() *App {
	return &App{
		prevCPU: map[int]cpuSample{},
		efficiencyPIDs: map[int]bool{},
	}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

// ---------- helpers ----------

func readFile(path string) string {
	b, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return string(b)
}

func stateName(s string) string {
	switch s {
	case "R":
		return "正在运行"
	case "S":
		return "睡眠"
	case "D":
		return "不可中断"
	case "Z":
		return "僵尸"
	case "T", "t":
		return "已停止"
	case "I":
		return "空闲"
	default:
		if s == "" {
			return "未知"
		}
		return s
	}
}

func uidToName(uid string) string {
	u, err := user.LookupId(uid)
	if err != nil {
		return uid
	}
	return u.Username
}

func memTotalBytes() uint64 {
	f, err := os.Open("/proc/meminfo")
	if err != nil {
		return 1
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := sc.Text()
		if strings.HasPrefix(line, "MemTotal:") {
			fields := strings.Fields(line)
			if len(fields) >= 2 {
				kb, _ := strconv.ParseUint(fields[1], 10, 64)
				return kb * 1024
			}
		}
	}
	return 1
}

func parseSysCPU() (idle, total uint64) {
	line := ""
	f, err := os.Open("/proc/stat")
	if err != nil {
		return 0, 0
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	if sc.Scan() {
		line = sc.Text()
	}
	// cpu  user nice system idle iowait irq softirq steal ...
	fields := strings.Fields(line)
	if len(fields) < 5 || fields[0] != "cpu" {
		return 0, 0
	}
	var sum uint64
	for i := 1; i < len(fields); i++ {
		v, _ := strconv.ParseUint(fields[i], 10, 64)
		sum += v
		if i == 4 { // idle
			idle = v
		}
		if i == 5 { // iowait often counted as idle-ish for %
			idle += v
		}
	}
	return idle, sum
}

func processCPUTime(pid int) uint64 {
	// /proc/pid/stat: fields 14 utime, 15 stime (1-based after name)
	data := readFile(fmt.Sprintf("/proc/%d/stat", pid))
	if data == "" {
		return 0
	}
	// name can contain spaces inside ()
	rparen := strings.LastIndex(data, ")")
	if rparen < 0 || rparen+2 >= len(data) {
		return 0
	}
	rest := strings.Fields(data[rparen+2:])
	// rest[11]=utime, rest[12]=stime (0-based in rest: position 14-3=11)
	if len(rest) < 13 {
		return 0
	}
	ut, _ := strconv.ParseUint(rest[11], 10, 64)
	st, _ := strconv.ParseUint(rest[12], 10, 64)
	return ut + st
}

// ---------- public API ----------

// ListProcesses returns current processes with CPU% since last call.
func (a *App) ListProcesses() []Process {
	a.mu.Lock()
	defer a.mu.Unlock()

	now := time.Now()
	memTotal := memTotalBytes()
	entries, _ := os.ReadDir("/proc")

	newPrev := map[int]cpuSample{}
	var list []Process

	sysIdle, sysTotal := parseSysCPU()
	var sysDelta float64 = 1
	if a.hasPrev && sysTotal > a.prevSys.total {
		sysDelta = float64(sysTotal - a.prevSys.total)
		if sysDelta < 1 {
			sysDelta = 1
		}
	}

	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		pid, err := strconv.Atoi(e.Name())
		if err != nil {
			continue
		}
		statPath := fmt.Sprintf("/proc/%d/stat", pid)
		raw := readFile(statPath)
		if raw == "" {
			continue
		}
		rparen := strings.LastIndex(raw, ")")
		if rparen < 0 {
			continue
		}
		name := raw[strings.Index(raw, "(")+1 : rparen]
		rest := strings.Fields(raw[rparen+2:])
		if len(rest) < 22 {
			continue
		}
		state := rest[0]
		ppid, _ := strconv.Atoi(rest[1])
		threads, _ := strconv.Atoi(rest[17])

		// RSS from stat field 24 (rest[21]) in pages
		rssPages, _ := strconv.ParseUint(rest[21], 10, 64)
		pageSize := uint64(os.Getpagesize())
		rss := rssPages * pageSize

		status := readFile(fmt.Sprintf("/proc/%d/status", pid))
		uid := "0"
		for _, line := range strings.Split(status, "\n") {
			if strings.HasPrefix(line, "Uid:") {
				fields := strings.Fields(line)
				if len(fields) >= 2 {
					uid = fields[1]
				}
				break
			}
		}
		uname := uidToName(uid)

		cmdline := readFile(fmt.Sprintf("/proc/%d/cmdline", pid))
		cmdline = strings.ReplaceAll(cmdline, "\x00", " ")
		cmdline = strings.TrimSpace(cmdline)
		if cmdline == "" {
			cmdline = name
		}

		cpuTime := processCPUTime(pid)
		var cpuPct float64
		if prev, ok := a.prevCPU[pid]; ok && a.hasPrev {
			dt := now.Sub(prev.at).Seconds()
			if dt > 0.05 {
				// clock ticks: usually 100
				hz := float64(100)
				delta := float64(cpuTime - prev.total)
				if delta < 0 {
					delta = 0
				}
				cpuPct = (delta / hz / dt) * 100
				// clamp
				if cpuPct > 100*float64(runtimeNumCPU()) {
					cpuPct = 100 * float64(runtimeNumCPU())
				}
			}
		}
		_ = sysDelta

		newPrev[pid] = cpuSample{total: cpuTime, at: now}
		memPct := float64(rss) / float64(memTotal) * 100

		list = append(list, Process{
			PID:     pid,
			PPID:    ppid,
			Name:    name,
			User:    uname,
			State:   stateName(state),
			CPU:     cpuPct,
			Memory:  rss,
			MemPct:  memPct,
			Threads: threads,
			Cmdline: cmdline,
		})
	}

	a.prevCPU = newPrev
	a.prevSys = sysCPUSample{idle: sysIdle, total: sysTotal, at: now}
	a.hasPrev = true

	sort.Slice(list, func(i, j int) bool {
		if list[i].CPU == list[j].CPU {
			return list[i].Memory > list[j].Memory
		}
		return list[i].CPU > list[j].CPU
	})
	return list
}

func runtimeNumCPU() int {
	// cheap: count processor lines
	n := 0
	for _, line := range strings.Split(readFile("/proc/cpuinfo"), "\n") {
		if strings.HasPrefix(line, "processor") {
			n++
		}
	}
	if n == 0 {
		return 1
	}
	return n
}

// GetSystemStats returns overall CPU/memory/load.
func (a *App) GetSystemStats() SystemStats {
	a.mu.Lock()
	defer a.mu.Unlock()

	idle, total := parseSysCPU()
	var cpuPct float64
	if a.hasPrev && total > a.prevSys.total {
		dTotal := float64(total - a.prevSys.total)
		dIdle := float64(idle - a.prevSys.idle)
		if dTotal > 0 {
			cpuPct = (1 - dIdle/dTotal) * 100
		}
	}
	// update sys sample without wiping process samples
	a.prevSys = sysCPUSample{idle: idle, total: total, at: time.Now()}
	a.hasPrev = true

	var memTotal, memAvail uint64
	f, err := os.Open("/proc/meminfo")
	if err == nil {
		sc := bufio.NewScanner(f)
		for sc.Scan() {
			line := sc.Text()
			fields := strings.Fields(line)
			if len(fields) < 2 {
				continue
			}
			v, _ := strconv.ParseUint(fields[1], 10, 64)
			v *= 1024
			switch fields[0] {
			case "MemTotal:":
				memTotal = v
			case "MemAvailable:":
				memAvail = v
			}
		}
		f.Close()
	}
	memUsed := memTotal - memAvail
	var memPct float64
	if memTotal > 0 {
		memPct = float64(memUsed) / float64(memTotal) * 100
	}

	model := ""
	mhz := 0.0
	cores := 0
	for _, line := range strings.Split(readFile("/proc/cpuinfo"), "\n") {
		if strings.HasPrefix(line, "model name") {
			parts := strings.SplitN(line, ":", 2)
			if len(parts) == 2 && model == "" {
				model = strings.TrimSpace(parts[1])
			}
		}
		if strings.HasPrefix(line, "cpu MHz") {
			parts := strings.SplitN(line, ":", 2)
			if len(parts) == 2 {
				mhz, _ = strconv.ParseFloat(strings.TrimSpace(parts[1]), 64)
			}
		}
		if strings.HasPrefix(line, "processor") {
			cores++
		}
	}

	uptime := 0.0
	if u := strings.Fields(readFile("/proc/uptime")); len(u) > 0 {
		uptime, _ = strconv.ParseFloat(u[0], 64)
	}
	var l1, l5, l15 float64
	if lf := strings.Fields(readFile("/proc/loadavg")); len(lf) >= 3 {
		l1, _ = strconv.ParseFloat(lf[0], 64)
		l5, _ = strconv.ParseFloat(lf[1], 64)
		l15, _ = strconv.ParseFloat(lf[2], 64)
	}

	var rx, tx uint64
	for _, line := range strings.Split(readFile("/proc/net/dev"), "\n") {
		line = strings.TrimSpace(line)
		if !strings.Contains(line, ":") || strings.HasPrefix(line, "Inter") || strings.HasPrefix(line, "face") {
			continue
		}
		parts := strings.Split(line, ":")
		if len(parts) != 2 {
			continue
		}
		name := strings.TrimSpace(parts[0])
		if name == "lo" {
			continue
		}
		fields := strings.Fields(parts[1])
		if len(fields) < 9 {
			continue
		}
		r, _ := strconv.ParseUint(fields[0], 10, 64)
		t, _ := strconv.ParseUint(fields[8], 10, 64)
		rx += r
		tx += t
	}

	// count processes
	pc := 0
	entries, _ := os.ReadDir("/proc")
	for _, e := range entries {
		if _, err := strconv.Atoi(e.Name()); err == nil {
			pc++
		}
	}

	return SystemStats{
		CPUPercent:   cpuPct,
		MemUsed:      memUsed,
		MemTotal:     memTotal,
		MemPercent:   memPct,
		ProcessCount: pc,
		CPUModel:     model,
		CPUCores:     cores,
		CPUMhz:       mhz,
		UptimeSec:    uptime,
		Load1:        l1,
		Load5:        l5,
		Load15:       l15,
		NetRx:        rx,
		NetTx:        tx,
	}
}

// KillProcess sends SIGTERM then SIGKILL if needed.
func (a *App) KillProcess(pid int) string {
	if pid <= 1 {
		return "拒绝：不能结束 PID <= 1"
	}
	p, err := os.FindProcess(pid)
	if err != nil {
		return "找不到进程: " + err.Error()
	}
	if err := p.Signal(os.Interrupt); err != nil {
		// try kill -9 via shell for permission cases
		out, err2 := exec.Command("kill", "-TERM", strconv.Itoa(pid)).CombinedOutput()
		if err2 != nil {
			out9, err9 := exec.Command("kill", "-KILL", strconv.Itoa(pid)).CombinedOutput()
			if err9 != nil {
				return fmt.Sprintf("结束失败: %v / %s / %s", err, string(out), string(out9))
			}
			return "已强制结束 " + strconv.Itoa(pid)
		}
		return "已发送 TERM 到 " + strconv.Itoa(pid)
	}
	time.Sleep(200 * time.Millisecond)
	// check if still alive
	if _, err := os.Stat(fmt.Sprintf("/proc/%d", pid)); err == nil {
		_ = exec.Command("kill", "-KILL", strconv.Itoa(pid)).Run()
		return "已强制结束 " + strconv.Itoa(pid)
	}
	return "已结束进程 " + strconv.Itoa(pid)
}

// RunCommand starts a command detached (运行新任务).
func (a *App) RunCommand(cmdLine string) string {
	cmdLine = strings.TrimSpace(cmdLine)
	if cmdLine == "" {
		return "命令为空"
	}
	cmd := exec.Command("sh", "-c", cmdLine)
	cmd.Dir, _ = os.UserHomeDir()
	if err := cmd.Start(); err != nil {
		return "启动失败: " + err.Error()
	}
	_ = cmd.Process.Release()
	return "已启动: " + cmdLine
}

// ListStartupApps reads user and system autostart .desktop files.
func (a *App) ListStartupApps() []StartupApp {
	home, _ := os.UserHomeDir()
	dirs := []string{
		filepath.Join(home, ".config/autostart"),
		"/etc/xdg/autostart",
	}
	var apps []StartupApp
	seen := map[string]bool{}
	for _, dir := range dirs {
		entries, err := os.ReadDir(dir)
		if err != nil {
			continue
		}
		for _, e := range entries {
			if e.IsDir() || !strings.HasSuffix(e.Name(), ".desktop") {
				continue
			}
			path := filepath.Join(dir, e.Name())
			if seen[e.Name()] {
				continue // user overrides system
			}
			seen[e.Name()] = true
			apps = append(apps, parseDesktop(path))
		}
	}
	sort.Slice(apps, func(i, j int) bool { return apps[i].Name < apps[j].Name })
	return apps
}

func parseDesktop(path string) StartupApp {
	raw := readFile(path)
	app := StartupApp{Path: path, Enabled: true}
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimSpace(line)
		if strings.HasPrefix(line, "Name=") && !strings.Contains(line, "[") {
			app.Name = strings.TrimPrefix(line, "Name=")
		}
		if strings.HasPrefix(line, "Exec=") {
			app.Exec = strings.TrimPrefix(line, "Exec=")
		}
		if strings.HasPrefix(line, "Comment=") {
			app.Comment = strings.TrimPrefix(line, "Comment=")
		}
		if line == "Hidden=true" || line == "X-GNOME-Autostart-enabled=false" {
			app.Enabled = false
		}
	}
	if app.Name == "" {
		app.Name = filepath.Base(path)
	}
	return app
}

// SetStartupEnabled toggles Hidden= in the desktop file (user copy if system).
func (a *App) SetStartupEnabled(path string, enabled bool) string {
	home, _ := os.UserHomeDir()
	userDir := filepath.Join(home, ".config/autostart")
	_ = os.MkdirAll(userDir, 0755)

	base := filepath.Base(path)
	target := path
	// if system file, copy to user autostart first
	if strings.HasPrefix(path, "/etc/") {
		target = filepath.Join(userDir, base)
		data := readFile(path)
		if data == "" {
			return "无法读取: " + path
		}
		if err := os.WriteFile(target, []byte(data), 0644); err != nil {
			return "复制到用户目录失败: " + err.Error()
		}
	}

	raw := readFile(target)
	if raw == "" {
		return "无法读取: " + target
	}
	lines := strings.Split(raw, "\n")
	var out []string
	hasHidden := false
	hasGnome := false
	for _, line := range lines {
		trim := strings.TrimSpace(line)
		if strings.HasPrefix(trim, "Hidden=") {
			hasHidden = true
			if enabled {
				out = append(out, "Hidden=false")
			} else {
				out = append(out, "Hidden=true")
			}
			continue
		}
		if strings.HasPrefix(trim, "X-GNOME-Autostart-enabled=") {
			hasGnome = true
			if enabled {
				out = append(out, "X-GNOME-Autostart-enabled=true")
			} else {
				out = append(out, "X-GNOME-Autostart-enabled=false")
			}
			continue
		}
		out = append(out, line)
	}
	if !hasHidden {
		// insert after [Desktop Entry]
		inserted := false
		var with []string
		for _, line := range out {
			with = append(with, line)
			if strings.TrimSpace(line) == "[Desktop Entry]" && !inserted {
				if enabled {
					with = append(with, "Hidden=false")
				} else {
					with = append(with, "Hidden=true")
				}
				inserted = true
			}
		}
		out = with
	}
	_ = hasGnome
	if err := os.WriteFile(target, []byte(strings.Join(out, "\n")), 0644); err != nil {
		return "写入失败: " + err.Error()
	}
	if enabled {
		return "已启用: " + base
	}
	return "已禁用: " + base
}

// ListUsers aggregates processes by user.
func (a *App) ListUsers() []UserRow {
	procs := a.ListProcesses()
	m := map[string]*UserRow{}
	for _, p := range procs {
		u, ok := m[p.User]
		if !ok {
			u = &UserRow{Name: p.User}
			m[p.User] = u
		}
		u.ProcessCount++
		u.CPU += p.CPU
		u.Memory += p.Memory
	}
	var rows []UserRow
	for _, u := range m {
		rows = append(rows, *u)
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].Memory > rows[j].Memory })
	return rows
}


// ProcessProps detailed fields for property dialog.
type ProcessProps struct {
	PID      int     `json:"pid"`
	Name     string  `json:"name"`
	State    string  `json:"state"`
	User     string  `json:"user"`
	CPU      float64 `json:"cpu"`
	Memory   uint64  `json:"memory"`
	Cmdline  string  `json:"cmdline"`
	Cwd      string  `json:"cwd"`
	Exe      string  `json:"exe"`
	Nice     string  `json:"nice"`
	Threads  int     `json:"threads"`
	Affinity string  `json:"affinity"`
}

func (a *App) GetProcessProps(pid int) ProcessProps {
	pp := ProcessProps{PID: pid}
	for _, pr := range a.ListProcesses() {
		if pr.PID == pid {
			pp.Name, pp.State, pp.User = pr.Name, pr.State, pr.User
			pp.CPU, pp.Memory, pp.Cmdline = pr.CPU, pr.Memory, pr.Cmdline
			pp.Threads = pr.Threads
			break
		}
	}
	base := fmt.Sprintf("/proc/%d", pid)
	if b, err := os.ReadFile(base + "/cmdline"); err == nil {
		s := strings.ReplaceAll(string(b), "\x00", " ")
		if strings.TrimSpace(s) != "" {
			pp.Cmdline = strings.TrimSpace(s)
		}
	}
	if target, err := os.Readlink(base + "/cwd"); err == nil {
		pp.Cwd = target
	}
	if target, err := os.Readlink(base + "/exe"); err == nil {
		pp.Exe = target
	}
	raw := readFile(base + "/stat")
	if rparen := strings.LastIndex(raw, ")"); rparen >= 0 {
		rest := strings.Fields(raw[rparen+2:])
		if len(rest) > 15 {
			pp.Nice = rest[15]
		}
	}
	out, _ := exec.Command("taskset", "-p", strconv.Itoa(pid)).CombinedOutput()
	pp.Affinity = strings.TrimSpace(string(out))
	return pp
}

func runPkexec(args ...string) (string, error) {
	all := append([]string{"pkexec"}, args...)
	cmd := exec.Command(all[0], all[1:]...)
	b, err := cmd.CombinedOutput()
	return string(b), err
}

func (a *App) SetEfficiencyMode(pid int, enable bool) string {
	if pid <= 1 {
		return "拒绝操作 PID<=1"
	}
	if enable {
		out, err := exec.Command("renice", "-n", "19", "-p", strconv.Itoa(pid)).CombinedOutput()
		if err != nil {
			o2, err2 := runPkexec("renice", "-n", "19", "-p", strconv.Itoa(pid))
			if err2 != nil {
				return "renice 失败: " + strings.TrimSpace(string(out)) + " / " + o2
			}
		}
		out, err = exec.Command("taskset", "-pc", "0", strconv.Itoa(pid)).CombinedOutput()
		if err != nil {
			o2, err2 := runPkexec("taskset", "-pc", "0", strconv.Itoa(pid))
			if err2 != nil {
				return "renice 已尝试；taskset 失败: " + string(out) + " " + o2
			}
		}
		script := fmt.Sprintf(
			"CG=/sys/fs/cgroup/taskmgr_eff_%d; mkdir -p \"$CG\" 2>/dev/null; echo %d > \"$CG/cgroup.procs\" 2>/dev/null; echo 536870912 > \"$CG/memory.max\" 2>/dev/null; echo \"50000 100000\" > \"$CG/cpu.max\" 2>/dev/null; true",
			pid, pid,
		)
		_, _ = runPkexec("bash", "-c", script)
		a.efficiencyMu.Lock()
		if a.efficiencyPIDs == nil {
			a.efficiencyPIDs = map[int]bool{}
		}
		a.efficiencyPIDs[pid] = true
		a.efficiencyMu.Unlock()
		return fmt.Sprintf("已对 PID %d 启用效率模式 (nice=19, CPU0, 尝试cgroup)", pid)
	}
	_, _ = exec.Command("renice", "-n", "0", "-p", strconv.Itoa(pid)).CombinedOutput()
	_, _ = runPkexec("renice", "-n", "0", "-p", strconv.Itoa(pid))
	n := runtimeNumCPU()
	list := "0"
	if n > 1 {
		list = fmt.Sprintf("0-%d", n-1)
	}
	_, _ = exec.Command("taskset", "-pc", list, strconv.Itoa(pid)).CombinedOutput()
	_, _ = runPkexec("taskset", "-pc", list, strconv.Itoa(pid))
	script := fmt.Sprintf(
		"CG=/sys/fs/cgroup/taskmgr_eff_%d; echo %d > /sys/fs/cgroup/cgroup.procs 2>/dev/null; rmdir \"$CG\" 2>/dev/null; true",
		pid, pid,
	)
	_, _ = runPkexec("bash", "-c", script)
	a.efficiencyMu.Lock()
	delete(a.efficiencyPIDs, pid)
	a.efficiencyMu.Unlock()
	return fmt.Sprintf("已对 PID %d 关闭效率模式", pid)
}

func (a *App) KillProcessRoot(pid int) string {
	s := a.KillProcess(pid)
	if strings.Contains(s, "失败") || strings.Contains(strings.ToLower(s), "permission") {
		o, err := runPkexec("kill", "-9", strconv.Itoa(pid))
		if err != nil {
			return s + " | pkexec: " + o
		}
		return "已通过 pkexec 强制结束 " + strconv.Itoa(pid)
	}
	return s
}

func (a *App) ServiceAction(unit string, action string) string {
	if unit == "" {
		return "未指定服务名"
	}
	if !strings.HasSuffix(unit, ".service") && !strings.Contains(unit, ".") {
		unit = unit + ".service"
	}
	switch action {
	case "start", "stop", "restart", "status":
	default:
		return "未知操作"
	}
	out, err := exec.Command("systemctl", action, unit).CombinedOutput()
	if err != nil {
		o, err2 := runPkexec("systemctl", action, unit)
		if err2 != nil {
			return action + " 失败: " + string(out) + " / " + o
		}
		return action + " 成功 (pkexec): " + o
	}
	return action + " 成功: " + string(out)
}


// NetDevice one network interface with throughput.
type NetDevice struct {
	Name   string  `json:"name"`
	Kind   string  `json:"kind"` // wifi | ethernet | other
	RxBps  float64 `json:"rxBps"`
	TxBps  float64 `json:"txBps"`
	RxBytes uint64 `json:"rxBytes"`
	TxBytes uint64 `json:"txBytes"`
}

// GPUInfo detected GPU.
type GPUInfo struct {
	Name   string  `json:"name"`
	Kind   string  `json:"kind"` // iGPU | dGPU | unknown
	Usage  float64 `json:"usage"` // -1 if unknown
	Temp   float64 `json:"temp"`  // -1 if unknown
	Detail string  `json:"detail"`
}

// DiskInfo simple disk util.
type DiskInfo struct {
	Name    string  `json:"name"`
	Model   string  `json:"model"`
	Util    float64 `json:"util"`
	ReadBps float64 `json:"readBps"`
	WriteBps float64 `json:"writeBps"`
	SizeBytes uint64 `json:"sizeBytes"`
	Rotational bool `json:"rotational"`
}

type PerfExtra struct {
	Nets  []NetDevice `json:"nets"`
	GPUs  []GPUInfo   `json:"gpus"`
	Disks []DiskInfo  `json:"disks"`
}

var netPrev = map[string][2]uint64{} // name -> rx,tx
var netPrevAt = time.Time{}

func classifyIface(name string) string {
	n := strings.ToLower(name)
	if strings.HasPrefix(n, "lo") {
		return "lo"
	}
	if strings.HasPrefix(n, "wl") || strings.HasPrefix(n, "wlan") || strings.HasPrefix(n, "wifi") {
		return "wifi"
	}
	if strings.HasPrefix(n, "docker") || strings.HasPrefix(n, "br-") || strings.HasPrefix(n, "veth") || strings.HasPrefix(n, "virbr") || strings.HasPrefix(n, "tun") || strings.HasPrefix(n, "tap") {
		return "other"
	}
	return "ethernet"
}

func (a *App) GetPerfExtra() PerfExtra {
	ex := PerfExtra{}
	// --- nets ---
	now := time.Now()
	f, err := os.Open("/proc/net/dev")
	if err == nil {
		sc := bufio.NewScanner(f)
		for sc.Scan() {
			line := strings.TrimSpace(sc.Text())
			if !strings.Contains(line, ":") || strings.HasPrefix(line, "Inter") || strings.HasPrefix(line, "face") {
				continue
			}
			parts := strings.Split(line, ":")
			if len(parts) != 2 {
				continue
			}
			name := strings.TrimSpace(parts[0])
			kind := classifyIface(name)
			if kind == "lo" {
				continue
			}
			fields := strings.Fields(parts[1])
			if len(fields) < 9 {
				continue
			}
			rx, _ := strconv.ParseUint(fields[0], 10, 64)
			tx, _ := strconv.ParseUint(fields[8], 10, 64)
			var rxBps, txBps float64
			if prev, ok := netPrev[name]; ok && !netPrevAt.IsZero() {
				dt := now.Sub(netPrevAt).Seconds()
				if dt > 0.05 {
					if rx >= prev[0] {
						rxBps = float64(rx-prev[0]) * 8 / dt
					}
					if tx >= prev[1] {
						txBps = float64(tx-prev[1]) * 8 / dt
					}
				}
			}
			netPrev[name] = [2]uint64{rx, tx}
			ex.Nets = append(ex.Nets, NetDevice{
				Name: name, Kind: kind, RxBps: rxBps, TxBps: txBps, RxBytes: rx, TxBytes: tx,
			})
		}
		f.Close()
		netPrevAt = now
	}

	ex.Disks = collectDisks()
	// --- GPUs via lspci ---
	out, err := exec.Command("lspci").CombinedOutput()
	if err == nil {
		for _, line := range strings.Split(string(out), "\n") {
			low := strings.ToLower(line)
			if !(strings.Contains(low, "vga") || strings.Contains(low, "3d controller") || strings.Contains(low, "display")) {
				continue
			}
			name := line
			if i := strings.Index(line, ": "); i >= 0 {
				name = strings.TrimSpace(line[i+2:])
			}
			kind := "unknown"
			if strings.Contains(low, "nvidia") {
				kind = "dGPU"
			} else if strings.Contains(low, "intel") {
				kind = "iGPU"
			} else if strings.Contains(low, "amd") || strings.Contains(low, "ati") || strings.Contains(low, "radeon") {
				// heuristic: "VGA" often iGPU on APUs, "3D" often dGPU
				if strings.Contains(low, "3d") {
					kind = "dGPU"
				} else {
					kind = "iGPU"
				}
			}
			ex.GPUs = append(ex.GPUs, GPUInfo{Name: name, Kind: kind, Usage: -1, Temp: -1})
		}
	}
	// NVIDIA usage/temp if available
	nout, err := exec.Command("nvidia-smi", "--query-gpu=name,utilization.gpu,temperature.gpu", "--format=csv,noheader,nounits").CombinedOutput()
	if err == nil {
		idx := 0
		for _, line := range strings.Split(strings.TrimSpace(string(nout)), "\n") {
			parts := strings.Split(line, ",")
			if len(parts) < 3 {
				continue
			}
			usage, _ := strconv.ParseFloat(strings.TrimSpace(parts[1]), 64)
			temp, _ := strconv.ParseFloat(strings.TrimSpace(parts[2]), 64)
			// match or append
			found := false
			for i := range ex.GPUs {
				if strings.Contains(strings.ToLower(ex.GPUs[i].Name), "nvidia") {
					if idx == 0 {
						ex.GPUs[i].Usage = usage
						ex.GPUs[i].Temp = temp
						ex.GPUs[i].Kind = "dGPU"
						found = true
						break
					}
				}
			}
			if !found {
				ex.GPUs = append(ex.GPUs, GPUInfo{
					Name: strings.TrimSpace(parts[0]), Kind: "dGPU", Usage: usage, Temp: temp,
				})
			}
			idx++
		}
	}
	return ex
}



type diskSample struct {
	readSectors  uint64
	writeSectors uint64
	ioTicks      uint64
	at           time.Time
}

var diskPrev = map[string]diskSample{}

func collectDisks() []DiskInfo {
	now := time.Now()
	type st struct {
		readSec, writeSec, ioTicks uint64
	}
	cur := map[string]st{}
	for _, line := range strings.Split(readFile("/proc/diskstats"), "\n") {
		f := strings.Fields(line)
		if len(f) < 14 {
			continue
		}
		name := f[2]
		ok := (strings.HasPrefix(name, "sd") && len(name) == 3) ||
			(strings.HasPrefix(name, "vd") && len(name) == 3) ||
			(strings.HasPrefix(name, "nvme") && strings.Contains(name, "n1") && !strings.Contains(name, "p"))
		if !ok {
			continue
		}
		rs, _ := strconv.ParseUint(f[5], 10, 64)
		ws, _ := strconv.ParseUint(f[9], 10, 64)
		iot, _ := strconv.ParseUint(f[12], 10, 64)
		cur[name] = st{rs, ws, iot}
	}
	var out []DiskInfo
	for name, s := range cur {
		model := strings.TrimSpace(readFile("/sys/block/" + name + "/device/model"))
		di := DiskInfo{Name: name, Model: model, Util: -1}
		if sz := strings.TrimSpace(readFile("/sys/block/" + name + "/size")); sz != "" {
			if sectors, err := strconv.ParseUint(sz, 10, 64); err == nil {
				di.SizeBytes = sectors * 512
			}
		}
		rot := strings.TrimSpace(readFile("/sys/block/" + name + "/queue/rotational"))
		di.Rotational = rot == "1"

		if prev, ok := diskPrev[name]; ok {
			dt := now.Sub(prev.at).Seconds()
			if dt > 0.05 && s.ioTicks >= prev.ioTicks {
				u := float64(s.ioTicks-prev.ioTicks) / (dt * 1000) * 100
				if u > 100 {
					u = 100
				}
				if u < 0 {
					u = 0
				}
				di.Util = u
				if s.readSec >= prev.readSectors {
					di.ReadBps = float64(s.readSec-prev.readSectors) * 512 / dt
				}
				if s.writeSec >= prev.writeSectors {
					di.WriteBps = float64(s.writeSec-prev.writeSectors) * 512 / dt
				}
			}
		}
		diskPrev[name] = diskSample{s.readSec, s.writeSec, s.ioTicks, now}
		out = append(out, di)
	}
	return out
}





// OpenProcessLocation opens file manager at process executable directory.
func (a *App) OpenProcessLocation(pid int) string {
	exe, err := os.Readlink(fmt.Sprintf("/proc/%d/exe", pid))
	if err != nil {
		// fallback cmdline first arg
		b, err2 := os.ReadFile(fmt.Sprintf("/proc/%d/cmdline", pid))
		if err2 != nil || len(b) == 0 {
			return "无法解析路径（可能是内核线程或已退出）: " + err.Error()
		}
		parts := strings.Split(string(b), "\x00")
		if len(parts) == 0 || parts[0] == "" {
			return "无法解析路径"
		}
		exe = parts[0]
	}
	// kernel threads often "name (deleted)" or empty
	if exe == "" || strings.HasPrefix(exe, "[") {
		return "该进程没有用户态可执行文件"
	}
	// strip " (deleted)"
	if i := strings.Index(exe, " (deleted)"); i >= 0 {
		exe = exe[:i]
	}
	dir := path.Dir(exe)
	cmd := exec.Command("xdg-open", dir)
	if err := cmd.Start(); err != nil {
		return "打开失败: " + err.Error() + " dir=" + dir
	}
	return "已打开: " + dir
}


func (a *App) ListProcessesByUser(username string) []Process {
	var out []Process
	for _, pr := range a.ListProcesses() {
		if pr.User == username {
			out = append(out, pr)
		}
	}
	return out
}

// DisconnectUser tries to terminate user sessions (loginctl).
func (a *App) DisconnectUser(username string) string {
	if username == "" || username == "root" {
		return "拒绝操作该用户"
	}
	// list sessions
	out, err := exec.Command("loginctl", "list-sessions", "--no-legend").CombinedOutput()
	if err != nil {
		o2, err2 := runPkexec("loginctl", "list-sessions", "--no-legend")
		if err2 != nil {
			return "无法列出会话: " + string(out) + " " + o2
		}
		out = []byte(o2)
	}
	killed := 0
	for _, line := range strings.Split(string(out), "\n") {
		fields := strings.Fields(line)
		// SESSION UID USER SEAT TTY
		if len(fields) < 3 {
			continue
		}
		sess, user := fields[0], fields[2]
		if user != username {
			continue
		}
		_, err := exec.Command("loginctl", "terminate-session", sess).CombinedOutput()
		if err != nil {
			runPkexec("loginctl", "terminate-session", sess)
		}
		killed++
	}
	if killed == 0 {
		// fallback: pkill -u
		o, err := runPkexec("pkill", "-KILL", "-u", username)
		if err != nil {
			return "未找到 loginctl 会话，pkill 结果: " + o
		}
		return "已对用户 " + username + " 执行 pkill（无会话列表时）"
	}
	return "已断开用户 " + username + " 的 " + strconv.Itoa(killed) + " 个会话"
}


func (a *App) KillProcessTree(pid int) string {
	if pid <= 1 {
		return "拒绝操作 PID<=1"
	}
	// collect children via /proc
	var pids []int
	var walk func(int)
	walk = func(parent int) {
		pids = append(pids, parent)
		entries, _ := os.ReadDir("/proc")
		for _, e := range entries {
			if !e.IsDir() {
				continue
			}
			cid, err := strconv.Atoi(e.Name())
			if err != nil {
				continue
			}
			b, err := os.ReadFile("/proc/" + e.Name() + "/stat")
			if err != nil {
				continue
			}
			s := string(b)
			rp := strings.LastIndex(s, ")")
			if rp < 0 {
				continue
			}
			fields := strings.Fields(s[rp+2:])
			if len(fields) < 2 {
				continue
			}
			ppid, _ := strconv.Atoi(fields[1])
			if ppid == parent {
				walk(cid)
			}
		}
	}
	walk(pid)
	// kill children first (reverse)
	var msgs []string
	for i := len(pids) - 1; i >= 0; i-- {
		id := pids[i]
		out, err := exec.Command("kill", "-9", strconv.Itoa(id)).CombinedOutput()
		if err != nil {
			o2, err2 := runPkexec("kill", "-9", strconv.Itoa(id))
			if err2 != nil {
				msgs = append(msgs, fmt.Sprintf("%d失败:%s %s", id, string(out), o2))
			}
		}
	}
	if len(msgs) > 0 {
		return "部分失败: " + strings.Join(msgs, "; ")
	}
	return fmt.Sprintf("已结束进程树，共 %d 个 PID（根 %d）", len(pids), pid)
}

func (a *App) SetProcessNice(pid int, nice int) string {
	if pid <= 1 {
		return "拒绝操作"
	}
	if nice < -20 {
		nice = -20
	}
	if nice > 19 {
		nice = 19
	}
	out, err := exec.Command("renice", "-n", strconv.Itoa(nice), "-p", strconv.Itoa(pid)).CombinedOutput()
	if err != nil {
		o2, err2 := runPkexec("renice", "-n", strconv.Itoa(nice), "-p", strconv.Itoa(pid))
		if err2 != nil {
			return "renice 失败: " + string(out) + " / " + o2
		}
		return "已设置 nice=" + strconv.Itoa(nice) + " (pkexec)"
	}
	return "已设置 nice=" + strconv.Itoa(nice)
}

func (a *App) SetProcessAffinity(pid int, cpuList string) string {
	if pid <= 1 {
		return "拒绝操作"
	}
	if cpuList == "" {
		cpuList = "0"
	}
	out, err := exec.Command("taskset", "-pc", cpuList, strconv.Itoa(pid)).CombinedOutput()
	if err != nil {
		o2, err2 := runPkexec("taskset", "-pc", cpuList, strconv.Itoa(pid))
		if err2 != nil {
			return "taskset 失败: " + string(out) + " " + o2
		}
		return "已设置 CPU 亲和: " + cpuList + " (pkexec)"
	}
	return "已设置 CPU 亲和: " + cpuList
}

func (a *App) CreateMemoryDump(pid int) string {
	if pid <= 1 {
		return "拒绝操作"
	}
	outPath := fmt.Sprintf("/tmp/core.%d", pid)
	// try gcore
	out, err := exec.Command("gcore", "-o", "/tmp/core", strconv.Itoa(pid)).CombinedOutput()
	if err != nil {
		o2, err2 := runPkexec("gcore", "-o", "/tmp/core", strconv.Itoa(pid))
		if err2 != nil {
			return "gcore 失败（请安装 gdb）: " + string(out) + " " + o2
		}
		return "已生成转储（pkexec）: /tmp/core." + strconv.Itoa(pid) + "\n" + o2
	}
	return "已生成转储: /tmp/core." + strconv.Itoa(pid) + "\n" + string(out) + " pathHint=" + outPath
}


func (a *App) GetProcessNice(pid int) int {
	// /proc/pid/stat field 19 (nice) — after comm
	b, err := os.ReadFile(fmt.Sprintf("/proc/%d/stat", pid))
	if err != nil {
		return 0
	}
	s := string(b)
	rp := strings.LastIndex(s, ")")
	if rp < 0 {
		return 0
	}
	fields := strings.Fields(s[rp+2:])
	// fields[0]=state ... nice is index 16 in full stat after pid/comm, which is fields[15] after )
	// stat: pid (comm) state ppid ... priority nice
	// after ): 0 state, 1 ppid, 2 pgrp, 3 session, 4 tty, 5 tpgid, 6 flags, 7 minflt, 8 cminflt, 9 majflt, 10 cmajflt, 11 utime, 12 stime, 13 cutime, 14 cstime, 15 priority, 16 nice
	if len(fields) < 17 {
		return 0
	}
	n, _ := strconv.Atoi(fields[16])
	return n
}

func (a *App) GetProcessAffinity(pid int) string {
	out, err := exec.Command("taskset", "-pc", strconv.Itoa(pid)).CombinedOutput()
	if err != nil {
		return ""
	}
	// "pid 123's current affinity list: 0-7"
	s := string(out)
	if i := strings.LastIndex(s, ":"); i >= 0 {
		return strings.TrimSpace(s[i+1:])
	}
	return strings.TrimSpace(s)
}


type ServiceRow struct {
	Name        string `json:"name"`
	PID         int    `json:"pid"`
	Description string `json:"description"`
	Status      string `json:"status"` // running | stopped | failed | ...
	Group       string `json:"group"`
	Unit        string `json:"unit"`
}

func (a *App) ListServices() []ServiceRow {
	out, err := exec.Command("systemctl", "list-units", "--type=service", "--all", "--no-pager", "--no-legend", "--plain").CombinedOutput()
	if err != nil {
		return []ServiceRow{}
	}
	var rows []ServiceRow
	seen := map[string]bool{}
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		// 去掉行首装饰符 ● ○ 等
		line = strings.TrimLeft(line, "●○•·* ")
		fields := strings.Fields(line)
		if len(fields) < 4 {
			continue
		}
		unit := fields[0]
		if !strings.HasSuffix(unit, ".service") {
			// 有时 unit 不在第一列
			continue
		}
		if seen[unit] {
			continue
		}
		seen[unit] = true
		active, sub := fields[2], fields[3]
		status := "已停止"
		running := false
		if active == "active" && sub == "running" {
			status = "正在运行"
			running = true
		} else if active == "active" {
			status = "活动(" + sub + ")"
		} else if active == "failed" {
			status = "失败"
		} else if sub == "dead" || sub == "exited" {
			status = "已停止"
		}
		desc := ""
		if len(fields) > 4 {
			desc = strings.Join(fields[4:], " ")
		}
		name := strings.TrimSuffix(unit, ".service")
		pid := 0
		show, _ := exec.Command("systemctl", "show", unit, "--property=MainPID", "--property=Description", "--no-pager").CombinedOutput()
		for _, sl := range strings.Split(string(show), "\n") {
			if strings.HasPrefix(sl, "MainPID=") {
				pid, _ = strconv.Atoi(strings.TrimPrefix(sl, "MainPID="))
			}
			if strings.HasPrefix(sl, "Description=") {
				d := strings.TrimPrefix(sl, "Description=")
				if d != "" {
					desc = d
				}
			}
		}
		group := ""
		if i := strings.Index(name, "@"); i >= 0 {
			group = name[:i]
		}
		_ = running
		rows = append(rows, ServiceRow{
			Name: name, PID: pid, Description: desc, Status: status, Group: group, Unit: unit,
		})
		if len(rows) >= 500 {
			break
		}
	}
	return rows
}



func (a *App) OpenServiceStatus(unit string) string {
	if unit == "" {
		return "未指定"
	}
	if !strings.HasSuffix(unit, ".service") {
		unit = unit + ".service"
	}
	// 终端状态；或 xdg-open 无法直接打开 unit。用 systemctl status 写临时文件再用 pager 不友好
	// 打开 unit 文件目录
	show, _ := exec.Command("systemctl", "show", unit, "-p", "FragmentPath", "--value").CombinedOutput()
	path := strings.TrimSpace(string(show))
	if path == "" {
		return "无单元文件路径"
	}
	dir := path
	if i := strings.LastIndex(path, "/"); i >= 0 {
		dir = path[:i]
	}
	_ = exec.Command("xdg-open", dir).Start()
	return "已打开: " + dir
}


func (a *App) SetAlwaysOnTop(on bool) {
	// Wails runtime: 在 frontend 用 runtime.WindowSetAlwaysOnTop 更合适；此处占位
	_ = on
}
