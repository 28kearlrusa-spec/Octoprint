// Per-browser preferences (theme, density, terminal filters ...). Stored in localStorage;
// everything still works when storage is blocked.

const KEY = "mf.prefs.v1";
const DEFAULTS = {
  theme: "forge",
  density: "comfortable",
  motion: "auto",          // auto | reduced
  sound: true,             // chime when a print finishes or needs attention
  tabTitle: true,          // show progress in the browser tab title
  jogStepXY: 10,
  jogStepZ: 1,
  extrudeLength: 5,
  extrudeSpeed: 300,
  termAutoscroll: true,
  termHideTemps: true,
  termHideOk: false,
  camOpen: true,
  camMode: "camera",       // camera | machine | toolpath on the dashboard stage
  filesView: "grid",       // grid | list
  filesSort: "date-desc",
  chartWindow: 600,        // seconds of history on the temperature chart
  chartHidden: [],
  reduceHeavy: false,      // skip the 3D previews on very slow devices
  kioskDim: true,
};

let cache = null;
const subs = new Set();

function read() {
  if (cache) return cache;
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch { /* blocked or corrupt */ }
  cache = { ...DEFAULTS, ...saved };
  return cache;
}

function persist() {
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* storage blocked: keep in memory */ }
}

export const prefs = {
  defaults: DEFAULTS,
  get(key) { return read()[key]; },
  all() { return { ...read() }; },
  set(key, value) {
    const p = read();
    if (JSON.stringify(p[key]) === JSON.stringify(value)) return;
    p[key] = value;
    persist();
    apply();
    for (const fn of subs) fn(key, value);
  },
  reset() { cache = { ...DEFAULTS }; persist(); apply(); for (const fn of subs) fn("*", null); },
  on(fn) { subs.add(fn); return () => subs.delete(fn); },
};

export const THEMES = [
  { id: "forge", name: "MakerPrint", note: "Green and pink from the logo", swatch: ["#86d929", "#e951b0"] },
  { id: "voron", name: "Voron", note: "Red and orange on graphite", swatch: ["#e4412f", "#f08a3a"] },
  { id: "ice", name: "Ice", note: "Blue with violet", swatch: ["#52b8e6", "#9a86ea"] },
  { id: "amber", name: "Amber", note: "Amber with orange", swatch: ["#e9a53a", "#ec6d3a"] },
];

/** Push preferences onto <html>. Cheap to call repeatedly. */
export function apply() {
  const p = read();
  const root = document.documentElement;
  root.dataset.theme = THEMES.some((t) => t.id === p.theme) ? p.theme : "forge";
  root.dataset.density = p.density === "compact" ? "compact" : "comfortable";
  root.dataset.motion = p.motion === "reduced" ? "reduced" : "auto";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = "#17181b";
}

apply();
