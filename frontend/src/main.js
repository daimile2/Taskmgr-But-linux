/**
 * 入口：路由 + 刷新节拍
 * 页面同级：processes / performance / startup / users / details / services / settings / history
 * 性能子状态：summary-view / graph-summary-view（由 performance 页自己管理）
 */

import { initShell, currentPage, setPageTitle } from "./shell.js";
import * as processes from "./pages/processes.js";
import * as performance from "./pages/performance.js";
import * as startup from "./pages/startup.js";
import * as users from "./pages/users.js";
import * as details from "./pages/details.js";
import * as services from "./pages/services.js";
import * as settings from "./pages/settings.js";
import * as history from "./pages/history.js";
import { getRefreshMs } from "./pages/settings.js";
import { initSearchBox } from "./components/searchbox.js";

const pages = {
  processes,
  performance,
  startup,
  users,
  details,
  services,
  settings,
  history,
};

let active = null;
let timer = null;

function switchPage(name) {
  if (active && pages[active]?.deactivate) pages[active].deactivate();
  active = name;
  const mod = pages[name];
  try { setPageTitle(name); } catch (e) {}
  if (mod?.activate) mod.activate();
}

async function tick() {
  const mod = pages[active || currentPage()];
  if (mod?.refresh) {
    try {
      await mod.refresh();
    } catch (e) {
      console.error(e);
    }
  }
}

function restartTimer() {
  if (timer) clearInterval(timer);
  const ms = getRefreshMs();
  if (!ms) return;
  timer = setInterval(tick, ms);
}

initShell(switchPage);
initSearchBox();
switchPage("processes");
restartTimer();
window.addEventListener("taskmgr-settings", restartTimer);

// 首次等后端就绪多试一次
setTimeout(tick, 300);
setTimeout(tick, 1200);
