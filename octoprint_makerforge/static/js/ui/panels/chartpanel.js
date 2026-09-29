// Temperature history chart with legend toggles and a time window.
import { html, raw, refs } from "mf/core/dom.js";
import { TempChart, seriesLabel, seriesColor } from "mf/ui/chart.js";
import { temps } from "mf/core/telemetry.js";
import { prefs } from "mf/core/prefs.js";

const WINDOWS = [[120, "2 min"], [600, "10 min"], [1800, "30 min"], [3600, "1 hour"]];

export function mountChart(host) {
  const el = html`
    <section class="panel a-chart" aria-label="Temperature history">
      <div class="panel-head">
        <h2 class="panel-title">History</h2>
        <div class="legend" data-ref="legend"></div>
        <div class="panel-tools">
          <div class="seg" data-ref="seg" role="group" aria-label="Time window">
            ${WINDOWS.map(([s, l]) => html`<button type="button" data-w="${s}" aria-pressed="${prefs.get("chartWindow") === s}">${l}</button>`)}
          </div>
        </div>
      </div>
      <div class="chart-wrap"><canvas data-ref="cv" role="img" aria-label="Temperature graph"></canvas><div class="ct-tip" data-ref="tip" hidden></div></div>
    </section>`;
  const r = refs(el);
  host.append(el);

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
      const b = html`<button class="chip" aria-pressed="${!chart.hidden.has(k)}"><i style="background:${seriesColor(k)}"></i>${seriesLabel(k)}</button>`;
      b.addEventListener("click", () => {
        const h = new Set(chart.hidden);
        h.has(k) ? h.delete(k) : h.add(k);
        chart.setHidden(h);
        prefs.set("chartHidden", Array.from(h));
        b.setAttribute("aria-pressed", String(!h.has(k)));
      });
      return b;
    }));
  }
  const off = temps.on(legend);
  legend();

  return { dispose() { off(); chart.destroy(); el.remove(); } };
}
