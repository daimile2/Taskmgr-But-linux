/** 系统打开：浏览器 / 文件夹（Wails 内 window.open 常无效） */
export async function openURL(url) {
  const u = String(url || "").trim();
  if (!u) return;
  try {
    await fetch("/api/open-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: u }),
    });
  } catch (e) {
    console.error(e);
  }
}

export async function onlineSearch(name) {
  const q = String(name || "").trim();
  if (!q) return;
  await openURL("https://www.bing.com/search?q=" + encodeURIComponent(q));
}

export async function openDir(path) {
  const p = String(path || "").trim();
  if (!p) return;
  try {
    await fetch("/api/open-dir", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: p }),
    });
  } catch (e) {
    console.error(e);
  }
}
