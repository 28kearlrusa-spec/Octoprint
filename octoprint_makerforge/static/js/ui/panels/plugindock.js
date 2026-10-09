// A page's plugins: the tabs and sidebar panels of every plugin placed on this page (Settings >
// Plugins on pages), working exactly as in classic OctoPrint. Shows nothing when there are none.
import { html, raw, refs, esc } from "mf/core/dom.js";
import { icon } from "mf/ui/icons.js";
import * as router from "mf/core/router.js";
import * as host from "mf/core/plugin-host.js";

const TAB_HEIGHT = "clamp(460px, calc(100dvh - var(--topbar-h) - 160px), 1100px)";

/**
 * mountPluginDock(container, page, {title, note, empty}) -> {dispose}
 * `empty` (optional) is shown when no plugin is placed here; without it the panel hides.
 */
export function mountPluginDock(container, page, { title = "Plugins", empty = "" } = {}) {
  const el = html`
    <section class="panel plug-dock" aria-label="${title}" hidden>
      <div class="panel-head"><h2 class="panel-title">${title}</h2>
        <div class="seg plug-chips" data-ref="chips" role="tablist" aria-label="Plugin pages"></div>
        <div class="panel-tools"><a class="btn btn-sm btn-ghost" href="${router.href("settings", "plugin-places")}" data-tip="Choose which plugins show on which page">${raw(icon("settings"))}<span class="btn-label">Arrange</span></a></div></div>
      <div class="plug-slot" data-ref="slot"><p class="hint plug-slot-state" data-ref="state">${raw(icon("refresh", "i i-sm spin"))} Starting OctoPrint's plugin pages…</p></div>
    </section>`;
  const r = refs(el);
  container.append(el);
  if (!host.allowed()) return { dispose() { el.remove(); } };

  let entries = [];
  let current = null;
  let lease = null;
  let fitTimer = 0;

  function fit() {
    if (!current || current.kind !== "panelset") return;
    const h = host.contentHeight();
    if (h > 0) r.slot.style.height = `${Math.min(h + 4, 1600)}px`;
  }

  function select(key) {
    current = entries.find((e) => e.key === key) || entries[0] || null;
    r.chips.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.key === current?.key)));
    if (!current) return;
    r.slot.style.height = current.kind === "panelset" ? "160px" : TAB_HEIGHT;
    if (lease) lease.show(current.part); else lease = host.lease(r.slot, current.part);
    clearInterval(fitTimer);
    if (current.kind === "panelset") { fitTimer = setInterval(fit, 1000); setTimeout(fit, 300); }
  }

  function render(parts) {
    const mine = host.partsFor(page, parts);
    entries = [];
    if (mine.panels.length) {
      entries.push({
        key: "panels", kind: "panelset",
        name: mine.panels.length === 1 ? mine.panels[0].name : "Panels",
        part: { kind: "panelset", ids: mine.panels.map((p) => p.id) },
      });
    }
    for (const t of mine.tabs) entries.push({ key: host.partKey(t), kind: "tab", name: t.name, part: t });
    el.hidden = !entries.length && !empty;
    if (!entries.length) {
      lease?.release(); lease = null; current = null; clearInterval(fitTimer);
      r.chips.replaceChildren();
      r.slot.style.height = "";
      r.state.hidden = false;
      r.state.innerHTML = esc(empty);
      if (!r.state.isConnected) r.slot.append(r.state);
      return;
    }
    r.state.remove();
    r.chips.hidden = entries.length < 2;
    r.chips.innerHTML = entries.map((e) => `<button type="button" role="tab" data-key="${esc(e.key)}" aria-pressed="false">${esc(e.name)}</button>`).join("");
    select(current && entries.some((e) => e.key === current.key) ? current.key : entries[0].key);
  }

  r.chips.addEventListener("click", (e) => { const b = e.target.closest("button[data-key]"); if (b) select(b.dataset.key); });
  const off = host.onParts(render);
  host.ready().catch((e) => {
    r.state.innerHTML = `${icon("alert")} ${esc(e.message || "OctoPrint's classic page didn't load.")}`;
  });
  return {
    dispose() { off(); clearInterval(fitTimer); lease?.release(); el.remove(); },
  };
}
