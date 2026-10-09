// Tune: the calibration steps of the E3NG Klipper config (klipper/calibration.cfg), in order,
// with the results that don't have a panel of their own (bed screws, extruder steps).
// Shows only when the printer's config has those macros.
import { html, raw, refs, esc } from "mf/core/dom.js";
import { store, bus } from "mf/core/store.js";
import { icon } from "mf/ui/icons.js";
import * as actions from "mf/core/actions.js";
import { hasCommand } from "mf/core/klipper-watch.js";
import { isPrintingNow } from "mf/ui/macros.js";
import { confirmDialog, promptDialog } from "mf/ui/dialog.js";
import { can } from "mf/core/auth.js";
import { copyText } from "mf/core/dom.js";
import { toast } from "mf/ui/toast.js";

const STEPS = [
  { cmd: "DIRECTION_TEST", name: "Motor directions", note: "Before the first homing. Moves 10 mm at a time without homing.", ask: "Move the head to the middle of the bed by hand first. Keep a hand on the power switch." },
  { cmd: "Z_CHECK", name: "Z distance", note: "Moves Z up 20 mm. Measure it to check the Z gear ratio." },
  { cmd: "PID_HOTEND", name: "PID hotend", note: "Tunes the Volcano at 220° with the part fan on.", param: ["TEMP", "Nozzle temperature", 220] },
  { cmd: "PID_BED", name: "PID bed", note: "Tunes the bed at 60°.", param: ["TEMP", "Bed temperature", 60] },
  { cmd: "PROBE_CHECK", name: "Probe accuracy", note: "Ten probes in the middle. The range should be under 0.02 mm." },
  { cmd: "PROBE_Z_OFFSET", name: "Z offset", note: "The paper test, hot. Needed before the first print (the Volcano is longer than stock)." },
  { cmd: "BED_SCREWS", name: "Bed screws", note: "Says how far to turn each screw. Repeat until all are under 00:05." },
  { cmd: "EXTRUDER_CALIBRATE", name: "Extruder steps", note: "Extrudes 100 mm. Mark the filament 120 mm above the extruder first.", ask: "Mark the filament 120 mm above the extruder's entry, then start." },
  { cmd: "INPUT_SHAPER_AUTO", name: "Input shaper", note: "Measures vibrations with the ADXL345 and picks the shapers.", ask: "The ADXL345 must be firmly on the toolhead. The printer shakes loudly for about 3 minutes." },
  { cmd: "SPEED_TEST", name: "Speed test", note: "Fast diagonals, then re-homes. Compare the positions it prints.", ask: "The head moves at full speed. Keep hands clear." },
];

export function machineCalPanel(host) {
  const el = html`
    <section class="panel wide" aria-label="Calibration steps" hidden>
      <div class="panel-head"><h2 class="panel-title">Calibration</h2><span class="panel-sub">E3NG config, first time top to bottom</span>
        <div class="panel-tools"><button class="btn btn-sm" data-ref="wizard">${raw(icon("list-checks"))}Wizard</button></div></div>
      <div class="tool-body">
        <ol class="cal-steps" data-ref="steps"></ol>
        <div class="callout is-info" data-ref="pending" hidden>${raw(icon("save"))}<div>Some steps (PID, Z offset, input shaper, mesh) only last after <b>Save config</b>, at the top of this page.</div></div>
        <div data-ref="screws" hidden>
          <h3 class="cal-h">Bed screws</h3>
          <div class="screw-grid" data-ref="screwGrid"></div>
          <div class="hint">Turn each screw as shown (01:00 is a full turn, 00:15 a quarter), then run Bed screws again until everything says level.</div>
        </div>
        <div data-ref="extruder" hidden>
          <h3 class="cal-h">Extruder steps</h3>
          <div class="row wrap gap-3" data-ref="extruderBody"></div>
        </div>
      </div>
    </section>`;
  const r = refs(el);
  host.append(el);

  r.steps.innerHTML = STEPS.map((s, i) => `
    <li><span class="cal-n">${i + 1}</span><div class="grow"><b>${esc(s.name)}</b><div class="hint">${esc(s.note)}</div></div>
      <button class="btn btn-sm" data-i="${i}">${icon("play", "i i-sm")}Run</button></li>`).join("");

  r.steps.addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-i]");
    if (!b) return;
    const s = STEPS[+b.dataset.i];
    if (s.ask && !(await confirmDialog({ title: `${s.name}?`, text: s.ask, confirm: "Start" }))) return;
    let cmd = s.cmd;
    if (s.param) {
      const v = await promptDialog({ title: s.name, label: s.param[1], value: String(s.param[2]), confirm: "Start", validate: (x) => (Number.isFinite(+x) && +x > 0 ? null : "Enter a number.") });
      if (!v) return;
      cmd = `${s.cmd} ${s.param[0]}=${Math.round(+v)}`;
    }
    if (s.cmd === "BED_SCREWS") screws = [];
    actions.gcode(cmd).catch(() => {});
  });
  r.wizard.addEventListener("click", () => actions.gcode("CALIBRATION_WIZARD").catch(() => {}));

  let screws = [];
  const paintScrews = () => {
    r.screws.hidden = !screws.length;
    // laid out like the bed seen from the front: back screws on top
    const laid = screws.slice().sort((a, b) => (Math.abs(b.y - a.y) > 20 ? b.y - a.y : a.x - b.x));
    r.screwGrid.innerHTML = laid.map((s) => {
      const level = s.base || s.turns < 5 / 60;
      return `<div class="screw ${level ? "is-ok" : "is-adjust"}"><div class="k">${esc(s.name)}</div>
        <div class="v">${s.base ? "reference" : level ? "level" : `${icon(s.dir === "CW" ? "rot-cw" : "rot-ccw", "i i-sm")} ${esc(s.dir)} ${esc(s.clock)}`}</div></div>`;
    }).join("");
  };

  const paintExtruder = () => {
    const x = store.get("klipper.lastExtruder");
    r.extruder.hidden = !x;
    if (!x) return;
    r.extruderBody.innerHTML = `<div class="kpis"><div><div class="k">Extruded</div><div class="v">${x.moved.toFixed(1)} mm</div></div>
      <div><div class="k">rotation_distance</div><div class="v">${x.old.toFixed(3)} → <b>${x.next.toFixed(3)}</b></div></div></div>
      <button class="btn btn-sm" data-copy>${icon("copy", "i i-sm")}Copy line for printer.cfg</button>`;
    r.extruderBody.querySelector("[data-copy]").addEventListener("click", async () => {
      await copyText(`rotation_distance: ${x.next.toFixed(3)}`);
      toast.ok("Copied", "Paste it into [extruder] in printer.cfg, then Restart.");
    });
  };

  function sync() {
    el.hidden = hasCommand("CALIBRATION_WIZARD") !== true;
    const on = store.get("printer.flags.operational") && !isPrintingNow() && can("control");
    el.querySelectorAll("button[data-i], [data-ref=wizard]").forEach((b) => { b.disabled = !on; });
    r.pending.hidden = !store.get("klipper.pendingConfig");
  }

  const offs = [
    store.on("klipper", () => { sync(); paintExtruder(); }),
    store.on("printer", sync),
    bus.on("klipper:screw", (d) => {
      // a new run starts with the base screw
      if (d.base) screws = [];
      screws = screws.filter((s) => s.name !== d.name).concat(d);
      paintScrews();
    }),
  ];
  sync(); paintExtruder();
  return { dispose() { offs.forEach((o) => o()); el.remove(); } };
}
