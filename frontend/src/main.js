
// 进程页资源列显示：全局，默认「值」
window.resourceDisplayMode = window.resourceDisplayMode || { mem: "val", disk: "val", net: "val" };
import './style.css';
import {
  ListProcesses,
  GetSystemStats,
  KillProcess,
  RunCommand,
  ListStartupApps,
  SetStartupEnabled,
  ListUsers,
} from '../wailsjs/go/main/App.js';

let processes = [];
let selectedPid = null;
let selectedStartupPath = null;
let searchQ = '';
let sortKey = 'cpu';
let sortDir = -1;
let refreshMs = 2000;
let timer = null;
const cpuHistory = [];
const memHistory = [];
const MAX_HIST = 60;
let perfFocus = 'cpu';
const dynHistories = {}; // key -> number[]


function fmtBytes(n) {
  if (n == null) return '—';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0, v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return (i === 0 ? v : v.toFixed(1)) + ' ' + u[i];
}
function fmtPct(n) { return (n || 0).toFixed(1) + '%'; }

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function escapeAttr(s) { return escapeHtml(s).replace(/"/g, '&quot;'); }

document.querySelectorAll('.nav-item').forEach((btn) => {
  btn.addEventListener('click', () => {
    const page = btn.dataset.page;
    if (page && typeof showPage === "function") showPage(page);
    else {
      document.querySelectorAll('.nav-item').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      document.querySelectorAll('.page').forEach((p) => p.classList.remove('active'));
      const el = document.getElementById('page-' + page);
      if (el) el.classList.add('active');
    }
  });
});

document.getElementById('search')?.addEventListener('input', (e) => {
  searchQ = e.target.value.trim().toLowerCase();
  renderProcessTables();
});

document.querySelectorAll('#tbl-proc thead th').forEach((th) => {
  th.addEventListener('click', () => {
    const k = th.dataset.sort;
    if (!k) return;
    if (sortKey === k) sortDir *= -1;
    else {
      sortKey = k;
      sortDir = (k === 'name' || k === 'user' || k === 'state') ? 1 : -1;
    }
    renderProcessTables();
  });
});

const btnEnd = document.getElementById('btn-end');
btnEnd.addEventListener('click', async () => {
  if (!selectedPid) return;
  await KillProcess(selectedPid);
  selectedPid = null;
  btnEnd.disabled = true;
  await refreshProcesses();
});

document.getElementById('btn-run')?.addEventListener('click', () => {
  document.getElementById('run-cmd').value = '';
  document.getElementById('dlg-run').showModal();
});

document.getElementById('run-ok')?.addEventListener('click', async (e) => {
  e.preventDefault();
  const cmd = document.getElementById('run-cmd').value;
  document.getElementById('dlg-run').close();
  if (cmd.trim()) await RunCommand(cmd);
});

document.getElementById('btn-enable')?.addEventListener('click', async () => {
  if (!selectedStartupPath) return;
  await SetStartupEnabled(selectedStartupPath, true);
  refreshStartup();
});
document.getElementById('btn-disable')?.addEventListener('click', async () => {
  if (!selectedStartupPath) return;
  await SetStartupEnabled(selectedStartupPath, false);
  refreshStartup();
});

document.getElementById('refresh-ms')?.addEventListener('change', (e) => {
  refreshMs = parseInt(e.target.value, 10) || 2000;
  restartTimer();
});

function filteredSorted() {
  let list = processes.slice();
  if (searchQ) {
    list = list.filter((p) =>
      String(p.pid).includes(searchQ) ||
      (p.name || '').toLowerCase().includes(searchQ) ||
      (p.user || '').toLowerCase().includes(searchQ) ||
      (p.cmdline || '').toLowerCase().includes(searchQ)
    );
  }
  list.sort((a, b) => {
    let va = a[sortKey], vb = b[sortKey];
    if (typeof va === 'string') {
      va = (va || '').toLowerCase();
      vb = (vb || '').toLowerCase();
      if (va < vb) return -1 * sortDir;
      if (va > vb) return 1 * sortDir;
      return 0;
    }
    return ((va || 0) - (vb || 0)) * sortDir;
  });
  return list;
}

function renderProcessTables() {
  const list = (typeof filteredSorted === "function") ? filteredSorted() : (processes || []);
  const bodyProc = document.querySelector("#tbl-proc tbody");
  const bodyDet = document.querySelector("#tbl-details tbody");
  if (bodyProc) bodyProc.innerHTML = "";
  if (bodyDet) bodyDet.innerHTML = "";
  if (!bodyProc && !bodyDet) {
    console.error("no tbl-proc/tbl-details tbody");
    return;
  }
  for (const p of list) {
    try {
      if (bodyProc) {
        const tr = document.createElement("tr");
        tr.dataset.pid = String(p.pid ?? "");
        tr.dataset.name = p.name || "";
        if (p.pid === selectedPid) tr.classList.add("selected");
        const mem = (typeof formatResMem === "function") ? formatResMem(p.memory) : String(p.memory ?? "");
        const cpu = (typeof fmtPct === "function") ? fmtPct(p.cpu) : String(p.cpu ?? "");
        tr.innerHTML =
          '<td title="' + escapeAttr(p.cmdline || "") + '">' + escapeHtml(p.name || "") + "</td>" +
          "<td>" + escapeHtml(p.state || "") + "</td>" +
          '<td class="num">' + cpu + "</td>" +
          '<td class="num">' + mem + "</td>" +
          "<td>" + escapeHtml(p.user || "") + "</td>" +
          '<td class="num">' + (p.pid ?? "") + "</td>";
        tr.addEventListener("click", () => selectPid(p.pid, tr, bodyProc));
        bodyProc.appendChild(tr);
      }
      if (bodyDet) {
        const tr2 = document.createElement("tr");
        tr2.dataset.pid = String(p.pid ?? "");
        tr2.dataset.name = p.name || "";
        if (p.pid === selectedPid) tr2.classList.add("selected");
        const mem = (typeof formatResMem === "function") ? formatResMem(p.memory) : String(p.memory ?? "");
        const cpu = (typeof fmtPct === "function") ? fmtPct(p.cpu) : String(p.cpu ?? "");
        tr2.innerHTML =
          "<td>" + escapeHtml(p.name || "") + "</td>" +
          '<td class="num">' + (p.pid ?? "") + "</td>" +
          "<td>" + escapeHtml(p.state || "") + "</td>" +
          "<td>" + escapeHtml(p.user || "") + "</td>" +
          '<td class="num">' + cpu + "</td>" +
          '<td class="num">' + mem + "</td>" +
          '<td title="' + escapeAttr(p.cmdline || "") + '">' + escapeHtml(p.cmdline || "") + "</td>";
        tr2.addEventListener("click", () => selectPid(p.pid, tr2, bodyDet));
        bodyDet.appendChild(tr2);
      }
    } catch (err) {
      console.error("row render", p?.pid, err);
    }
  }
  console.log("[renderProcessTables]", list.length, "procRows", bodyProc ? bodyProc.children.length : -1);
}

function selectPid(pid, tr, tbody) {
  selectedPid = pid;
  btnEnd.disabled = false;
  tbody.querySelectorAll('tr').forEach((r) => r.classList.remove('selected'));
  tr.classList.add('selected');
}

function pushHist(arr, v) {
  arr.push(v);
  if (arr.length > MAX_HIST) arr.shift();
}



function drawSpark(canvas, data, color, fixedMax) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  if (!data || data.length < 2) return;
  // 百分比：固定 0~100；其它：至少为数据峰值，但不小于 1
  let max;
  if (typeof fixedMax === "number" && fixedMax > 0) {
    max = fixedMax;
  } else {
    max = Math.max(1, ...data.map((v) => (typeof v === "number" && v > 0 ? v : 0)));
  }
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 1;
  for (let gi = 1; gi < 4; gi++) {
    const y = (h / 4) * gi;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  const n = data.length;
  const step = w / Math.max(1, n - 1);
  ctx.beginPath();
  ctx.strokeStyle = color || "#4cc2ff";
  ctx.lineWidth = 2;
  for (let i = 0; i < n; i++) {
    const x = i * step;
    let v = typeof data[i] === "number" ? data[i] : 0;
    if (v < 0) v = 0;
    if (v > max) v = max;
    const y = h - (v / max) * (h - 8) - 4;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.lineTo((n - 1) * step, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  const c = color || "#4cc2ff";
  ctx.fillStyle = c.length === 7 ? c + "33" : "rgba(76,194,255,0.2)";
  try { ctx.fill(); } catch (e) {}
}



function drawMainChart() {
  const canvas = document.getElementById('perf-chart');
  const data = perfFocus === 'cpu' ? cpuHistory : memHistory;
  const color = perfFocus === 'cpu' ? '#4cc2ff' : '#b4a0ff';
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(320, Math.floor(rect.width));
  canvas.height = Math.max(160, Math.floor(rect.height));
  drawSpark(canvas, data, color);
}



function updatePerfDetail(stats) {
  return; // disabled: use renderDetailMeta only
}

async function refreshStartup() {
  const apps = await ListStartupApps();
  const tb = document.querySelector('#tbl-startup tbody');
  tb.innerHTML = '';
  selectedStartupPath = null;
  document.getElementById('btn-enable').disabled = true;
  document.getElementById('btn-disable').disabled = true;
  for (const a of apps) {
    const tr = document.createElement('tr');
    tr.dataset.path = a.path || '';
    tr.dataset.name = a.name || '';
    tr.dataset.exec = a.exec || '';
    tr.dataset.enabled = a.enabled ? '1' : '0';
    tr.innerHTML = `
      <td>${escapeHtml(a.name)}</td>
      <td>${a.enabled ? '已启用' : '已禁用'}</td>
      <td title="${escapeAttr(a.exec)}">${escapeHtml(a.exec)}</td>
      <td title="${escapeAttr(a.path)}">${escapeHtml(a.path)}</td>`;
    tr.addEventListener('click', () => {
      tb.querySelectorAll('tr').forEach((r) => r.classList.remove('selected'));
      tr.classList.add('selected');
      selectedStartupPath = a.path;
      document.getElementById('btn-enable').disabled = a.enabled;
      document.getElementById('btn-disable').disabled = !a.enabled;
    });
    tb.appendChild(tr);
  }
}


async function refreshUsers() {
  const rows = await ListUsers();
  const tb = document.querySelector("#tbl-users tbody");
  if (!tb) return;
  tb.innerHTML = "";
  for (const u of rows) {
    const tr = document.createElement("tr");
    tr.className = "user-row";
    tr.dataset.user = u.name;
    tr.dataset.expanded = "0";
    tr.innerHTML =
      '<td><span class="user-twist">▶</span>' +
      escapeHtml(u.name) +
      "</td>" +
      '<td class="num">' +
      u.processCount +
      "</td>" +
      '<td class="num">' +
      (u.cpu != null ? Number(u.cpu).toFixed(1) : "0.0") +
      "</td>" +
      '<td class="num">' +
      (typeof fmtBytes === "function" ? fmtBytes(u.memory) : u.memory) +
      "</td>";
    const twist = tr.querySelector(".user-twist");
    const toggle = async (e) => {
      if (e) e.stopPropagation();
      const open = tr.dataset.expanded === "1";
      if (open) {
        // remove children
        let n = tr.nextSibling;
        while (n && n.classList && n.classList.contains("user-child") && n.dataset.parent === u.name) {
          const x = n.nextSibling;
          n.remove();
          n = x;
        }
        tr.dataset.expanded = "0";
        twist.textContent = "▶";
      } else {
        let list = [];
        try {
          if (window.go?.main?.App?.ListProcessesByUser) {
            list = await window.go.main.App.ListProcessesByUser(u.name);
          } else if (typeof ListProcesses === "function") {
            list = (await ListProcesses()).filter((p) => p.user === u.name || p.User === u.name);
          }
        } catch (err) {
          console.error(err);
        }
        let insertAfter = tr;
        for (const pr of list) {
          const cr = document.createElement("tr");
          cr.className = "user-child";
          cr.dataset.parent = u.name;
          cr.dataset.pid = String(pr.pid ?? pr.PID);
          cr.dataset.name = pr.name || pr.Name || "";
          cr.innerHTML =
            "<td style=\"padding-left:28px\">" +
            escapeHtml(pr.name || pr.Name || "") +
            "</td>" +
            '<td class="num">' +
            (pr.pid ?? pr.PID) +
            "</td>" +
            "<td>" +
            escapeHtml(pr.state || pr.State || "") +
            "</td>" +
            '<td class="num">' +
            (pr.cpu != null ? Number(pr.cpu).toFixed(1) : "0.0") +
            "%</td>";
          insertAfter.after(cr);
          insertAfter = cr;
        }
        tr.dataset.expanded = "1";
        twist.textContent = "▼";
      }
      // 右键文案：展开时显示「折叠」
      const btn = document.querySelector('#user-ctx [data-uact="expand"]');
      if (btn) btn.textContent = tr.dataset.expanded === "1" ? "折叠(P)" : "展开(P)";
    };
    twist.addEventListener("click", toggle);
    tr.addEventListener("dblclick", toggle);
    tr.addEventListener("click", () => {
      tb.querySelectorAll("tr.user-row").forEach((r) => r.classList.remove("selected"));
      tr.classList.add("selected");
      window.selectedUserName = u.name;
    });
    tb.appendChild(tr);
  }
}


async function refreshProcesses() {
  try {
    let list;
    if (typeof ListProcesses === "function") list = await ListProcesses();
    else list = await window.go.main.App.ListProcesses();
    processes = Array.isArray(list) ? list : [];
    window.processes = processes;
    renderProcessTables();
  } catch (e) {
    console.error("refreshProcesses", e);
  }
}
window.refreshProcesses = refreshProcesses;
window.renderProcessTables = renderProcessTables;

async function refreshStats() {
  // unified cards after stats load

    try {
    const s = await GetSystemStats();
  if (s && (s.memTotal || s.MemTotal)) window._memTotalForRes = s.memTotal || s.MemTotal;
    pushHist(cpuHistory, s.cpuPercent || 0);
    pushHist(memHistory, s.memPercent || 0);
    (document.getElementById('st-proc')||{}).textContent = '进程 ' + s.processCount;
    (document.getElementById('st-cpu')||{}).textContent = 'CPU ' + fmtPct(s.cpuPercent);
    (document.getElementById('st-mem')||{}).textContent =
      '内存 ' + fmtPct(s.memPercent) + ' (' + fmtBytes(s.memUsed) + ')';
    renderAllPerfCards(s);
  } catch (e) { console.error(e); }
}

async function tick() {
  await Promise.all([refreshProcesses(), refreshStats()]);
}

function restartTimer() {
  if (timer) clearInterval(timer);
  timer = setInterval(tick, refreshMs);
}

tick().then(() => setTimeout(tick, 400));
restartTimer();
window.addEventListener('resize', () => drawMainChart());


// sidebar collapse
const sidebar = document.querySelector('.sidebar');
const btnToggle = document.getElementById('btn-sidebar-toggle');
if (btnToggle && sidebar) {
  btnToggle.addEventListener('click', () => {
    sidebar.classList.toggle('collapsed');
  });
}


function showActionsFor(page) {
  document.querySelectorAll(".actions-group").forEach((g) => {
    g.hidden = g.getAttribute("data-for") !== page;
  });
  // 设置页：全部隐藏
  if (page === "settings") {
    document.querySelectorAll(".actions-group").forEach((g) => { g.hidden = true; });
  }
}

document.querySelectorAll(".nav-item").forEach((btn) => {
  btn.addEventListener("click", () => {
    const page = btn.dataset.page;
    if (page) showActionsFor(page);
  });
});

// 初始
showActionsFor("processes");

// 所有「运行新任务」
document.querySelectorAll(".btn-run-any").forEach((b) => {
  b.addEventListener("click", () => {
    const el = document.getElementById("btn-run");
    if (el) el.click();
  });
});

// 详细信息结束任务
const btnEndDet = document.getElementById("btn-end-details");
if (btnEndDet) {
  btnEndDet.addEventListener("click", () => {
    const el = document.getElementById("btn-end");
    if (el && !el.disabled) el.click();
  });
}

// 选中进程时同步 details 结束按钮
const _oldSelect = window.selectPid;
// 属性按钮：展示当前选中进程信息
const btnProp = document.getElementById("btn-startup-prop");
if (btnProp) {
  btnProp.addEventListener("click", () => {
    const dlg = document.getElementById("dlg-props");
    const body = document.getElementById("props-body");
    if (!dlg || !body) return;
    const p = (typeof processes !== "undefined" ? processes : []).find((x) => x.pid === selectedPid);
    if (p) {
      body.textContent = Object.entries(p).map(([k, v]) => k + ": " + v).join("\n");
    } else {
      body.textContent = "未选中进程。请在进程/详细信息中选中一行。\n启动项属性可后续扩展。";
    }
    dlg.showModal();
  });
}



let efficiencyOn = new Set();
async function goCall(name, ...args) {
  try {
    if (window.go?.main?.App?.[name]) return await window.go.main.App[name](...args);
  } catch (e) { return String(e); }
  return "no api " + name;
}
const btnEff = document.getElementById("btn-efficiency");
if (btnEff) {
  btnEff.disabled = false;
  btnEff.addEventListener("click", async () => {
    if (!selectedPid) { alert("请先选中进程"); return; }
    const on = !efficiencyOn.has(selectedPid);
    const msg = await goCall("SetEfficiencyMode", selectedPid, on);
    if (on) efficiencyOn.add(selectedPid); else efficiencyOn.delete(selectedPid);
    alert(msg || "done");
  });
}




// hook into existing refreshStats if present
const _refreshStats = typeof refreshStats === "function" ? refreshStats : null;
if (_refreshStats) {
  // wrap by reassignment after definition is hard; poll instead
}


function fmtBps(bps) {
  if (!bps || bps < 0) return "0 Kbps";
  const kb = bps / 1000;
  if (kb < 1000) return kb.toFixed(1) + " Kbps";
  return (kb / 1000).toFixed(2) + " Mbps";
}






function pushDyn(key, val) {
  if (!dynHistories[key]) dynHistories[key] = [];
  const arr = dynHistories[key];
  arr.push(val < 0 ? 0 : val);
  if (arr.length > MAX_HIST) arr.shift();
}















// ===== 全部主卡（唯一实现）=====
let perfExtraCache = null;
let unifiedPerfFocus = "cpu";
let dynFocusKey = null;

async function fetchPerfExtra() {
  try {
    if (window.go?.main?.App?.GetPerfExtra) {
      perfExtraCache = await window.go.main.App.GetPerfExtra();
    }
  } catch (e) {
    console.error(e);
  }
}

function unifiedPush(key, val) {
  if (typeof dynHistories === 'undefined' || !dynHistories) return;
  if (!dynHistories[key]) dynHistories[key] = [];
  const a = dynHistories[key];
  a.push(typeof val === "number" && !Number.isNaN(val) && val >= 0 ? val : 0);
  const max = typeof MAX_HIST !== "undefined" ? MAX_HIST : 60;
  if (a.length > max) a.shift();
}

function paintUnifiedChart(key, color) {
  const canvas = document.getElementById("perf-chart");
  if (!canvas || typeof dynHistories === "undefined" || !dynHistories[key]) return;
  const rect = canvas.getBoundingClientRect();
  const w = Math.max(320, Math.floor(rect.width) || canvas.width || 640);
  const h = Math.max(160, Math.floor(rect.height) || canvas.height || 220);
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const pct = key === "cpu" || key === "mem" || String(key).startsWith("disk-") || String(key).startsWith("gpu-");
  if (typeof drawSpark === "function") {
    drawSpark(canvas, dynHistories[key], color || "#4cc2ff", pct ? 100 : undefined);
  }
}







function formatUptime(sec) {
  sec = Math.floor(Number(sec) || 0);
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = (n) => String(n).padStart(2, "0");
  if (d > 0) return d + ":" + pad(h) + ":" + pad(m) + ":" + pad(s);
  return pad(h) + ":" + pad(m) + ":" + pad(s);
}
function fmtUptime(sec) { return formatUptime(sec); }

function renderDetailMeta(card, extra, stats) {
  const meta = document.getElementById("perf-meta");
  if (!meta || !card) return;
  const S = stats || {};
  const id = card.uid;
  try {
    if (id === "cpu") {
      const util = Number(S.cpuPercent ?? 0);
      const mhz = Number(S.cpuMhz ?? 0);
      meta.innerHTML =
        '<div class="meta-grid">' +
        '<div><div class="k">利用率</div><div class="v">' + util.toFixed(0) + '%</div></div>' +
        '<div><div class="k">速度</div><div class="v">' + (mhz ? Math.round(mhz) + " MHz" : "—") + '</div></div>' +
        '<div><div class="k">逻辑处理器</div><div class="v">' + (S.cpuCores ?? "—") + '</div></div>' +
        '<div><div class="k">进程</div><div class="v">' + (S.processCount ?? "—") + '</div></div>' +
        '<div><div class="k">运行时间</div><div class="v">' + formatUptime(S.uptimeSec) + '</div></div>' +
        '<div><div class="k">型号</div><div class="v">' + (S.cpuModel || "—") + '</div></div>' +
        "</div>";
      return;
    }
    if (id === "mem") {
      const used = Number(S.memUsed ?? 0);
      const total = Number(S.memTotal ?? 0);
      const pct = Number(S.memPercent ?? 0);
      const fmt = (b) => (b / 1024 / 1024 / 1024).toFixed(1) + " GB";
      meta.innerHTML =
        '<div class="meta-grid">' +
        '<div><div class="k">已用</div><div class="v">' + fmt(used) + '</div></div>' +
        '<div><div class="k">总量</div><div class="v">' + fmt(total) + '</div></div>' +
        '<div><div class="k">占用</div><div class="v">' + pct.toFixed(1) + '%</div></div>' +
        '<div><div class="k">进程</div><div class="v">' + (S.processCount ?? "—") + '</div></div>' +
        "</div>";
      return;
    }
    if (String(id).startsWith("disk-")) {
      const name = id.slice(5);
      const d = (extra && extra.disks ? extra.disks : []).find((x) => x.name === name) || {};
      const fmtMB = (b) => ((b || 0) / 1024 / 1024).toFixed(2) + " MB/s";
      const fmtGB = (b) => (b ? (b / 1024 / 1024 / 1024).toFixed(1) + " GB" : "—");
      meta.innerHTML =
        '<div class="meta-grid">' +
        '<div><div class="k">活动时间</div><div class="v">' + (d.util >= 0 ? d.util.toFixed(0) + "%" : "—") + '</div></div>' +
        '<div><div class="k">读取速度</div><div class="v">' + fmtMB(d.readBps) + '</div></div>' +
        '<div><div class="k">写入速度</div><div class="v">' + fmtMB(d.writeBps) + '</div></div>' +
        '<div><div class="k">容量</div><div class="v">' + fmtGB(d.sizeBytes) + '</div></div>' +
        '<div><div class="k">型号</div><div class="v">' + (d.model || "—") + '</div></div>' +
        '<div><div class="k">类型</div><div class="v">' + (d.rotational === false ? "SSD" : d.rotational === true ? "HDD" : "—") + '</div></div>' +
        "</div>";
      return;
    }
    if (String(id).startsWith("net-")) {
      const name = id.slice(4);
      const n = (extra && extra.nets ? extra.nets : []).find((x) => x.name === name) || {};
      const fmtB = (x) => {
        const kb = (x || 0) / 1000;
        return kb < 1000 ? kb.toFixed(1) + " Kbps" : (kb / 1000).toFixed(2) + " Mbps";
      };
      meta.innerHTML =
        '<div class="meta-grid">' +
        '<div><div class="k">发送</div><div class="v">' + fmtB(n.txBps) + '</div></div>' +
        '<div><div class="k">接收</div><div class="v">' + fmtB(n.rxBps) + '</div></div>' +
        '<div><div class="k">适配器</div><div class="v">' + (n.name || name) + '</div></div>' +
        '<div><div class="k">类型</div><div class="v">' + (n.kind === "wifi" ? "Wi-Fi" : n.kind === "ethernet" ? "以太网" : n.kind || "—") + '</div></div>' +
        "</div>";
      return;
    }
    if (String(id).startsWith("gpu-")) {
      const g = (extra && extra.gpus ? extra.gpus : [])[Number(id.slice(4))] || {};
      meta.innerHTML =
        '<div class="meta-grid">' +
        '<div><div class="k">利用率</div><div class="v">' + (g.usage >= 0 ? g.usage.toFixed(0) + "%" : "N/A") + '</div></div>' +
        '<div><div class="k">温度</div><div class="v">' + (g.temp >= 0 ? g.temp.toFixed(0) + "°C" : "—") + '</div></div>' +
        '<div><div class="k">名称</div><div class="v">' + (g.name || "—") + '</div></div>' +
        '<div><div class="k">类型</div><div class="v">' + (g.kind === "iGPU" ? "核显" : g.kind === "dGPU" ? "独显" : "—") + '</div></div>' +
        "</div>";
      return;
    }
    meta.textContent = "";
  } catch (e) {
    console.error("renderDetailMeta", e);
    meta.textContent = "";
  }
}


function setUnifiedFocus(id, title, sub, valueText, histKey, color) {
  unifiedPerfFocus = id;
  if (typeof perfFocus !== "undefined") {
    perfFocus = id === "cpu" || id === "mem" ? id : "dyn";
  }
  const tEl = document.getElementById("perf-title");
  const mEl = document.getElementById("perf-model");
  const vEl = document.getElementById("perf-value");
  if (tEl) tEl.textContent = title;
  if (mEl) mEl.textContent = sub || "";
  if (vEl) vEl.textContent = valueText;
  document.querySelectorAll("#perf-cards .perf-card").forEach((c) => {
    c.classList.toggle("active", c.dataset.uid === id);
  });
  paintUnifiedChart(histKey, color);
}

async function renderAllPerfCards(stats) {
  const box = document.getElementById("perf-cards");
  if (!box) return;
  try {
    await fetchPerfExtra();
    const extra = perfExtraCache || { nets: [], gpus: [], disks: [] };
    const cards = [];

    if (stats) {
      const cpu = Number(stats.cpuPercent ?? 0);
      const mhz = Number(stats.cpuMhz ?? 0);
      unifiedPush("cpu", cpu);
      cards.push({
        uid: "cpu", hist: "cpu", label: "CPU",
        value: cpu.toFixed(1) + "% · " + Math.round(mhz) + " MHz",
        title: "CPU", sub: String(stats.cpuModel || ""),
        valueText: cpu.toFixed(1), color: "#4cc2ff",
      });
      const mem = Number(stats.memPercent ?? 0);
      const used = Number(stats.memUsed ?? 0);
      const total = Number(stats.memTotal ?? 0);
      unifiedPush("mem", mem);
      const fmt = typeof fmtBytes === "function" ? fmtBytes : (b) => (b / 1024 / 1024 / 1024).toFixed(1) + " GB";
      cards.push({
        uid: "mem", hist: "mem", label: "内存",
        value: fmt(used) + " / " + fmt(total) + " (" + mem.toFixed(1) + "%)",
        title: "内存", sub: "",
        valueText: mem.toFixed(1), color: "#b48cde",
      });
    }

    (extra.disks || []).forEach((d) => {
      unifiedPush("disk-" + d.name, d.util >= 0 ? d.util : 0);
      const utilStr = d.util >= 0 ? d.util.toFixed(0) + "%" : "—";
      const rw = "读 " + ((d.readBps || 0) / 1024 / 1024).toFixed(2) + " MB/s 写 " + ((d.writeBps || 0) / 1024 / 1024).toFixed(2) + " MB/s";
      cards.push({
        uid: "disk-" + d.name, hist: "disk-" + d.name, label: "磁盘 " + d.name,
        value: (d.model || "Disk") + " · " + utilStr + "\n" + rw,
        title: "磁盘 " + d.name, sub: rw,
        valueText: d.util >= 0 ? d.util.toFixed(0) : "—", color: "#4ec994",
      });
    });

    (extra.nets || []).forEach((n) => {
      const kind = n.kind === "wifi" ? "Wi-Fi" : n.kind === "ethernet" ? "以太网" : "网络";
      const bps = (n.rxBps || 0) + (n.txBps || 0);
      unifiedPush("net-" + n.name, bps / 1000);
      const fmtB = (x) => {
        const kb = (x || 0) / 1000;
        return kb < 1000 ? kb.toFixed(1) + " Kbps" : (kb / 1000).toFixed(2) + " Mbps";
      };
      cards.push({
        uid: "net-" + n.name, hist: "net-" + n.name, label: kind,
        value: n.name + "\n发送: " + fmtB(n.txBps) + " 接收: " + fmtB(n.rxBps),
        title: kind, sub: n.name,
        valueText: (bps / 1000).toFixed(0), color: "#e0a6ff",
      });
    });

    (extra.gpus || []).forEach((g, i) => {
      const tag = g.kind === "iGPU" ? "核显" : g.kind === "dGPU" ? "独显" : "GPU";
      unifiedPush("gpu-" + i, g.usage >= 0 ? g.usage : 0);
      let line = g.name || "";
      if (g.usage >= 0) line += " · " + g.usage.toFixed(0) + "%";
      else line += " · 占用 N/A";
      if (g.temp >= 0) line += " · " + g.temp.toFixed(0) + "°C";
      cards.push({
        uid: "gpu-" + i, hist: "gpu-" + i,
        label: tag + ((extra.gpus || []).length > 1 ? " " + (i + 1) : ""),
        value: line, title: tag,
        sub: (g.name || "") + (g.usage < 0 ? "（无驱动计数）" : ""),
        valueText: g.usage >= 0 ? g.usage.toFixed(0) : "N/A", color: "#c984ff",
      });
    });

    const prevFocus = unifiedPerfFocus;
    const have = new Set(cards.map((c) => c.uid));
    [...box.querySelectorAll(".perf-card[data-uid]")].forEach((el) => {
      if (!have.has(el.dataset.uid)) el.remove();
    });
    cards.forEach((c) => {
      let el = box.querySelector('.perf-card[data-uid="' + c.uid + '"]');
      if (!el) {
        el = document.createElement("div");
        el.className = "perf-card";
        el.dataset.uid = c.uid;
        el.innerHTML = '<div class="mini-wrap"><canvas></canvas></div><div class="text-wrap"><div class="label"></div><div class="value"></div></div>';
        el.addEventListener("click", () => {
          setUnifiedFocus(c.uid, c.title, c.sub, c.valueText, c.hist, c.color);
          if (typeof renderDetailMeta === "function") renderDetailMeta(c, extra, stats);
        });
        box.appendChild(el);
      }
      el.classList.toggle("active", c.uid === prevFocus);
      el.querySelector(".label").textContent = c.label;
      el.querySelector(".value").textContent = c.value;
      const mini = el.querySelector("canvas");
      if (mini) paintMiniChart(mini, c.hist, c.color);
      box.appendChild(el);
    });

    const focused = cards.find((c) => c.uid === prevFocus) || cards[0];
    if (focused) {
      const tEl = document.getElementById("perf-title");
      const mEl = document.getElementById("perf-model");
      const vEl = document.getElementById("perf-value");
      if (tEl) tEl.textContent = focused.title;
      if (mEl) mEl.textContent = focused.sub || "";
      if (vEl) vEl.textContent = focused.valueText;
      paintUnifiedChart(focused.hist, focused.color);
      if (typeof renderDetailMeta === "function") renderDetailMeta(focused, extra, stats);
    }
  } catch (e) {
    console.error("renderAllPerfCards", e);
  }
}


// ===== 进程表自定义右键菜单 =====
const procCtx = document.getElementById("proc-ctx");
let ctxPid = null;
let ctxName = "";

function hideProcCtx() {
  if (procCtx) procCtx.classList.remove("open");
}

function showProcCtx(x, y, pid, name) {
  try { markResourceMenuDots(); } catch (e) {}

  if (!procCtx) return;
  ctxPid = pid;
  ctxName = name || "";
  selectedPid = pid;
  const endBtn = document.getElementById("btn-end");
  if (endBtn) endBtn.disabled = !pid;
  placeContextMenu(procCtx, x, y); /* was open+manual pos */
  const pad = 4;
  const vw = window.innerWidth, vh = window.innerHeight;
  const rect = procCtx.getBoundingClientRect();
  let left = x, top = y;
  if (left + rect.width > vw - pad) left = vw - rect.width - pad;
  if (top + rect.height > vh - pad) top = vh - rect.height - pad;
  if (left < pad) left = pad;
  if (top < pad) top = pad;
  procCtx.style.left = left + "px";
  procCtx.style.top = top + "px";
}

// 屏蔽默认菜单 + 弹出

document.addEventListener("contextmenu", (e) => {
  // details 表不走进程菜单
  if (e.target.closest && e.target.closest("#tbl-details tbody tr")) {
    /* leave to details-ctx handler */
  } else void 0;

  const tr = e.target.closest && e.target.closest("#tbl-proc tbody tr, #tbl-users tbody tr.user-child");
  if (!tr) return;
  e.preventDefault();
  e.stopPropagation();

  let pid = Number(tr.dataset.pid || tr.getAttribute("data-pid") || 0);
  let name = (tr.dataset.name || tr.getAttribute("data-name") || "").trim();

  // 兜底：从行内 PID 列取（进程表最后一列常是 PID）
  if (!pid) {
    const tds = tr.querySelectorAll("td");
    if (tds.length) {
      const last = (tds[tds.length - 1].textContent || "").trim();
      const n = Number(last);
      if (n > 0) pid = n;
      if (!name && tds[0]) name = (tds[0].textContent || "").trim();
    }
  }
  if (!pid) {
    console.warn("contextmenu: no pid on row", tr);
    // 详细信息表由 details-ctx 处理，此处不弹窗
    if (e.target.closest && e.target.closest("#tbl-details")) return;
    alert("无法获取该行 PID，请刷新进程列表后再试");
    return;
  }
  console.log("contextmenu pid=", pid, "name=", name);
  selectedPid = pid;
  showProcCtx(e.clientX, e.clientY, pid, name);
}, true);


document.addEventListener("click", () => hideProcCtx());
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") hideProcCtx();
});

if (procCtx) {
  procCtx.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    e.stopPropagation();
    const act = btn.dataset.act;
    window._lastProcCtxBtn = btn;
    hideProcCtx();
    await procCtxAction(act);
    return;
  });
}



