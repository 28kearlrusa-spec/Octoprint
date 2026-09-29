// Timelapse: how frames are captured, and the movies made from them.
import { html, raw, refs, esc } from "mf/core/dom.js";
import { store, bus } from "mf/core/store.js";
import { octo } from "mf/core/api.js";
import { icon } from "mf/ui/icons.js";
import { bytes, dateTime, relative, stripExt } from "mf/core/format.js";
import { confirmDialog, openDialog } from "mf/ui/dialog.js";
import { toast } from "mf/ui/toast.js";
import { can } from "mf/core/auth.js";
import { webcamInfo } from "mf/core/webcam.js";
import * as router from "mf/core/router.js";
import { watchThumbs } from "mf/ui/panels/job.js";

const MODES = [["off", "Off"], ["zchange", "Each layer"], ["timed", "Timed"]];

export default {
  id: "timelapse",
  mount(el) {
    const view = html`
      <div>
        <div class="view-head"><h1>Timelapse</h1></div>
        <div class="callout is-warn" data-ref="warn" hidden>${raw(icon("alert"))}<div data-ref="warnText"></div></div>
        <div class="tune-grid" style="margin-top:var(--s-4)">
          <section class="panel" aria-label="Recording">
            <div class="panel-head"><h2 class="panel-title">Recording</h2><span class="chip" data-ref="state"></span></div>
            <div class="tool-body">
              <div class="field"><label>Capture</label><div class="seg" data-ref="mode" role="group" aria-label="Capture mode">${MODES.map(([v, l]) => html`<button type="button" data-v="${v}" aria-pressed="false">${l}</button>`)}</div>
                <div class="hint" data-ref="modeHint"></div></div>
              <div class="tool-row" data-ref="fields">
                <div class="field" data-for="timed"><label for="tl-int">Every (seconds)</label><input class="input" id="tl-int" type="number" min="1" step="1" data-ref="interval"></div>
                <div class="field" data-for="zchange"><label for="tl-min">Minimum gap (s)</label><input class="input" id="tl-min" type="number" min="0" step="0.5" data-ref="minDelay"></div>
                <div class="field" data-for="zchange"><label for="tl-zh">Z hop counts from (mm)</label><input class="input" id="tl-zh" type="number" min="0" step="0.1" data-ref="zhop"></div>
                <div class="field"><label for="tl-fps">Video frames per second</label><input class="input" id="tl-fps" type="number" min="1" max="120" data-ref="fps"></div>
                <div class="field"><label for="tl-post">Post roll (s)</label><input class="input" id="tl-post" type="number" min="0" data-ref="post"></div>
              </div>
              <div class="tool-row"><button class="btn btn-primary" data-ref="save">${raw(icon("save"))}Save settings</button></div>
              <div class="hint">“Each layer” takes one picture per layer change, which gives the smoothest result. “Timed” takes a picture at a fixed interval. Rendering needs ffmpeg on the printer's computer.</div>
            </div>
          </section>
          <section class="panel" aria-label="Unrendered captures">
            <div class="panel-head"><h2 class="panel-title">Waiting to render</h2></div>
            <div data-ref="unrendered"></div>
          </section>
          <section class="panel wide" style="grid-column:1/-1" aria-label="Finished timelapses">
            <div class="panel-head"><h2 class="panel-title">Finished movies</h2><span class="panel-sub" data-ref="count"></span></div>
            <div class="tool-body" data-ref="movies"></div>
          </section>
        </div>
      </div>`;
    const r = refs(view);
    el.append(view);
    watchThumbs(view);

    let data = null;
    let mode = "off";
    const setMode = (m) => {
      mode = m;
      r.mode.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.v === m)));
      r.fields.querySelectorAll("[data-for]").forEach((f) => { f.hidden = f.dataset.for !== m; });
      r.fields.hidden = m === "off";
      r.modeHint.textContent = { off: "No pictures are taken.", zchange: "One picture each time the print moves up a layer.", timed: "One picture at a fixed interval, whatever the printer is doing." }[m];
    };
    r.mode.addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) setMode(b.dataset.v); });

    async function load() {
      try { data = await octo.timelapse(); } catch (e) { toast.fail("Couldn't load timelapses", e); data = { config: {}, files: [], unrendered: [] }; }
      render();
    }

    function render() {
      const cfg = data.config || {};
      setMode(cfg.type || "off");
      r.interval.value = cfg.interval ?? 10;
      r.minDelay.value = cfg.minDelay ?? 5;
      r.zhop.value = cfg.retractionZHop ?? 0;
      r.fps.value = cfg.fps ?? 25;
      r.post.value = cfg.postRoll ?? 0;
      const wc = webcamInfo();
      const needCam = mode !== "off" && !wc.snapshot && !wc.configured;
      r.warn.hidden = !needCam;
      r.warnText.innerHTML = `Timelapse needs a camera snapshot address. <a class="link" href="#/settings/camera">Set up the camera</a>.`;
      const rec = store.get("timelapse");
      r.state.textContent = mode === "off" ? "Off" : rec?.type && rec.type !== "off" ? "Armed" : "Ready";
      r.state.className = "chip " + (mode === "off" ? "" : "is-accent");

      const un = data.unrendered || [];
      r.unrendered.innerHTML = un.length ? `<table class="table"><tbody>${un.map((u) => `<tr><td>${esc(u.name)}<div class="muted" style="font-size:var(--fs-xs)">${bytes(u.bytes ?? 0)}, ${relative(u.date)}${u.recording ? ", recording now" : u.rendering ? ", rendering" : ""}</div></td><td class="r nowrap">
        <button class="btn btn-sm" data-render="${esc(u.name)}" ${u.recording || u.rendering || !can("timelapse_manage_unrendered") ? "disabled" : ""}>${icon("film", "i i-sm")}Render</button>
        <button class="btn btn-sm btn-ghost btn-icon" data-delu="${esc(u.name)}" aria-label="Delete ${esc(u.name)}" ${u.recording ? "disabled" : ""}>${icon("trash", "i i-sm")}</button></td></tr>`).join("")}</tbody></table>`
        : `<div class="empty" style="padding:var(--s-6)"><div class="empty-text">No captures waiting. They show up here after a print if rendering is off or failed.</div></div>`;

      const files = data.files || [];
      r.count.textContent = files.length ? `${files.length} movie${files.length === 1 ? "" : "s"}` : "";
      r.movies.innerHTML = files.length ? `<div class="file-grid">${files.map((f) => `
        <div class="fcard" role="button" tabindex="0" data-play="${esc(f.name)}" aria-label="Play ${esc(f.name)}">
          <div class="fthumb">${icon("film")}${f.thumbnail ? `<img alt="" loading="lazy" src="${esc(f.thumbnail)}">` : ""}</div>
          <div class="fmeta"><div class="fname">${esc(stripExt(f.name.replace(/\.(mp4|mpg|mpeg|webm|avi)$/i, "")))}</div><div class="fsub"><span>${bytes(f.bytes ?? 0)}</span><span>${relative(f.date)}</span></div></div></div>`).join("")}</div>`
        : `<div class="empty">${icon("film")}<div class="empty-title">No timelapses yet</div><p class="empty-text">Turn capture on above, then start a print. The finished movie appears here.</p></div>`;
    }

    r.save.addEventListener("click", async () => {
      if (!can("timelapse_admin")) return toast.warn("Not allowed", "Your account can't change timelapse settings.");
      const body = { type: mode, fps: Number(r.fps.value) || 25, postRoll: Number(r.post.value) || 0, save: true };
      if (mode === "timed") body.interval = Number(r.interval.value) || 10;
      if (mode === "zchange") { body.minDelay = Number(r.minDelay.value) || 5; body.retractionZHop = Number(r.zhop.value) || 0; }
      r.save.classList.add("is-busy");
      try { await octo.saveTimelapse(body); toast.ok("Timelapse settings saved"); await load(); }
      catch (e) { toast.fail("Couldn't save", e); } finally { r.save.classList.remove("is-busy"); }
    });

    view.addEventListener("click", async (e) => {
      const play = e.target.closest("[data-play]")?.dataset.play;
      if (play) return openPlayer(play);
      const rn = e.target.closest("[data-render]")?.dataset.render;
      if (rn) { try { await octo.renderUnrendered(rn); toast.info("Rendering started", rn); load(); } catch (err) { toast.fail("Couldn't start rendering", err); } return; }
      const du = e.target.closest("[data-delu]")?.dataset.delu;
      if (du && (await confirmDialog({ title: "Delete this capture?", text: "The pictures are removed for good.", confirm: "Delete", danger: true }))) {
        try { await octo.deleteUnrendered(du); load(); } catch (err) { toast.fail("Couldn't delete", err); }
      }
    });
    view.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target.matches?.("[data-play]")) { e.preventDefault(); openPlayer(e.target.dataset.play); } });

    function openPlayer(name) {
      const url = octo.timelapseUrl(name);
      const body = html`<video controls autoplay playsinline preload="metadata" style="width:100%;max-height:70vh;background:#000" src="${url}"></video>`;
      const dlg = openDialog({
        title: stripExt(name), body, wide: true,
        buttons: [
          { label: "Delete", kind: "danger", icon: "trash", value: "del" },
          { label: "Download", icon: "download", onClick: () => { location.href = url; return false; } },
          { label: "Close", kind: "primary", value: "x" },
        ],
      });
      dlg.closed.then(async (v) => {
        body.pause?.();
        if (v === "del" && (await confirmDialog({ title: "Delete this movie?", text: name, confirm: "Delete", danger: true }))) {
          try { await octo.deleteTimelapse(name); toast.ok("Deleted", name); load(); } catch (err) { toast.fail("Couldn't delete", err); }
        }
      });
    }

    const offs = [bus.on("event:MovieDone", load), bus.on("event:MovieFailed", load), bus.on("event:CaptureStart", () => {}), bus.on("event:PrintDone", () => setTimeout(load, 3000)), store.on("timelapse", render)];
    load();
    return { unmount() { offs.forEach((o) => o()); } };
  },
};
