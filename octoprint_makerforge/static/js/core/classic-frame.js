// OctoPrint's classic page, running in a frame, so every plugin's own screens work exactly as
// they do there: same code, same settings, same dialogs. MakerPrint picks the part to show
// (a plugin's tab, its sidebar panel or a settings page) and hides the rest with a stylesheet
// it adds to the frame. The frame is same-origin, so this needs no cooperation from plugins.
import { BASE } from "mf/core/api.js";

// Core parts MakerPrint already has its own screens for. Everything else is a plugin's.
const CORE_TABS = new Set(["temp", "control", "term", "timelapse"]);
const CORE_PANELS = new Set(["connection_wrapper", "state_wrapper", "files_wrapper"]);
const CORE_NAVBAR = new Set(["navbar_offlineindicator", "navbar_settings", "navbar_systemmenu", "navbar_login", "navbar_plugin_makerforge"]);

/** The plugin an element id belongs to: "tab_plugin_octolapse" -> "octolapse". */
export function pluginOf(id) {
  return String(id || "")
    .replace(/^(navbar|sidebar|tab|settings|usersettings)_plugin_/, "")
    .replace(/_(wrapper|link)$/, "")
    .replace(/_\d+$/, "");
}

const CROP_CSS = `
html.mf-embed body { padding: 0 !important; }
html.mf-embed #page-container-loading { display: none !important; }
html.mf-embed:not([data-mf-mode="classic"]) #navbar,
html.mf-embed:not([data-mf-mode="classic"]) .footer { display: none !important; }
html.mf-embed:not([data-mf-mode="classic"]) .octoprint-container { width: auto !important; max-width: none !important; margin: 0 !important; padding: 16px !important; }
html.mf-embed:not([data-mf-mode="classic"]) .octoprint-container > .row { margin-left: 0 !important; }

/* a plugin's dialog over MakerPrint: only the dialog and its dimmed backdrop show */
html.mf-embed.mf-dialog, html.mf-embed.mf-dialog body { background: transparent !important; }
html.mf-embed.mf-dialog #navbar, html.mf-embed.mf-dialog .octoprint-container, html.mf-embed.mf-dialog .footer { visibility: hidden !important; }

/* plugins' pop-up notifications show as MakerPrint's own (see plugin-host.js) */
html.mf-embed:not([data-mf-mode="classic"]) .ui-pnotify { display: none !important; }

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

/* several sidebar panels, stacked and open (a page's plugin panels) */
html.mf-embed[data-mf-mode="panelset"] .octoprint-container { padding: 0 !important; }
html.mf-embed[data-mf-mode="panelset"] .octoprint-container .tabbable { display: none !important; }
html.mf-embed[data-mf-mode="panelset"] #sidebar { width: 100% !important; margin-left: 0 !important; float: none !important; }
html.mf-embed[data-mf-mode="panelset"] #sidebar > .accordion-group:not(.mf-show) { display: none !important; }
html.mf-embed[data-mf-mode="panelset"] body { background: transparent !important; }

/* one top-bar item with its dropdown open (a plugin's button in MakerPrint's top bar) */
html.mf-embed[data-mf-mode="navbar"] .octoprint-container,
html.mf-embed[data-mf-mode="navbar"] .footer,
html.mf-embed[data-mf-mode="navbar"] #navbar .brand { display: none !important; }
html.mf-embed[data-mf-mode="navbar"] #navbar { display: block !important; }
html.mf-embed[data-mf-mode="navbar"] #navbar .container { width: auto !important; }
html.mf-embed[data-mf-mode="navbar"] #navbar .nav > li:not(.mf-show) { display: none !important; }
html.mf-embed[data-mf-mode="navbar"] #navbar .nav-collapse { height: auto !important; overflow: visible !important; }
html.mf-embed[data-mf-mode="navbar"] #navbar .nav.pull-right { float: left !important; }
html.mf-embed[data-mf-mode="navbar"] #navbar .dropdown-menu { position: static !important; display: block; float: none !important; max-height: none !important; box-shadow: none !important; }
html.mf-embed[data-mf-mode="navbar"] #navbar .nav > li:not(.open) .dropdown-menu { display: none; }

/* settings: the dialog becomes the page */
html.mf-embed[data-mf-mode="settings"] .octoprint-container { visibility: hidden !important; }
html.mf-embed[data-mf-mode="settings"] #settings_dialog { top: 0 !important; left: 0 !important; right: 0 !important; bottom: 0 !important; width: auto !important; max-width: none !important; margin: 0 !important; border: 0 !important; border-radius: 0 !important; }
html.mf-embed[data-mf-mode="settings"] #settings_dialog .modal-body { max-height: none !important; height: calc(100vh - 118px) !important; }
html.mf-embed[data-mf-mode="settings"] #settings_dialog .modal-header .close,
html.mf-embed[data-mf-mode="settings"] #settings_dialog .modal-footer [data-dismiss="modal"] { display: none !important; }
html.mf-embed[data-mf-mode="settings"] .modal-backdrop { opacity: 1 !important; }
/* Plugin Manager's list is a fixed 234px box in the dialog; here the dialog is the page */
html.mf-embed[data-mf-mode="settings"] #settings_plugin_pluginmanager_pluginlist { height: calc(100vh - 330px) !important; min-height: 240px; max-height: none !important; }
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
export function createClassicFrame(host, { timeoutMs = 90000, pinScroll = false } = {}) {
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

  /**
   * What plugins added to the classic page: their tabs, sidebar panels, top-bar items and
   * settings pages. Each is {kind, id, name, plugin}; `plugin` is the plugin's identifier.
   */
  function parts() {
    const q = (s) => Array.from(doc.querySelectorAll(s));
    const tabs = q("#tabs a[href^='#']")
      .map((a) => ({ kind: "tab", id: a.getAttribute("href").slice(1), name: textOf(a) }))
      .filter((t) => t.id && t.name && !CORE_TABS.has(t.id) && doc.getElementById(t.id) && shown(doc.querySelector(`#tabs a[href="#${t.id}"]`)?.closest("li"), win));
    const panels = q("#sidebar > .accordion-group[id]")
      .filter((g) => !CORE_PANELS.has(g.id) && shown(g, win))
      .map((g) => ({ kind: "panel", id: g.id, name: textOf(g.querySelector(".accordion-heading")) || pluginOf(g.id) }));
    const navbar = q("#navbar .nav > li[id]")
      .filter((li) => !CORE_NAVBAR.has(li.id))
      .map((li) => ({ kind: "navbar", id: li.id, name: navbarName(li) }));
    const settings = q("#settings_dialog_menu a[href^='#settings_plugin_']")
      .map((a) => ({ kind: "settings", id: a.getAttribute("href").slice(1), name: textOf(a) }))
      .filter((s) => s.name);
    const firstSettings = doc.querySelector("#settings_dialog_menu a[href^='#settings_']")?.getAttribute("href")?.slice(1) || null;
    for (const p of [...tabs, ...panels, ...navbar, ...settings]) p.plugin = pluginOf(p.id);
    return { tabs, panels, navbar, settings, firstSettings };
  }

  // A top-bar item is often only an icon or a number: its tooltip or the plugin's name is its label
  function navbarName(li) {
    const t = textOf(li);
    const plugin = pluginOf(li.id).replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
    if (t && /^[\d\s!?.:-]{1,4}$/.test(t)) return `${plugin}: ${t}`;
    if (t) return t.slice(0, 40);
    const titled = li.querySelector("[title], [data-original-title], [aria-label]");
    const tip = titled && (titled.getAttribute("title") || titled.getAttribute("data-original-title") || titled.getAttribute("aria-label"));
    return (tip || plugin).slice(0, 40);
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
    if (part.kind === "panelset") {
      const want = new Set(part.ids || []);
      for (const g of doc.querySelectorAll("#sidebar > .accordion-group")) {
        g.classList.toggle("mf-show", want.has(g.id));
        if (want.has(g.id)) win.$(g.querySelector(".accordion-body")).collapse("show");
      }
    }
    if (part.kind === "navbar") {
      for (const li of doc.querySelectorAll("#navbar .nav > li")) li.classList.toggle("mf-show", li.id === part.id);
    }
    win.scrollTo(0, 0);
  }

  /** The element behind a part, inside the frame. */
  function element(part) {
    if (part.kind === "navbar" || part.kind === "panel") return doc.getElementById(part.id);
    if (part.kind === "tab") return doc.getElementById(part.id);
    return null;
  }

  /** Is one of OctoPrint's (or a plugin's) dialogs open in the frame? (Not the setup wizard,
   * which belongs to the full classic page and is hidden here.) */
  function modalOpen() {
    try { return !!doc.querySelector(".modal.in:not(#wizard_dialog)") && doc.body.classList.contains("modal-open"); } catch { return false; }
  }

  /** Is OctoPrint's setup wizard waiting (usually a newly installed plugin's first-run steps)? */
  function wizardOpen() {
    try { return !!doc.querySelector("#wizard_dialog.in"); } catch { return false; }
  }

  /** Height of what is showing, for a frame that grows with its content. */
  function contentHeight() {
    try {
      const mode = doc.documentElement.dataset.mfMode;
      if (mode === "navbar") return Math.ceil(doc.querySelector("#navbar")?.getBoundingClientRect().height || 0);
      return Math.ceil(doc.querySelector("#sidebar")?.getBoundingClientRect().height || doc.body.scrollHeight);
    } catch { return 0; }
  }

  // A frame further down a page can still pull the page to itself while OctoPrint starts
  // (autofocus, scrollIntoView). With pinScroll, any scroll the person didn't make is undone.
  let unpin = () => {};
  if (pinScroll) {
    let lastInput = 0, y = window.scrollY;
    const mark = () => { lastInput = Date.now(); };
    const onScroll = () => {
      if (Date.now() - lastInput < 1200) { y = window.scrollY; return; }
      if (Math.abs(window.scrollY - y) > 1) window.scrollTo(window.scrollX, y);
    };
    const evs = ["wheel", "touchstart", "touchmove", "keydown", "pointerdown"];
    evs.forEach((e) => window.addEventListener(e, mark, { passive: true, capture: true }));
    window.addEventListener("scroll", onScroll, { passive: true });
    unpin = () => { evs.forEach((e) => window.removeEventListener(e, mark, { capture: true })); window.removeEventListener("scroll", onScroll); };
  }

  return {
    frame,
    ready,
    contentHeight,
    parts,
    show,
    element,
    modalOpen,
    wizardOpen,
    get win() { return win; },
    get doc() { return doc; },
    destroy() { alive = false; unpin(); frame.remove(); },
  };
}
