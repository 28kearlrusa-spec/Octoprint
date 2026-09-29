// Calibration tools: PID, pressure advance, input shaper, live limits, heat soak and calculators.
import { html, raw, refs, copyText } from "mf/core/dom.js";
import { store, bus } from "mf/core/store.js";
import { icon } from "mf/ui/icons.js";
import * as actions from "mf/core/actions.js";
import { hasCommand } from "mf/core/klipper-watch.js";
import { isPrintingNow } from "mf/ui/macros.js";
import { toast } from "mf/ui/toast.js";
import { can } from "mf/core/auth.js";
import { confirmDialog } from "mf/ui/dialog.js";
import { chime } from "mf/core/events.js";
import { duration, relative } from "mf/core/format.js";

const run = (cmd) => actions.gcode(cmd).catch(() => {});
const idle = () => store.get("printer.flags.operational") && !isPrintingNow() && can("control");
const online = () => store.get("printer.flags.operational") && can("control");
const enableAll = (el, fn) => el.querySelectorAll("button, input, select").forEach((n) => { n.disabled = !fn(); });

const shell = (title, sub, body) => html`
  <section class="panel" aria-label="${title}">
    <div class="panel-head"><h2 class="panel-title">${title}</h2>${sub ? html`<span class="panel-sub">${sub}</span>` : ""}</div>
    <div class="tool-body">${body}</div>
  </section>`;

const num = (input, dflt = 0) => { const v = parseFloat(input.value); return Number.isFinite(v) ? v : dflt; };

// ~~ PID ~~
export function pidPanel(host) {
  const el = shell("PID tuning", "heater control loops", html`<div class="col gap-4">
    <div class="tool-row">
      <div class="field"><label for="pid-h">Heater</label><select class="select" id="pid-h" data-ref="heater"><option value="extruder">Extruder</option><option value="heater_bed">Bed</option></select></div>
      <div class="field"><label for="pid-t">Target °C</label><input class="input" id="pid-t" type="number" min="30" max="350" value="210" data-ref="target"></div>
      <button class="btn" data-ref="go">${raw(icon("flame"))}Start PID tune</button>
    </div>
    <div class="hint">Klipper heats to the target and cycles for a few minutes. Turn the part fan on for the extruder, close the lid for the bed.</div>
    <div class="result" data-ref="res"><span class="muted">Results appear here when the tune finishes.</span></div>
    <button class="btn btn-sm" data-ref="save" hidden>${raw(icon("save"))}Save to config</button>
  </div>`);
  const r = refs(el);
  host.append(el);
  r.heater.addEventListener("change", () => { r.target.value = r.heater.value === "extruder" ? 210 : 60; });
  r.go.addEventListener("click", async () => {
    if (!(await confirmDialog({ title: "Start PID tuning?", text: `The ${r.heater.value === "extruder" ? "nozzle" : "bed"} will heat to ${r.target.value}° and hold there while it tunes. Stay nearby.`, confirm: "Start" }))) return;
    run(`PID_CALIBRATE HEATER=${r.heater.value} TARGET=${Math.round(num(r.target, 210))}`);
  });
  r.save.addEventListener("click", async () => {
    if (await confirmDialog({ title: "Save the new PID values?", text: "SAVE_CONFIG writes them to printer.cfg and restarts Klipper.", confirm: "Save config" })) run("SAVE_CONFIG");
  });
  function render() {
    const p = store.get("klipper.lastPid");
    if (p) {
      r.res.innerHTML = `<span class="chip is-ok">Tuned</span><span class="mono">Kp ${p.kp.toFixed(3)}</span><span class="mono">Ki ${p.ki.toFixed(3)}</span><span class="mono">Kd ${p.kd.toFixed(3)}</span><span class="when">${relative(p.at / 1000)}</span>`;
      r.save.hidden = false;
    }
    enableAll(el, idle);
  }
  const offs = [store.on("klipper", render), store.on("printer", render)];
  render();
  return { dispose() { offs.forEach((o) => o()); el.remove(); } };
}

