import { api } from "../api.js";
import { getSearchQuery, onSearchChange } from "../components/searchbox.js";
import { setTopActions } from "../shell.js";
import { openRunDialog } from "../runDialog.js";
// header % via api.getStats
import { show as showMenu, hideAll } from "../components/ctxmenu.js";

let rows = [];
let sortKey = "cpu";
let sortDir = -1;

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

let selectedPid = null;

function fmtBytes(n) {
  n = Number(n) || 0;
  const u = ["B", "KB", "MB", "GB"];
  let i = 0, v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return (i === 0 ? Math.round(v) : v.toFixed(1)) + " " + u[i];
}
function escapeHtml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}


function niceToLevel(n) {
  n = Number(n);
  if (!Number.isFinite(n)) return "normal";
  if (n <= -15) return "realtime";
  if (n <= -10) return "high";
  if (n <= -5) return "abovenormal";
  if (n <= 0) return "normal";
  if (n <= 5) return "belownormal";
  return "low";
}
function levelToNice(id) {
  return ({
    realtime: -20,
    high: -10,
    abovenormal: -5,
    normal: 0,
    belownormal: 5,
    low: 10,
  })[id] ?? 0;
}
function detailsCtxItems(p) {
  const lvl = niceToLevel(p.nice);
  return [
    { id: "end", label: "结束任务(E)" },
    { id: "end-tree", label: "结束进程树(T)" },
    { id: "feedback", label: "提供反馈(B)", disabled: true },
    { sep: true },
    { id: "efficiency", label: "效率模式(M)" },
    {
      id: "priority",
      label: "设置优先级(P)",
      children: [
        { id: "prio:realtime", label: "实时(R)", checked: lvl === "realtime" },
        { id: "prio:high", label: "高(H)", checked: lvl === "high" },
        { id: "prio:abovenormal", label: "高于正常(A)", checked: lvl === "abovenormal" },
        { id: "prio:normal", label: "正常(N)", checked: lvl === "normal" },
        { id: "prio:belownormal", label: "低于正常(B)", checked: lvl === "belownormal" },
        { id: "prio:low", label: "低(L)", checked: lvl === "low" },
      ],
    },
    {
      id: "affinity",
      label: "设置相关性(F)",
      children: [
        { id: "aff:0", label: "仅 CPU 0" },
        { id: "aff:0-1", label: "CPU 0-1" },
        { id: "aff:all", label: "全部 CPU" },
      ],
    },
    { sep: true },
    { id: "waitchain", label: "分析等待链(A)", disabled: true },
    { id: "uac", label: "UAC 虚拟化(V)", disabled: true },
    { id: "dump", label: "创建内存转储文件(C)", disabled: true },
    { sep: true },
    { id: "open-path", label: "打开文件所在的位置(O)" },
    { id: "search", label: "在线搜索(N)" },
    { id: "props", label: "属性(R)" },
    { id: "goto-svc", label: "转到服务(S)", disabled: true },
  ];
}
async function detailsCtxAction(id, p) {
  if (!p || !p.pid) return;
  const pid = p.pid;
  try {
    if (id === "end") {
      if (api.killProcess) await api.killProcess(pid);
      else if (api.kill) await api.kill(pid);
      await refresh();
      return;
    }
    if (id === "end-tree") {
      // 后端若无树杀，退化为普通 kill
      if (api.killTree) await api.killTree(pid);
      else if (api.killProcess) await api.killProcess(pid);
      else if (api.kill) await api.kill(pid);
      await refresh();
      return;
    }
    if (id === "efficiency") {
      if (api.setEfficiency) await api.setEfficiency(pid, true);
      else if (api.efficiency) await api.efficiency(pid, true);
      await refresh();
      return;
    }
    if (id && id.startsWith("prio:")) {
      const nice = levelToNice(id.slice(5));
      if (api.setNice) await api.setNice(pid, nice);
      else await fetch("/api/processes/nice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pid, nice }),
      });
      await refresh();
      return;
    }
    if (id && id.startsWith("aff:")) {
      const spec = id.slice(4);
      await fetch("/api/processes/affinity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pid, spec }),
      }).catch(() => alert("相关性需要后端 taskset 支持"));
      return;
    }
    if (id === "open-path") {
      if (api.openPath) await api.openPath(pid);
      else await fetch("/api/processes/open-path", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pid }),
      });
      return;
    }
    if (id === "search") {
      const q = encodeURIComponent(p.name || String(pid));
      window.open("https://www.bing.com/search?q=" + q, "_blank");
      return;
    }
    if (id === "props") {
      alert(
        `名称: ${p.name || ""}\nPID: ${pid}\n用户: ${p.user || ""}\n状态: ${p.state || ""}\n` +
        `CPU: ${Number(p.cpu || 0).toFixed(1)}%\n内存: ${fmtBytes(p.memory)}\n` +
        `命令行: ${p.cmdline || ""}\n路径: ${p.exe || ""}`
      );
    }
  } catch (e) {
    console.error(e);
    alert(String(e.message || e));
  }
}