async function procCtxAction(act) {
  const btn = window._lastProcCtxBtn;

  console.log("procCtxAction", act, "pid=", ctxPid, "name=", ctxName);
  if ((!ctxPid || ctxPid <= 0) && act !== "search") {
    console.warn("no ctxPid", ctxPid, selectedPid);
    if (selectedPid > 0) ctxPid = selectedPid;
  }
  if ((!ctxPid || ctxPid <= 0) && act !== "search") {
    alert("未选中进程");
    return;
  }
  selectedPid = ctxPid;

  const go = async (name, ...args) => {
    try {
      if (window.go?.main?.App?.[name]) return await window.go.main.App[name](...args);
    } catch (e) {
      return "错误: " + e;
    }
    return "API 不存在: " + name + "（需要重启 wails dev 生成绑定）";
  };

  if (act === "end") {
    let msg = await go("KillProcessRoot", ctxPid);
    if (String(msg).includes("不存在") || String(msg).includes("API")) {
      msg = await go("KillProcess", ctxPid);
    }
    alert(msg || "已请求结束");
    try {
      if (typeof refreshProcesses === "function") await refreshProcesses();
    } catch (e) {}
    return;
  }
  if (act === "efficiency") {
    const msg = await go("SetEfficiencyMode", ctxPid, true);
    alert(msg || "已请求效率模式");
    try {
      if (typeof refreshProcesses === "function") await refreshProcesses();
    } catch (e) {}
    return;
  }
  if (act === "details") {
    const nav = document.querySelector('.nav-item[data-page="details"]');
    if (nav) nav.click();
    const pick = () => {
      const tr = document.querySelector('#tbl-details tbody tr[data-pid="' + ctxPid + '"]');
      if (!tr) return false;
      document.querySelectorAll("#tbl-details tbody tr").forEach((r) => r.classList.remove("selected"));
      tr.classList.add("selected");
      tr.scrollIntoView({ block: "center" });
      return true;
    };
    if (!pick()) {
      let n = 0;
      const tmr = setInterval(() => {
        n++;
        if (pick() || n > 25) clearInterval(tmr);
      }, 100);
    }
    return;
  }
  if (act === "open-path") {
    let msg = await go("OpenProcessLocation", ctxPid);
    if (String(msg).includes("不存在") || String(msg).includes("API")) {
      // fallback props
      const pp = await go("GetProcessProps", ctxPid);
      console.log("props", pp);
      const exe = pp && (pp.exe || pp.Exe) || "";
      alert("打开目录回退:\n" + (exe || msg));
    } else {
      // 成功一般不 alert；失败才提示
      if (msg && !String(msg).startsWith("已打开")) alert(msg);
      else console.log(msg);
    }
    return;
  }
  if (act === "search") {
    const q = encodeURIComponent(ctxName || String(ctxPid));
    const url = "https://www.bing.com/search?q=" + q;
    const msg = await go("RunCommand", "xdg-open " + url);
    if (String(msg).includes("不存在")) window.open(url, "_blank");
    return;
  }
  if (act === "props") {
    const pp = await go("GetProcessProps", ctxPid);
    const body = document.getElementById("props-body");
    const dlg = document.getElementById("dlg-props");
    if (body && dlg && pp && typeof pp === "object") {
      body.textContent = Object.entries(pp).map(([k, v]) => k + ": " + v).join("\n");
      dlg.showModal();
    } else {
      alert(typeof pp === "string" ? pp : JSON.stringify(pp, null, 2));
    }
    return;
  }
}




