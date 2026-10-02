// OctoPrint's classic page, running in a frame, so every plugin's own screens work exactly as
// they do there: same code, same settings, same dialogs. MakerPrint picks the part to show
// (a plugin's tab, its sidebar panel or a settings page) and hides the rest with a stylesheet
// it adds to the frame. The frame is same-origin, so this needs no cooperation from plugins.
import { BASE } from "mf/core/api.js";

// Core tabs MakerPrint already has its own screens for. Everything else is a plugin's.
const CORE_TABS = new Set(["temp", "control", "term", "timelapse"]);

const CROP_CSS = `
html.mf-embed body { padding: 0 !important; }
html.mf-embed #page-container-loading { display: none !important; }
html.mf-embed:not([data-mf-mode="classic"]) #navbar,
html.mf-embed:not([data-mf-mode="classic"]) .footer { display: none !important; }
html.mf-embed:not([data-mf-mode="classic"]) .octoprint-container { width: auto !important; max-width: none !important; margin: 0 !important; padding: 16px !important; }
html.mf-embed:not([data-mf-mode="classic"]) .octoprint-container > .row { margin-left: 0 !important; }

/* OctoPrint's setup wizard belongs to the full classic page, not to one embedded part */
html.mf-embed:not([data-mf-mode="classic"]) #wizard_dialog { display: none !important; }
html.mf-embed:not([data-mf-mode="classic"]) body:has(#wizard_dialog.in) .modal-backdrop { display: none !important; }
html.mf-embed:not([data-mf-mode="classic"]) body:has(#wizard_dialog.in) { overflow: auto !important; }

/* a plugin's tab, on its own */
html.mf-embed[data-mf-mode="tab"] #sidebar,
html.mf-embed[data-mf-mode="tab"] #tabs { display: none !important; }
html.mf-embed[data-mf-mode="tab"] .octoprint-container .tabbable { width: 100% !important; margin-left: 0 !important; float: none !important; }
html.mf-embed[data-mf-mode="tab"] .tab-content { border: 0 !important; padding: 0 !important; }

/* one sidebar panel, full width and open */
html.mf-embed[data-mf-mode="panel"] .octoprint-container .tabbable { display: none !important; }
html.mf-embed[data-mf-mode="panel"] #sidebar { width: 100% !important; margin-left: 0 !important; float: none !important; }
html.mf-embed[data-mf-mode="panel"] #sidebar > .accordion-group:not(.mf-show) { display: none !important; }

/* every plugin's sidebar panel, stacked and open (the Print page's Plugins panel) */
html.mf-embed[data-mf-mode="panels"] .octoprint-container { padding: 0 !important; }
html.mf-embed[data-mf-mode="panels"] .octoprint-container .tabbable { display: none !important; }
html.mf-embed[data-mf-mode="panels"] #sidebar { width: 100% !important; margin-left: 0 !important; float: none !important; }
html.mf-embed[data-mf-mode="panels"] #sidebar > .accordion-group:not([id^="sidebar_plugin_"]) { display: none !important; }
html.mf-embed[data-mf-mode="panels"] body { background: transparent !important; }

/* settings: the dialog becomes the page */
html.mf-embed[data-mf-mode="settings"] .octoprint-container { visibility: hidden !important; }
html.mf-embed[data-mf-mode="settings"] #settings_dialog { top: 0 !important; left: 0 !important; right: 0 !important; bottom: 0 !important; width: auto !important; max-width: none !important; margin: 0 !important; border: 0 !important; border-radius: 0 !important; }
html.mf-embed[data-mf-mode="settings"] #settings_dialog .modal-body { max-height: none !important; height: calc(100vh - 118px) !important; }
html.mf-embed[data-mf-mode="settings"] #settings_dialog .modal-header .close,
html.mf-embed[data-mf-mode="settings"] #settings_dialog .modal-footer [data-dismiss="modal"] { display: none !important; }
html.mf-embed[data-mf-mode="settings"] .modal-backdrop { opacity: 1 !important; }
/* one plugin's settings: MakerPrint lists them, so the dialog's own menu would repeat it */
html.mf-embed[data-mf-mode="settings"]:not([data-mf-full]) #settings_dialog_menu { display: none !important; }
html.mf-embed[data-mf-mode="settings"]:not([data-mf-full]) #settings_dialog_content { width: 100% !important; margin-left: 0 !important; }
`;

const textOf = (el) => (el?.textContent || "").replace(/\s+/g, " ").trim();
// plugins hide their own tabs and panels when they have nothing to show (a firmware warning
// that hasn't happened, say), and an empty page helps nobody
const shown = (el, win) => !!el && win.getComputedStyle(el).display !== "none";

