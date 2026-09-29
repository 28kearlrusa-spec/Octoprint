// Tune: the Klipper and Voron toolbox.
import { html, raw, refs, esc } from "mf/core/dom.js";
import { boot } from "mf/core/api.js";
import { store } from "mf/core/store.js";
import { icon } from "mf/ui/icons.js";
import * as actions from "mf/core/actions.js";
import { discover } from "mf/core/klipper-watch.js";
import { confirmDialog } from "mf/ui/dialog.js";
import { can } from "mf/core/auth.js";
import { levelingPanel, meshPanel } from "mf/ui/tools/leveling.js";
import { pidPanel, paPanel, shaperPanel, limitsPanel, soakPanel, calcPanel } from "mf/ui/tools/calibrate.js";
import { maintenancePanel } from "mf/ui/tools/maintenance.js";

export default {
  id: "tune",
  mount(el) {
    const head = html`<div class="view-head"><h1>Tune</h1><span class="view-note">Klipper and Voron tools. Everything here talks to the printer through normal commands, so it's all visible in the Terminal.</span></div>`;
    const pending = html`<div class="pending" hidden>${raw(icon("alert"))}<div class="grow"><b>Calibration waiting to be saved.</b> Klipper has new values that aren't in printer.cfg yet.</div><button class="btn btn-warn btn-sm" data-ref="save">${raw(icon("save"))}Save config</button></div>`;
    const grid = html`<div class="tune-grid"></div>`;
    el.append(head, pending, grid);

    const parts = [];
    parts.push(klipperPanel(grid));
    parts.push(levelingPanel(grid));
    const meshHost = html`<div class="wide"></div>`;
    grid.append(meshHost);
    parts.push(meshPanel(meshHost));
    parts.push(pidPanel(grid), paPanel(grid), limitsPanel(grid), soakPanel(grid));
    const shaperHost = html`<div class="wide"></div>`;
    grid.append(shaperHost);
    parts.push(shaperPanel(shaperHost));
    parts.push(calcPanel(grid), maintenancePanel(grid));

    const btn = pending.querySelector("button");
    btn.addEventListener("click", async () => {
      if (await confirmDialog({ title: "Save config and restart Klipper?", text: "Klipper writes the pending values to printer.cfg and restarts. Any running print is lost.", confirm: "Save config" })) {
        actions.gcode("SAVE_CONFIG").then(() => store.patch("klipper", { pendingConfig: false })).catch(() => {});
      }
    });
    const off = store.on("klipper", () => { pending.hidden = !store.get("klipper.pendingConfig"); });
    pending.hidden = !store.get("klipper.pendingConfig");
    return { unmount() { off(); parts.forEach((p) => p.dispose?.()); } };
  },
};

function klipperPanel(host) {
  const el = html`
    <section class="panel" aria-label="Klipper status">
      <div class="panel-head"><h2 class="panel-title">Klipper</h2><span class="chip" data-ref="state">Unknown</span></div>
      <div class="tool-body">
        <dl class="kv" data-ref="kv"></dl>
        <div class="callout is-err" data-ref="err" hidden></div>
        <div class="tool-row">
          <button class="btn" data-a="STATUS">${raw(icon("info"))}Status</button>
          <button class="btn" data-a="RESTART">${raw(icon("refresh"))}Restart</button>
          <button class="btn btn-warn" data-a="FIRMWARE_RESTART">${raw(icon("refresh"))}Firmware restart</button>
          <button class="btn btn-ghost" data-ref="disc">${raw(icon("search"))}Rescan commands</button>
          <a class="btn btn-ghost" data-ref="cfg" href="${boot.base}/?classic#tab_plugin_klipper" hidden>${raw(icon("edit"))}Edit printer.cfg</a>
        </div>
        <div class="hint" data-ref="hint"></div>
      </div>
    </section>`;
  const r = refs(el);
  host.append(el);
  el.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-a]");
    if (!b) return;
    const cmd = b.dataset.a;
    if (cmd !== "STATUS" && !(await confirmDialog({ title: `${cmd === "RESTART" ? "Restart Klipper" : "Restart the firmware"}?`, text: "Any running print is lost and the printer re-reads printer.cfg.", confirm: "Restart", danger: true }))) return;
    actions.gcode(cmd).catch(() => {});
  });
  r.disc.addEventListener("click", async () => { r.disc.classList.add("is-busy"); await discover(true); r.disc.classList.remove("is-busy"); render(); });

  function render() {
    const k = store.get("klipper");
    const f = store.get("printer.flags");
    const state = { ready: ["Ready", "is-ok"], shutdown: ["Shutdown", "is-err"], startup: ["Starting", "is-warn"], disconnected: ["MCU lost", "is-err"], unknown: ["Unknown", ""] }[k.state] || ["Unknown", ""];
    r.state.className = `chip ${state[1]}`;
    r.state.textContent = state[0];
    const cmdCount = k.commands ? Object.keys(k.commands).length : 0;
    r.kv.innerHTML = `
      <dt>Firmware</dt><dd>${esc(k.firmware || (k.detected ? "Klipper" : "–"))}</dd>
      <dt>Commands known</dt><dd>${cmdCount || "–"}</dd>
      <dt>Serial link</dt><dd>${f.operational ? "Open" : "Closed"}</dd>`;
    const bad = k.state === "shutdown" || k.state === "disconnected";
    r.err.hidden = !bad;
    if (bad) r.err.innerHTML = `${icon("octagon")}<div><b>${esc(k.message || "Klipper has stopped.")}</b>${k.lastError ? `<div class="mono" style="margin-top:4px">${esc(k.lastError)}</div>` : ""}<div style="margin-top:4px">Fix the cause, then use Firmware restart.</div></div>`;
    r.hint.textContent = !f.operational ? "Connect the printer to talk to Klipper." : !k.detected ? "This doesn't look like Klipper yet (no “//” replies). Some tools here will not apply." : "";
    const on = f.operational && can("control");
    el.querySelectorAll("button").forEach((b) => { b.disabled = !on; });
    // the OctoKlipper plugin brings a config editor; point at it when it's installed
    r.cfg.hidden = !store.get("settings")?.plugins?.klipper;
  }
  const off = store.on("klipper", render), off2 = store.on("printer", render), off3 = store.on("settings", render);
  render();
  return { dispose() { off(); off2(); off3(); el.remove(); } };
}
