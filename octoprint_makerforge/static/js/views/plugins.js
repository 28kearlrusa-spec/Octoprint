// Plugins: OctoPrint's Plugin Manager, and every plugin's own tabs, panels, top-bar items and
// settings, all in one place. Each one also shows on the page it belongs to (Settings > Plugins
// on pages); this screen lists everything, wherever it's placed.
import { html, raw, refs, esc } from "mf/core/dom.js";
import { icon } from "mf/ui/icons.js";
import { boot } from "mf/core/api.js";
import * as router from "mf/core/router.js";
import * as host from "mf/core/plugin-host.js";

const MANAGER = { kind: "settings", id: "settings_plugin_pluginmanager", name: "Plugin Manager" };
const UPDATES = { kind: "settings", id: "settings_plugin_softwareupdate", name: "Software Update" };
const EVERYTHING = { kind: "classic", id: "all", name: "Classic OctoPrint" };

const key = (p) => `${p.kind}/${p.id}`;
const placeName = (p) => (host.PLACES.find(([id]) => id === host.placeOf(p)) || [, ""])[1];

export default {
  id: "plugins",
  mount(el, { route }) {
    const view = html`
      <div>
        <div class="view-head"><h1>Plugins</h1>
          <a class="btn btn-sm btn-ghost" href="${router.href("settings", "plugin-places")}">${raw(icon("settings"))}Plugins on pages</a></div>
        <div class="set-layout plugins-layout">
          <nav class="set-nav" data-ref="nav" aria-label="Plugin pages"><span class="muted plug-wait">Loading plugin pages…</span></nav>
          <section class="panel plug-frame-panel">
            <div class="plug-frame" data-ref="slot">
              <div class="plug-state" data-ref="state">${raw(icon("refresh", "i spin"))}<span>Starting OctoPrint's plugin pages. On a Raspberry Pi this takes a few seconds.</span></div>
            </div>
          </section>
        </div>
      </div>`;
    const r = refs(view);
    el.append(view);

    if (!host.allowed()) {
      r.state.innerHTML = `${icon("lock")}<span>Your account can't see OctoPrint's plugin pages.</span>`;
      r.nav.replaceChildren();
      return {};
    }

    let items = [];
    let lease = null;
    let wanted = route.rest;

    function pick(rest) {
      const w = rest?.length ? `${rest[0]}/${rest.slice(1).join("/")}` : key(MANAGER);
      return items.find((p) => key(p) === w) || items.find((p) => key(p) === key(MANAGER)) || items[0];
    }

    function select(part) {
      if (!part) return;
      r.nav.querySelectorAll("a[data-key]").forEach((a) => (a.dataset.key === key(part) ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
      if (lease) lease.show(part); else lease = host.lease(r.slot, part);
      window.scrollTo(0, 0);
    }

    function render(found) {
      const hasUpdates = found.settings.some((s) => s.id === UPDATES.id);
      const pluginSettings = found.settings.filter((s) => s.id !== MANAGER.id && s.id !== UPDATES.id && s.id !== "settings_plugin_makerforge");
      const groups = [
        ["Manage", [MANAGER, ...(hasUpdates ? [UPDATES] : []), ...(found.firstSettings ? [{ kind: "settings", id: found.firstSettings, name: "All OctoPrint settings", full: true }] : [])]],
        ["Plugin pages", found.tabs],
        ["Plugin panels", found.panels],
        ["Top bar", found.navbar],
        ["Plugin settings", pluginSettings],
        ["Everything", [EVERYTHING]],
      ].filter(([, list]) => list.length);
      items = groups.flatMap(([, list]) => list);
      r.nav.innerHTML = groups.map(([title, list]) => `<div class="plug-group">${esc(title)}</div>` +
        list.map((p) => {
          const where = (p.kind === "tab" || p.kind === "panel") ? placeName(p) : "";
          return `<a href="${router.href("plugins", [p.kind, p.id])}" data-key="${esc(key(p))}"><span class="grow truncate">${esc(p.name)}</span>${where ? `<span class="plug-where">${esc(where)}</span>` : ""}</a>`;
        }).join("")).join("");
      r.state.remove();
      select(pick(wanted));
    }

    const off = host.onParts(render);
    host.ready().catch((e) => {
      r.state.innerHTML = `${icon("alert")}<span>${esc(e.message || "OctoPrint's classic page didn't load.")} <a class="link" href="${esc(boot.classicUrl)}" target="_blank" rel="noopener">Open it directly</a></span>`;
      r.nav.replaceChildren();
    });

    return {
      onRoute(rt) { wanted = rt.rest; if (items.length) select(pick(rt.rest)); },
      unmount() { off(); lease?.release(); },
    };
  },
};
