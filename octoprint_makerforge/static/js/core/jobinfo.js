// Knows the details of the file being printed (or selected): slicer summary, thumbnail and the
// layer map that turns OctoPrint's byte position into "layer 87 of 318".
import { store, bus } from "mf/core/store.js";
import { mf, get, PLUGIN } from "mf/core/api.js";
import { can } from "mf/core/auth.js";

const metaCache = new Map();      // path|mtime -> Promise
const layerCache = new Map();

/** Slicer summary for a local file, or null when unavailable. */
export function meta(path) {
  if (!path) return Promise.resolve(null);
  if (!metaCache.has(path)) {
    const p = mf.meta(path).catch(() => null);
    metaCache.set(path, p);
    p.then((v) => { if (!v) metaCache.delete(path); });
  }
  return metaCache.get(path);
}

export function forgetMeta(path) { metaCache.delete(path); layerCache.delete(path); }

/** Layer map, polling while the server builds it. Resolves to data or null. */
export function layers(path, { timeoutMs = 90000 } = {}) {
  if (!path) return Promise.resolve(null);
  if (layerCache.has(path)) return layerCache.get(path);
  const p = (async () => {
    const t0 = Date.now();
    let wait = 700;
    while (Date.now() - t0 < timeoutMs) {
      try {
        const res = await get(`${PLUGIN}/api/layers?path=${encodeURIComponent(path)}`, { raw: true });
        if (res.status === 200) {
          const data = await res.json();
          if (data.status === "ready") return data;
          if (data.status === "error") return null;
        } else if (res.status !== 202) return null;
      } catch { return null; }
      await new Promise((r) => setTimeout(r, wait));
      wait = Math.min(wait * 1.5, 4000);
    }
    return null;
  })();
  layerCache.set(path, p);
  p.then((v) => { if (!v) layerCache.delete(path); });
  return p;
}

/** Which layer is byte position `pos` in? Returns {index, number, total, z, e} or null. */
export function layerAt(data, pos) {
  if (!data?.layers?.length || pos == null) return null;
  const L = data.layers;
  let lo = 0, hi = L.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (L[mid][1] <= pos) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  const i = Math.max(ans, 0);
  return { index: i, number: ans < 0 ? 0 : i + 1, total: L.length, z: L[i][0], e: L[i][2] };
}

/** Filament pushed so far (mm), interpolated between the layer's start and the next. */
export function filamentAt(data, pos) {
  const at = layerAt(data, pos);
  if (!at) return null;
  const L = data.layers;
  const cur = L[at.index];
  const next = L[at.index + 1];
  const endOff = next ? next[1] : data.size;
  const endE = next ? next[2] : data.filamentMm;
  const span = Math.max(1, endOff - cur[1]);
  const f = Math.min(1, Math.max(0, (pos - cur[1]) / span));
  return cur[2] + (endE - cur[2]) * f;
}

// ~~ keep store.jobinfo in step with the active file ~~
let activePath = null;
let seq = 0;

async function refresh() {
  const file = store.get("job.file") || {};
  const path = file.origin === "local" || !file.origin ? file.path : null;
  if (!path) {
    if (activePath) { activePath = null; store.set("jobinfo", null); }
    return;
  }
  const stamp = `${path}|${file.date || ""}|${file.size || ""}`;
  if (stamp === activePath) return;
  activePath = stamp;
  const my = ++seq;
  store.set("jobinfo", { path, meta: null, layers: null, loading: true });
  if (!can("files_list")) return;
  const m = await meta(path);
  if (my !== seq) return;
  store.set("jobinfo", { path, meta: m, layers: null, loading: true });
  const l = await layers(path);
  if (my !== seq) return;
  store.set("jobinfo", { path, meta: m, layers: l, loading: false });
}

export function init() {
  store.on("job", refresh);
  bus.on("event:FileSelected", () => setTimeout(refresh, 200));
  bus.on("files:changed", () => { /* a re-upload changes size/date, which refresh() notices */ });
  refresh();
}
