// Klipper at a glance: its state, what it reported last, and the restart buttons.
import { html, raw, refs, esc } from "mf/core/dom.js";
import { store } from "mf/core/store.js";
import { icon } from "mf/ui/icons.js";
import * as actions from "mf/core/actions.js";
import { can } from "mf/core/auth.js";
import { discover } from "mf/core/klipper-watch.js";
import { relative, DASH } from "mf/core/format.js";
import { confirmDialog } from "mf/ui/dialog.js";
import { toast } from "mf/ui/toast.js";

const STATE = {
  ready: ["Ready", "is-ok"],
  startup: ["Starting", "is-info"],
  shutdown: ["Shut down", "is-err"],
  disconnected: ["MCU lost", "is-err"],
  unknown: ["Waiting", ""],
};
const ago = (at) => (at ? relative(at / 1000) : "");

export function mountKlipperInfo(host) {
  const el = html`
    <section class="panel a-klipper" aria-label="Klipper">
      <div class="panel-head"><h2 class="panel-title">Klipper</h2><span class="chip" data-ref="state">–</span></div>
      <div class="panel-body col gap-4">
        <dl class="kv" data-ref="kv"></dl>
        <div class="callout is-warn" data-ref="pending" hidden>${raw(icon("save"))}<div>Calibration results are waiting. <b>Save config</b> writes them to printer.cfg and restarts Klipper.</div></div>
        <div class="callout is-err" data-ref="err" hidden>${raw(icon("alert"))}<div data-ref="errText"></div></div>
        <div class="row wrap" data-ref="acts">
          <button class="btn btn-sm" data-a="status">${raw(icon("info"))}Status</button>
          <button class="btn btn-sm" data-a="scan" data-tip="Ask Klipper for its commands and macros again (HELP)">${raw(icon("refresh"))}Re-read commands</button>
          <button class="btn btn-sm" data-a="save" data-ref="save">${raw(icon("save"))}Save config</button>
          <button class="btn btn-sm btn-warn" data-a="fw">Firmware restart</button>
          <button class="btn btn-sm btn-warn" data-a="restart">Restart</button>
        </div>
      </div>
    </section>`;
  const r = refs(el);
  host.append(el);

  function render() {
    const s = store.state;
    const k = s.klipper || {};
    const f = s.printer.flags;
    const online = !!(f.operational || f.printing || f.paused || k.state === "shutdown");
    let [label, tone] = STATE[k.state] || STATE.unknown;
    if (k.detected === false) [label, tone] = ["Not Klipper", ""];
    else if (!online && k.state !== "shutdown") [label, tone] = ["Offline", ""];
    r.state.textContent = label;
    r.state.className = `chip ${tone}`;

    const cmds = k.commands ? Object.keys(k.commands).length : null;
    const q = k.lastQgl, p = k.lastProbe, pid = k.lastPid, mesh = k.mesh;
    const rows = [
      ["Firmware", k.firmware || (k.detected ? "Klipper" : DASH)],
      ["Commands", cmds == null ? DASH : `${cmds} found`],
      ["Gantry level", q ? `${q.range.toFixed(4)} mm range, ${q.retries} ${q.retries === 1 ? "retry" : "retries"} <span class="muted">${ago(q.at)}</span>` : DASH],
      ["Probe accuracy", p ? `σ ${p.sigma.toFixed(4)} mm, range ${p.range.toFixed(4)} <span class="muted">${ago(p.at)}</span>` : DASH],
      ["Bed mesh", mesh ? `${mesh.range.toFixed(3)} mm range, ${mesh.cols}×${mesh.rowsCount} <span class="muted">${ago(mesh.at)}</span>` : DASH],
      ["Last PID", pid ? `Kp ${pid.kp.toFixed(3)} Ki ${pid.ki.toFixed(3)} Kd ${pid.kd.toFixed(3)} <span class="muted">${ago(pid.at)}</span>` : DASH],
    ];
    // values are numbers we formatted ourselves, apart from the firmware string
    r.kv.innerHTML = rows.map(([dt, dd], i) => `<dt>${dt}</dt><dd>${i === 0 ? esc(dd) : dd}</dd>`).join("");

    r.pending.hidden = !k.pendingConfig;
    const err = k.state === "shutdown" || k.state === "disconnected" ? (k.message || k.lastError) : k.lastError;
    r.err.hidden = !err || k.state === "ready" && !k.lastError;
    r.errText.textContent = err ? String(err).slice(0, 240) : "";

    const allowed = can("control");
    const isK = k.detected !== false;
    for (const b of r.acts.querySelectorAll("button")) b.disabled = !allowed || !online || !isK;
    r.save.disabled = r.save.disabled || !k.pendingConfig;
  }

  r.acts.addEventListener("click", async (e) => {
    const a = e.target.closest("button[data-a]")?.dataset.a;
    if (!a) return;
    try {
      if (a === "status") await actions.gcode("STATUS");
      if (a === "scan") { await discover(true); toast.ok("Commands re-read", `${Object.keys(store.get("klipper.commands") || {}).length} commands and macros.`); }
      if (a === "save" && await confirmDialog({ title: "Save config?", text: "Writes the pending calibration to printer.cfg and restarts Klipper.", confirm: "Save and restart" })) {
        await actions.gcode("SAVE_CONFIG");
        store.patch("klipper", { pendingConfig: false });
        actions.watchReconnect();
      }
      if (a === "fw" && await confirmDialog({ title: "Firmware restart?", text: "Restarts the MCU and Klipper. A running print is lost.", confirm: "Restart", danger: true })) await actions.firmwareRestart();
      if (a === "restart" && await confirmDialog({ title: "Restart Klipper?", text: "Reloads printer.cfg. A running print is lost.", confirm: "Restart", danger: true })) await actions.klipperRestart();
    } catch { /* toast shown */ }
  });

  const offs = [store.on("klipper", render), store.on("printer", render), store.on("auth", render)];
  const tick = setInterval(render, 30000);   // keeps "5m ago" honest
  render();
  return { dispose() { clearInterval(tick); offs.forEach((o) => o()); el.remove(); } };
}
