package perf

import (
	"bufio"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
)

// Stats host-level snapshot with Windows-like detail fields.
type Stats struct {
	CPUPercent   float64 `json:"cpuPercent"`
	MemUsed      uint64  `json:"memUsed"`
	MemTotal     uint64  `json:"memTotal"`
	MemPercent   float64 `json:"memPercent"`
	ProcessCount int     `json:"processCount"`
	ThreadCount  int     `json:"threadCount"`
	HandleCount  int     `json:"handleCount"` // best-effort (open fds), -1 if unknown
	CPUModel     string  `json:"cpuModel"`
	CPUCores     int     `json:"cpuCores"`     // logical
	CPUPhysical  int     `json:"cpuPhysical"`  // physical cores
	CPUSockets   int     `json:"cpuSockets"`
	CPUMhz       float64 `json:"cpuMhz"`
	CPUBaseMhz   float64 `json:"cpuBaseMhz"`
	UptimeSec    float64 `json:"uptimeSec"`
	Load1        float64 `json:"load1"`
	Load5        float64 `json:"load5"`
	Load15       float64 `json:"load15"`
	Virtualization string `json:"virtualization"` // 已启用 / 未启用 / N/A
	L1Cache      string  `json:"l1Cache"`
	L2Cache      string  `json:"l2Cache"`
	L3Cache      string  `json:"l3Cache"`
	// memory detail
	MemAvailable uint64 `json:"memAvailable"`
	MemCached    uint64 `json:"memCached"`
	MemCommit    uint64 `json:"memCommit"`    // Committed_AS
	MemCommitLim uint64 `json:"memCommitLim"` // CommitLimit
	MemSlab      uint64 `json:"memSlab"`
	MemSwapUsed  uint64 `json:"memSwapUsed"`
	MemSwapTotal uint64 `json:"memSwapTotal"`
	MemHardwareReserved uint64 `json:"memHardwareReserved"` // best-effort 0
}

type NetDevice struct {
	Name       string  `json:"name"`
	Kind       string  `json:"kind"` // wifi | ethernet | other
	RxBps      float64 `json:"rxBps"`
	TxBps      float64 `json:"txBps"`
	RxBytes    uint64  `json:"rxBytes"`
	TxBytes    uint64  `json:"txBytes"`
	IPv4       string  `json:"ipv4"`
	IPv6       string  `json:"ipv6"`
	SSID       string  `json:"ssid"`
	ConnType   string  `json:"connType"`
	Signal     string  `json:"signal"`
}

type DiskInfo struct {
	Name       string  `json:"name"`
	Model      string  `json:"model"`
	Util       float64 `json:"util"` // 0-100, -1 unknown
	ReadBps    float64 `json:"readBps"`
	WriteBps   float64 `json:"writeBps"`
	SizeBytes  uint64  `json:"sizeBytes"`
	Type       string  `json:"type"` // SSD | HDD | N/A
	SystemDisk bool    `json:"systemDisk"`
	PageFile   bool    `json:"pageFile"` // has swap on this disk?
	AvgRespMs  float64 `json:"avgRespMs"` // best-effort, -1 unknown
}

type GPUInfo struct {
	Name          string  `json:"name"`
	Kind          string  `json:"kind"`
	Usage         float64 `json:"usage"`
	Temp          float64 `json:"temp"`
	MemUsed       int64   `json:"memUsed"`  // bytes, -1 unknown
	MemTotal      int64   `json:"memTotal"` // bytes, -1 unknown
	DriverVersion string  `json:"driverVersion"`
	DriverDate    string  `json:"driverDate"`
	Location      string  `json:"location"`
}

type Extra struct {
	Disks []DiskInfo  `json:"disks"`
	Nets  []NetDevice `json:"nets"`
	GPUs  []GPUInfo   `json:"gpus"`
}

var (
	mu       sync.Mutex
	prevIdle uint64
	prevTot  uint64
	prevAt   time.Time

	netMu   sync.Mutex
	netPrev = map[string][2]uint64{}
	netAt   time.Time

	diskMu   sync.Mutex
	diskPrev = map[string]diskSample{}
	diskAt   time.Time
)

