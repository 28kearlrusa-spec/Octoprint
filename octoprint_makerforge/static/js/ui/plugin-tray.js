// Plugins' top-bar buttons (PSU Control's power switch, a layer counter, a firmware warning ...)
// in MakerPrint's top bar. Each button is a live copy of the plugin's own item in OctoPrint's
// classic page; pressing it presses the real one, and whatever that opens (a menu or a dialog)
// is shown from the real page, so it behaves exactly as in classic OctoPrint.
import * as host from "mf/core/plugin-host.js";
import { icon } from "mf/ui/icons.js";

// Plugins draw their top-bar icons with Font Awesome, which only the classic page loads (in
// its bundled stylesheet). Their icons are redrawn from MakerPrint's own set, so they match.
const FA = [
  [/bolt|flash|power|plug/, "power"], [/lightbulb|sun/, "light"], [/exclamation|warning|triangle/, "alert"],
  [/heart|medkit|stethoscope|heartbeat/, "activity"], [/thermometer|temperature|fire|flame/, "flame"],
  [/video|camera|film/, "camera"], [/bell/, "bell"], [/wifi|signal|globe|cloud/, "wifi"], [/fan|snowflake/, "fan"],
  [/cog|gear|wrench|sliders|tools/, "settings"], [/info|question/, "info"], [/clock|hourglass|stopwatch/, "clock"],
  [/layer|stack|bars/, "layers"], [/print|cube/, "cube"], [/microchip|memory|server|terminal/, "cpu"],
  [/spool|circle-notch|dot-circle/, "spool"], [/stop|ban|times/, "octagon"], [/check/, "check"], [/eye/, "eye"],
  [/refresh|sync|redo|undo/, "refresh"], [/lock/, "lock"], [/download|upload/, "download"], [/envelope|comment|message/, "bell"],
];
function faIcon(cls) {
  const name = String(cls).split(/\s+/).find((c) => /^(fa|icon)-/.test(c) && !/^fa-(solid|regular|light|brands|fw|lg|[0-9]x|spin)$/.test(c)) || "";
  return (FA.find(([re]) => re.test(name)) || [, "plugin"])[1];
}

// A safe, inert copy of a top-bar item: only what's visible, and no ids, bindings, links or
// handlers. (Plugins switch between states by hiding parts of their item.)
function copyOf(li, win) {
  const out = document.createElement("span");
  out.className = "tray-face";
  for (const node of li.childNodes) out.append(document.importNode(node, true));
  const originals = li.querySelectorAll("*");
  const copies = out.querySelectorAll("*");
  originals.forEach((o, i) => { if (win.getComputedStyle(o).display === "none") copies[i]?.setAttribute("data-mf-hidden", ""); });
  out.querySelectorAll("[data-mf-hidden], script, style, input, select, textarea, iframe, .dropdown-menu, .modal").forEach((n) => n.remove());
  for (const i of out.querySelectorAll("i[class*='fa'], i[class*='icon-'], span[class*='fa-'], span[class*='icon-']")) {
    const svg = document.createElement("span");
    svg.className = "tray-icon";
    svg.innerHTML = icon(faIcon(i.className), "i i-sm");   // MakerPrint's own icon markup
    i.replaceWith(svg);
  }
  for (const n of [out, ...out.querySelectorAll("*")]) {
    for (const a of Array.from(n.attributes)) {
      if (/^(id|data-bind|href|src|on\w+|tabindex|data-toggle|data-target|role|aria-\w+)$/i.test(a.name) && !(a.name === "src" && n.tagName === "IMG" && /^(\/|data:image)/.test(a.value))) n.removeAttribute(a.name);
    }
  }
  return out;
}

const visible = (el, win) => !!el && win.getComputedStyle(el).display !== "none";

