package api

import (
	"encoding/json"
	"os"
	"time"
	"io"
	"net/http"
	"strconv"

	"taskmgr-re/internal/perf"
	"taskmgr-re/internal/process"
	"taskmgr-re/internal/services"
	"taskmgr-re/internal/startup"
	"taskmgr-re/internal/run"
	"taskmgr-re/internal/users"
)

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
	_ = json.NewEncoder(w).Encode(v)
}

func writeErr(w http.ResponseWriter, msg string, code int) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	http.Error(w, msg, code)
}

// parseParams merges query string and optional JSON body into a map[string]string.
func parseParams(r *http.Request) map[string]string {
	out := make(map[string]string)
	for k, vs := range r.URL.Query() {
		if len(vs) > 0 {
			out[k] = vs[0]
		}
	}
	if r.Method == http.MethodPost || r.Method == http.MethodPut {
		body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
		if err == nil && len(body) > 0 {
			var m map[string]any
			if json.Unmarshal(body, &m) == nil {
				for k, v := range m {
					switch t := v.(type) {
					case string:
						out[k] = t
					case float64:
						out[k] = strconv.FormatFloat(t, 'f', -1, 64)
					case bool:
						if t {
							out[k] = "1"
						} else {
							out[k] = "0"
						}
					default:
						b, _ := json.Marshal(t)
						out[k] = string(b)
					}
				}
			}
		}
	}
	return out
}

func atoi(s string) int {
	n, _ := strconv.Atoi(s)
	return n
}