type diskSample struct {
	ioTicks  uint64
	readSect uint64
	wrtSect  uint64
	at       time.Time
}

func readFile(path string) string {
	b, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(b))
}

func readCPUModel() (model string, logical, physical, sockets int, mhz float64) {
	f, err := os.Open("/proc/cpuinfo")
	if err != nil {
		return
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	coresMap := map[string]bool{}
	physIds := map[string]bool{}
	for sc.Scan() {
		line := sc.Text()
		if strings.HasPrefix(line, "model name") {
			if i := strings.Index(line, ":"); i >= 0 && model == "" {
				model = strings.TrimSpace(line[i+1:])
			}
		}
		if strings.HasPrefix(line, "processor") {
			logical++
		}
		if strings.HasPrefix(line, "cpu MHz") && mhz == 0 {
			if i := strings.Index(line, ":"); i >= 0 {
				mhz, _ = strconv.ParseFloat(strings.TrimSpace(line[i+1:]), 64)
			}
		}
		if strings.HasPrefix(line, "core id") {
			if i := strings.Index(line, ":"); i >= 0 {
				coresMap[strings.TrimSpace(line[i+1:])] = true
			}
		}
		if strings.HasPrefix(line, "physical id") {
			if i := strings.Index(line, ":"); i >= 0 {
				physIds[strings.TrimSpace(line[i+1:])] = true
			}
		}
	}
	sockets = len(physIds)
	if sockets < 1 {
		sockets = 1
	}
	physical = len(coresMap)
	if physical < 1 {
		physical = logical
	}
	if logical < 1 {
		logical = 1
	}
	return
}

func readBaseMhz() float64 {
	// kHz in sysfs
	for _, p := range []string{
		"/sys/devices/system/cpu/cpu0/cpufreq/base_frequency",
		"/sys/devices/system/cpu/cpu0/cpufreq/cpuinfo_max_freq",
	} {
		s := readFile(p)
		if s == "" {
			continue
		}
		v, err := strconv.ParseFloat(s, 64)
		if err == nil && v > 0 {
			return v / 1000 // kHz -> MHz
		}
	}
	return 0
}

func readCacheSizes() (l1, l2, l3 string) {
	base := "/sys/devices/system/cpu/cpu0/cache"
	ents, err := os.ReadDir(base)
	if err != nil {
		return "N/A", "N/A", "N/A"
	}
	var l1b, l2b, l3b uint64
	for _, e := range ents {
		if !e.IsDir() {
			continue
		}
		idx := filepath.Join(base, e.Name())
		level := readFile(filepath.Join(idx, "level"))
		size := readFile(filepath.Join(idx, "size")) // e.g. "32K"
		typ := readFile(filepath.Join(idx, "type"))
		if size == "" {
			continue
		}
		bytes := parseCacheSize(size)
		switch level {
		case "1":
			if typ == "Data" || typ == "Instruction" || typ == "Unified" {
				l1b += bytes
			}
		case "2":
			if bytes > l2b {
				l2b = bytes
			}
		case "3":
			if bytes > l3b {
				l3b = bytes
			}
		}
	}
	fmt := func(b uint64) string {
		if b == 0 {
			return "N/A"
		}
		if b >= 1024*1024 {
			return strconv.FormatFloat(float64(b)/1024/1024, 'f', 1, 64) + " MB"
		}
		return strconv.FormatFloat(float64(b)/1024, 'f', 0, 64) + " KB"
	}
	// L1 often listed per-core data+inst; report combined if available
	return fmt(l1b), fmt(l2b), fmt(l3b)
}

func parseCacheSize(s string) uint64 {
	s = strings.TrimSpace(strings.ToUpper(s))
	mult := uint64(1)
	if strings.HasSuffix(s, "K") {
		mult = 1024
		s = strings.TrimSuffix(s, "K")
	} else if strings.HasSuffix(s, "M") {
		mult = 1024 * 1024
		s = strings.TrimSuffix(s, "M")
	}
	v, _ := strconv.ParseUint(s, 10, 64)
	return v * mult
}

func readVirtualization() string {
	b, err := os.ReadFile("/proc/cpuinfo")
	if err == nil {
		low := strings.ToLower(string(b))
		if strings.Contains(low, "vmx") || strings.Contains(low, "svm") {
			return "已启用"
		}
	}
	out, err := exec.Command("systemd-detect-virt").CombinedOutput()
	if err == nil {
		v := strings.TrimSpace(string(out))
		if v != "" && v != "none" {
			return "已启用"
		}
	}
	return "N/A"
}

func readMemDetail() (used, total, available, cached, commit, commitLim, slab, swapUsed, swapTotal uint64) {
	b, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return
	}
	var memTotal, memAvail, memFree, buffers, cachedVal, sreclaim, commitAS, commitLimit, slabVal, swapTot, swapFree uint64
	for _, line := range strings.Split(string(b), "\n") {
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
		case "MemFree:":
			memFree = v
		case "Buffers:":
			buffers = v
		case "Cached:":
			cachedVal = v
		case "SReclaimable:":
			sreclaim = v
		case "Committed_AS:":
			commitAS = v
		case "CommitLimit:":
			commitLimit = v
		case "Slab:":
			slabVal = v
		case "SwapTotal:":
			swapTot = v
		case "SwapFree:":
			swapFree = v
		}
	}
	total = memTotal
	available = memAvail
	if available == 0 {
		available = memFree
	}
	if memTotal >= available {
		used = memTotal - available
	}
	cached = cachedVal + buffers + sreclaim
	commit = commitAS
	commitLim = commitLimit
	slab = slabVal
	swapTotal = swapTot
	if swapTot >= swapFree {
		swapUsed = swapTot - swapFree
	}
	return
}

