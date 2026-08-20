/** 右键菜单 — children 嵌套 + action/id + 勾选 */
let root;
function ensure() {
  if (root) return root;
  root = document.getElementById("ctx-root");
  if (!root) {
    root = document.createElement("div");
    root.id = "ctx-root";
    document.body.appendChild(root);
  }
  return root;
}
export function hideAll() {
  document.querySelectorAll(".ctx-menu.open").forEach((el) => {
    el.classList.remove("open");
    el.style.display = "none";
  });
}
function esc(s) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function buildItems(menu, items, onPick) {
  for (const it of items) {
    if (it.sep) {
      const s = document.createElement("div");
      s.className = "sep";
      menu.appendChild(s);
      continue;
    }
    if (it.children && it.children.length) {
      const wrap = document.createElement("div");
      wrap.className = "has-sub";
      const b = document.createElement("button");
      b.type = "button";
      b.innerHTML =
        `<span class="chk">${it.checked ? "✓" : ""}</span>` +
        `<span>${esc(it.label)}</span><span class="arrow">›</span>`;
      wrap.appendChild(b);
      const sub = document.createElement("div");
      sub.className = "submenu ctx-menu";
      sub.style.display = "none";
      buildItems(sub, it.children, onPick);
      wrap.appendChild(sub);
      wrap.addEventListener("mouseenter", () => {
        sub.style.display = "block";
        sub.classList.add("open");
        const ir = wrap.getBoundingClientRect();
        if (ir.right + 180 > window.innerWidth - 6) sub.classList.add("submenu-left");
        else sub.classList.remove("submenu-left");
      });
      wrap.addEventListener("mouseleave", () => {
        sub.style.display = "none";
        sub.classList.remove("open");
      });
      menu.appendChild(wrap);
      continue;
    }
    const b = document.createElement("button");
    b.type = "button";
    if (it.disabled) b.disabled = true;
    const mark = it.checked ? "●" : "";
    b.innerHTML =
      `<span class="chk">${mark}</span><span>${esc(it.label)}</span>`;
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      hideAll();
      if (it.disabled) return;
      if (typeof it.action === "function") {
        try { it.action(); } catch (err) { console.error(err); }
        return;
      }
      if (it.id != null && typeof onPick === "function") onPick(it.id);
    });
    menu.appendChild(b);
  }
}
export function show(x, y, items, onPick) {
  hideAll();
  const host = ensure();
  let menu = host.querySelector(":scope > .ctx-menu");
  if (!menu) {
    menu = document.createElement("div");
    menu.className = "ctx-menu";
    host.appendChild(menu);
  }
  menu.innerHTML = "";
  buildItems(menu, items || [], onPick || (() => {}));
  menu.classList.add("open");
  menu.style.display = "block";
  menu.style.left = "0px";
  menu.style.top = "0px";
  const pad = 6;
  const rect = menu.getBoundingClientRect();
  let left = x, top = y;
  if (left + rect.width > window.innerWidth - pad) left = window.innerWidth - rect.width - pad;
  if (top + rect.height > window.innerHeight - pad) top = window.innerHeight - rect.height - pad;
  menu.style.left = Math.max(pad, left) + "px";
  menu.style.top = Math.max(pad, top) + "px";
}
document.addEventListener("click", (e) => {
  if (!e.target.closest(".ctx-menu")) hideAll();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") hideAll();
});
