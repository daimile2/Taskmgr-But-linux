/** 全局标题栏搜索：各页订阅 getQuery / onChange */

let query = "";
const listeners = new Set();

export function getSearchQuery() {
  return query;
}

export function onSearchChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function initSearchBox() {
  const el = document.getElementById("search");
  if (!el || el._globalSearchBound) return;
  el._globalSearchBound = true;
  query = (el.value || "").trim().toLowerCase();
  el.addEventListener("input", () => {
    query = (el.value || "").trim().toLowerCase();
    listeners.forEach((fn) => {
      try { fn(query); } catch (e) { console.warn(e); }
    });
  });
}

export function matchText(...parts) {
  if (!query) return true;
  const q = query;
  return parts.some((p) => String(p ?? "").toLowerCase().includes(q));
}
