// Control: move the machine, feed filament, run macros, work the fans and lights.
import { html, raw, refs, debounce, throttle } from "mf/core/dom.js";
import { store } from "mf/core/store.js";
import { icon } from "mf/ui/icons.js";
import * as actions from "mf/core/actions.js";
import { config } from "mf/core/config.js";
import { can } from "mf/core/auth.js";
import { prefs } from "mf/core/prefs.js";
import { refresh as refreshPos, refreshSoon, toBed } from "mf/core/position.js";
import { availability, runMacro, grouped, macroIcon, openMacroEditor, isPrintingNow } from "mf/ui/macros.js";
import { setRangeFill } from "mf/ui/panels/quicktune.js";
import { toast } from "mf/ui/toast.js";
import { seriesColor } from "mf/ui/chart.js";

const XY_STEPS = [0.1, 1, 10, 50, 100];
const Z_STEPS = [0.025, 0.1, 1, 10];
const SPEEDS = { slow: 0.35, normal: 1, fast: 1.8 };
const DIR = { nw: "back left", n: "back", ne: "back right", w: "left", e: "right", sw: "front left", s: "front", se: "front right" };

export default {
  id: "control",
  mount(el) {
    const parts = [];
    el.innerHTML = `<div class="view-head"><h1>Control</h1></div>`;
    const grid = html`<div class="ctl"></div>`;
    el.append(grid);
    parts.push(jogPanel(grid), extruderPanel(grid), macroPanel(grid), fansPanel(grid));

    // the head's position is worth knowing while you are moving it
    const poll = setInterval(() => { if (!document.hidden) refreshPos(); }, 6000);
    refreshPos();
    return { unmount() { clearInterval(poll); parts.forEach((p) => p.dispose()); } };
  },
};

function lockNote(panel) {
  const n = html`<div class="locked-note">${raw(icon("lock"))}<span>Controls are locked while a print is running. Live tuning stays on the Print screen.</span></div>`;
  n.hidden = true;
  panel.querySelector(".panel-head").after(n);
  return n;
}

