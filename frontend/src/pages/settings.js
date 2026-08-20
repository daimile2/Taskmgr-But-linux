/** 设置页 — 能做的生效，不能的 disabled */
import { setTopActions } from "../shell.js";

const KEY = "taskmgr-settings";

const DEFAULTS = {
  theme: "system",
  startPage: "processes",
  refreshRate: "normal", // high | normal | low | paused
  alwaysOnTop: false,
  minimizeOnUse: true,
  hideWhenMin: false,
  fullUsername: false,
  historyAll: false,
  effConfirm: true,
  dumpAbort: true,
  dumpVm: false,
  dumpUser: false,
};

export function loadSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
  } catch {
    return { ...DEFAULTS };
  }
}

function save(s) {
  localStorage.setItem(KEY, JSON.stringify(s));
  applyTheme(s.theme);
  window.dispatchEvent(new CustomEvent("taskmgr-settings", { detail: s }));
}

function applyTheme(theme) {
  document.body.classList.remove("theme-light", "theme-dark");
  if (theme === "light") document.body.classList.add("theme-light");
  else if (theme === "dark") document.body.classList.add("theme-dark");
  // system：不强制 class，跟系统
}

export function getRefreshMs() {
  const s = loadSettings();
  return { high: 500, normal: 1000, low: 2000, paused: 0 }[s.refreshRate] ?? 1000;
}

export function shouldConfirmEfficiency() {
  return !!loadSettings().effConfirm;
}

export function preferFullUsername() {
  return !!loadSettings().fullUsername;
}

function bind() {
  const s = loadSettings();
  document.querySelectorAll('input[name="theme"]').forEach((el) => {
    el.checked = el.value === s.theme;
    el.disabled = false;
    el.onchange = () => {
      const next = loadSettings();
      next.theme = el.value;
      save(next);
    };
  });

  const start = document.getElementById("set-start-page");
  if (start) {
    start.value = s.startPage || "processes";
    start.disabled = false;
    start.onchange = () => {
      const next = loadSettings();
      next.startPage = start.value;
      save(next);
    };
  }

  const rate = document.getElementById("set-refresh-rate");
  if (rate) {
    rate.value = s.refreshRate || "normal";
    rate.disabled = false;
    rate.onchange = () => {
      const next = loadSettings();
      next.refreshRate = rate.value;
      save(next);
    };
  }

  // 窗口管理：网页做不到 → 全部 disabled
  ["set-always-on-top", "set-minimize-use", "set-minimize-hide"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.disabled = true;
    el.checked = false;
    el.title = "浏览器环境无法控制窗口";
  });

  // 其它：完整用户名、效率确认可用；历史全部灰掉
  const full = document.getElementById("set-full-username");
  if (full) {
    full.disabled = false;
    full.checked = !!s.fullUsername;
    full.onchange = () => {
      const next = loadSettings();
      next.fullUsername = full.checked;
      save(next);
    };
  }
  const hist = document.getElementById("set-history-all");
  if (hist) {
    hist.disabled = true;
    hist.checked = false;
    hist.title = "应用历史记录页尚未实现";
  }
  const eff = document.getElementById("set-eff-confirm");
  if (eff) {
    eff.disabled = false;
    eff.checked = s.effConfirm !== false;
    eff.onchange = () => {
      const next = loadSettings();
      next.effConfirm = eff.checked;
      save(next);
    };
  }

  // 转储：Linux 无对应 → 全灰
  ["set-dump-abort", "set-dump-vm", "set-dump-vm-extra", "set-dump-user"].forEach((id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.disabled = true;
    el.title = "仅 Windows 内核转储，Linux 不可用";
  });
}

function ensureDom() {
  const host = document.getElementById("page-settings");
  if (!host) return;
  if (host.dataset.ready === "1") return;
  host.dataset.ready = "1";
  host.innerHTML = `
    <div class="settings-scroll">
      <div class="settings-inner">
      <div class="settings-section">
        <div class="settings-label">应用主题</div>
        <label class="settings-radio"><input type="radio" name="theme" value="light"> 浅色</label>
        <label class="settings-radio"><input type="radio" name="theme" value="dark"> 深色</label>
        <label class="settings-radio"><input type="radio" name="theme" value="system"> 使用系统设置</label>
      </div>
      <div class="settings-section">
        <div class="settings-label">默认起始页</div>
        <select id="set-start-page" class="settings-select">
          <option value="processes">进程</option>
          <option value="performance">性能</option>
          <option value="startup">启动应用</option>
          <option value="users">用户</option>
          <option value="details">详细信息</option>
          <option value="services">服务</option>
        </select>
      </div>
      <div class="settings-section">
        <div class="settings-label">实时更新速度</div>
        <select id="set-refresh-rate" class="settings-select">
          <option value="high">高 (0.5 秒)</option>
          <option value="normal">常规 (1 秒)</option>
          <option value="low">低 (2 秒)</option>
          <option value="paused">暂停</option>
        </select>
      </div>
      <div class="settings-section">
        <div class="settings-label">窗口管理</div>
        <label class="settings-check muted"><input type="checkbox" id="set-always-on-top"> 置于顶层</label>
        <label class="settings-check muted"><input type="checkbox" id="set-minimize-use"> 使用时最小化</label>
        <label class="settings-check muted"><input type="checkbox" id="set-minimize-hide"> 最小化时隐藏</label>
        <div class="settings-hint">浏览器内无法控制系统窗口</div>
      </div>
      <div class="settings-section">
        <div class="settings-label">其他选项</div>
        <label class="settings-check"><input type="checkbox" id="set-full-username"> 显示完整帐户名</label>
        <label class="settings-check muted"><input type="checkbox" id="set-history-all"> 显示所有进程的历史记录</label>
        <label class="settings-check"><input type="checkbox" id="set-eff-confirm"> 应用效率模式前询问我</label>
      </div>
      <div class="settings-section">
        <div class="settings-label">实时内核内存转储选项(高级)</div>
        <label class="settings-check muted"><input type="checkbox" id="set-dump-abort"> 如果内存不足，则中止</label>
        <label class="settings-check muted"><input type="checkbox" id="set-dump-vm"> 捕获虚拟机监控程序页面</label>
        <label class="settings-check muted"><input type="checkbox" id="set-dump-user"> 捕获用户页面</label>
        <div class="settings-hint">Windows 专用，Linux 不可用</div>
      </div>
    </div></div>
  `;
}

export function activate() {
  setTopActions("");
  ensureDom();
  bind();
  applyTheme(loadSettings().theme);
}

export function deactivate() {
  setTopActions("");
}

// 启动时应用主题
try { applyTheme(loadSettings().theme); } catch (e) {}
