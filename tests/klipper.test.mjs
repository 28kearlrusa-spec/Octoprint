// The Klipper output parsers, fed with lines formatted exactly like Klipper's own source prints them.
//   node tests/klipper.test.mjs
import assert from "node:assert/strict";
import { recognise, parseHelp, parseMesh } from "../octoprint_makerforge/static/js/core/klipper.js";

let failures = 0;
const test = (name, fn) => { try { fn(); console.log("ok   ", name); } catch (e) { failures++; console.log("FAIL ", name, "\n     ", e.message); } };
const one = (line, id) => { const hit = recognise(line).find((h) => h.id === id); assert.ok(hit, `no "${id}" in: ${line}`); return hit.data; };

test("gantry level result (z_tilt.py format)", () => {
  const d = one("Recv: // Retries: 1/5 Probed points range: 0.003125 tolerance: 0.007500", "qgl");
  assert.deepEqual([d.retries, d.maxRetries, d.range, d.tolerance, d.ok], [1, 5, 0.003125, 0.0075, true]);
  assert.equal(one("Recv: // Retries: 0/5 Probed points range: 0.012000 tolerance: 0.007500", "qgl").ok, false);
});

test("probe accuracy (probe.py format)", () => {
  const d = one("Recv: // probe accuracy results: maximum 2.522500, minimum 2.517500, range 0.005000, average 2.519880, median 2.520000, standard deviation 0.001590", "probe-accuracy");
  assert.equal(d.range, 0.005); assert.equal(d.sigma, 0.00159); assert.equal(d.avg, 2.51988);
});

test("PID result", () => {
  const d = one("Recv: // PID parameters: pid_Kp=22.865 pid_Ki=1.292 pid_Kd=101.178", "pid");
  assert.deepEqual([d.kp, d.ki, d.kd], [22.865, 1.292, 101.178]);
  assert.ok(recognise("Recv: // The SAVE_CONFIG command will update the printer config file").some((h) => h.id === "pending-config"));
});

test("input shaper lines (shaper_calibrate.py / resonance_tester.py formats)", () => {
  const f = one("Recv: // Fitted shaper 'mzv' frequency = 53.8 Hz (vibrations = 1.2%, smoothing ~= 0.128)", "shaper-fit");
  assert.deepEqual([f.type, f.freq, f.vibrations, f.smoothing], ["mzv", 53.8, 1.2, 0.128]);
  assert.deepEqual(Object.values(one("Recv: // To avoid too much smoothing with 'ei', suggested max_accel <= 4800 mm/sec^2", "shaper-accel")), ["ei", 4800]);
  const p = one("Recv: // Recommended shaper_type_y = 2hump_ei, shaper_freq_y = 47.6 Hz", "shaper-pick");
  assert.deepEqual([p.axis, p.type, p.freq], ["Y", "2hump_ei", 47.6]);
});

test("accelerometer noise, any axis label", () => {
  const d = one("Recv: // Axes noise for xyz-axis accelerometer: 3.155110 (x), 7.109871 (y), 4.590381 (z)", "axes-noise");
  assert.deepEqual([d.x, d.y, d.z], [3.15511, 7.109871, 4.590381]);
  assert.ok(recognise("Recv: // Axes noise for x-axis accelerometer: 1.0 (x), 2.0 (y), 3.0 (z)").some((h) => h.id === "axes-noise"));
});

test("z_offset message names its config section", () => {
  assert.equal(one("Recv: // probe: z_offset: 1.150", "z-offset").zOffset, 1.15);
  assert.equal(one("Recv: // bltouch: z_offset: -0.425", "z-offset").section, "bltouch");
});