// ~~ jog ~~
function jogPanel(host) {
  const el = html`
    <section class="panel a-jog" aria-label="Move">
      <div class="panel-head"><h2 class="panel-title">Move</h2><span class="panel-sub" data-ref="prof"></span>
        <div class="panel-tools"><div class="seg" data-ref="speed" role="group" aria-label="Travel speed">
          ${Object.keys(SPEEDS).map((k) => html`<button type="button" data-s="${k}" aria-pressed="${k === "normal"}">${k[0].toUpperCase() + k.slice(1)}</button>`)}</div></div></div>
      <div class="jog-body">
        <div class="jog-left">
          <div class="pad-wrap">
            <div class="pad" data-ref="pad" role="group" aria-label="Move X and Y">
              ${[["nw", -1, 1, "arrow-up", -45], ["n", 0, 1, "arrow-up", 0], ["ne", 1, 1, "arrow-up", 45],
                 ["w", -1, 0, "arrow-left", 0], ["h", 0, 0, "home", 0], ["e", 1, 0, "arrow-right", 0],
                 ["sw", -1, -1, "arrow-down", 45], ["s", 0, -1, "arrow-down", 0], ["se", 1, -1, "arrow-down", -45]].map(([id, dx, dy, ic, rot]) =>
                  id === "h"
                    ? html`<button class="btn home" data-home="xy" aria-label="Home X and Y" data-tip="Home X and Y">${raw(icon("home"))}</button>`
                    : html`<button class="btn" data-dx="${dx}" data-dy="${dy}" aria-label="Move ${DIR[id]}">${raw(icon(ic).replace("<svg ", `<svg style="transform:rotate(${rot}deg)" `))}</button>`)}
            </div>
            <div class="zcol" data-ref="zcol" role="group" aria-label="Move Z">
              <button class="btn" data-dz="1" aria-label="Z up" data-tip="Z up (bed moves down on a Voron)">${raw(icon("chev-up"))}</button>
              <button class="btn home" data-home="z" aria-label="Home Z" data-tip="Home Z">${raw(icon("home"))}</button>
              <button class="btn" data-dz="-1" aria-label="Z down">${raw(icon("chev-down"))}</button>
            </div>
          </div>
          <div class="step-row"><span class="label">XY</span><div class="seg" data-ref="xy" role="group" aria-label="XY step">${XY_STEPS.map((v) => html`<button type="button" data-v="${v}">${v}</button>`)}</div></div>
          <div class="step-row"><span class="label">Z</span><div class="seg" data-ref="zs" role="group" aria-label="Z step">${Z_STEPS.map((v) => html`<button type="button" data-v="${v}">${v}</button>`)}</div></div>
          <div class="homes">
            <button class="btn" data-home="all">${raw(icon("home"))}Home all</button>
            <button class="btn btn-ghost" data-act="motors" data-tip="Release the stepper motors (M84)">${raw(icon("power"))}Motors off</button>
          </div>
          <div class="keys-hint"><kbd>←</kbd><kbd>→</kbd><kbd>↑</kbd><kbd>↓</kbd> X and Y <kbd>PgUp</kbd><kbd>PgDn</kbd> Z <span>Steps in mm.</span></div>
        </div>
        <div class="map-col">
          <div class="map-head"><div class="pos-read tnum" data-ref="pos"><div><span>X</span><b data-ref="px">–</b></div><div><span>Y</span><b data-ref="py">–</b></div><div><span>Z</span><b data-ref="pz">–</b></div></div>
            <label class="row" style="gap:8px;font-size:var(--fs-sm);color:var(--tx-2)" data-tip="Click the bed map to send the head there. Off by default so a stray click can't move the machine."><span class="switch"><input type="checkbox" data-ref="arm" aria-label="Arm bed map"></span>Click to move</label></div>
          <div class="bedmap is-off" data-ref="map"><canvas data-ref="cv" role="img" aria-label="Bed map, click to move when armed"></canvas></div>
          <div class="hint" data-ref="maphint">Turn on “Click to move” to send the head to a spot on the bed at the current height.</div>
        </div>
      </div>
    </section>`;
  const r = refs(el);
  host.append(el);
  const lock = lockNote(el);

  let xyStep = prefs.get("jogStepXY"), zStep = prefs.get("jogStepZ"), speed = "normal";
  const markSteps = () => {
    r.xy.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.v) === xyStep)));
    r.zs.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(Number(b.dataset.v) === zStep)));
  };
  r.xy.addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { xyStep = Number(b.dataset.v); prefs.set("jogStepXY", xyStep); markSteps(); } });
  r.zs.addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { zStep = Number(b.dataset.v); prefs.set("jogStepZ", zStep); markSteps(); } });
  r.speed.addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; speed = b.dataset.s; r.speed.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); });
  markSteps();

  const baseSpeed = () => {
    const p = store.get("profile");
    return { xy: Math.max(p?.axes?.x?.speed || 0, 6000), z: Math.max(p?.axes?.z?.speed || 0, 600) };
  };
  const doJog = throttle(async (dx, dy, dz) => {
    const b = baseSpeed(), k = SPEEDS[speed];
    try {
      await actions.jog({ x: dx * xyStep, y: dy * xyStep, z: dz * zStep, speed: Math.round((dz ? b.z : b.xy) * k) });
      refreshSoon(700);
    } catch { /* toast shown */ }
  }, 90);

  r.pad.addEventListener("click", (e) => {
    const home = e.target.closest("[data-home]");
    if (home) return actions.home(["x", "y"]).then(() => refreshSoon(2500)).catch(() => {});
    const b = e.target.closest("button[data-dx]");
    if (b) doJog(Number(b.dataset.dx), Number(b.dataset.dy), 0);
  });
  r.zcol.addEventListener("click", (e) => {
    const home = e.target.closest("[data-home]");
    if (home) return actions.home(["z"]).then(() => refreshSoon(2500)).catch(() => {});
    const b = e.target.closest("button[data-dz]");
    if (b) doJog(0, 0, Number(b.dataset.dz));
  });
  el.querySelector('[data-home="all"]').addEventListener("click", () => actions.home().then(() => refreshSoon(4000)).catch(() => {}));
  el.querySelector('[data-act="motors"]').addEventListener("click", () => actions.gcode("M84").catch(() => {}));

  // keyboard: only when you're not typing somewhere
  const onKey = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target;
    if (t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (!document.contains(el) || isPrintingNow() || !store.get("printer.flags.operational")) return;
    const map = { ArrowLeft: [-1, 0, 0], ArrowRight: [1, 0, 0], ArrowUp: [0, 1, 0], ArrowDown: [0, -1, 0], PageUp: [0, 0, 1], PageDown: [0, 0, -1] };
    const m = map[e.key];
    if (!m) return;
    e.preventDefault();
    doJog(...m);
  };
  document.addEventListener("keydown", onKey);

  // bed map
  const cv = r.cv;
  const ctx = cv.getContext("2d");
  let hover = null;
  function drawMap() {
    const profile = store.get("profile");
    const v = profile?.volume || { width: 250, depth: 250, height: 250 };
    const W = v.width || 250, D = v.depth || 250;
    const box = r.map.getBoundingClientRect();
    const size = Math.max(120, Math.round(box.width));
    const dpr = Math.min(devicePixelRatio || 1, 2);
    if (cv.width !== size * dpr) { cv.width = size * dpr; cv.height = Math.round(size * (D / W) * dpr); r.map.style.aspectRatio = `${W} / ${D}`; }
    const w = cv.width / dpr, h = cv.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    const X = (x) => (x / W) * w, Y = (y) => h - (y / D) * h;
    // grid every 50 mm, brighter every 100
    ctx.lineWidth = 1;
    for (let x = 0; x <= W; x += 50) { ctx.strokeStyle = x % 100 === 0 ? css("--line-2") : css("--line-1"); ctx.beginPath(); ctx.moveTo(Math.round(X(x)) + .5, 0); ctx.lineTo(Math.round(X(x)) + .5, h); ctx.stroke(); }
    for (let y = 0; y <= D; y += 50) { ctx.strokeStyle = y % 100 === 0 ? css("--line-2") : css("--line-1"); ctx.beginPath(); ctx.moveTo(0, Math.round(Y(y)) + .5); ctx.lineTo(w, Math.round(Y(y)) + .5); ctx.stroke(); }
    ctx.fillStyle = css("--tx-4"); ctx.font = `500 10px ${css("--font-body")}`;
    ctx.textAlign = "left"; ctx.textBaseline = "top";
    for (let x = 100; x < W; x += 100) ctx.fillText(String(x), X(x) + 3, h - 13);
    ctx.textBaseline = "bottom";
    for (let y = 100; y < D; y += 100) ctx.fillText(String(y), 3, Y(y) - 2);
    // front edge marker so you know which way is which
    ctx.fillStyle = css("--tx-3"); ctx.textAlign = "center"; ctx.textBaseline = "bottom";
    ctx.fillText("front", w / 2, h - 2);
    // mesh points area / toolhead
    const pos = store.get("position");
    if (pos) {
      const bp = toBed(pos, profile);
      const px = X(bp.x), py = Y(bp.y);
      ctx.strokeStyle = css("--accent"); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(px - 12, py); ctx.lineTo(px + 12, py); ctx.moveTo(px, py - 12); ctx.lineTo(px, py + 12); ctx.stroke();
      ctx.beginPath(); ctx.arc(px, py, 6, 0, 6.283); ctx.stroke();
      ctx.fillStyle = css("--accent"); ctx.beginPath(); ctx.arc(px, py, 2.2, 0, 6.283); ctx.fill();
    }
    if (hover && r.arm.checked) {
      const hx = (hover.x / w) * W, hy = ((h - hover.y) / h) * D;
      ctx.strokeStyle = css("--accent-2"); ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(hover.x, hover.y, 9, 0, 6.283); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = css("--tx-1"); ctx.textAlign = hover.x > w / 2 ? "right" : "left"; ctx.textBaseline = "bottom";
      ctx.fillText(`X${hx.toFixed(0)}  Y${hy.toFixed(0)}`, hover.x + (hover.x > w / 2 ? -12 : 12), hover.y - 8);
    }
  }
  const redraw = debounce(drawMap, 16);
  new ResizeObserver(redraw).observe(r.map);
  const pt = (e) => { const b = cv.getBoundingClientRect(); return { x: e.clientX - b.left, y: e.clientY - b.top, w: b.width, h: b.height }; };
  cv.addEventListener("pointermove", (e) => { hover = pt(e); redraw(); });
  cv.addEventListener("pointerleave", () => { hover = null; redraw(); });
  cv.addEventListener("click", async (e) => {
    if (!r.arm.checked) { toast.info("Bed map is off", "Turn on “Click to move” first."); return; }
    const p = pt(e), v = store.get("profile")?.volume || { width: 250, depth: 250 };
    const x = (p.x / p.w) * (v.width || 250), y = ((p.h - p.y) / p.h) * (v.depth || 250);
    const machine = v.origin === "center" ? { x: x - (v.width || 0) / 2, y: y - (v.depth || 0) / 2 } : { x, y };
    try { await actions.moveTo({ ...machine, speed: Math.round(baseSpeed().xy * SPEEDS[speed]) }); refreshSoon(1500); } catch { /* toast shown */ }
  });
  r.arm.addEventListener("change", () => {
    r.map.classList.toggle("is-off", !r.arm.checked);
    r.maphint.textContent = r.arm.checked ? "Click anywhere on the map to move the head there at the current height. Home first if the machine isn't homed." : "Turn on “Click to move” to send the head to a spot on the bed at the current height.";
    redraw();
  });

  function render() {
    const s = store.state;
    const f = s.printer.flags;
    const op = f.operational && can("control");
    const printing = isPrintingNow();
    lock.hidden = !(printing && f.operational !== false);
    el.querySelectorAll(".jog-left button, .arm").forEach((b) => { b.disabled = !op || printing; });
    r.arm.disabled = !op || printing;
    const pos = s.position;
    r.px.textContent = pos ? pos.x.toFixed(2) : "–";
    r.py.textContent = pos ? pos.y.toFixed(2) : "–";
    r.pz.textContent = pos ? pos.z.toFixed(2) : "–";
    const p = s.profile;
    r.prof.textContent = p?.volume ? `${p.volume.width} × ${p.volume.depth} × ${p.volume.height} mm` : "";
    redraw();
  }
  const offs = ["printer", "position", "profile", "auth"].map((k) => store.on(k, render));
  render();
  return { dispose() { offs.forEach((o) => o()); document.removeEventListener("keydown", onKey); el.remove(); } };
}

