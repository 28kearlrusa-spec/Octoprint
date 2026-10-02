// Out-of-the-box config: sensible for a Voron running Klipper. Anything the user edits is
// saved to the plugin's shared config and wins over these.

export const DEFAULT_CONFIG = {
  printerName: "",
  kinematics: "bed-z",             // bed-z (Voron 2.4 / Trident / 0.x: bed moves) | gantry-z
  hasQgl: null,                    // null = detect from Klipper's HELP output
  filament: { diameter: 1.75, density: 1.24, costPerKg: 20 },
  webcam: { streamUrl: "", snapshotUrl: "", rotate: 0, flipH: false, flipV: false },
  safeZ: 30,
  parkXY: [10, 10],

  // Shown before a print starts. Untick "enabled" in Settings to start prints with one tap.
  preflight: {
    enabled: true,
    items: ["The build plate is clean", "Filament is loaded and dry", "The chamber door is closed"],
  },

  presets: [
    { id: "pla", name: "PLA", nozzle: 210, bed: 60, chamber: 0 },
    { id: "petg", name: "PETG", nozzle: 240, bed: 80, chamber: 0 },
    { id: "abs", name: "ABS", nozzle: 250, bed: 100, chamber: 45 },
    { id: "asa", name: "ASA", nozzle: 255, bed: 100, chamber: 50 },
    { id: "pc", name: "PC", nozzle: 275, bed: 110, chamber: 50 },
    { id: "tpu", name: "TPU", nozzle: 225, bed: 50, chamber: 0 },
    { id: "nylon", name: "Nylon", nozzle: 260, bed: 90, chamber: 45 },
  ],

  // Macros are plain G-code (or Klipper commands). `needs` names a Klipper command that must
  // exist for the button to be offered; `requires: "hot"` blocks it below 170 C.
  macros: [
    { id: "home", name: "Home all", icon: "home", cat: "Motion", gcode: "G28" },
    { id: "home-xy", name: "Home XY", icon: "home", cat: "Motion", gcode: "G28 X Y" },
    { id: "home-z", name: "Home Z", icon: "home", cat: "Motion", gcode: "G28 Z" },
    { id: "qgl", name: "Quad gantry level", icon: "qgl", cat: "Voron", gcode: "QUAD_GANTRY_LEVEL", needs: "QUAD_GANTRY_LEVEL", homed: true },
    { id: "z-tilt", name: "Z tilt adjust", icon: "qgl", cat: "Voron", gcode: "Z_TILT_ADJUST", needs: "Z_TILT_ADJUST", homed: true },
    { id: "mesh", name: "Bed mesh", icon: "mesh", cat: "Voron", gcode: "BED_MESH_CALIBRATE", needs: "BED_MESH_CALIBRATE", homed: true, confirm: "This probes the whole bed and takes a few minutes." },
    { id: "mesh-clear", name: "Clear mesh", icon: "mesh", cat: "Voron", gcode: "BED_MESH_CLEAR", needs: "BED_MESH_CLEAR" },
    { id: "clean", name: "Clean nozzle", icon: "nozzle", cat: "Voron", gcode: "CLEAN_NOZZLE", needs: "CLEAN_NOZZLE", homed: true },
    { id: "park", name: "Park", icon: "home", cat: "Motion", gcode: "G90\nG1 Z{safeZ} F1200\nG1 X{parkX} Y{parkY} F9000", homed: true },
    { id: "load", name: "Load filament", icon: "spool", cat: "Filament", gcode: "LOAD_FILAMENT", needs: "LOAD_FILAMENT", requires: "hot" },
    { id: "unload", name: "Unload filament", icon: "eject", cat: "Filament", gcode: "UNLOAD_FILAMENT", needs: "UNLOAD_FILAMENT", requires: "hot" },
    { id: "motors-off", name: "Motors off", icon: "power", cat: "Motion", gcode: "M84" },
    { id: "fw-restart", name: "Firmware restart", icon: "refresh", cat: "Klipper", gcode: "FIRMWARE_RESTART", confirm: "Restarts the MCU and Klipper. Any running print is lost." },
    { id: "restart", name: "Restart Klipper", icon: "refresh", cat: "Klipper", gcode: "RESTART", confirm: "Reloads printer.cfg. Any running print is lost." },
    { id: "save-config", name: "Save config", icon: "save", cat: "Klipper", gcode: "SAVE_CONFIG", confirm: "Writes the pending calibration to printer.cfg and restarts Klipper." },
    { id: "status", name: "Klipper status", icon: "info", cat: "Klipper", gcode: "STATUS" },
    { id: "endstops", name: "Query endstops", icon: "target", cat: "Klipper", gcode: "QUERY_ENDSTOPS" },
    { id: "position", name: "Get position", icon: "compass", cat: "Klipper", gcode: "GET_POSITION" },
  ],

  // Fans. `m106` = the part fan on the M106 command. `generic` = a Klipper [fan_generic].
  fans: [
    { id: "part", name: "Part cooling", type: "m106" },
    { id: "nevermore", name: "Nevermore", type: "generic", klipper: "nevermore", enabled: false },
    { id: "exhaust", name: "Exhaust", type: "generic", klipper: "exhaust_fan", enabled: false },
  ],

  // Neopixel / LED groups for the toolhead lights (Stealthburner: sb_leds / logo / nozzle).
  leds: [
    { id: "sb", name: "Toolhead", klipper: "sb_leds", enabled: false },
  ],

  // Files waiting to be printed, in order: [{id, path, name, addedAt}]
  queue: [],

  // Maintenance reminders, in print hours since last done
  maintenance: [
    { id: "rails", name: "Lube linear rails", everyHours: 250 },
    { id: "nozzle", name: "Replace nozzle", everyHours: 300 },
    { id: "belts", name: "Check belt tension", everyHours: 200 },
    { id: "fans", name: "Clean fans and filters", everyHours: 150 },
  ],
};

export const KLIPPER_HOT_MIN = 170;
