/** 启动应用 — 对齐 Win */
import { api } from "../api.js";
import { getSearchQuery, onSearchChange } from "../components/searchbox.js";
import { show as showCtx, hideAll } from "../components/ctxmenu.js";
import { setTopActions } from "../shell.js";
import { openRunDialog } from "../runDialog.js";

let rows = [];

let sortKey = "name";
let sortDir = 1;

function updateSortHeaders(tableSel) {
  const table = document.querySelector(tableSel);
  if (!table) return;
  table.querySelectorAll("thead th[data-sort]").forEach((th) => {
    th.classList.remove("sort-asc", "sort-desc");
    if (th.dataset.sort === sortKey) {
      th.classList.add(sortDir > 0 ? "sort-asc" : "sort-desc");
    }
    // 有 .big 的列：保证左侧有 mark 节点
    if (th.classList.contains("num") && th.querySelector(".big")) {
      if (!th.querySelector(".sort-mark")) {
        const m = document.createElement("span");
        m.className = "sort-mark";
        th.insertBefore(m, th.firstChild);
      }
    }
  });
}

function bindSort(tableSel) {
  const table = document.querySelector(tableSel);
  if (!table || table._sortBound) return;
  table._sortBound = true;
  table.querySelectorAll("thead th[data-sort]").forEach((th) => {
    th.style.cursor = "pointer";
    th.addEventListener("click", () => {
      const k = th.dataset.sort;
      if (sortKey === k) sortDir = -sortDir;
      else { sortKey = k; sortDir = 1; }
      try { render(); } catch (e) { console.error(e); }
    });
  });
}
function cmp(a, b, key) {
  let va, vb;
  switch (key) {
    case "name": case "user": case "status": case "state": case "unit": case "desc":
    case "exec": case "path": case "load": case "active": case "sub":
      va = String(a[key] ?? a.Name ?? a.name ?? "").toLowerCase();
      vb = String(b[key] ?? b.Name ?? b.name ?? "").toLowerCase();
      if (va < vb) return -1 * sortDir;
      if (va > vb) return 1 * sortDir;
      return 0;
    case "pid":
      va = Number(a.pid ?? a.PID ?? a.mainPid ?? a.MainPID ?? 0);
      vb = Number(b.pid ?? b.PID ?? b.mainPid ?? b.MainPID ?? 0);
      break;
    case "cpu": va = Number(a.cpu ?? 0); vb = Number(b.cpu ?? 0); break;
    case "memory": case "mem":
      va = Number(a.memory ?? a.mem ?? 0); vb = Number(b.memory ?? b.mem ?? 0); break;
    case "count": case "processCount":
      va = Number(a.processCount ?? a.count ?? 0); vb = Number(b.processCount ?? b.count ?? 0); break;
    case "enabled":
      va = a.enabled ? 1 : 0; vb = b.enabled ? 1 : 0; break;
    default:
      va = a[key]; vb = b[key];
      if (typeof va === "string") {
        va = va.toLowerCase(); vb = String(vb ?? "").toLowerCase();
        if (va < vb) return -1 * sortDir;
        if (va > vb) return 1 * sortDir;
        return 0;
      }
      va = Number(va) || 0; vb = Number(vb) || 0;
  }
  return ((va || 0) - (vb || 0)) * sortDir;
}

let selectedPath = null;

function escapeHtml(s) {
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
}

