/** 独立「新建任务」窗口 — 拖动与主窗口相同（CSS --wails-draggable） */

async function api(path, opts = {}) {
  const r = await fetch("/api" + path, {
    method: opts.method || "GET",
    headers: { "Content-Type": "application/json" },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  return r.json().catch(() => ({}));
}

function closeWindow() {
  try {
    const w = window.wails && window.wails.Window;
    if (w?.Close) {
      w.Close();
      return;
    }
  } catch (_) {}
  fetch("/api/run/quit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  }).catch(() => {});
}

async function loadHistory() {
  const list = await api("/run/history");
  const box = document.getElementById("hist-list");
  box.innerHTML = "";
  const arr = Array.isArray(list) ? list : [];
  if (!arr.length) {
    const d = document.createElement("div");
    d.textContent = "（无历史记录）";
    d.style.color = "#888";
    d.style.cursor = "default";
    box.appendChild(d);
    return;
  }
  for (const s of arr) {
    const d = document.createElement("div");
    d.textContent = s;
    d.title = s;
    d.addEventListener("click", () => {
      document.getElementById("cmd").value = s;
      box.classList.remove("show");
      document.getElementById("cmd").focus();
    });
    box.appendChild(d);
  }
}

async function doRun() {
  const cmd = document.getElementById("cmd").value.trim();
  if (!cmd) {
    document.getElementById("cmd").focus();
    return;
  }
  const admin = document.getElementById("admin").checked;
  await api("/run", { method: "POST", body: { cmd, admin: admin ? "1" : "0" } });
  closeWindow();
}

async function doBrowse() {
  try {
    const res = await api("/run/browse", { method: "POST", body: {} });
    if (res && res.path) {
      document.getElementById("cmd").value = res.path;
      document.getElementById("cmd").focus();
    }
  } catch (_) {}
}

function bind() {
  document.getElementById("btn-ok").addEventListener("click", doRun);
  document.getElementById("btn-cancel").addEventListener("click", closeWindow);
  document.getElementById("btn-x").addEventListener("click", (e) => {
    e.stopPropagation();
    closeWindow();
  });
  document.getElementById("btn-browse").addEventListener("click", doBrowse);
  document.getElementById("btn-hist").addEventListener("click", async (e) => {
    e.stopPropagation();
    const box = document.getElementById("hist-list");
    if (!box.classList.contains("show")) {
      await loadHistory();
      box.classList.add("show");
    } else {
      box.classList.remove("show");
    }
  });
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".combo")) {
      document.getElementById("hist-list").classList.remove("show");
    }
  });
  document.getElementById("cmd").addEventListener("keydown", (e) => {
    if (e.key === "Enter") doRun();
    if (e.key === "Escape") closeWindow();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeWindow();
  });
  loadHistory();
  document.getElementById("cmd").focus();
}

bind();