function paintMiniChart(canvas, key, color) {
  if (!canvas || typeof dynHistories === "undefined" || !dynHistories[key]) return;
  const data = dynHistories[key];
  const summary = document.body.classList.contains("summary-view");
  const w = summary ? 96 : 72, h = summary ? 48 : 40;
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const pct = key === "cpu" || key === "mem" || String(key).startsWith("disk-") || String(key).startsWith("gpu-");
  if (typeof drawSpark === "function") {
    drawSpark(canvas, data, color || "#4cc2ff", pct ? 100 : undefined);
  }
}



// ===== 性能页右键：摘要视图 / 隐藏图形 / 复制 =====
let summaryViewOn = false;
let hidePerfGraphOn = false;

function syncPerfCtxChecks() {
  const ctx = document.getElementById("perf-ctx");
  if (!ctx) return;
  const s = ctx.querySelector('[data-chk="summary"]');
  const h = ctx.querySelector('[data-chk="hide-graph"]');
  if (s) s.textContent = summaryViewOn ? "✓" : "";
  if (h) h.textContent = hidePerfGraphOn ? "✓" : "";
  const lab = ctx.querySelector("[data-label-hide]");
  if (lab) lab.textContent = hidePerfGraphOn ? "显示图形(H)" : "隐藏图形(H)";
}