function sorted() {
  let list = rows.slice();
  const q = getSearchQuery();
  if (q) {
    list = list.filter((p) =>
      String(p.pid).includes(q) ||
      (p.name || "").toLowerCase().includes(q) ||
      (p.user || "").toLowerCase().includes(q) ||
      (p.state || "").toLowerCase().includes(q) ||
      (p.cmdline || "").toLowerCase().includes(q)
    );
  }
  list.sort((a, b) => {
    let va, vb;
    switch (sortKey) {
      case "name": va = (a.name || "").toLowerCase(); vb = (b.name || "").toLowerCase(); break;
      case "pid": va = Number(a.pid || 0); vb = Number(b.pid || 0); break;
      case "state": va = a.state || ""; vb = b.state || ""; break;
      case "user": va = (a.user || "").toLowerCase(); vb = (b.user || "").toLowerCase(); break;
      case "cpu": va = Number(a.cpu ?? 0); vb = Number(b.cpu ?? 0); break;
      case "memory": va = Number(a.memory ?? 0); vb = Number(b.memory ?? 0); break;
      case "cmdline": va = (a.cmdline || "").toLowerCase(); vb = (b.cmdline || "").toLowerCase(); break;
      default: va = Number(a.cpu ?? 0); vb = Number(b.cpu ?? 0);
    }
    if (typeof va === "string") {
      if (va < vb) return -1 * sortDir;
      if (va > vb) return 1 * sortDir;
      return 0;
    }
    return ((va || 0) - (vb || 0)) * sortDir;
  });
  return list;
}

function ensure() {
  const host = document.getElementById("page-details");
  if (!host) return null;
  if (!document.getElementById("tbl-details")) {
    host.innerHTML = `
      <div class="page-title">详细信息</div>
      <div class="table-wrap">
        <table class="grid" id="tbl-details">
          <thead>
            <tr>
              <th data-sort="name">名称</th>
              <th data-sort="pid">PID</th>
              <th data-sort="state">状态</th>
              <th data-sort="user">用户名</th>
              <th class="num" data-sort="cpu">CPU</th>
              <th class="num" data-sort="memory">内存</th>
              <th data-sort="cmdline">命令行</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>`;
    host.querySelectorAll("#tbl-details thead th[data-sort]").forEach((th) => {
      th.style.cursor = "pointer";
      th.addEventListener("click", () => {
        const k = th.dataset.sort;
        if (sortKey === k) sortDir = -sortDir;
        else { sortKey = k; sortDir = 1; }
        render();
      });
    });
  }
  return document.querySelector("#tbl-details tbody");
}

function render() {
  try { updateSortHeaders("#tbl-details"); } catch (e) {}

  const tb = ensure();
  if (!tb) return;
  const list = sorted();
  tb.innerHTML = "";
  for (const p of list) {
    const tr = document.createElement("tr");
    tr.dataset.pid = String(p.pid);
    if (p.pid === selectedPid) tr.classList.add("selected");
    const cpu = Number(p.cpu ?? 0);
    tr.innerHTML = `
      <td>${escapeHtml(p.name)}</td>
      <td class="num">${p.pid}</td>
      <td>${escapeHtml(p.state || "")}</td>
      <td>${escapeHtml(p.user || "")}</td>
      <td class="num">${cpu.toFixed(1)}%</td>
      <td class="num">${fmtBytes(p.memory)}</td>
      <td title="${escapeHtml(p.cmdline || "")}">${escapeHtml(p.cmdline || "")}</td>`;
    tr.addEventListener("click", () => {
      selectedPid = p.pid;
    const be = document.getElementById("btn-end-det");
    if (be) be.disabled = !selectedPid;
      tb.querySelectorAll("tr").forEach((r) => r.classList.remove("selected"));
      tr.classList.add("selected");
    });
    tr.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      selectedPid = p.pid;
      const be = document.getElementById("btn-end-det");
      if (be) be.disabled = false;
      showMenu(e.clientX, e.clientY, detailsCtxItems(p), (id) => detailsCtxAction(id, p));
    });
    tb.appendChild(tr);
  }
}

async function refresh() {
  try {
    const list = await api.getProcesses();
    rows = Array.isArray(list) ? list : [];

  render();
  } catch (e) {
    console.error(e);
  }
}

export async function activate() {
  if (!window._detSearchUnsub) {
    window._detSearchUnsub = onSearchChange(() => { try { render(); } catch (e) {} });
  }
  setTopActions(`
    <button type="button" class="btn btn-tool" id="btn-run-det"><img class="btn-ico" src="/src/icons/new.png" width="16" height="16" alt=""/>运行新任务</button>
    <span class="act-sep"></span>
    <button type="button" class="btn btn-tool" id="btn-end-det" disabled><img class="btn-ico" src="/src/icons/stop.png" width="16" height="16" alt=""/>结束任务</button>
  `);

  document.getElementById("btn-run-det")?.addEventListener("click", () => {
    openRunDialog();
  });
  document.getElementById("btn-end-det")?.addEventListener("click", async () => {
    if (typeof selectedPid === "undefined" || !selectedPid) return;
    try {
      if (typeof killProcess === "function") await killProcess(selectedPid);
      else await fetch("/api/process/kill", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pid: selectedPid }) });
    } catch (e) { console.error(e); }
    if (typeof refresh === "function") refresh();
  });



  setTimeout(() => { try { updateSortHeaders("#tbl-details"); } catch (e) {} }, 0);
  ensure();
  await refresh();
  setTimeout(refresh, 600);
  if (window._detTimer) clearInterval(window._detTimer);
  window._detTimer = setInterval(refresh, 1500);
}
export function deactivate() { try { hideAll(); } catch (e) {} setTopActions(""); }
