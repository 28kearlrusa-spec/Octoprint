// First-run checklist on the Print screen. Every tick comes from real state, and it goes away
// on its own once you're set up (or when you dismiss it).
import { html, raw, refs } from "mf/core/dom.js";
import { store } from "mf/core/store.js";
import { icon } from "mf/ui/icons.js";
import { octo } from "mf/core/api.js";
import { config } from "mf/core/config.js";
import { webcamInfo } from "mf/core/webcam.js";
import { openConnect } from "mf/ui/connect.js";
import * as router from "mf/core/router.js";
import { can } from "mf/core/auth.js";

const KEY = "mf.welcome.dismissed.v1";
const dismissed = () => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } };

export function mountWelcome(host) {
  if (dismissed()) return { dispose() {} };
  const el = html`
    <section class="panel welcome" aria-label="Getting started" hidden>
      <div class="panel-head"><h2 class="panel-title">Getting started</h2><span class="panel-sub" data-ref="sub"></span>
        <div class="panel-tools"><button class="btn btn-sm btn-ghost" data-ref="hide">Hide</button></div></div>
      <ol class="welcome-steps" data-ref="steps"></ol>
    </section>`;
  const r = refs(el);
  host.append(el);
  let fileCount = null;

  async function countFiles() {
    if (!can("files_list")) { fileCount = 1; return; }
    try {
      const res = await octo.files();
      let n = 0;
      const walk = (l) => l.forEach((f) => (f.children ? walk(f.children) : f.type === "machinecode" && n++));
      walk(res.files || []);
      fileCount = n;
    } catch { fileCount = 1; }
    render();
  }

  function render() {
    const f = store.get("printer.flags");
    const c = config.data;
    const steps = [
      { done: !!(f.operational || f.printing || f.paused), title: "Connect the printer", text: "For Klipper the port is usually /tmp/printer.", cta: "Connect", go: () => openConnect() },
      { done: !!(webcamInfo().configured || webcamInfo().snapshot), title: "Add a camera", text: "Set its stream address to watch prints here.", cta: "Camera settings", go: () => router.go("settings", ["camera"]) },
      { done: (fileCount ?? 0) > 0, title: "Upload G-code", text: "Drop a file on any page, or use Files.", cta: "Open Files", go: () => router.go("files") },
      { done: c.fans.some((x) => x.type === "generic" && x.enabled) || c.leds.some((x) => x.enabled), title: "Add fans and lights", text: "Nevermore, exhaust and LED names from printer.cfg.", cta: "Fans and lights", go: () => router.go("settings", ["fans"]) },
    ];
    const left = steps.filter((s) => !s.done).length;
    el.hidden = left === 0 || fileCount === null;
    r.sub.textContent = `${steps.length - left} of ${steps.length} done`;
    // only what's left to do; the count says how far along the setup is
    r.steps.replaceChildren(...steps.filter((s) => !s.done).map((s) => {
      const li = html`<li><span class="tick">${raw(icon("plus", "i i-sm"))}</span>
        <div class="step-text"><b>${s.title}</b><span class="muted">${s.text}</span></div>
        <button class="btn btn-sm">${s.cta}</button></li>`;
      li.querySelector("button").addEventListener("click", s.go);
      return li;
    }));
  }
  r.hide.addEventListener("click", () => { try { localStorage.setItem(KEY, "1"); } catch { /* ignore */ } el.remove(); });
  const offs = ["printer", "settings", "config"].map((k) => store.on(k, render));
  render();
  countFiles();
  return { dispose() { offs.forEach((o) => o()); el.remove(); } };
}
