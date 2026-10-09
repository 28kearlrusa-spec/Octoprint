// Machine setups: the buttons, temperatures and reminders that suit a particular printer and
// its Klipper config, applied in one go from Settings > Printer.
import { config } from "mf/core/config.js";
import { DEFAULT_CONFIG } from "mf/core/defaults.js";
import { hasCommand } from "mf/core/klipper-watch.js";
import { store } from "mf/core/store.js";

const clone = (v) => JSON.parse(JSON.stringify(v));

// The Ender 3 NG on the stock Creality 4.2.2 board, with the config in this repository's
// klipper/ folder. Every macro here exists in that config; `needs` hides a button anywhere else.
const E3NG = {
  printerName: "E3NG",
  kinematics: "bed-z",
  safeZ: 10,
  parkXY: [220, 230],
  filament: { diameter: 1.75, density: 1.24, costPerKg: 20 },
  preflight: {
    enabled: true,
    items: ["The CryoGrip plate is on and clean", "Filament is loaded and dry", "Nothing is in the way of the bed or the gantry"],
  },
  // the stock hotend has a PTFE liner, so nothing above 240
  presets: [
    { id: "pla", name: "PLA", nozzle: 210, bed: 60, chamber: 0 },
    { id: "petg", name: "PETG", nozzle: 235, bed: 75, chamber: 0 },
    { id: "tpu", name: "TPU", nozzle: 225, bed: 45, chamber: 0 },
    { id: "abs", name: "ABS", nozzle: 240, bed: 100, chamber: 0 },
    { id: "asa", name: "ASA", nozzle: 240, bed: 100, chamber: 0 },
  ],
  macros: [
    { id: "home", name: "Home all", icon: "home", cat: "Motion", gcode: "G28" },
    { id: "home-xy", name: "Home XY", icon: "home", cat: "Motion", gcode: "G28 X Y" },
    { id: "park", name: "Park", icon: "home", cat: "Motion", gcode: "PARK", needs: "PARK" },
    { id: "center", name: "Centre", icon: "target", cat: "Motion", gcode: "CENTER", needs: "CENTER" },
    { id: "motors-off", name: "Motors off", icon: "power", cat: "Motion", gcode: "M84" },

    { id: "mode-quiet", name: "Quiet mode", icon: "moon", cat: "Print mode", gcode: "PRINT_MODE MODE=quiet", needs: "PRINT_MODE", duringPrint: true },
    { id: "mode-normal", name: "Normal mode", icon: "gauge", cat: "Print mode", gcode: "PRINT_MODE MODE=normal", needs: "PRINT_MODE", duringPrint: true },
    { id: "mode-fast", name: "Fast mode", icon: "bolt", cat: "Print mode", gcode: "PRINT_MODE MODE=fast", needs: "PRINT_MODE", duringPrint: true },

    { id: "load", name: "Load filament", icon: "spool", cat: "Filament", gcode: "LOAD_FILAMENT TEMP={temp|220}", needs: "LOAD_FILAMENT" },
    { id: "unload", name: "Unload filament", icon: "eject", cat: "Filament", gcode: "UNLOAD_FILAMENT TEMP={temp|220}", needs: "UNLOAD_FILAMENT" },
    { id: "m600", name: "Change filament", icon: "swap", cat: "Filament", gcode: "M600", needs: "M600", duringPrint: true, confirm: "Pauses the print, parks and unloads, then asks for the new filament." },
    { id: "purge", name: "Purge line", icon: "nozzle", cat: "Filament", gcode: "CLEAN_NOZZLE", needs: "CLEAN_NOZZLE", requires: "hot" },

    { id: "mesh", name: "Bed mesh", icon: "mesh", cat: "Levelling", gcode: "MESH_FULL BED={bed|60}", needs: "MESH_FULL", confirm: "Heats the bed and probes 49 points. Takes a few minutes." },
    { id: "mesh-clear", name: "Clear mesh", icon: "mesh", cat: "Levelling", gcode: "BED_MESH_CLEAR", needs: "BED_MESH_CLEAR" },
    { id: "screws", name: "Bed screws", icon: "wrench", cat: "Levelling", gcode: "BED_SCREWS", needs: "BED_SCREWS" },
    { id: "zoffset", name: "Z offset (paper test)", icon: "zoffset", cat: "Levelling", gcode: "PROBE_Z_OFFSET", needs: "PROBE_Z_OFFSET" },

    { id: "wizard", name: "Calibration wizard", icon: "list-checks", cat: "Calibrate", gcode: "CALIBRATION_WIZARD", needs: "CALIBRATION_WIZARD" },
    { id: "pid-hotend", name: "PID hotend", icon: "flame", cat: "Calibrate", gcode: "PID_HOTEND TEMP={temp|220}", needs: "PID_HOTEND" },
    { id: "pid-bed", name: "PID bed", icon: "bed", cat: "Calibrate", gcode: "PID_BED TEMP={temp|60}", needs: "PID_BED" },
    { id: "probe-check", name: "Probe accuracy", icon: "probe", cat: "Calibrate", gcode: "PROBE_CHECK", needs: "PROBE_CHECK" },
    { id: "shaper", name: "Input shaper", icon: "shaper", cat: "Calibrate", gcode: "INPUT_SHAPER_AUTO", needs: "INPUT_SHAPER_AUTO", confirm: "Shakes the printer with the ADXL345 on the toolhead. Takes about 3 minutes and is loud." },
    { id: "extruder", name: "Extruder steps", icon: "extruder", cat: "Calibrate", gcode: "EXTRUDER_CALIBRATE TEMP={temp|215}", needs: "EXTRUDER_CALIBRATE", confirm: "Mark the filament 120 mm above the extruder first." },
    { id: "speed", name: "Speed test", icon: "gauge", cat: "Calibrate", gcode: "SPEED_TEST SPEED={speed|300} ACCEL={accel|6000}", needs: "SPEED_TEST", confirm: "Runs the head fast in diagonals, then re-homes to check for skipped steps." },
    { id: "directions", name: "Motor directions", icon: "compass", cat: "Calibrate", gcode: "DIRECTION_TEST", needs: "DIRECTION_TEST", confirm: "Moves without homing. Put the head in the middle first." },

    { id: "fw-restart", name: "Firmware restart", icon: "refresh", cat: "Klipper", gcode: "FIRMWARE_RESTART", confirm: "Restarts the MCU and Klipper. Any running print is lost." },
    { id: "restart", name: "Restart Klipper", icon: "refresh", cat: "Klipper", gcode: "RESTART", confirm: "Reloads printer.cfg. Any running print is lost." },
    { id: "save-config", name: "Save config", icon: "save", cat: "Klipper", gcode: "SAVE_CONFIG", confirm: "Writes the pending calibration to printer.cfg and restarts Klipper." },
    { id: "status", name: "Klipper status", icon: "info", cat: "Klipper", gcode: "STATUS" },
    { id: "endstops", name: "Query endstops", icon: "target", cat: "Klipper", gcode: "QUERY_ENDSTOPS" },
    { id: "position", name: "Get position", icon: "compass", cat: "Klipper", gcode: "GET_POSITION" },
  ],
  fans: [{ id: "part", name: "Part cooling", type: "m106" }],
  leds: [{ id: "sb", name: "Stealthburner", klipper: "sb_leds", enabled: false }],   // turn on after wiring klipper/leds.cfg
  maintenance: [
    { id: "belts", name: "Check CoreXY belt tension", everyHours: 150 },
    { id: "rails", name: "Clean and lube rails and rods", everyHours: 250 },
    { id: "nozzle", name: "Replace the Volcano nozzle", everyHours: 300 },
    { id: "fans", name: "Clean the Stealthburner fans", everyHours: 150 },
    { id: "ptfe", name: "Check the hotend's PTFE liner", everyHours: 400 },
  ],
};