// ~~ Pressure advance ~~
export function paPanel(host) {
  const el = shell("Pressure advance", "tower method from the Klipper docs", html`<div class="col gap-4">
    <div class="tool-row">
      <div class="field" style="flex:0 0 190px"><label>Extruder type</label><div class="seg" data-ref="type"><button type="button" data-f="0.005" aria-pressed="true">Direct drive</button><button type="button" data-f="0.020" aria-pressed="false">Bowden</button></div></div>
      <div class="field"><label for="pa-s">Start</label><input class="input" id="pa-s" type="number" step="0.001" value="0" data-ref="start"></div>
      <div class="field"><label for="pa-f">Factor</label><input class="input" id="pa-f" type="number" step="0.001" value="0.005" data-ref="factor"></div>
    </div>
    <div class="tool-row"><button class="btn" data-ref="setup">${raw(icon("bolt"))}Send tower setup</button>
      <span class="hint grow">Sends a low square-corner velocity and starts <code>TUNING_TOWER</code>. Then print a pressure advance tower (a tall corner-heavy model) without changing settings.</span></div>
    <hr style="margin:0">
    <div class="tool-row">
      <div class="field"><label for="pa-h">Height of the best corners (mm)</label><input class="input" id="pa-h" type="number" step="0.1" placeholder="e.g. 9.5" data-ref="height"></div>
      <div><div class="k label">Pressure advance</div><div class="calc-out" data-ref="out">–</div></div>
    </div>
    <div class="tool-row"><button class="btn btn-sm" data-ref="apply" disabled>Apply now</button><button class="btn btn-sm btn-ghost" data-ref="copy" disabled>${raw(icon("copy"))}Copy config line</button></div>
    <div class="calc-note">Applies to this session. To keep it, put <code>pressure_advance: value</code> under <code>[extruder]</code> in printer.cfg.</div>
  </div>`);
  const r = refs(el);
  host.append(el);
  r.type.addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; r.factor.value = b.dataset.f; r.type.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b))); calc(); });
  const value = () => { const h = parseFloat(r.height.value); return Number.isFinite(h) ? num(r.start) + num(r.factor, 0.005) * h : null; };
  function calc() {
    const v = value();
    r.out.textContent = v == null ? "–" : v.toFixed(4);
    r.apply.disabled = r.copy.disabled = v == null;
  }
  ["input", "change"].forEach((ev) => { r.height.addEventListener(ev, calc); r.start.addEventListener(ev, calc); r.factor.addEventListener(ev, calc); });
  r.setup.addEventListener("click", async () => {
    await run("SET_VELOCITY_LIMIT SQUARE_CORNER_VELOCITY=1 ACCEL=500");
    await run(`TUNING_TOWER COMMAND=SET_PRESSURE_ADVANCE PARAMETER=ADVANCE START=${num(r.start)} FACTOR=${num(r.factor, 0.005)}`);
    toast.ok("Tower setup sent", "Start the tower print now.");
  });
  r.apply.addEventListener("click", () => run(`SET_PRESSURE_ADVANCE ADVANCE=${value().toFixed(4)}`));
  r.copy.addEventListener("click", async () => { await copyText(`pressure_advance: ${value().toFixed(4)}`); toast.ok("Copied", `pressure_advance: ${value().toFixed(4)}`); });
  const offs = [store.on("printer", () => enableAll(el, online)), ];
  return { dispose() { offs.forEach((o) => o()); el.remove(); } };
}