test("state and error hints", () => {
  assert.equal(one("Recv: // Klipper state: Shutdown", "klipper-shutdown").state, "shutdown");
  assert.equal(one("Recv: // Klipper state: Ready", "klipper-ready").state, "ready");
  assert.match(one("Recv: !! Must home axis first: 0.000 0.000 5.000 [0.000]", "homed-needed").hint, /Home/);
  assert.match(one("Recv: !! Extrude below minimum temp\nSee the 'min_extrude_temp' config option for details", "cold-extrude").hint, /cold/);
  assert.match(one("Recv: !! Lost communication with MCU 'mcu'", "mcu-lost").hint, /USB or CAN/);
  assert.match(one('Recv: // Unknown command:"QUAD_GANTRY_LEVEL"', "unknown-command").hint, /QUAD_GANTRY_LEVEL/);
  assert.equal(recognise("Recv: ok T:21.4 /0.0 B:22.0 /0.0").length, 0);
});

test("HELP lists extended commands and macros", () => {
  const cmds = parseHelp([
    "Recv: // Available extended commands:",
    "Recv: // ABORT: Abort the current probe",
    "Recv: // QUAD_GANTRY_LEVEL: Conform a moving, twistable gantry to the shape of a stationary bed",
    "Recv: // CLEAN_NOZZLE: ",
    "Recv: // M112: Emergency Stop",
    "Recv: // not a command line",
  ]);
  assert.ok(cmds.has("QUAD_GANTRY_LEVEL") && cmds.has("CLEAN_NOZZLE") && cmds.has("ABORT") && cmds.has("M112"));
  assert.equal(cmds.size, 4);
  assert.match(cmds.get("QUAD_GANTRY_LEVEL"), /twistable gantry/);
});

test("bed mesh output (bed_mesh.py format, multi-line respond_info)", () => {
  const mesh = parseMesh([
    "Recv: // Mesh Leveling Probed Z positions:",
    "Recv: //  0.012500 0.005000 -0.007500 -0.015000 -0.012500",
    "Recv: //  0.017500 0.007500 -0.002500 -0.010000 -0.015000",
    "Recv: //  0.022500 0.012500 0.000000 -0.005000 -0.010000",
    "Recv: // Mesh X,Y: 5,3",
    "Recv: // Mesh Average: 0.00",
  ]);
  assert.equal(mesh.cols, 5); assert.equal(mesh.rowsCount, 3);
  assert.ok(Math.abs(mesh.max - 0.0225) < 1e-9 && Math.abs(mesh.min + 0.015) < 1e-9);
  assert.ok(Math.abs(mesh.range - 0.0375) < 1e-9);
  assert.equal(parseMesh(["Recv: // Bed has not been probed"]), null);
  assert.equal(parseMesh(["Recv: // Mesh Leveling Probed Z positions:", "Recv: // 1 2 3", "Recv: // 1 2"]), null);   // ragged rows
});

test("bed screws (screws_tilt_adjust.py format)", () => {
  const [base] = recognise("Recv: // front left (base) : x=30.0, y=48.0, z=2.48750");
  assert.equal(base.id, "screw"); assert.equal(base.data.base, true); assert.equal(base.data.dir, null);
  const [cw] = recognise("Recv: // front right : x=200.0, y=48.0, z=2.36250 : adjust CW 00:12");
  assert.equal(cw.data.name, "front right"); assert.equal(cw.data.dir, "CW"); assert.equal(cw.data.clock, "00:12");
  assert.ok(Math.abs(cw.data.turns - 0.2) < 1e-9);
  const [ccw] = recognise("Recv: // back left : x=30.0, y=218.0, z=2.6 : adjust CCW 01:05");
  assert.equal(ccw.data.dir, "CCW"); assert.ok(Math.abs(ccw.data.turns - 65 / 60) < 1e-9);
  assert.equal(recognise("Recv: // probe at 30.000,48.000 is z=2.487500").filter((h) => h.id === "screw").length, 0);
});

test("E3NG config messages (EXTRUDER_RESULT, PRINT_MODE)", () => {
  const [x] = recognise("Recv: // Extruded 97.5 mm of 100. rotation_distance 34.406 -> 33.546. Put the new value in [extruder] in printer.cfg and RESTART.");
  assert.deepEqual(x.data, { moved: 97.5, old: 34.406, next: 33.546 });
  assert.equal(recognise("Recv: // Print mode: quiet")[0].data.mode, "quiet");
});

if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
console.log("\nall klipper parser tests passed");