function applySummaryView(on) {
  summaryViewOn = on;
  document.body.classList.toggle("summary-view", on);
  // 进入摘要时强制在性能页
  if (on) {
    const nav = document.querySelector('.nav-item[data-page="performance"]');
    if (nav) nav.click();
  }
  syncPerfCtxChecks();
}

function applyHidePerfGraph(on) {
  hidePerfGraphOn = on;
  document.body.classList.toggle("hide-perf-graph", on);
  // 圆点颜色跟当前卡
  document.querySelectorAll("#perf-cards .perf-card").forEach((el) => {
    const canvas = el.querySelector("canvas");
    // 从 hist 颜色：用 active 或默认
    const uid = el.dataset.uid || "";
    let color = "#4cc2ff";
    if (uid === "mem") color = "#b48cde";
    else if (uid.startsWith("disk")) color = "#4ec994";
    else if (uid.startsWith("net")) color = "#e0a6ff";
    else if (uid.startsWith("gpu")) color = "#c984ff";
    el.querySelector(".mini-wrap")?.style.setProperty("--mini-dot", color);
  });
  syncPerfCtxChecks();
}

function copyPerfInfo() {
  const title = document.getElementById("perf-title")?.textContent || "";
  const model = document.getElementById("perf-model")?.textContent || "";
  const value = document.getElementById("perf-value")?.textContent || "";
  const meta = document.getElementById("perf-meta");
  let lines = [title, model, "当前: " + value, ""];
  if (meta) {
    meta.querySelectorAll(".meta-grid > div").forEach((cell) => {
      const k = cell.querySelector(".k")?.textContent || "";
      const v = cell.querySelector(".v")?.textContent || "";
      if (k || v) lines.push(k + ": " + v);
    });
    if (lines.length <= 4) {
      const raw = meta.innerText || meta.textContent || "";
      if (raw.trim()) lines.push(raw.trim());
    }
  }
  const text = lines.filter(Boolean).join("\n");
  navigator.clipboard.writeText(text).then(
    () => console.log("copied"),
    () => alert(text)
  );
}

const perfCtx = document.getElementById("perf-ctx");
function hidePerfCtx() {
  perfCtx?.classList.remove("open");
}
function showPerfCtx(x, y) {
  if (!perfCtx) return;
  syncPerfCtxChecks();
  perfCtx.classList.add("open");
  const pad = 4;
  let left = x, top = y;
  const vw = innerWidth, vh = innerHeight;
  perfCtx.style.left = "0px";
  perfCtx.style.top = "0px";
  const rect = perfCtx.getBoundingClientRect();
  if (left + rect.width > vw - pad) left = vw - rect.width - pad;
  if (top + rect.height > vh - pad) top = vh - rect.height - pad;
  perfCtx.style.left = Math.max(pad, left) + "px";
  perfCtx.style.top = Math.max(pad, top) + "px";
}

document.addEventListener("contextmenu", (e) => {
  // details 表不走进程菜单
  if (e.target.closest && e.target.closest("#tbl-details tbody tr")) {
    /* leave to details-ctx handler */
  } else void 0;

  // 仅性能主卡
  const card = e.target.closest && e.target.closest("#perf-cards .perf-card");
  if (!card) return;
  e.preventDefault();
  e.stopPropagation();
  showPerfCtx(e.clientX, e.clientY);
}, true);

document.addEventListener("click", (e) => {
  if (perfCtx && !perfCtx.contains(e.target)) hidePerfCtx();
});

perfCtx?.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-pact]");
  if (!btn) return;
  e.stopPropagation();
  const act = btn.dataset.pact;
  hidePerfCtx();
  if (act === "summary") applySummaryView(!summaryViewOn);
  else if (act === "hide-graph") applyHidePerfGraph(!hidePerfGraphOn);
  else if (act === "copy") copyPerfInfo();
});



// ===== 性能大图区域右键 =====
let graphSummaryOn = false;

function currentPerfViewList() {
  const cards = [...document.querySelectorAll("#perf-cards .perf-card[data-uid]")];
  return cards.map((el) => ({
    uid: el.dataset.uid,
    label: el.querySelector(".label")?.textContent || el.dataset.uid,
  }));
}

function rebuildPerfViewSub() {
  const sub = document.getElementById("perf-view-sub");
  if (!sub) return;
  const list = currentPerfViewList();
  sub.innerHTML = "";
  list.forEach((item) => {
    const b = document.createElement("button");
    b.type = "button";
    const on = item.uid === unifiedPerfFocus;
    b.innerHTML = '<span class="dot">' + (on ? "●" : "") + "</span>" + item.label;
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      hideDetailCtx();
      const card = document.querySelector('#perf-cards .perf-card[data-uid="' + item.uid + '"]');
      if (card) card.click();
    });
    sub.appendChild(b);
  });
}

function applyGraphSummary(on) {
  graphSummaryOn = on;
  document.body.classList.toggle("graph-summary-view", on);
  // 与「卡片摘要视图」互斥可选：同时开也行，这里允许共存
  const chk = document.getElementById("chk-graph-summary");
  if (chk) chk.textContent = on ? "✓" : "";
  // 触发一次重绘大图
  const canvas = document.getElementById("perf-chart");
  if (canvas && typeof paintUnifiedChart === "function" && typeof unifiedPerfFocus !== "undefined") {
    const hist =
      unifiedPerfFocus === "cpu" || unifiedPerfFocus === "mem"
        ? unifiedPerfFocus
        : unifiedPerfFocus;
    // hist key 与 uid 在 cpu/mem 相同，其它带前缀
    let key = unifiedPerfFocus;
    paintUnifiedChart(key, "#4cc2ff");
  }
}