// ~~ Input shaper ~~
export function shaperPanel(host) {
  const el = shell("Input shaper", "needs an accelerometer", html`<div class="col gap-4">
    <div class="tool-row">
      <button class="btn" data-run="ACCELEROMETER_QUERY">${raw(icon("activity"))}Check sensor</button>
      <button class="btn" data-run="MEASURE_AXES_NOISE">${raw(icon("waves"))}Measure noise</button>
      <button class="btn" data-axis="X">${raw(icon("shaper"))}Calibrate X</button>
      <button class="btn" data-axis="Y">${raw(icon("shaper"))}Calibrate Y</button>
    </div>
    <div class="hint">Home and level first. Each axis shakes the toolhead or bed for about a minute. Results fill in below when Klipper finishes its analysis.</div>
    <div data-ref="noise" class="kpis" hidden></div>
    <div data-ref="out"></div>
    <div class="row wrap" data-ref="actions" hidden>
      <button class="btn btn-primary btn-sm" data-ref="save">${raw(icon("save"))}Save recommended</button>
      <button class="btn btn-sm btn-ghost" data-ref="copy">${raw(icon("copy"))}Copy config</button>
    </div>
  </div>`);
  const r = refs(el);
  host.append(el);
  const res = { X: { fits: [], accel: {}, pick: null }, Y: { fits: [], accel: {}, pick: null } };
  let active = "X";
  el.querySelectorAll("[data-run]").forEach((b) => b.addEventListener("click", () => run(b.dataset.run)));
  el.querySelectorAll("[data-axis]").forEach((b) => b.addEventListener("click", () => {
    active = b.dataset.axis;
    res[active] = { fits: [], accel: {}, pick: null };
    run(`SHAPER_CALIBRATE AXIS=${active}`);
    toast.info(`Calibrating ${active}`, "This takes about a minute.", { timeout: 5000 });
  }));
  const offs = [
    bus.on("klipper:shaper-fit", (d) => { res[active].fits.push(d); paint(); }),
    bus.on("klipper:shaper-accel", (d) => { res[active].accel[d.type] = d.maxAccel; paint(); }),
    bus.on("klipper:shaper-pick", (d) => { res[d.axis] = res[d.axis] || { fits: [], accel: {}, pick: null }; res[d.axis].pick = d; if (d.axis === "X") active = "Y"; paint(); chime("done"); toast.ok(`Input shaper found for ${d.axis}`, `${d.type} at ${d.freq} Hz`); }),
    bus.on("klipper:noise", (d) => { r.noise.hidden = false; r.noise.innerHTML = ["x", "y", "z"].map((a) => `<div><div class="k">Noise ${a.toUpperCase()}</div><div class="v">${d[a].toFixed(2)}</div></div>`).join(""); }),
    store.on("printer", () => enableAll(el, idle)),
  ];
  function config() {
    const lines = ["[input_shaper]"];
    for (const ax of ["X", "Y"]) if (res[ax].pick) { lines.push(`shaper_freq_${ax.toLowerCase()}: ${res[ax].pick.freq}`); lines.push(`shaper_type_${ax.toLowerCase()}: ${res[ax].pick.type}`); }
    return lines.join("\n");
  }
  function paint() {
    const parts = [];
    for (const ax of ["X", "Y"]) {
      const d = res[ax];
      if (!d.fits.length) continue;
      const best = d.pick?.type;
      parts.push(`<h3 style="margin:var(--s-2) 0">${ax} axis</h3><table class="table shaper-table"><thead><tr><th>Shaper</th><th class="r">Frequency</th><th class="r">Vibrations</th><th class="r">Smoothing</th><th class="r">Max accel</th></tr></thead><tbody>${d.fits.map((f) => `<tr class="${f.type === best ? "best" : ""}"><td class="${f.type === best ? "best" : ""}">${f.type}${f.type === best ? " ✓" : ""}</td><td class="r">${f.freq.toFixed(1)} Hz</td><td class="r">${f.vibrations.toFixed(1)}%</td><td class="r">${f.smoothing.toFixed(3)}</td><td class="r">${d.accel[f.type] ? d.accel[f.type] : "–"}</td></tr>`).join("")}</tbody></table>`);
    }
    r.out.innerHTML = parts.join("") || "";
    r.actions.hidden = !(res.X.pick || res.Y.pick);
  }
  r.save.addEventListener("click", async () => {
    await copyText(config());
    if (await confirmDialog({ title: "Save the shaper settings?", text: "Klipper will write the recommended [input_shaper] values to printer.cfg and restart.", confirm: "Save config" })) run("SAVE_CONFIG");
  });
  r.copy.addEventListener("click", async () => { await copyText(config()); toast.ok("Copied", "Paste it into printer.cfg."); });
  enableAll(el, idle);
  return { dispose() { offs.forEach((o) => (typeof o === "function" ? o() : null)); el.remove(); } };
}

