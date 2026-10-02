// The layer being printed, drawn from above: what's done in solid ink, what's left faint.
// Only that one layer is read from the file (an HTTP range request), so it stays light on a Pi.
import { octo } from "mf/core/api.js";

const MAX_BYTES = 3 * 1024 * 1024;   // a layer bigger than this is drawn from its first 3 MB

/** Parse one layer's G-code into extrusion segments with the byte offset each one ends at. */
export function parseLayer(text, startByte) {
  const segs = [];
  let x = null, y = null, absXY = true, offset = startByte;
  const enc = new TextEncoder();
  for (const raw of text.split("\n")) {
    const bytes = enc.encode(raw).length + 1;
    const line = raw.replace(/;.*/, "").trim().toUpperCase();
    offset += bytes;
    if (!line) continue;
    if (line.startsWith("G90")) { absXY = true; continue; }
    if (line.startsWith("G91")) { absXY = false; continue; }
    const m = /^G([0-3])\b/.exec(line);
    if (!m) continue;
    const nx = /X(-?[\d.]+)/.exec(line), ny = /Y(-?[\d.]+)/.exec(line), ne = /E(-?[\d.]+)/.exec(line);
    let tx = x, ty = y;
    if (nx) tx = absXY ? +nx[1] : (x ?? 0) + +nx[1];
    if (ny) ty = absXY ? +ny[1] : (y ?? 0) + +ny[1];
    const extruding = m[1] !== "0" && ne && +ne[1] > 0;
    if (x != null && y != null && tx != null && ty != null && (tx !== x || ty !== y)) segs.push([x, y, tx, ty, extruding ? 1 : 0, offset]);
    x = tx; y = ty;
  }
  return segs;
}

export function createLayerView(canvas) {
  const ctx = canvas.getContext("2d");
  let key = null, segs = [], pos = 0, bed = { w: 300, d: 300, center: false }, loading = null;

  function css(name, fallback) {
    return getComputedStyle(canvas).getPropertyValue(name).trim() || fallback;
  }

  function draw() {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    // fit what's printed this layer (plus a margin) rather than the whole bed, so small parts are readable
    const ext = segs.filter((s) => s[4]);
    if (!ext.length) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const s of ext) { minX = Math.min(minX, s[0], s[2]); maxX = Math.max(maxX, s[0], s[2]); minY = Math.min(minY, s[1], s[3]); maxY = Math.max(maxY, s[1], s[3]); }
    const pad = 4, sx = (w - pad * 2) / Math.max(1, maxX - minX), sy = (h - pad * 2) / Math.max(1, maxY - minY), k = Math.min(sx, sy);
    const ox = pad + ((w - pad * 2) - (maxX - minX) * k) / 2, oy = pad + ((h - pad * 2) - (maxY - minY) * k) / 2;
    const X = (v) => ox + (v - minX) * k, Y = (v) => h - (oy + (v - minY) * k);   // Y up, like the bed seen from above
    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(0.8, Math.min(2.2, k * 0.45));
    const todo = css("--line-3", "#999"), done = css("--accent", "#86d929");
    for (const pass of [0, 1]) {
      ctx.strokeStyle = pass ? done : todo;
      ctx.beginPath();
      for (const s of ext) {
        const isDone = s[5] <= pos;
        if (isDone !== !!pass) continue;
        ctx.moveTo(X(s[0]), Y(s[1]));
        ctx.lineTo(X(s[2]), Y(s[3]));
      }
      ctx.stroke();
    }
    // the nozzle, roughly: the end of the last finished segment
    const last = ext.filter((s) => s[5] <= pos).pop();
    if (last) {
      ctx.fillStyle = css("--tx-1", "#fff");
      ctx.beginPath(); ctx.arc(X(last[2]), Y(last[3]), 3, 0, Math.PI * 2); ctx.fill();
    }
  }

  async function load(path, start, end) {
    const k = `${path}|${start}`;
    if (key === k) return;
    key = k;
    const stop = Math.min(end, start + MAX_BYTES) - 1;
    const req = (loading = fetch(octo.downloadUrl(path), { credentials: "same-origin", headers: { Range: `bytes=${start}-${stop}` } }));
    try {
      const res = await req;
      if (loading !== req) return;
      if (res.status !== 206) { segs = []; draw(); return; }   // no range support: skip rather than download the whole file
      const text = await res.text();
      if (loading !== req) return;
      segs = parseLayer(text, start);
      draw();
    } catch { segs = []; draw(); }
  }

  const ro = new ResizeObserver(draw);
  ro.observe(canvas);

  return {
    /** layers: the layer map ({layers:[[z, filepos, e], ...]}), size: file size in bytes */
    update({ path, layers, filepos, size }) {
      const L = layers?.layers;
      if (!path || !L?.length || filepos == null) return false;
      let i = 0;
      for (let lo = 0, hi = L.length - 1; lo <= hi;) { const mid = (lo + hi) >> 1; if (L[mid][1] <= filepos) { i = mid; lo = mid + 1; } else hi = mid - 1; }
      const start = L[i][1], end = i + 1 < L.length ? L[i + 1][1] : (size || start + MAX_BYTES);
      pos = filepos;
      load(path, start, end);
      draw();
      return true;
    },
    setBed(b) { bed = b || bed; },
    destroy() { ro.disconnect(); key = null; },
  };
}
