// One plugin's tab as a page of its own, for plugins with a menu entry (#/p/<tab id>).
import { html, raw, refs, esc } from "mf/core/dom.js";
import { icon } from "mf/ui/icons.js";
import * as router from "mf/core/router.js";
import * as host from "mf/core/plugin-host.js";

export default {
  id: "p",
  mount(el, { route }) {
    const view = html`
      <div>
        <div class="view-head"><h1 data-ref="title">Plugin</h1>
          <a class="btn btn-sm btn-ghost" href="${router.href("settings", "plugin-places")}">${raw(icon("settings"))}Arrange plugins</a></div>
        <section class="panel plug-frame-panel"><div class="plug-frame" data-ref="slot">
          <div class="plug-state" data-ref="state">${raw(icon("refresh", "i spin"))}<span>Starting OctoPrint's plugin pages. On a Raspberry Pi this takes a few seconds.</span></div>
        </div></section>
      </div>`;
    const r = refs(view);
    el.append(view);
    if (!host.allowed()) {
      r.state.innerHTML = `${icon("lock")}<span>Your account can't see OctoPrint's plugin pages.</span>`;
      return {};
    }

    let id = route.rest[0];
    let lease = null;
    function show(parts) {
      const part = parts.tabs.find((t) => t.id === id);
      if (!part) {
        lease?.release(); lease = null;
        r.title.textContent = "Plugin";
        r.state.hidden = false;
        r.state.innerHTML = `${icon("plugin")}<span>That plugin page isn't there any more. It may have been turned off or removed. <a class="link" href="${router.href("plugins")}">All plugin pages</a></span>`;
        return;
      }
      r.title.textContent = part.name;
      document.title = `${part.name} – MakerPrint`;
      r.state.hidden = true;
      if (lease) lease.show(part); else lease = host.lease(r.slot, part);
    }
    const off = host.onParts(show);
    host.ready().catch((e) => { r.state.innerHTML = `${icon("alert")}<span>${esc(e.message || "OctoPrint's classic page didn't load.")}</span>`; });
    return {
      onRoute(rt) { id = rt.rest[0]; const p = host.currentParts(); if (p) show(p); },
      unmount() { off(); lease?.release(); },
    };
  },
};
