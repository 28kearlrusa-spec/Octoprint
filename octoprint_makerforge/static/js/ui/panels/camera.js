// Webcam panel. MJPEG streams are held open only while the tab is visible, so a forgotten
// browser tab doesn't keep pulling video from a Raspberry Pi all night.
import { html, raw, refs, download } from "mf/core/dom.js";
import { store } from "mf/core/store.js";
import { icon } from "mf/ui/icons.js";
import { webcamInfo, webcamTransform, bust } from "mf/core/webcam.js";
import { prefs } from "mf/core/prefs.js";
import { toast } from "mf/ui/toast.js";
import * as router from "mf/core/router.js";

export function mountCamera(host, { compact = false } = {}) {
  const el = html`
    <section class="panel a-cam" aria-label="Camera">
      <div class="panel-head">
        <h2 class="panel-title">Camera</h2>
        <span class="panel-sub" data-ref="sub"></span>
        <div class="panel-tools">
          <button class="btn btn-ghost btn-icon btn-sm" data-ref="reload" aria-label="Reload stream" data-tip="Reload stream">${raw(icon("refresh"))}</button>
          <button class="btn btn-ghost btn-icon btn-sm" data-ref="snap" aria-label="Save snapshot" data-tip="Save snapshot">${raw(icon("camera"))}</button>
          <button class="btn btn-ghost btn-icon btn-sm" data-ref="full" aria-label="Full screen" data-tip="Full screen">${raw(icon("maximize"))}</button>
        </div>
      </div>
      <div class="cam-frame" data-ref="frame">
        <img data-ref="img" alt="Live view of the print bed" hidden>
        <div class="cam-badge" data-ref="badge" hidden><span class="dot is-err"></span>Live</div>
        <div class="cam-empty" data-ref="empty" hidden></div>
      </div>
    </section>`;
  const r = refs(el);
  host.append(el);

  let info = webcamInfo();
  let retry = null;
  let snapTimer = null;
  let attempts = 0;
  let everSeen = false;

  function emptyState(kind) {
    r.img.hidden = true;
    r.badge.hidden = true;
    r.empty.hidden = false;
    r.reload.disabled = r.snap.disabled = r.full.disabled = true;
    if (kind === "none") {
      r.empty.innerHTML = `${icon("camera")}<b>No camera set up</b><span>Add the stream address in Settings to watch prints here.</span><button class="btn btn-sm" data-go>${icon("settings")}Camera settings</button>`;
      r.empty.querySelector("[data-go]").addEventListener("click", () => router.go("settings", ["camera"]));
    } else if (kind === "lost") {
      // A camera that was never seen is "not responding"; one that dropped out is "lost"
      r.empty.innerHTML = everSeen
        ? `${icon("wifi-off")}<b>Camera stream stopped</b><span>Reconnecting automatically.</span>`
        : `${icon("camera")}<b>Camera not responding</b><span>The camera service on the printer isn't answering. This page keeps checking.</span><button class="btn btn-sm" data-go>${icon("settings")}Camera settings</button>`;
      r.empty.querySelector("[data-go]")?.addEventListener("click", () => router.go("settings", ["camera"]));
      r.reload.disabled = false;
    } else if (kind === "unsupported") {
      r.empty.innerHTML = `${icon("video")}<b>This stream type can't play here</b><span>Open the stream in its own tab instead.</span><a class="btn btn-sm" target="_blank" rel="noopener" href="${info.stream}">${icon("external")}Open stream</a>`;
    }
  }

  function stop() {
    clearTimeout(retry);
    clearInterval(snapTimer);
    r.img.removeAttribute("src");
  }

  function start() {
    stop();
    info = webcamInfo();
    r.img.style.transform = webcamTransform(info);
    r.sub.textContent = "";
    if (!prefs.get("camOpen")) return;
    if (!info.configured && !info.snapshot) return emptyState("none");
    if (info.isHls || info.isWebrtc) return emptyState("unsupported");

    r.empty.hidden = true;
    r.reload.disabled = r.snap.disabled = r.full.disabled = false;
    r.img.hidden = false;

    if (info.configured) {
      r.img.onload = () => { attempts = 0; everSeen = true; r.badge.hidden = false; r.empty.hidden = true; r.img.hidden = false; };
      r.img.onerror = () => {
        attempts++;
        emptyState("lost");
        retry = setTimeout(start, Math.min(2000 * attempts, 30000));
      };
      r.img.src = bust(info.stream);
    } else {
      // no stream, only snapshots: refresh every couple of seconds
      const refresh = () => { r.img.src = bust(info.snapshot); };
      r.img.onload = () => { everSeen = true; r.badge.hidden = false; };
      refresh();
      snapTimer = setInterval(refresh, 2500);
      r.sub.textContent = "Snapshots";
    }
  }

  const onVisibility = () => { if (document.hidden) stop(); else start(); };
  document.addEventListener("visibilitychange", onVisibility);

  r.reload.addEventListener("click", start);
  r.full.addEventListener("click", () => {
    const f = r.frame;
    if (document.fullscreenElement) document.exitFullscreen();
    else (f.requestFullscreen || f.webkitRequestFullscreen)?.call(f);
  });
  r.frame.addEventListener("dblclick", () => r.full.click());
  r.snap.addEventListener("click", async () => {
    try {
      let blob;
      const src = info.snapshot || info.stream;
      if (info.snapshot) {
        const res = await fetch(bust(info.snapshot), { credentials: "same-origin" });
        blob = await res.blob();
      } else {
        // grab the current frame of the stream
        const c = document.createElement("canvas");
        c.width = r.img.naturalWidth; c.height = r.img.naturalHeight;
        c.getContext("2d").drawImage(r.img, 0, 0);
        blob = await new Promise((ok) => c.toBlob(ok, "image/jpeg", 0.92));
      }
      if (!blob || !blob.size) throw new Error("The camera returned an empty picture.");
      download(`makerforge-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.jpg`, blob);
    } catch (e) {
      toast.fail("Couldn't save a snapshot", e);
    }
  });

  const offs = [store.on("settings", start), store.on("config", start)];
  start();

  return {
    dispose() { stop(); document.removeEventListener("visibilitychange", onVisibility); offs.forEach((o) => o()); el.remove(); },
  };
}