// Handler registers all API routes (后端同级资源，无 UI).
// 在 Wails 中通过 Service Route: "/api" 挂载；开发模式直接用 http.ServeMux。
func Handler() http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			writeJSON(w, map[string]string{"ok": "1"})
			return
		}
		writeJSON(w, map[string]string{"ok": "1"})
	})

	// ----- processes -----
	mux.HandleFunc("/processes", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			writeJSON(w, map[string]string{"ok": "1"})
			return
		}
		writeJSON(w, process.List())
	})
	mux.HandleFunc("/processes/kill", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			writeJSON(w, map[string]string{"ok": "1"})
			return
		}
		p := parseParams(r)
		pid := atoi(p["pid"])
		root := p["root"] == "1" || p["root"] == "true"
		if root {
			writeJSON(w, map[string]string{"result": process.KillRoot(pid)})
			return
		}
		writeJSON(w, map[string]string{"result": process.Kill(pid)})
	})
	mux.HandleFunc("/processes/open-path", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			writeJSON(w, map[string]string{"ok": "1"})
			return
		}
		p := parseParams(r)
		pid := atoi(p["pid"])
		writeJSON(w, map[string]string{"result": process.OpenPath(pid)})
	})
	mux.HandleFunc("/processes/nice", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			writeJSON(w, map[string]string{"ok": "1"})
			return
		}
		p := parseParams(r)
		pid := atoi(p["pid"])
		nice := atoi(p["nice"])
		writeJSON(w, map[string]string{"result": process.SetNice(pid, nice)})
	})
	mux.HandleFunc("/processes/affinity", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			writeJSON(w, map[string]string{"ok": "1"})
			return
		}
		p := parseParams(r)
		pid := atoi(p["pid"])
		list := p["cpus"]
		if list == "" {
			list = p["mask"]
		}
		writeJSON(w, map[string]string{"result": process.SetAffinity(pid, list)})
	})
	mux.HandleFunc("/processes/efficiency", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			writeJSON(w, map[string]string{"ok": "1"})
			return
		}
		p := parseParams(r)
		pid := atoi(p["pid"])
		on := p["on"] != "0" && p["on"] != "false"
		writeJSON(w, map[string]string{"result": process.SetEfficiency(pid, on)})
	})
	mux.HandleFunc("/processes/kill-tree", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			writeJSON(w, map[string]string{"ok": "1"})
			return
		}
		p := parseParams(r)
		pid := atoi(p["pid"])
		writeJSON(w, map[string]string{"result": process.KillTree(pid)})
	})

	// ----- perf -----
	mux.HandleFunc("/perf/stats", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			writeJSON(w, map[string]string{"ok": "1"})
			return
		}
		writeJSON(w, perf.GetStats())
	})
	mux.HandleFunc("/perf/extra", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			writeJSON(w, map[string]string{"ok": "1"})
			return
		}
		writeJSON(w, perf.GetExtra())
	})

	// ----- startup -----
	mux.HandleFunc("/startup", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			writeJSON(w, map[string]string{"ok": "1"})
			return
		}
		writeJSON(w, startup.List())
	})
	mux.HandleFunc("/startup/enable", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			writeJSON(w, map[string]string{"ok": "1"})
			return
		}
		p := parseParams(r)
		path := p["path"]
		en := p["enabled"] != "0" && p["enabled"] != "false"
		writeJSON(w, map[string]string{"result": startup.SetEnabled(path, en)})
	})

	// ----- users -----
	mux.HandleFunc("/users", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			writeJSON(w, map[string]string{"ok": "1"})
			return
		}
		writeJSON(w, users.List())
	})
	mux.HandleFunc("/users/logout", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			writeJSON(w, map[string]string{"ok": "1"})
			return
		}
		p := parseParams(r)
		writeJSON(w, map[string]string{"result": users.Logout(p["name"])})
	})
	mux.HandleFunc("/users/manage", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			writeJSON(w, map[string]string{"ok": "1"})
			return
		}
		writeJSON(w, map[string]string{"result": users.OpenAccountSettings()})
	})

	// ----- services -----
	mux.HandleFunc("/services", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			writeJSON(w, map[string]string{"ok": "1"})
			return
		}
		writeJSON(w, services.List())
	})
	mux.HandleFunc("/services/action", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			writeJSON(w, map[string]string{"ok": "1"})
			return
		}
		p := parseParams(r)
		writeJSON(w, map[string]string{
			"result": services.Action(p["action"], p["unit"]),
		})
	})

	// ----- run new task -----
	mux.HandleFunc("/run", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			writeJSON(w, map[string]string{"ok": "1"})
			return
		}
		p := parseParams(r)
		admin := p["admin"] == "1" || p["admin"] == "true"
		writeJSON(w, map[string]string{"result": run.Open(p["cmd"], admin)})
	})
	mux.HandleFunc("/run/history", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			writeJSON(w, map[string]string{"ok": "1"})
			return
		}
		writeJSON(w, run.History())
	})
	mux.HandleFunc("/run/browse", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			writeJSON(w, map[string]string{"ok": "1"})
			return
		}
		path, err := run.Browse()
		if err != nil {
			writeJSON(w, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, map[string]string{"path": path})
	})
	mux.HandleFunc("/run/open-dialog", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodOptions {
			writeJSON(w, map[string]string{"ok": "1"})
			return
		}
		writeJSON(w, map[string]string{"result": run.OpenDialog()})
	})
	mux.HandleFunc("/run/move", func(w http.ResponseWriter, r *http.Request) {
		p := parseParams(r)
		dx, _ := strconv.Atoi(p["dx"])
		dy, _ := strconv.Atoi(p["dy"])
		run.MoveBy(dx, dy)
		writeJSON(w, map[string]string{"ok": "1"})
	})
	mux.HandleFunc("/run/quit", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]string{"ok": "1"})
		run.QuitDialog()
	})

		mux.HandleFunc("/open-url", func(w http.ResponseWriter, r *http.Request) {
		p := parseParams(r)
		writeJSON(w, map[string]string{"result": run.OpenURL(p["url"])})
	})
	mux.HandleFunc("/open-dir", func(w http.ResponseWriter, r *http.Request) {
		p := parseParams(r)
		writeJSON(w, map[string]string{"result": run.OpenDir(p["path"])})
	})
	mux.HandleFunc("/app/quit", func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]string{"ok": "1"})
		go func() {
			time.Sleep(50 * time.Millisecond)
			os.Exit(0)
		}()
	})

	return mux
}
