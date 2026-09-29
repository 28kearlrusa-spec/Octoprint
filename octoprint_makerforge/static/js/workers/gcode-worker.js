/* G-code -> line segments, off the main thread.
 *
 * In:  {buffer: ArrayBuffer, keepTravel: bool}
 * Out: {type:"progress", value} ... then {type:"done", ext, trv, layers, bbox, counts}
 *
 * ext vertices: 7 floats [x y z layer byteOffset speed(mm/s) featureType], 2 vertices per segment
 * trv vertices: 3 floats [x y z], 2 vertices per segment
 * layers: {z: Float32Array, ext: Uint32Array (first ext segment), trv: Uint32Array (first travel segment)}
 *
 * A layer starts when an extruding move happens at a Z at least MIN_STEP above the last layer.
 * That is the same rule the server-side layer scan uses, so layer numbers agree.
 */
"use strict";

var MIN_STEP = 0.04;
var EPS = 1e-4;
var MAX_LAYERS = 20000;

function featureType(text) {
  var t = text.toLowerCase();
  if (t.indexOf("external perimeter") >= 0 || t.indexOf("outer wall") >= 0 || t.indexOf("wall-outer") >= 0 || t.indexOf("outer perimeter") >= 0) return 1;
  if (t.indexOf("overhang") >= 0 || t.indexOf("bridge") >= 0) return 6;
  if (t.indexOf("perimeter") >= 0 || t.indexOf("inner wall") >= 0 || t.indexOf("wall-inner") >= 0 || t.indexOf("wall") >= 0) return 2;
  if (t.indexOf("top solid") >= 0 || t.indexOf("top surface") >= 0 || t.indexOf("solid infill") >= 0 || t.indexOf("internal solid") >= 0 || t.indexOf("skin") >= 0 || t.indexOf("bottom surface") >= 0 || t.indexOf("gap") >= 0) return 4;
  if (t.indexOf("infill") >= 0 || t.indexOf("fill") >= 0 || t.indexOf("sparse") >= 0) return 3;
  if (t.indexOf("support") >= 0) return 5;
  if (t.indexOf("skirt") >= 0 || t.indexOf("brim") >= 0 || t.indexOf("prime") >= 0 || t.indexOf("purge") >= 0 || t.indexOf("wipe") >= 0) return 7;
  return 0;
}

function Grow(stride, initial) {
  this.stride = stride;
  this.data = new Float32Array(initial * stride);
  this.len = 0; // vertices
}
Grow.prototype.push = function () {
  var need = (this.len + 1) * this.stride;
  if (need > this.data.length) {
    var next = new Float32Array(Math.max(need, Math.floor(this.data.length * 1.6)));
    next.set(this.data);
    this.data = next;
  }
  var o = this.len * this.stride;
  for (var i = 0; i < arguments.length; i++) this.data[o + i] = arguments[i];
  this.len++;
};
Grow.prototype.finish = function () { return this.data.slice(0, this.len * this.stride); };

self.onmessage = function (ev) {
  try { parse(new Uint8Array(ev.data.buffer), ev.data); }
  catch (e) { self.postMessage({ type: "error", message: String(e && e.message || e) }); }
};

