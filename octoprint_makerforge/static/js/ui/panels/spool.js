// The spool on the printer: what it is, how much is left, and a quick way to swap it.
import { html, raw, refs, esc } from "mf/core/dom.js";
import { store } from "mf/core/store.js";
import { icon } from "mf/ui/icons.js";
import { can } from "mf/core/auth.js";
import { grams } from "mf/core/format.js";
import * as router from "mf/core/router.js";
import { loadSpools, activeSpool, setActiveSpool } from "mf/core/spools.js";
import { toast } from "mf/ui/toast.js";

export function spoolLabel(s) {
  return `${s.name}${s.material ? ` (${s.material})` : ""}`;
}

export function mountSpool(host) {
  const el = html`
    <section class="panel a-spool" aria-label="Spool">
      <div class="panel-head"><h2 class="panel-title">Spool</h2>
        <div class="panel-tools"><a class="btn btn-sm btn-ghost" href="${router.href("settings", ["spools"])}">Manage</a></div></div>
      <div class="panel-body col gap-3" data-ref="body"></div>
    </section>`;
  const r = refs(el);
  host.append(el);

  function render() {
    const d = store.get("spools");
    if (!d) { r.body.innerHTML = `<div class="skeleton" style="height:64px"></div>`; return; }
    if (d.mode === "plugin") { r.body.innerHTML = `<p class="muted">The Spoolman plugin tracks your spools. Its panel is in the Plugins panel and under Plugins.</p>`; return; }
    if (d.error) { r.body.innerHTML = `<div class="callout is-warn">${icon("alert")}<div>${esc(d.error)}</div></div>`; return; }
    if (!d.spools.length) {
      r.body.innerHTML = `<p class="muted">No spools yet. Add the spools you own and the filament each print uses comes off the one on the printer.</p><a class="btn btn-sm" href="${router.href("settings", ["spools"])}">${icon("plus")}Add a spool</a>`;
      return;
    }
    const a = activeSpool(d);
    const pct = a && a.weightG ? Math.max(0, Math.min(100, (a.remainingG / a.weightG) * 100)) : null;
    r.body.innerHTML = `
      ${a ? `<div class="spool-card"><i class="spool-dot" style="--c:${esc(a.color)}"></i><div class="grow" style="min-width:0"><b class="truncate">${esc(a.name)}</b><span class="muted">${esc(a.material || "")}</span></div>
        <div class="spool-left tnum"><b>${a.remainingG != null ? grams(a.remainingG) : "–"}</b><span class="muted">left</span></div></div>
        ${pct != null ? `<div class="bar is-thin"><i style="width:${pct.toFixed(1)}%;${pct < 10 ? "background:var(--err)" : pct < 25 ? "background:var(--warn)" : ""}"></i></div>` : ""}`
      : `<p class="muted">No spool marked as loaded.</p>`}
      <div class="field"><label for="spool-pick">Loaded on the printer</label>
        <select class="select" id="spool-pick" ${can("control") ? "" : "disabled"}><option value="">None</option>${d.spools.map((s) => `<option value="${esc(s.id)}" ${String(s.id) === String(d.active) ? "selected" : ""}>${esc(spoolLabel(s))}${s.remainingG != null ? `, ${esc(grams(s.remainingG))} left` : ""}</option>`).join("")}</select></div>`;
    r.body.querySelector("#spool-pick").addEventListener("change", async (e) => {
      try { await setActiveSpool(e.target.value || null); } catch (err) { toast.fail("Couldn't change the spool", err); }
    });
  }
  const off = store.on("spools", render);
  render();
  loadSpools();
  return { dispose() { off(); el.remove(); } };
}
