// Files: your G-code library with thumbnails, folders, search, upload and details.
import { html, raw, refs, debounce, esc } from "mf/core/dom.js";
import { store, bus } from "mf/core/store.js";
import { octo, mf } from "mf/core/api.js";
import { icon } from "mf/ui/icons.js";
import * as router from "mf/core/router.js";
import { prefs } from "mf/core/prefs.js";
import { can } from "mf/core/auth.js";
import * as actions from "mf/core/actions.js";
import { meta } from "mf/core/jobinfo.js";
import { bytes, duration, dateTime, relative, filamentLength, stripExt, basename, dirname, grams, filamentGrams, plural } from "mf/core/format.js";
import { confirmDialog, promptDialog, openDialog } from "mf/ui/dialog.js";
import { openMenu } from "mf/ui/menu.js";
import { toast } from "mf/ui/toast.js";
import { uploadFiles, setFolderProvider } from "mf/ui/uploads.js";
import { watchThumbs, startWithChecks } from "mf/ui/panels/job.js";
import { config } from "mf/core/config.js";

const SORTS = {
  "date-desc": ["Newest first", (a, b) => (b.date || 0) - (a.date || 0)],
  "date-asc": ["Oldest first", (a, b) => (a.date || 0) - (b.date || 0)],
  "name-asc": ["Name A–Z", (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })],
  "name-desc": ["Name Z–A", (a, b) => b.name.localeCompare(a.name, undefined, { numeric: true })],
  "size-desc": ["Largest first", (a, b) => (b.size || 0) - (a.size || 0)],
  "time-desc": ["Longest print", (a, b) => (b.gcodeAnalysis?.estimatedPrintTime || 0) - (a.gcodeAnalysis?.estimatedPrintTime || 0)],
  "prints-desc": ["Most printed", (a, b) => printCount(b) - printCount(a)],
};
const printCount = (f) => (f.prints?.success || 0) + (f.prints?.failure || 0);
const isFolder = (f) => f.type === "folder";

function walk(items, fn) { for (const f of items || []) { fn(f); if (f.children) walk(f.children, fn); } }
function findFolder(tree, path) {
  if (!path) return tree;
  let cur = tree;
  for (const seg of path.split("/")) {
    const next = (cur || []).find((f) => isFolder(f) && f.name === seg);
    if (!next) return null;
    cur = next.children || [];
  }
  return cur;
}