// ~~ Live limits ~~
export function limitsPanel(host) {
  const el = shell("Motion limits", "changes apply until the next restart", html`<div class="col gap-4">
    <div class="tool-row">
      <div class="field"><label for="lm-v">Velocity mm/s</label><input class="input" id="lm-v" type="number" data-ref="v" placeholder="max"></div>
      <div class="field"><label for="lm-a">Accel mm/s²</label><input class="input" id="lm-a" type="number" data-ref="a" placeholder="max"></div>
      <div class="field"><label for="lm-d">Accel to decel</label><input class="input" id="lm-d" type="number" data-ref="d" placeholder="auto"></div>
      <div class="field"><label for="lm-s">Square corner</label><input class="input" id="lm-s" type="number" step="0.1" data-ref="s" placeholder="mm/s"></div>
    </div>
    <div class="tool-row">
      <div class="field"><label for="lm-pa">Pressure advance</label><input class="input" id="lm-pa" type="number" step="0.001" data-ref="pa"></div>
      <div class="field"><label for="lm-st">PA smooth time</label><input class="input" id="lm-st" type="number" step="0.001" data-ref="st" placeholder="0.040"></div>
      <div class="field"><label for="lm-rl">Retract mm</label><input class="input" id="lm-rl" type="number" step="0.1" data-ref="rl"></div>
      <div class="field"><label for="lm-rs">Retract mm/s</label><input class="input" id="lm-rs" type="number" data-ref="rs"></div>
    </div>
    <div class="tool-row"><button class="btn btn-primary" data-ref="apply">Apply</button><button class="btn btn-ghost" data-ref="read">${raw(icon("refresh"))}Read current</button><span class="hint grow">Empty boxes stay as they are. Retraction needs <code>[firmware_retraction]</code>.</span></div>
  </div>`);
  const r = refs(el);
  host.append(el);
  const v = (i) => { const n = parseFloat(i.value); return Number.isFinite(n) ? n : null; };
  r.apply.addEventListener("click", async () => {
    const cmds = [];
    const lim = [["VELOCITY", v(r.v)], ["ACCEL", v(r.a)], ["ACCEL_TO_DECEL", v(r.d)], ["SQUARE_CORNER_VELOCITY", v(r.s)]].filter(([, x]) => x != null);
    if (lim.length) cmds.push(`SET_VELOCITY_LIMIT ${lim.map(([k, x]) => `${k}=${x}`).join(" ")}`);
    const pa = [["ADVANCE", v(r.pa)], ["SMOOTH_TIME", v(r.st)]].filter(([, x]) => x != null);
    if (pa.length) cmds.push(`SET_PRESSURE_ADVANCE ${pa.map(([k, x]) => `${k}=${x}`).join(" ")}`);
    const rt = [["RETRACT_LENGTH", v(r.rl)], ["RETRACT_SPEED", v(r.rs)]].filter(([, x]) => x != null);
    if (rt.length) cmds.push(`SET_RETRACTION ${rt.map(([k, x]) => `${k}=${x}`).join(" ")}`);
    if (!cmds.length) return toast.info("Nothing to apply", "Fill in at least one value.");
    await run(cmds);
    toast.ok("Applied", cmds.length === 1 ? cmds[0] : `${cmds.length} commands sent`, { timeout: 2500 });
  });
  r.read.addEventListener("click", async () => {
    r.read.classList.add("is-busy");
    try {
      const lines = await actions.capture("SET_VELOCITY_LIMIT", { quietMs: 900 });
      const text = lines.join(" ");
      const pick = (re) => { const m = re.exec(text); return m ? m[1] : ""; };
      r.v.value = pick(/max_velocity:\s*([\d.]+)/i); r.a.value = pick(/max_accel:\s*([\d.]+)/i);
      r.d.value = pick(/max_accel_to_decel:\s*([\d.]+)/i); r.s.value = pick(/square_corner_velocity:\s*([\d.]+)/i);
      const pl = await actions.capture("SET_PRESSURE_ADVANCE", { quietMs: 900 });
      const t2 = pl.join(" ");
      const p2 = /pressure_advance:\s*([\d.]+)/i.exec(t2), p3 = /smooth_time:\s*([\d.]+)/i.exec(t2);
      if (p2) r.pa.value = p2[1]; if (p3) r.st.value = p3[1];
    } catch { /* toast shown */ } finally { r.read.classList.remove("is-busy"); }
  });
  const off = store.on("printer", () => enableAll(el, online));
  enableAll(el, online);
  return { dispose() { off(); el.remove(); } };
}

