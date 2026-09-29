// Leveling tools: QGL / Z tilt, probe accuracy, paper-test Z offset, and the bed mesh heatmap.
import { html, raw, refs } from "mf/core/dom.js";
import { store, bus } from "mf/core/store.js";
import { icon } from "mf/ui/icons.js";
import * as actions from "mf/core/actions.js";
import { availability } from "mf/ui/macros.js";
import { hasCommand, readMesh } from "mf/core/klipper-watch.js";
import { relative } from "mf/core/format.js";
import { toast } from "mf/ui/toast.js";
import { confirmDialog } from "mf/ui/dialog.js";
import { isPrintingNow } from "mf/ui/macros.js";
import { can } from "mf/core/auth.js";
import { refreshSoon } from "mf/core/position.js";

const run = (cmd) => actions.gcode(cmd).catch(() => {});
const canRun = () => store.get("printer.flags.operational") && !isPrintingNow() && can("control");
const mm = (v, d = 4) => (v == null ? "–" : `${v.toFixed(d)} mm`);

export function levelingPanel(host) {
  const el = html`
    <section class="panel" aria-label="Leveling">
      <div class="panel-head"><h2 class="panel-title">Leveling</h2><span class="panel-sub">gantry, probe, Z offset</span></div>
      <div class="tool-body">
        <div class="tool-row">
          <button class="btn" data-run="QUAD_GANTRY_LEVEL" data-needs="QUAD_GANTRY_LEVEL">${raw(icon("qgl"))}Quad gantry level</button>
          <button class="btn" data-run="Z_TILT_ADJUST" data-needs="Z_TILT_ADJUST">${raw(icon("qgl"))}Z tilt adjust</button>
          <button class="btn btn-ghost" data-run="G28">${raw(icon("home"))}Home all</button>
        </div>
        <div class="result" data-ref="qgl"><span class="muted">No gantry leveling this session yet. Run one and the result shows up here.</span></div>

        <hr style="margin:0">
        <div class="tool-row">
          <div class="field" style="flex:0 0 120px"><label for="pa-n">Probe samples</label><input class="input" id="pa-n" type="number" min="3" max="50" value="10" data-ref="samples"></div>
          <button class="btn" data-ref="probeRun">${raw(icon("probe"))}Probe accuracy</button>
        </div>
        <div class="kpis" data-ref="probe" hidden></div>

        <hr style="margin:0">
        <div class="col gap-3">
          <div class="row between wrap"><strong style="font-family:var(--font-display)">Z offset with the paper test</strong><button class="btn btn-sm" data-ref="pcStart">${raw(icon("target"))}Start</button></div>
          <div class="hint">Home and level first. The nozzle moves to the bed centre; nudge it down until a sheet of paper just drags, then accept.</div>
          <div data-ref="pc" hidden>
            <div class="steps" data-ref="pcSteps"></div>
            <div class="row gap-2" style="margin-top:var(--s-3)">
              <button class="btn btn-primary grow" data-ref="pcAccept">${raw(icon("check"))}Accept</button>
              <button class="btn btn-ghost grow" data-ref="pcAbort">${raw(icon("x"))}Abort</button>
            </div>
          </div>
        </div>
      </div>
    </section>`;
  const r = refs(el);
  host.append(el);

  el.querySelectorAll("[data-run]").forEach((b) => b.addEventListener("click", () => run(b.dataset.run)));
  r.probeRun.addEventListener("click", () => run(`PROBE_ACCURACY SAMPLES=${Math.max(3, Number(r.samples.value) || 10)}`));

  // paper test
  const STEPS = [-1, -0.1, -0.05, -0.01, 0.01, 0.05, 0.1, 1];
  r.pcSteps.replaceChildren(...STEPS.map((d) => {
    const b = html`<button class="btn">${d > 0 ? "+" : "−"}${Math.abs(d)}</button>`;
    b.addEventListener("click", () => run(`TESTZ Z=${d}`));
    return b;
  }));
  r.pcStart.addEventListener("click", async () => {
    await run("PROBE_CALIBRATE");
    r.pc.hidden = false;
    toast.info("Paper test started", "Watch the nozzle; nudge with the buttons.", { timeout: 4000 });
  });
  r.pcAccept.addEventListener("click", async () => { await run("ACCEPT"); r.pc.hidden = true; toast.ok("Offset accepted", "Run Save config to keep it.", { timeout: 6000 }); refreshSoon(1500); });
  r.pcAbort.addEventListener("click", async () => { await run("ABORT"); r.pc.hidden = true; });

  function render() {
    const k = store.get("klipper");
    const ok = canRun();
    el.querySelectorAll("[data-run], [data-ref=probeRun], [data-ref=pcStart]").forEach((b) => {
      const needs = b.dataset.needs;
      const known = needs ? hasCommand(needs) : null;
      b.disabled = !ok || known === false;
      b.hidden = known === false;
    });
    el.querySelectorAll("#pa-n").forEach((i) => { i.disabled = !ok; });
    const q = k.lastQgl;
    r.qgl.innerHTML = q
      ? `<span class="chip ${q.ok ? "is-ok" : "is-warn"}">${q.ok ? "Within tolerance" : "Out of tolerance"}</span>
         <span class="big">${q.range.toFixed(4)} mm</span>
         <span class="muted">range · tolerance ${q.tolerance.toFixed(4)} mm · ${q.retries} of ${q.maxRetries} retries used</span>
         <span class="when">${relative(q.at / 1000)}</span>`
      : `<span class="muted">No gantry leveling this session yet. Run one and the result shows up here.</span>`;
    const p = k.lastProbe;
    r.probe.hidden = !p;
    if (p) r.probe.innerHTML = `<div><div class="k">Range</div><div class="v">${p.range.toFixed(4)}</div></div><div><div class="k">Std. dev.</div><div class="v">${p.sigma.toFixed(4)}</div></div><div><div class="k">Average</div><div class="v">${p.avg.toFixed(4)}</div></div><div><div class="k">Min</div><div class="v">${p.min.toFixed(4)}</div></div><div><div class="k">Max</div><div class="v">${p.max.toFixed(4)}</div></div>`;
  }
  const offs = [store.on("klipper", render), store.on("printer", render)];
  render();
  return { dispose() { offs.forEach((o) => o()); el.remove(); } };
}

