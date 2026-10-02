// Filament spools, kept by the plugin (or in Spoolman). The printer's computer takes the
// filament each print used off the active spool when it ends.
import { store, bus } from "mf/core/store.js";
import { get, post, del, PLUGIN } from "mf/core/api.js";

let loading = null;

export function loadSpools({ fresh = false } = {}) {
  if (!loading || fresh) {
    loading = get(`${PLUGIN}/api/spools`)
      .then((d) => { store.set("spools", d); return d; })
      .catch(() => { store.set("spools", { mode: "unavailable", spools: [], active: null }); return null; })
      .finally(() => { setTimeout(() => { loading = null; }, 500); });
  }
  return loading;
}

export const activeSpool = (d = store.get("spools")) => d?.spools?.find((s) => String(s.id) === String(d.active)) || null;
export const saveSpool = (spool) => post(`${PLUGIN}/api/spools`, spool).then(async (r) => { await loadSpools({ fresh: true }); return r; });
export const deleteSpool = (id) => del(`${PLUGIN}/api/spools/${encodeURIComponent(id)}`).then(() => loadSpools({ fresh: true }));
export const setActiveSpool = (id) => post(`${PLUGIN}/api/spools/active`, { id }).then(() => loadSpools({ fresh: true }));

let wired = false;
export function initSpools() {
  if (wired) return;
  wired = true;
  bus.on("plugin:makerforge", (m) => { if (m?.type === "spools") loadSpools(); });
  for (const e of ["PrintDone", "PrintFailed", "PrintCancelled"]) bus.on(`event:${e}`, () => setTimeout(loadSpools, 2000));
}
