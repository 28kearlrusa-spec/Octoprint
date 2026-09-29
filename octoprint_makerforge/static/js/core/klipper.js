// Understands what Klipper says back. Everything here is pure text in, plain objects out,
// so it can be tested without a printer (see tests/klipper.test.mjs).
//
// Klipper prefixes informational lines with "// " and errors with "!! ". OctoPrint hands
// them to us as "Recv: // ...". Anything we cannot recognise is simply ignored.

const stripPrefix = (line) => String(line).replace(/^Recv:\s*/, "").replace(/^(\/\/|!!)\s?/, "").trim();

// ~~ single-line recognisers ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
const RULES = [
  { id: "klipper-ready", re: /Klipper state:\s*Ready/i, make: () => ({ state: "ready" }) },
  { id: "klipper-shutdown", re: /Klipper state:\s*Shutdown/i, make: () => ({ state: "shutdown" }) },
  { id: "klipper-startup", re: /Klipper state:\s*Startup/i, make: () => ({ state: "startup" }) },
  { id: "klipper-disconnect", re: /Klipper state:\s*Disconnect/i, make: () => ({ state: "disconnected" }) },
  {
    id: "qgl", re: /Retries:\s*(\d+)\s*\/\s*(\d+)\s+Probed points range:\s*([\d.]+)\s+tolerance:\s*([\d.]+)/i,
    make: (m) => ({ retries: +m[1], maxRetries: +m[2], range: +m[3], tolerance: +m[4], ok: +m[3] <= +m[4] }),
  },
  {
    id: "probe-accuracy",
    re: /probe accuracy results:\s*maximum\s*([-\d.]+),\s*minimum\s*([-\d.]+),\s*range\s*([-\d.]+),\s*average\s*([-\d.]+),\s*median\s*([-\d.]+),\s*standard deviation\s*([-\d.]+)/i,
    make: (m) => ({ max: +m[1], min: +m[2], range: +m[3], avg: +m[4], median: +m[5], sigma: +m[6] }),
  },
  {
    id: "pid",
    re: /PID parameters:\s*pid_Kp=([\d.]+)\s+pid_Ki=([\d.]+)\s+pid_Kd=([\d.]+)/i,
    make: (m) => ({ kp: +m[1], ki: +m[2], kd: +m[3] }),
  },
  {
    id: "shaper-fit",
    re: /Fitted shaper '(\w+)' frequency\s*=\s*([\d.]+)\s*Hz\s*\(vibrations\s*=\s*([\d.]+)%,\s*smoothing\s*~=\s*([\d.]+)\)/i,
    make: (m) => ({ type: m[1], freq: +m[2], vibrations: +m[3], smoothing: +m[4] }),
  },
  {
    id: "shaper-accel",
    re: /To avoid too much smoothing with '(\w+)', suggested max_accel\s*<=\s*(\d+)/i,
    make: (m) => ({ type: m[1], maxAccel: +m[2] }),
  },
  {
    id: "shaper-pick",
    re: /Recommended shaper_type_(\w)\s*=\s*(\w+),\s*shaper_freq_\w\s*=\s*([\d.]+)\s*Hz/i,
    make: (m) => ({ axis: m[1].toUpperCase(), type: m[2], freq: +m[3] }),
  },
  {
    id: "axes-noise",
    re: /Axes noise for \S+-axis accelerometer:\s*([\d.]+)\s*\(x\),\s*([\d.]+)\s*\(y\),\s*([\d.]+)\s*\(z\)/i,
    make: (m) => ({ x: +m[1], y: +m[2], z: +m[3] }),
  },
  {
    id: "z-offset",
    re: /(\w+): z_offset:\s*(-?[\d.]+)/i,
    make: (m) => ({ section: m[1], zOffset: +m[2] }),
  },
  {
    id: "pending-config",
    re: /The SAVE_CONFIG command will update the printer config file/i,
    make: () => ({ pending: true }),
  },
  {
    id: "homed-needed", re: /Must home (?:axis )?first/i,
    make: () => ({ hint: "Home the printer first." }),
  },
  {
    id: "cold-extrude", re: /Extrude below minimum temp/i,
    make: () => ({ hint: "The nozzle is too cold to extrude. Heat it first." }),
  },
  {
    id: "move-range", re: /Move out of range:?\s*([^\n]*)/i,
    make: (m) => ({ hint: `That move is outside the printable area (${m[1].trim()}).` }),
  },
  {
    id: "heater-not-heating", re: /Heater (\S+) not heating at expected rate/i,
    make: (m) => ({ heater: m[1], hint: `Heater ${m[1]} is not heating as expected. Check the heater and thermistor wiring.` }),
  },
  {
    id: "adc-out-of-range", re: /ADC out of range|Thermistor .* (?:disconnected|shorted)/i,
    make: () => ({ hint: "A thermistor reading is out of range. Check the sensor wiring." }),
  },
  {
    id: "mcu-lost", re: /Lost communication with MCU '?([^']*)'?/i,
    make: (m) => ({ mcu: m[1], hint: `Lost contact with the ${m[1] || "MCU"}. Check the USB or CAN cable, then restart.` }),
  },
  {
    id: "timer-too-close", re: /Timer too close/i,
    make: () => ({ hint: "Klipper's MCU fell behind (Timer too close). Lower the load or check the host." }),
  },
  {
    id: "unknown-command", re: /Unknown command:\s*"?([^"\n]+)"?/i,
    make: (m) => ({ command: m[1].trim(), hint: `Klipper doesn't know “${m[1].trim()}”. It may not be in your printer.cfg.` }),
  },
  {
    id: "firmware-name", re: /FIRMWARE_NAME:\s*([^\s]+)/i,
    make: (m) => ({ name: m[1] }),
  },
];