function render() {
  try { updateSortHeaders("#tbl-startup"); } catch (e) {}

  try { rows = (rows || []).slice().sort((a, b) => cmp(a, b, sortKey)); } catch (e) {}

  const host = document.getElementById("page-startup");
  if (!host) return;
  host.innerHTML = `
    <div class="page-title">启动应用</div>
    <div class="table-wrap"><table class="grid">
      <thead><tr><th data-sort="name" style="cursor:pointer">名称</th><th data-sort="enabled" style="cursor:pointer">状态</th><th data-sort="exec" style="cursor:pointer">命令</th><th data-sort="path" style="cursor:pointer">路径</th></tr></thead>
      <tbody></tbody>
    </table></div>`;
  const tb = host.querySelector("tbody");
  const q = getSearchQuery();
  const list = !q ? rows : rows.filter((a) =>
    (a.name || "").toLowerCase().includes(q) ||
    (a.exec || "").toLowerCase().includes(q) ||
    (a.path || "").toLowerCase().includes(q) ||
    (a.comment || "").toLowerCase().includes(q)
  );
  for (const a of list) {
    const tr = document.createElement("tr");
    if (a.path === selectedPath) tr.classList.add("selected");
    tr.innerHTML = `
      <td>${escapeHtml(a.name)}</td>
      <td>${a.enabled ? "已启用" : "已禁用"}</td>
      <td title="${escapeHtml(a.exec)}">${escapeHtml(a.exec)}</td>
      <td title="${escapeHtml(a.path)}">${escapeHtml(a.path)}</td>`;
    tr.addEventListener("click", () => {
      selectedPath = a.path;
      tb.querySelectorAll("tr").forEach((r) => r.classList.remove("selected"));
      tr.classList.add("selected");
      syncBtns(a.enabled);
    });
    tr.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      selectedPath = a.path;
      tb.querySelectorAll("tr").forEach((r) => r.classList.remove("selected"));
      tr.classList.add("selected");
      showCtx(e.clientX, e.clientY, [
        { id: "toggle", label: a.enabled ? "禁用(D)" : "启用(E)" },
        { sep: true },
        { id: "open", label: "打开文件所在的位置(O)" },
        { id: "search", label: "在线搜索(S)" },
        { id: "props", label: "属性(I)" },
      ], async (id) => {
        if (id === "toggle") {
          await api.setStartup(a.path, !a.enabled);
          await refresh();
        } else if (id === "open") {
          const dir = (a.path || "").replace(/\/[^/]+$/, "") || "/";
          window.open("file://" + dir);
        } else if (id === "search") {
          window.open("https://www.bing.com/search?q=" + encodeURIComponent(a.name), "_blank");
        } else if (id === "props") {
          alert(`名称: ${a.name}\n状态: ${a.enabled ? "已启用" : "已禁用"}\n命令: ${a.exec}\n路径: ${a.path}`);
        }
      });
    });
    tb.appendChild(tr);
  }
}
function syncBtns(enabled) {
  const en = document.getElementById("btn-enable");
  const dis = document.getElementById("btn-disable");
  if (en) en.disabled = !!enabled || !selectedPath;
  if (dis) dis.disabled = !enabled || !selectedPath;
}

export function activate() {
  if (!window._startupSearchUnsub) {
    window._startupSearchUnsub = onSearchChange(() => { try { render(); } catch (e) {} });
  }

  setTopActions(`
    <button type="button" class="btn btn-tool" id="btn-run-start"><img class="btn-ico" src="/src/icons/new.png" width="16" height="16" alt=""/>运行新任务</button>
    <span class="act-sep"></span>
    <button type="button" class="btn btn-tool" id="btn-enable" disabled><img class="btn-ico" src="/src/icons/enable.png" width="16" height="16" alt=""/>启用</button>
    <button type="button" class="btn btn-tool" id="btn-disable" disabled><img class="btn-ico" src="/src/icons/stop.png" width="16" height="16" alt=""/>禁用</button>
    <button type="button" class="btn btn-tool" id="btn-props-start" disabled><img class="btn-ico" src="/src/icons/attribute.png" width="16" height="16" alt=""/>属性</button>
  `);

  document.getElementById("btn-run-start")?.addEventListener("click", () => {
    openRunDialog();
  });


  setTimeout(() => { try { updateSortHeaders("#tbl-startup"); } catch (e) {} }, 0);
  /* top actions with icons already set */
  document.getElementById("btn-enable")?.addEventListener("click", async () => {
    if (!selectedPath) return;
    await api.setStartup(selectedPath, true);
    await refresh();
  });
  document.getElementById("btn-disable")?.addEventListener("click", async () => {
    if (!selectedPath) return;
    await api.setStartup(selectedPath, false);
    await refresh();
  });
  refresh();

  // more menu
  (function(){
    const host = document.getElementById("top-actions");
    if (!host || host.querySelector("#btn-more-startup")) return;
    const b = document.createElement("button");
    b.type = "button"; b.className = "btn"; b.id = "btn-more-startup"; b.textContent = "⋯";
    host.appendChild(b);
    b.addEventListener("click", (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      showCtx(r.left, r.bottom + 4, [
      { id: "open", label: "打开文件位置" },
      { id: "search", label: "在线搜索" },
    ], async (id) => {
        const path = selectedPath;
        const a = rows.find(x => x.path === path);
        if (id === "open" && a) {
          const dir = (a.path || "").replace(/\/[^/]+$/, "") || "/";
          window.open("file://" + dir);
        } else if (id === "search" && a) {
          window.open("https://www.bing.com/search?q=" + encodeURIComponent(a.name), "_blank");
        }
      });
    });
  })();
}

export async function refresh() {
  rows = await api.startup();
  if (!Array.isArray(rows)) rows = [];
  render();
}
export function deactivate() { try { hideAll(); } catch (e) {} setTopActions(""); }
