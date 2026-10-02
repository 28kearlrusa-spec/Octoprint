// The panels the Print page can show, and which ones each look starts with. The choice is
// saved per look in this browser, so Studio can carry everything while MakerPrint stays lean.
import { prefs } from "mf/core/prefs.js";

// wide panels want the big column; h is a rough height, used only to balance the columns
export const PANELS = [
  { id: "job", name: "Job", note: "Progress, times, the file and print controls", wide: true, h: 420 },
  { id: "camera", name: "Camera", note: "Live view, snapshot and full screen", h: 300 },
  { id: "temps", name: "Temperatures", note: "Heaters, presets and the history chart", wide: true, h: 400 },
  { id: "toolhead", name: "Toolhead", note: "Position, small moves, homing and levelling", h: 250 },
  { id: "console", name: "Console", note: "The latest printer output and a command line", wide: true, h: 330 },
  { id: "spool", name: "Spool", note: "The spool on the printer and how much is left", h: 200 },
  { id: "tune", name: "Live tuning", note: "Speed, flow, fans and Z offset during a print", h: 400 },
  { id: "macros", name: "Macros", note: "Every macro as a button", h: 320 },
  { id: "klipper", name: "Klipper", note: "State, last calibration results, restarts", h: 300 },
  { id: "system", name: "System", note: "Host, connection, storage and power", h: 300 },
  { id: "usage", name: "Usage", note: "Totals, the last two weeks and the next maintenance job", h: 260 },
  { id: "plugins", name: "Plugins", note: "Every installed plugin's sidebar panel, working as in classic OctoPrint", h: 360 },
];

export const DEFAULT_PANELS = {
  forge: ["job", "camera", "temps", "tune", "spool", "plugins"],
  studio: PANELS.map((p) => p.id),
};

const known = new Set(PANELS.map((p) => p.id));
const lookOf = (look) => (look === "studio" ? "studio" : "forge");

/** The panels to show for a look, in order. */
export function dashPanels(look = prefs.get("look")) {
  const saved = (prefs.get("dash") || {})[lookOf(look)];
  return Array.isArray(saved) ? saved.filter((id) => known.has(id)) : DEFAULT_PANELS[lookOf(look)].slice();
}

export function setDashPanels(look, ids) {
  prefs.set("dash", { ...(prefs.get("dash") || {}), [lookOf(look)]: ids.filter((id) => known.has(id)) });
}

export function resetDashPanels(look) {
  const all = { ...(prefs.get("dash") || {}) };
  delete all[lookOf(look)];
  prefs.set("dash", all);
}

export const isCustom = (look) => Array.isArray((prefs.get("dash") || {})[lookOf(look)]);

const GAP = 16;
const size = (id) => (PANELS.find((p) => p.id === id)?.h ?? 300) + GAP;
const wide = (id) => !!PANELS.find((p) => p.id === id)?.wide;

/**
 * Split panels into n columns. Wide panels go in the first (widest) column, the others fill
 * whichever column is shortest; with two columns a long right side gives its last panels to
 * the left. Order within each column follows the chosen order.
 */
export function distribute(ids, n) {
  if (n <= 1 || ids.length < 2) return [ids.slice()];
  const cols = Array.from({ length: n }, () => ({ list: [], h: 0 }));
  const add = (c, id) => { c.list.push(id); c.h += size(id); };
  const big = ids.filter(wide), small = ids.filter((id) => !wide(id));
  big.forEach((id) => add(cols[0], id));
  const pool = big.length ? cols.slice(1) : cols;
  for (const id of small) add(pool.reduce((a, b) => (b.h < a.h ? b : a)), id);
  if (n === 2 && big.length && cols[1].list.length > 1) {
    const right = cols[1].list;
    let best = 0, bestDiff = Math.abs(cols[0].h - cols[1].h);
    for (let k = 1; k < right.length; k++) {
      const moved = right.slice(right.length - k).reduce((a, id) => a + size(id), 0);
      const diff = Math.abs(cols[0].h + moved - (cols[1].h - moved));
      if (diff < bestDiff) { bestDiff = diff; best = k; }
    }
    if (best) cols[0].list.push(...right.splice(right.length - best));
  }
  return cols.map((c) => c.list).filter((list) => list.length);
}
