/** 壳：侧栏 + 自定义标题栏（无边框窗口控制） */
let onNavigate = () => {};

function bindWindowControls() {
  const min = document.getElementById("btn-min");
  const max = document.getElementById("btn-max");
  const close = document.getElementById("btn-close");

  const win = () => (window.wails && window.wails.Window) ? window.wails.Window : null;

  min?.addEventListener("click", (e) => {
    e.stopPropagation();
    try { win()?.Minimise?.(); } catch (err) { console.warn(err); }
  });

  max?.addEventListener("click", async (e) => {
    e.stopPropagation();
    try {
      const w = win();
      if (!w) return;
      if (typeof w.IsMaximised === "function") {
        const maximised = await w.IsMaximised();
        if (maximised) w.UnMaximise?.();
        else w.Maximise?.();
      } else {
        w.Maximise?.();
        w.ToggleMaximise?.();
      }
    } catch (err) {
      console.warn(err);
    }
  });

  close?.addEventListener("click", (e) => {
    e.stopPropagation();
    // 关闭按钮 = 退出整个任务管理器进程（不只关窗口）
    try {
      const w = win();
      if (window.wails?.Quit) { window.wails.Quit(); return; }
      if (window.wails?.App?.Quit) { window.wails.App.Quit(); return; }
      if (w?.Close) w.Close();
    } catch (err) { console.warn(err); }
    // 兜底：后端退出进程
    fetch("/api/app/quit", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => {});
  });

  // 双击标题栏最大化/还原
  document.getElementById("titlebar")?.addEventListener("dblclick", async (e) => {
    if (e.target.closest("button, input, a, .search-wrap, .window-controls")) return;
    try {
      const w = win();
      if (!w) return;
      if (typeof w.IsMaximised === "function") {
        const maximised = await w.IsMaximised();
        if (maximised) w.UnMaximise?.();
        else w.Maximise?.();
      } else {
        w.ToggleMaximise?.() || w.Maximise?.();
      }
    } catch (err) {}
  });
}

const COMPACT_BREAKPOINT = 780;

function isCompact() {
  return document.body.classList.contains("compact-nav");
}

function updateCompactMode() {
  const compact = window.innerWidth < COMPACT_BREAKPOINT;
  const was = isCompact();
  document.body.classList.toggle("compact-nav", compact);
  const sidebar = document.getElementById("sidebar");
  if (sidebar) {
    if (compact) {
      // 进入窄窗：侧栏默认隐藏，清除折叠态避免冲突
      sidebar.classList.remove("collapsed");
      if (!was) sidebar.classList.remove("overlay-open");
    } else {
      // 回到宽窗：关闭浮层与搜索展开
      sidebar.classList.remove("overlay-open");
      document.getElementById("nav-backdrop")?.classList.remove("show");
      document.body.classList.remove("search-expanded");
    }
  }
  // 继续缩小或离开紧凑时收起展开的搜索框
  if (!compact) {
    document.body.classList.remove("search-expanded");
  }
  syncBackdrop();
}

function toggleSearchExpand() {
  if (!isCompact()) return; // 宽窗搜索框始终展开，无需切换
  const on = !document.body.classList.contains("search-expanded");
  document.body.classList.toggle("search-expanded", on);
  if (on) {
    requestAnimationFrame(() => document.getElementById("search")?.focus());
  }
}

function syncBackdrop() {
  let bd = document.getElementById("nav-backdrop");
  if (!bd) {
    bd = document.createElement("div");
    bd.id = "nav-backdrop";
    bd.className = "nav-backdrop";
    document.getElementById("app")?.appendChild(bd);
    bd.addEventListener("click", () => closeOverlayNav());
  }
  const open = isCompact() && document.getElementById("sidebar")?.classList.contains("overlay-open");
  bd.classList.toggle("show", !!open);
}

function closeOverlayNav() {
  document.getElementById("sidebar")?.classList.remove("overlay-open");
  syncBackdrop();
}

function toggleSidebar() {
  const sidebar = document.getElementById("sidebar");
  if (!sidebar) return;
  if (isCompact()) {
    // 窄窗：浮层开关（盖在内容上，不挤布局）
    sidebar.classList.toggle("overlay-open");
    sidebar.classList.remove("collapsed");
    syncBackdrop();
  } else {
    // 宽窗：仅图标折叠（原有行为）
    sidebar.classList.remove("overlay-open");
    sidebar.classList.toggle("collapsed");
    syncBackdrop();
  }
}

export function setViewPage(page) {
  document.body.classList.toggle("view-performance", page === "performance");
}

export function initShell(navigateCb) {
  onNavigate = navigateCb || (() => {});
  document.querySelectorAll(".nav-item[data-page]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const page = btn.dataset.page;
      document.querySelectorAll(".nav-item").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      document.querySelectorAll(".page").forEach((p) => p.classList.remove("active"));
      const el = document.getElementById("page-" + page);
      if (el) el.classList.add("active");
      setPageTitle(page);
      setViewPage(page);
      // 窄窗点导航后收起浮层
      if (isCompact()) closeOverlayNav();
      onNavigate(page);
    });
  });
  document.getElementById("btn-sidebar-toggle")?.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleSidebar();
  });
  document.getElementById("btn-sidebar-toggle-title")?.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleSidebar();
  });
  window.addEventListener("resize", updateCompactMode);
  updateCompactMode();
  setViewPage(currentPage());
  bindWindowControls();

  document.getElementById("btn-search-toggle")?.addEventListener("click", (e) => {
    e.stopPropagation();
    toggleSearchExpand();
  });
  // 点击标题栏其他区域时收起搜索
  document.getElementById("titlebar")?.addEventListener("click", (e) => {
    if (!document.body.classList.contains("search-expanded")) return;
    if (e.target.closest("#search-wrap, #btn-search-toggle, #search")) return;
    document.body.classList.remove("search-expanded");
  });
  // Escape 收起
  document.getElementById("search")?.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && document.body.classList.contains("search-expanded")) {
      document.body.classList.remove("search-expanded");
      e.target.blur();
    }
  });
}

const PAGE_TITLES = {
  processes: "进程",
  performance: "性能",
  history: "应用历史记录",
  startup: "启动应用",
  users: "用户",
  details: "详细信息",
  services: "服务",
  settings: "设置",
};

export function setPageTitle(page) {
  const el = document.getElementById("page-title-text");
  if (el) el.textContent = PAGE_TITLES[page] || page || "";
}

export function setTopActions(html) {
  const host = document.getElementById("top-actions");
  if (!host) {
    console.warn("top-actions missing");
    return;
  }
  host.innerHTML = html || "";
}

export function currentPage() {
  const a = document.querySelector(".nav-item.active");
  return a?.dataset.page || "processes";
}
