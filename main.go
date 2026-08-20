package main

import (
	"context"
	"embed"
	"log/slog"
	"net/http"
	"os"
	"strings"

	"taskmgr-re/internal/api"

	"github.com/wailsapp/wails/v3/pkg/application"
)

//go:embed all:frontend
var assets embed.FS

// APIService mounts the existing HTTP API under /api for Wails.
type APIService struct {
	handler http.Handler
}

func NewAPIService() *APIService {
	return &APIService{handler: api.Handler()}
}

func (s *APIService) ServiceName() string {
	return "TaskMgr API"
}

func (s *APIService) ServiceStartup(ctx context.Context, options application.ServiceOptions) error {
	return nil
}

func (s *APIService) ServiceShutdown(ctx context.Context) error {
	return nil
}

// ServeHTTP implements http.Handler.
func (s *APIService) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	if strings.HasPrefix(path, "/api/") {
		r2 := r.Clone(r.Context())
		r2.URL.Path = strings.TrimPrefix(path, "/api")
		if r2.URL.Path == "" {
			r2.URL.Path = "/"
		}
		s.handler.ServeHTTP(w, r2)
		return
	}
	s.handler.ServeHTTP(w, r)
}

func isRunDialog() bool {
	for _, a := range os.Args[1:] {
		if a == "--run-dialog" {
			return true
		}
	}
	return false
}

func main() {
	if isRunDialog() {
		runDialogApp()
		return
	}
	mainApp()
}

func baseApp() *application.App {
	return application.New(application.Options{
		Name:        "taskmgr-re",
		Description: "Linux 任务管理器（Wails v3）",
		LogLevel:    slog.LevelInfo,
		Services: []application.Service{
			application.NewServiceWithOptions(NewAPIService(), application.ServiceOptions{
				Route: "/api",
			}),
		},
		Assets: application.AssetOptions{
			Handler: application.AssetFileServerFS(assets),
		},
		Mac: application.MacOptions{
			ApplicationShouldTerminateAfterLastWindowClosed: true,
		},
	})
}

func mainApp() {
	app := baseApp()
	app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:            "任务管理器",
		Width:            1100,
		Height:           700,
		MinWidth:         400,
		MinHeight:        100,
		Frameless:        true,
		BackgroundColour: application.NewRGB(30, 30, 30),
		URL:              "/",
	})
	if err := app.Run(); err != nil {
		slog.Error("app run failed", "err", err)
		os.Exit(1)
	}
}

// runDialogApp: 独立进程、无边框、固定大小、白色「新建任务」窗口
func runDialogApp() {
	app := baseApp()
	app.Window.NewWithOptions(application.WebviewWindowOptions{
		Title:            "新建任务",
		Width:            420,
		Height:           240,
		MinWidth:         420,
		MinHeight:        240,
		MaxWidth:         420,
		MaxHeight:        240,
		Frameless:        true,
		BackgroundColour: application.NewRGB(255, 255, 255),
		URL:              "/run.html",
	})
	if err := app.Run(); err != nil {
		slog.Error("run-dialog failed", "err", err)
		os.Exit(1)
	}
}
