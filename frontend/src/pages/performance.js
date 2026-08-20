/** 性能页 — 摘要小图固定 120x36，不拉满宽 */
import { api } from "../api.js";
import { push, paint, resizeCanvas } from "../components/chart.js";
import { show as showCtx, hideAll } from "../components/ctxmenu.js";
import { setTopActions } from "../shell.js";
import { openRunDialog } from "../runDialog.js";

let focus = "cpu";
let summaryOn = false;
let graphSummaryOn = false;
let hideGraphsOn = false;
let summaryHidden = false; // 性能页签摘要 → 仅标题栏
let graphSummaryHidden = false; // 折线摘要 → 仅标题+页头

function buildCopyText() {
  const lines = [];
  const title = document.getElementById("perf-title")?.textContent?.trim() || "";
  if (title) lines.push(title);
  const model = document.getElementById("perf-right-top")?.textContent?.trim();
  if (model) lines.push(model);
  document.querySelectorAll("#perf-meta .meta-cell").forEach((cell) => {
    const lab = cell.querySelector(".meta-lab")?.textContent?.trim() || "";
    const val = cell.querySelector(".meta-val")?.textContent?.trim() || "";
    if (lab) lines.push(lab + (val ? " " + val : ""));
    else if (val) lines.push(val);
  });
  return lines.join("\n");
}