/** Mount the tray into `container` (the top bar). Returns {dispose, items()} */
export function mountPluginTray(container, { onItems } = {}) {
  const tray = document.createElement("div");
  tray.className = "plug-tray";
  tray.setAttribute("aria-label", "Plugin buttons");
  container.prepend(tray);
  if (!host.allowed()) return { dispose() { tray.remove(); }, items: () => [] };

  let parts = [];
  const watchers = new Map();   // id -> MutationObserver
  let pop = null;

  function syncFace(id) {
    host.inFrame((win, doc) => {
      const li = doc.getElementById(id);
      const btn = tray.querySelector(`[data-id="${CSS.escape(id)}"]`);
      if (!li || !btn) return;
      // while one item's menu is open the frame hides the others: they haven't really changed
      if (doc.documentElement.dataset.mfMode === "navbar") return;
      const face = copyOf(li, win);
      // plugins hide what's inside their item when there's nothing to show (no message, no
      // warning): an item with nothing visible left stays hidden here too
      const empty = !face.textContent.trim() && !face.querySelector("img, svg");
      btn.hidden = !visible(li, win) || empty;
      btn.replaceChildren(face);
    }).catch(() => {});
  }

  function render(found) {
    parts = found.navbar.filter((p) => host.placeOf(p) !== "hidden");
    for (const [id, mo] of watchers) if (!parts.some((p) => p.id === id)) { mo.disconnect(); watchers.delete(id); }
    // keep the buttons that are still there (no flicker), add new ones hidden until drawn
    const existing = new Map(Array.from(tray.children, (b) => [b.dataset.id, b]));
    tray.replaceChildren(...parts.map((p) => {
      let b = existing.get(p.id);
      if (!b) {
        b = document.createElement("button");
        b.type = "button";
        b.className = "btn btn-sm btn-ghost tray-item";
        b.dataset.id = p.id;
        b.hidden = true;
      }
      b.dataset.name = p.name;
      b.dataset.tip = p.name;
      b.setAttribute("aria-label", p.name);
      return b;
    }));
    host.inFrame((win, doc) => {
      for (const p of parts) {
        syncFace(p.id);
        if (watchers.has(p.id)) continue;
        const li = doc.getElementById(p.id);
        if (!li) continue;
        let t = 0;
        const mo = new win.MutationObserver(() => { clearTimeout(t); t = setTimeout(() => syncFace(p.id), 120); });
        mo.observe(li, { subtree: true, childList: true, characterData: true, attributes: true });
        watchers.set(p.id, mo);
      }
    }).catch(() => {});
    onItems?.(parts);
  }

  tray.addEventListener("click", (e) => {
    const b = e.target.closest(".tray-item");
    if (b) press(b.dataset.id, b);
  });

  /** Press a plugin's top-bar item. Works from the "More" menu too. */
  function press(id, anchor) {
    host.inFrame((win, doc) => {
      const li = doc.getElementById(id);
      if (!li) return;
      const target = li.querySelector("a, button, [data-toggle], [data-bind*='click']") || li;
      closePop();
      target.click();
      // A dialog the plugin opens shows over the page by itself (plugin-host.js). A menu needs
      // the frame borrowed and shown under the button, as soon as it opens.
      const t0 = Date.now();
      const watch = setInterval(() => {
        const open = li.classList.contains("open");
        if (open && !pop) {
          const slot = document.createElement("div");
          slot.className = "tray-pop";
          document.getElementById("overlays").append(slot);
          pop = { slot, lease: host.lease(slot, { kind: "navbar", id }), id, watch };
        }
        if (open && pop?.id === id) {
          const a = anchor?.isConnected ? anchor.getBoundingClientRect() : null;
          const h = Math.min(Math.max(host.contentHeight(), 60), Math.round(window.innerHeight * 0.7));
          const w = 320;
          Object.assign(pop.slot.style, { height: `${h}px`, width: `${w}px`, top: `${(a?.bottom ?? 56) + 6}px`, left: `${Math.max(8, Math.min(window.innerWidth - w - 8, (a?.right ?? w) - w))}px` });
        } else if (pop?.id === id && !open) {
          closePop();   // the menu closed (an item was picked, or it was dismissed)
        } else if (!pop && Date.now() - t0 > 3000) {
          clearInterval(watch);   // a plain button (a toggle): nothing more to show
        }
      }, 120);
    }).catch(() => {});
  }

  function closePop() {
    if (!pop) return;
    const { slot, lease, id, watch } = pop;
    pop = null;
    clearInterval(watch);
    host.inFrame((win, doc) => { doc.getElementById(id)?.classList.remove("open"); }).catch(() => {});
    lease.release();
    slot.remove();
    setTimeout(() => parts.forEach((p) => syncFace(p.id)), 200);
  }
  const outside = (e) => { if (pop && !e.target.closest(".tray-item")) closePop(); };
  const esc_ = (e) => { if (e.key === "Escape") closePop(); };
  document.addEventListener("pointerdown", outside, true);
  document.addEventListener("keydown", esc_);

  const off = host.onParts(render);
  return {
    // what's showing now (plugins hide their items when there's nothing to say)
    items: () => parts.filter((p) => tray.querySelector(`[data-id="${CSS.escape(p.id)}"]`)?.hidden === false),
    press,
    dispose() {
      off(); closePop();
      for (const mo of watchers.values()) mo.disconnect();
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", esc_);
      tray.remove();
    },
  };
}