// ~~ Heat soak ~~
export function soakPanel(host) {
  const KEY = "mf.soak.v1";
  const el = shell("Heat soak", "warm the chamber before you print", html`<div class="col gap-4">
    <div class="tool-row">
      <div class="field"><label for="sk-b">Bed °C</label><input class="input" id="sk-b" type="number" value="100" data-ref="bed"></div>
      <div class="field"><label for="sk-c">Chamber target °C</label><input class="input" id="sk-c" type="number" value="45" data-ref="ch"></div>
      <div class="field"><label for="sk-m">Give up after (min)</label><input class="input" id="sk-m" type="number" value="30" data-ref="mins"></div>
    </div>
    <div class="tool-row"><button class="btn btn-primary" data-ref="go">${raw(icon("flame"))}Start soak</button><button class="btn btn-ghost" data-ref="stop" hidden>Stop</button></div>
    <div class="timerbar" data-ref="live" hidden><div class="row between"><span data-ref="status">Soaking</span><span class="muted tnum" data-ref="clock"></span></div><div class="bar"><i data-ref="fill"></i></div></div>
    <div class="hint" data-ref="note">Heats the bed, then waits for the chamber sensor to reach its target. Keep this tab open; it chimes when the chamber is ready.</div>
  </div>`);
  const r = refs(el);
  host.append(el);
  let job = null;
  try { job = JSON.parse(sessionStorage.getItem(KEY) || "null"); } catch { job = null; }
  const save = () => { try { job ? sessionStorage.setItem(KEY, JSON.stringify(job)) : sessionStorage.removeItem(KEY); } catch { /* ignore */ } };

  r.go.addEventListener("click", async () => {
    const bed = num(r.bed, 100), ch = num(r.ch, 45), mins = num(r.mins, 30);
    try { await actions.setTemp("bed", bed); } catch { return; }
    job = { bed, ch, until: Date.now() + mins * 60000, started: Date.now(), hasSensor: store.get("temps.chamber")?.actual != null };
    save(); paint();
  });
  r.stop.addEventListener("click", () => { job = null; save(); paint(); });

  function paint() {
    r.live.hidden = r.stop.hidden = !job;
    r.go.hidden = !!job;
    if (!job) return;
    const t = store.get("temps") || {};
    const chamber = t.chamber?.actual, bedNow = t.bed?.actual;
    const left = Math.max(0, (job.until - Date.now()) / 1000);
    let frac, status;
    if (job.hasSensor && chamber != null) {
      frac = Math.min(1, Math.max(0, (chamber - 22) / (job.ch - 22)));
      status = `Chamber ${chamber.toFixed(1)}° of ${job.ch}° · bed ${bedNow != null ? bedNow.toFixed(0) : "–"}° of ${job.bed}°`;
      if (chamber >= job.ch) { finish(`Chamber reached ${job.ch}°`); return; }
    } else {
      frac = Math.min(1, (Date.now() - job.started) / (job.until - job.started));
      status = `Soaking by time, no chamber sensor · bed ${bedNow != null ? bedNow.toFixed(0) : "–"}°`;
    }
    if (left <= 0) { finish(job.hasSensor ? "Time limit reached before the chamber got there" : "Soak time is up"); return; }
    r.status.textContent = status;
    r.clock.textContent = `${duration(left)} left`;
    r.fill.parentElement.style.setProperty("--p", `${(frac * 100).toFixed(1)}%`);
  }
  function finish(msg) {
    job = null; save(); paint();
    toast({ kind: "ok", title: "Soak finished", text: msg, timeout: 0 });
    chime("done");
  }
  const tick = setInterval(paint, 1000);
  const offs = [store.on("temps", paint), store.on("printer", () => enableAll(el, online))];
  paint();
  enableAll(el, online);
  return { dispose() { clearInterval(tick); offs.forEach((o) => o()); el.remove(); } };
}

