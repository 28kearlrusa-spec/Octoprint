// Temperatures: a tile per heater with an editable target, the history chart under them,
// and material presets.
import { html, raw, refs } from "mf/core/dom.js";
import { store } from "mf/core/store.js";
import { icon } from "mf/ui/icons.js";
import { heater, heaterNames } from "mf/core/status.js";
import { config } from "mf/core/config.js";
import { temps } from "mf/core/telemetry.js";
import { prefs } from "mf/core/prefs.js";
import { TempChart, seriesLabel, seriesColor } from "mf/ui/chart.js";
import * as actions from "mf/core/actions.js";
import { can } from "mf/core/auth.js";
import { toast } from "mf/ui/toast.js";
import { confirmDialog } from "mf/ui/dialog.js";

const LIMITS = { tool: 320, bed: 150, chamber: 90 };
const limitFor = (name) => (name.startsWith("tool") ? LIMITS.tool : LIMITS[name] || 300);
const ICON = (name) => (name.startsWith("tool") ? "nozzle" : name === "bed" ? "bed" : "chamber");
const WINDOWS = [[120, "2 min"], [600, "10 min"], [1800, "30 min"], [3600, "1 hr"]];

function label(name, count) {
  if (name === "bed") return "Bed";
  if (name === "chamber") return "Chamber";
  const n = Number(name.replace("tool", "")) + 1;
  return count > 1 ? `Nozzle ${n}` : "Nozzle";
}

