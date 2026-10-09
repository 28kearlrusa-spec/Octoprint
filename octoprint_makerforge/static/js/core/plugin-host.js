// Plugins inside MakerPrint: one copy of OctoPrint's classic page for the whole session, shown
// wherever a plugin's tab, panel, settings or top-bar button belongs.
//
// The classic page is what makes every plugin work exactly as it does in classic OctoPrint
// (same code, same dialogs). Loading it is slow on a Raspberry Pi and each copy opens its own
// live connection, so there is only ever one. It lives in a layer above the page and is laid
// over whichever spot ("slot") currently has it, following that spot as the page scrolls. A
// spot borrows it with lease(); the newest lease wins and the previous one gets it back when
// that ends. Moving the frame in the DOM would reload it, so it never moves.
import { createClassicFrame } from "mf/core/classic-frame.js";
import { can } from "mf/core/auth.js";
import { config } from "mf/core/config.js";
import { store } from "mf/core/store.js";
import { boot } from "mf/core/api.js";
import { toast } from "mf/ui/toast.js";

let cf = null;
let layer = null;
const leases = [];          // newest last
let raf = 0;
let modal = false;
const subs = new Set();     // called with the parts list whenever it changes
let lastParts = null;
let partsSig = "";

export const allowed = () => can("settings_read") || can("admin") || can("control");

function ensure() {
  if (cf) return cf;
  layer = document.createElement("div");
  layer.className = "plugin-layer";
  layer.hidden = true;
  document.body.insertBefore(layer, document.getElementById("overlays"));
  cf = createClassicFrame(layer, { timeoutMs: 120000 });
  cf.ready.then(() => {
    cf.frame.classList.add("is-ready");
    watchFrame();
    publish();
    position();
  }).catch(() => {});
  return cf;
}

/** Start loading the classic page in the background (call once the app has settled). */
export function warm() { if (allowed()) ensure(); }

/** Resolves with the frame once OctoPrint's classic page has started. */
export function ready() { return ensure().ready.then(() => cf); }

/** Everything plugins added, as found the last time (null until the frame has started). */
export function currentParts() { return lastParts; }

/** Follow the parts list (plugins can show or hide their tabs and buttons at any time). */
export function onParts(fn) {
  subs.add(fn);
  if (lastParts) fn(lastParts);
  return () => subs.delete(fn);
}

function publish() {
  if (!cf) return;
  let p;
  try { p = cf.parts(); } catch { return; }
  const sig = JSON.stringify([p.tabs, p.panels, p.navbar, p.settings].map((l) => l.map((x) => x.id + x.name)));
  if (sig === partsSig) return;
  partsSig = sig;
  lastParts = p;
  for (const fn of subs) { try { fn(p); } catch (e) { console.error("[plugins]", e); } }
}

// Plugins show and hide their own parts, open their own dialogs and pop up notifications:
// keep up with all three
function watchFrame() {
  let t = 0;
  const later = () => { clearTimeout(t); t = setTimeout(publish, 400); };
  watchNotices();
  try {
    new cf.win.MutationObserver(later).observe(cf.doc.body, { subtree: true, attributes: true, attributeFilter: ["style", "class"], childList: true });
    // dialogs open and close by changing classes anywhere in the page
    new cf.win.MutationObserver(() => { if (dialogOpen() !== modal) position(); })
      .observe(cf.doc.body, { attributes: true, attributeFilter: ["class"], subtree: true });
  } catch { /* the frame went away */ }
}

