import { getProcesses, getStats, killProcess, setEfficiency } from "../api.js";
import { getSearchQuery, onSearchChange } from "../components/searchbox.js";
import { setTopActions } from "../shell.js";
import { openRunDialog } from "../runDialog.js";
import { show as showMenu, hideAll } from "../components/ctxmenu.js";

let processes = [];
let selectedPid = null;
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
 // 默认 CPU 降序
let sys = { cpuPercent: 0, memPercent: 0, memTotal: 0 };
let resourceDisplayMode = { mem: "val", disk: "val", net: "val" };

function fmtBytes(n) {
  n = Number(n) || 0;
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0, v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return (i === 0 ? Math.round(v) : v.toFixed(1)) + " " + u[i];
}
function maxDiskBps() {
  let m = 0;
  for (const x of processes) m = Math.max(m, Number(x.diskBps) || 0);
  return m;
}
function maxNetBps() {
  let m = 0;
  for (const x of processes) m = Math.max(m, Number(x.netBps) || 0);
  return m;
}
function fmtDisk(p) {
  const v = Number(p.diskBps ?? 0);
  if (resourceDisplayMode.disk === "pct") {
    const top = maxDiskBps();
    if (top <= 0) return "0.0%";
    return ((v / top) * 100).toFixed(1) + "%";
  }
  if (!v) return "0 MB/秒";
  if (v < 1024) return v.toFixed(0) + " B/秒";
  if (v < 1048576) return (v / 1024).toFixed(1) + " KB/秒";
  return (v / 1048576).toFixed(1) + " MB/秒";
}
function fmtNet(p) {
  const v = Number(p.netBps ?? 0);
  if (resourceDisplayMode.net === "pct") {
    const top = maxNetBps();
    if (top <= 0) return "0.0%";
    return ((v / top) * 100).toFixed(1) + "%";
  }
  if (!v) return "0 Mbps";
  return (v / 1e6).toFixed(2) + " Mbps";
}
function fmtMem(p) {
  if (resourceDisplayMode.mem === "pct" && sys.memTotal) {
    return ((Number(p.memory) || 0) / sys.memTotal * 100).toFixed(1) + "%";
  }
  return fmtBytes(p.memory);
}
function escapeHtml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function filteredSorted() {
  let list = processes.slice();
  const q = getSearchQuery();
  if (q) {
    list = list.filter((p) =>
      String(p.pid).includes(q) ||
      (p.name || "").toLowerCase().includes(q) ||
      (p.user || "").toLowerCase().includes(q) ||
      (p.cmdline || "").toLowerCase().includes(q)
    );
  }
  list.sort((a, b) => {
    let va, vb;
    switch (sortKey) {
      case "name": va = (a.name || "").toLowerCase(); vb = (b.name || "").toLowerCase(); break;
      case "cpu": va = Number(a.cpu ?? 0); vb = Number(b.cpu ?? 0); break;
      case "memory": va = Number(a.memory ?? 0); vb = Number(b.memory ?? 0); break;
      case "disk": va = Number(a.diskBps ?? 0); vb = Number(b.diskBps ?? 0); break;
      case "net": va = Number(a.netBps ?? 0); vb = Number(b.netBps ?? 0); break;
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

function ensureTable() {
  const host = document.getElementById("page-processes");
  if (!host) return null;
  if (!document.getElementById("tbl-proc")) {
    host.innerHTML = `
      <div class="page-title">进程</div>
      <div class="table-wrap">
        <table class="grid" id="tbl-proc">
          <thead>
            <tr>
              <th data-sort="name">名称</th>
              <th data-sort="state">状态</th>
              <th class="num" data-sort="cpu"><span class="big" data-h="cpu">0%</span><span class="sub">CPU</span></th>
              <th class="num" data-sort="memory"><span class="big" data-h="mem">0%</span><span class="sub">内存</span></th>
              <th class="num" data-sort="disk"><span class="big" data-h="disk">0%</span><span class="sub">磁盘</span></th>
              <th class="num" data-sort="net"><span class="big" data-h="net">0%</span><span class="sub">网络</span></th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>`;
    document.querySelectorAll("#tbl-proc thead th[data-sort]").forEach((th) => {
      th.style.cursor = "pointer";
      th.addEventListener("click", () => {
        const k = th.dataset.sort;
        if (sortKey === k) sortDir = -sortDir;
        else { sortKey = k; sortDir = 1; }
        render();
      });
    });
  }
  return document.querySelector("#tbl-proc tbody");
}

function updateHeader() {
  const set = (h, v) => {
    const el = document.querySelector('#tbl-proc [data-h="' + h + '"]');
    if (el) el.textContent = v;
  };
  set("cpu", Math.round(sys.cpuPercent || 0) + "%");
  set("mem", Math.round(sys.memPercent || 0) + "%");
  set("disk", "0%");
  set("net", "0%");
}

function render() {
  try { updateSortHeaders("#tbl-proc"); } catch (e) {}

  const tb = ensureTable();
  if (!tb) return;
  updateHeader();
  const list = filteredSorted();
  tb.innerHTML = "";
  for (const p of list) {
    const tr = document.createElement("tr");
    tr.dataset.pid = String(p.pid);
    if (p.pid === selectedPid) tr.classList.add("selected");
    const cpu = Number(p.cpu ?? 0);
    tr.innerHTML = `
      <td title="${escapeHtml(p.cmdline || "")}">${escapeHtml(p.name || "")}</td>
      <td></td>
      <td class="num">${cpu.toFixed(1)}%</td>
      <td class="num">${fmtMem(p)}</td>
      <td class="num">${fmtDisk(p)}</td>
      <td class="num">${fmtNet(p)}</td>`;
    tr.addEventListener("click", () => {
      selectedPid = p.pid;
    const be = document.getElementById("btn-end");
    if (be) be.disabled = !selectedPid;
      tb.querySelectorAll("tr").forEach((r) => r.classList.remove("selected"));
      tr.classList.add("selected");
    });
    tr.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      selectedPid = p.pid;
      tb.querySelectorAll("tr").forEach((r) => r.classList.remove("selected"));
      tr.classList.add("selected");
      showMenu(e.clientX, e.clientY, [
        { label: "结束任务(E)", action: async () => { await killProcess(p.pid); refresh(); } },
        { label: "在线搜索(S)", action: () => {
          window.open("https://www.bing.com/search?q=" + encodeURIComponent(p.name || ""), "_blank");
        } },
        { label: "效率模式(M)", action: async () => { await setEfficiency(p.pid, true); refresh(); } },
        { sep: true },
        { label: "资源值(V)", children: [
        { label: "内存(M)", children: [
          { label: "百分比", checked: resourceDisplayMode.mem === "pct", action: () => { resourceDisplayMode.mem = "pct"; render(); } },
          { label: "值", checked: resourceDisplayMode.mem === "val", action: () => { resourceDisplayMode.mem = "val"; render(); } },
        ]},
        { label: "磁盘(K)", children: [
          { label: "百分比", checked: resourceDisplayMode.disk === "pct", action: () => { resourceDisplayMode.disk = "pct"; render(); } },
          { label: "值", checked: resourceDisplayMode.disk === "val", action: () => { resourceDisplayMode.disk = "val"; render(); } },
        ]},
        { label: "网络(N)", children: [
          { label: "百分比", checked: resourceDisplayMode.net === "pct", action: () => { resourceDisplayMode.net = "pct"; render(); } },
          { label: "值", checked: resourceDisplayMode.net === "val", action: () => { resourceDisplayMode.net = "val"; render(); } },
        ]},
      ]},
        { sep: true },
        { label: "属性(I)", action: () => {
          alert("名称: " + p.name + "\\nPID: " + p.pid + "\\nCPU: " + cpu.toFixed(1) + "%\\n内存: " + fmtBytes(p.memory));
        }},
      ]);
    });
    tb.appendChild(tr);
  }
}

async function refresh() {
  try {
    const [list, st] = await Promise.all([getProcesses(), getStats()]);
    processes = Array.isArray(list) ? list : [];
    if (st) {
      sys = {
        cpuPercent: st.cpuPercent ?? 0,
        memPercent: st.memPercent ?? 0,
        memTotal: st.memTotal ?? 0,
      };
    }
    render();
  } catch (e) {
    console.error(e);
  }
}

export async function activate() {
  setTopActions(`
    <button type="button" class="btn btn-tool" id="btn-run"><img class="btn-ico" src="/src/icons/new.png" width="16" height="16" alt=""/>运行新任务</button>
    <span class="act-sep"></span>
    <button type="button" class="btn btn-tool" id="btn-end" disabled><img class="btn-ico" src="/src/icons/stop.png" width="16" height="16" alt=""/>结束任务</button>
    <button type="button" class="btn btn-tool" id="btn-efficiency" disabled><img class="btn-ico" src="/src/icons/Efficiency.png" width="16" height="16" alt=""/>效率模式</button>
  `);

  const run = document.getElementById("btn-run");
  const end = document.getElementById("btn-end");
  const eff = document.getElementById("btn-efficiency");
  if (run && !run._bound) {
    run._bound = true;
    run.addEventListener("click", () => { openRunDialog(); });
  }
  if (end && !end._bound) {
    end._bound = true;
    end.addEventListener("click", async () => {
      if (!selectedPid) return;
      try { await killProcess(selectedPid); } catch (e) {}
      if (typeof refresh === "function") refresh();
    });
  }
  if (eff && !eff._bound) {
    eff._bound = true;
    eff.addEventListener("click", async () => {
      if (!selectedPid) return;
      try { await setEfficiency(selectedPid, true); } catch (e) {}
      if (typeof refresh === "function") refresh();
    });
  }
setTimeout(() => { try { updateSortHeaders("#tbl-proc"); } catch (e) {} }, 0);
  ensureTable();
  if (!window._procSearchUnsub) {
    window._procSearchUnsub = onSearchChange(() => { try { render(); } catch (e) {} });
  }
  await refresh();
  setTimeout(refresh, 600);
  if (window._procTimer) clearInterval(window._procTimer);
  window._procTimer = setInterval(refresh, 1500);
}

export function deactivate() { try { hideAll(); } catch (e) {} setTopActions(""); }
