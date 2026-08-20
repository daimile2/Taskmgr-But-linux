const BASE = "";

async function req(path, opts = {}) {
  const r = await fetch(BASE + path, {
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    ...opts,
  });
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(t || r.statusText);
  }
  const ct = r.headers.get("content-type") || "";
  if (ct.includes("application/json")) return r.json();
  return r.text();
}

export async function getProcesses() {
  return req("/api/processes");
}

export async function getStats() {
  const s = await req("/api/perf/stats");
  return {
    cpuPercent: s.cpuPercent ?? s.CPUPercent ?? s.cpu ?? 0,
    memPercent: s.memPercent ?? s.MemPercent ?? 0,
    memTotal: s.memTotal ?? s.MemTotal ?? 0,
    memUsed: s.memUsed ?? s.MemUsed ?? 0,
    processCount: s.processCount ?? s.ProcessCount ?? 0,
    ...s,
  };
}

export async function getPerfExtra() {
  try { return await req("/api/perf/extra"); } catch { return { nets: [], disks: [], gpus: [] }; }
}

export async function killProcess(pid) {
  return req("/api/processes/kill", {
    method: "POST",
    body: JSON.stringify({ pid: Number(pid) }),
  });
}

export async function setEfficiency(pid, on) {
  return req("/api/processes/efficiency", {
    method: "POST",
    body: JSON.stringify({ pid: Number(pid), on: !!on }),
  });
}

export async function setNice(pid, nice) {
  return req("/api/processes/nice", {
    method: "POST",
    body: JSON.stringify({ pid: Number(pid), nice: Number(nice) }),
  });
}

export async function setAffinity(pid, mask) {
  return req("/api/processes/affinity", {
    method: "POST",
    body: JSON.stringify({ pid: Number(pid), mask }),
  });
}

export async function listStartup() {
  return req("/api/startup");
}

export async function setStartupEnabled(path, enabled) {
  return req("/api/startup/enable", {
    method: "POST",
    body: JSON.stringify({ path, enabled: !!enabled }),
  });
}

export async function listUsers() {
  return req("/api/users");
}

export async function listServices() {
  return req("/api/services");
}

export async function serviceAction(action, unit) {
  return req("/api/services/action", {
    method: "POST",
    body: JSON.stringify({ action, unit }),
  });
}

/** 页面里用的短名全部挂到 api 上 */
export const api = {
  getProcesses,
  getStats,
  getPerfExtra,
  killProcess,
  setEfficiency,
  setNice,
  setAffinity,
  listStartup,
  setStartupEnabled,
  listUsers,
  listServices,
  serviceAction,
  // users.js 旧调用
  processes: getProcesses,
  kill: killProcess,
  openPath: async (pid) => req("/api/processes/open-path", { method: "POST", body: JSON.stringify({ pid: Number(pid) }) }),


  // ---- 兼容旧调用 ----
  processes: getProcesses,
  stats: getStats,
  perfStats: getStats,
  extra: getPerfExtra,       // performance.js → api.extra()
  perfExtra: getPerfExtra,
  startup: listStartup,      // startup.js → api.startup()
  users: listUsers,          // users.js → api.users()
  services: listServices,    // services.js → api.services()
  enableStartup: setStartupEnabled,
  startupEnable: setStartupEnabled,
};