func readLoad() (l1, l5, l15 float64) {
	b, err := os.ReadFile("/proc/loadavg")
	if err != nil {
		return
	}
	fields := strings.Fields(string(b))
	if len(fields) >= 3 {
		l1, _ = strconv.ParseFloat(fields[0], 64)
		l5, _ = strconv.ParseFloat(fields[1], 64)
		l15, _ = strconv.ParseFloat(fields[2], 64)
	}
	return
}

func readUptime() float64 {
	b, err := os.ReadFile("/proc/uptime")
	if err != nil {
		return 0
	}
	fields := strings.Fields(string(b))
	if len(fields) < 1 {
		return 0
	}
	v, _ := strconv.ParseFloat(fields[0], 64)
	return v
}

func countProcsAndThreads() (procs, threads, handles int) {
	ents, err := os.ReadDir("/proc")
	if err != nil {
		return
	}
	handles = -1
	fdSum := 0
	fdOk := false
	for _, e := range ents {
		if !e.IsDir() {
			continue
		}
		pid := e.Name()
		if _, err := strconv.Atoi(pid); err != nil {
			continue
		}
		procs++
		// Threads
		st := readFile("/proc/" + pid + "/status")
		for _, line := range strings.Split(st, "\n") {
			if strings.HasPrefix(line, "Threads:") {
				fields := strings.Fields(line)
				if len(fields) >= 2 {
					n, _ := strconv.Atoi(fields[1])
					threads += n
				}
				break
			}
		}
		// open fds as handle approx
		if fds, err := os.ReadDir("/proc/" + pid + "/fd"); err == nil {
			fdSum += len(fds)
			fdOk = true
		}
	}
	if fdOk {
		handles = fdSum
	}
	return
}

