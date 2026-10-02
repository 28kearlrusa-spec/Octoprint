// The print queue: files waiting their turn, shared by everyone who uses the printer (it lives in
// the shared config). Nothing starts on its own: the next print needs someone to confirm the bed is clear.
import { config } from "mf/core/config.js";
import { uid } from "mf/core/dom.js";

export const queue = () => (config.data.queue || []).slice();

export function addToQueue(files) {
  return config.update((d) => {
    d.queue = d.queue || [];
    for (const f of files) d.queue.push({ id: uid(6), path: f.path, name: f.display || f.name || f.path.split("/").pop(), addedAt: Math.floor(Date.now() / 1000) });
    d.queue = d.queue.slice(-100);
  });
}

export const removeFromQueue = (id) => config.update((d) => { d.queue = (d.queue || []).filter((q) => q.id !== id); });
export const clearQueue = () => config.update((d) => { d.queue = []; });

export function moveInQueue(id, by) {
  return config.update((d) => {
    const q = d.queue || [];
    const i = q.findIndex((x) => x.id === id), j = i + by;
    if (i < 0 || j < 0 || j >= q.length) return;
    [q[i], q[j]] = [q[j], q[i]];
  });
}

/** Start the first file in the queue, after the person confirms the bed is clear. */
export async function startNext() {
  const next = queue()[0];
  if (!next) return false;
  const { startWithChecks } = await import("mf/ui/panels/job.js");
  const started = await startWithChecks(next.path, { bedClear: true });
  if (started) await removeFromQueue(next.id);
  return started;
}
