/** 用户页 — 对齐 Win：用户 | 状态 | CPU | 内存 | 磁盘 | 网络 */
import { api } from "../api.js";
import { getSearchQuery, onSearchChange } from "../components/searchbox.js";
import { show as showCtx, hideAll } from "../components/ctxmenu.js";
import { setTopActions } from "../shell.js";
import { openRunDialog } from "../runDialog.js";

let rows = [];
/** @type {Record<string, any[]>} */
let children = {};
/** @type {Set<string>} */
let expanded = new Set();
let selectedUser = null;
let selectedPid = 0;
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

let bound = false;
let headerStats = { cpu: 0, mem: 0 };

function fmtRate(bps) {
  const n = Number(bps) || 0;
  if (n < 1024) return n.toFixed(0) + " B/s";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB/s";
  return (n / 1024 / 1024).toFixed(1) + " MB/s";
}
function fmtBytes(n) {
  const u = ["B", "KB", "MB", "GB"];
  let i = 0, v = Number(n) || 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return (i === 0 ? Math.round(v) : v.toFixed(1)) + " " + u[i];
}
function escapeHtml(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function cmp(a, b, key) {
  let va, vb;
  switch (key) {
    case "name":
      va = String(a.name || a.user || "").toLowerCase();
      vb = String(b.name || b.user || "").toLowerCase();
      break;
    case "status":
      va = String(a.status || "");
      vb = String(b.status || "");
      break;
    case "cpu":
      va = Number(a.cpu || 0); vb = Number(b.cpu || 0); break;
    case "memory":
      va = Number(a.memory || 0); vb = Number(b.memory || 0); break;
    case "disk":
      va = Number(a.diskBps || a.disk || 0); vb = Number(b.diskBps || b.disk || 0); break;
    case "net":
      va = Number(a.netBps || a.net || 0); vb = Number(b.netBps || b.net || 0); break;
    default:
      va = Number(a.cpu || 0); vb = Number(b.cpu || 0);
  }
  if (typeof va === "string") {
    if (va < vb) return -1 * sortDir;
    if (va > vb) return 1 * sortDir;
    return 0;
  }
  return ((va || 0) - (vb || 0)) * sortDir;
}

function ensureTable() {
  const host = document.getElementById("page-users");
  if (!host) return null;
  if (!document.getElementById("tbl-users")) {
    host.innerHTML = `
      <div class="page-title">用户</div>
      <div class="table-wrap">
        <table class="grid" id="tbl-users">
          <thead>
            <tr>
              <th data-sort="name">用户</th>
              <th data-sort="status">状态</th>
              <th class="num" data-sort="cpu"><span class="big" id="uh-cpu">0%</span><span class="sub">CPU</span></th>
              <th class="num" data-sort="memory"><span class="big" id="uh-mem">0%</span><span class="sub">内存</span></th>
              <th class="num" data-sort="disk"><span class="big" id="uh-disk">0%</span><span class="sub">磁盘</span></th>
              <th class="num" data-sort="net"><span class="big" id="uh-net">0%</span><span class="sub">网络</span></th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>`;
  }
  const elc = document.getElementById("uh-cpu");
  const elm = document.getElementById("uh-mem");
  if (elc) elc.textContent = Math.round(headerStats.cpu || 0) + "%";
  if (elm) elm.textContent = Math.round(headerStats.mem || 0) + "%";
  if (!bound) {
    bound = true;
    document.querySelectorAll("#tbl-users thead th[data-sort]").forEach((th) => {
      th.style.cursor = "pointer";
      th.addEventListener("click", () => {
        const k = th.dataset.sort;
        if (sortKey === k) sortDir = -sortDir;
        else { sortKey = k; sortDir = 1; }
        render();
      });
    });
  }
  return document.querySelector("#tbl-users tbody");
}

async function loadChildren(name) {
  const all = await (api.processes || api.getProcesses)();
  children[name] = (all || []).filter((p) => p.user === name);
}

async function toggleExpand(name) {
  if (expanded.has(name)) expanded.delete(name);
  else {
    expanded.add(name);
    await loadChildren(name);
  }
  render();
}

function procCtx(e, p) {
  e.preventDefault();
  selectedPid = p.pid;
  showCtx(e.clientX, e.clientY, [
    { id: "end", label: "结束任务(E)" },
    { sep: true },
    { id: "details", label: "转到详细信息(G)" },
    { id: "search", label: "在线搜索(S)" },
    { id: "props", label: "属性(I)" },
  ], async (id) => {
    if (id === "end") {
      const fn = api.kill || api.killProcess;
      if (fn) await fn(p.pid);
      await refresh();
    } else if (id === "details") {
      document.querySelector('.nav-item[data-page="details"]')?.click();
    } else if (id === "search") {
      window.open("https://www.bing.com/search?q=" + encodeURIComponent(p.name || ""), "_blank");
    } else if (id === "props") {
      alert(`名称: ${p.name}\nPID: ${p.pid}\n用户: ${p.user}\nCPU: ${(p.cpu||0).toFixed(1)}%\n内存: ${fmtBytes(p.memory)}`);
    }
  });
}

function render() {
  try { updateSortHeaders("#tbl-users"); } catch (e) {}

  const tb = ensureTable();
  if (!tb) return;
  const q = getSearchQuery();
  let parents = rows.slice();
  /** 搜索命中的「仅保留这些子进程」：user -> pid set；空表示用户名命中显示全部 */
  const childFilter = {};
  if (q) {
    const matchedUsers = [];
    for (const u of parents) {
      const uname = String(u.name || "");
      const userHit = uname.toLowerCase().includes(q);
      let kids = children[uname];
      // 若尚未加载子进程且可能按进程名搜索，先用缓存；刷新时会 load
      kids = Array.isArray(kids) ? kids : [];
      const hitKids = kids.filter((p) =>
        String(p.pid).includes(q) ||
        (p.name || "").toLowerCase().includes(q) ||
        (p.cmdline || "").toLowerCase().includes(q)
      );
      if (userHit) {
        matchedUsers.push(u);
        // 用户名命中：不限制子进程
      } else if (hitKids.length) {
        matchedUsers.push(u);
        childFilter[uname] = new Set(hitKids.map((p) => p.pid));
        expanded.add(uname); // 自动展开
      }
    }
    parents = matchedUsers;
  }
  parents.sort((a, b) => cmp(a, b, sortKey));
  tb.innerHTML = "";
  for (const u of parents) {
    const open = expanded.has(u.name);
    const tr = document.createElement("tr");
    tr.className = "user-row";
    if (selectedUser === u.name && !selectedPid) tr.classList.add("selected");
    const n = u.processCount ?? 0;
    tr.innerHTML = `
      <td>
        <button type="button" class="exp" style="border:0;background:transparent;color:inherit;cursor:pointer;width:18px">${open ? "▼" : "▶"}</button>
        ${escapeHtml(u.name)}${n ? " (" + n + ")" : ""}
      </td>
      <td></td>
      <td class="num">${Number(u.cpu ?? 0).toFixed(1)}%</td>
      <td class="num">${fmtBytes(u.memory)}</td>
      <td class="num">${fmtRate(u.diskBps)}</td>
      <td class="num">${fmtRate(u.netBps)}</td>`;
    tr.querySelector(".exp").addEventListener("click", (e) => {
      e.stopPropagation();
      toggleExpand(u.name);
    });
    tr.addEventListener("dblclick", () => toggleExpand(u.name));
    tr.addEventListener("click", () => {
      selectedUser = u.name;
      selectedPid = 0;
      const btn = document.getElementById("btn-disconnect");
      if (btn) btn.disabled = false;
      tb.querySelectorAll("tr").forEach((r) => r.classList.remove("selected"));
      tr.classList.add("selected");
    });
    tr.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      selectedUser = u.name;
      showCtx(e.clientX, e.clientY, [
        { id: "expand", label: open ? "折叠(P)" : "展开(P)" },
        { id: "disconnect", label: "断开连接(D)" },
        { sep: true },
        { id: "manage", label: "管理用户帐户(M)" },
      ], async (id) => {
        if (id === "expand") toggleExpand(u.name);
        else if (id === "disconnect") {
          await fetch("/api/users/logout", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ name: u.name }),
          }).catch(() => {});
        } else if (id === "manage") {
          fetch("/api/users/manage").catch(() => {});
        }
      });
    });
    tb.appendChild(tr);

    if (open) {
      let list = (children[u.name] || []).slice();
      if (childFilter[u.name]) {
        const allow = childFilter[u.name];
        list = list.filter((p) => allow.has(p.pid));
      }
      list.sort((a, b) => cmp(a, b, sortKey));
      for (const p of list) {
        const cr = document.createElement("tr");
        cr.className = "user-child";
        if (selectedPid === p.pid) cr.classList.add("selected");
        cr.innerHTML = `
          <td style="padding-left:28px">${escapeHtml(p.name)}</td>
          <td></td>
          <td class="num">${Number(p.cpu ?? 0).toFixed(1)}%</td>
          <td class="num">${fmtBytes(p.memory)}</td>
          <td class="num">${fmtRate(p.diskBps)}</td>
          <td class="num">${fmtRate(p.netBps)}</td>`;
        cr.addEventListener("click", () => {
          selectedPid = p.pid;
          selectedUser = u.name;
          const btn = document.getElementById("btn-disconnect");
          if (btn) btn.disabled = true; // 选中的是进程，断开连接不可用
          tb.querySelectorAll("tr").forEach((r) => r.classList.remove("selected"));
          cr.classList.add("selected");
        });
        cr.addEventListener("contextmenu", (e) => procCtx(e, p));
        tb.appendChild(cr);
      }
    }
  }
}

