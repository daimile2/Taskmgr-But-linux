import { setTopActions } from "../shell.js";
import { openRunDialog } from "../runDialog.js";

export function activate() {
  setTopActions(`
    <button type="button" class="btn btn-tool" id="btn-run-hist"><img class="btn-ico" src="/src/icons/new.png" width="16" height="16" alt=""/>运行新任务</button>
  `);

  document.getElementById("btn-run-hist")?.addEventListener("click", () => {
    openRunDialog();
  });


  const host = document.getElementById("page-history");
  host.innerHTML = `<div class="page-title">应用历史记录</div>
    <p class="hint">不可用 — Linux 无与 Windows 对等的应用历史计数器，本页保留占位。</p>`;
  setTopActions("");
}
export function refresh() {}
export function deactivate() {}
