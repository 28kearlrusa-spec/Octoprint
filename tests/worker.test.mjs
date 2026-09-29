// Runs the G-code worker's parser in Node and checks it against the samples.
//   node tests/worker.test.mjs
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = fs.readFileSync(path.join(root, "octoprint_makerforge/static/js/workers/gcode-worker.js"), "utf8");

function parse(buffer, opts = {}) {
  let result = null;
  const self = { postMessage(msg) { if (msg.type === "done") result = msg; if (msg.type === "error") throw new Error(msg.message); } };
  vm.runInNewContext(src, { self, Float32Array, Uint32Array, Uint8Array, Math, String, Infinity });
  self.onmessage({ data: { buffer, ...opts } });
  return result;
}
const load = (name) => { const b = fs.readFileSync(path.join(root, "dev/samples", name)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); };

let failures = 0;
const test = (name, fn) => { try { fn(); console.log("ok   ", name); } catch (e) { failures++; console.log("FAIL ", name, "\n     ", e.message); } };

test("cube: 150 layers, z from 0.2 to 30", () => {
  const r = parse(load("voron-test-cube-30mm.gcode"));
  assert.equal(r.counts.layers, 150);
  assert.ok(Math.abs(r.layers.z[0] - 0.2) < 1e-3);
  assert.ok(Math.abs(r.layers.z[149] - 30) < 1e-3);
  assert.ok(r.counts.ext > 1000);
  assert.ok(r.counts.trv > 100);
});

test("cube: bounding box matches the 30 mm part centred on 175,175", () => {
  const [minX, minY, minZ, maxX, maxY, maxZ] = parse(load("voron-test-cube-30mm.gcode")).bbox;
  assert.ok(Math.abs(minX - 160) < 0.6 && Math.abs(maxX - 190) < 0.6, `x ${minX}..${maxX}`);
  assert.ok(Math.abs(minY - 160) < 0.6 && Math.abs(maxY - 190) < 0.6);
  assert.ok(Math.abs(maxZ - 30) < 1e-3);
});

test("layers agree with the server-side scan for every sample", () => {
  for (const [name, expect] of [["voron-test-cube-30mm.gcode", 150], ["twisted-vase-orca.gcode", 220], ["stepped-tower-abs.gcode", 200], ["cura-calibration-tower.gcode", 120]]) {
    assert.equal(parse(load(name)).counts.layers, expect, name);
  }
});

test("ext vertices carry layer, byte offset, speed and feature type", () => {
  const r = parse(load("voron-test-cube-30mm.gcode"));
  const first = Array.from(r.ext.slice(0, 7));
  assert.equal(first[3], 0);                    // layer 0
  assert.ok(first[4] > 0);                      // a byte offset inside the file
  assert.ok(first[5] > 10 && first[5] < 200);   // mm/s
  assert.ok(first[6] >= 0 && first[6] <= 7);    // a known feature id
  const types = new Set(); for (let i = 6; i < r.ext.length; i += 7) types.add(r.ext[i]);
  assert.ok(types.has(2) || types.has(1), "perimeters recognised");
  assert.ok(types.has(3), "infill recognised");
});

test("layer start indices are monotonic and index real segments", () => {
  const r = parse(load("twisted-vase-orca.gcode"));
  for (let i = 1; i < r.layers.ext.length; i++) assert.ok(r.layers.ext[i] >= r.layers.ext[i - 1]);
  assert.ok(r.layers.ext[r.layers.ext.length - 1] < r.counts.ext);
});

test("arcs (G2/G3) become chords and keep the radius", () => {
  const gcode = "G90\nM83\nG1 X10 Y0 Z0.2 F600\nG1 X20 Y0 E1 F1200\nG3 X10 Y10 I-10 J0 E2\nG2 X20 Y0 I0 J-10 E2\n";
  const b = Buffer.from(gcode);
  const r = parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  assert.ok(r.counts.ext > 20, "arc flattened into many chords: " + r.counts.ext);
  for (let i = 0; i < r.ext.length; i += 7) {
    if (i < 14) continue;
    const px = r.ext[i], py = r.ext[i + 1];
    const d = Math.hypot(px - 10, py - 0);
    // points on the first arc (centre 10,0 radius 10) sit 10 mm from its centre
    if (r.ext[i + 4] > 60 && r.ext[i + 4] < 90) assert.ok(Math.abs(d - 10) < 0.05, "radius drift " + d);
  }
});

test("relative XYZ and relative E are honoured", () => {
  const g = "G91\nM83\nG1 Z0.2 F600\nG1 X10 E1\nG1 Y10 E1\nG1 X-10 E1\n";
  const b = Buffer.from(g);
  const r = parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  assert.equal(r.counts.ext, 3);
  const last = Array.from(r.ext.slice(-7));
  assert.ok(Math.abs(last[0] - 0) < 1e-6 && Math.abs(last[1] - 10) < 1e-6);
});

test("garbage input does not throw", () => {
  const b = Buffer.from("this is not gcode\n\n;;;;\nG1 Xabc Y\nG28\n");
  const r = parse(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
  assert.equal(r.counts.ext, 0);
});

if (failures) { console.log(`\n${failures} failed`); process.exit(1); }
console.log("\nall worker tests passed");