export default {
  id: "files",
  mount(el, { route }) {
    const view = html`
      <div>
        <div class="view-head"><h1>Files</h1><span class="view-sub" data-ref="count"></span></div>
        <div class="files-bar">
          <nav class="crumbs" data-ref="crumbs" aria-label="Folder"></nav>
          <div class="files-tools">
            <input class="input" type="search" placeholder="Search all files" aria-label="Search files" data-ref="q">
            <button class="btn btn-sm" data-ref="sort">${raw(icon("sort"))}<span data-ref="sortl">Newest first</span></button>
            <div class="seg" data-ref="mode" role="group" aria-label="View">
              <button type="button" data-m="grid" aria-label="Grid">${raw(icon("grid", "i i-sm"))}</button>
              <button type="button" data-m="list" aria-label="List">${raw(icon("list", "i i-sm"))}</button>
            </div>
            <button class="btn btn-sm" data-ref="mkdir">${raw(icon("folder-plus"))}New folder</button>
            <button class="btn btn-primary btn-sm" data-ref="up">${raw(icon("upload"))}Upload</button>
            <input type="file" multiple accept=".gcode,.gco,.g,.nc,.ufp,.stl,.3mf" hidden data-ref="pick">
          </div>
        </div>
        <div class="storage" data-ref="storage"></div>
        <div data-ref="body"></div>
        <div data-ref="selbar"></div>
      </div>`;
    const r = refs(view);
    el.append(view);
    watchThumbs(view);

    let tree = null, free = null, total = null, loading = true;
    let folder = route.rest.join("/");
    let sortKey = prefs.get("filesSort") in SORTS ? prefs.get("filesSort") : "date-desc";
    let query = "";
    const sel = new Set();
    setFolderProvider(() => folder);

    async function load() {
      try {
        const res = await octo.files();
        tree = res.files || [];
        free = res.free; total = res.total;
      } catch (e) {
        tree = tree || [];
        toast.fail("Couldn't load the file list", e);
      }
      loading = false;
      render();
    }
    const reload = debounce(load, 350);
    const offBus = bus.on("files:changed", reload);

    // ~~ lazy per-card details (material, slicer time) ~~
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        io.unobserve(en.target);
        const path = en.target.dataset.path;
        meta(path).then((m) => { if (m?.info) decorate(en.target, m.info); });
      }
    }, { rootMargin: "200px" });
    function decorate(card, info) {
      const chips = card.querySelector(".fthumb .chips");
      if (!chips || chips.dataset.done) return;
      chips.dataset.done = "1";
      const parts = [info.filamentType, info.layerHeight && `${info.layerHeight} mm`].filter(Boolean);
      chips.innerHTML = parts.map((t) => `<span class="chip">${esc(t)}</span>`).join("");
      if (info.estimatedSeconds) {
        const sub = card.querySelector('[data-role="time"]');
        if (sub && !sub.textContent) sub.textContent = duration(info.estimatedSeconds);
      }
    }

    // ~~ rendering ~~
    function current() {
      const all = [];
      if (query) {
        walk(tree, (f) => { if (!isFolder(f) && `${f.name} ${f.path}`.toLowerCase().includes(query)) all.push(f); });
        return all;
      }
      return findFolder(tree || [], folder) || [];
    }

    function renderCrumbs() {
      const segs = folder ? folder.split("/") : [];
      const parts = [`<a href="#/files">Library</a>`];
      segs.forEach((s, i) => {
        parts.push(`<span class="sepc">${icon("chev-right", "i i-sm")}</span>`);
        const to = segs.slice(0, i + 1).map(encodeURIComponent).join("/");
        parts.push(i === segs.length - 1 ? `<span class="cur">${esc(s)}</span>` : `<a href="#/files/${to}">${esc(s)}</a>`);
      });
      r.crumbs.innerHTML = parts.join("");
    }

    function cardHtml(f) {
      if (isFolder(f)) {
        const n = (f.children || []).length;
        return `<button class="fcard" data-folder="${esc(f.path)}"><div class="fthumb">${icon("folder", "folder-ic")}</div>
          <div class="fmeta"><div class="fname">${esc(f.display || f.name)}</div><div class="fsub"><span>${plural(n, "item")}</span></div></div></button>`;
      }
      const est = f.gcodeAnalysis?.estimatedPrintTime;
      const last = f.prints?.last;
      const mm = f.gcodeAnalysis?.filament?.tool0?.length;
      const selected = sel.has(f.path);
      return `<div class="fcard ${selected ? "is-sel" : ""}" role="button" tabindex="0" data-path="${esc(f.path)}" aria-label="${esc(f.display || f.name)}">
        <label class="fcheck" data-check><input type="checkbox" ${selected ? "checked" : ""} aria-label="Select ${esc(f.name)}"></label>
        <div class="fthumb">${icon("cube")}<img alt="" loading="lazy" src="${esc(mf.thumbUrl(f.path, f.date))}"><div class="chips"></div></div>
        <div class="fmeta">
          <div class="fname">${esc(stripExt(f.display || f.name))}</div>
          <div class="fsub"><span data-role="time">${est ? duration(est) : ""}</span>${mm ? `<span>${filamentLength(mm)}</span>` : ""}<span>${bytes(f.size)}</span></div>
          <div class="fsub">${last ? `<span class="${last.success ? "ok" : "err"}">${last.success ? "Printed" : "Failed"} ${relative(last.date)}</span>` : `<span>Uploaded ${relative(f.date)}</span>`}${printCount(f) > 1 ? `<span>${printCount(f)}×</span>` : ""}${query && dirname(f.path) ? `<span>in ${esc(dirname(f.path))}</span>` : ""}</div>
        </div></div>`;
    }

    function listHtml(items) {
      return `<div class="panel"><table class="table file-list"><thead><tr><th></th><th>Name</th><th>Estimate</th><th>Size</th><th>Added</th><th>Prints</th></tr></thead><tbody>${items.map((f) => isFolder(f)
        ? `<tr data-folder="${esc(f.path)}"><td><span class="thumb">${icon("folder")}</span></td><td class="nm">${esc(f.name)}</td><td colspan="4" class="muted">${plural((f.children || []).length, "item")}</td></tr>`
        : `<tr data-path="${esc(f.path)}"><td><span class="thumb">${icon("cube")}<img alt="" loading="lazy" src="${esc(mf.thumbUrl(f.path, f.date))}"></span></td><td class="nm">${esc(stripExt(f.display || f.name))}</td><td>${f.gcodeAnalysis?.estimatedPrintTime ? duration(f.gcodeAnalysis.estimatedPrintTime) : "–"}</td><td>${bytes(f.size)}</td><td class="muted">${relative(f.date)}</td><td>${printCount(f) || "–"}</td></tr>`).join("")}</tbody></table></div>`;
    }

    function render() {
      renderCrumbs();
      r.mode.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.m === prefs.get("filesView"))));
      r.sortl.textContent = SORTS[sortKey][0];
      if (free != null && total) {
        const used = ((total - free) / total) * 100;
        r.storage.innerHTML = `<div class="bar is-thin is-solid" style="--p:${used.toFixed(1)}%"><i></i></div><span>${bytes(free)} free of ${bytes(total)}</span>`;
      } else r.storage.innerHTML = "";

      if (loading) {
        r.body.innerHTML = `<div class="file-grid">${Array.from({ length: 8 }, () => `<div class="skeleton" style="aspect-ratio:1;"></div>`).join("")}</div>`;
        return;
      }
      let items = current().slice();
      const folders = items.filter(isFolder).sort(SORTS["name-asc"][1]);
      const files = items.filter((f) => !isFolder(f)).sort(SORTS[sortKey][1]);
      items = [...folders, ...files];
      r.count.textContent = query ? `${plural(files.length, "match", "matches")}` : `${plural(files.length, "file")}${folders.length ? `, ${plural(folders.length, "folder")}` : ""}`;

      if (!items.length) {
        r.body.innerHTML = query
          ? `<div class="empty"><div class="empty-title">Nothing matches “${esc(query)}”</div><p class="empty-text">Check the spelling or clear the search.</p></div>`
          : `<div class="empty">${icon("folder")}<div class="empty-title">${folder ? "This folder is empty" : "No files yet"}</div><p class="empty-text">Drop G-code files anywhere on this page, or use Upload. They're stored on the printer, so they'll be here from any device.</p><button class="btn btn-primary" data-empty-up>${icon("upload")}Upload a file</button></div>`;
      } else if (prefs.get("filesView") === "list") {
        r.body.innerHTML = listHtml(items);
      } else {
        r.body.innerHTML = `<div class="file-grid ${sel.size ? "selecting" : ""}">${items.map(cardHtml).join("")}</div>`;
        r.body.querySelectorAll(".fcard[data-path]").forEach((c) => io.observe(c));
      }
      renderSelbar();
    }

    function renderSelbar() {
      if (!sel.size) { r.selbar.replaceChildren(); return; }
      const bar = html`<div class="selbar cut cut-s"><b>${sel.size}</b> selected
        <button class="btn btn-sm" data-a="move">${raw(icon("folder"))}Move</button>
        <button class="btn btn-sm btn-danger" data-a="del">${raw(icon("trash"))}Delete</button>
        <button class="btn btn-sm btn-ghost" data-a="none">Clear</button></div>`;
      bar.addEventListener("click", async (e) => {
        const a = e.target.closest("[data-a]")?.dataset.a;
        if (a === "none") { sel.clear(); render(); }
        if (a === "del") await deleteMany(Array.from(sel));
        if (a === "move") await moveMany(Array.from(sel));
      });
      r.selbar.replaceChildren(bar);
    }

    // ~~ interactions ~~
    r.body.addEventListener("click", (e) => {
      if (e.target.closest("[data-empty-up]")) return r.pick.click();
      const folderEl = e.target.closest("[data-folder]");
      if (folderEl) return router.go("files", folderEl.dataset.folder.split("/"));
      const chk = e.target.closest("[data-check]");
      const card = e.target.closest("[data-path]");
      if (!card) return;
      const path = card.dataset.path;
      if (chk) {
        e.stopPropagation();
        const box = chk.querySelector("input");
        if (e.target !== box) box.checked = !box.checked;
        box.checked ? sel.add(path) : sel.delete(path);
        card.classList.toggle("is-sel", box.checked);
        renderSelbar();
        r.body.firstElementChild?.classList.toggle("selecting", sel.size > 0);
        return;
      }
      if (sel.size) {   // in selection mode a click toggles
        sel.has(path) ? sel.delete(path) : sel.add(path);
        return render();
      }
      openDetail(findFile(path));
    });
    r.body.addEventListener("keydown", (e) => {
      if ((e.key === "Enter" || e.key === " ") && e.target.matches?.(".fcard[data-path]")) { e.preventDefault(); openDetail(findFile(e.target.dataset.path)); }
    });
    r.body.addEventListener("contextmenu", (e) => {
      const card = e.target.closest("[data-path]");
      if (!card) return;
      e.preventDefault();
      const f = findFile(card.dataset.path);
      openMenu(card, fileMenu(f), { align: "start" });
    });

    function findFile(path) { let hit = null; walk(tree, (f) => { if (f.path === path) hit = f; }); return hit; }

    r.q.addEventListener("input", debounce(() => { query = r.q.value.trim().toLowerCase(); render(); }, 180));
    r.mode.addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { prefs.set("filesView", b.dataset.m); render(); } });
    r.sort.addEventListener("click", () => openMenu(r.sort, Object.entries(SORTS).map(([k, [label]]) => ({ label, checked: k === sortKey, onClick: () => { sortKey = k; prefs.set("filesSort", k); render(); } })), { align: "end" }));
    r.up.addEventListener("click", () => r.pick.click());
    r.pick.addEventListener("change", () => { uploadFiles(r.pick.files, { folder }); r.pick.value = ""; });
    r.mkdir.addEventListener("click", async () => {
      const name = await promptDialog({ title: "New folder", label: "Folder name", confirm: "Create", validate: (v) => (!v.trim() ? "Give the folder a name." : /[\\/:*?"<>|]/.test(v) ? "Avoid \\ / : * ? \" < > |" : null) });
      if (!name) return;
      try { await octo.createFolder(name.trim(), folder); toast.ok("Folder created", name.trim()); load(); } catch (e) { toast.fail("Couldn't create the folder", e); }
    });

    // ~~ file actions ~~
    function fileMenu(f) {
      return [
        { label: "Print…", icon: "play", onClick: () => startWithChecks(f.path) },
        { label: "Select", icon: "check", onClick: () => actions.selectFile(f.path).then(() => toast.ok("Selected", f.name)).catch(() => {}) },
        { label: "Details", icon: "info", onClick: () => openDetail(f) },
        { sep: true },
        { label: "Rename", icon: "edit", onClick: () => renameFile(f) },
        { label: "Move…", icon: "folder", onClick: () => moveMany([f.path]) },
        { label: "Download", icon: "download", onClick: () => { location.href = octo.downloadUrl(f.path); } },
        { sep: true },
        { label: "Delete", icon: "trash", danger: true, onClick: () => deleteMany([f.path]) },
      ];
    }
    async function renameFile(f) {
      const cur = basename(f.path);
      const name = await promptDialog({ title: "Rename file", label: "New name", value: cur, confirm: "Rename", validate: (v) => (!v.trim() ? "Enter a name." : null) });
      if (!name || name === cur) return;
      const dest = dirname(f.path) ? `${dirname(f.path)}/${name.trim()}` : name.trim();
      try { await octo.moveFile(f.path, dest); toast.ok("Renamed", name.trim()); load(); } catch (e) { toast.fail("Couldn't rename", e); }
    }
    async function deleteMany(paths) {
      const one = paths.length === 1;
      if (!(await confirmDialog({ title: one ? "Delete this file?" : `Delete ${paths.length} files?`, text: one ? `${basename(paths[0])} will be removed from the printer. This can't be undone.` : "They will be removed from the printer. This can't be undone.", confirm: "Delete", danger: true }))) return;
      let failed = 0;
      for (const p of paths) { try { await octo.deleteFile(p); } catch (e) { failed++; toast.fail(`Couldn't delete ${basename(p)}`, e); } }
      sel.clear();
      if (failed < paths.length) toast.ok(one ? "Deleted" : `Deleted ${paths.length - failed} files`);
      load();
    }
    async function moveMany(paths) {
      const folders = [""];
      walk(tree, (f) => { if (isFolder(f)) folders.push(f.path); });
      const pick = await new Promise((resolve) => {
        const list = html`<div class="col gap-1">${folders.map((p) => html`<button class="btn btn-ghost" style="justify-content:flex-start" data-p="${p}">${raw(icon("folder"))}${p || "Library (top level)"}</button>`)}</div>`;
        const dlg = openDialog({ title: `Move ${paths.length === 1 ? basename(paths[0]) : paths.length + " files"} to…`, body: list, buttons: [{ label: "Cancel", kind: "ghost" }] });
        list.addEventListener("click", (e) => { const b = e.target.closest("[data-p]"); if (b) dlg.close(b.dataset.p); });
        dlg.closed.then(resolve);
      });
      if (pick == null) return;
      for (const p of paths) {
        try { await octo.moveFile(p, pick ? `${pick}/${basename(p)}` : basename(p)); } catch (e) { toast.fail(`Couldn't move ${basename(p)}`, e); }
      }
      sel.clear();
      load();
    }

    async function openDetail(f) {
      if (!f) return;
      const m = await meta(f.path).catch(() => null);
      const info = m?.info || {};
      const fc = config.data.filament;
      const mm = info.filamentMm ?? f.gcodeAnalysis?.filament?.tool0?.length;
      const dim = f.gcodeAnalysis?.dimensions;
      const rows = [
        ["Estimated time", (info.estimatedSeconds ?? f.gcodeAnalysis?.estimatedPrintTime) ? duration(info.estimatedSeconds ?? f.gcodeAnalysis.estimatedPrintTime) : null],
        ["Slicer", info.slicer],
        ["Material", [info.filamentType, info.filamentName].filter(Boolean).join(" · ") || null],
        ["Filament", mm ? `${filamentLength(mm)} · ${grams(info.filamentGrams ?? filamentGrams(mm, fc.diameter, fc.density))}` : null],
        ["Layer height", info.layerHeight ? `${info.layerHeight} mm` : null],
        ["Layers", info.layerCount ?? m?.layers?.count],
        ["Nozzle", info.nozzleTemp ? `${Math.round(info.nozzleTemp)}° · ${info.nozzleDiameter || "0.4"} mm` : null],
        ["Bed", info.bedTemp ? `${Math.round(info.bedTemp)}°` : null],
        ["Infill", info.infill],
        ["Size on screen", dim ? `${dim.width?.toFixed(1)} × ${dim.depth?.toFixed(1)} × ${dim.height?.toFixed(1)} mm` : null],
        ["File size", bytes(f.size)],
        ["Added", dateTime(f.date)],
        ["Print history", printCount(f) ? `${f.prints.success || 0} finished, ${f.prints.failure || 0} failed${f.prints.last ? ` · last ${relative(f.prints.last.date)} (${duration(f.prints.last.printTime)})` : ""}` : "Never printed"],
      ].filter(([, v]) => v != null && v !== "");
      const body = html`
        <div class="detail">
          <div class="fthumb">${raw(icon("cube"))}<img alt="" src="${mf.thumbUrl(f.path, f.date)}"></div>
          <dl class="kv">${rows.map(([k, v]) => html`<dt>${k}</dt><dd>${v}</dd>`)}</dl>
        </div>`;
      watchThumbs(body);
      const dlg = openDialog({
        title: stripExt(f.display || f.name), body, wide: true,
        buttons: [
          { label: "Delete", kind: "danger", icon: "trash", value: "del" },
          { label: "More", kind: "ghost", icon: "more-h", value: "more", onClick: (d) => { openMenu(d.el.querySelector(".dialog-foot"), fileMenu(f).filter((x) => !["Print…", "Details", "Delete"].includes(x.label)), { align: "end" }); return false; } },
          { label: "Preview toolpath", icon: "layers", value: "view" },
          { label: "Select", icon: "check", value: "select" },
          { label: "Print", kind: "primary", icon: "play", value: "print", autofocus: true },
        ],
      });
      const res = await dlg.closed;
      if (res === "print") startWithChecks(f.path);
      else if (res === "select") actions.selectFile(f.path).then(() => toast.ok("Selected", f.name)).catch(() => {});
      else if (res === "del") deleteMany([f.path]);
      else if (res === "view") { const v = await import("mf/ui/viewer/viewer-dialog.js"); v.openToolpath(f); }
    }

    function goRoute(next) {
      folder = next.rest.join("/");
      sel.clear();
      query = ""; r.q.value = "";
      render();
    }
    load();
    return {
      onRoute: goRoute,
      unmount() { offBus(); io.disconnect(); setFolderProvider(() => ""); },
    };
  },
};