/**
 * Load the classic page into `host`. Resolves {win, doc} once OctoPrint's classic interface has
 * finished starting, or rejects after `timeoutMs`.
 */
export function createClassicFrame(host, { timeoutMs = 90000 } = {}) {
  const frame = document.createElement("iframe");
  frame.className = "classic-frame";
  frame.title = "OctoPrint plugin page";
  frame.src = `${BASE}/?classic&mfembed=1`;
  host.append(frame);

  let win = null, doc = null, pane = null, alive = true;

  const ready = new Promise((resolve, reject) => {
    const t0 = Date.now();
    const poll = () => {
      if (!alive) return;
      try {
        win = frame.contentWindow;
        doc = frame.contentDocument;
        if (win?.OctoPrint?.coreui?.startedUp && doc?.head) {
          prepare();
          resolve({ win, doc });
          return;
        }
      } catch (e) { return reject(e); }
      if (Date.now() - t0 > timeoutMs) return reject(new Error("OctoPrint's classic page didn't finish starting."));
      setTimeout(poll, 300);
    };
    frame.addEventListener("load", poll);
  });

  function prepare() {
    if (doc.getElementById("mf-embed-css")) return;
    const style = doc.createElement("style");
    style.id = "mf-embed-css";
    style.textContent = CROP_CSS;
    doc.head.append(style);
    doc.documentElement.classList.add("mf-embed");
    // In "settings" mode the dialog is the page: saving closes it, so open it again
    win.$?.("#settings_dialog").on("hidden", () => {
      if (alive && doc.documentElement.dataset.mfMode === "settings" && pane) setTimeout(() => openSettings(pane), 250);
    });
  }

  function settingsVM() { return win.OctoPrint.coreui.viewmodels.settingsViewModel; }
  function openSettings(id) { try { settingsVM().show(id); } catch { /* not allowed for this user */ } }

  /** What plugins added to the classic page: their tabs, sidebar panels and settings pages. */
  function parts() {
    const q = (s) => Array.from(doc.querySelectorAll(s));
    const tabs = q("#tabs a[href^='#']")
      .map((a) => ({ kind: "tab", id: a.getAttribute("href").slice(1), name: textOf(a) }))
      .filter((t) => t.id && t.name && !CORE_TABS.has(t.id) && doc.getElementById(t.id) && shown(doc.querySelector(`#tabs a[href="#${t.id}"]`)?.closest("li"), win));
    const panels = q("#sidebar > .accordion-group[id^='sidebar_plugin_']")
      .filter((g) => shown(g, win))
      .map((g) => ({ kind: "panel", id: g.id, name: textOf(g.querySelector(".accordion-heading")) || g.id.replace(/^sidebar_plugin_|_wrapper$/g, "") }));
    const settings = q("#settings_dialog_menu a[href^='#settings_plugin_']")
      .map((a) => ({ kind: "settings", id: a.getAttribute("href").slice(1), name: textOf(a) }))
      .filter((s) => s.name);
    const firstSettings = doc.querySelector("#settings_dialog_menu a[href^='#settings_']")?.getAttribute("href")?.slice(1) || null;
    return { tabs, panels, settings, firstSettings };
  }

  /** Show one part: {kind: "tab"|"panel"|"settings"|"classic", id}. */
  function show(part) {
    const html = doc.documentElement;
    const wasSettings = html.dataset.mfMode === "settings";
    html.dataset.mfMode = part.kind;
    if (part.full) html.dataset.mfFull = "1"; else delete html.dataset.mfFull;
    pane = part.kind === "settings" ? part.id : null;
    if (wasSettings && part.kind !== "settings") win.$("#settings_dialog").modal("hide");
    if (part.kind === "tab") win.$(`#tabs a[href="#${part.id}"]`).tab("show");
    if (part.kind === "panel") {
      for (const g of doc.querySelectorAll("#sidebar > .accordion-group")) g.classList.toggle("mf-show", g.id === part.id);
      win.$(`#${part.id} .accordion-body`).collapse("show");
    }
    if (part.kind === "settings") openSettings(part.id);
    if (part.kind === "panels") {
      for (const g of doc.querySelectorAll("#sidebar > .accordion-group[id^='sidebar_plugin_']")) win.$(g.querySelector(".accordion-body")).collapse("show");
    }
    win.scrollTo(0, 0);
  }

  /** Height of what is showing, for a frame that grows with its content. */
  function contentHeight() {
    try { return Math.ceil(doc.querySelector("#sidebar")?.getBoundingClientRect().height || doc.body.scrollHeight); } catch { return 0; }
  }

  return {
    frame,
    ready,
    contentHeight,
    parts,
    show,
    destroy() { alive = false; frame.remove(); },
  };
}
