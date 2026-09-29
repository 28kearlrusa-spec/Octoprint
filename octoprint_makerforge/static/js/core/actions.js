// Things the UI can make the printer do. Each returns a promise and reports failures itself,
// so a button handler is usually just `actions.home()`.
import { store, bus } from "mf/core/store.js";
import { octo, ApiError } from "mf/core/api.js";
import { can } from "mf/core/auth.js";
import { config } from "mf/core/config.js";
import { term } from "mf/core/telemetry.js";
import { toast } from "mf/ui/toast.js";
import { KLIPPER_HOT_MIN } from "mf/core/defaults.js";
import { isPrinting } from "mf/core/status.js";

async function guard(label, fn, { need = "control", quiet = false } = {}) {
  if (need && !can(need)) {
    toast.warn("Not allowed", `Your account doesn't have the “${need}” permission.`);
    return null;
  }
  try {
    return await fn();
  } catch (e) {
    if (!quiet) toast.fail(label, e instanceof ApiError && e.status === 409 ? new Error("The printer isn't ready for that right now.") : e);
    throw e;
  }
}

export const isKlipper = () => store.get("klipper.detected") !== false;

/** Send one or more lines of G-code. Multi-line strings are split. */
export function gcode(input, opts) {
  const lines = (Array.isArray(input) ? input : String(input).split(/\r?\n/))
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith(";"));
  if (!lines.length) return Promise.resolve(null);
  return guard("Command failed", () => octo.command(lines), opts);
}

export const home = (axes) => {
  const a = (axes || ["x", "y", "z"]).map((x) => x.toUpperCase());
  return gcode(`G28${a.length === 3 ? "" : " " + a.join(" ")}`);
};

export function jog({ x = 0, y = 0, z = 0, speed } = {}) {
  const body = { command: "jog", absolute: false };
  if (x) body.x = x;
  if (y) body.y = y;
  if (z) body.z = z;
  if (speed) body.speed = speed;
  return guard("Move failed", () => octo.printhead(body));
}

export function moveTo({ x, y, z, speed = 6000 }) {
  const parts = ["G90", "G1"];
  if (x != null) parts[1] += ` X${x.toFixed(2)}`;
  if (y != null) parts[1] += ` Y${y.toFixed(2)}`;
  if (z != null) parts[1] += ` Z${z.toFixed(2)}`;
  parts[1] += ` F${speed}`;
  return gcode(parts);
}

export function setTemp(which, target) {
  target = Math.max(0, Math.round(Number(target) || 0));
  return guard("Couldn't set temperature", async () => {
    if (which === "bed") return octo.bed({ command: "target", target });
    if (which === "chamber") {
      const heated = store.get("profile")?.heatedChamber;
      return heated ? octo.chamber({ command: "target", target }) : octo.command(`M141 S${target}`);
    }
    return octo.tool({ command: "target", targets: { [which]: target } });
  });
}

export function preheat(preset) {
  return guard("Preheat failed", async () => {
    const profile = store.get("profile");
    await octo.tool({ command: "target", targets: { tool0: preset.nozzle } });
    if (profile?.heatedBed !== false) await octo.bed({ command: "target", target: preset.bed });
    if (preset.chamber > 0) await setTemp("chamber", preset.chamber);
    toast.ok(`Heating for ${preset.name}`, `Nozzle ${preset.nozzle}°  Bed ${preset.bed}°${preset.chamber ? `  Chamber ${preset.chamber}°` : ""}`);
  });
}

export function cooldown() {
  return guard("Cooldown failed", async () => {
    const names = Object.keys(store.get("temps") || {});
    const targets = {};
    for (const n of names) if (/^tool\d+$/.test(n)) targets[n] = 0;
    if (Object.keys(targets).length) await octo.tool({ command: "target", targets });
    if (names.includes("bed")) await octo.bed({ command: "target", target: 0 });
    if (names.includes("chamber")) await setTemp("chamber", 0);
    toast.info("Heaters off");
  });
}

export function extrude(mm, speedMmMin = 300) {
  const t = store.get("temps.tool0")?.actual;
  if (t != null && t < KLIPPER_HOT_MIN) {
    toast.warn("Nozzle is too cold", `It's ${Math.round(t)}°. Heat to at least ${KLIPPER_HOT_MIN}° first.`);
    return Promise.resolve(null);
  }
  return guard("Extrude failed", () => octo.tool({ command: "extrude", amount: mm, speed: speedMmMin }));
}

export const feedrate = (pct) => guard("Couldn't change speed", () => octo.printhead({ command: "feedrate", factor: pct / 100 }));
export const flowrate = (pct) => guard("Couldn't change flow", () => octo.tool({ command: "flowrate", factor: pct / 100 }));

export function partFan(pct) {
  const s = Math.round((Math.max(0, Math.min(100, pct)) / 100) * 255);
  return gcode(s === 0 ? "M107" : `M106 S${s}`);
}

export function genericFan(name, pct) {
  return gcode(`SET_FAN_SPEED FAN=${name} SPEED=${(Math.max(0, Math.min(100, pct)) / 100).toFixed(2)}`);
}