export async function activate() {
  if (!window._userSearchUnsub) {
    window._userSearchUnsub = onSearchChange(() => {
      try {
        // 输入搜索时触发一次刷新以加载子进程
        refresh();
      } catch (e) {}
    });
  }

  setTopActions(`
    <button type="button" class="btn btn-tool" id="btn-run-user"><img class="btn-ico" src="/src/icons/new.png" width="16" height="16" alt=""/>运行新任务</button>
    <span class="act-sep"></span>
    <button type="button" class="btn btn-tool" id="btn-disconnect" disabled><img class="btn-ico" src="/src/icons/disconnect.svg" width="16" height="16" alt=""/>断开连接</button>
    <button type="button" class="btn btn-tool" id="btn-manage-user"><img class="btn-ico" src="/src/icons/users.png" width="16" height="16" alt=""/>管理用户帐户</button>
  `);

  document.getElementById("btn-run-user")?.addEventListener("click", () => {
    openRunDialog();
  });
  document.getElementById("btn-disconnect")?.addEventListener("click", async () => {
    if (!selectedUser) return;
    await fetch("/api/users/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: selectedUser }),
    }).catch(() => {});
  });
  document.getElementById("btn-manage-user")?.addEventListener("click", () => {
    fetch("/api/run", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cmd: "gnome-control-center user-accounts" }) }).catch(() => {
      alert("请手动打开「设置 → 用户」");
    });
  });

  setTimeout(() => { try { updateSortHeaders("#tbl-users"); } catch (e) {} }, 0);
  bound = false;
  ensureTable();
  await refresh();
  if (window._userTimer) clearInterval(window._userTimer);
  window._userTimer = setInterval(refresh, 2000);
}

