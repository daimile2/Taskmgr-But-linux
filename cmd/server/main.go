package main

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"taskmgr-re/internal/api"
)

func main() {
	addr := "127.0.0.1:17888"
	if v := os.Getenv("TASKMGR_ADDR"); v != "" {
		addr = v
	}
	front := os.Getenv("TASKMGR_FRONTEND")
	if front == "" {
		if _, err := os.Stat("frontend"); err == nil {
			front = "frontend"
		} else if _, err := os.Stat("../../frontend"); err == nil {
			front = "../../frontend"
		} else {
			front = "frontend"
		}
	}
	front, _ = filepath.Abs(front)

	apiMux := api.Handler()
	root := http.NewServeMux()
	// 兼容旧前端：把 /api/* 转到相对路径的 handler
	root.HandleFunc("/api/", func(w http.ResponseWriter, r *http.Request) {
		r2 := r.Clone(r.Context())
		r2.URL.Path = strings.TrimPrefix(r.URL.Path, "/api")
		if r2.URL.Path == "" {
			r2.URL.Path = "/"
		}
		apiMux.ServeHTTP(w, r2)
	})
	root.Handle("/", http.FileServer(http.Dir(front)))

	fmt.Println("taskmgr-re (HTTP 开发模式) listening on http://" + addr)
	fmt.Println("frontend dir:", front)
	if err := http.ListenAndServe(addr, root); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
