package startup

import (
	"os"
	"path/filepath"
	"strings"
)

// App is one autostart entry.
type App struct {
	Name    string `json:"name"`
	Exec    string `json:"exec"`
	Path    string `json:"path"`
	Enabled bool   `json:"enabled"`
	Comment string `json:"comment"`
}

func autostartDir() string {
	home, _ := os.UserHomeDir()
	return filepath.Join(home, ".config", "autostart")
}

func parseDesktop(path string) App {
	b, err := os.ReadFile(path)
	if err != nil {
		return App{Path: path}
	}
	a := App{Path: path, Enabled: true}
	for _, line := range strings.Split(string(b), "\n") {
		line = strings.TrimSpace(line)
		switch {
		case strings.HasPrefix(line, "Name="):
			a.Name = strings.TrimPrefix(line, "Name=")
		case strings.HasPrefix(line, "Exec="):
			a.Exec = strings.TrimPrefix(line, "Exec=")
		case strings.HasPrefix(line, "Comment="):
			a.Comment = strings.TrimPrefix(line, "Comment=")
		case line == "Hidden=true" || line == "X-GNOME-Autostart-enabled=false":
			a.Enabled = false
		case line == "Hidden=false" || line == "X-GNOME-Autostart-enabled=true":
			a.Enabled = true
		}
	}
	if a.Name == "" {
		a.Name = filepath.Base(path)
	}
	return a
}

// List reads ~/.config/autostart.
func List() []App {
	dir := autostartDir()
	ents, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	var out []App
	for _, e := range ents {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".desktop") {
			continue
		}
		out = append(out, parseDesktop(filepath.Join(dir, e.Name())))
	}
	return out
}

// SetEnabled toggles Hidden= and X-GNOME-Autostart-enabled= in the desktop file.
func SetEnabled(path string, enabled bool) string {
	path = filepath.Clean(path)
	dir := filepath.Clean(autostartDir())
	if path == "" || !strings.HasPrefix(path, dir) {
		return "路径无效"
	}
	b, err := os.ReadFile(path)
	if err != nil {
		return err.Error()
	}
	lines := strings.Split(string(b), "\n")
	wantHidden := "Hidden=false"
	wantGnome := "X-GNOME-Autostart-enabled=true"
	if !enabled {
		wantHidden = "Hidden=true"
		wantGnome = "X-GNOME-Autostart-enabled=false"
	}
	foundH, foundG := false, false
	for i, line := range lines {
		t := strings.TrimSpace(line)
		if strings.HasPrefix(t, "Hidden=") {
			lines[i] = wantHidden
			foundH = true
		}
		if strings.HasPrefix(t, "X-GNOME-Autostart-enabled=") {
			lines[i] = wantGnome
			foundG = true
		}
	}
	if !foundH {
		lines = append(lines, wantHidden)
	}
	if !foundG {
		lines = append(lines, wantGnome)
	}
	if err := os.WriteFile(path, []byte(strings.Join(lines, "\n")), 0644); err != nil {
		return err.Error()
	}
	if enabled {
		return "已启用"
	}
	return "已禁用"
}