// Plugins' pop-up notifications (PNotify) appear as MakerPrint's own toasts. The originals are
// hidden in the frame, where they would land in a corner of whatever spot shows it.
const seenNotices = new Map();   // text -> time
function watchNotices() {
  const doc = cf.doc;
  const KIND = [["alert-error", "err"], ["alert-danger", "err"], ["alert-success", "ok"], ["alert-warning", "warn"], ["alert-info", "info"]];
  const take = (el) => {
    const box = el.matches?.(".ui-pnotify") ? el : el.querySelector?.(".ui-pnotify");
    if (!box || box.dataset.mfSeen) return;
    box.dataset.mfSeen = "1";
    // the text is filled in a moment after the box appears
    setTimeout(() => {
      const title = (box.querySelector(".ui-pnotify-title")?.textContent || "").trim();
      const text = (box.querySelector(".ui-pnotify-text")?.textContent || "").replace(/\s+/g, " ").trim();
      if (!title && !text) return;
      const key = `${title}|${text}`;
      const now = Date.now();
      if (now - (seenNotices.get(key) || 0) < 15000) return;
      seenNotices.set(key, now);
      const cls = box.querySelector(".alert, [class*='alert-']")?.className || box.className;
      const kind = (KIND.find(([c]) => cls.includes(c)) || [, "info"])[1];
      const hasButtons = !!box.querySelector("button:not(.ui-pnotify-closer):not(.close), .ui-pnotify-action-bar *");
      toast({
        kind, title: title || "OctoPrint", text: text.slice(0, 400),
        timeout: kind === "err" || hasButtons ? 0 : undefined,
        action: hasButtons ? { label: "Open classic page", onClick: () => window.open(boot.classicUrl, "_blank", "noopener") } : undefined,
      });
    }, 250);
  };
  try {
    doc.querySelectorAll(".ui-pnotify").forEach(take);
    new cf.win.MutationObserver((muts) => {
      for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) take(n);
    }).observe(doc.body, { childList: true, subtree: false });
  } catch { /* the frame went away */ }

  // a newly installed plugin's first-run steps live in OctoPrint's setup wizard
  let wizardTold = false;
  const wizard = () => {
    if (wizardTold || !cf.wizardOpen()) return;
    wizardTold = true;
    toast({
      kind: "info", timeout: 0, title: "A plugin wants to be set up",
      text: "OctoPrint's setup wizard has steps waiting (usually from a plugin you just installed). Finish them once in the classic page.",
      action: { label: "Open the wizard", onClick: () => window.open(boot.classicUrl, "_blank", "noopener") },
    });
  };
  setTimeout(wizard, 1500);
  setTimeout(wizard, 8000);
}

/**
 * Borrow the frame for `slot` (an element in the page) and show `part` in it.
 * Returns {show(part), release()}.
 */
export function lease(slot, part) {
  ensure();
  const l = { slot, part };
  leases.push(l);
  apply();
  return {
    show(next) { l.part = next; if (top() === l) apply(); },
    release() {
      const i = leases.indexOf(l);
      if (i < 0) return;
      const wasTop = i === leases.length - 1;
      leases.splice(i, 1);
      if (wasTop) apply();
    },
  };
}

const top = () => leases[leases.length - 1] || null;

function apply() {
  const l = top();
  if (!l) { stop(); if (layer) layer.hidden = true; return; }
  cf.ready.then(() => { if (top() === l && l.part) cf.show(l.part); position(); }).catch(() => {});
  start();
}

function start() { if (!raf) raf = requestAnimationFrame(tick); }
function stop() { if (raf) cancelAnimationFrame(raf); raf = 0; }
function tick() { raf = 0; position(); if (top()) raf = requestAnimationFrame(tick); }

// A plugin's dialog gets the whole window. Not OctoPrint's settings (that dialog *is* the page
// in settings mode), and not inside the full classic page, which has room of its own.
function dialogOpen() {
  if (!cf?.doc) return false;
  const mode = cf.doc.documentElement.dataset.mfMode;
  return mode !== "settings" && mode !== "classic" && cf.modalOpen();
}

// lay the frame over the slot (or over the whole window while a plugin's dialog is open)
function position() {
  if (!layer) return;
  modal = dialogOpen();
  try { cf?.doc?.documentElement.classList.toggle("mf-dialog", modal); } catch { /* frame gone */ }
  const l = top();
  const ready = cf?.frame.classList.contains("is-ready");
  // a plugin's dialog shows wherever you are, even if nothing on this page shows its plugin
  if (!ready || (!l && !modal)) { layer.hidden = true; return; }
  if (modal) {
    layer.hidden = false;
    layer.classList.add("is-modal");
    Object.assign(layer.style, { left: "0px", top: "0px", width: "100vw", height: "100dvh" });
    return;
  }
  layer.classList.remove("is-modal");
  const r = l.slot.isConnected ? l.slot.getBoundingClientRect() : null;
  if (!r || r.width < 2 || r.height < 2 || !l.slot.offsetParent) { layer.hidden = true; return; }
  layer.hidden = false;
  const s = layer.style;
  const px = (v) => `${Math.round(v)}px`;
  if (s.left !== px(r.left)) s.left = px(r.left);
  if (s.top !== px(r.top)) s.top = px(r.top);
  if (s.width !== px(r.width)) s.width = px(r.width);
  if (s.height !== px(r.height)) s.height = px(r.height);
}
document.addEventListener("visibilitychange", () => { position(); if (top()) start(); });
// animation frames pause in background tabs; scrolling and resizing still move the spot
window.addEventListener("scroll", () => { if (top()) position(); }, { passive: true, capture: true });
window.addEventListener("resize", () => { if (top()) position(); }, { passive: true });

/** Height of what the frame shows now (for slots that grow with a plugin's panels). */
export function contentHeight() { return cf ? cf.contentHeight() : 0; }