// ~~ extruder ~~
function extruderPanel(host) {
  const el = html`
    <section class="panel a-ext" aria-label="Extruder">
      <div class="panel-head"><h2 class="panel-title">Extruder</h2><span class="chip" data-ref="temp">–</span></div>
      <div class="ext-body">
        <div class="row gap-3 wrap">
          <div class="field grow" style="min-width:140px"><label for="ex-len">Length</label>
            <div class="numfield"><input id="ex-len" type="number" inputmode="decimal" min="0.1" step="1" data-ref="len"><span class="unit">mm</span></div></div>
          <div class="field grow" style="min-width:140px"><label for="ex-spd">Speed</label>
            <div class="numfield"><input id="ex-spd" type="number" inputmode="decimal" min="0.5" step="0.5" data-ref="spd"><span class="unit">mm/s</span></div></div>
        </div>
        <div class="chips" data-ref="lens">${[1, 5, 10, 25, 50, 100].map((v) => html`<button class="chip" data-len="${v}">${v} mm</button>`)}</div>
        <div class="ext-pair">
          <button class="btn" data-ref="retract">${raw(icon("chev-up"))}Retract</button>
          <button class="btn btn-primary" data-ref="extrude">${raw(icon("chev-down"))}Extrude</button>
        </div>
        <div class="hint" data-ref="cold" hidden></div>
        <div class="col gap-2">
          <span class="label">Heat the nozzle</span>
          <div class="chips" data-ref="heats"></div>
        </div>
      </div>
    </section>`;
  const r = refs(el);
  host.append(el);
  const lock = lockNote(el);
  r.len.value = prefs.get("extrudeLength");
  r.spd.value = (prefs.get("extrudeSpeed") / 60).toFixed(1).replace(/\.0$/, "");
  const feed = () => Math.round(Math.max(0.5, Number(r.spd.value) || 5) * 60);
  const length = () => Math.max(0.1, Number(r.len.value) || 5);
  r.len.addEventListener("change", () => prefs.set("extrudeLength", length()));
  r.spd.addEventListener("change", () => prefs.set("extrudeSpeed", feed()));
  r.lens.addEventListener("click", (e) => { const b = e.target.closest("[data-len]"); if (b) { r.len.value = b.dataset.len; prefs.set("extrudeLength", Number(b.dataset.len)); } });
  r.extrude.addEventListener("click", () => actions.extrude(length(), feed()).catch(() => {}));
  r.retract.addEventListener("click", () => actions.extrude(-length(), feed()).catch(() => {}));
  const renderHeats = () => {
    r.heats.replaceChildren(...(config.data.presets || []).map((p) => {
      const b = html`<button class="chip" data-tip="Heat the nozzle to ${p.nozzle}°">${p.name} ${p.nozzle}°</button>`;
      b.addEventListener("click", () => actions.setTemp("tool0", p.nozzle).then(() => toast.info(`Nozzle heating to ${p.nozzle}°`, "", { timeout: 1800 })).catch(() => {}));
      return b;
    }));
  };
  function render() {
    const t = store.get("temps.tool0");
    const f = store.get("printer.flags");
    const on = f.operational && can("control") && !isPrintingNow();
    lock.hidden = !isPrintingNow();
    r.temp.textContent = t?.actual != null ? `${t.actual.toFixed(0)}°${t.target ? ` of ${Math.round(t.target)}°` : ""}` : "–";
    r.temp.className = "chip" + (t?.actual >= 170 ? " is-ok" : "");
    const cold = t?.actual != null && t.actual < 170;
    r.cold.hidden = !(cold && on);
    r.cold.textContent = `The nozzle is ${Math.round(t?.actual ?? 0)}°. Klipper refuses to extrude below 170° (min_extrude_temp), so heat it first.`;
    el.querySelectorAll("input, button").forEach((n) => { n.disabled = !on; });
    // no point offering a move Klipper will refuse
    if (on && cold) r.extrude.disabled = r.retract.disabled = true;
  }
  const offs = [store.on("temps", render), store.on("printer", render), store.on("config", () => { renderHeats(); render(); })];
  renderHeats(); render();
  return { dispose() { offs.forEach((o) => o()); el.remove(); } };
}

