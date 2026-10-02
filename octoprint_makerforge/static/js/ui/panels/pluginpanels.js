// Plugins on the Print page: every installed plugin's sidebar panel, running in OctoPrint's
// classic page in a frame so each one works exactly as it does there.
import { html, raw, refs, esc } from "mf/core/dom.js";
import { icon } from "mf/ui/icons.js";
import { boot } from "mf/core/api.js";
import { can } from "mf/core/auth.js";
import * as router from "mf/core/router.js";
import { createClassicFrame } from "mf/core/classic-frame.js";

export function mountPluginPanels(host) {
  const el = html`
    <section class="panel a-plugins" aria-label="Plugins">
      <div class="panel-head"><h2 class="panel-title">Plugins</h2>
        <div class="panel-tools"><a class="btn btn-sm btn-ghost" href="${router.href("plugins")}">${raw(icon("plugin"))}All plugin pages</a></div></div>
      <div class="dash-plug" data-ref="host"><p class="hint dash-plug-state" data-ref="state">${raw(icon("refresh", "i i-sm spin"))} Loading plugin panels…</p></div>
    </section>`;
  const r = refs(el);
  host.append(el);
  if (!can("settings_read") && !can("admin")) { r.state.textContent = "Your account can't see plugin panels."; return { dispose() { el.remove(); } }; }

  const cf = createClassicFrame(r.host);
  let ro = null, timer = null;
  const fit = () => { const h = cf.contentHeight(); if (h > 0) cf.frame.style.height = `${Math.min(h + 4, 1400)}px`; };
  cf.ready.then(() => {
    const found = cf.parts();
    if (!found.panels.length) {
      cf.frame.remove();
      r.state.innerHTML = `No installed plugin adds a panel. Plugin pages and settings are under <a class="link" href="${router.href("plugins")}">Plugins</a>.`;
      return;
    }
    r.state.remove();
    cf.show({ kind: "panels", id: "all" });
    cf.frame.classList.add("is-ready");
    fit();
    // plugins redraw their panels as data arrives: follow their height
    try { ro = new cf.frame.contentWindow.ResizeObserver(fit); ro.observe(cf.frame.contentDocument.body); } catch { timer = setInterval(fit, 2000); }
  }).catch((e) => {
    r.state.innerHTML = `${esc(e.message || "Plugin panels didn't load.")} <a class="link" href="${esc(boot.classicUrl)}" target="_blank" rel="noopener">Open the classic page</a>`;
  });
  return { dispose() { ro?.disconnect(); clearInterval(timer); cf.destroy(); el.remove(); } };
}
