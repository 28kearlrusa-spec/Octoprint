// Picture in picture: a small camera view in the corner of every screen except Print and the
// kiosk (which have their own). Turned on from the camera panel; this browser only.
import { html, raw, refs } from "mf/core/dom.js";
import { icon } from "mf/ui/icons.js";
import { prefs } from "mf/core/prefs.js";
import { currentWebcam, webcamTransform, bust } from "mf/core/webcam.js";
import * as router from "mf/core/router.js";
import { store } from "mf/core/store.js";

export function mountPip(root) {
  const el = html`<div class="pip" hidden>
    <img data-ref="img" alt="Camera">
    <button class="btn btn-icon btn-sm pip-x" data-ref="x" aria-label="Hide the small camera">${raw(icon("x"))}</button>
  </div>`;
  const r = refs(el);
  root.append(el);
  let src = "";

  function sync() {
    const route = router.currentRoute()?.id || "print";
    const info = currentWebcam(prefs.get("camName"));
    const want = prefs.get("camPip") && route !== "print" && route !== "kiosk" && !document.hidden && (info.configured || info.snapshot) && !info.isHls && !info.isWebrtc;
    el.hidden = !want;
    if (!want) { if (src) { r.img.removeAttribute("src"); src = ""; } return; }
    const next = info.configured ? info.stream : info.snapshot;
    if (next !== src) { src = next; r.img.src = bust(next); r.img.style.transform = webcamTransform(info); }
  }
  r.img.addEventListener("click", () => router.go("print"));
  r.x.addEventListener("click", () => prefs.set("camPip", false));
  const offs = [router.onChange(sync), prefs.on(sync), store.on("settings", sync), store.on("config", sync)];
  document.addEventListener("visibilitychange", sync);
  // snapshot-only cameras: refresh the still now and then
  const t = setInterval(() => { if (!el.hidden && !currentWebcam(prefs.get("camName")).configured && src) r.img.src = bust(src); }, 3000);
  sync();
  return () => { offs.forEach((o) => o()); clearInterval(t); document.removeEventListener("visibilitychange", sync); el.remove(); };
}