function parse(bytes, opts) {
  var n = bytes.length;
  var keepTravel = opts.keepTravel !== false;
  var ext = new Grow(7, 120000);
  var trv = keepTravel ? new Grow(3, 60000) : null;
  var layerZ = [], layerExt = [], layerTrv = [];

  var x = 0, y = 0, z = 0, e = 0, feed = 1800;
  var absXYZ = true, absE = true;
  var layerAt = null;
  var type = 0;
  var minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  var extSegs = 0, trvSegs = 0;
  var nextReport = n / 50;

  var pos = 0;
  while (pos < n) {
    var lineStart = pos;
    // find end of line
    var end = pos;
    while (end < n && bytes[end] !== 10) end++;
    pos = end + 1;

    if (lineStart >= nextReport) { self.postMessage({ type: "progress", value: lineStart / n }); nextReport += n / 50; }

    var c0 = bytes[lineStart];
    if (c0 === 59) { // ';'
      // ;TYPE:xxx  or  ; FEATURE: xxx
      var s = lineStart + 1;
      while (s < end && bytes[s] === 32) s++;
      if ((bytes[s] === 84 && bytes[s + 1] === 89 && bytes[s + 2] === 80 && bytes[s + 3] === 69 && bytes[s + 4] === 58) ||
          (bytes[s] === 70 && bytes[s + 1] === 69 && bytes[s + 2] === 65 && bytes[s + 3] === 84 && bytes[s + 4] === 85)) {
        var txt = "";
        for (var k = s + 5; k < end && k < s + 60; k++) txt += String.fromCharCode(bytes[k]);
        type = featureType(txt.replace(/^[A-Za-z]*:/, ""));
      }
      continue;
    }
    if (c0 !== 71 && c0 !== 77) continue; // only G and M words matter

    // command word
    var i = lineStart + 1;
    var num = 0;
    while (i < end && bytes[i] >= 48 && bytes[i] <= 57) { num = num * 10 + (bytes[i] - 48); i++; }

    if (c0 === 77) { // M82 / M83
      if (num === 82) absE = true; else if (num === 83) absE = false;
      continue;
    }
    if (num === 90) { absXYZ = true; continue; }
    if (num === 91) { absXYZ = false; continue; }

    if (num !== 0 && num !== 1 && num !== 2 && num !== 3 && num !== 92) continue;

    // parameters
    var nx = null, ny = null, nz = null, ne = null, nf = null, pi = null, pj = null;
    while (i < end) {
      var ch = bytes[i];
      if (ch === 59) break; // comment
      if ((ch >= 65 && ch <= 90) && (ch === 88 || ch === 89 || ch === 90 || ch === 69 || ch === 70 || ch === 73 || ch === 74)) {
        var j = i + 1, neg = false, val = 0, frac = 0, div = 1, seenDot = false, ok = false;
        if (bytes[j] === 45) { neg = true; j++; } else if (bytes[j] === 43) j++;
        while (j < end) {
          var d = bytes[j];
          if (d >= 48 && d <= 57) { ok = true; if (seenDot) { div *= 10; frac = frac * 10 + (d - 48); } else val = val * 10 + (d - 48); j++; }
          else if (d === 46 && !seenDot) { seenDot = true; j++; }
          else break;
        }
        if (ok) {
          var v = val + frac / div;
          if (neg) v = -v;
          if (ch === 88) nx = v; else if (ch === 89) ny = v; else if (ch === 90) nz = v;
          else if (ch === 69) ne = v; else if (ch === 70) nf = v; else if (ch === 73) pi = v; else pj = v;
        }
        i = j;
      } else i++;
    }

    if (num === 92) { // set position
      if (nx !== null) x = nx; if (ny !== null) y = ny; if (nz !== null) z = nz; if (ne !== null) e = ne;
      continue;
    }

    if (nf !== null) feed = nf;
    var x1 = nx === null ? x : (absXYZ ? nx : x + nx);
    var y1 = ny === null ? y : (absXYZ ? ny : y + ny);
    var z1 = nz === null ? z : (absXYZ ? nz : z + nz);
    var de = 0;
    if (ne !== null) { if (absE) { de = ne - e; e = ne; } else { de = ne; e += ne; } }
    var extruding = de > 0;
    var speed = feed / 60;

    // arcs are flattened into short chords
    var arc = (num === 2 || num === 3) && (pi !== null || pj !== null);
    var pts = null;
    if (arc) {
      var cx = x + (pi || 0), cy = y + (pj || 0);
      var r = Math.sqrt((pi || 0) * (pi || 0) + (pj || 0) * (pj || 0));
      var a0 = Math.atan2(y - cy, x - cx), a1 = Math.atan2(y1 - cy, x1 - cx);
      if (num === 2) { while (a1 >= a0 - 1e-9) a1 -= 6.283185307179586; }   // clockwise
      else { while (a1 <= a0 + 1e-9) a1 += 6.283185307179586; }             // counter-clockwise
      var steps = Math.min(90, Math.max(2, Math.ceil(Math.abs(a1 - a0) * r / 0.6)));
      pts = [];
      for (var s2 = 1; s2 <= steps; s2++) {
        var t = s2 / steps, a = a0 + (a1 - a0) * t;
        pts.push(cx + r * Math.cos(a), cy + r * Math.sin(a), z + (z1 - z) * t);
      }
    } else if (x1 === x && y1 === y && z1 === z) {
      continue;
    } else {
      pts = [x1, y1, z1];
    }

    var px = x, py = y, pz = z;
    for (var q = 0; q < pts.length; q += 3) {
      var qx = pts[q], qy = pts[q + 1], qz = pts[q + 2];
      if (extruding) {
        if (qz > EPS && (layerAt === null || qz - layerAt >= MIN_STEP) && layerZ.length < MAX_LAYERS) {
          layerAt = qz;
          layerZ.push(qz);
          layerExt.push(extSegs);
          layerTrv.push(trvSegs);
        }
        if (layerZ.length) {
          ext.push(px, py, pz, layerZ.length - 1, lineStart, speed, type);
          ext.push(qx, qy, qz, layerZ.length - 1, lineStart, speed, type);
          extSegs++;
          if (qx < minX) minX = qx; if (qx > maxX) maxX = qx;
          if (qy < minY) minY = qy; if (qy > maxY) maxY = qy;
          if (qz < minZ) minZ = qz; if (qz > maxZ) maxZ = qz;
        }
      } else if (keepTravel && layerZ.length) {
        trv.push(px, py, pz);
        trv.push(qx, qy, qz);
        trvSegs++;
      }
      px = qx; py = qy; pz = qz;
    }
    x = x1; y = y1; z = z1;
  }

  var extArr = ext.finish();
  var trvArr = keepTravel ? trv.finish() : new Float32Array(0);
  var layers = { z: new Float32Array(layerZ), ext: new Uint32Array(layerExt), trv: new Uint32Array(layerTrv) };
  var bbox = extSegs ? [minX, minY, minZ, maxX, maxY, maxZ] : [0, 0, 0, 1, 1, 1];
  self.postMessage(
    { type: "done", ext: extArr, trv: trvArr, layers: layers, bbox: bbox, counts: { ext: extSegs, trv: trvSegs, layers: layerZ.length } },
    [extArr.buffer, trvArr.buffer, layers.z.buffer, layers.ext.buffer, layers.trv.buffer]
  );
}
