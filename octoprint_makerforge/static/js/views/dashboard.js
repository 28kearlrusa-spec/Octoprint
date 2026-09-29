// Print: the main screen. Everything you want while a print runs, on one page.
import { html, refs } from "mf/core/dom.js";
import { mountStage } from "mf/ui/panels/stage.js";
import { mountJob } from "mf/ui/panels/job.js";
import { mountCamera } from "mf/ui/panels/camera.js";
import { mountTemps } from "mf/ui/panels/temps.js";
import { mountChart } from "mf/ui/panels/chartpanel.js";
import { mountQuickTune } from "mf/ui/panels/quicktune.js";
import { mountWelcome } from "mf/ui/panels/welcome.js";
import { refresh as refreshPosition } from "mf/core/position.js";
import { store } from "mf/core/store.js";

export default {
  id: "print",
  mount(el) {
    const top = html`<div class="dash-top"></div>`;
    const grid = html`<div class="dash"></div>`;
    el.append(top, grid);
    const parts = [
      mountWelcome(top),
      mountStage(grid),
      mountJob(grid),
      mountCamera(grid),
      mountTemps(grid),
      mountChart(grid),
      mountQuickTune(grid),
    ];
    // learn where the head is once we're looking at the machine, and again when it goes idle
    const f = () => { if (store.get("printer.flags.operational")) refreshPosition(); };
    f();
    const off = store.on("printer", (() => {
      let was = store.get("printer.flags.operational");
      return () => { const now = store.get("printer.flags.operational"); if (now && !was) setTimeout(f, 1200); was = now; };
    })());
    // While printing, ask where the head is every few seconds so the schematic can follow it.
    // The replies are hidden from the terminal and cost the printer nothing measurable.
    const follow = setInterval(() => {
      if (document.hidden || !store.get("printer.flags.printing")) return;
      refreshPosition({ force: true });
    }, 2500);
    return { unmount() { off(); clearInterval(follow); parts.forEach((p) => p.dispose()); } };
  },
};
