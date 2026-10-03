// Per-browser preferences (theme, density, terminal filters ...). Stored in localStorage;
// everything still works when storage is blocked.

const KEY = "mf.prefs.v1";
const DEFAULTS = {
  look: "forge",           // forge: the MakerPrint look | studio: light, with every panel on Print
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
  camName: "",             // which camera, when OctoPrint has more than one
  camPip: false,           // a small camera view on every screen
  camMode: "camera",       // camera | machine | toolpath on the dashboard stage
  filesView: "grid",       // grid | list
  filesSort: "date-desc",
  chartWindow: 600,        // seconds of history on the temperature chart
  chartHidden: [],
  reduceHeavy: false,      // skip the 3D previews on very slow devices
  kioskDim: true,
  claude: "off",           // off | code | chat: a Claude button in the rail, this browser only
  dash: {},                // per look: the Print page panels in order, when changed from the default
  clock: "auto",           // auto | 12 | 24
  posPoll: 5,              // seconds between position reads on the Toolhead panel, 0 = only on demand
  holdMs: 1000,            // how long Cancel print has to be held
  consoleLines: 12,        // lines shown by the Console panel on Print
  consolePrintGcode: false, // show the file's streamed G-code in the Console during a print
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

export const LOOKS = [
  { id: "forge", name: "MakerPrint", note: "Graphite with the logo colours, and the essentials on the Print page." },
  { id: "studio", name: "Studio", note: "White, black and grey, a top navigation bar, and every panel on the Print page." },
];

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
  const studio = p.look === "studio";
  root.dataset.look = studio ? "studio" : "forge";
  root.dataset.theme = THEMES.some((t) => t.id === p.theme) ? p.theme : "forge";
  root.dataset.density = p.density === "compact" ? "compact" : "comfortable";
  root.dataset.motion = p.motion === "reduced" ? "reduced" : "auto";
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = studio ? "#ffffff" : "#17181b";
  const scheme = document.querySelector('meta[name="color-scheme"]');
  if (scheme) scheme.content = studio ? "light" : "dark";
}

apply();
