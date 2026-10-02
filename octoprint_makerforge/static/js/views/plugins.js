// Plugins: OctoPrint's Plugin Manager, and every plugin's own tabs, panels and settings, shown
// by OctoPrint's classic page in a frame so they all work exactly as they do there.
import { html, raw, refs, esc } from "mf/core/dom.js";
import { icon } from "mf/ui/icons.js";
import { boot } from "mf/core/api.js";
import { can } from "mf/core/auth.js";
import * as router from "mf/core/router.js";
import { createClassicFrame } from "mf/core/classic-frame.js";

const MANAGER = { kind: "settings", id: "settings_plugin_pluginmanager", name: "Plugin Manager" };
const UPDATES = { kind: "settings", id: "settings_plugin_softwareupdate", name: "Software Update" };
const EVERYTHING = { kind: "classic", id: "all", name: "Classic OctoPrint" };

const key = (p) => `${p.kind}/${p.id}`;

export default {
  id: "plugins",
  mount(el, { route }) {
    const view = html`
      <div>
        <div class="view-head"><h1>Plugins</h1></div>
        <div class="set-layout plugins-layout">
          <nav class="set-nav" data-ref="nav" aria-label="Plugin pages"><span class="muted plug-wait">Loading plugin pages…</span></nav>
          <section class="panel plug-frame-panel">
            <div class="plug-frame" data-ref="host">
              <div class="plug-state" data-ref="state">${raw(icon("refresh", "i spin"))}<span>Starting OctoPrint's plugin pages. On a Raspberry Pi this takes a few seconds.</span></div>
            </div>
          </section>
        </div>
      </div>`;
    const r = refs(view);
    el.append(view);

    if (!can("settings_read") && !can("admin")) {
      r.state.innerHTML = `${icon("lock")}<span>Your account can't see OctoPrint's plugin pages.</span>`;
      r.nav.replaceChildren();
      return {};
    }

    const cf = createClassicFrame(r.host);
    let items = [];
    let current = null;

    function pick(rest) {
      const wanted = rest?.length ? `${rest[0]}/${rest.slice(1).join("/")}` : key(MANAGER);
      return items.find((p) => key(p) === wanted) || items.find((p) => key(p) === key(MANAGER)) || items[0];
    }

    function select(part) {
      if (!part) return;
      current = part;
      r.nav.querySelectorAll("a[data-key]").forEach((a) => (a.dataset.key === key(part) ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
      cf.show(part);
      window.scrollTo(0, 0);   // the frame should stay in view whatever was clicked
    }

    cf.ready.then(() => {
      const found = cf.parts();
      const hasUpdates = found.settings.some((s) => s.id === UPDATES.id);
      const pluginSettings = found.settings.filter((s) => s.id !== MANAGER.id && s.id !== UPDATES.id && s.id !== "settings_plugin_makerforge");
      const groups = [
        ["Manage", [MANAGER, ...(hasUpdates ? [UPDATES] : []), ...(found.firstSettings ? [{ kind: "settings", id: found.firstSettings, name: "All OctoPrint settings", full: true }] : [])]],
        ["Plugin pages", found.tabs],
        ["Plugin panels", found.panels],
        ["Plugin settings", pluginSettings],
        ["Everything", [EVERYTHING]],
      ].filter(([, list]) => list.length);
      items = groups.flatMap(([, list]) => list);
      r.nav.innerHTML = groups.map(([title, list]) => `<div class="plug-group">${esc(title)}</div>` +
        list.map((p) => `<a href="${router.href("plugins", [p.kind, p.id])}" data-key="${esc(key(p))}">${esc(p.name)}</a>`).join("")).join("");
      r.state.remove();
      cf.frame.classList.add("is-ready");
      select(pick(route.rest));
    }).catch((e) => {
      r.state.innerHTML = `${icon("alert")}<span>${esc(e.message || "OctoPrint's classic page didn't load.")} <a class="link" href="${esc(boot.classicUrl)}" target="_blank" rel="noopener">Open it directly</a></span>`;
      r.nav.replaceChildren();
    });

    return {
      onRoute(rt) { if (items.length) select(pick(rt.rest)); },
      unmount() { cf.destroy(); },
    };
  },
};