/** Run fn(win, doc) against the frame once it's ready. */
export function inFrame(fn) { return ready().then((c) => fn(c.win, c.doc)); }

// ~~ where each plugin part goes ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~

// MakerPrint pages a part can be placed on. "rail" gives a plugin tab its own entry in the
// navigation; "plugins" keeps it on the Plugins screen only; "hidden" hides it everywhere but there.
export const PLACES = [
  ["print", "Print"], ["control", "Control"], ["files", "Files"], ["terminal", "Terminal"],
  ["tune", "Tune"], ["timelapse", "Timelapse"], ["rail", "Own page in the menu"], ["plugins", "Plugins screen only"],
];

// Where well-known plugins belong, by plugin identifier
const HOMES = {
  // levelling, probing, calibration
  bedlevelvisualizer: "tune", klipper: "tune", pidtune: "tune", pid_tune: "tune", bltouch: "tune",
  z_probe_offset_universal: "tune", zprobeoffset: "tune", autobim: "tune", bedlevelingwizard: "tune",
  ender3v2tempfix: "tune", firmwareupdater: "tune", firmware_check: "tune", printerdialogs: "tune",
  // the print itself
  cancelobject: "print", excluderegion: "print", exclude_region: "print", displaylayerprogress: "print",
  dashboard: "print", filamentmanager: "print", spoolmanager: "print", spoolman: "print",
  multicam: "print", camerasettings: "print", webcamstreamer: "print", printtimegenius: "print",
  filamentsensorsimplified: "print", filamentrevolutions: "print", smart_filament_sensor: "print",
  enclosure: "print", detailedprogress: "print", navbartemp: "print", resource_monitor: "print",
  // files
  gcodeviewer: "files", gcode: "files", prettygcode: "files", uploadanything: "files", filemanager: "files",
  arc_welder: "files", slicer: "files", cura: "files", prusaslicerthumbnails: "files",
  // the plugins on the MakerPrint E3NG's Pi
  bltouch: "tune", costestimation: "print", printhistory: "files", printtimegenius: "files",
  powerfailure: "print", tplinksmartplug: "print", uploadmanager: "files", file_manager: "files",
  // control
  gcode_macro: "control", custombuttons: "control", customcontrol: "control", macro: "control",
  consolidate_temp_control: "control", printhead_control: "control", gcodesystemcommands: "control",
  // terminal and time-lapse
  terminalcommandsextended: "terminal", terminalcommands: "terminal", gcodeterminal: "terminal",
  octolapse: "timelapse", timelapseplus: "timelapse",
};

export const partKey = (p) => `${p.kind}:${p.id}`;

// "klipper_main" (OctoKlipper's tab) belongs where "klipper" does
function homeOf(plugin) {
  let id = String(plugin || "").toLowerCase();   // "PrintTimeGenius", "BLTouch"
  while (id) {
    if (HOMES[id]) return HOMES[id];
    const cut = id.lastIndexOf("_");
    if (cut < 1) break;
    id = id.slice(0, cut);
  }
  return null;
}

/** Where a part shows: the person's choice in Settings, else autoPlaceOf(). */
export function placeOf(p) {
  const chosen = (config.data.pluginPlaces || {})[partKey(p)];
  if (p.kind === "navbar") return chosen === "hidden" ? "hidden" : "topbar";
  if (chosen === "hidden" || PLACES.some(([id]) => id === chosen)) return chosen;
  return autoPlaceOf(p);
}

/** Where a part shows when nobody has chosen: the plugin's known home, or by kind. */
export function autoPlaceOf(p) {
  if (p.kind === "navbar") return "topbar";
  if (p.kind === "settings") return "plugins";
  const home = homeOf(p.plugin);
  if (home) return home;
  // a plugin's tab is a whole screen: give it a menu entry, like its tab in classic OctoPrint
  if (p.kind === "tab") return "rail";
  if (p.kind === "panel") return "print";
  return "plugins";
}

/** The parts placed on one page, as {tabs, panels}. */
export function partsFor(page, parts = lastParts) {
  if (!parts) return { tabs: [], panels: [] };
  return {
    tabs: parts.tabs.filter((p) => placeOf(p) === page),
    panels: parts.panels.filter((p) => placeOf(p) === page),
  };
}

/** Plugin tabs that have their own menu entry. */
export function railParts(parts = lastParts) {
  return parts ? parts.tabs.filter((p) => placeOf(p) === "rail") : [];
}

// a plugin's tab or the Plugins screen may be asked for before the shared config has loaded
store.on("config", () => { if (lastParts) { partsSig = ""; publish(); } });
