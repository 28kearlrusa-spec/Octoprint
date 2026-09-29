// Reactive store + event bus. Views subscribe to the slices they draw and never poll.

export function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) if (!deepEqual(a[k], b[k])) return false;
  return true;
}

export function createStore(initial = {}) {
  const state = initial;
  const subs = new Map(); // path -> Set<fn>
  const dirty = new Set();
  let queued = false;

  function get(path) {
    if (!path) return state;
    let cur = state;
    for (const key of path.split(".")) {
      if (cur == null) return undefined;
      cur = cur[key];
    }
    return cur;
  }

  function related(a, b) {
    return a === b || a.startsWith(b + ".") || b.startsWith(a + ".");
  }

  function flush() {
    queued = false;
    const paths = Array.from(dirty);
    dirty.clear();
    const called = new Set();
    for (const [key, set] of subs) {
      if (!paths.some((p) => related(p, key))) continue;
      for (const fn of Array.from(set)) {
        if (called.has(fn)) continue;
        called.add(fn);
        try { fn(get(key), key); } catch (e) { console.error("[store] subscriber failed for", key, e); }
      }
    }
  }

  function mark(path) {
    dirty.add(path);
    if (!queued) { queued = true; queueMicrotask(flush); }
  }

  function set(path, value) {
    const keys = path.split(".");
    const last = keys.pop();
    let cur = state;
    for (const k of keys) {
      if (cur[k] == null || typeof cur[k] !== "object") cur[k] = {};
      cur = cur[k];
    }
    cur[last] = value;
    mark(path);
    return value;
  }

  /** Like set(), but skips notifying when nothing changed. Returns true when it did change. */
  function setIfChanged(path, value) {
    if (deepEqual(get(path), value)) return false;
    set(path, value);
    return true;
  }

  /** Shallow merge into an object slice. */
  function patch(path, partial) {
    const cur = get(path);
    const next = { ...(cur || {}), ...partial };
    if (cur && deepEqual(cur, next)) return false;
    set(path, next);
    return true;
  }

  /**
   * Subscribe to a path. Fires on any change at, above or below it.
   * Pass {immediate:true} to also get the current value right away.
   */
  function on(path, fn, { immediate = false } = {}) {
    if (!subs.has(path)) subs.set(path, new Set());
    subs.get(path).add(fn);
    if (immediate) { try { fn(get(path), path); } catch (e) { console.error(e); } }
    return () => subs.get(path)?.delete(fn);
  }

  /** Subscribe to several paths with one callback; the callback runs at most once per change batch. */
  function onAny(paths, fn, opts) {
    const offs = paths.map((p) => on(p, () => run()));
    let scheduled = false;
    function run() {
      if (scheduled) return;
      scheduled = true;
      queueMicrotask(() => { scheduled = false; fn(); });
    }
    if (opts?.immediate) fn();
    return () => offs.forEach((o) => o());
  }

  return { state, get, set, setIfChanged, patch, on, onAny };
}

export function createBus() {
  const handlers = new Map();
  return {
    on(type, fn) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type).add(fn);
      return () => handlers.get(type)?.delete(fn);
    },
    emit(type, payload) {
      for (const fn of Array.from(handlers.get(type) || [])) {
        try { fn(payload); } catch (e) { console.error("[bus] handler failed for", type, e); }
      }
      for (const fn of Array.from(handlers.get("*") || [])) {
        try { fn(type, payload); } catch (e) { console.error(e); }
      }
    },
  };
}

// The one app-wide store and bus.
export const store = createStore({
  boot: {},
  auth: { ready: false, loggedIn: false, name: null, admin: false, permissions: [], session: null, groups: [] },
  net: { socket: "connecting", lastMessage: 0, clockSkew: 0, reason: null },
  server: { version: null, apiVersion: null },
  settings: null,
  profile: null,
  profiles: {},
  conn: { options: null, current: null },
  printer: { text: "Offline", flags: { operational: false, printing: false, paused: false, ready: false, error: false, closedOrError: true, cancelling: false, pausing: false, finishing: false } },
  temps: {},
  job: { file: {}, estimatedPrintTime: null, filament: null },
  progress: { completion: null, filepos: null, printTime: null, printTimeLeft: null, printTimeLeftOrigin: null },
  currentZ: null,
  offsets: {},
  busyFiles: [],
  // detected: null until we know, then true (Klipper) or false (something else)
  klipper: { detected: null, state: "unknown", message: "", macros: [], lastQgl: null, lastPid: null, lastShaper: null, lastProbe: null, mesh: null },
  config: null,
  ui: {},
  timelapse: null,
});
export const bus = createBus();