export async function refresh() {
  try {
    rows = await api.users();
    if (!Array.isArray(rows)) rows = [];
    // 按用户汇总 diskBps / netBps
    try {
      const all = await (api.processes || api.getProcesses)();
      const by = {};
      for (const p of all || []) {
        const u = p.user || "";
        if (!by[u]) by[u] = { disk: 0, net: 0 };
        by[u].disk += Number(p.diskBps) || 0;
        by[u].net += Number(p.netBps) || 0;
      }
      for (const u of rows) {
        const a = by[u.name] || { disk: 0, net: 0 };
        u.diskBps = a.disk;
        u.netBps = a.net;
      }
    } catch (e) { console.warn(e); }
    try {
      const st = await api.getStats();
      headerStats.cpu = st.cpuPercent || 0;
      headerStats.mem = st.memPercent || 0;
    } catch {}
    const q = getSearchQuery();
    if (q) {
      // 搜索时预加载所有用户进程，以便按进程名匹配并展开
      for (const u of rows) {
        await loadChildren(u.name);
      }
    } else {
      for (const name of expanded) {
        await loadChildren(name);
      }
    }
    render();
  } catch (e) {
    console.error(e);
  }
}

export function deactivate() { try { hideAll(); } catch (e) {} setTopActions(""); }