const detailCtx = document.getElementById("perf-detail-ctx");
function hideDetailCtx() {
  detailCtx?.classList.remove("open");
}
function showDetailCtx(x, y) {
  if (!detailCtx) return;
  const chk = document.getElementById("chk-graph-summary");
  if (chk) chk.textContent = graphSummaryOn ? "✓" : "";
  rebuildPerfViewSub();
  detailCtx.classList.add("open");
  const pad = 4;
  detailCtx.style.left = "0px";
  detailCtx.style.top = "0px";
  const rect = detailCtx.getBoundingClientRect();
  let left = x, top = y;
  if (left + rect.width > innerWidth - pad) left = innerWidth - rect.width - pad;
  if (top + rect.height > innerHeight - pad) top = innerHeight - rect.height - pad;
  detailCtx.style.left = Math.max(pad, left) + "px";
  detailCtx.style.top = Math.max(pad, top) + "px";
}

document.addEventListener(
  "contextmenu",
  (e) => {
  // details 表不走进程菜单
  if (e.target.closest && e.target.closest("#tbl-details tbody tr")) {
    /* leave to details-ctx handler */
  } else void 0;

    const detail = e.target.closest && e.target.closest(".perf-detail, #perf-chart, #perf-meta, #perf-title");
    if (!detail) return;
    // 不要和主卡菜单抢：点在 cards 上已处理
    if (e.target.closest("#perf-cards")) return;
    e.preventDefault();
    e.stopPropagation();
    showDetailCtx(e.clientX, e.clientY);
  },
  true
);

document.addEventListener("click", (e) => {
  if (detailCtx && !detailCtx.contains(e.target)) hideDetailCtx();
});

detailCtx?.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-dact]");
  if (!btn) return;
  e.stopPropagation();
  const act = btn.dataset.dact;
  hideDetailCtx();
  if (act === "graph-summary") applyGraphSummary(!graphSummaryOn);
  else if (act === "copy") {
    if (typeof copyPerfInfo === "function") copyPerfInfo();
  }
});


// ===== 启动应用右键菜单 =====
let ctxStartupPath = "";
let ctxStartupName = "";
let ctxStartupExec = "";

const startupCtx = document.getElementById("startup-ctx");
function hideStartupCtx() {
  startupCtx?.classList.remove("open");
}
function showStartupCtx(x, y, path, name, exec, enabled) {
  const tog = document.getElementById("startup-ctx-toggle");
  if (tog) {
    // 第 6 个参数 enabled：true=当前已启用 → 菜单显示「禁用」
    let enabled = true;
    if (arguments.length >= 6) enabled = !!(arguments[5] === true || arguments[5] === 1 || arguments[5] === "1" || arguments[5] === "true");
    tog.textContent = enabled ? "禁用(D)" : "启用(E)";
    tog.dataset.next = enabled ? "0" : "1";
  }

  if (!startupCtx) return;
  ctxStartupPath = path || "";
  ctxStartupName = name || "";
  ctxStartupExec = exec || "";
  selectedStartupPath = path || selectedStartupPath;
  startupCtx.classList.add("open");
  const pad = 4;
  startupCtx.style.left = "0px";
  startupCtx.style.top = "0px";
  const rect = startupCtx.getBoundingClientRect();
  let left = x, top = y;
  if (left + rect.width > innerWidth - pad) left = innerWidth - rect.width - pad;
  if (top + rect.height > innerHeight - pad) top = innerHeight - rect.height - pad;
  startupCtx.style.left = Math.max(pad, left) + "px";
  startupCtx.style.top = Math.max(pad, top) + "px";
}

document.addEventListener("contextmenu", (e) => {
  // details 表不走进程菜单
  if (e.target.closest && e.target.closest("#tbl-details tbody tr")) {
    /* leave to details-ctx handler */
  } else void 0;

  const tr = e.target.closest && e.target.closest("#tbl-startup tbody tr");
  if (!tr) return;
  e.preventDefault();
  e.stopPropagation();
  const path = tr.dataset.path || tr.getAttribute("data-path") || "";
  const name = tr.dataset.name || tr.getAttribute("data-name") || (tr.children[0]?.textContent || "").trim();
  const exec = tr.dataset.exec || tr.getAttribute("data-exec") || "";
  if (path) selectedStartupPath = path;
  // 同步启用/禁用按钮状态（若有）
  const en = document.getElementById("btn-enable");
  const dis = document.getElementById("btn-disable");
  let enabled = tr.dataset.enabled === "1" || tr.dataset.enabled === "true";
  // 兜底：看状态列文字
  if (tr.dataset.enabled == null || tr.dataset.enabled === "") {
    const rowText = (tr.textContent || "");
    if (/禁用|停用|disabled/i.test(rowText) && !/已启用|启用中/.test(rowText)) enabled = false;
    else if (/启用|enabled/i.test(rowText)) enabled = true;
  }
  console.log("startup ctx enabled=", enabled, "data=", tr.dataset.enabled);
  if (en) en.disabled = enabled;
  if (dis) dis.disabled = !enabled;
  showStartupCtx(e.clientX, e.clientY, path, name, exec, enabled);
}, true);

document.addEventListener("click", () => hideStartupCtx());

startupCtx?.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-sact]");
  if (!btn) return;
  e.stopPropagation();
  const act = btn.dataset.sact;
  hideStartupCtx();

  const go = async (name, ...args) => {
    try {
      if (window.go?.main?.App?.[name]) return await window.go.main.App[name](...args);
    } catch (err) {
      return String(err);
    }
    return "API 不存在: " + name;
  };

  if (act === "toggle" || act === "disable" || act === "enable") {
    if (!ctxStartupPath && !selectedStartupPath) {
      alert("请先选择启动项");
      return;
    }
    const path = ctxStartupPath || selectedStartupPath;
    const tog = document.getElementById("startup-ctx-toggle");
    // next=1 表示要点成启用
    let turnOn = true;
    if (tog && tog.dataset.next != null) turnOn = tog.dataset.next === "1";
    else if (act === "disable") turnOn = false;
    else if (act === "enable") turnOn = true;

    selectedStartupPath = path;
    const enBtn = document.getElementById("btn-enable");
    const disBtn = document.getElementById("btn-disable");
    if (turnOn && enBtn && !enBtn.disabled) {
      enBtn.click();
    } else if (!turnOn && disBtn && !disBtn.disabled) {
      disBtn.click();
    } else if (window.go?.main?.App?.SetStartupEnabled) {
      const msg = await window.go.main.App.SetStartupEnabled(path, turnOn);
      if (msg) console.log(msg);
      if (typeof refreshStartup === "function") await refreshStartup();
    }
    // 立即反转右上角按钮可用状态（刷新前）
    if (enBtn && disBtn) {
      enBtn.disabled = turnOn;
      disBtn.disabled = !turnOn;
    }
    return;
  }
  if (false && act === "disable_unused") {
    if (!ctxStartupPath && !selectedStartupPath) {
      alert("请先选择启动项");
      return;
    }
    const path = ctxStartupPath || selectedStartupPath;
    // 与右上角禁用相同
    const dis = document.getElementById("btn-disable");
    if (dis && !dis.disabled) {
      dis.click();
    } else if (window.go?.main?.App?.SetStartupEnabled) {
      alert(await go("SetStartupEnabled", path, false));
      if (typeof refreshStartup === "function") await refreshStartup();
    }
    return;
  }

  if (act === "open-path") {
    // 优先 .desktop 路径所在目录；否则解析 Exec
    let target = ctxStartupPath || selectedStartupPath || "";
    let dir = "";
    if (target.includes("/")) {
      dir = target.slice(0, target.lastIndexOf("/"));
    }
    // Exec 里可能是 /usr/bin/foo %U
    if (!dir && ctxStartupExec) {
      const exe = ctxStartupExec.trim().split(/\s+/)[0];
      if (exe.includes("/")) dir = exe.slice(0, exe.lastIndexOf("/"));
      else {
        // which
        const msg = await go("RunCommand", "bash -lc 'dirname \"$(readlink -f \"$(which " + exe.replace(/'/g, "") + ")\" 2>/dev/null)\"'");
        console.log(msg);
      }
    }
    if (!dir) {
      alert("无法解析文件位置");
      return;
    }
    const msg = await go("RunCommand", "xdg-open " + JSON.stringify(dir));
    if (String(msg).includes("不存在")) alert(dir);
    return;
  }

  if (act === "search") {
    const q = encodeURIComponent(ctxStartupName || ctxStartupPath || "startup");
    const url = "https://www.bing.com/search?q=" + q;
    const msg = await go("RunCommand", "xdg-open " + JSON.stringify(url));
    if (String(msg).includes("不存在")) window.open(url, "_blank");
    return;
  }

  if (act === "props") {
    const text = [
      "名称: " + (ctxStartupName || ""),
      "路径: " + (ctxStartupPath || selectedStartupPath || ""),
      "命令: " + (ctxStartupExec || ""),
    ].join("\n");
    const body = document.getElementById("props-body");
    const dlg = document.getElementById("dlg-props");
    if (body && dlg) {
      body.textContent = text;
      dlg.showModal();
    } else {
      alert(text);
    }
    return;
  }
});


function stampStartupRows(list) {
  const rows = document.querySelectorAll("#tbl-startup tbody tr");
  rows.forEach((tr, i) => {
    const a = list && list[i];
    if (!a) return;
    tr.dataset.path = a.path || "";
    tr.dataset.name = a.name || "";
    tr.dataset.exec = a.exec || a.Exec || "";
    tr.dataset.enabled = a.enabled ? "1" : "0";
  });
}



// ===== 用户页：右键 / 选中 / 断开 =====
window.selectedUserName = window.selectedUserName || null;

function setDisconnectEnabled(on) {
  const b = document.getElementById("btn-disconnect");
  if (b) b.disabled = !on;
}

function selectUserRow(tr) {
  const tb = document.querySelector("#tbl-users tbody");
  if (!tb || !tr) return;
  tb.querySelectorAll("tr.user-row").forEach((r) => r.classList.remove("selected"));
  // 清掉子进程高亮
  tb.querySelectorAll("tr.user-child").forEach((r) => r.classList.remove("selected"));
  tr.classList.add("selected");
  window.selectedUserName = tr.dataset.user || null;
  setDisconnectEnabled(!!window.selectedUserName);
}

function selectUserChildRow(tr) {
  const tb = document.querySelector("#tbl-users tbody");
  if (!tb || !tr) return;
  tb.querySelectorAll("tr").forEach((r) => r.classList.remove("selected"));
  tr.classList.add("selected");
  const pid = Number(tr.dataset.pid || 0);
  if (pid > 0) {
    selectedPid = pid;
    window.selectedUserName = tr.dataset.parent || window.selectedUserName;
  }
  // 子进程选中时，断开连接仍可针对父用户（可选：保持可用）
  setDisconnectEnabled(!!window.selectedUserName);
  const endBtn = document.getElementById("btn-end");
  if (endBtn) endBtn.disabled = !(pid > 0);
}