/** Returns [{id, data, line}] for one raw log line (usually zero or one entry). */
export function recognise(rawLine) {
  const text = stripPrefix(rawLine);
  const out = [];
  for (const rule of RULES) {
    const m = rule.re.exec(text);
    if (m) out.push({ id: rule.id, data: rule.make(m), line: text });
  }
  return out;
}

// ~~ multi-line: HELP, BED_MESH_OUTPUT ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
/**
 * Parse the reply to HELP. Klipper prints "// name: description" lines under
 * "Available extended commands:". Returns a Map(name -> description).
 */
export function parseHelp(lines) {
  const cmds = new Map();
  let inSection = false;
  for (const raw of lines) {
    const t = stripPrefix(raw);
    if (/Available extended commands/i.test(t)) { inSection = true; continue; }
    if (!inSection) continue;
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*(.*)$/.exec(t);
    if (m) cmds.set(m[1].toUpperCase(), m[2]);
  }
  return cmds;
}

/**
 * BED_MESH_OUTPUT prints "Mesh Leveling Probed Z positions:" then one row per line of
 * floats. Rows arrive as consecutive log lines (or one line with embedded newlines).
 * Returns {rows:[[z...]...], min, max, range, mean, sigma} or null.
 */
export function parseMesh(lines) {
  const flat = lines.flatMap((l) => stripPrefix(l).split(/\r?\n/));
  let start = -1;
  for (let i = 0; i < flat.length; i++) if (/Mesh Leveling Probed Z positions/i.test(flat[i])) start = i;
  if (start < 0) return null;
  const rows = [];
  // a row may sit on the header line itself in some Klipper versions
  const headerRest = flat[start].replace(/.*Probed Z positions:?/i, "").trim();
  const candidates = headerRest ? [headerRest, ...flat.slice(start + 1)] : flat.slice(start + 1);
  for (const raw of candidates) {
    const t = stripPrefix(raw);
    if (!t) { if (rows.length) break; else continue; }
    const nums = t.split(/\s+/).map(Number);
    if (nums.length && nums.every((n) => Number.isFinite(n))) rows.push(nums);
    else if (rows.length) break;
  }
  if (!rows.length) return null;
  const width = rows[0].length;
  if (rows.some((r) => r.length !== width)) return null;
  const all = rows.flat();
  const min = Math.min(...all), max = Math.max(...all);
  const mean = all.reduce((a, b) => a + b, 0) / all.length;
  const sigma = Math.sqrt(all.reduce((a, b) => a + (b - mean) ** 2, 0) / all.length);
  return { rows, min, max, range: max - min, mean, sigma, cols: width, rowsCount: rows.length };
}

/** The list-of-profiles reply: "// bed_mesh: profile 'default' ..." isn't stable, so we ask for the settings. */
export function parseMeshProfiles(lines) {
  const names = new Set();
  for (const raw of lines) {
    const t = stripPrefix(raw);
    const m = /^bed_mesh:\s*profile\s*'?([^'\s]+)'?/i.exec(t) || /profile_name\s*[:=]\s*(\S+)/i.exec(t);
    if (m) names.add(m[1]);
  }
  return Array.from(names);
}