// ~~ Calculators (no printer needed) ~~
export function calcPanel(host) {
  const el = shell("Calculators", "do the maths for you", html`<div class="col gap-4">
    <div class="seg" data-ref="tabs" role="tablist"><button type="button" data-t="rot" aria-pressed="true">Rotation distance</button><button type="button" data-t="flow" aria-pressed="false">Flow</button><button type="button" data-t="vol" aria-pressed="false">Volumetric</button></div>
    <div data-ref="rot" class="col gap-3">
      <div class="tool-row">
        <div class="field"><label for="rd-c">Current rotation_distance</label><input class="input" id="rd-c" type="number" step="0.0001" value="22.6789" data-ref="cur"></div>
        <div class="field"><label for="rd-r">Extruded (requested, mm)</label><input class="input" id="rd-r" type="number" value="100" data-ref="req"></div>
      </div>
      <div class="tool-row">
        <div class="field"><label for="rd-i">Mark distance before (mm)</label><input class="input" id="rd-i" type="number" value="120" data-ref="before"></div>
        <div class="field"><label for="rd-a">Mark distance after (mm)</label><input class="input" id="rd-a" type="number" step="0.1" placeholder="measure it" data-ref="after"></div>
      </div>
      <div><div class="label">New rotation_distance</div><div class="calc-out" data-ref="rotOut">–</div></div>
      <div class="calc-note">Mark the filament 120 mm above the extruder, extrude 100 mm, then measure again. Formula: old × actual ÷ requested.</div>
    </div>
    <div data-ref="flow" class="col gap-3" hidden>
      <div class="tool-row">
        <div class="field"><label for="fl-c">Current flow %</label><input class="input" id="fl-c" type="number" value="100" data-ref="fcur"></div>
        <div class="field"><label for="fl-e">Expected wall (mm)</label><input class="input" id="fl-e" type="number" step="0.01" value="0.45" data-ref="fexp"></div>
        <div class="field"><label for="fl-m">Measured wall (mm)</label><input class="input" id="fl-m" type="number" step="0.01" placeholder="caliper" data-ref="fmeas"></div>
      </div>
      <div><div class="label">New flow</div><div class="calc-out" data-ref="flowOut">–</div></div>
      <div class="calc-note">Print a single-wall cube, measure the wall in several places and average them.</div>
    </div>
    <div data-ref="vol" class="col gap-3" hidden>
      <div class="tool-row">
        <div class="field"><label for="vo-w">Line width (mm)</label><input class="input" id="vo-w" type="number" step="0.01" value="0.45" data-ref="vw"></div>
        <div class="field"><label for="vo-h">Layer height (mm)</label><input class="input" id="vo-h" type="number" step="0.01" value="0.2" data-ref="vh"></div>
        <div class="field"><label for="vo-s">Speed (mm/s)</label><input class="input" id="vo-s" type="number" value="200" data-ref="vs"></div>
        <div class="field"><label for="vo-l">Hotend limit (mm³/s)</label><input class="input" id="vo-l" type="number" placeholder="your measured max" data-ref="vl"></div>
      </div>
      <div class="row gap-6 wrap"><div><div class="label">Flow needed</div><div class="calc-out" data-ref="volOut">–</div></div><div><div class="label">Top speed at the limit</div><div class="calc-out" data-ref="volSpeed">–</div></div></div>
      <div class="calc-note">Flow = line width × layer height × speed. Find your hotend's limit by printing faster until it starts to under-extrude.</div>
    </div>
  </div>`);
  const r = refs(el);
  host.append(el);
  r.tabs.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    r.tabs.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    for (const k of ["rot", "flow", "vol"]) r[k].hidden = k !== b.dataset.t;
  });
  const g = (i) => parseFloat(i.value);
  function calc() {
    const actual = g(r.before) - g(r.after);
    r.rotOut.textContent = Number.isFinite(actual) && actual > 0 && g(r.req) > 0 && Number.isFinite(g(r.cur)) ? (g(r.cur) * actual / g(r.req)).toFixed(4) : "–";
    r.flowOut.textContent = g(r.fmeas) > 0 && g(r.fexp) > 0 ? `${(g(r.fcur) * g(r.fexp) / g(r.fmeas)).toFixed(1)}%` : "–";
    const flow = g(r.vw) * g(r.vh) * g(r.vs);
    r.volOut.textContent = Number.isFinite(flow) ? `${flow.toFixed(1)} mm³/s` : "–";
    r.volSpeed.textContent = g(r.vl) > 0 && g(r.vw) * g(r.vh) > 0 ? `${(g(r.vl) / (g(r.vw) * g(r.vh))).toFixed(0)} mm/s` : "–";
  }
  el.addEventListener("input", calc);
  calc();
  return { dispose() { el.remove(); } };
}