// 委托：用户行 / 子进程行 点击
document.addEventListener(
  "click",
  (e) => {
    const child = e.target.closest && e.target.closest("#tbl-users tbody tr.user-child",
        "#tbl-services tbody tr");
    if (child) {
      e.stopPropagation();
      selectUserChildRow(child);
      return;
    }
    const row = e.target.closest && e.target.closest("#tbl-users tbody tr.user-row");
    if (row) {
      // 点箭头不在这里处理（twist 自己 stopPropagation）
      if (e.target.closest && e.target.closest(".user-twist")) return;
      selectUserRow(row);
    }
  },
  false
);

// 用户行右键（必须 capture + preventDefault）
document.addEventListener(
  "contextmenu",
  (e) => {
  // details 表不走进程菜单
  if (e.target.closest && e.target.closest("#tbl-details tbody tr")) {
    /* leave to details-ctx handler */
  } else void 0;

    const tr = e.target.closest && e.target.closest("#tbl-users tbody tr.user-row");
    if (!tr) return;
    e.preventDefault();
    e.stopPropagation();
    selectUserRow(tr);
    const name = tr.dataset.user || "";
    const expanded = tr.dataset.expanded === "1";
    const ctx = document.getElementById("user-ctx");
    if (!ctx) {
      console.warn("user-ctx missing");
      return;
    }
    window.ctxUserName = name;
    const exp = ctx.querySelector('[data-uact="expand"]');
    if (exp) exp.textContent = expanded ? "折叠(P)" : "展开(P)";
    ctx.classList.add("open");
    const pad = 4;
    let left = e.clientX, top = e.clientY;
    ctx.style.left = "0px";
    ctx.style.top = "0px";
    const rect = ctx.getBoundingClientRect();
    if (left + rect.width > innerWidth - pad) left = innerWidth - rect.width - pad;
    if (top + rect.height > innerHeight - pad) top = innerHeight - rect.height - pad;
    ctx.style.left = Math.max(pad, left) + "px";
    ctx.style.top = Math.max(pad, top) + "px";
  },
  true
);

document.addEventListener("click", (e) => {
  const ctx = document.getElementById("user-ctx");
  if (ctx && !ctx.contains(e.target)) ctx.classList.remove("open");
});

document.getElementById("user-ctx")?.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-uact]");
  if (!btn || btn.disabled) return;
  e.stopPropagation();
  const act = btn.dataset.uact;
  document.getElementById("user-ctx")?.classList.remove("open");
  const name = window.ctxUserName || window.selectedUserName;
  if (act === "expand") {
    const tr = document.querySelector(
      '#tbl-users tbody tr.user-row[data-user="' + CSS.escape(name || "") + '"]'
    );
    tr?.querySelector(".user-twist")?.click();
    return;
  }
  if (act === "disconnect") {
    if (!name) {
      alert("请先选择用户");
      return;
    }
    if (!confirm("确定断开用户 " + name + " 的会话吗？")) return;
    let msg = "API 不存在 DisconnectUser（请重启 wails dev）";
    try {
      if (window.go?.main?.App?.DisconnectUser) {
        msg = await window.go.main.App.DisconnectUser(name);
      }
    } catch (err) {
      msg = String(err);
    }
    alert(msg);
    if (typeof refreshUsers === "function") refreshUsers();
    setDisconnectEnabled(false);
    window.selectedUserName = null;
    return;
  }
});

// 右上角断开连接
const btnDisc = document.getElementById("btn-disconnect");
if (btnDisc && !btnDisc.dataset.bound) {
  btnDisc.dataset.bound = "1";
  btnDisc.addEventListener("click", async () => {
    const name = window.selectedUserName;
    if (!name) {
      alert("请先选择用户");
      return;
    }
    if (!confirm("确定断开用户 " + name + " 的会话吗？")) return;
    let msg = "API 不存在";
    try {
      if (window.go?.main?.App?.DisconnectUser) {
        msg = await window.go.main.App.DisconnectUser(name);
      }
    } catch (err) {
      msg = String(err);
    }
    alert(msg);
    if (typeof refreshUsers === "function") refreshUsers();
    setDisconnectEnabled(false);
    window.selectedUserName = null;
  });
}

// 切到用户页时刷新并复位按钮
document.querySelectorAll('.nav-item[data-page="users"]').forEach((nav) => {
  nav.addEventListener("click", () => {
    setDisconnectEnabled(false);
    window.selectedUserName = null;
  });
});




// ===== 详细信息页右键 =====
let detailsCtxPid = null;
let detailsCtxName = "";

function enableEndButtons(on) {
  ["btn-end", "btn-end-details"].forEach((id) => {
    const b = document.getElementById(id);
    if (b) b.disabled = !on;
  });
}

// 点选详细信息行
document.addEventListener("click", (e) => {
  const tr = e.target.closest && e.target.closest("#tbl-details tbody tr");
  if (!tr) return;
  const tb = document.querySelector("#tbl-details tbody");
  tb?.querySelectorAll("tr").forEach((r) => r.classList.remove("selected"));
  tr.classList.add("selected");
  const pid = Number(tr.dataset.pid || tr.getAttribute("data-pid") || 0);
  if (!pid) {
    const tds = tr.querySelectorAll("td");
    // 常见：PID 在某一列
    for (const td of tds) {
      const n = Number((td.textContent || "").trim());
      if (n > 1) { /* keep scanning */ }
    }
    const last = tds[tds.length - 1];
    const n = Number((last?.textContent || "").trim());
    if (n > 0) {
      selectedPid = n;
      tr.dataset.pid = String(n);
    }
  } else {
    selectedPid = pid;
  }
  detailsCtxPid = selectedPid;
  detailsCtxName = tr.dataset.name || (tr.querySelector("td")?.textContent || "").trim();
  enableEndButtons(selectedPid > 0);
});

const detailsCtx = document.getElementById("details-ctx");
function hideDetailsCtx() {
  detailsCtx?.classList.remove("open");
}

document.addEventListener(
  "contextmenu",
  (e) => {
  // details 表不走进程菜单
  if (e.target.closest && e.target.closest("#tbl-details tbody tr")) {
    /* leave to details-ctx handler */
  } else void 0;

    const tr = e.target.closest && e.target.closest("#tbl-details tbody tr");
    if (!tr) return;
    e.preventDefault();
    e.stopPropagation();
    tr.click();
    detailsCtxPid = selectedPid;
    detailsCtxName = tr.dataset.name || (tr.querySelector("td")?.textContent || "").trim();
    if (!detailsCtx) return;
    (async () => {
      try {
        let nice = 0, aff = "";
        if (window.go?.main?.App?.GetProcessNice)
          nice = await window.go.main.App.GetProcessNice(detailsCtxPid || selectedPid);
        if (window.go?.main?.App?.GetProcessAffinity)
          aff = await window.go.main.App.GetProcessAffinity(detailsCtxPid || selectedPid);
        markDetailsMenuDots(nice, aff);
      } catch (err) { console.error(err); markDetailsMenuDots(0, ""); }
    })();
    placeContextMenu(detailsCtx, e.clientX, e.clientY);
    let left = e.clientX, top = e.clientY;
    const pad = 4;
    detailsCtx.style.left = "0px";
    detailsCtx.style.top = "0px";
    const rect = detailsCtx.getBoundingClientRect();
    if (left + rect.width > innerWidth - pad) left = innerWidth - rect.width - pad;
    if (top + rect.height > innerHeight - pad) top = innerHeight - rect.height - pad;
    detailsCtx.style.left = Math.max(pad, left) + "px";
    detailsCtx.style.top = Math.max(pad, top) + "px";
  },
  true
);

document.addEventListener("click", (e) => {
  if (detailsCtx && !detailsCtx.contains(e.target)) hideDetailsCtx();
});

async function detailsGo(name, ...args) {
  try {
    if (window.go?.main?.App?.[name]) return await window.go.main.App[name](...args);
  } catch (e) {
    return String(e);
  }
  return "API 不存在: " + name + "（请重启 wails dev）";
}

detailsCtx?.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-dact]");
  if (!btn || btn.disabled) return;
  e.stopPropagation();
  const act = btn.dataset.dact;
  hideDetailsCtx();
  const pid = detailsCtxPid || selectedPid;
  if (!pid && act !== "search") {
    alert("请先选择进程");
    return;
  }
  selectedPid = pid;

  if (act === "end") {
    let msg = await detailsGo("KillProcessRoot", pid);
    if (String(msg).includes("不存在")) msg = await detailsGo("KillProcess", pid);
    alert(msg || "已请求");
    if (typeof refreshProcesses === "function") refreshProcesses();
    enableEndButtons(false);
    return;
  }
  if (act === "end-tree") {
    const msg = await detailsGo("KillProcessTree", pid);
    alert(msg);
    if (typeof refreshProcesses === "function") refreshProcesses();
    enableEndButtons(false);
    return;
  }
  if (act === "efficiency") {
    alert(await detailsGo("SetEfficiencyMode", pid, true));
    return;
  }
  if (act === "nice") {
    const nice = Number(btn.dataset.nice || 0);
    const msg = await detailsGo("SetProcessNice", pid, nice);
    markDetailsMenuDots(nice, null);
    alert(msg);
    return;
  }
  if (act === "aff") {
    let list = btn.dataset.aff || "0";
    if (list === "all") list = "0-63";
    const msg = await detailsGo("SetProcessAffinity", pid, list);
    markDetailsMenuDots(null, list === "0-63" ? "0-7" : list);
    alert(msg);
    return;
  }
  if (act === "dump") {
    alert(await detailsGo("CreateMemoryDump", pid));
    return;
  }
  if (act === "open-path") {
    const msg = await detailsGo("OpenProcessLocation", pid);
    if (msg && !String(msg).startsWith("已打开")) alert(msg);
    return;
  }
  if (act === "search") {
    const q = encodeURIComponent(detailsCtxName || String(pid));
    const url = "https://www.bing.com/search?q=" + q;
    const msg = await detailsGo("RunCommand", "xdg-open " + JSON.stringify(url));
    if (String(msg).includes("不存在")) window.open(url, "_blank");
    return;
  }
  if (act === "props") {
    const pp = await detailsGo("GetProcessProps", pid);
    const body = document.getElementById("props-body");
    const dlg = document.getElementById("dlg-props");
    if (body && dlg && pp && typeof pp === "object") {
      body.textContent = Object.entries(pp).map(([k, v]) => k + ": " + v).join("\n");
      dlg.showModal();
    } else alert(typeof pp === "string" ? pp : JSON.stringify(pp, null, 2));
    return;
  }
});

// 顶栏结束（详细信息页按钮）
document.getElementById("btn-end-details")?.addEventListener("click", async () => {
  if (!selectedPid) return;
  let msg = await detailsGo("KillProcessRoot", selectedPid);
  if (String(msg).includes("不存在")) msg = await detailsGo("KillProcess", selectedPid);
  alert(msg || "已请求");
  if (typeof refreshProcesses === "function") refreshProcesses();
  enableEndButtons(false);
});



