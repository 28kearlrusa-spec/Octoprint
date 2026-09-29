// The dashboard stage's "Toolpath" tab: the file being printed, with live progress on it.
import { html } from "mf/core/dom.js";
import { store } from "mf/core/store.js";
import { createViewer } from "mf/ui/viewer/viewer-ui.js";

export function mountToolpath(host) {
  const wrap = html`<div style="position:absolute;inset:0" hidden></div>`;
  host.append(wrap);
  let viewer = null;
  let loadedFor = null;

  function ensure() {
    const file = store.get("job.file");
    const path = file?.origin === "local" || !file?.origin ? file?.path : null;
    if (!path) {
      viewer?.dispose(); viewer = null; loadedFor = null;
      wrap.innerHTML = `<div class="stage-offline"><div class="big">Nothing to preview</div><p>Select a file on the Files screen and its toolpath shows up here, with live progress once it prints.</p></div>`;
      return;
    }
    const stamp = `${path}|${file.date}|${file.size}`;
    if (stamp === loadedFor && viewer) return;
    loadedFor = stamp;
    viewer?.dispose();
    wrap.replaceChildren();
    viewer = createViewer(wrap, { path, size: file.size, live: true });
    viewer.load();
  }
  const off = store.on("job", () => { if (!wrap.hidden) ensure(); });

  return {
    show() { wrap.hidden = false; ensure(); },
    hide() { wrap.hidden = true; },
    dispose() { off(); viewer?.dispose(); wrap.remove(); },
  };
}
