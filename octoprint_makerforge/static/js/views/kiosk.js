// Kiosk: a big, calm status screen for a tablet or monitor mounted next to the printer.
import { html, raw, refs } from "mf/core/dom.js";
import { store, bus } from "mf/core/store.js";
import { mf } from "mf/core/api.js";
import { icon } from "mf/ui/icons.js";
import { machineStatus, progressFrac, timeLeft, heater } from "mf/core/status.js";
import { duration, finishTime, timeOfDay, relative, stripExt, DASH } from "mf/core/format.js";
import { layerAt } from "mf/core/jobinfo.js";
import * as actions from "mf/core/actions.js";
import * as router from "mf/core/router.js";
import { holdToConfirm } from "mf/ui/dialog.js";
import { prefs } from "mf/core/prefs.js";
import { config } from "mf/core/config.js";
import { webcamInfo, webcamTransform, bust } from "mf/core/webcam.js";
import { setThrottle } from "mf/core/socket.js";

export default {
  id: "kiosk",
  mount(el) {
    const shell = el.closest(".shell");
    if (shell) shell.dataset.kiosk = "1";
    const view = html`
      <div class="kiosk" data-ref="root">
        <header class="k-top">
          <button class="btn btn-ghost btn-icon k-exit" data-ref="exit" aria-label="Leave kiosk mode">${raw(icon("x"))}</button>
          <div class="k-state"><span class="dot"></span><span data-ref="state">Ready</span></div>
          <span class="k-printer truncate" data-ref="printer"></span>
          <span class="k-clock tnum" data-ref="clock"></span>
        </header>
        <div class="k-body">
          <section class="k-main">
            <div class="k-job" data-ref="job">
              <div class="k-file"><div class="k-thumb" data-ref="thumb">${raw(icon("cube"))}<img alt="" hidden></div><div class="k-name" data-ref="name"></div></div>
              <div class="k-pct" data-ref="pct">–</div>
              <div class="k-bar" data-ref="bar"><i></i></div>
              <div class="k-stats">
                <div><div class="k">Time left</div><div class="v" data-ref="left">–</div></div>
                <div><div class="k">Finishes</div><div class="v" data-ref="eta">–</div></div>
                <div><div class="k">Layer</div><div class="v" data-ref="layer">–</div></div>
              </div>
            </div>
            <div class="k-idle" data-ref="idle">
              <div class="k-bigclock tnum" data-ref="bigclock"></div>
              <div class="k-date" data-ref="date"></div>
              <div class="k-last" data-ref="last"></div>
            </div>
          </section>
          <aside class="k-side">
            <div class="k-cam" data-ref="cam"><img alt="Camera" hidden></div>
            <div class="k-temps" data-ref="temps"></div>
            <div class="k-actions" data-ref="actions"></div>
          </aside>
        </div>
      </div>`;
    const r = refs(view);
    el.append(view);
    setThrottle(2);

    // camera: a plain image; stops when the tab is hidden
    const img = r.cam.querySelector("img");
    const info = webcamInfo();
    const startCam = () => { if (info.configured && prefs.get("camOpen")) { img.style.transform = webcamTransform(info); img.hidden = false; img.src = bust(info.stream); } else r.cam.hidden = true; };
    const stopCam = () => img.removeAttribute("src");
    const onVis = () => (document.hidden ? stopCam() : startCam());
    document.addEventListener("visibilitychange", onVis);
    startCam();

    let sig = "", thumbFor = null, last = null;
    function render() {
      const s = store.state;
      const st = machineStatus(s);
      const frac = progressFrac(s);
      const left = timeLeft(s);
      const at = layerAt(s.jobinfo?.layers, s.progress?.filepos);
      const f = s.printer.flags;
      const active = f.printing || f.paused || f.pausing;
      r.state.textContent = st.label;
      r.root.querySelector(".k-state .dot").className = `dot ${st.tone === "ok" ? "is-ok" : st.tone === "err" ? "is-err is-pulse" : st.tone === "warn" ? "is-warn" : st.tone === "busy" ? "is-on is-pulse" : ""}`;
      r.printer.textContent = config.data.printerName || s.profile?.name || "";
      r.name.textContent = (s.job?.file?.display || s.job?.file?.name || "").replace(/\.(gcode|gco|g)$/i, "");
      r.pct.innerHTML = frac != null ? `${Math.floor(frac * 100)}<small>%</small>` : "–";
      r.root.classList.toggle("is-idle", !active);
      r.job.hidden = !active;
      r.idle.hidden = !!active;
      const path = s.job?.file?.path;
      if (active && path && thumbFor !== path) {
        thumbFor = path;
        const t = r.thumb.querySelector("img");
        t.hidden = true;
        t.onload = () => { t.hidden = false; };
        t.onerror = () => { t.hidden = true; };
        t.src = mf.thumbUrl(path, s.job?.file?.date);
      }
      r.bar.style.setProperty("--p", `${(frac ?? 0) * 100}%`);
      r.bar.style.visibility = active ? "visible" : "hidden";
      r.left.textContent = active && left != null ? duration(left) : DASH;
      r.eta.textContent = active && left != null ? finishTime(new Date(Date.now() + left * 1000)) : DASH;
      r.layer.textContent = active && at ? `${at.number} / ${at.total}` : DASH;

      const a = `${active}|${f.paused || f.pausing}`;
      if (a !== sig) {
        sig = a;
        r.actions.replaceChildren();
        if (active) {
          const pause = html`<button class="btn">${raw(icon(f.paused || f.pausing ? "play" : "pause"))}${f.paused || f.pausing ? "Resume" : "Pause"}</button>`;
          pause.addEventListener("click", () => (f.paused || f.pausing ? actions.resumePrint() : actions.pausePrint()));
          const cancel = html`<button class="btn btn-danger">${raw(icon("stop"))}Hold to cancel</button>`;
          holdToConfirm(cancel, () => actions.cancelPrint(), Math.max(1400, Number(prefs.get("holdMs")) || 0));
          r.actions.append(pause, cancel);
        } else if (f.operational) {
          for (const p of config.data.presets.slice(0, 4)) {
            const b = html`<button class="btn">${raw(icon("flame"))}${p.name}</button>`;
            b.addEventListener("click", () => actions.preheat(p));
            r.actions.append(b);
          }
          const cool = html`<button class="btn btn-ghost">${raw(icon("snow"))}Cool down</button>`;
          cool.addEventListener("click", () => actions.cooldown());
          r.actions.append(cool);
        }
      }

      const names = ["tool0", "bed", "chamber"].filter((n) => s.temps?.[n] || n === "tool0");
      r.temps.innerHTML = names.map((n) => {
        const h = heater(n, s);
        const label = n === "tool0" ? "Nozzle" : n === "bed" ? "Bed" : "Chamber";
        const col = n === "tool0" ? "--heat-nozzle" : n === "bed" ? "--heat-bed" : "--heat-chamber";
        return `<div class="k-temp" style="--hc:var(${col})"><div class="l">${label}</div><div class="n">${h.actual != null ? h.actual.toFixed(0) + "°" : "–"}</div><div class="t">${h.target > 0 ? "Target " + Math.round(h.target) + "°" : "Off"}</div></div>`;
      }).join("");
    }
    const offs = ["printer", "temps", "progress", "job", "jobinfo", "config", "net", "klipper"].map((k) => store.on(k, render));
    render();

    // idle: the last print, so a glance from across the room says how it went
    const RESULT = { success: "Finished", failed: "Failed", cancelled: "Cancelled" };
    function renderLast() {
      if (!last) { r.last.replaceChildren(); return; }
      r.last.replaceChildren(html`<div class="k-last-row"><span class="k">Last print</span><b class="truncate">${stripExt(last.name)}</b>
        <span class="chip ${last.result === "success" ? "is-ok" : last.result === "failed" ? "is-err" : "is-warn"}">${RESULT[last.result] || last.result}</span>
        <span class="muted">${duration(last.seconds)}, ${relative(last.ts)}</span></div>`);
    }
    const loadLast = () => mf.stats().then((st) => { last = st.history?.[0] || null; renderLast(); }).catch(() => {});
    loadLast();
    const offDone = ["PrintDone", "PrintFailed", "PrintCancelled"].map((e) => bus.on(`event:${e}`, () => setTimeout(loadLast, 1500)));

    const clockTick = () => {
      const now = new Date();
      r.clock.textContent = timeOfDay(now);
      r.bigclock.textContent = timeOfDay(now);
      r.date.textContent = now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
      render();
    };
    clockTick();
    const clock = setInterval(clockTick, 10000);
    r.exit.addEventListener("click", () => router.go("print"));

    // dim after two idle minutes so an always-on screen isn't burning one image in
    let idle;
    const wake = () => { r.root.classList.remove("is-dim"); clearTimeout(idle); if (prefs.get("kioskDim")) idle = setTimeout(() => r.root.classList.add("is-dim"), 120000); };
    ["pointerdown", "pointermove", "keydown", "touchstart"].forEach((ev) => document.addEventListener(ev, wake, { passive: true }));
    wake();
    if (navigator.wakeLock?.request) navigator.wakeLock.request("screen").catch(() => {});

    return {
      unmount() {
        if (shell) delete shell.dataset.kiosk;
        setThrottle(1);
        offs.forEach((o) => o());
        offDone.forEach((o) => o());
        clearInterval(clock); clearTimeout(idle);
        document.removeEventListener("visibilitychange", onVis);
        ["pointerdown", "pointermove", "keydown", "touchstart"].forEach((ev) => document.removeEventListener(ev, wake));
        stopCam();
      },
    };
  },
};
