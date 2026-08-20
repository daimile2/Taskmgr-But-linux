/** 主程序侧：打开独立「运行新任务」进程窗口 */

export async function openRunDialog() {
  try {
    await fetch("/api/run/open-dialog", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  } catch (e) {
    console.error(e);
    alert("无法打开运行对话框");
  }
}