/** Baby-step the live Z offset. Klipper: SET_GCODE_OFFSET; Marlin: M290. */
export function babyStepZ(delta) {
  const d = Number(delta.toFixed(3));
  return isKlipper() ? gcode(`SET_GCODE_OFFSET Z_ADJUST=${d} MOVE=1`) : gcode(`M290 Z${d}`);
}

export const startPrint = (path) => guard("Couldn't start the print", () => octo.select(path, true), { need: "print" });
export const selectFile = (path) => guard("Couldn't select the file", () => octo.select(path, false), { need: "files_select" });
export const pausePrint = () => guard("Couldn't pause", () => octo.jobCommand("pause", "pause"), { need: "print" });
export const resumePrint = () => guard("Couldn't resume", () => octo.jobCommand("pause", "resume"), { need: "print" });
export const cancelPrint = () => guard("Couldn't cancel", () => octo.jobCommand("cancel"), { need: "print" });
export const restartPrint = () => guard("Couldn't restart", () => octo.jobCommand("restart"), { need: "print" });

export function emergencyStop() {
  return guard("Emergency stop failed", async () => {
    // M112 goes out first and alone: nothing may queue ahead of it
    await octo.command("M112");
    toast.warn("Emergency stop sent", "The printer is halted. Restart the firmware to use it again.", { timeout: 0 });
  });
}

// Restarting Klipper usually drops OctoPrint's serial link. Watch for that and reconnect for the user.
let reconnectWatch = null;
export function watchReconnect(ms = 60000) {
  const until = Date.now() + ms;
  let announced = false;
  clearInterval(reconnectWatch);
  reconnectWatch = setInterval(async () => {
    const f = store.get("printer.flags");
    const text = store.get("printer.text") || "";
    if (f.operational) {
      clearInterval(reconnectWatch);
      if (announced) toast.ok("Reconnected", "The printer is back.");
      return;
    }
    if (Date.now() > until) { clearInterval(reconnectWatch); toast.warn("Couldn't reconnect on its own", "Use Connect in the top bar once Klipper is ready."); return; }
    if (f.closedOrError && !/connecting|opening|detecting/i.test(text)) {
      announced = true;
      const o = store.get("conn.options") || {};
      try { await octo.connect({ port: o.portPreference || undefined, baudrate: o.baudratePreference || undefined, printerProfile: o.printerProfilePreference || undefined }); } catch { /* try again on the next tick */ }
    }
  }, 4000);
}

export const firmwareRestart = () => gcode("FIRMWARE_RESTART").then((r) => { watchReconnect(); return r; });
export const klipperRestart = () => gcode("RESTART").then((r) => { watchReconnect(); return r; });

export const connectPrinter = (opts) => guard("Couldn't connect", () => octo.connect(opts), { need: "connection" });
export const disconnectPrinter = () => guard("Couldn't disconnect", () => octo.disconnect(), { need: "connection" });

// ~~ macros ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
/** Fill {placeholders} in macro G-code from config and any extra values. */
export function expandMacro(text, extra = {}) {
  const c = config.data;
  const vars = { safeZ: c.safeZ ?? 30, parkX: c.parkXY?.[0] ?? 10, parkY: c.parkXY?.[1] ?? 10, ...extra };
  return String(text).replace(/\{(\w+)(?:\|([^}]*))?\}/g, (m, k, dflt) => (vars[k] ?? dflt ?? m));
}

/** Names in {name|default} form that still need a value from the user. */
export function macroParams(text) {
  const c = config.data;
  const known = new Set(["safeZ", "parkX", "parkY"]);
  const out = [];
  for (const m of String(text).matchAll(/\{(\w+)(?:\|([^}]*))?\}/g)) {
    if (known.has(m[1]) && m[2] == null) continue;
    if (!out.some((p) => p.name === m[1])) out.push({ name: m[1], default: m[2] ?? "" });
  }
  return out;
}

/**
 * Run a command and collect the printer's reply until it goes quiet.
 * Used for HELP, BED_MESH_OUTPUT and other "ask and read back" commands.
 */
export function capture(command, { quietMs = 1200, timeoutMs = 20000, silent = true } = {}) {
  return new Promise((resolve, reject) => {
    const lines = [];
    let quiet = null, hard = null;
    const finish = () => {
      clearTimeout(quiet); clearTimeout(hard);
      off();
      term.silent = false;
      resolve(lines);
    };
    const off = bus.on("logs", (batch) => {
      for (const l of batch) if (/^Recv:\s*(\/\/|!!)/.test(l) || /^Recv:\s*\S/.test(l) && !/^Recv:\s*(ok\b|.*\bT:\d)/.test(l)) lines.push(l);
      clearTimeout(quiet);
      quiet = setTimeout(finish, quietMs);
    });
    if (silent) term.silent = true;
    hard = setTimeout(finish, timeoutMs);
    gcode(command, { quiet: true }).then(() => {
      clearTimeout(quiet);
      quiet = setTimeout(finish, Math.max(quietMs, 2500));   // nothing back yet: give it a moment
    }).catch((e) => { clearTimeout(quiet); clearTimeout(hard); off(); term.silent = false; reject(e); });
  });
}

export { isPrinting };
