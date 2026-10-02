// Usage: print totals, the last two weeks of printing, and the next maintenance job.
import { html, raw, refs, esc } from "mf/core/dom.js";
import { store, bus } from "mf/core/store.js";
import { mf } from "mf/core/api.js";
import { config } from "mf/core/config.js";
import { icon } from "mf/ui/icons.js";
import { duration, filamentLength, DASH } from "mf/core/format.js";
import * as router from "mf/core/router.js";

const DAY = 86400;

export function mountUsage(host) {
  const el = html`
    <section class="panel a-usage" aria-label="Usage">
      <div class="panel-head"><h2 class="panel-title">Usage</h2>
        <div class="panel-tools"><a class="btn btn-sm btn-ghost" href="${router.href("tune")}">Details</a></div></div>
      <div class="panel-body col gap-4" data-ref="body"><div class="skeleton" style="height:96px"></div></div>
    </section>`;
  const r = refs(el);
  host.append(el);
  let stats = null, failed = false;

  function render() {
    if (failed) { r.body.innerHTML = `<p class="hint">Usage figures aren't available right now.</p>`; return; }
    if (!stats) return;
    const t = stats.totals;
    const rate = t.prints ? Math.round((t.success / t.prints) * 100) : null;

    // print hours per day for the last 14 days, oldest first
    const today = Math.floor(Date.now() / 1000 / DAY) * DAY;
    const byDay = new Map((stats.daily || []).map((d) => [d.day, d.seconds]));
    const days = Array.from({ length: 14 }, (_, i) => today - (13 - i) * DAY);
    const vals = days.map((d) => byDay.get(d) || 0);
    const peak = Math.max(3600, ...vals);
    const week = vals.slice(-7).reduce((a, b) => a + b, 0);
    const bars = days.map((d, i) => {
      const label = new Date(d * 1000).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
      return `<i class="${vals[i] ? "" : "is-zero"}" style="--h:${((vals[i] / peak) * 100).toFixed(1)}%" title="${esc(label)}: ${esc(vals[i] ? duration(vals[i]) : "no printing")}"></i>`;
    }).join("");

    // the reminder closest to due
    let next = null;
    for (const task of config.data.maintenance || []) {
      const since = (stats.maintenance?.[task.id]?.sinceSeconds ?? t.seconds) / 3600;
      const left = task.everyHours - since;
      if (!next || left < next.left) next = { name: task.name, left };
    }

    r.body.innerHTML = `
      <div class="kpis">
        <div><div class="k">Prints</div><div class="v">${t.prints}</div></div>
        <div><div class="k">Success</div><div class="v">${rate == null ? DASH : rate + "%"}</div></div>
        <div><div class="k">Print time</div><div class="v">${duration(t.seconds)}</div></div>
        <div><div class="k">Filament</div><div class="v">${t.filamentMm ? filamentLength(t.filamentMm) : DASH}</div></div>
      </div>
      <div class="col gap-1">
        <div class="row between"><span class="label">Last 14 days</span><span class="hint tnum">${week ? `${duration(week)} this week` : "nothing this week"}</span></div>
        <div class="spark" role="img" aria-label="Print hours per day for the last 14 days">${bars}</div>
      </div>
      ${next ? `<div class="row between usage-next"><span class="row" style="gap:8px">${icon("wrench", "i i-sm")}${esc(next.name)}</span><span class="tnum ${next.left <= 0 ? "err" : next.left < 15 ? "warn" : "muted"}">${next.left <= 0 ? "due now" : `in ${next.left.toFixed(0)} h`}</span></div>` : ""}`;
  }

  async function load() {
    try { stats = await mf.stats(); failed = false; } catch { failed = !stats; }
    render();
  }
  const reload = () => setTimeout(load, 1500);
  const offs = [bus.on("event:PrintDone", reload), bus.on("event:PrintFailed", reload), bus.on("event:PrintCancelled", reload), store.on("config", render)];
  load();
  return { dispose() { offs.forEach((o) => o()); el.remove(); } };
}
