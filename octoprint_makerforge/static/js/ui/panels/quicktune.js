// Live tuning while a print runs: speed, flow, fans, and Z baby-stepping.
import { html, raw, refs, debounce } from "mf/core/dom.js";
import { store } from "mf/core/store.js";
import { icon } from "mf/ui/icons.js";
import * as actions from "mf/core/actions.js";
import { config } from "mf/core/config.js";
import { can } from "mf/core/auth.js";
import { confirmDialog } from "mf/ui/dialog.js";
import { toast } from "mf/ui/toast.js";
import { isKlipper } from "mf/core/actions.js";

const SESSION = "mf.tune.v1";
const load = () => { try { return JSON.parse(sessionStorage.getItem(SESSION) || "{}"); } catch { return {}; } };
const save = (o) => { try { sessionStorage.setItem(SESSION, JSON.stringify(o)); } catch { /* private mode */ } };

export function setRangeFill(input) {
  const min = Number(input.min || 0), max = Number(input.max || 100), v = Number(input.value);
  input.style.setProperty("--pct", `${((v - min) / (max - min)) * 100}%`);
}

export function mountQuickTune(host) {
  const st = load();
  const el = html`
    <section class="panel a-tune" aria-label="Live tuning">
      <div class="panel-head"><h2 class="panel-title">Live tuning</h2></div>
      <div class="tune-body" data-ref="body">
        <div class="slider-row"><span class="k">${raw(icon("gauge"))}Speed</span><span class="v" data-ref="speedV">100%</span>
          <input class="range" type="range" min="25" max="200" step="5" value="${st.speed ?? 100}" data-ref="speed" aria-label="Speed factor"></div>
        <div class="slider-row"><span class="k">${raw(icon("flow"))}Flow</span><span class="v" data-ref="flowV">100%</span>
          <input class="range" type="range" min="80" max="120" step="1" value="${st.flow ?? 100}" data-ref="flow" aria-label="Flow factor"></div>
        <div class="slider-row"><span class="k">${raw(icon("fan"))}Part fan</span><span class="v" data-ref="fanV">0%</span>
          <input class="range" type="range" min="0" max="100" step="5" value="${st.fan ?? 0}" data-ref="fan" aria-label="Part cooling fan"></div>
        <div data-ref="extra" class="col gap-4"></div>
        <div class="zoff">
          <div class="zoff-read"><span class="k row" style="gap:8px">${raw(icon("zoffset", "i i-sm"))}Z offset</span><span><b data-ref="zNet">0.000</b> mm</span></div>
          <div class="zoff-btns" data-ref="zb">
            <button class="btn" data-d="-0.05" aria-label="Closer by 0.05 millimetres">−0.05</button>
            <button class="btn" data-d="-0.01" aria-label="Closer by 0.01 millimetres">−0.01</button>
            <button class="btn" data-d="0.01" aria-label="Further by 0.01 millimetres">+0.01</button>
            <button class="btn" data-d="0.05" aria-label="Further by 0.05 millimetres">+0.05</button>
          </div>
          <div class="row wrap" style="gap:var(--s-2)">
            <span class="hint grow">Baby steps. Negative moves the nozzle closer to the bed.</span>
            <button class="btn btn-sm btn-ghost" data-ref="zsave" data-tip="Adds this adjustment to the probe z_offset, then SAVE_CONFIG writes it to printer.cfg">${raw(icon("save"))}Save to probe</button>
          </div>
        </div>
      </div>
    </section>`;
  const r = refs(el);
  host.append(el);

  let zNet = st.zNet ?? 0;
  const persist = () => save({ speed: Number(r.speed.value), flow: Number(r.flow.value), fan: Number(r.fan.value), zNet });
  const paint = () => {
    r.speedV.textContent = `${r.speed.value}%`;
    r.flowV.textContent = `${r.flow.value}%`;
    r.fanV.textContent = `${r.fan.value}%`;
    r.zNet.textContent = (zNet >= 0 ? "+" : "") + zNet.toFixed(3);
    [r.speed, r.flow, r.fan].forEach(setRangeFill);
  };

  const sendSpeed = debounce(() => actions.feedrate(Number(r.speed.value)).catch(() => {}), 250);
  const sendFlow = debounce(() => actions.flowrate(Number(r.flow.value)).catch(() => {}), 250);
  const sendFan = debounce(() => actions.partFan(Number(r.fan.value)).catch(() => {}), 200);
  r.speed.addEventListener("input", () => { paint(); persist(); sendSpeed(); });
  r.flow.addEventListener("input", () => { paint(); persist(); sendFlow(); });
  r.fan.addEventListener("input", () => { paint(); persist(); sendFan(); });
  // double-click a slider to reset it
  r.speed.addEventListener("dblclick", () => { r.speed.value = 100; paint(); persist(); sendSpeed(); });
  r.flow.addEventListener("dblclick", () => { r.flow.value = 100; paint(); persist(); sendFlow(); });

  r.zb.addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-d]");
    if (!b) return;
    const d = Number(b.dataset.d);
    try {
      await actions.babyStepZ(d);
      zNet = Math.round((zNet + d) * 1000) / 1000;
      paint(); persist();
    } catch { /* toast shown */ }
  });

  r.zsave.addEventListener("click", async () => {
    if (!isKlipper()) { toast.info("Klipper only", "Saving to the probe offset needs Klipper."); return; }
    const ok = await confirmDialog({
      title: "Save this Z offset?",
      text: `This adds the ${zNet >= 0 ? "+" : ""}${zNet.toFixed(3)} mm adjustment to your probe's z_offset. You still have to run SAVE_CONFIG (Klipper restarts) to keep it.`,
      confirm: "Apply to probe",
    });
    if (!ok) return;
    try {
      await actions.gcode("Z_OFFSET_APPLY_PROBE");
      zNet = 0; paint(); persist();
      toast.ok("Offset staged", "Run “Save config” from Tune to make it permanent.");
    } catch { /* toast shown */ }
  });

  // extra fans configured in Settings (Nevermore, exhaust, ...)
  function renderExtra() {
    const fans = (config.data.fans || []).filter((f) => f.type === "generic" && f.enabled);
    r.extra.replaceChildren(...fans.map((f) => {
      const val = (load().fans || {})[f.id] ?? 0;
      const row = html`<div class="slider-row"><span class="k">${raw(icon("fan"))}${f.name}</span><span class="v">${val}%</span>
        <input class="range" type="range" min="0" max="100" step="5" value="${val}" aria-label="${f.name} fan"></div>`;
      const inp = row.querySelector("input"), out = row.querySelector(".v");
      setRangeFill(inp);
      const send = debounce(() => actions.genericFan(f.klipper, Number(inp.value)).catch(() => {}), 200);
      inp.addEventListener("input", () => {
        out.textContent = `${inp.value}%`;
        setRangeFill(inp);
        const cur = load(); cur.fans = { ...(cur.fans || {}), [f.id]: Number(inp.value) }; save(cur);
        send();
      });
      return row;
    }));
  }

  function enable() {
    const f = store.get("printer.flags");
    const on = (f.operational || f.printing || f.paused) && can("control");
    el.querySelectorAll("input, button").forEach((n) => { n.disabled = !on; });
  }
  const offs = [store.on("printer", enable), store.on("config", renderExtra), store.on("auth", enable)];
  paint(); renderExtra(); enable();
  return { dispose() { offs.forEach((o) => o()); el.remove(); } };
}