// ~~ macros ~~
function macroPanel(host) {
  const el = html`
    <section class="panel a-macros" aria-label="Macros">
      <div class="panel-head"><h2 class="panel-title">Macros</h2>
        <div class="panel-tools macro-tools">
          <input class="input macro-search" type="search" placeholder="Filter macros" aria-label="Filter macros" data-ref="q">
          <button class="btn btn-sm" data-ref="edit">${raw(icon("edit"))}Edit</button>
        </div></div>
      <div data-ref="body"></div>
    </section>`;
  const r = refs(el);
  host.append(el);
  r.edit.addEventListener("click", () => openMacroEditor());
  let sig = "";
  function render() {
    const q = r.q.value.trim().toLowerCase();
    const list = config.data.macros.filter((m) => !q || `${m.name} ${m.cat} ${m.gcode}`.toLowerCase().includes(q));
    const groups = grouped(list);
    const stateSig = JSON.stringify([q, list.map((m) => [m.id, availability(m).ok])]);
    if (stateSig === sig) return;
    sig = stateSig;
    r.body.replaceChildren(...(groups.size ? Array.from(groups, ([cat, ms]) => html`<div class="macro-group"><h3>${cat}</h3><div class="macro-grid"></div></div>`) : [html`<div class="empty"><div class="empty-title">No macros match</div><p class="empty-text">Try a different word, or add one with Edit.</p></div>`]));
    Array.from(groups).forEach(([cat, ms], i) => {
      const gridEl = r.body.children[i]?.querySelector(".macro-grid");
      if (!gridEl) return;
      for (const m of ms) {
        const a = availability(m);
        const b = html`<button class="btn macro-btn" ${a.ok ? "" : "disabled"} data-tip="${a.ok ? m.gcode.split("\n")[0] : a.reason}">${raw(macroIcon(m))}<span>${m.name}</span></button>`;
        b.addEventListener("click", () => runMacro(m));
        gridEl.append(b);
      }
    });
  }
  r.q.addEventListener("input", render);
  const offs = ["printer", "temps", "config", "klipper", "auth"].map((k) => store.on(k, render));
  render();
  return { dispose() { offs.forEach((o) => o()); el.remove(); } };
}