function mapNiceToPreset(nice) {
  // 贴近菜单档位
  const presets = [-20, -10, 0, 10, 19];
  let best = 0, bd = 1e9;
  for (const p of presets) {
    const d = Math.abs(p - nice);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

function markDetailsMenuDots(nice, aff) {
  const ctx = document.getElementById("details-ctx");
  if (!ctx) return;
  const preset = mapNiceToPreset(Number(nice) || 0);
  ctx.querySelectorAll("button[data-nice]").forEach((b) => {
    const n = Number(b.dataset.nice);
    const label = b.dataset.label || b.textContent.replace(/^[●○]\s*/, "");
    b.dataset.label = label;
    b.textContent = (n === preset ? "● " : "   ") + label;
  });
  const affStr = String(aff || "").trim();
  ctx.querySelectorAll("button[data-aff]").forEach((b) => {
    const key = b.dataset.aff;
    const label = b.dataset.label || b.textContent.replace(/^[●○]\s*/, "");
    b.dataset.label = label;
    let on = false;
    if (key === "all") {
      // 系统默认常见 0-N 或多个核
      on = /[-,]/.test(affStr) || affStr.split(",").length > 1 || affStr === "0-63";
      // 若只有单核 0，不算 all
      if (affStr === "0" || /^[0-9]+$/.test(affStr)) on = false;
      // 粗略：含 - 或很长视为 all
      if (affStr.includes("-") || (affStr.includes(",") && affStr.split(",").length >= 2)) on = true;
    } else if (key === "0") {
      on = affStr === "0";
    } else if (key === "0-1") {
      on = affStr === "0-1" || affStr === "0,1";
    }
    b.textContent = (on ? "● " : "   ") + label;
  });
  // 若亲和都不匹配，不点也行（系统自定义列表）
}



function markResourceMenuDots() {
  const m = window.resourceDisplayMode || { mem: "val", disk: "val", net: "val" };
  document.querySelectorAll("#proc-ctx button[data-act='res']").forEach((b) => {
    const res = b.dataset.res;
    const mode = b.dataset.mode;
    const label = b.dataset.label || b.textContent.replace(/^[●○\s]+/, "");
    b.dataset.label = label;
    const on = m[res] === mode;
    b.textContent = (on ? "● " : "   ") + label;
  });
}

function formatResMem(bytes) {
  const mode = (window.resourceDisplayMode && window.resourceDisplayMode.mem) || "val";
  const b = Number(bytes) || 0;
  if (mode === "pct") {
    let total = Number(window._memTotalForRes) || 0;
    if (!total && window._lastStats) {
      total = Number(window._lastStats.memTotal || window._lastStats.MemTotal) || 0;
    }
    if (!total) return (b / 1024 / 1024).toFixed(0) + "MB?%"; // 无总量时也能看出模式变了
    return ((b / total) * 100).toFixed(1) + "%";
  }
  if (typeof fmtBytes === "function") return fmtBytes(b);
  if (b >= 1073741824) return (b / 1073741824).toFixed(1) + " GB";
  return (b / 1048576).toFixed(1) + " MB";
}

function formatResRate(bps, mode, totalHint) {
  const v = Number(bps) || 0;
  if (mode === "pct") {
    const t = totalHint || window._diskOrNetCap || 0;
    if (!t) return "—";
    return Math.min(100, (v / t) * 100).toFixed(1) + "%";
  }
  // 值：MB/s 或 KB/s
  if (v >= 1024 * 1024) return (v / 1024 / 1024).toFixed(1) + " MB/s";
  if (v >= 1024) return (v / 1024).toFixed(1) + " KB/s";
  return v.toFixed(0) + " B/s";
}




// ===== 资源值显示（整表全局）=====
if (!window.resourceDisplayMode) {
  window.resourceDisplayMode = { mem: "val", disk: "val", net: "val" };
}



function applyResourceMode(res, mode) {
  window.resourceDisplayMode = window.resourceDisplayMode || { mem: "val", disk: "val", net: "val" };
  window.resourceDisplayMode[res] = mode;
  console.log("[res]", res, mode, window.resourceDisplayMode);
  if (typeof markResourceMenuDots === "function") markResourceMenuDots();
  // 关键点：只重绘表格，不必重新拉进程列表
  if (typeof renderProcessTables === "function") {
    renderProcessTables();
  } else if (typeof refreshProcesses === "function") {
    refreshProcesses();
  }
  const tip = { mem: "内存", disk: "磁盘", net: "网络" }[res] || res;
  const modeTip = mode === "pct" ? "百分比" : "值";
  const el = document.getElementById("st-proc") || document.querySelector(".status-left") || document.querySelector("footer");
  if (el) {
    const prev = el.getAttribute("data-prev") || el.textContent;
    el.setAttribute("data-prev", prev);
    el.textContent = "显示: " + tip + " = " + modeTip;
    setTimeout(() => { el.textContent = el.getAttribute("data-prev") || prev; }, 2500);
  }
}

// 捕获阶段绑定，避免被其它 handler return 掉
document.addEventListener(
  "click",
  (e) => {
    const btn = e.target.closest && e.target.closest("#proc-ctx button[data-act='res']");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    const res = btn.dataset.res;
    const mode = btn.dataset.mode;
    if (!res || !mode) return;
    document.getElementById("proc-ctx")?.classList.remove("open");
    applyResourceMode(res, mode);
  },
  true
);

// 打开进程菜单时刷新圆点
const _showProcCtx = typeof showProcCtx === "function" ? showProcCtx : null;
if (_showProcCtx && !showProcCtx._resPatched) {
  window.showProcCtx = function (x, y, pid, name) {
    try {
      markResourceMenuDots();
    } catch (err) {}
    return _showProcCtx(x, y, pid, name);
  };
  window.showProcCtx._resPatched = true;
}



// RES_MODE_CLICK_BOUND
document.addEventListener("click", function resModeClick(e) {
  const btn = e.target.closest && e.target.closest("#proc-ctx button[data-act='res']");
  if (!btn) return;
  e.preventDefault();
  e.stopPropagation();
  document.getElementById("proc-ctx")?.classList.remove("open");
  applyResourceMode(btn.dataset.res, btn.dataset.mode);
}, true);


function placeContextMenu(el, clientX, clientY) {
  if (!el) return;
  el.style.left = "0px";
  el.style.top = "0px";
  el.classList.add("open");
  const pad = 6;
  const rect = el.getBoundingClientRect();
  let left = clientX;
  let top = clientY;
  if (left + rect.width > window.innerWidth - pad)
    left = window.innerWidth - rect.width - pad;
  if (top + rect.height > window.innerHeight - pad)
    top = window.innerHeight - rect.height - pad;
  if (left < pad) left = pad;
  if (top < pad) top = pad;
  el.style.left = left + "px";
  el.style.top = top + "px";
  // 一级 + 嵌套子菜单：右侧不够则向左
  el.querySelectorAll(".has-sub").forEach((item) => {
    const sub = item.querySelector(":scope > .submenu");
    if (!sub) return;
    sub.classList.remove("submenu-left");
    const ir = item.getBoundingClientRect();
    const subW = 180;
    if (ir.right + subW > window.innerWidth - pad) {
      sub.classList.add("submenu-left");
    }
  });
}


function flipSubmenusFor(el) {
  if (!el) return;
  const pad = 6;
  el.querySelectorAll(".has-sub").forEach((item) => {
    const sub = item.querySelector(":scope > .submenu");
    if (!sub) return;
    sub.classList.remove("submenu-left");
    const ir = item.getBoundingClientRect();
    if (ir.right + 180 > window.innerWidth - pad) {
      sub.classList.add("submenu-left");
    }
  });
}


// FLIP_SUB_HOVER: 鼠标进入「设置优先级/相关性」时再判断左右
document.addEventListener(
  "mouseenter",
  (e) => {
    const item = e.target.closest && e.target.closest("#details-ctx .has-sub, #proc-ctx .has-sub");
    if (!item) return;
    const sub = item.querySelector(":scope > .submenu");
    if (!sub) return;
    const pad = 6;
    const ir = item.getBoundingClientRect();
    sub.classList.toggle("submenu-left", ir.right + 180 > window.innerWidth - pad);
  },
  true
);



// ===== 全局：无自定义菜单处禁止系统/浏览器右键 =====
document.addEventListener(
  "contextmenu",
  (e) => {
    // 已有自定义菜单的区域（这些 handler 会自己 preventDefault 并弹菜单）
    const allow = e.target.closest(
      [
        "#tbl-proc tbody tr",
        "#tbl-details tbody tr",
        "#tbl-startup tbody tr",
        "#tbl-users tbody tr.user-row",
        "#tbl-users tbody tr.user-child",
        "#tbl-services tbody tr",
        "#perf-cards .perf-card",
        ".perf-detail",
        "#perf-chart",
        "#perf-meta",
        "#perf-title",
        // 菜单自身内部
        "#proc-ctx",
        "#details-ctx",
        "#startup-ctx",
        "#user-ctx",
        "#perf-ctx",
        "#perf-detail-ctx",
      ].join(",")
    );
    if (allow) {
      // 交给各业务 handler（capture 里它们也会 preventDefault）
      return;
    }
    e.preventDefault();
    e.stopPropagation();
  },
  true
);




// ===== 服务页 =====
let selectedServiceUnit = null;
let selectedServiceName = "";

function setSvcButtons(on, running) {
  if (!on) setSvcActionEnabled(null);
  else setSvcActionEnabled(!!running);
}

async function refreshServices() {
  const tb = document.querySelector("#tbl-services tbody");
  if (!tb) return;
  let list = [];
  try {
    if (window.go?.main?.App?.ListServices) {
      list = await window.go.main.App.ListServices();
    }
  } catch (e) {
    console.error(e);
  }
  tb.innerHTML = "";
  selectedServiceUnit = null;
  setSvcButtons(false);
  setSvcActionEnabled(null);
  for (const s of list) {
    const tr = document.createElement("tr");
    tr.dataset.unit = s.unit || s.Unit || (s.name + ".service");
    tr.dataset.name = s.name || "";
    tr.dataset.pid = String(s.pid || 0);
    const running = (s.status || "").includes("运行");
    tr.dataset.running = running ? "1" : "0";
    tr.innerHTML =
      "<td>" + escapeHtml(s.name || "") + "</td>" +
      '<td class="num">' + (s.pid || "") + "</td>" +
      "<td>" + escapeHtml(s.description || "") + "</td>" +
      "<td>" + escapeHtml(s.status || "") + "</td>" +
      "<td>" + escapeHtml(s.group || "") + "</td>";
    tr.addEventListener("click", () => {
      tb.querySelectorAll("tr").forEach((r) => r.classList.remove("selected"));
      tr.classList.add("selected");
      selectedServiceUnit = tr.dataset.unit;
      selectedServiceName = tr.dataset.name;
      setSvcButtons(true, tr.dataset.running === "1");
    });
    tb.appendChild(tr);
  }
}

async function svcDo(action) {
  if (!selectedServiceUnit) {
    alert("请先选择服务");
    return;
  }
  let msg = "API 不存在";
  try {
    if (window.go?.main?.App?.ServiceAction) {
      msg = await window.go.main.App.ServiceAction(selectedServiceUnit, action);
    }
  } catch (e) {
    msg = String(e);
  }
  alert(msg);
  await refreshServices();
}

document.getElementById("btn-svc-start")?.addEventListener("click", () => svcDo("start"));
document.getElementById("btn-svc-stop")?.addEventListener("click", () => svcDo("stop"));
document.getElementById("btn-svc-restart")?.addEventListener("click", () => svcDo("restart"));

// 导航到服务页
document.querySelectorAll('.nav-item[data-page="services"]').forEach((nav) => {
  nav.addEventListener("click", () => {
    setTimeout(() => refreshServices(), 50);
  });
});

const svcCtx = document.getElementById("svc-ctx");
document.addEventListener(
  "contextmenu",
  (e) => {
    const tr = e.target.closest && e.target.closest("#tbl-services tbody tr");
    if (!tr) return;
    e.preventDefault();
    e.stopPropagation();
    tr.click();
    if (!svcCtx) return;
    const running = tr.dataset.running === "1" || (tr.dataset.status || "").includes("运行");
    setSvcActionEnabled(running);

    if (typeof placeContextMenu === "function") placeContextMenu(svcCtx, e.clientX, e.clientY);
    else {
      svcCtx.classList.add("open");
      svcCtx.style.left = e.clientX + "px";
      svcCtx.style.top = e.clientY + "px";
    }
  },
  true
);

document.addEventListener("click", (e) => {
  if (svcCtx && !svcCtx.contains(e.target)) svcCtx.classList.remove("open");
});

svcCtx?.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-svact]");
  if (!btn) return;
  e.stopPropagation();
  const act = btn.dataset.svact;
  svcCtx.classList.remove("open");
  if (act === "start") return svcDo("start");
  if (act === "stop") return svcDo("stop");
  if (act === "restart") return svcDo("restart");
  if (act === "open") {
    let msg = "";
    try {
      msg = await window.go.main.App.OpenServiceStatus(selectedServiceUnit);
    } catch (err) {
      msg = String(err);
    }
    if (msg) alert(msg);
    return;
  }
  if (act === "search") {
    const q = encodeURIComponent(selectedServiceName || selectedServiceUnit || "");
    const url = "https://www.bing.com/search?q=" + q + "+systemd";
    try {
      await window.go.main.App.RunCommand("xdg-open " + JSON.stringify(url));
    } catch (e) {
      window.open(url, "_blank");
    }
    return;
  }
  if (act === "details") {
    const pid = Number(
      document.querySelector("#tbl-services tr.selected")?.dataset.pid || 0
    );
    const nav = document.querySelector('.nav-item[data-page="details"]');
    if (nav) nav.click();
    if (pid > 0) {
      selectedPid = pid;
      setTimeout(() => {
        const tr = document.querySelector('#tbl-details tbody tr[data-pid="' + pid + '"]');
        tr?.click();
        tr?.scrollIntoView({ block: "center" });
      }, 200);
    }
    return;
  }
});

