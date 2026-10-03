// A quick time-lapse of the current (or last) print: the camera pictures the printer's
// computer saves every so often during a print, played back as a flipbook.
import { html, raw, refs } from "mf/core/dom.js";
import { icon } from "mf/ui/icons.js";
import { get, PLUGIN, url } from "mf/core/api.js";
import { openDialog } from "mf/ui/dialog.js";
import { relative, stripExt } from "mf/core/format.js";

export async function openLapse() {
  let data = null;
  try { data = await get(`${PLUGIN}/api/preview`); } catch { data = null; }
  const frames = data?.frames || [];
  const body = html`<div class="lapse">
    <div class="lapse-frame"><img data-ref="img" alt="Time-lapse frame"></div>
    <div class="row gap-3 lapse-bar">
      <button class="btn btn-sm" data-ref="play">${raw(icon("pause"))}<span>Pause</span></button>
      <input class="range grow" type="range" min="0" max="${Math.max(0, frames.length - 1)}" value="0" data-ref="pos" aria-label="Frame">
      <span class="hint tnum" data-ref="count"></span>
    </div>
    <p class="hint">${data?.name ? `${stripExt(data.name)}, started ${relative(data.started)}. ` : ""}A picture is saved every 20 seconds while printing (less often on long prints), on the printer's computer.</p>
  </div>`;
  const r = refs(body);
  if (!frames.length) {
    body.replaceChildren(html`<div class="empty"><div class="empty-title">Nothing recorded yet</div><p class="empty-text">Pictures are saved during a print when a camera snapshot address is set up (Settings › Camera, or OctoPrint's webcam settings).</p></div>`);
    openDialog({ title: "Time-lapse", body, buttons: [{ label: "Close", kind: "primary" }] });
    return;
  }
  const srcs = frames.map((f) => url(`${PLUGIN}/api/preview/${f}`));
  // warm the cache so playback is smooth
  srcs.forEach((s) => { const i = new Image(); i.src = s; });
  let i = 0, playing = true, timer = null;
  const show = () => { r.img.src = srcs[i]; r.pos.value = String(i); r.count.textContent = `${i + 1} / ${srcs.length}`; };
  const tick = () => { i = (i + 1) % srcs.length; show(); };
  const setPlay = (on) => {
    playing = on;
    clearInterval(timer);
    if (on) timer = setInterval(tick, 120);
    r.play.innerHTML = `${icon(on ? "pause" : "play")}<span>${on ? "Pause" : "Play"}</span>`;
  };
  r.play.addEventListener("click", () => setPlay(!playing));
  r.pos.addEventListener("input", () => { setPlay(false); i = Number(r.pos.value); show(); });
  show();
  setPlay(true);
  const dlg = openDialog({ title: "Time-lapse so far", body, wide: true, buttons: [{ label: "Close", kind: "primary" }] });
  dlg.closed.then(() => clearInterval(timer));
}
