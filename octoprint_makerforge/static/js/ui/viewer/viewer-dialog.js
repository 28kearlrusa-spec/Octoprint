// Opens the toolpath preview for a file in a large dialog.
import { openDialog } from "mf/ui/dialog.js";
import { createViewer } from "mf/ui/viewer/viewer-ui.js";
import { html } from "mf/core/dom.js";
import { stripExt, bytes } from "mf/core/format.js";

export function openToolpath(file) {
  const host = html`<div></div>`;
  let viewer = null;
  const dlg = openDialog({
    title: `${stripExt(file.display || file.name)}  ·  ${bytes(file.size)}`,
    body: host, full: true, className: "viewer-dialog",
    buttons: [{ label: "Close", kind: "primary" }],
  });
  viewer = createViewer(host, { path: file.path, size: file.size });
  requestAnimationFrame(() => viewer.load());
  dlg.closed.then(() => viewer.dispose());
}
