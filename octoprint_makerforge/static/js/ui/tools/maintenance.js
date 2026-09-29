// Usage and upkeep: real print history and "hours since I last lubed the rails" reminders.
import { html, raw, refs, esc } from "mf/core/dom.js";
import { store, bus } from "mf/core/store.js";
import { mf } from "mf/core/api.js";
import { config } from "mf/core/config.js";
import { icon } from "mf/ui/icons.js";
import { duration, relative, filamentLength, filamentGrams, grams, stripExt } from "mf/core/format.js";
import { confirmDialog } from "mf/ui/dialog.js";
import { toast } from "mf/ui/toast.js";
import { can } from "mf/core/auth.js";

export function maintenancePanel(host) {
  const el = html`
    <section class="panel wide" style="grid-column:1 / -1" aria-label="Usage and maintenance">
      <div class="panel-head"><h2 class="panel-title">Usage and upkeep</h2><span class="panel-sub">recorded from your real prints</span></div>
      <div class="tool-body" data-ref="body"><div class="skeleton" style="height:120px"></div></div>
    </section>`;
  const r = refs(el);
  host.append(el);
  let stats = null;

  async function load() {
    try { stats = await mf.stats(); } catch { stats = null; }
    render();
  }

  function render() {
    if (!stats) { r.body.innerHTML = `<div class="callout is-info">${icon("info")}<div>Usage tracking isn't available. It needs the MakerForge plugin's stats endpoint.</div></div>`; return; }
    const t = stats.totals;
    const fc = config.data.filament;
    const rate = t.prints ? Math.round((t.success / t.prints) * 100) : null;
    const g = t.filamentMm ? filamentGrams(t.filamentMm, fc.diameter, fc.density) : null;
    const tasks = config.data.maintenance || [];
    const kpis = `<div class="kpis">
      <div><div class="k">Prints</div><div class="v">${t.prints}</div></div>
      <div><div class="k">Success rate</div><div class="v ${rate == null ? "" : rate >= 90 ? "ok" : rate >= 70 ? "warn" : "err"}">${rate == null ? "–" : rate + "%"}</div></div>
      <div><div class="k">Print time</div><div class="v">${duration(t.seconds, { long: true })}</div></div>
      <div><div class="k">Filament (est.)</div><div class="v">${t.filamentMm ? filamentLength(t.filamentMm) : "–"}${g ? ` <small class="muted">${grams(g)}</small>` : ""}</div></div>
    </div>`;
    const taskRows = tasks.map((task) => {
      const m = stats.maintenance?.[task.id];
      const since = (m ? m.sinceSeconds : t.seconds) / 3600;
      const frac = Math.min(1, since / task.everyHours);
      const due = frac >= 1, soon = frac >= 0.85;
      return `<div class="col" style="gap:6px"><div class="row between wrap"><span style="font-weight:500">${esc(task.name)}</span>
        <span class="row" style="gap:var(--s-3)"><span class="${due ? "err" : soon ? "warn" : "muted"} tnum">${since.toFixed(1)} of ${task.everyHours} h${due ? ", due now" : soon ? ", due soon" : ""}</span>
        <button class="btn btn-sm" data-done="${esc(task.id)}" ${can("control") ? "" : "disabled"}>${icon("check", "i i-sm")}Done</button></span></div>
        <div class="bar is-thin" style="--p:${(frac * 100).toFixed(0)}%"><i style="${due ? "background:var(--err)" : soon ? "background:var(--warn)" : ""}"></i></div>
        <div class="hint">${m?.resetAt ? `Last done ${relative(m.resetAt)}` : "Counting from your first recorded print"}</div></div>`;
    }).join("");
    const hist = stats.history.slice(0, 8).map((h) => `<tr><td>${esc(stripExt(h.name))}</td><td><span class="chip ${h.result === "success" ? "is-ok" : h.result === "failed" ? "is-err" : "is-warn"}">${h.result === "success" ? "Finished" : h.result === "failed" ? "Failed" : "Cancelled"}</span></td><td>${duration(h.seconds)}</td><td>${h.filamentMm ? filamentLength(h.filamentMm) + (h.estimated ? " est." : "") : "–"}</td><td class="muted">${relative(h.ts)}</td></tr>`).join("");
    r.body.innerHTML = `${kpis}
      ${t.prints ? "" : `<div class="callout is-info">${icon("info")}<div>Nothing recorded yet. This fills in as prints finish, fail or get cancelled. Nothing here is estimated up front.</div></div>`}
      <div class="tune-grid" style="gap:var(--s-5)">
        <div class="col gap-4"><h3>Maintenance reminders</h3>${taskRows || `<span class="muted">No reminders set. Add some in Settings.</span>`}</div>
        <div class="col gap-3"><h3>Recent prints</h3>${hist ? `<table class="table"><thead><tr><th>File</th><th>Result</th><th>Time</th><th>Filament</th><th></th></tr></thead><tbody>${hist}</tbody></table>` : `<span class="muted">No prints yet.</span>`}</div>
      </div>`;
  }

  r.body.addEventListener("click", async (e) => {
    const id = e.target.closest("[data-done]")?.dataset.done;
    if (!id) return;
    const task = (config.data.maintenance || []).find((x) => x.id === id);
    if (!(await confirmDialog({ title: `Mark “${task?.name || id}” as done?`, text: "The counter starts again from now.", confirm: "Mark done" }))) return;
    try { await mf.resetMaintenance(id); toast.ok("Counter reset", task?.name); load(); } catch (err) { toast.fail("Couldn't reset that", err); }
  });

  const offs = [bus.on("event:PrintDone", () => setTimeout(load, 1500)), bus.on("event:PrintFailed", () => setTimeout(load, 1500)), bus.on("event:PrintCancelled", () => setTimeout(load, 1500)), store.on("config", render)];
  load();
  return { dispose() { offs.forEach((o) => o()); el.remove(); } };
}