export function mountTemps(host) {
  const el = html`
    <section class="panel a-temps" aria-label="Temperatures">
      <div class="panel-head">
        <h2 class="panel-title">Temperatures</h2>
        <div class="panel-tools">
          <button class="btn btn-sm btn-ghost" data-ref="cool" data-tip="Turn every heater off">${raw(icon("power"))}All off</button>
        </div>
      </div>
      <div class="heaters" data-ref="tiles"></div>
      <div class="chart-head">
        <div class="legend" data-ref="legend" role="group" aria-label="Shown on the chart"></div>
        <div class="seg" data-ref="seg" role="group" aria-label="Time shown">
          ${WINDOWS.map(([sec, l]) => html`<button type="button" data-w="${sec}" aria-pressed="${prefs.get("chartWindow") === sec}">${l}</button>`)}
        </div>
      </div>
      <div class="chart-wrap"><canvas data-ref="cv" role="img" aria-label="Temperature history"></canvas><div class="ct-tip" data-ref="tip" hidden></div></div>
      <div class="presets" data-ref="presets"></div>
    </section>`;
  const r = refs(el);
  host.append(el);

  // ~~ heater tiles ~~
  let tileSig = "";
  const tiles = new Map();     // name -> refs

  function ensureTiles(names) {
    const sig = names.join(",");
    if (sig === tileSig) return;
    tileSig = sig;
    tiles.clear();
    r.tiles.replaceChildren();
    const toolCount = names.filter((n) => n.startsWith("tool")).length;
    for (const name of names) {
      const t = html`
        <div class="heater" data-h="${name}">
          <div class="heater-head">${raw(icon(ICON(name)))}<span>${label(name, toolCount)}</span><span class="heater-state" data-ref="state">Off</span></div>
          <div class="heater-val"><span class="big" data-ref="big">–</span><span class="dec" data-ref="dec"></span><span class="deg">°</span></div>
          <div class="heater-bar" data-ref="bar"><i></i><b></b></div>
          <div class="heater-set">
            <div class="numfield"><input type="number" inputmode="numeric" min="0" max="${limitFor(name)}" step="5" placeholder="Target" aria-label="${label(name, toolCount)} target" data-ref="inp"><span class="unit">°C</span></div>
            <button class="btn btn-sm btn-icon" data-ref="off" aria-label="Turn ${label(name, toolCount)} off" data-tip="Turn off">${raw(icon("power"))}</button>
          </div>
        </div>`;
      const tr = refs(t);
      tr.name = name;
      const apply = async () => {
        const v = tr.inp.value === "" ? null : Number(tr.inp.value);
        if (v == null || Number.isNaN(v)) return;
        const max = limitFor(name);
        if (v > max) { toast.warn("That's too hot", `${label(name, toolCount)} is limited to ${max}° here.`); tr.inp.value = String(max); return; }
        if (name.startsWith("tool") && v > 300 && !(await confirmDialog({ title: `Heat the nozzle to ${v}°?`, text: "Only do this with a hotend rated for it (all-metal, no PTFE).", confirm: `Heat to ${v}°` }))) return;
        actions.setTemp(name, v).catch(() => {});
      };
      tr.inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); apply(); tr.inp.blur(); } });
      tr.inp.addEventListener("change", apply);
      tr.off.addEventListener("click", () => { tr.inp.value = ""; actions.setTemp(name, 0).catch(() => {}); });
      tiles.set(name, tr);
      r.tiles.append(t);
    }
  }

  function renderPresets() {
    const presets = config.data.presets || [];
    r.presets.replaceChildren(
      html`<span class="label">Preheat</span>`,
      ...presets.map((p) => {
        const parts = [`Nozzle ${p.nozzle}°`, `bed ${p.bed}°`, p.chamber ? `chamber ${p.chamber}°` : ""].filter(Boolean);
        const b = html`<button class="btn btn-sm" data-tip="${parts.join(", ")}">${p.name}</button>`;
        b.addEventListener("click", () => actions.preheat(p).catch(() => {}));
        return b;
      })
    );
  }

  function render() {
    const s = store.state;
    const names = heaterNames(s);
    const profile = s.profile;
    // always show a nozzle even before the first temperature arrives
    const shown = names.length ? names : ["tool0", "bed"];
    ensureTiles(shown.filter((n) => n !== "bed" || profile?.heatedBed !== false));
    const online = s.printer.flags.operational || s.printer.flags.printing || s.printer.flags.paused;
    const allowed = can("control");

    for (const [name, t] of tiles) {
      const h = heater(name, s);
      const maxScale = name === "bed" ? 120 : name === "chamber" ? 70 : 300;
      const actual = h.actual;
      const [whole, frac] = actual == null ? ["–", ""] : actual.toFixed(1).split(".");
      if (t.big.textContent !== whole) t.big.textContent = whole;
      t.dec.textContent = actual == null ? "" : `.${frac}`;
      const pct = actual == null ? 0 : Math.min(100, (actual / maxScale) * 100);
      t.bar.style.setProperty("--pct", `${pct}%`);
      t.bar.style.setProperty("--tpct", `${Math.min(100, ((h.target || 0) / maxScale) * 100)}%`);
      t.bar.parentElement.classList.toggle("has-target", h.target > 0);
      t.state.className = `heater-state is-${h.state}`;
      t.state.textContent = { off: "Off", heating: `Heating to ${Math.round(h.target)}°`, stable: `Holding ${Math.round(h.target)}°`, cooling: h.target > 0 ? `Cooling to ${Math.round(h.target)}°` : "Cooling" }[h.state];
      if (document.activeElement !== t.inp) t.inp.value = h.target > 0 ? String(Math.round(h.target)) : "";
      t.inp.disabled = t.off.disabled = !online || !allowed;
    }
    r.cool.disabled = !online || !allowed;
    for (const b of r.presets.querySelectorAll("button")) b.disabled = !online || !allowed;
  }

  // ~~ history chart ~~
  const chart = new TempChart(r.cv, { windowSec: prefs.get("chartWindow"), tip: r.tip });
  chart.setHidden(new Set(prefs.get("chartHidden") || []));
  r.seg.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-w]");
    if (!b) return;
    const w = Number(b.dataset.w);
    prefs.set("chartWindow", w);
    chart.setWindow(w);
    for (const x of r.seg.children) x.setAttribute("aria-pressed", String(x === b));
  });

  let legendSig = "";
  function legend() {
    const keys = temps.series();
    const sig = keys.join(",");
    if (sig === legendSig) return;
    legendSig = sig;
    r.legend.replaceChildren(...keys.map((k) => {
      const b = html`<button type="button" class="series-toggle" aria-pressed="${!chart.hidden.has(k)}"><i></i>${seriesLabel(k)}</button>`;
      b.style.setProperty("--c", seriesColor(k));
      b.addEventListener("click", () => {
        const hidden = new Set(chart.hidden);
        hidden.has(k) ? hidden.delete(k) : hidden.add(k);
        chart.setHidden(hidden);
        prefs.set("chartHidden", Array.from(hidden));
        b.setAttribute("aria-pressed", String(!hidden.has(k)));
      });
      return b;
    }));
  }

  r.cool.addEventListener("click", () => actions.cooldown().catch(() => {}));
  const offs = [store.on("temps", render), store.on("printer", render), store.on("profile", render), store.on("auth", render), store.on("config", () => { renderPresets(); render(); })];
  const offTemps = temps.on(legend);
  renderPresets();
  render();
  legend();
  return { dispose() { offs.forEach((o) => o()); offTemps(); chart.destroy(); el.remove(); } };
}
