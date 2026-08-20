/** 服务 — 名称 | PID | 描述 | 状态 | 加载 */
import { api } from "../api.js";
import { getSearchQuery, onSearchChange } from "../components/searchbox.js";
import { show as showCtx, hideAll } from "../components/ctxmenu.js";
import { setTopActions } from "../shell.js";
import { openRunDialog } from "../runDialog.js";

let rows = [];
let selected = null;
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

let bound = false;

function escapeHtml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function cmp(a, b) {
  const get = (x) => {
    switch (sortKey) {
      case "pid": return Number(x.pid || 0);
      case "name": return String(x.name || "").toLowerCase();
      case "description": return String(x.description || "").toLowerCase();
      case "active": return String(x.active || "").toLowerCase();
      case "load": return String(x.load || "").toLowerCase();
      default: return String(x.name || "").toLowerCase();
    }
  };
  const va = get(a), vb = get(b);
  if (typeof va === "string") {
    if (va < vb) return -1 * sortDir;
    if (va > vb) return 1 * sortDir;
    return 0;
  }
  return ((va || 0) - (vb || 0)) * sortDir;
}

function ensureTable() {
  const host = document.getElementById("page-services");
  if (!host) return null;
  if (!document.getElementById("tbl-services")) {
    host.innerHTML = `
      <div class="page-title">服务</div>
      <div class="table-wrap">
        <table class="grid" id="tbl-services">
          <thead>
            <tr>
              <th data-sort="name">名称</th>
              <th data-sort="pid">PID</th>
              <th data-sort="description">描述</th>
              <th data-sort="active">状态</th>
              <th data-sort="load">加载</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>`;
  }
  if (!bound) {
    bound = true;
    document.querySelectorAll("#tbl-services thead th[data-sort]").forEach((th) => {
      th.style.cursor = "pointer";
      th.addEventListener("click", () => {
        const k = th.dataset.sort;
        if (sortKey === k) sortDir = -sortDir;
        else { sortKey = k; sortDir = 1; }
        render();
      });
    });
  }
  return document.querySelector("#tbl-services tbody");
}

function render() {
  try { updateSortHeaders("#tbl-services"); } catch (e) {}

  const tb = ensureTable();
  if (!tb) return;
  const q = getSearchQuery();
  let list = rows.slice();
  if (q) {
    list = list.filter((s) =>
      (s.name || "").toLowerCase().includes(q) ||
      (s.description || "").toLowerCase().includes(q) ||
      (s.active || "").toLowerCase().includes(q) ||
      (s.sub || "").toLowerCase().includes(q) ||
      (s.load || "").toLowerCase().includes(q) ||
      String(s.pid || "").includes(q)
    );
  }
  list.sort(cmp);
  tb.innerHTML = "";
  for (const s of list) {
    const name = s.name || "";
    const active = String(s.active || "").toLowerCase();
    const running = active === "active";
    const pid = Number(s.pid) > 0 ? String(s.pid) : "—";
    const tr = document.createElement("tr");
    if (selected === name) tr.classList.add("selected");
    tr.innerHTML = `
      <td title="${escapeHtml(name)}">${escapeHtml(name)}</td>
      <td class="num">${escapeHtml(pid)}</td>
      <td title="${escapeHtml(s.description || "")}">${escapeHtml(s.description || "")}</td>
      <td>${escapeHtml(s.active || "")}${s.sub ? " (" + escapeHtml(s.sub) + ")" : ""}</td>
      <td>${escapeHtml(s.load || "")}</td>`;
    tr.addEventListener("click", () => {
      selected = name;
      tb.querySelectorAll("tr").forEach((r) => r.classList.remove("selected"));
      tr.classList.add("selected");
      sync(running);
    });
    tr.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      selected = name;
      tb.querySelectorAll("tr").forEach((r) => r.classList.remove("selected"));
      tr.classList.add("selected");
      showCtx(e.clientX, e.clientY, [
        { id: "start", label: "开始(S)", disabled: running },
        { id: "stop", label: "停止(T)", disabled: !running },
        { id: "restart", label: "重新启动(R)", disabled: !running },
        { sep: true },
        { id: "search", label: "在线搜索(O)" },
      ], async (id) => {
        if (id === "start" || id === "stop" || id === "restart") {
          await api.serviceAction(id, name);
          await refresh();
        } else if (id === "search") {
          window.open("https://www.bing.com/search?q=" + encodeURIComponent(name), "_blank");
        }
      });
    });
    tb.appendChild(tr);
  }
}

function sync(running) {
  const st = document.getElementById("btn-svc-start");
  const sp = document.getElementById("btn-svc-stop");
  const rs = document.getElementById("btn-svc-restart");
  if (st) st.disabled = !selected || running;
  if (sp) sp.disabled = !selected || !running;
  if (rs) rs.disabled = !selected || !running;
}

export function activate() {
  if (!window._svcSearchUnsub) {
    window._svcSearchUnsub = onSearchChange(() => { try { render(); } catch (e) {} });
  }

  setTopActions(`
    <button type="button" class="btn btn-tool" id="btn-run-svc"><img class="btn-ico" src="/src/icons/new.png" width="16" height="16" alt=""/>运行新任务</button>
    <span class="act-sep"></span>
    <button type="button" class="btn btn-tool" id="btn-svc-start" disabled><img class="btn-ico" src="/src/icons/start-service.svg" width="16" height="16" alt=""/>启动</button>
    <button type="button" class="btn btn-tool" id="btn-svc-stop" disabled><img class="btn-ico" src="/src/icons/stop-service.svg" width="16" height="16" alt=""/>停止</button>
    <button type="button" class="btn btn-tool" id="btn-svc-restart" disabled><img class="btn-ico" src="/src/icons/reboot-service.svg" width="16" height="16" alt=""/>重启</button>
  `);
  document.getElementById("btn-run-svc")?.addEventListener("click", () => {
    openRunDialog();
  });
  setTimeout(() => { try { updateSortHeaders("#tbl-services"); } catch (e) {} }, 0);
  bound = false;
  const act = async (a) => {
    if (!selected) return;
    await api.serviceAction(a, selected);
    await refresh();
  };
  document.getElementById("btn-svc-start")?.addEventListener("click", () => act("start"));
  document.getElementById("btn-svc-stop")?.addEventListener("click", () => act("stop"));
  document.getElementById("btn-svc-restart")?.addEventListener("click", () => act("restart"));
  ensureTable();
  refresh();
}

export async function refresh() {
  rows = await api.services();
  if (!Array.isArray(rows)) rows = [];
  render();
}

export function deactivate() { try { hideAll(); } catch (e) {} setTopActions(""); }
