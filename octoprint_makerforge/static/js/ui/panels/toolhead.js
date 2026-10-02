// Toolhead: where the head is, small moves, homing and levelling, without leaving the Print page.
import { html, raw, refs } from "mf/core/dom.js";
import { store } from "mf/core/store.js";
import { icon } from "mf/ui/icons.js";
import * as actions from "mf/core/actions.js";
import { can } from "mf/core/auth.js";
import { prefs } from "mf/core/prefs.js";
import { config } from "mf/core/config.js";
import { DEFAULT_CONFIG } from "mf/core/defaults.js";
import { refresh as readPosition, refreshSoon } from "mf/core/position.js";
import { isPrinting } from "mf/core/status.js";
import { hasCommand } from "mf/core/klipper-watch.js";
import { runMacro } from "mf/ui/macros.js";

const STEPS = [0.1, 1, 10, 50];
const fmt = (v) => (typeof v === "number" && Number.isFinite(v) ? v.toFixed(2) : "–");

// the user's own version of a built-in macro if they edited it, else the built-in one
const macro = (id) => (config.data.macros || []).find((m) => m.id === id) || DEFAULT_CONFIG.macros.find((m) => m.id === id);

export function mountToolhead(host) {
  let step = Number(sessionStorage.getItem("mf.toolhead.step")) || 10;
  if (!STEPS.includes(step)) step = 10;
  const el = html`
    <section class="panel a-toolhead" aria-label="Toolhead">
      <div class="panel-head"><h2 class="panel-title">Toolhead</h2><span class="panel-sub" data-ref="age"></span>
        <div class="panel-tools"><button class="btn btn-sm btn-ghost btn-icon" data-ref="read" aria-label="Read the position now" data-tip="Read the position now (M114)">${raw(icon("refresh"))}</button></div></div>
      <div class="th-body">
        <div class="th-pos tnum" data-ref="pos">
          <div><span>X</span><b data-ref="x">–</b></div><div><span>Y</span><b data-ref="y">–</b></div><div><span>Z</span><b data-ref="z">–</b></div>
        </div>
        <div class="th-lock hint" data-ref="lock" hidden>${raw(icon("lock", "i i-sm"))}Moves are locked while a print runs. Z shows the current layer height.</div>
        <div class="th-jog" data-ref="jog">
          <div class="seg th-steps" data-ref="steps" role="group" aria-label="Step in millimetres">${STEPS.map((v) => html`<button type="button" data-v="${v}" aria-pressed="${v === step}">${v}</button>`)}</div>
          <div class="th-axes" role="group" aria-label="Move one step">
            ${[["x", -1], ["x", 1], ["y", -1], ["y", 1], ["z", -1], ["z", 1]].map(([a, d]) => html`<button class="btn btn-sm" data-axis="${a}" data-d="${d}" aria-label="${a.toUpperCase()} ${d < 0 ? "minus" : "plus"} one step">${a.toUpperCase()}${d < 0 ? "−" : "+"}</button>`)}
          </div>
        </div>
        <div class="th-acts" data-ref="acts">
          <button class="btn btn-sm" data-m="home">${raw(icon("home"))}Home all</button>
          <button class="btn btn-sm" data-m="home-xy">Home XY</button>
          <button class="btn btn-sm" data-m="home-z">Home Z</button>
          <button class="btn btn-sm" data-m="level" data-ref="level">${raw(icon("qgl"))}<span data-ref="levelName">Gantry level</span></button>
          <button class="btn btn-sm" data-m="park">Park</button>
          <button class="btn btn-sm" data-m="motors-off" data-tip="Release the stepper motors (M84)">${raw(icon("power"))}Motors off</button>
        </div>
      </div>
    </section>`;
  const r = refs(el);
  host.append(el);

  // QGL on a 2.4, Z tilt on a Trident; once Klipper has listed its commands, only what exists
  function levelMacro() {
    if (store.get("klipper.detected") === false) return null;
    if (hasCommand("QUAD_GANTRY_LEVEL") !== false) return "qgl";
    if (hasCommand("Z_TILT_ADJUST")) return "z-tilt";
    return null;
  }

  function render() {
    const s = store.state;
    const p = s.position;
    const printing = isPrinting(s);
    r.x.textContent = fmt(p?.x);
    r.y.textContent = fmt(p?.y);
    r.z.textContent = printing && s.currentZ != null ? fmt(Number(s.currentZ)) : fmt(p?.z);
    age();

    const f = s.printer.flags;
    const online = !!(f.operational || f.printing || f.paused);
    const allowed = can("control");
    r.lock.hidden = !printing;
    for (const b of el.querySelectorAll(".th-axes button, .th-acts button")) b.disabled = !online || !allowed || printing;
    r.steps.querySelectorAll("button").forEach((b) => { b.disabled = !online || !allowed || printing; });
    r.read.disabled = !online || printing;

    const lv = levelMacro();
    r.level.hidden = !lv;
    if (lv) r.levelName.textContent = lv === "qgl" ? "Gantry level" : "Z tilt";
  }

  function age() {
    const at = store.get("position")?.at;
    const every = Number(prefs.get("posPoll")) || 0;
    if (!at) { r.age.textContent = every ? `reads every ${every} s while idle` : "press refresh to read"; return; }
    const sec = Math.max(0, Math.round((Date.now() - at) / 1000));
    r.age.textContent = sec < 2 ? "just read" : sec < 120 ? `read ${sec} s ago` : `read ${Math.round(sec / 60)} min ago`;
  }

  r.steps.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-v]");
    if (!b) return;
    step = Number(b.dataset.v);
    try { sessionStorage.setItem("mf.toolhead.step", String(step)); } catch { /* private mode */ }
    r.steps.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  });
  el.querySelector(".th-axes").addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-axis]");
    if (!b) return;
    try {
      await actions.jog({ [b.dataset.axis]: step * Number(b.dataset.d) });
      refreshSoon();
    } catch { /* toast shown */ }
  });
  r.acts.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-m]");
    if (!b) return;
    const id = b.dataset.m === "level" ? levelMacro() : b.dataset.m;
    const m = id && macro(id);
    if (m) runMacro(m).then((sent) => { if (sent) refreshSoon(id.startsWith("home") || id === "park" ? 2500 : 900); });
  });
  r.read.addEventListener("click", () => readPosition({ force: true }));

  // keep the reading fresh while the printer is idle and this page is in front
  let poll = null;
  function schedule() {
    clearInterval(poll);
    const every = Number(prefs.get("posPoll")) || 0;
    if (every > 0) poll = setInterval(() => { if (!document.hidden) readPosition(); }, every * 1000);
  }
  schedule();
  readPosition();
  const ticker = setInterval(age, 1000);

  const offs = [
    store.on("position", render), store.on("printer", render), store.on("currentZ", render),
    store.on("klipper", render), store.on("auth", render),
    prefs.on((k) => { if (k === "posPoll" || k === "*") { schedule(); age(); } }),
  ];
  render();
  return { dispose() { clearInterval(poll); clearInterval(ticker); offs.forEach((o) => o()); el.remove(); } };
}
