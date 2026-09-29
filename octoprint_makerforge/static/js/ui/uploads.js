// Uploads: a small floating tray with per-file progress, plus a page-wide drop target.
import { html, raw, refs } from "mf/core/dom.js";
import { octo } from "mf/core/api.js";
import { icon } from "mf/ui/icons.js";
import { bus } from "mf/core/store.js";
import { toast } from "mf/ui/toast.js";
import { bytes } from "mf/core/format.js";
import { can } from "mf/core/auth.js";
import { store } from "mf/core/store.js";

const OK_EXT = /\.(gcode|gco|g|nc|ufp|stl|3mf)$/i;
let tray = null;
let currentFolder = () => "";

export function setFolderProvider(fn) { currentFolder = fn; }

function ensureTray() {
  if (tray?.isConnected) return tray;
  tray = html`<div class="uploads" aria-live="polite"></div>`;
  document.getElementById("overlays").append(tray);
  return tray;
}

export function uploadFiles(fileList, { folder, print = false, select = false } = {}) {
  if (!can("files_upload")) { toast.warn("Not allowed", "Your account can't upload files."); return; }
  const files = Array.from(fileList).filter((f) => {
    if (!OK_EXT.test(f.name)) { toast.warn(`Skipped ${f.name}`, "Only G-code files can be printed."); return false; }
    return true;
  });
  if (!files.length) return;
  const dest = folder ?? currentFolder();
  const host = ensureTray();
  files.forEach((file) => {
    const row = html`
      <div class="up-row cut cut-s">
        <div class="top">${raw(icon("upload", "i i-sm"))}<span class="nm truncate">${file.name}</span><span class="muted tnum" data-ref="pct">0%</span>
          <button class="btn btn-ghost btn-icon btn-sm" data-ref="x" aria-label="Cancel upload">${raw(icon("x", "i i-sm"))}</button></div>
        <div class="bar is-thin"><i data-ref="fill"></i></div>
      </div>`;
    const r = refs(row);
    host.append(row);
    const p = octo.uploadFile(file, { path: dest, select, print }, (frac) => {
      r.pct.textContent = `${Math.round(frac * 100)}%`;
      row.querySelector(".bar").style.setProperty("--p", `${frac * 100}%`);
    });
    r.x.addEventListener("click", () => p.abort());
    p.then((res) => {
      row.remove();
      const path = res?.files?.local?.path || (dest ? `${dest}/${file.name}` : file.name);
      toast({
        kind: "ok", title: "Uploaded", text: `${file.name} (${bytes(file.size)})`,
        action: print ? undefined : { label: "Select", onClick: () => import("mf/core/actions.js").then((a) => a.selectFile(path)) },
      });
      bus.emit("files:changed");
    }).catch((e) => {
      row.remove();
      if (!/cancelled/i.test(e.message)) toast.err(`Couldn't upload ${file.name}`, e.message);
    });
  });
}

/** Drag files anywhere on the page to upload them. */
export function initDropzone() {
  let depth = 0;
  let veil = null;
  const hasFiles = (e) => Array.from(e.dataTransfer?.types || []).includes("Files");
  const show = () => {
    if (veil) return;
    const dest = currentFolder();
    veil = html`<div class="dropveil"><div>Drop G-code to upload<small>${dest ? `Into ${dest}` : "Into your file library"}</small></div></div>`;
    document.getElementById("overlays").append(veil);
  };
  const hide = () => { veil?.remove(); veil = null; depth = 0; };
  window.addEventListener("dragenter", (e) => { if (!hasFiles(e) || !store.get("auth.authorised")) return; e.preventDefault(); depth++; show(); });
  window.addEventListener("dragover", (e) => { if (hasFiles(e)) e.preventDefault(); });
  window.addEventListener("dragleave", (e) => { if (!hasFiles(e)) return; depth = Math.max(0, depth - 1); if (!depth) hide(); });
  window.addEventListener("drop", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    hide();
    uploadFiles(e.dataTransfer.files);
  });
}