// ~~ bed mesh ~~
function heat(t) {
  // low = cool blue, middle = near-black, high = amber; t in 0..1
  const lo = [58, 160, 255], mid = [27, 39, 51], hi = [255, 176, 32];
  const a = t < 0.5 ? lo : mid, b = t < 0.5 ? mid : hi;
  const u = t < 0.5 ? t * 2 : (t - 0.5) * 2;
  return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * u)).join(",")})`;
}

export function meshPanel(host) {
  const el = html`
    <section class="panel" aria-label="Bed mesh">
      <div class="panel-head"><h2 class="panel-title">Bed mesh</h2><span class="panel-sub" data-ref="sub"></span>
        <div class="panel-tools"><button class="btn btn-sm" data-ref="read">${raw(icon("refresh"))}Read current</button></div></div>
      <div class="tool-body">
        <div class="mesh-wrap">
          <div class="col gap-2">
            <div class="mesh-canvas"><canvas data-ref="cv" role="img" aria-label="Bed mesh heat map"></canvas></div>
            <div><div class="legendbar"></div><div class="legendbar-labels"><span data-ref="lo">low</span><span data-ref="mid">flat</span><span data-ref="hi">high</span></div></div>
          </div>
          <div class="col gap-4">
            <div class="kpis" data-ref="kpis" hidden></div>
            <div class="tool-row">
              <button class="btn" data-ref="cal">${raw(icon("mesh"))}Calibrate mesh</button>
              <button class="btn btn-ghost" data-ref="clear">Clear</button>
            </div>
            <div class="tool-row">
              <div class="field" style="flex:1 1 140px"><label for="mesh-prof">Profile</label><input class="input" id="mesh-prof" value="default" data-ref="prof" autocomplete="off"></div>
              <button class="btn" data-ref="save">${raw(icon("save"))}Save</button>
              <button class="btn" data-ref="load">Load</button>
              <button class="btn btn-ghost" data-ref="remove">Remove</button>
            </div>
            <div class="hint">Calibrate probes the whole bed and takes a few minutes. Save stores it under the profile name; SAVE_CONFIG then writes it to printer.cfg. Read current shows whatever Klipper has loaded right now.</div>
          </div>
        </div>
      </div>
    </section>`;
  const r = refs(el);
  host.append(el);
  const cv = r.cv, ctx = cv.getContext("2d");

  function draw() {
    const m = store.get("klipper.mesh");
    const box = cv.parentElement.getBoundingClientRect();
    const size = Math.max(200, Math.round(box.width));
    const dpr = Math.min(devicePixelRatio || 1, 2);
    if (cv.width !== size * dpr) { cv.width = size * dpr; cv.height = size * dpr; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    const css = (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
    if (!m) {
      ctx.fillStyle = css("--tx-3"); ctx.font = `500 14px ${css("--font-body")}`; ctx.textAlign = "center";
      ctx.fillText("No mesh loaded. Press “Read current” or calibrate one.", size / 2, size / 2);
      r.kpis.hidden = true; r.sub.textContent = "";
      return;
    }
    const rows = m.rows.length, cols = m.rows[0].length;
    const cw = size / cols, ch = size / rows;
    const span = Math.max(m.max - m.min, 0.02);
    // Klipper's probed matrix lists rows from the front of the bed (row 0) to the back, so flip for display
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
      const v = m.rows[rows - 1 - y][x];
      ctx.fillStyle = heat((v - m.min) / span);
      ctx.fillRect(x * cw, y * ch, cw + 0.5, ch + 0.5);
    }
    ctx.strokeStyle = "rgb(0 0 0 / 0.35)"; ctx.lineWidth = 1;
    for (let x = 1; x < cols; x++) { ctx.beginPath(); ctx.moveTo(x * cw, 0); ctx.lineTo(x * cw, size); ctx.stroke(); }
    for (let y = 1; y < rows; y++) { ctx.beginPath(); ctx.moveTo(0, y * ch); ctx.lineTo(size, y * ch); ctx.stroke(); }
    if (cw > 40) {
      ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.font = `600 ${Math.min(13, cw / 5)}px ${css("--font-display")}`;
      for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) {
        const v = m.rows[rows - 1 - y][x];
        ctx.fillStyle = "rgb(255 255 255 / 0.9)";
        ctx.fillText(v.toFixed(3), x * cw + cw / 2, y * ch + ch / 2);
      }
    }
    const tone = m.range < 0.1 ? "is-ok" : m.range < 0.2 ? "is-warn" : "is-err";
    r.sub.textContent = `${cols} × ${rows} points`;
    r.kpis.hidden = false;
    r.kpis.innerHTML = `<div><div class="k">Range</div><div class="v ${tone === "is-ok" ? "ok" : tone === "is-warn" ? "warn" : "err"}">${m.range.toFixed(3)} mm</div></div><div><div class="k">Lowest</div><div class="v">${m.min.toFixed(3)}</div></div><div><div class="k">Highest</div><div class="v">${m.max.toFixed(3)}</div></div><div><div class="k">Mean</div><div class="v">${m.mean.toFixed(3)}</div></div><div><div class="k">Std. dev.</div><div class="v">${m.sigma.toFixed(4)}</div></div>`;
    r.lo.textContent = `${m.min.toFixed(3)} mm`; r.hi.textContent = `${m.max.toFixed(3)} mm`; r.mid.textContent = `mean ${m.mean.toFixed(3)}`;
  }
  new ResizeObserver(draw).observe(cv.parentElement);

  r.read.addEventListener("click", async () => {
    r.read.classList.add("is-busy");
    try {
      const m = await readMesh();
      if (!m) toast.info("No mesh found", "Klipper didn't report a mesh. Calibrate one, or load a saved profile.");
    } catch { /* toast shown */ } finally { r.read.classList.remove("is-busy"); }
  });
  r.cal.addEventListener("click", async () => {
    if (!(await confirmDialog({ title: "Calibrate the bed mesh?", text: "The probe visits every point. Home and level the gantry first. This takes a few minutes.", confirm: "Calibrate" }))) return;
    await run(`BED_MESH_CALIBRATE${r.prof.value.trim() && r.prof.value.trim() !== "default" ? ` PROFILE=${r.prof.value.trim()}` : ""}`);
    toast.info("Mesh calibration started", "Press “Read current” when it finishes.", { timeout: 6000 });
  });
  r.clear.addEventListener("click", () => run("BED_MESH_CLEAR"));
  const prof = () => r.prof.value.trim() || "default";
  r.save.addEventListener("click", () => run(`BED_MESH_PROFILE SAVE=${prof()}`));
  r.load.addEventListener("click", async () => { await run(`BED_MESH_PROFILE LOAD=${prof()}`); setTimeout(() => r.read.click(), 800); });
  r.remove.addEventListener("click", async () => { if (await confirmDialog({ title: `Remove profile “${prof()}”?`, confirm: "Remove", danger: true })) run(`BED_MESH_PROFILE REMOVE=${prof()}`); });

  function enable() { const ok = canRun(); el.querySelectorAll("button, input").forEach((b) => { b.disabled = !ok; }); }
  const offs = [store.on("klipper", draw), store.on("printer", enable)];
  enable(); draw();
  return { dispose() { offs.forEach((o) => o()); el.remove(); } };
}
