// The viewer's on-screen controls, shared by the file dialog and the dashboard stage.
import { html, raw, refs } from "mf/core/dom.js";
import { store } from "mf/core/store.js";
import { icon } from "mf/ui/icons.js";
import { octo } from "mf/core/api.js";
import { ToolpathView, fetchBuffer, TYPE_NAMES, typeColorCss } from "mf/ui/viewer/toolpath.js";
import { bytes } from "mf/core/format.js";
import { prefs } from "mf/core/prefs.js";

/**
 * createViewer(host, {path, size, live}) -> {load(), dispose(), view}
 * live: follow the running print (progress colouring, current layer, nozzle marker)
 */
export function createViewer(host, { path, size, live = false } = {}) {
  const el = html`
    <div class="vw">
      <canvas class="vw-canvas" data-ref="cv" role="img" aria-label="3D toolpath preview"></canvas>
      <div class="vw-top">
        <div class="seg" data-ref="mode" role="group" aria-label="Colour by">
          <button type="button" data-m="layer" aria-pressed="true">Layers</button>
          <button type="button" data-m="speed" aria-pressed="false">Speed</button>
          <button type="button" data-m="type" aria-pressed="false">Feature</button>
          ${live ? raw('<button type="button" data-m="progress" aria-pressed="false">Progress</button>') : ""}
        </div>
        <span class="grow"></span>
        <div class="seg" data-ref="presets" role="group" aria-label="View">
          <button type="button" data-p="iso">3D</button><button type="button" data-p="top">Top</button><button type="button" data-p="front">Front</button>
        </div>
        <button class="chip" data-ref="travel" aria-pressed="false" data-tip="Show travel moves">Travel</button>
      </div>
      <div class="vw-legend" data-ref="legend" hidden></div>
      <div class="vw-bottom" data-ref="bottom" hidden>
        <button class="btn btn-icon btn-sm" data-ref="play" aria-label="Play through the layers">${raw(icon("play"))}</button>
        <input class="range" type="range" min="1" max="1" value="1" data-ref="slider" aria-label="Layer">
        <div class="vw-layer tnum" data-ref="label">–</div>
        <label class="check" style="font-size:var(--fs-sm)"><input type="checkbox" data-ref="solo"> Only this layer</label>
        ${live ? raw('<label class="check" style="font-size:var(--fs-sm)"><input type="checkbox" data-ref="follow" checked> Follow print</label>') : ""}
      </div>
      <div class="vw-msg" data-ref="msg"><div class="bar"><i data-ref="bar"></i></div><span data-ref="msgText">Loading…</span></div>
    </div>`;
  const r = refs(el);
  host.append(el);

  const view = new ToolpathView(r.cv, { onChange: () => {} });
  if (!view.ok) { r.msgText.textContent = "This browser can't draw 3D (WebGL is off)."; r.bar.parentElement.hidden = true; return { load() {}, dispose() { el.remove(); }, view }; }

  const profile = store.get("profile");
  view.setBed({ w: profile?.volume?.width || 250, d: profile?.volume?.depth || 250, origin: profile?.volume?.origin });

  let mode = live ? "progress" : "layer";
  let playing = null;
  const setMode = (m) => {
    mode = m;
    view.setMode(m);
    r.mode.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.m === m)));
    r.legend.hidden = m !== "type" && m !== "speed";
    if (m === "type") r.legend.innerHTML = TYPE_NAMES.map((n, i) => `<span><i style="background:${typeColorCss(i)}"></i>${n}</span>`).join("");
    if (m === "speed") r.legend.innerHTML = `<span><i style="background:rgb(51,140,255)"></i>Slow</span><span><i style="background:rgb(102,255,128)"></i>Medium</span><span><i style="background:rgb(255,77,64)"></i>Fast</span>`;
  };
  r.mode.addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) setMode(b.dataset.m); });
  r.presets.addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) view.preset(b.dataset.p); });
  r.travel.addEventListener("click", () => { const on = r.travel.getAttribute("aria-pressed") !== "true"; r.travel.setAttribute("aria-pressed", String(on)); view.setTravel(on); });

  function label() {
    const n = view.layerCount;
    const cur = Number(r.slider.value);
    r.label.innerHTML = n ? `Layer <b>${cur}</b> / ${n}<span class="muted"> · ${view.layerZ(cur - 1)?.toFixed(2)} mm</span>` : "–";
  }
  function applySlider() {
    const cur = Number(r.slider.value);
    view.setRange(0, cur - 1, r.solo.checked);
    label();
    const min = Number(r.slider.min), max = Number(r.slider.max) || 1;
    r.slider.style.setProperty("--pct", `${((cur - min) / Math.max(1, max - min)) * 100}%`);
  }
  r.slider.addEventListener("input", () => { if (r.follow) r.follow.checked = false; applySlider(); });
  r.solo.addEventListener("change", applySlider);
  r.play.addEventListener("click", () => {
    if (playing) { clearInterval(playing); playing = null; r.play.innerHTML = icon("play"); return; }
    r.play.innerHTML = icon("pause");
    if (Number(r.slider.value) >= Number(r.slider.max)) r.slider.value = 1;
    if (r.follow) r.follow.checked = false;
    playing = setInterval(() => {
      const next = Number(r.slider.value) + Math.max(1, Math.round(Number(r.slider.max) / 240));
      if (next >= Number(r.slider.max)) { r.slider.value = r.slider.max; applySlider(); clearInterval(playing); playing = null; r.play.innerHTML = icon("play"); return; }
      r.slider.value = next; applySlider();
    }, 40);
  });

  async function load() {
    if (!path) return;
    try {
      r.msg.hidden = false; r.bar.parentElement.hidden = false;
      r.msgText.textContent = "Downloading…";
      const buf = await fetchBuffer(octo.downloadUrl(path), (f) => { r.bar.parentElement.style.setProperty("--p", `${f * 55}%`); r.msgText.textContent = `Downloading ${bytes(f * (size || 0)) || Math.round(f * 100) + "%"}`; });
      r.msgText.textContent = "Reading the toolpath…";
      const keepTravel = buf.byteLength < 30 * 1048576;
      const m = await view.parse(buf, { keepTravel, onProgress: (f) => { r.bar.parentElement.style.setProperty("--p", `${55 + f * 45}%`); } });
      r.msg.hidden = true;
      if (!m.counts.ext) { r.msg.hidden = false; r.bar.parentElement.hidden = true; r.msgText.textContent = "No printing moves were found in this file."; return; }
      r.bottom.hidden = false;
      r.slider.max = String(m.counts.layers);
      r.slider.value = String(m.counts.layers);
      r.travel.hidden = !keepTravel;
      setMode(mode);
      applySlider();
      onProgress();
    } catch (e) {
      r.msg.hidden = false; r.bar.parentElement.hidden = true;
      r.msgText.textContent = e.message || "Couldn't load the preview.";
    }
  }

  // live: follow the print
  function onProgress() {
    if (!live || !view.data) return;
    const pos = store.get("progress.filepos");
    view.setFilepos(pos);
    if (r.follow?.checked && pos != null) {
      const h = view.headAt(pos);
      if (h) { r.slider.value = String(Math.min(view.layerCount, h.layer + 1)); applySlider(); }
    }
  }
  const off = live ? store.on("progress", onProgress) : () => {};

  return {
    load, view, setMode,
    dispose() { clearInterval(playing); off(); view.destroy(); el.remove(); },
  };
}
