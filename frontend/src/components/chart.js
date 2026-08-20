/** 最新点在右侧；maxY<=0 自适应 */
const MAX = 60;
const histories = {};
export function push(key, value) {
  if (!histories[key]) histories[key] = [];
  const a = histories[key];
  a.push(Number(value) || 0);
  while (a.length > MAX) a.shift();
}
export function getHistory(key) { return histories[key] || []; }
export function paint(canvas, key, color = "#4cc2ff", maxY = 100) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const data = histories[key] || [];
  const w = canvas.width, h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(255,255,255,0.06)";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = (h * i) / 4;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }
  if (data.length < 2) return;
  let top = maxY > 0 ? maxY : Math.max(...data, 0);
  if (top <= 0) top = 1;
  top *= 1.05;
  const step = (w - 1) / (MAX - 1);
  const startX = (MAX - data.length) * step;
  ctx.beginPath();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  for (let i = 0; i < data.length; i++) {
    const x = startX + i * step;
    const y = h - (Math.min(data[i], top) / top) * (h - 2) - 1;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
  const lastX = startX + (data.length - 1) * step;
  ctx.lineTo(lastX, h - 1);
  ctx.lineTo(startX, h - 1);
  ctx.closePath();
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, color + "44");
  g.addColorStop(1, color + "00");
  ctx.fillStyle = g;
  ctx.fill();
}
export function resizeCanvas(canvas, cssW, cssH) {
  if (!canvas) return;
  const w = Math.max(80, Math.floor(cssW || canvas.clientWidth || 320));
  const h = Math.max(40, Math.floor(cssH || canvas.clientHeight || 160));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
}
