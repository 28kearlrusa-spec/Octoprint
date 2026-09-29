// Turns OctoPrint's raw flags, heater temperatures and Klipper state into one clear machine
// status that the LED, the top bar, the schematic and the kiosk all agree on.
import { store } from "mf/core/store.js";

export const TOL = 3;   // degrees within target that still count as "at temperature"

/** A heater's state relative to its target. */
export function heater(name, s = store.state) {
  const t = s.temps?.[name];
  if (!t || t.actual == null) return { present: false, actual: null, target: null, state: "off" };
  const actual = t.actual, target = t.target || 0;
  let state = "off";
  if (target > 0) state = Math.abs(actual - target) <= TOL ? "stable" : actual < target ? "heating" : "cooling";
  else if (actual > 45) state = "cooling";
  return { present: true, actual, target, state };
}

export function heaterNames(s = store.state) {
  return Object.keys(s.temps || {}).filter((k) => /^(tool\d+|bed|chamber)$/.test(k));
}

export function machineStatus(s = store.state) {
  const f = s.printer?.flags || {};
  const text = s.printer?.text || "";
  const net = s.net || {};

  if (net.socket === "down" && Date.now() - (net.lastMessage || 0) > 8000) {
    return { key: "unreachable", label: "OctoPrint unreachable", tone: "err", detail: net.reason || "Trying to reconnect…", active: false };
  }
  if (s.klipper?.state === "shutdown") {
    return { key: "shutdown", label: "Klipper shutdown", tone: "err", detail: s.klipper.message || "Fix the cause, then restart Klipper.", active: false };
  }
  if (/connecting|opening serial|detecting serial|detecting baud/i.test(text)) {
    return { key: "connecting", label: "Connecting…", tone: "info", detail: text, active: false };
  }
  if (f.error || /^error|after error/i.test(text)) {
    return { key: "error", label: "Printer error", tone: "err", detail: s.printer?.error || text, active: false };
  }
  if (f.closedOrError || !f.operational) {
    return { key: "offline", label: "Printer offline", tone: "off", detail: "Not connected to the printer.", active: false };
  }
  if (f.cancelling) return { key: "cancelling", label: "Cancelling", tone: "warn", detail: "Stopping the print…", active: true };
  if (f.pausing) return { key: "pausing", label: "Pausing", tone: "warn", detail: "Finishing the current move…", active: true };
  if (f.paused) return { key: "paused", label: "Paused", tone: "warn", detail: "Print is on hold.", active: true };
  if (f.finishing) return { key: "finishing", label: "Finishing", tone: "busy", detail: "Wrapping up.", active: true };

  const hot = heaterNames(s).map((n) => heater(n, s));
  const warming = hot.some((h) => h.state === "heating");

  if (f.printing) {
    const early = (s.progress?.completion ?? 0) < 0.5 && (s.progress?.printTime ?? 0) < 600;
    if (early && warming) return { key: "heating", label: "Heating for print", tone: "busy", detail: "Waiting for temperatures.", active: true };
    return { key: "printing", label: "Printing", tone: "busy", detail: "", active: true };
  }
  if (warming) return { key: "heating", label: "Heating", tone: "busy", detail: "", active: false };
  return { key: "ready", label: "Ready", tone: "ok", detail: "", active: false };
}

/** 0..1 or null */
export function progressFrac(s = store.state) {
  const c = s.progress?.completion;
  return typeof c === "number" ? Math.max(0, Math.min(1, c / 100)) : null;
}

/** Seconds left: OctoPrint's own figure, else the slicer estimate minus elapsed. */
export function timeLeft(s = store.state) {
  const p = s.progress || {};
  if (typeof p.printTimeLeft === "number") return p.printTimeLeft;
  const est = s.job?.estimatedPrintTime;
  if (typeof est === "number" && typeof p.printTime === "number") return Math.max(0, est - p.printTime);
  return null;
}

export const isPrinting = (s = store.state) => !!(s.printer?.flags?.printing || s.printer?.flags?.paused || s.printer?.flags?.pausing || s.printer?.flags?.cancelling);
export const isOperational = (s = store.state) => !!s.printer?.flags?.operational;
export const isIdle = (s = store.state) => isOperational(s) && !isPrinting(s);
