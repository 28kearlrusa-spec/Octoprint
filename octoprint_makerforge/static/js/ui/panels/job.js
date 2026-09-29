// The job panel: what's printing, how far along, how long is left, and the controls.
import { html, raw, refs, esc } from "mf/core/dom.js";
import { store, bus } from "mf/core/store.js";
import { icon } from "mf/ui/icons.js";
import { mf, octo } from "mf/core/api.js";
import { can } from "mf/core/auth.js";
import { config } from "mf/core/config.js";
import { machineStatus, progressFrac, timeLeft } from "mf/core/status.js";
import { duration, finishTime, filamentLength, filamentGrams, grams, stripExt, relative, DASH } from "mf/core/format.js";
import { layerAt, filamentAt } from "mf/core/jobinfo.js";
import { confirmDialog, holdToConfirm, openDialog } from "mf/ui/dialog.js";
import * as actions from "mf/core/actions.js";
import * as router from "mf/core/router.js";
import { toast } from "mf/ui/toast.js";

const thumbBox = (path, mtime, big = false) => path
  ? `<span class="thumb ${big ? "is-lg" : ""}" data-thumb>${icon("cube")}<img alt="" loading="lazy" src="${esc(mf.thumbUrl(path, mtime))}"></span>`
  : `<span class="thumb ${big ? "is-lg" : ""}">${icon("cube")}</span>`;

/** Thumbnails start hidden behind the cube icon and fade in only once they actually load,
 *  so a file without a thumbnail just keeps its icon (no broken-image glyph). */
export function watchThumbs(root) {
  const sel = ".thumb > img, .fthumb > img";
  root.addEventListener("load", (e) => { if (e.target.matches?.(sel)) e.target.classList.add("is-ready"); }, true);
  root.addEventListener("error", (e) => { if (e.target.matches?.(sel)) e.target.remove(); }, true);
}

/** "Bed clear? Filament loaded?" checklist before a print starts. Resolves true to go ahead. */
export async function preflight(path, metaInfo) {
  const pf = config.data.preflight || {};
  if (pf.enabled === false || !pf.items?.length) return true;
  const body = html`
    <div class="col gap-4">
      <div class="row gap-4">
        ${raw(thumbBox(path, metaInfo?.mtime, true))}
        <div class="grow">
          <div class="job-name">${stripExt(path.split("/").pop())}</div>
          <div class="job-meta">
            ${metaInfo?.info?.estimatedSeconds ? html`<span>${duration(metaInfo.info.estimatedSeconds)} estimated</span>` : ""}
            ${metaInfo?.info?.nozzleTemp ? html`<span>${Math.round(metaInfo.info.nozzleTemp)}° nozzle</span>` : ""}
            ${metaInfo?.info?.bedTemp ? html`<span>${Math.round(metaInfo.info.bedTemp)}° bed</span>` : ""}
            ${metaInfo?.info?.filamentType ? html`<span>${metaInfo.info.filamentType}</span>` : ""}
          </div>
        </div>
      </div>
      <div class="col gap-3" data-ref="list">
        ${pf.items.map((t, i) => html`<label class="check"><input type="checkbox" data-i="${i}"> ${t}</label>`)}
      </div>
    </div>`;
  const boxes = () => Array.from(body.querySelectorAll("input[type=checkbox]"));
  const dlg = openDialog({
    title: "Ready to print?",
    body,
    buttons: [
      { label: "Cancel", kind: "ghost", value: false },
      { label: "Start print", kind: "primary", icon: "play", value: true, autofocus: false },
    ],
  });
  const go = dlg.el.querySelector(".dialog-foot .btn-primary");
  const sync = () => { go.disabled = !boxes().every((b) => b.checked); };
  body.addEventListener("change", sync);
  sync();
  return (await dlg.closed) === true;
}

export async function startWithChecks(path) {
  const m = await mf.meta(path).catch(() => null);
  if (!(await preflight(path, m))) return;
  try { await actions.startPrint(path); } catch { /* toast shown */ }
}

