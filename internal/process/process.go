package process

import (
	"fmt"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

func clkTck() float64 {
	out, err := exec.Command("getconf", "CLK_TCK").Output()
	if err != nil {
		return 100
	}
	v, err := strconv.ParseFloat(strings.TrimSpace(string(out)), 64)
	if err != nil || v < 1 {
		return 100
	}
	return v
}

var _clk = clkTck()

var ioPrev = map[int]struct {
	rb, wb uint64
	at     time.Time
}{}

type Info struct {
	DiskBps float64 `json:"diskBps"`
	NetBps  float64 `json:"netBps"`
	PID     int     `json:"pid"`
	Name    string  `json:"name"`
	State   string  `json:"state"`
	User    string  `json:"user"`
	CPU     float64 `json:"cpu"`
	Memory  uint64  `json:"memory"` // RSS bytes
	Cmdline string  `json:"cmdline"`
	Exe     string  `json:"exe"`
	Cwd     string  `json:"cwd"`
	Threads int     `json:"threads"`
	Nice       string `json:"nice"`
	Efficiency bool   `json:"efficiency"`
}

type cpuSample struct {
	total uint64
	at    time.Time
}

var (
	cpuMu   sync.Mutex
	cpuPrev = map[int]cpuSample{}
	nCPU    = float64(runtimeNumCPU())
)



func runtimeNumCPU() int {
	b, err := os.ReadFile("/proc/cpuinfo")
	if err != nil {
		return 1
	}
	n := 0
	for _, line := range strings.Split(string(b), "\n") {
		if strings.HasPrefix(line, "processor") {
			n++
		}
	}
	if n < 1 {
		return 1
	}
	return n
}

func stateName(s string) string {
	if s == "" {
		return "?"
	}
	switch s[0] {
	case 'R':
		return "正在运行"
	case 'S':
		return "休眠"
	case 'D':
		return "磁盘休眠"
	case 'T', 't':
		return "已停止"
	case 'Z':
		return "僵尸"
	case 'I':
		return "空闲"
	default:
		return string(s[0])
	}
}

func readCmdline(pid int) string {
	b, err := os.ReadFile(fmt.Sprintf("/proc/%d/cmdline", pid))
	if err != nil {
		return ""
	}
	return strings.ReplaceAll(string(b), "\x00", " ")
}

func readExe(pid int) string {
	p, err := os.Readlink(fmt.Sprintf("/proc/%d/exe", pid))
	if err != nil {
		return ""
	}
	return p
}

func readCwd(pid int) string {
	p, err := os.Readlink(fmt.Sprintf("/proc/%d/cwd", pid))
	if err != nil {
		return ""
	}
	return p
}

func readStatus(pid int) (name, state, uid string, rssKB uint64, threads int, nice string) {
	b, err := os.ReadFile(fmt.Sprintf("/proc/%d/status", pid))
	if err != nil {
		return
	}
	for _, line := range strings.Split(string(b), "\n") {
		parts := strings.SplitN(line, ":", 2)
		if len(parts) != 2 {
			continue
		}
		k := strings.TrimSpace(parts[0])
		v := strings.TrimSpace(parts[1])
		switch k {
		case "Name":
			name = v
		case "State":
			state = v
		case "Uid":
			fields := strings.Fields(v)
			if len(fields) > 0 {
				uid = fields[0]
			}
		case "VmRSS":
			fmt.Sscanf(v, "%d", &rssKB)
		case "Threads":
			fmt.Sscanf(v, "%d", &threads)
		}
	}
	// nice from stat
	sb, err := os.ReadFile(fmt.Sprintf("/proc/%d/stat", pid))
	if err == nil {
		// after comm) fields: ... nice is field 19 (1-based from start of stat after pid)
		s := string(sb)
		if i := strings.LastIndex(s, ")"); i >= 0 && i+2 < len(s) {
			fields := strings.Fields(s[i+2:])
			if len(fields) >= 17 {
				nice = fields[16]
			}
		}
	}
	return
}

func readCPUTime(pid int) uint64 {
	b, err := os.ReadFile(fmt.Sprintf("/proc/%d/stat", pid))
	if err != nil {
		return 0
	}
	s := string(b)
	i := strings.LastIndex(s, ")")
	if i < 0 || i+2 >= len(s) {
		return 0
	}
	fields := strings.Fields(s[i+2:])
	if len(fields) < 13 {
		return 0
	}
	ut, _ := strconv.ParseUint(fields[11], 10, 64)
	st, _ := strconv.ParseUint(fields[12], 10, 64)
	return ut + st
}

func uidToName(uid string) string {
	u, err := user.LookupId(uid)
	if err != nil {
		return uid
	}
	return u.Username
}

// List returns all readable processes with CPU% since last call.
func List() []Info {
	cpuMu.Lock()
	defer cpuMu.Unlock()

	now := time.Now()
	ents, err := os.ReadDir("/proc")
	if err != nil {
		return nil
	}
	out := make([]Info, 0, 256)
	seen := map[int]struct{}{}

	for _, e := range ents {
		if !e.IsDir() {
			continue
		}
		pid, err := strconv.Atoi(e.Name())
		if err != nil {
			continue
		}
		name, state, uid, rssKB, threads, nice := readStatus(pid)
		if name == "" {
			continue
		}
		total := readCPUTime(pid)
		var cpuPct float64
		if prev, ok := cpuPrev[pid]; ok && !prev.at.IsZero() {
			dt := now.Sub(prev.at).Seconds()
			if dt > 0.02 && total >= prev.total {
				delta := float64(total - prev.total)
				// 单核% = delta/CLK_TCK/dt*100；再 /nCPU 得到整机占比（与任务管理器一致）
				cpuPct = delta / _clk / dt * 100.0 / nCPU
				if cpuPct < 0 {
					cpuPct = 0
				}
				if cpuPct > 100 {
					cpuPct = 100
				}
			}
		}
		cpuPrev[pid] = cpuSample{total: total, at: now}

		var diskBps float64
		if iob, err := os.ReadFile(fmt.Sprintf("/proc/%d/io", pid)); err == nil {
			var rb, wb uint64
			for _, line := range strings.Split(string(iob), "\n") {
				if strings.HasPrefix(line, "read_bytes:") {
					fmt.Sscanf(line, "read_bytes: %d", &rb)
				}
				if strings.HasPrefix(line, "write_bytes:") {
					fmt.Sscanf(line, "write_bytes: %d", &wb)
				}
			}
			if prev, ok := ioPrev[pid]; ok && !prev.at.IsZero() {
				dt := now.Sub(prev.at).Seconds()
				if dt > 0.05 {
					dr := float64(rb) - float64(prev.rb)
					dw := float64(wb) - float64(prev.wb)
					if dr < 0 {
						dr = 0
					}
					if dw < 0 {
						dw = 0
					}
					diskBps = (dr + dw) / dt
				}
			}
			ioPrev[pid] = struct {
				rb, wb uint64
				at     time.Time
			}{rb, wb, now}
		}

		seen[pid] = struct{}{}

		out = append(out, Info{
			PID:     pid,
			Name:    name,
			State:   stateName(state),
			User:    uidToName(uid),
			CPU:     cpuPct, DiskBps: diskBps, NetBps: 0,
			Memory:  rssKB * 1024,
			Cmdline: strings.TrimSpace(readCmdline(pid)),
			Exe:     readExe(pid),
			Cwd:     readCwd(pid),
			Threads: threads,
			Nice:       nice,
			Efficiency: IsEfficiency(pid),
		})
	}
	for pid := range cpuPrev {
		if _, ok := seen[pid]; !ok {
			delete(cpuPrev, pid)
		}
	}
	return out
}

// alive reports whether pid still exists (signal 0).
func alive(pid int) bool {
	p, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	return p.Signal(syscall.Signal(0)) == nil
}

// Kill sends SIGTERM, waits briefly, then SIGKILL if still running.
func Kill(pid int) string {
	if pid <= 0 {
		return "无效 PID"
	}
	p, err := os.FindProcess(pid)
	if err != nil {
		return err.Error()
	}
	// 1) 先友好结束
	_ = p.Signal(syscall.SIGTERM)
	// 2) 等待最多 ~800ms，期间若已退出则返回
	deadline := time.Now().Add(800 * time.Millisecond)
	for time.Now().Before(deadline) {
		if !alive(pid) {
			return fmt.Sprintf("已结束 %d (SIGTERM)", pid)
		}
		time.Sleep(50 * time.Millisecond)
	}
	// 3) 仍在运行 → 强杀
	if err := p.Signal(syscall.SIGKILL); err != nil {
		// 备选：os.Kill
		if err2 := p.Kill(); err2 != nil {
			return fmt.Sprintf("结束 %d 失败: %v", pid, err2)
		}
	}
	time.Sleep(50 * time.Millisecond)
	if !alive(pid) {
		return fmt.Sprintf("已强制结束 %d (SIGKILL)", pid)
	}
	return fmt.Sprintf("已发送 SIGKILL 至 %d，进程可能仍受保护", pid)
}

// KillRoot tries normal Kill, then pkexec kill -9 if still alive.
func KillRoot(pid int) string {
	s := Kill(pid)
	if !alive(pid) {
		return s
	}
	out, err := exec.Command("pkexec", "kill", "-9", strconv.Itoa(pid)).CombinedOutput()
	if err != nil {
		return s + " | pkexec: " + strings.TrimSpace(string(out))
	}
	time.Sleep(50 * time.Millisecond)
	if !alive(pid) {
		return fmt.Sprintf("已通过 pkexec 强制结束 %d", pid)
	}
	return fmt.Sprintf("pkexec kill -9 %d 已执行，进程可能仍存在", pid)
}

// OpenPath opens file manager at executable directory.
func OpenPath(pid int) string {
	exe := readExe(pid)
	if exe == "" {
		return "无法解析可执行路径（可能是内核线程）"
	}
	dir := filepath.Dir(exe)
	cmd := exec.Command("xdg-open", dir)
	if err := cmd.Start(); err != nil {
		return err.Error()
	}
	return "已打开 " + dir
}

func runOrPkexec(name string, args ...string) string {
	out, err := exec.Command(name, args...).CombinedOutput()
	if err == nil {
		return strings.TrimSpace(string(out))
	}
	args2 := append([]string{name}, args...)
	out2, err2 := exec.Command("pkexec", args2...).CombinedOutput()
	if err2 != nil {
		return strings.TrimSpace(string(out)) + " | pkexec: " + strings.TrimSpace(string(out2))
	}
	return strings.TrimSpace(string(out2))
}

// SetNice sets process nice (-20..19). Maps Win priority roughly.
func SetNice(pid int, nice int) string {
	if pid <= 0 {
		return "无效 PID"
	}
	if nice < -20 {
		nice = -20
	}
	if nice > 19 {
		nice = 19
	}
	msg := runOrPkexec("renice", "-n", strconv.Itoa(nice), "-p", strconv.Itoa(pid))
	if msg == "" {
		return fmt.Sprintf("已设置 PID %d nice=%d", pid, nice)
	}
	return fmt.Sprintf("nice=%d: %s", nice, msg)
}

// SetAffinity cpuList e.g. "0" "0-1" "0,2,3"
func SetAffinity(pid int, cpuList string) string {
	if pid <= 0 {
		return "无效 PID"
	}
	if cpuList == "" {
		cpuList = "0"
	}
	msg := runOrPkexec("taskset", "-pc", cpuList, strconv.Itoa(pid))
	return fmt.Sprintf("affinity %s: %s", cpuList, msg)
}

// GetAffinity reads current mask.
func GetAffinity(pid int) string {
	out, err := exec.Command("taskset", "-p", strconv.Itoa(pid)).CombinedOutput()
	if err != nil {
		return strings.TrimSpace(string(out))
	}
	return strings.TrimSpace(string(out))
}

var (
	effMu   sync.Mutex
	effPIDs = map[int]bool{}
)

// SetEfficiency approximates Win efficiency mode: high nice + pin CPU0.
func SetEfficiency(pid int, on bool) string {
	if pid <= 0 {
		return "无效 PID"
	}
	if on {
		_ = SetNice(pid, 19)
		_ = SetAffinity(pid, "0")
		effMu.Lock()
		effPIDs[pid] = true
		effMu.Unlock()
		return fmt.Sprintf("已对 %d 启用效能模式(nice=19, CPU0)", pid)
	}
	_ = SetNice(pid, 0)
	// restore all CPUs
	n := int(nCPU)
	if n < 1 {
		n = 1
	}
	list := fmt.Sprintf("0-%d", n-1)
	if n == 1 {
		list = "0"
	}
	_ = SetAffinity(pid, list)
	effMu.Lock()
	delete(effPIDs, pid)
	effMu.Unlock()
	return fmt.Sprintf("已关闭 %d 效能模式", pid)
}

func IsEfficiency(pid int) bool {
	effMu.Lock()
	defer effMu.Unlock()
	return effPIDs[pid]
}

// KillTree kills process group / children best-effort.
func KillTree(pid int) string {
	if pid <= 0 {
		return "无效 PID"
	}
	// negative PGID if leader; else kill children from /proc
	ents, _ := os.ReadDir("/proc")
	killed := 0
	for _, e := range ents {
		cid, err := strconv.Atoi(e.Name())
		if err != nil {
			continue
		}
		b, err := os.ReadFile(fmt.Sprintf("/proc/%d/stat", cid))
		if err != nil {
			continue
		}
		s := string(b)
		i := strings.LastIndex(s, ")")
		if i < 0 {
			continue
		}
		fields := strings.Fields(s[i+2:])
		// field 4 = ppid (1-based in man: after state)
		if len(fields) < 4 {
			continue
		}
		ppid, _ := strconv.Atoi(fields[2])
		if ppid == pid {
			_ = Kill(cid)
			killed++
		}
	}
	_ = Kill(pid)
	return fmt.Sprintf("已结束 %d 及其子进程约 %d 个", pid, killed)
}