// ~~ command dictionary for terminal autocompletion ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
export const COMMON_GCODE = [
  ["G0", "Rapid move: G0 X Y Z F"], ["G1", "Linear move: G1 X Y Z E F"], ["G2", "Clockwise arc"], ["G3", "Counter-clockwise arc"],
  ["G4", "Dwell: G4 P<ms>"], ["G10", "Firmware retract"], ["G11", "Firmware unretract"], ["G28", "Home axes: G28 [X] [Y] [Z]"],
  ["G29", "Bed leveling"], ["G32", "Voron: home + gantry level (macro)"], ["G90", "Absolute positioning"], ["G91", "Relative positioning"],
  ["G92", "Set position: G92 E0"], ["M82", "Absolute extrusion"], ["M83", "Relative extrusion"], ["M84", "Disable steppers"],
  ["M104", "Set hotend temperature: M104 S<temp>"], ["M105", "Report temperatures"], ["M106", "Fan on: M106 S<0-255>"], ["M107", "Fan off"],
  ["M109", "Set hotend and wait: M109 S<temp>"], ["M112", "Emergency stop"], ["M114", "Report position"], ["M115", "Firmware info"],
  ["M140", "Set bed temperature: M140 S<temp>"], ["M141", "Set chamber temperature: M141 S<temp>"], ["M190", "Set bed and wait: M190 S<temp>"],
  ["M191", "Set chamber and wait: M191 S<temp>"], ["M220", "Speed factor: M220 S<percent>"], ["M221", "Flow factor: M221 S<percent>"],
  ["M204", "Set acceleration: M204 S<accel>"], ["M400", "Wait for moves to finish"], ["M401", "Deploy probe"], ["M402", "Stow probe"],
];

export const KLIPPER_COMMANDS = [
  ["STATUS", "Report Klipper state"], ["HELP", "List all extended commands"], ["RESTART", "Reload printer.cfg"], ["FIRMWARE_RESTART", "Restart MCU and host"],
  ["SAVE_CONFIG", "Write calibration results to printer.cfg"], ["QUAD_GANTRY_LEVEL", "Level the gantry (Voron 2.4)"], ["Z_TILT_ADJUST", "Level Z motors (Trident)"],
  ["BED_MESH_CALIBRATE", "Probe and save a bed mesh"], ["BED_MESH_OUTPUT", "Print the current mesh"], ["BED_MESH_PROFILE", "SAVE= LOAD= REMOVE= mesh profiles"],
  ["BED_MESH_CLEAR", "Clear the active mesh"], ["PROBE_CALIBRATE", "Set probe z_offset with the paper test"], ["PROBE_ACCURACY", "Measure probe repeatability"],
  ["TESTZ", "Z=<delta> during paper test"], ["ACCEPT", "Accept paper test position"], ["ABORT", "Abort paper test"],
  ["PID_CALIBRATE", "HEATER=extruder TARGET=200 (or heater_bed)"], ["SHAPER_CALIBRATE", "Run input shaper calibration"], ["MEASURE_AXES_NOISE", "Check accelerometer noise"],
  ["ACCELEROMETER_QUERY", "Check the accelerometer responds"], ["TEST_RESONANCES", "AXIS=X|Y resonance test"], ["SET_PRESSURE_ADVANCE", "ADVANCE=<value>"],
  ["SET_VELOCITY_LIMIT", "VELOCITY= ACCEL= SQUARE_CORNER_VELOCITY="], ["TUNING_TOWER", "COMMAND= PARAMETER= START= FACTOR="], ["SET_GCODE_OFFSET", "Z_ADJUST=<delta> MOVE=1"],
  ["SET_HEATER_TEMPERATURE", "HEATER= TARGET="], ["TEMPERATURE_WAIT", "SENSOR= MINIMUM= MAXIMUM="], ["SET_FAN_SPEED", "FAN=<name> SPEED=<0-1>"],
  ["SET_PIN", "PIN=<name> VALUE=<0-1>"], ["SET_LED", "LED= RED= GREEN= BLUE= WHITE= TRANSMIT=1"], ["QUERY_ENDSTOPS", "Report endstop state"], ["QUERY_PROBE", "Report probe state"],
  ["GET_POSITION", "Report stepper and toolhead positions"], ["SET_RETRACTION", "RETRACT_LENGTH= RETRACT_SPEED="], ["SDCARD_PRINT_FILE", "FILENAME=<file>"],
  ["PAUSE", "Pause (if defined)"], ["RESUME", "Resume (if defined)"], ["CANCEL_PRINT", "Cancel (if defined)"], ["DUMP_TMC", "STEPPER=<name>"], ["SET_TMC_CURRENT", "STEPPER= CURRENT="],
  ["FORCE_MOVE", "STEPPER= DISTANCE= VELOCITY="], ["STEPPER_BUZZ", "STEPPER=<name>"], ["M112", "Emergency stop"],
];
