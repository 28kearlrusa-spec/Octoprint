// Print: the main screen. The job, the camera, temperatures and live tuning, on one page.
import { html } from "mf/core/dom.js";
import { mountJob } from "mf/ui/panels/job.js";
import { mountCamera } from "mf/ui/panels/camera.js";
import { mountTemps } from "mf/ui/panels/temps.js";
import { mountQuickTune } from "mf/ui/panels/quicktune.js";
import { mountWelcome } from "mf/ui/panels/welcome.js";

export default {
  id: "print",
  mount(el) {
    const top = html`<div class="dash-top"></div>`;
    // two columns that grow independently, so no panel is stretched to match its neighbour
    const main = html`<div class="dash-col"></div>`;
    const side = html`<div class="dash-col"></div>`;
    const grid = html`<div class="dash"></div>`;
    grid.append(main, side);
    el.append(top, grid);
    const parts = [
      mountWelcome(top),
      mountJob(main),
      mountTemps(main),
      mountCamera(side),
      mountQuickTune(side),
    ];
    return { unmount() { parts.forEach((p) => p.dispose()); } };
  },
};