// ~~ fans and lights ~~
const COLORS = [["White", "#ffffff"], ["Warm", "#ffb46b"], ["Green", "#86d929"], ["Pink", "#e951b0"], ["Red", "#ff2a2a"], ["Blue", "#2a6bff"], ["Off", "#000000"]];

function fansPanel(host) {
  const el = html`
    <section class="panel a-fans" aria-label="Fans and lights">
      <div class="panel-head"><h2 class="panel-title">Fans and lights</h2></div>
      <div class="fans-body">
        <div class="slider-row"><span class="k">${raw(icon("fan"))}Part fan</span><span class="v" data-ref="fanV">0%</span><input class="range" type="range" min="0" max="100" step="5" value="0" data-ref="fan" aria-label="Part cooling fan"></div>
        <div class="col gap-4" data-ref="extra"></div>
        <div class="col gap-2" data-ref="leds"></div>
        <div class="hint" data-ref="empty" hidden>Add your Nevermore, exhaust fan or toolhead LEDs in Settings, then they show up here.</div>
      </div>
    </section>`;
  const r = refs(el);
  host.append(el);
  const send = debounce(() => actions.partFan(Number(r.fan.value)).catch(() => {}), 180);
  r.fan.addEventListener("input", () => { r.fanV.textContent = `${r.fan.value}%`; setRangeFill(r.fan); send(); });
  setRangeFill(r.fan);

  function renderExtras() {
    const fans = (config.data.fans || []).filter((f) => f.type === "generic" && f.enabled);
    r.extra.replaceChildren(...fans.map((f) => {
      const row = html`<div class="slider-row"><span class="k">${raw(icon("fan"))}${f.name}</span><span class="v">0%</span><input class="range" type="range" min="0" max="100" step="5" value="0" aria-label="${f.name}"></div>`;
      const inp = row.querySelector("input"), out = row.querySelector(".v");
      const go = debounce(() => actions.genericFan(f.klipper, Number(inp.value)).catch(() => {}), 180);
      inp.addEventListener("input", () => { out.textContent = `${inp.value}%`; setRangeFill(inp); go(); });
      setRangeFill(inp);
      return row;
    }));
    const leds = (config.data.leds || []).filter((l) => l.enabled);
    r.leds.replaceChildren(...leds.map((l) => {
      const row = html`<div class="col gap-2"><span class="label">${l.name} LEDs</span><div class="swatches"></div></div>`;
      const sw = row.querySelector(".swatches");
      const set = (hex) => {
        const n = parseInt(hex.slice(1), 16);
        const [rr, gg, bb] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => (v / 255).toFixed(2));
        return actions.gcode(`SET_LED LED=${l.klipper} RED=${rr} GREEN=${gg} BLUE=${bb} TRANSMIT=1`).catch(() => {});
      };
      for (const [name, hex] of COLORS) {
        const b = html`<button class="swatch" style="--c:${hex}" aria-label="${l.name}: ${name}" data-tip="${name}"></button>`;
        b.addEventListener("click", () => set(hex));
        sw.append(b);
      }
      const pick = html`<input class="color-input" type="color" value="#86d929" aria-label="Custom colour for ${l.name}">`;
      pick.addEventListener("change", () => set(pick.value));
      sw.append(pick);
      return row;
    }));
    r.empty.hidden = fans.length + leds.length > 0;
  }
  function enable() {
    const on = store.get("printer.flags.operational") && can("control");
    el.querySelectorAll("input, button").forEach((n) => { n.disabled = !on; });
  }
  const offs = [store.on("printer", enable), store.on("config", () => { renderExtras(); enable(); })];
  renderExtras(); enable();
  return { dispose() { offs.forEach((o) => o()); el.remove(); } };
}