// 全局右键白名单加上服务表



function showPage(page) {
  if (!page) page = "processes";
  document.querySelectorAll(".page").forEach((el) => {
    el.classList.remove("active");
  });
  const el = document.getElementById("page-" + page);
  if (el) el.classList.add("active");
  else console.warn("showPage missing", page);
  document.querySelectorAll(".nav-item[data-page]").forEach((n) => {
    n.classList.toggle("active", n.getAttribute("data-page") === page);
  });
  try { if (typeof showActionsFor === "function") showActionsFor(page); } catch (e) {}
  try {
    if (page === "services" && typeof refreshServices === "function") refreshServices();
    if (page === "startup" && typeof refreshStartup === "function") refreshStartup();
    if (page === "users" && typeof refreshUsers === "function") refreshUsers();
    if ((page === "processes" || page === "details") && typeof refreshProcesses === "function") refreshProcesses();
    if (page === "performance" && typeof refreshStats === "function") refreshStats();
  } catch (e) { console.error(e); }
}


// SHOWPAGE_NAV_BOUND
document.querySelectorAll(".nav-item[data-page]").forEach((nav) => {
  nav.addEventListener("click", (e) => {
    const page = nav.getAttribute("data-page");
    if (!page) return;
    if (typeof showPage === "function") showPage(page);
  });
});


// INIT_SHOW_PAGE
document.addEventListener("DOMContentLoaded", () => {
  if (typeof showPage === "function") showPage("processes");
});
// 若 DOM 已就绪
if (document.readyState !== "loading" && typeof showPage === "function") {
  showPage("processes");
}


function setSvcActionEnabled(running) {
  // running === true：正在运行；false：已停止；null：未选中
  const pairs = [
    ["btn-svc-start", "start"],
    ["btn-svc-stop", "stop"],
    ["btn-svc-restart", "restart"],
  ];
  const none = running === null || running === undefined;
  for (const [id, act] of pairs) {
    let disabled = true;
    if (!none) {
      if (act === "start") disabled = !!running;
      else if (act === "stop" || act === "restart") disabled = !running;
    }
    const top = document.getElementById(id);
    if (top) top.disabled = disabled;
    const menu = document.querySelector('#svc-ctx [data-svact="' + act + '"]');
    if (menu) menu.disabled = disabled;
  }
}




// ===== 设置 =====
const SETTINGS_KEY = "taskmgr_settings_v1";

function defaultSettings() {
  return {
    theme: "system",
    startPage: "processes",
    refreshRate: "normal",
    alwaysOnTop: false,
    minimizeOnUse: true,
    hideWhenMinimized: false,
    fullUsername: false,
    historyAll: false,
    effConfirm: true,
    dumpAbort: true,
    dumpVm: false,
    dumpVmExtra: false,
    dumpUser: false,
  };
}

function loadSettings() {
  try {
    return { ...defaultSettings(), ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") };
  } catch {
    return defaultSettings();
  }
}

function saveSettings(s) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  applySettings(s);
}

function applySettings(s) {
  if (!s) return;
  document.body.classList.remove("theme-light", "theme-dark");
  if (s.theme === "light") document.body.classList.add("theme-light");
  else if (s.theme === "dark") document.body.classList.add("theme-dark");
  const ms = { high: 500, normal: 1000, low: 2000, paused: 0 }[s.refreshRate] ?? 1000;
  window._refreshMs = ms;
  window._settings = s;
  if (window._refreshTimer) {
    clearInterval(window._refreshTimer);
    window._refreshTimer = null;
  }
  // 等 Wails 就绪再轮询，避免 send null
  if (ms > 0) {
    window._refreshTimer = setInterval(() => {
      if (!window.go?.main?.App) return;
      try {
        if (typeof refreshStats === "function") refreshStats();
        if (typeof refreshProcesses === "function") refreshProcesses();
      } catch (e) {}
    }, ms);
  }
}

function fillSettingsForm(s) {
  document.querySelectorAll('input[name="theme"]').forEach((r) => {
    r.checked = r.value === s.theme;
  });
  const sp = document.getElementById("set-start-page");
  if (sp) sp.value = s.startPage || "processes";
  const rr = document.getElementById("set-refresh-rate");
  if (rr) rr.value = s.refreshRate || "normal";
  const map = {
    "set-always-on-top": "alwaysOnTop",
    "set-minimize-use": "minimizeOnUse",
    "set-minimize-hide": "hideWhenMinimized",
    "set-full-username": "fullUsername",
    "set-history-all": "historyAll",
    "set-eff-confirm": "effConfirm",
    "set-dump-abort": "dumpAbort",
    "set-dump-vm": "dumpVm",
    "set-dump-vm-extra": "dumpVmExtra",
    "set-dump-user": "dumpUser",
  };
  for (const [id, key] of Object.entries(map)) {
    const el = document.getElementById(id);
    if (el) el.checked = !!s[key];
  }
  const vm = document.getElementById("set-dump-vm");
  const extra = document.getElementById("set-dump-vm-extra");
  if (extra) extra.disabled = !(vm && vm.checked);
}

function readSettingsForm() {
  const s = loadSettings();
  const theme = document.querySelector('input[name="theme"]:checked');
  if (theme) s.theme = theme.value;
  s.startPage = document.getElementById("set-start-page")?.value || "processes";
  s.refreshRate = document.getElementById("set-refresh-rate")?.value || "normal";
  s.alwaysOnTop = !!document.getElementById("set-always-on-top")?.checked;
  s.minimizeOnUse = !!document.getElementById("set-minimize-use")?.checked;
  s.hideWhenMinimized = !!document.getElementById("set-minimize-hide")?.checked;
  s.fullUsername = !!document.getElementById("set-full-username")?.checked;
  s.historyAll = !!document.getElementById("set-history-all")?.checked;
  s.effConfirm = !!document.getElementById("set-eff-confirm")?.checked;
  s.dumpAbort = !!document.getElementById("set-dump-abort")?.checked;
  s.dumpVm = !!document.getElementById("set-dump-vm")?.checked;
  s.dumpVmExtra = !!document.getElementById("set-dump-vm-extra")?.checked;
  s.dumpUser = !!document.getElementById("set-dump-user")?.checked;
  return s;
}

function bindSettingsForm() {
  const root = document.getElementById("page-settings");
  if (!root || root.dataset.bound) return;
  root.dataset.bound = "1";
  root.addEventListener("change", () => {
    const vm = document.getElementById("set-dump-vm");
    const extra = document.getElementById("set-dump-vm-extra");
    if (extra) extra.disabled = !(vm && vm.checked);
    saveSettings(readSettingsForm());
  });
}

// 效率模式确认
const _setEff = window.go?.main?.App?.SetEfficiencyMode;
// 在效率模式点击处检查 window._settings.effConfirm

document.addEventListener("DOMContentLoaded", () => {
  const s = loadSettings();
  try { fillSettingsForm(s); } catch (e) {}
  try { bindSettingsForm(); } catch (e) {}
  setTimeout(() => {
    try { applySettings(s); } catch (e) { console.warn(e); }
    try {
      if (typeof showPage === "function") showPage(s.startPage || "processes");
      else document.getElementById("page-processes")?.classList.add("active");
    } catch (e) {}
  }, 500);
});
if (document.readyState !== "loading") {
  setTimeout(() => {
    try {
      const s = loadSettings();
      fillSettingsForm(s);
      bindSettingsForm();
      applySettings(s);
    } catch (e) { console.warn(e); }
  }, 500);
}



// FORCE_PAGE_VISIBLE
(function () {
  function boot() {
    if (!document.querySelector(".page.active")) {
      const p = document.getElementById("page-processes") || document.getElementById("page-process");
      if (p) p.classList.add("active");
    }
    if (typeof refreshProcesses === "function") refreshProcesses();
    if (typeof refreshStats === "function") refreshStats();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();


// NAV_SHOWPAGE_ONCE
document.querySelectorAll(".nav-item[data-page]").forEach((nav) => {
  nav.addEventListener("click", () => {
    const page = nav.getAttribute("data-page");
    if (page) showPage(page);
  });
});
setTimeout(() => {
  showPage("processes");
  if (typeof refreshStats === "function") refreshStats();
}, 100);


// BOOT_RP2
setTimeout(() => {
  document.querySelectorAll(".page").forEach((p) => p.classList.remove("active"));
  document.getElementById("page-processes")?.classList.add("active");
  refreshProcesses();
}, 300);


// BOOT_RP3
setTimeout(() => {
  document.querySelectorAll(".page").forEach((p) => p.classList.remove("active"));
  document.getElementById("page-processes")?.classList.add("active");
  refreshProcesses().then(() => console.log("boot refresh done"));
}, 400);


// NAV_CLICK_SHOWPAGE_V2
document.querySelectorAll(".nav-item[data-page]").forEach((btn) => {
  btn.addEventListener("click", (e) => {
    e.preventDefault();
    const page = btn.getAttribute("data-page");
    if (page) showPage(page);
  });
});