export function mountJob(host) {
  const el = html`
    <section class="panel a-job" aria-label="Current job">
      <div class="panel-head">
        <h2 class="panel-title">Job</h2>
        <span class="chip" data-ref="chip"></span>
        <div class="panel-tools" data-ref="tools"></div>
      </div>
      <div class="job-body" data-ref="body"></div>
    </section>`;
  const r = refs(el);
  host.append(el);
  watchThumbs(el);

  let recent = null;          // recent files for the empty state
  let recentLoading = false;

  async function loadRecent() {
    if (recent || recentLoading || !can("files_list")) return;
    recentLoading = true;
    try {
      const res = await octo.files();
      const list = [];
      const walk = (items) => items.forEach((f) => (f.children ? walk(f.children) : f.type === "machinecode" && list.push(f)));
      walk(res.files || []);
      list.sort((a, b) => (b.date || 0) - (a.date || 0));
      recent = list.slice(0, 4);
    } catch { recent = []; }
    recentLoading = false;
    render();
  }
  const offFiles = bus.on("files:changed", () => { recent = null; loadRecent(); });

  const stat = (k, id) => `<div class="stat"><div class="k">${k}</div><div class="v" data-v="${id}"></div></div>`;
  const statsHtml = (cells) => `<div class="stats">${cells.map(([k, id]) => stat(k, id)).join("")}</div>`;
  const setV = (id, value) => {
    const node = r.body.querySelector(`[data-v="${id}"]`);
    if (node && node.innerHTML !== String(value)) node.innerHTML = value;
  };
  const setT = (sel, value) => {
    const node = r.body.querySelector(sel);
    if (node && node.textContent !== String(value)) node.textContent = value;
  };

  // Build the skeleton once per state, then only update values in place. Rebuilding every
  // second would reset a hold-to-confirm gesture in progress.
  function skeleton(mode, ctx) {
    const { file, name, ji, info, f, online } = ctx;
    const meta = (parts) => `<div class="job-meta">${parts.filter(Boolean).map((t) => `<span>${t}</span>`).join("")}</div>`;
    const head = (big) => `<div class="job-top">${thumbBox(file.path, ji?.meta?.mtime, big)}<div class="grow" style="min-width:0"><div class="job-name">${esc(name)}</div><div data-v="meta"></div></div></div>`;
    if (mode === "active") {
      return `${head(false)}
        <div>
          <div class="job-pct"><span class="num tnum" data-v="pct"></span></div>
          <div class="job-bar" data-bar role="progressbar" aria-valuemin="0" aria-valuemax="100"><i></i></div>
        </div>
        ${statsHtml([["Elapsed", "elapsed"], ["Remaining", "left"], ["Finishes", "eta"], ["Layer", "layer"], ["Height", "height"], ["Filament", "filament"]])}
        <div class="hint" data-v="hint"></div>
        <div class="job-actions">
          ${f.paused || f.pausing
            ? `<button class="btn btn-primary" data-act="resume">${icon("play")}Resume</button>`
            : `<button class="btn" data-act="pause" ${f.cancelling ? "disabled" : ""}>${icon("pause")}Pause</button>`}
          <button class="btn btn-danger" data-act="cancel" data-tip="Hold to cancel this print" ${f.cancelling ? "disabled" : ""}>${icon("stop")}<span>Hold to cancel</span></button>
        </div>`;
    }
    if (mode === "done") {
      return `${head(false)}
        <div class="callout is-ok">${icon("check")}<div>Print complete. Let the bed cool before you take the part off.</div></div>
        <div class="job-actions">
          <button class="btn btn-primary" data-act="again" ${online ? "" : "disabled"}>${icon("refresh")}Print again</button>
          <button class="btn" data-act="cool" ${online ? "" : "disabled"}>${icon("snow")}Cool down</button>
          <button class="btn btn-ghost" data-act="files">${icon("folder")}Choose another</button>
        </div>`;
    }
    if (mode === "ready") {
      return `${head(true)}
        ${statsHtml([["Estimated", "est"], ["Finishes", "eta"], ["Layers", "layers"], ["Nozzle", "nozzle"], ["Bed", "bed"], ["Filament", "filament"]])}
        <div class="job-actions">
          <button class="btn btn-primary btn-lg" data-act="start" ${online && can("print") ? "" : "disabled"}>${icon("play")}Start print</button>
          <button class="btn" data-act="preheat" ${online && (info.nozzleTemp || info.bedTemp) ? "" : "disabled"}>${icon("flame")}Preheat</button>
          <button class="btn btn-ghost" data-act="files">${icon("folder")}Files</button>
        </div>
        ${online ? "" : `<div class="hint">Connect the printer to start this print.</div>`}`;
    }
    return `
      <div class="empty" style="padding:var(--s-5) var(--s-2) var(--s-3)">
        ${icon("cube")}
        <div class="empty-title">Nothing loaded</div>
        <p class="empty-text">Pick a file from your library, or drop a G-code file anywhere on this page to upload it.</p>
        <button class="btn btn-primary" data-act="files">${icon("folder")}Browse files</button>
      </div>
      ${recent?.length ? `<div class="job-recent"><div class="label" style="padding:0 var(--s-2)">Recent</div>${recent.map((rf) => `
        <button class="recent-row" data-recent="${esc(rf.path)}">${thumbBox(rf.path, rf.date)}<span class="grow" style="min-width:0"><div class="nm truncate">${esc(stripExt(rf.display || rf.name))}</div><div class="sub">${relative(rf.date)}${rf.gcodeAnalysis?.estimatedPrintTime ? ` · ${duration(rf.gcodeAnalysis.estimatedPrintTime)}` : ""}</div></span></button>`).join("")}</div>` : ""}`;
  }

  let currentSig = null;

  function render() {
    const s = store.state;
    const f = s.printer.flags;
    const st = machineStatus(s);
    const file = s.job?.file || {};
    const hasFile = !!file.name;
    const name = stripExt(file.display || file.name || "");
    const ji = s.jobinfo && s.jobinfo.path === file.path ? s.jobinfo : null;
    const info = ji?.meta?.info || {};
    const active = f.printing || f.paused || f.pausing || f.cancelling;
    const frac = progressFrac(s);
    const finished = !active && hasFile && (s.progress?.completion ?? 0) >= 99.9;
    const online = f.operational || active;
    const fc = config.data.filament;

    r.chip.className = "chip " + ({ ok: "is-ok", busy: "is-accent", warn: "is-warn", err: "is-err", info: "is-info" }[st.tone] || "");
    r.chip.textContent = st.label;

    const mode = active ? "active" : finished ? "done" : hasFile ? "ready" : "empty";
    const ctx = { file, name, ji, info, f, online };
    const sig = [mode, file.path, f.paused || f.pausing ? "p" : "", f.cancelling ? "c" : "", online ? "o" : "", ji?.meta ? "m" : "", ji?.layers ? "l" : "", recent ? recent.length : "-"].join("|");
    if (sig !== currentSig) {
      currentSig = sig;
      r.body.innerHTML = skeleton(mode, ctx);
      wire();
    }

    const metaParts = [info.slicer && esc(info.slicer.split(" ")[0]), info.filamentType && esc(info.filamentType), info.layerHeight && `${info.layerHeight} mm layers`, mode === "active" && s.job?.user && `by ${esc(s.job.user)}`];
    setV("meta", `<div class="job-meta">${metaParts.filter(Boolean).map((t) => `<span>${t}</span>`).join("")}${mode === "done" ? `<span>Finished in ${duration(s.progress?.printTime)}</span>` : ""}</div>`);

    if (mode === "active") {
      const left = timeLeft(s);
      const at = layerAt(ji?.layers, s.progress?.filepos);
      const used = filamentAt(ji?.layers, s.progress?.filepos);
      const totalMm = s.job?.filament?.tool0?.length ?? ji?.layers?.filamentMm ?? info.filamentMm;
      const usedG = used != null ? filamentGrams(used, fc.diameter, fc.density) : null;
      const zMax = ji?.layers?.height;
      const pct = frac == null ? 0 : frac * 100;
      const origin = { linear: "linear extrapolation", analysis: "slicer estimate", estimate: "slicer estimate", average: "the average of past prints", mixed: "a blend of estimate and progress" }[s.progress?.printTimeLeftOrigin];
      setV("pct", `${Math.floor(pct)}<small>%</small>`);
      const bar = r.body.querySelector("[data-bar]");
      if (bar) {
        bar.style.setProperty("--p", `${pct.toFixed(2)}%`);
        bar.setAttribute("aria-valuenow", String(Math.floor(pct)));
        bar.classList.toggle("is-active", !!f.printing);
      }
      setV("elapsed", duration(s.progress?.printTime));
      setV("left", left == null ? DASH : duration(left));
      setV("eta", left != null ? finishTime(new Date(Date.now() + left * 1000)) : DASH);
      setV("layer", at ? `${at.number}<small> / ${at.total}</small>` : DASH);
      setV("height", s.currentZ != null ? `${Number(s.currentZ).toFixed(2)}<small>${zMax ? ` / ${zMax.toFixed(1)} mm` : " mm"}</small>` : DASH);
      setV("filament", used != null ? `${filamentLength(used)}${totalMm ? `<small> / ${filamentLength(totalMm)}</small>` : ""}` : totalMm ? filamentLength(totalMm) : DASH);
      setV("hint", origin && left != null ? `Time left comes from ${origin}.${usedG != null ? ` About ${grams(usedG)} of filament used so far.` : ""}` : "");
    } else if (mode === "ready") {
      const est = info.estimatedSeconds ?? s.job?.estimatedPrintTime;
      const mm = info.filamentMm ?? s.job?.filament?.tool0?.length;
      setV("est", est ? duration(est) : DASH);
      setV("eta", est ? finishTime(new Date(Date.now() + est * 1000)) : DASH);
      setV("layers", ji?.layers?.count ?? info.layerCount ?? DASH);
      setV("nozzle", info.nozzleTemp ? `${Math.round(info.nozzleTemp)}°` : DASH);
      setV("bed", info.bedTemp ? `${Math.round(info.bedTemp)}°` : DASH);
      setV("filament", mm ? `${filamentLength(mm)}<small> ${grams(info.filamentGrams ?? filamentGrams(mm, fc.diameter, fc.density))}</small>` : DASH);
    }
  }

  function wire() {
    const q = (a) => r.body.querySelector(`[data-act="${a}"]`);
    q("pause")?.addEventListener("click", () => actions.pausePrint());
    q("resume")?.addEventListener("click", () => actions.resumePrint());
    const cancel = q("cancel");
    if (cancel) holdToConfirm(cancel, () => actions.cancelPrint(), 1000);
    q("start")?.addEventListener("click", () => startWithChecks(store.get("job.file.path")));
    q("again")?.addEventListener("click", () => startWithChecks(store.get("job.file.path")));
    q("cool")?.addEventListener("click", () => actions.cooldown());
    q("files")?.addEventListener("click", () => router.go("files"));
    q("preheat")?.addEventListener("click", () => {
      const info = store.get("jobinfo")?.meta?.info || {};
      actions.preheat({ name: info.filamentType || "this file", nozzle: Math.round(info.nozzleTemp || 0), bed: Math.round(info.bedTemp || 0), chamber: Math.round(info.chamberTemp || 0) });
    });
    r.body.querySelectorAll("[data-recent]").forEach((b) => b.addEventListener("click", async () => {
      try { await actions.selectFile(b.dataset.recent); } catch { /* toast shown */ }
    }));
  }

  const offs = ["printer", "job", "progress", "jobinfo", "currentZ", "config", "net", "klipper"].map((k) => store.on(k, render));
  render();
  loadRecent();
  return { dispose() { offs.forEach((o) => o()); offFiles(); el.remove(); } };
}
