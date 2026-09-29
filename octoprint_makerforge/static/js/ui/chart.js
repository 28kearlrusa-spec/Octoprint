// Canvas temperature chart: multiple heaters, dashed targets, hover read-out, and no library.
import { temps } from "mf/core/telemetry.js";

const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

export const SERIES_META = {
  tool0: { label: "Nozzle", color: "--heat-nozzle" },
  tool1: { label: "Nozzle 2", color: "--heat-aux" },
  tool2: { label: "Nozzle 3", color: "--accent" },
  bed: { label: "Bed", color: "--heat-bed" },
  chamber: { label: "Chamber", color: "--heat-chamber" },
};
export const seriesLabel = (k) => SERIES_META[k]?.label || k;
export const seriesColor = (k) => css(SERIES_META[k]?.color || "--accent");

function niceStep(range, target) {
  const raw = range / target;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const n = raw / mag;
  return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
}

export class TempChart {
  constructor(canvas, { windowSec = 600, tip } = {}) {
    this.c = canvas;
    this.ctx = canvas.getContext("2d");
    this.windowSec = windowSec;
    this.hidden = new Set();
    this.hover = null;         // {x}
    this.tip = tip;            // element for the hover read-out
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.pad = { l: 40, r: 14, t: 12, b: 24 };
    this.queued = false;
    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(canvas);
    this._off = temps.on(() => this.schedule());
    this._move = (e) => this.onMove(e);
    this._leave = () => { this.hover = null; this.hideTip(); this.schedule(); };
    canvas.addEventListener("pointermove", this._move);
    canvas.addEventListener("pointerdown", this._move);
    canvas.addEventListener("pointerleave", this._leave);
    canvas.style.touchAction = "pan-y";
    this.resize();
  }

  destroy() {
    this._ro.disconnect();
    this._off();
    this.c.removeEventListener("pointermove", this._move);
    this.c.removeEventListener("pointerdown", this._move);
    this.c.removeEventListener("pointerleave", this._leave);
  }

  setWindow(sec) { this.windowSec = sec; this.schedule(); }
  setHidden(set) { this.hidden = new Set(set); this.schedule(); }

  resize() {
    const r = this.c.getBoundingClientRect();
    const w = Math.max(50, Math.round(r.width)), h = Math.max(50, Math.round(r.height));
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.c.width = Math.round(w * this.dpr);
    this.c.height = Math.round(h * this.dpr);
    this.w = w; this.h = h;
    this.schedule();
  }

  schedule() {
    if (this.queued) return;
    this.queued = true;
    requestAnimationFrame(() => { this.queued = false; this.draw(); });
  }

  onMove(e) {
    const r = this.c.getBoundingClientRect();
    this.hover = { x: e.clientX - r.left, y: e.clientY - r.top };
    this.schedule();
  }

  hideTip() { if (this.tip) this.tip.hidden = true; }

  draw() {
    const { ctx, w, h, pad, dpr } = this;
    if (!w) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const now = Date.now();
    const t1 = now, t0 = now - this.windowSec * 1000;
    const keys = temps.series().filter((k) => !this.hidden.has(k));
    const samples = temps.samples;
    // visible slice
    let start = 0;
    while (start < samples.length && samples[start].t < t0 - 30000) start++;
    const view = samples.slice(start);

    // y range
    let lo = Infinity, hi = -Infinity;
    for (const s of view) for (const k of keys) {
      const v = s[k]; if (!v) continue;
      if (v.a != null) { lo = Math.min(lo, v.a); hi = Math.max(hi, v.a); }
      if (v.t) hi = Math.max(hi, v.t);
    }
    if (!isFinite(lo)) { lo = 20; hi = 60; }
    lo = Math.max(0, Math.floor((Math.min(lo, 30) - 2) / 10) * 10);
    hi = Math.max(hi + (hi - lo) * 0.06, lo + 40);
    const step = niceStep(hi - lo, 5);
    hi = Math.ceil(hi / step) * step;

    const X = (t) => pad.l + ((t - t0) / (t1 - t0)) * (w - pad.l - pad.r);
    const Y = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * (h - pad.t - pad.b);

    const grid = css("--line-1"), gridStrong = css("--line-2"), label = css("--tx-3");

    // grid + y labels
    ctx.font = `500 11px ${css("--font-body") || "sans-serif"}`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "right";
    ctx.lineWidth = 1;
    for (let v = Math.ceil(lo / step) * step; v <= hi + 0.001; v += step) {
      const y = Math.round(Y(v)) + 0.5;
      ctx.strokeStyle = v === 0 ? gridStrong : grid;
      ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke();
      ctx.fillStyle = label;
      ctx.fillText(`${v}°`, pad.l - 8, y);
    }
    // x labels
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const xStep = this.windowSec <= 300 ? 60 : this.windowSec <= 1200 ? 300 : this.windowSec <= 3600 ? 600 : 1800;
    for (let s = xStep; s < this.windowSec; s += xStep) {
      const x = Math.round(X(t1 - s * 1000)) + 0.5;
      ctx.strokeStyle = grid;
      ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, h - pad.b); ctx.stroke();
      ctx.fillStyle = label;
      ctx.fillText(`−${s >= 3600 ? (s / 3600) + "h" : (s / 60) + "m"}`, x, h - pad.b + 6);
    }
    ctx.fillStyle = label;
    ctx.textAlign = "right";
    ctx.fillText("now", w - pad.r, h - pad.b + 6);