export const MACHINES = [
  { id: "voron", name: "Voron (MakerPrint's defaults)", note: "Quad gantry level, Z tilt, nevermore and Stealthburner lights.", config: () => clone(DEFAULT_CONFIG) },
  { id: "e3ng", name: "E3NG on the stock Creality board", note: "CoreXY Ender 3 NG with BLTouch, Volcano and the klipper/ config from this project: its macros, calibration, print modes and safe temperatures.", config: () => clone(E3NG) },
];

/** Replace the shared setup with a machine's, keeping the person's camera, queue and plugin places. */
export async function applyMachine(id) {
  const m = MACHINES.find((x) => x.id === id);
  if (!m) throw new Error("Unknown machine");
  const next = m.config();
  return config.update((d) => {
    for (const k of ["printerName", "kinematics", "safeZ", "parkXY", "filament", "preflight", "presets", "macros", "fans", "leds", "maintenance"]) {
      if (k in next) d[k] = next[k];
    }
    if (id === "voron" && !d.printerName) d.printerName = "";
    d.machine = id;
  });
}

/** Does the printer run the E3NG config? (It has macros only that config defines.) */
export const looksLikeE3NG = () => hasCommand("CALIBRATION_WIZARD") === true && hasCommand("PRINT_MODE") === true;

/**
 * Once Klipper's commands are known: if this is the E3NG config and the buttons are still
 * someone else's, offer to switch them over (once per browser).
 */
export function initMachineHint({ toast, can, prefs, go }) {
  let offered = false;
  store.on("klipper", () => {
    if (offered || prefs.get("machineHint") || config.data.machine === "e3ng" || !can("control") || !looksLikeE3NG()) return;
    offered = true;
    prefs.set("machineHint", true);   // asked once per browser; Settings > Printer has it too
    toast({
      kind: "info", timeout: 0,
      title: "This printer runs the E3NG Klipper config",
      text: "Switch MakerPrint's buttons, temperatures and reminders to match it? Your camera and plugin settings stay.",
      action: { label: "Set up for E3NG", onClick: async () => {
        try { await applyMachine("e3ng"); toast.ok("Set up for the E3NG", "Macros, presets and reminders now match your Klipper config."); go("tune"); }
        catch (e) { toast.fail("Couldn't change the setup", e); }
      } },
    });
  });
}
