// Where is the toolhead? OctoPrint parses M114 replies and announces them as PositionUpdate
// events; we ask for one when the printer is idle and after moves we caused ourselves.
import { store, bus } from "mf/core/store.js";
import { gcode } from "mf/core/actions.js";
import { isIdle } from "mf/core/status.js";

let timer = null;

export function init() {
  bus.on("event:PositionUpdate", (p) => {
    if (p && typeof p.x === "number") {
      store.set("position", { x: p.x, y: p.y, z: p.z, e: p.e, at: Date.now() });
    }
  });
  // right after a print ends or the printer connects, the old position is meaningless
  bus.on("event:Connected", () => store.set("position", null));
}

/** Ask the printer where it is. Skipped while printing unless forced (it adds serial chatter).
 *  The query and its reply stay out of the terminal (see POSITION_POLL in telemetry.js). */
export function refresh({ force = false } = {}) {
  if (!force && !isIdle()) return Promise.resolve(null);
  return gcode("M114", { quiet: true }).catch(() => null);
}

/** Debounced "the head probably moved, look again" for after jogs and homing. */
export function refreshSoon(ms = 900) {
  clearTimeout(timer);
  timer = setTimeout(() => refresh(), ms);
}

/** Convert a machine coordinate to a position on the bed (0,0 at the front-left corner). */
export function toBed(pos, profile) {
  const v = profile?.volume || {};
  if (v.origin === "center") return { x: pos.x + (v.width || 0) / 2, y: pos.y + (v.depth || 0) / 2 };
  return { x: pos.x, y: pos.y };
}
