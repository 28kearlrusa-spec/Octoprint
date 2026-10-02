// Print: the main screen. Which panels it shows, and in what order, is up to the person using
// it (Settings > Print page). The columns adapt to the width of the page.
import { html } from "mf/core/dom.js";
import { prefs } from "mf/core/prefs.js";
import { dashPanels, distribute } from "mf/core/dash.js";
import { mountJob } from "mf/ui/panels/job.js";
import { mountCamera } from "mf/ui/panels/camera.js";
import { mountTemps } from "mf/ui/panels/temps.js";
import { mountQuickTune } from "mf/ui/panels/quicktune.js";
import { mountWelcome } from "mf/ui/panels/welcome.js";
import { mountToolhead } from "mf/ui/panels/toolhead.js";
import { mountConsole } from "mf/ui/panels/console.js";
import { mountMacroDeck } from "mf/ui/panels/macrodeck.js";
import { mountKlipperInfo } from "mf/ui/panels/klipperinfo.js";
import { mountSystem } from "mf/ui/panels/system.js";
import { mountUsage } from "mf/ui/panels/usage.js";

const MOUNT = {
  job: mountJob, camera: mountCamera, temps: mountTemps, tune: mountQuickTune,
  toolhead: mountToolhead, console: mountConsole, macros: mountMacroDeck,
  klipper: mountKlipperInfo, system: mountSystem, usage: mountUsage,
};

// how many columns fit, from the width the grid actually has
const columnsFor = (width, look) => (look === "studio" ? (width >= 1320 ? 3 : width >= 860 ? 2 : 1) : width >= 1000 ? 2 : 1);

export default {
  id: "print",
  mount(el) {
    const top = html`<div class="dash-top"></div>`;
    const grid = html`<div class="dash"></div>`;
    el.append(top, grid);
    const welcome = mountWelcome(top);
    const slots = new Map();   // id -> {slot, part}
    let sig = "";

    function build() {
      const ids = dashPanels();
      for (const [id, s] of slots) {
        if (!ids.includes(id)) { s.part.dispose(); s.slot.remove(); slots.delete(id); }
      }
      for (const id of ids) {
        if (slots.has(id) || !MOUNT[id]) continue;
        const slot = document.createElement("div");
        slot.className = "dash-slot";
        slot.dataset.panel = id;
        slots.set(id, { slot, part: MOUNT[id](slot) });
      }
      layout(true);
    }

    // panels only move when the column count or the chosen set changes, never on their own
    function layout(force = false) {
      const look = prefs.get("look");
      const ids = dashPanels(look).filter((id) => slots.has(id));
      const n = columnsFor(grid.clientWidth || el.clientWidth || window.innerWidth, look);
      const key = `${n}|${ids.join(",")}`;
      if (!force && key === sig) return;
      sig = key;
      const columns = distribute(ids, n);
      grid.dataset.cols = String(columns.length);
      grid.replaceChildren(...columns.map((list) => {
        const col = document.createElement("div");
        col.className = "dash-col";
        for (const id of list) col.append(slots.get(id).slot);
        return col;
      }));
      if (!ids.length) grid.replaceChildren(html`<div class="empty"><div class="empty-title">No panels on this page</div><p class="empty-text">Choose what the Print page shows in Settings, under Print page.</p><a class="btn btn-sm" href="#/settings/dashboard">Choose panels</a></div>`);
    }

    const ro = new ResizeObserver(() => layout());
    ro.observe(grid);
    const offPrefs = prefs.on((k) => { if (k === "dash" || k === "look" || k === "*") build(); });
    build();
    return {
      unmount() {
        ro.disconnect();
        offPrefs();
        welcome.dispose();
        for (const s of slots.values()) s.part.dispose();
      },
    };
  },
};
