// The machine stage: live isometric schematic plus four corner readouts.
import { html, raw, refs } from "mf/core/dom.js";
import { store } from "mf/core/store.js";
import { icon } from "mf/ui/icons.js";
import { Machine } from "mf/ui/machine.js";
import { machineStatus, heater } from "mf/core/status.js";
import { config } from "mf/core/config.js";
import { toBed } from "mf/core/position.js";
import { openConnect } from "mf/ui/connect.js";
import { layerAt } from "mf/core/jobinfo.js";

const fmt = (v, d = 1) => (v == null ? "–" : v.toFixed(d));

export function mountStage(host) {
  const el = html`
    <section class="panel a-stage" aria-label="Machine">
      <div class="panel-head">
        <h2 class="panel-title">Machine</h2>
        <span class="panel-sub truncate" data-ref="sub"></span>
        <div class="panel-tools">
          <div class="seg" role="group" aria-label="Stage view" data-ref="seg">
            <button type="button" aria-pressed="true" data-mode="machine">Machine</button>
            <button type="button" aria-pressed="false" data-mode="toolpath">Toolpath</button>
          </div>
        </div>
      </div>
      <div class="stage-body" data-ref="body">
        <div class="stage-art" data-ref="art"></div>
        <div class="readout r-nozzle cut cut-s" data-ref="rNoz"><div class="r-label">${raw(icon("nozzle"))}Nozzle</div><div class="r-val"><span class="num tnum" data-ref="nozA">–</span><small data-ref="nozT"></small></div></div>
        <div class="readout r-chamber cut cut-s" data-ref="rCh"><div class="r-label">Chamber${raw(icon("chamber"))}</div><div class="r-val"><span class="num tnum" data-ref="chA">–</span><small data-ref="chT"></small></div></div>
        <div class="readout r-bed cut cut-s" data-ref="rBed"><div class="r-label">${raw(icon("bed"))}Bed</div><div class="r-val"><span class="num tnum" data-ref="bedA">–</span><small data-ref="bedT"></small></div></div>
        <div class="readout r-pos cut cut-s" data-ref="rPos"><div class="r-label">Position</div><div class="r-val"><span class="num tnum"><span class="ax">X</span><span data-ref="px">–</span></span><span class="num tnum"><span class="ax">Y</span><span data-ref="py">–</span></span><span class="num tnum"><span class="ax">Z</span><span data-ref="pz">–</span></span></div></div>
        <div class="stage-layer cut cut-s" data-ref="layer" hidden></div>
        <div class="stage-offline" data-ref="offline" hidden>
          <div class="big">Printer offline</div>
          <p>Connect to bring the schematic to life: temperatures, position and the part as it grows.</p>
          <button class="btn btn-primary" data-ref="connect">${raw(icon("plug"))}Connect printer</button>
        </div>
      </div>
    </section>`;
  const r = refs(el);
  host.append(el);

  const machine = new Machine(r.art);
  r.connect.addEventListener("click", () => openConnect());

  // The toolpath tab is provided by the viewer module, loaded on demand.
  let viewer = null;
  r.seg.addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-mode]");
    if (!b) return;
    for (const x of r.seg.children) x.setAttribute("aria-pressed", String(x === b));
    if (b.dataset.mode === "toolpath") {
      const mod = await import("mf/ui/panels/stage-toolpath.js");
      viewer = viewer || mod.mountToolpath(r.body);
      viewer.show();
      r.art.style.visibility = "hidden";
    } else {
      viewer?.hide();
      r.art.style.visibility = "";
    }
  });

  function render() {
    const s = store.state;
    const st = machineStatus(s);
    const profile = s.profile;
    const vol = profile?.volume;
    const volume = { w: vol?.width || 250, d: vol?.depth || 250, h: vol?.height || 250 };
    const cfg = config.data;
    const online = !!s.printer.flags.operational || !!s.printer.flags.printing || !!s.printer.flags.paused;

    const noz = heater("tool0", s), bed = heater("bed", s), ch = heater("chamber", s);
    const pos = s.position && Date.now() - s.position.at < 120000 ? s.position : null;
    const z = s.currentZ ?? pos?.z ?? 0;

    // part footprint from the layer scan (coordinates are machine coordinates)
    let part = null;
    const layers = s.jobinfo?.layers;
    if (layers?.bbox && (s.printer.flags.printing || s.printer.flags.paused || s.printer.flags.pausing) ) {
      const [minx, maxx, miny, maxy] = layers.bbox;
      const c = toBed({ x: (minx + maxx) / 2, y: (miny + maxy) / 2 }, profile);
      part = { w: Math.max(6, maxx - minx), d: Math.max(6, maxy - miny), cx: c.x, cy: c.y, h: layers.height };
    }

    const bedPos = pos ? toBed(pos, profile) : null;
    machine.update({
      volume,
      kin: cfg.kinematics,
      nozzle: { a: noz.actual, t: noz.target },
      bed: { a: bed.actual, t: bed.target },
      chamber: { a: ch.actual, t: ch.target },
      pos: bedPos ? { x: bedPos.x, y: bedPos.y, z } : null,
      z,
      part,
      state: st.key,
      online,
    });

    r.sub.textContent = `${profile?.name && profile.name !== "Default" ? profile.name + " · " : ""}${volume.w} × ${volume.d} × ${volume.h} mm`;

    r.nozA.textContent = noz.present ? `${fmt(noz.actual)}°` : "–";
    r.nozT.textContent = noz.target > 0 ? `→ ${Math.round(noz.target)}°` : "";
    r.bedA.textContent = bed.present ? `${fmt(bed.actual)}°` : "–";
    r.bedT.textContent = bed.target > 0 ? `→ ${Math.round(bed.target)}°` : "";
    r.rBed.hidden = profile?.heatedBed === false && !bed.present;
    r.rCh.hidden = !ch.present && !profile?.heatedChamber;
    r.chA.textContent = ch.present ? `${fmt(ch.actual)}°` : "–";
    r.chT.textContent = ch.target > 0 ? `→ ${Math.round(ch.target)}°` : "";

    r.px.textContent = pos ? pos.x.toFixed(1) : "–";
    r.py.textContent = pos ? pos.y.toFixed(1) : "–";
    r.pz.textContent = s.currentZ != null && (s.printer.flags.printing || s.printer.flags.paused) ? Number(s.currentZ).toFixed(2) : pos ? pos.z.toFixed(2) : "–";

    // layer chip while a job is running
    const active = s.printer.flags.printing || s.printer.flags.paused;
    const at = active ? layerAt(layers, s.progress?.filepos) : null;
    r.layer.hidden = !at;
    if (at) r.layer.innerHTML = `Layer <b>${at.number}</b> of <b>${at.total}</b>`;

    r.offline.hidden = online || st.key === "connecting";
    r.rNoz.style.opacity = r.rBed.style.opacity = r.rCh.style.opacity = r.rPos.style.opacity = online ? 1 : 0.55;
  }

  const offs = ["printer", "temps", "profile", "config", "position", "currentZ", "jobinfo", "progress", "klipper", "net"].map((k) => store.on(k, render));
  render();

  return { dispose() { offs.forEach((o) => o()); viewer?.dispose?.(); el.remove(); } };
}