func readCPUPercent() float64 {
	mu.Lock()
	defer mu.Unlock()

	b, err := os.ReadFile("/proc/stat")
	if err != nil {
		return 0
	}
	line := strings.SplitN(string(b), "\n", 2)[0]
	fields := strings.Fields(line)
	if len(fields) < 5 || fields[0] != "cpu" {
		return 0
	}
	var vals []uint64
	for _, f := range fields[1:] {
		v, _ := strconv.ParseUint(f, 10, 64)
		vals = append(vals, v)
	}
	var tot uint64
	for _, v := range vals {
		tot += v
	}
	idle := vals[3]
	if len(vals) > 4 {
		idle += vals[4]
	}
	now := time.Now()
	var pct float64
	if !prevAt.IsZero() && tot > prevTot {
		dTot := float64(tot - prevTot)
		dIdle := float64(idle - prevIdle)
		if dTot > 0 {
			pct = (1.0 - dIdle/dTot) * 100
		}
	}
	prevIdle, prevTot, prevAt = idle, tot, now
	if pct < 0 {
		pct = 0
	}
	if pct > 100 {
		pct = 100
	}
	return pct
}

func GetStats() Stats {
	used, total, available, cached, commit, commitLim, slab, swapUsed, swapTotal := readMemDetail()
	model, logical, physical, sockets, mhz := readCPUModel()
	l1, l5, l15 := readLoad()
	procs, threads, handles := countProcsAndThreads()
	var memPct float64
	if total > 0 {
		memPct = float64(used) / float64(total) * 100
	}
	cl1, cl2, cl3 := readCacheSizes()
	base := readBaseMhz()
	if base == 0 {
		base = mhz
	}
	return Stats{
		CPUPercent:            readCPUPercent(),
		MemUsed:               used,
		MemTotal:              total,
		MemPercent:            memPct,
		ProcessCount:          procs,
		ThreadCount:           threads,
		HandleCount:           handles,
		CPUModel:              model,
		CPUCores:              logical,
		CPUPhysical:           physical,
		CPUSockets:            sockets,
		CPUMhz:                mhz,
		CPUBaseMhz:            base,
		UptimeSec:             readUptime(),
		Load1:                 l1,
		Load5:                 l5,
		Load15:                l15,
		Virtualization:        readVirtualization(),
		L1Cache:               cl1,
		L2Cache:               cl2,
		L3Cache:               cl3,
		MemAvailable:          available,
		MemCached:             cached,
		MemCommit:             commit,
		MemCommitLim:          commitLim,
		MemSlab:               slab,
		MemSwapUsed:           swapUsed,
		MemSwapTotal:          swapTotal,
		MemHardwareReserved:   0,
	}
}

func classifyIface(name string) string {
	low := strings.ToLower(name)
	if low == "lo" {
		return "lo"
	}
	if strings.HasPrefix(low, "wl") || strings.Contains(low, "wifi") || strings.Contains(low, "wlan") {
		return "wifi"
	}
	if strings.HasPrefix(low, "en") || strings.HasPrefix(low, "eth") {
		return "ethernet"
	}
	return "other"
}

func ifaceAddrs(name string) (ipv4, ipv6 string) {
	out, err := exec.Command("ip", "-o", "addr", "show", "dev", name).CombinedOutput()
	if err != nil {
		return "N/A", "N/A"
	}
	for _, line := range strings.Split(string(out), "\n") {
		fields := strings.Fields(line)
		for i, f := range fields {
			if f == "inet" && i+1 < len(fields) && ipv4 == "" {
				ipv4 = strings.Split(fields[i+1], "/")[0]
			}
			if f == "inet6" && i+1 < len(fields) && ipv6 == "" {
				a := strings.Split(fields[i+1], "/")[0]
				if strings.HasPrefix(a, "fe80") && ipv6 == "" {
					ipv6 = a
				} else if !strings.HasPrefix(a, "fe80") {
					ipv6 = a
				}
			}
		}
	}
	if ipv4 == "" {
		ipv4 = "N/A"
	}
	if ipv6 == "" {
		ipv6 = "N/A"
	}
	return
}