function ensureDom() {
  const host = document.getElementById("page-performance");
  if (!host) return;
  // 已初始化但缺分隔条时补上（兼容旧缓存 DOM）
  if (host.dataset.ready) {
    const layout = host.querySelector(".perf-layout");
    const cards = host.querySelector("#perf-cards");
    if (layout && cards && !host.querySelector("#perf-splitter")) {
      const sp = document.createElement("div");
      sp.className = "perf-splitter";
      sp.id = "perf-splitter";
      const detail = layout.querySelector(".perf-detail");
      if (detail) layout.insertBefore(sp, detail);
      else layout.appendChild(sp);
    }
    initPerfSplitter();
    return;
  }
  host.dataset.ready = "1";
  host.innerHTML = `
    <div class="perf-layout">
      <div class="perf-cards" id="perf-cards"></div>
      <div class="perf-splitter" id="perf-splitter" title=""></div>
      <div class="perf-detail" id="perf-detail">
        <div class="perf-head">
          <div>
            <div class="perf-title" id="perf-title">CPU</div>
            <div class="perf-sub" id="perf-sub">% 利用率</div>
          </div>
          <div class="perf-right">
            <div id="perf-right-top"></div>
            <div id="perf-right-scale">100%</div>
          </div>
        </div>
        <div class="perf-chart-wrap"><canvas id="perf-chart"></canvas></div>
        <div class="perf-axis"><span>60 秒</span><span>0</span></div>
        <div class="perf-meta" id="perf-meta"></div>
      </div>
    </div>`;
  initPerfSplitter();
}
function initPerfSplitter() {
  const layout = document.querySelector("#page-performance .perf-layout");
  const cards = document.getElementById("perf-cards");
  const detail = document.getElementById("perf-detail") || layout?.querySelector(".perf-detail");
  const splitter = document.getElementById("perf-splitter");
  if (!layout || !cards || !splitter) return;
  if (splitter._bound) return;
  splitter._bound = true;

  // 几乎可拖满一侧（只留分隔条宽度）
  const MIN_L = 0;
  const MIN_R = 8;
  let dragging = false;

  function applyWidth(clientX) {
    const rect = layout.getBoundingClientRect();
    let w = clientX - rect.left;
    const maxL = Math.max(MIN_L, rect.width - MIN_R - 8);
    if (w < MIN_L) w = MIN_L;
    if (w > maxL) w = maxL;
    // 只改性能页内部左栏，不动系统窗口 / 侧栏 / 标题栏
    cards.style.flex = "0 0 " + w + "px";
    cards.style.width = w + "px";
    cards.style.maxWidth = w + "px";
    cards.style.minWidth = w + "px";
    if (detail) {
      detail.style.flex = "1 1 auto";
      // 最小宽度交给 CSS（固定内容），这里不强制抬高
    }
  }

  function onMove(e) {
    if (!dragging) return;
    e.preventDefault();
    applyWidth(e.clientX);
    try { fitChart(); } catch (_) {}
  }
  function onUp(e) {
    if (!dragging) return;
    dragging = false;
    document.body.classList.remove("perf-resizing");
    window.removeEventListener("mousemove", onMove, true);
    window.removeEventListener("mouseup", onUp, true);
    window.removeEventListener("pointermove", onMove, true);
    window.removeEventListener("pointerup", onUp, true);
    try { fitChart(); repaintAllMinis(); } catch (_) {}
  }
  function onDown(e) {
    e.preventDefault();
    e.stopPropagation();
    dragging = true;
    document.body.classList.add("perf-resizing");
    window.addEventListener("mousemove", onMove, true);
    window.addEventListener("mouseup", onUp, true);
    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
  }
  splitter.addEventListener("mousedown", onDown);
  splitter.addEventListener("pointerdown", onDown);
}
function setMeta(slots) {
  const meta = document.getElementById("perf-meta");
  if (!meta) return;
  meta.innerHTML = "";
  // slots: { left: [[lab,val],...], right: [[lab,val],...] } or flat object
  let left = [], right = [];
  if (slots && (slots.left || slots.right)) {
    left = slots.left || [];
    right = slots.right || [];
  } else {
    const entries = Object.entries(slots || {});
    const mid = Math.ceil(entries.length / 2);
    left = entries.slice(0, mid);
    right = entries.slice(mid);
  }
  const mk = (pairs) => {
    const col = document.createElement("div");
    col.className = "meta-col";
    for (const pair of pairs) {
      const lab = Array.isArray(pair) ? pair[0] : pair;
      const val = Array.isArray(pair) ? pair[1] : "";
      const cell = document.createElement("div");
      cell.className = "meta-cell";
      cell.innerHTML = `<div class="meta-lab">${lab}</div><div class="meta-val">${val ?? "N/A"}</div>`;
      col.appendChild(cell);
    }
    return col;
  };
  meta.appendChild(mk(left));
  if (right.length) meta.appendChild(mk(right));
}
function na(v) {
  if (v == null || v === "" || v === undefined) return "N/A";
  return v;
}
function fmtRate(bps) {
  if (bps == null || bps < 0) return "N/A";
  if (bps >= 1e6) return (bps / 1e6).toFixed(1) + " MB/秒";
  if (bps >= 1e3) return (bps / 1e3).toFixed(0) + " KB/秒";
  return bps.toFixed(0) + " B/秒";
}
function fmtMbps(bps) {
  if (bps == null || bps < 0) return "N/A";
  return (bps / 1e6).toFixed(2) + " Mbps";
}
function fmtGhz(mhz) {
  if (!mhz || mhz <= 0) return "N/A";
  return (mhz / 1000).toFixed(2) + " GHz";
}
function fmtUptime(sec) {
  sec = Math.floor(sec || 0);
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (d > 0) return `${d}:${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
  return `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}`;
}
function fmtBytes(n) {
  const u = ["B","KB","MB","GB","TB"];
  let i = 0, v = n || 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return v.toFixed(i ? 1 : 0) + " " + u[i];
}
function applySummary(on) {
  // 性能页签摘要：隐藏标题栏，保留左侧资源卡片
  summaryOn = !!on;
  if (summaryOn) {
    graphSummaryOn = false;
  }
  summaryHidden = false;
  graphSummaryHidden = false;
  document.body.classList.remove("summary-hidden", "graph-summary-hidden");
  document.body.classList.toggle("summary-view", summaryOn);
  document.body.classList.toggle("graph-summary-view", graphSummaryOn);
  requestAnimationFrame(() => { repaintAllMinis(); fitChart(); });
}
function applyGraphSummary(on) {
  // 折线图摘要：隐藏标题栏 + 性能页头，只保留折线图
  graphSummaryOn = !!on;
  if (graphSummaryOn) {
    summaryOn = false;
  }
  summaryHidden = false;
  graphSummaryHidden = false;
  document.body.classList.remove("summary-hidden", "graph-summary-hidden");
  document.body.classList.toggle("graph-summary-view", graphSummaryOn);
  document.body.classList.toggle("summary-view", summaryOn);
  requestAnimationFrame(fitChart);
}
function applyHideGraphs(on) {
  hideGraphsOn = !!on;
  document.body.classList.toggle("hide-perf-graphs", hideGraphsOn);
  requestAnimationFrame(() => { repaintAllMinis(); fitChart(); });
}
function maxYFor(id) { return (id && id.startsWith("net")) ? 0 : 100; }
function colorFor(id) {
  if (id === "mem") return "#b48cde";
  if (id && id.startsWith("disk")) return "#4ec994";
  if (id && id.startsWith("net")) return "#e0a6ff";
  if (id && id.startsWith("gpu")) return "#c984ff";
  return "#4cc2ff";
}
function fitChart() {
  const canvas = document.getElementById("perf-chart");
  const wrap = document.querySelector(".perf-chart-wrap");
  if (!canvas || !wrap) return;
  if (document.body.classList.contains("summary-view")) return;
  const r = wrap.getBoundingClientRect();
  if (r.width < 40 || r.height < 40) return;
  resizeCanvas(canvas, r.width, r.height);
  paint(canvas, focus, colorFor(focus), maxYFor(focus));
}
function paintMini(canvas, uid) {
  if (!canvas) return;
  resizeCanvas(canvas, 72, 40);
  paint(canvas, uid, colorFor(uid), maxYFor(uid));
}
function repaintAllMinis() {
  document.querySelectorAll("#perf-cards .perf-card").forEach((el) => {
    const uid = el.dataset.uid;
    const mini = el.querySelector("canvas");
    if (uid && mini) paintMini(mini, uid);
  });
}
function selectCard(id, title, sub, rightTop, scale, metaSlots) {
  focus = id;
  document.querySelectorAll(".perf-card").forEach((c) => {
    c.classList.toggle("active", c.dataset.uid === id);
  });
  const t = document.getElementById("perf-title");
  const s = document.getElementById("perf-sub");
  const rt = document.getElementById("perf-right-top");
  const sc = document.getElementById("perf-right-scale");
  if (t) t.textContent = title || id;
  if (s) s.textContent = sub || "";
  if (rt) rt.textContent = rightTop || "";
  if (sc) sc.textContent = scale || "";
  if (metaSlots) setMeta(metaSlots);
  fitChart();
}
export function activate() {
  ensureDom();
  setTopActions(`
    <button type="button" class="btn btn-tool" id="btn-run-perf"><img class="btn-ico" src="/src/icons/new.png" width="16" height="16" alt=""/>运行新任务</button>
  `);
  document.getElementById("btn-run-perf")?.addEventListener("click", () => {
    openRunDialog();
  });
  const host = document.getElementById("page-performance");
  if (host && !host._perfSummaryBound) {
    host._perfSummaryBound = true;
    host.addEventListener("contextmenu", (e) => {
      if (e.target.closest(".perf-card")) {
        e.preventDefault();
        showCtx(e.clientX, e.clientY, [
          { id: "summary", label: "摘要视图(W)", checked: summaryOn },
          { id: "hide-graphs", label: hideGraphsOn ? "显示图形(H)" : "隐藏图形(H)", checked: hideGraphsOn },
          { id: "copy", label: "复制(C)" },
        ], (id) => {
          if (id === "summary") applySummary(!summaryOn);
          if (id === "hide-graphs") applyHideGraphs(!hideGraphsOn);
          if (id === "copy") {
            // 先选中该卡片再复制完整详情（与右侧 meta 一致）
            const card = e.target.closest(".perf-card");
            card?.click();
            setTimeout(() => {
              navigator.clipboard?.writeText(buildCopyText()).catch(() => {});
            }, 50);
          }
        });
        return;
      }
      if (e.target.closest(".perf-detail")) {
        e.preventDefault();
        showCtx(e.clientX, e.clientY, [
          { id: "graph-summary", label: "图形摘要视图", checked: graphSummaryOn },
          { id: "summary", label: "摘要视图(W)", checked: summaryOn },
          { sep: true },
          { id: "copy", label: "复制(C)" },
        ], (id) => {
          if (id === "graph-summary") applyGraphSummary(!graphSummaryOn);
          if (id === "summary") applySummary(!summaryOn);
          if (id === "copy") {
            navigator.clipboard?.writeText(buildCopyText()).catch(() => {});
          }
        });
      }
    });
    host.addEventListener("dblclick", (e) => {
      if (e.target.closest(".perf-card")) applySummary(!summaryOn);
      else if (e.target.closest(".perf-detail")) applyGraphSummary(!graphSummaryOn);
    });
  }
  window.addEventListener("resize", () => { fitChart(); repaintAllMinis(); });
  refresh();
}
export async function refresh() {
  ensureDom();
  try {
    const [stats, extra] = await Promise.all([api.stats(), api.extra()]);
    const cards = [];
    push("cpu", stats.cpuPercent);
    cards.push({
      uid: "cpu", label: "CPU",
      value: `${(stats.cpuPercent||0).toFixed(0)}%  ${(stats.cpuMhz||0).toFixed(0)} MHz`,
      title: "CPU", sub: "% 利用率", right: stats.cpuModel || "", scale: "100%",
      meta: {
        left: [
          ["利用率", (stats.cpuPercent||0).toFixed(1)+"%"],
          ["速度", fmtGhz(stats.cpuMhz)],
          ["进程", String(stats.processCount ?? "N/A")],
          ["线程", String(stats.threadCount ?? "N/A")],
          ["句柄", stats.handleCount >= 0 ? String(stats.handleCount) : "N/A"],
          ["正常运行时间", fmtUptime(stats.uptimeSec)],
        ],
        right: [
          ["基准速度", fmtGhz(stats.cpuBaseMhz)],
          ["插槽", String(stats.cpuSockets ?? "N/A")],
          ["内核", String(stats.cpuPhysical ?? "N/A")],
          ["逻辑处理器", String(stats.cpuCores ?? "N/A")],
          ["虚拟化", na(stats.virtualization)],
          ["L1 缓存", na(stats.l1Cache)],
          ["L2 缓存", na(stats.l2Cache)],
          ["L3 缓存", na(stats.l3Cache)],
        ],
      },
    });
    push("mem", stats.memPercent);
    window._memTotal = stats.memTotal || 0;
    cards.push({
      uid: "mem", label: "内存",
      value: `${fmtBytes(stats.memUsed)} / ${fmtBytes(stats.memTotal)} (${(stats.memPercent||0).toFixed(0)}%)`,
      title: "内存", sub: "内存使用量", right: "", scale: "",
      meta: {
        left: [
          ["使用中", fmtBytes(stats.memUsed)],
          ["可用", fmtBytes(stats.memAvailable ?? ((stats.memTotal||0)-(stats.memUsed||0)))],
          ["已提交", `${fmtBytes(stats.memCommit||0)} / ${fmtBytes(stats.memCommitLim||0)}`],
          ["已缓存", fmtBytes(stats.memCached||0)],
          ["分页缓冲池", stats.memSlab ? fmtBytes(stats.memSlab) : "N/A"],
          ["非分页缓冲池", "N/A"],
        ],
        right: [
          ["速度", "N/A"],
          ["已使用的插槽", "N/A"],
          ["外形规格", "N/A"],
          ["为硬件保留的内存", stats.memHardwareReserved ? fmtBytes(stats.memHardwareReserved) : "N/A"],
          ["交换", `${fmtBytes(stats.memSwapUsed||0)} / ${fmtBytes(stats.memSwapTotal||0)}`],
        ],
      },
    });
    (extra.disks || []).forEach((d, i) => {
      const uid = "disk-" + (d.name || i);
      push(uid, d.util >= 0 ? d.util : 0);
      cards.push({
        uid, label: "磁盘 " + (d.name || ""),
        value: d.util >= 0 ? d.util.toFixed(0) + "%" : "—",
        title: "磁盘", sub: "活动时间", right: d.model || d.name || "", scale: "100%",
        meta: {
          left: [
            ["活动时间", d.util>=0?d.util.toFixed(1)+"%":"N/A"],
            ["平均响应时间", d.avgRespMs>=0?d.avgRespMs.toFixed(1)+" 毫秒":"N/A"],
            ["读取速度", fmtRate(d.readBps)],
            ["写入速度", fmtRate(d.writeBps)],
          ],
          right: [
            ["容量", d.sizeBytes?fmtBytes(d.sizeBytes):"N/A"],
            ["已格式化", d.sizeBytes?fmtBytes(d.sizeBytes):"N/A"],
            ["系统磁盘", d.systemDisk?"是":"否"],
            ["页面文件", d.pageFile?"是":"否"],
            ["类型", na(d.type)],
            ["名称", na(d.name)],
            ["型号", na(d.model)],
          ],
        },
      });
    });
    (extra.nets || []).forEach((n) => {
      const uid = "net-" + n.name;
      const rxM = (n.rxBps || 0) / 1e6;
      const txM = (n.txBps || 0) / 1e6;
      push(uid, rxM + txM);
      const kind = n.kind === "wifi" ? "Wi-Fi" : n.kind === "ethernet" ? "以太网" : "网络";
      cards.push({
        uid, label: kind,
        value: n.name + "\n发送 " + txM.toFixed(2) + " / 接收 " + rxM.toFixed(2) + " Mbps",
        title: kind, sub: "吞吐量", right: n.name, scale: "",
        meta: {
          left: [
            ["发送", fmtMbps(n.txBps)],
            ["接收", fmtMbps(n.rxBps)],
          ],
          right: [
            ["适配器名称", na(n.name)],
            ["SSID", na(n.ssid)],
            ["连接类型", na(n.connType)],
            ["IPv4 地址", na(n.ipv4)],
            ["IPv6 地址", na(n.ipv6)],
            ["信号强度", na(n.signal)],
          ],
        },
      });
    });
    (extra.gpus || []).forEach((g, i) => {
      const uid = "gpu-" + i;
      push(uid, g.usage >= 0 ? g.usage : 0);
      const tag = g.kind === "iGPU" ? "核显" : g.kind === "dGPU" ? "独显" : "GPU";
      cards.push({
        uid, label: tag,
        value: g.usage >= 0 ? g.usage.toFixed(0) + "%" : "N/A",
        title: tag, sub: "3D", right: g.name || "", scale: g.usage >= 0 ? "100%" : "",
        meta: {
          left: [
            ["利用率", g.usage>=0?g.usage.toFixed(0)+"%":"N/A"],
            ["共享 GPU 内存", (g.memUsed>=0&&g.memTotal>=0)?`${fmtBytes(g.memUsed)} / ${fmtBytes(g.memTotal)}`:"N/A"],
            ["GPU 内存", (g.memUsed>=0&&g.memTotal>=0)?`${fmtBytes(g.memUsed)} / ${fmtBytes(g.memTotal)}`:"N/A"],
            ["温度", g.temp>=0?g.temp.toFixed(0)+"°C":"N/A"],
          ],
          right: [
            ["名称", na(g.name)],
            ["驱动程序版本", na(g.driverVersion)],
            ["驱动程序日期", na(g.driverDate)],
            ["DirectX 版本", "N/A"],
            ["物理位置", na(g.location)],
          ],
        },
      });
    });
    const box = document.getElementById("perf-cards");
    if (!box) return;
    const have = new Set(cards.map((c) => c.uid));
    [...box.querySelectorAll(".perf-card")].forEach((el) => {
      if (!have.has(el.dataset.uid)) el.remove();
    });
    for (const c of cards) {
      let el = box.querySelector(`.perf-card[data-uid="${c.uid}"]`);
      if (!el) {
        el = document.createElement("div");
        el.className = "perf-card";
        el.dataset.uid = c.uid;
        el.innerHTML = `<div class="mini-wrap"><canvas width="72" height="40"></canvas></div><div class="text-wrap"><div class="label"></div><div class="value"></div></div>`;
        el.addEventListener("click", () => selectCard(c.uid, c.title, c.sub, c.right, c.scale, c.meta));
        box.appendChild(el);
      }
      el.classList.toggle("active", c.uid === focus);
      el.querySelector(".label").textContent = c.label;
      el.querySelector(".value").textContent = c.value;
      paintMini(el.querySelector("canvas"), c.uid);
    }
    const cur = cards.find((c) => c.uid === focus) || cards[0];
    if (cur) selectCard(cur.uid, cur.title, cur.sub, cur.right, cur.scale, cur.meta);
  } catch (e) { console.error("perf refresh", e); }
}
export function deactivate() { try { hideAll(); } catch (e) {} setTopActions(""); }
