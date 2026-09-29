// Watches the printer's replies for Klipper-specific news: shutdowns, calibration results,
// helpful hints for common mistakes. Feeds the `klipper` slice of the store.
import { store, bus } from "mf/core/store.js";
import { recognise, parseHelp, parseMesh } from "mf/core/klipper.js";
import { capture, gcode } from "mf/core/actions.js";
import { toast } from "mf/ui/toast.js";

let helpAt = 0;
const recentHints = new Map();

function hint(id, text, kind = "warn") {
  const now = Date.now();
  if (now - (recentHints.get(id + text) || 0) < 15000) return;   // don't nag
  recentHints.set(id + text, now);
  toast({ kind, title: text, timeout: kind === "err" ? 12000 : 7000 });
}

function onLine(raw) {
  for (const hit of recognise(raw)) {
    const { id, data } = hit;
    switch (id) {
      case "klipper-ready":
        store.patch("klipper", { detected: true, state: "ready", message: "" });
        break;
      case "klipper-shutdown":
        store.patch("klipper", { detected: true, state: "shutdown", message: "Klipper has shut down." });
        break;
      case "klipper-startup":
        store.patch("klipper", { detected: true, state: "startup" });
        break;
      case "klipper-disconnect":
        store.patch("klipper", { detected: true, state: "disconnected", message: "Klipper lost the connection to the MCU." });
        break;
      case "firmware-name":
        store.patch("klipper", { detected: /klipper/i.test(data.name), firmware: data.name });
        break;
      case "qgl":
        store.patch("klipper", { lastQgl: { ...data, at: Date.now() } });
        bus.emit("klipper:qgl", data);
        break;
      case "probe-accuracy":
        store.patch("klipper", { lastProbe: { ...data, at: Date.now() } });
        bus.emit("klipper:probe", data);
        break;
      case "pid":
        store.patch("klipper", { lastPid: { ...data, at: Date.now() } });
        bus.emit("klipper:pid", data);
        break;
      case "shaper-fit":
      case "shaper-accel":
      case "shaper-pick":
        bus.emit(`klipper:${id}`, data);
        break;
      case "axes-noise":
        bus.emit("klipper:noise", data);
        break;
      case "pending-config":
        store.patch("klipper", { pendingConfig: true });
        break;
      case "mcu-lost":
        store.patch("klipper", { state: "shutdown", message: data.hint });
        hint(id, data.hint, "err");
        break;
      case "homed-needed":
      case "cold-extrude":
      case "move-range":
      case "unknown-command":
      case "timer-too-close":
      case "adc-out-of-range":
      case "heater-not-heating":
        hint(id, data.hint, id === "heater-not-heating" || id === "adc-out-of-range" ? "err" : "warn");
        break;
      default:
        break;
    }
  }
  // Klipper says "!! " for anything that stopped a move or a print
  if (/^Recv:\s*!!/.test(raw)) store.patch("klipper", { detected: true, lastError: String(raw).replace(/^Recv:\s*!!\s?/, "") });
}

/** Ask Klipper what commands and macros exist so buttons can hide what the printer doesn't have. */
export async function discover(force = false) {
  if (!force && Date.now() - helpAt < 60000) return;
  helpAt = Date.now();
  try {
    const lines = await capture("HELP", { quietMs: 1500 });
    const cmds = parseHelp(lines);
    if (cmds.size) {
      store.patch("klipper", { detected: true, commands: Object.fromEntries(cmds), macros: Array.from(cmds.keys()) });
    }
  } catch { /* offline or not Klipper: that's fine */ }
}

/** Read the current bed mesh back from Klipper. Resolves to the parsed mesh or null. */
export async function readMesh() {
  const lines = await capture("BED_MESH_OUTPUT", { quietMs: 1400, silent: true });
  const mesh = parseMesh(lines);
  if (mesh) store.patch("klipper", { mesh: { ...mesh, at: Date.now() } });
  return mesh;
}

export function hasCommand(name) {
  const cmds = store.get("klipper.commands");
  if (!cmds) return null;   // unknown: don't hide anything
  return Object.prototype.hasOwnProperty.call(cmds, name.toUpperCase());
}

// A page opened while the printer was already connected never saw the Connected event, so ask
// once: which firmware is this, and on Klipper, which commands does it have?
let probed = false;
async function probe() {
  if (probed || !store.get("printer.flags.operational")) return;
  probed = true;
  try {
    if (store.get("klipper.detected") == null) {
      // the firmware-name rule reads the reply as it goes past
      await capture("M115", { quietMs: 900, timeoutMs: 8000 });
      if (store.get("klipper.detected") == null) store.patch("klipper", { detected: false });
    }
    if (store.get("klipper.detected") && !store.get("klipper.commands")) await discover(true);
  } catch { probed = false; /* try again with the next history */ }
}

export function init() {
  bus.on("logs", (lines) => lines.forEach(onLine));
  // the log history has been read by the time this fires, and it may already have told us
  bus.on("history", () => setTimeout(probe, 1500));

  bus.on("event:Connected", () => {
    probed = true;   // the connect sequence below does the asking
    store.patch("klipper", { detected: null, state: "unknown", commands: null, macros: [], message: "" });
    setTimeout(async () => {
      try {
        await gcode("M115", { quiet: true });
        await gcode("STATUS", { quiet: true });
      } catch { /* not connected any more */ }
      setTimeout(() => discover(true), 800);
    }, 1800);
  });
  bus.on("event:Disconnected", () => {
    store.patch("klipper", { state: "unknown", commands: null, macros: [] });
    helpAt = 0;
  });
  bus.on("event:Error", (p) => {
    if (p?.error) store.patch("klipper", { lastError: p.error });
  });
}