func wifiInfo(name string) (ssid, connType, signal string) {
	ssid, connType, signal = "N/A", "N/A", "N/A"
	out, err := exec.Command("iwgetid", name, "-r").CombinedOutput()
	if err == nil {
		s := strings.TrimSpace(string(out))
		if s != "" {
			ssid = s
		}
	}
	out2, err := exec.Command("iw", "dev", name, "link").CombinedOutput()
	if err == nil {
		for _, line := range strings.Split(string(out2), "\n") {
			line = strings.TrimSpace(line)
			if strings.HasPrefix(line, "SSID:") {
				ssid = strings.TrimSpace(strings.TrimPrefix(line, "SSID:"))
			}
			if strings.Contains(line, "tx bitrate") || strings.Contains(line, "rx bitrate") {
				// ignore
			}
			if strings.HasPrefix(line, "signal:") {
				signal = strings.TrimSpace(strings.TrimPrefix(line, "signal:"))
			}
			if strings.Contains(line, "freq:") {
				connType = "Wi-Fi"
			}
		}
	}
	return
}

func collectNets() []NetDevice {
	netMu.Lock()
	defer netMu.Unlock()

	f, err := os.Open("/proc/net/dev")
	if err != nil {
		return nil
	}
	defer f.Close()
	now := time.Now()
	sc := bufio.NewScanner(f)
	var out []NetDevice
	for sc.Scan() {
		line := sc.Text()
		if !strings.Contains(line, ":") {
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
		if prev, ok := netPrev[name]; ok && !netAt.IsZero() {
			dt := now.Sub(netAt).Seconds()
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
		ipv4, ipv6 := ifaceAddrs(name)
		ssid, connType, signal := "N/A", "N/A", "N/A"
		if kind == "wifi" {
			ssid, connType, signal = wifiInfo(name)
			if connType == "N/A" {
				connType = "Wi-Fi"
			}
		} else if kind == "ethernet" {
			connType = "以太网"
		}
		out = append(out, NetDevice{
			Name: name, Kind: kind, RxBps: rxBps, TxBps: txBps,
			RxBytes: rx, TxBytes: tx, IPv4: ipv4, IPv6: ipv6,
			SSID: ssid, ConnType: connType, Signal: signal,
		})
	}
	netAt = now
	return out
}

func isSystemDisk(name string) bool {
	b, err := os.ReadFile("/proc/mounts")
	if err != nil {
		return false
	}
	for _, line := range strings.Split(string(b), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		dev := fields[0]
		mp := fields[1]
		if mp == "/" && strings.Contains(dev, name) {
			return true
		}
	}
	return false
}

func diskHasSwap(name string) bool {
	b, err := os.ReadFile("/proc/swaps")
	if err != nil {
		return false
	}
	for _, line := range strings.Split(string(b), "\n") {
		if strings.Contains(line, name) {
			return true
		}
	}
	return false
}

func collectDisks() []DiskInfo {
	diskMu.Lock()
	defer diskMu.Unlock()

	b, err := os.ReadFile("/proc/diskstats")
	if err != nil {
		return nil
	}
	now := time.Now()
	var out []DiskInfo
	for _, line := range strings.Split(string(b), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 14 {
			continue
		}
		name := fields[2]
		if strings.HasPrefix(name, "loop") || strings.HasPrefix(name, "ram") {
			continue
		}
		ok := (strings.HasPrefix(name, "sd") && len(name) == 3) ||
			(strings.HasPrefix(name, "vd") && len(name) == 3) ||
			(strings.HasPrefix(name, "nvme") && strings.HasSuffix(name, "n1"))
		if !ok {
			continue
		}
		readSect, _ := strconv.ParseUint(fields[5], 10, 64)
		wrtSect, _ := strconv.ParseUint(fields[9], 10, 64)
		ioTicks, _ := strconv.ParseUint(fields[12], 10, 64)
		util := -1.0
		var readBps, writeBps float64
		if prev, ok := diskPrev[name]; ok && !diskAt.IsZero() {
			dt := now.Sub(diskAt).Seconds()
			if dt > 0.05 {
				if ioTicks >= prev.ioTicks {
					util = float64(ioTicks-prev.ioTicks) / (dt * 1000) * 100
					if util > 100 {
						util = 100
					}
				}
				if readSect >= prev.readSect {
					readBps = float64(readSect-prev.readSect) * 512 / dt
				}
				if wrtSect >= prev.wrtSect {
					writeBps = float64(wrtSect-prev.wrtSect) * 512 / dt
				}
			}
		}
		diskPrev[name] = diskSample{ioTicks: ioTicks, readSect: readSect, wrtSect: wrtSect, at: now}
		model := strings.TrimSpace(readFile("/sys/block/" + name + "/device/model"))
		sizeStr := readFile("/sys/block/" + name + "/size")
		var sizeBytes uint64
		if n, err := strconv.ParseUint(sizeStr, 10, 64); err == nil {
			sizeBytes = n * 512
		}
		rot := readFile("/sys/block/" + name + "/queue/rotational")
		dtype := "N/A"
		if rot == "0" {
			dtype = "SSD"
		} else if rot == "1" {
			dtype = "HDD"
		}
		out = append(out, DiskInfo{
			Name: name, Model: model, Util: util,
			ReadBps: readBps, WriteBps: writeBps, SizeBytes: sizeBytes,
			Type: dtype, SystemDisk: isSystemDisk(name), PageFile: diskHasSwap(name),
			AvgRespMs: -1,
		})
	}
	diskAt = now
	return out
}

func collectGPUs() []GPUInfo {
	out, err := exec.Command("lspci").CombinedOutput()
	var gpus []GPUInfo
	if err == nil {
		for _, line := range strings.Split(string(out), "\n") {
			low := strings.ToLower(line)
			if !(strings.Contains(low, "vga") || strings.Contains(low, "3d controller") || strings.Contains(low, "display")) {
				continue
			}
			name := line
			loc := ""
			if i := strings.Index(line, " "); i >= 0 {
				loc = line[:i]
			}
			if i := strings.Index(line, ": "); i >= 0 {
				name = strings.TrimSpace(line[i+2:])
			}
			kind := "unknown"
			if strings.Contains(low, "nvidia") {
				kind = "dGPU"
			} else if strings.Contains(low, "intel") {
				kind = "iGPU"
			} else if strings.Contains(low, "amd") || strings.Contains(low, "radeon") {
				if strings.Contains(low, "3d") {
					kind = "dGPU"
				} else {
					kind = "iGPU"
				}
			}
			gpus = append(gpus, GPUInfo{
				Name: name, Kind: kind, Usage: -1, Temp: -1,
				MemUsed: -1, MemTotal: -1, DriverVersion: "N/A", DriverDate: "N/A",
				Location: loc,
			})
		}
	}
	nout, err := exec.Command("nvidia-smi",
		"--query-gpu=name,utilization.gpu,temperature.gpu,memory.used,memory.total,driver_version",
		"--format=csv,noheader,nounits").CombinedOutput()
	if err == nil {
		for i, line := range strings.Split(string(nout), "\n") {
			line = strings.TrimSpace(line)
			if line == "" {
				continue
			}
			parts := strings.Split(line, ",")
			if len(parts) < 3 {
				continue
			}
			name := strings.TrimSpace(parts[0])
			usage, _ := strconv.ParseFloat(strings.TrimSpace(parts[1]), 64)
			temp, _ := strconv.ParseFloat(strings.TrimSpace(parts[2]), 64)
			var memUsed, memTotal int64 = -1, -1
			if len(parts) >= 5 {
				mu, _ := strconv.ParseFloat(strings.TrimSpace(parts[3]), 64)
				mt, _ := strconv.ParseFloat(strings.TrimSpace(parts[4]), 64)
				memUsed = int64(mu * 1024 * 1024)
				memTotal = int64(mt * 1024 * 1024)
			}
			drv := "N/A"
			if len(parts) >= 6 {
				drv = strings.TrimSpace(parts[5])
			}
			g := GPUInfo{Name: name, Kind: "dGPU", Usage: usage, Temp: temp, MemUsed: memUsed, MemTotal: memTotal, DriverVersion: drv, DriverDate: "N/A"}
			if i < len(gpus) {
				g.Location = gpus[i].Location
				gpus[i] = g
			} else {
				gpus = append(gpus, g)
			}
		}
	}
	return gpus
}

func GetExtra() Extra {
	return Extra{
		Disks: collectDisks(),
		Nets:  collectNets(),
		GPUs:  collectGPUs(),
	}
}
