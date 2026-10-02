// Macros on the Print page: every macro as a compact button, greyed out when it can't run.
import { html, raw, refs } from "mf/core/dom.js";
import { store } from "mf/core/store.js";
import { icon } from "mf/ui/icons.js";
import { config } from "mf/core/config.js";
import { can } from "mf/core/auth.js";
import { availability, runMacro, grouped, macroIcon, openMacroEditor } from "mf/ui/macros.js";

export function mountMacroDeck(host) {
  const el = html`
    <section class="panel a-macrodeck" aria-label="Macros">
      <div class="panel-head"><h2 class="panel-title">Macros</h2>
        <div class="panel-tools"><input class="input input-sm deck-search" type="search" placeholder="Filter" aria-label="Filter macros" data-ref="q">
          <button class="btn btn-sm btn-ghost btn-icon" data-ref="edit" aria-label="Edit macros" data-tip="Edit macros">${raw(icon("edit"))}</button></div></div>
      <div class="deck-body" data-ref="body"></div>
    </section>`;
  const r = refs(el);
  host.append(el);

  function render() {
    const q = r.q.value.trim().toLowerCase();
    const list = (config.data.macros || []).filter((m) => !q || `${m.name} ${m.cat} ${m.gcode}`.toLowerCase().includes(q));
    const groups = grouped(list);
    if (!groups.size) {
      r.body.replaceChildren(html`<p class="hint">${q ? "No macro matches that." : "No macros yet. Add some with the edit button."}</p>`);
      return;
    }
    r.body.replaceChildren(...Array.from(groups, ([cat, ms]) => {
      const g = html`<div class="deck-group"><div class="label">${cat}</div><div class="deck-grid"></div></div>`;
      const grid = g.querySelector(".deck-grid");
      for (const m of ms) {
        const a = availability(m);
        const b = html`<button class="btn btn-sm deck-btn" ${a.ok ? "" : "disabled"} data-tip="${a.ok ? m.gcode.split("\n")[0] : a.reason}">${raw(macroIcon(m))}<span>${m.name}</span></button>`;
        b.addEventListener("click", () => runMacro(m));
        grid.append(b);
      }
      return g;
    }));
  }

  r.q.addEventListener("input", render);
  r.edit.addEventListener("click", () => openMacroEditor());
  const offs = [store.on("printer", render), store.on("klipper", render), store.on("temps", render), store.on("config", render), store.on("auth", render)];
  r.edit.hidden = !can("control");
  render();
  return { dispose() { offs.forEach((o) => o()); el.remove(); } };
}