    ctx.save();
    ctx.beginPath();
    ctx.rect(pad.l, pad.t - 2, w - pad.l - pad.r + 2, h - pad.t - pad.b + 4);
    ctx.clip();

    // decimate to about 2 points per pixel
    const maxPts = Math.max(60, (w - pad.l - pad.r) * 2);
    const stride = Math.max(1, Math.ceil(view.length / maxPts));

    for (const k of keys) {
      const col = seriesColor(k);
      // target (stepped, dashed)
      ctx.strokeStyle = col;
      ctx.globalAlpha = 0.5;
      ctx.setLineDash([5, 5]);
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      let started = false, lastY = null;
      for (let i = 0; i < view.length; i += stride) {
        const v = view[i][k];
        if (!v || !v.t) { started = false; continue; }
        const x = X(view[i].t), y = Y(v.t);
        if (!started) { ctx.moveTo(x, y); started = true; }
        else { ctx.lineTo(x, lastY); ctx.lineTo(x, y); }
        lastY = y;
      }
      if (started) ctx.lineTo(X(t1), lastY);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;

      // actual
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.9;
      ctx.lineJoin = "round";
      ctx.beginPath();
      let first = true, lastX = 0, firstX = 0;
      for (let i = 0; i < view.length; i += stride) {
        const v = view[i][k];
        if (!v || v.a == null) { first = true; continue; }
        const x = X(view[i].t), y = Y(v.a);
        if (first) { ctx.moveTo(x, y); first = false; firstX = x; } else ctx.lineTo(x, y);
        lastX = x;
      }
      ctx.stroke();
      // soft fill under the first heater so the chart has a shape
      if (k === keys[0] && lastX > firstX) {
        const g = ctx.createLinearGradient(0, pad.t, 0, h - pad.b);
        g.addColorStop(0, col + "38");
        g.addColorStop(1, col + "00");
        ctx.lineTo(lastX, h - pad.b); ctx.lineTo(firstX, h - pad.b); ctx.closePath();
        ctx.fillStyle = g; ctx.fill();
      }
      // live dot
      const last = view[view.length - 1]?.[k];
      if (last?.a != null) {
        ctx.fillStyle = col;
        ctx.beginPath(); ctx.arc(X(view[view.length - 1].t), Y(last.a), 3.2, 0, 6.283); ctx.fill();
      }
    }
    ctx.restore();

    // hover
    if (this.hover && view.length) {
      const hx = Math.min(Math.max(this.hover.x, pad.l), w - pad.r);
      const tHover = t0 + ((hx - pad.l) / (w - pad.l - pad.r)) * (t1 - t0);
      let best = view[0], bd = Infinity;
      for (const s of view) { const d = Math.abs(s.t - tHover); if (d < bd) { bd = d; best = s; } }
      const sx = Math.round(X(best.t)) + 0.5;
      ctx.strokeStyle = css("--tx-4");
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(sx, pad.t); ctx.lineTo(sx, h - pad.b); ctx.stroke();
      ctx.setLineDash([]);
      const rows = [];
      for (const k of keys) {
        const v = best[k]; if (!v || v.a == null) continue;
        ctx.fillStyle = seriesColor(k);
        ctx.beginPath(); ctx.arc(sx, Y(v.a), 4, 0, 6.283); ctx.fill();
        ctx.strokeStyle = css("--bg-1"); ctx.lineWidth = 1.5; ctx.stroke();
        rows.push({ k, a: v.a, t: v.t });
      }
      this.showTip(rows, best.t, sx);
    } else this.hideTip();
  }

  showTip(rows, t, x) {
    if (!this.tip) return;
    const ago = Math.max(0, Math.round((Date.now() - t) / 1000));
    const when = ago < 5 ? "now" : ago < 90 ? `${ago}s ago` : `${Math.round(ago / 60)} min ago`;
    this.tip.hidden = false;
    this.tip.innerHTML = `<div class="ct-when">${when}</div>` + rows.map((r) =>
      `<div class="ct-row"><i style="background:${seriesColor(r.k)}"></i><span>${seriesLabel(r.k).replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]))}</span><b>${r.a.toFixed(1)}°</b>${r.t ? `<em>of ${Math.round(r.t)}°</em>` : ""}</div>`).join("");
    const tw = this.tip.offsetWidth;
    const left = x + 14 + tw > this.w ? x - tw - 14 : x + 14;
    this.tip.style.left = `${Math.max(4, left)}px`;
  }
}

/** Tiny inline trend line for heater tiles. values: numbers (oldest first). */
export function sparkline(canvas, values, color, { min, max } = {}) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (!w || !h) return;
  if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (values.length < 2) return;
  const lo = min ?? Math.min(...values), hi = max ?? Math.max(...values);
  const span = Math.max(hi - lo, 8);
  ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.lineJoin = "round";
  ctx.beginPath();
  values.forEach((v, i) => {
    const x = (i / (values.length - 1)) * (w - 2) + 1;
    const y = h - 2 - ((v - lo) / span) * (h - 4);
    i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
  });
  ctx.stroke();
}
