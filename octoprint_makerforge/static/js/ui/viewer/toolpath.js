// WebGL toolpath viewer. Parsing happens in a worker; drawing is one draw call per layer range.
import { boot } from "mf/core/api.js";

const TYPE_COLORS = [
  [0.62, 0.64, 0.7],   // 0 other
  [1.0, 0.36, 0.42],   // 1 outer wall
  [1.0, 0.72, 0.26],   // 2 inner wall
  [0.36, 0.55, 1.0],   // 3 infill
  [0.4, 0.95, 0.62],   // 4 solid / top surface
  [0.72, 0.55, 1.0],   // 5 support
  [0.3, 0.85, 1.0],    // 6 bridge / overhang
  [0.75, 0.75, 0.78],  // 7 skirt / brim
];
export const TYPE_NAMES = ["Other", "Outer wall", "Inner wall", "Infill", "Solid and top", "Support", "Bridge", "Skirt and brim"];
export const typeColorCss = (i) => `rgb(${TYPE_COLORS[i].map((v) => Math.round(v * 255)).join(",")})`;

const VS = `
attribute vec3 aPos; attribute vec4 aMeta;
uniform mat4 uMVP; uniform float uMode; uniform float uLayers; uniform float uFilepos; uniform float uSpeedMax; uniform float uHi;
uniform vec3 uColA; uniform vec3 uColB; uniform vec3 uT0; uniform vec3 uT1; uniform vec3 uT2; uniform vec3 uT3; uniform vec3 uT4; uniform vec3 uT5; uniform vec3 uT6; uniform vec3 uT7;
varying vec3 vColor;
vec3 ramp(float t){ return t < 0.5 ? mix(vec3(0.2,0.55,1.0), vec3(0.4,1.0,0.5), t*2.0) : mix(vec3(0.4,1.0,0.5), vec3(1.0,0.3,0.25), (t-0.5)*2.0); }
vec3 typeColor(float k){
  if (k < 0.5) return uT0; if (k < 1.5) return uT1; if (k < 2.5) return uT2; if (k < 3.5) return uT3;
  if (k < 4.5) return uT4; if (k < 5.5) return uT5; if (k < 6.5) return uT6; return uT7;
}
void main(){
  gl_Position = uMVP * vec4(aPos.x, aPos.z, -aPos.y, 1.0);
  float lt = aMeta.x / max(uLayers - 1.0, 1.0);
  vec3 c;
  if (uMode < 0.5) c = mix(uColA, uColB, lt);
  else if (uMode < 1.5) c = ramp(clamp(aMeta.z / uSpeedMax, 0.0, 1.0));
  else if (uMode < 2.5) c = typeColor(aMeta.w);
  else c = aMeta.y < uFilepos ? mix(uColA, uColB, lt) : vec3(0.30, 0.33, 0.39);
  vColor = mix(c, vec3(1.0), uHi * 0.55);
}`;
const FS = `precision mediump float; varying vec3 vColor; void main(){ gl_FragColor = vec4(vColor, 1.0); }`;
const VS2 = `attribute vec3 aPos; uniform mat4 uMVP; uniform float uSize; void main(){ gl_Position = uMVP * vec4(aPos.x, aPos.z, -aPos.y, 1.0); gl_PointSize = uSize; }`;
const FS2 = `precision mediump float; uniform vec4 uColor; void main(){ gl_FragColor = uColor; }`;

// ~~ tiny mat4 (column major) ~~
const mat = {
  perspective(fovy, aspect, n, f) {
    const t = 1 / Math.tan(fovy / 2), o = new Float32Array(16);
    o[0] = t / aspect; o[5] = t; o[10] = (f + n) / (n - f); o[11] = -1; o[14] = (2 * f * n) / (n - f);
    return o;
  },
  lookAt(e, c, u) {
    let zx = e[0] - c[0], zy = e[1] - c[1], zz = e[2] - c[2];
    let l = Math.hypot(zx, zy, zz); zx /= l; zy /= l; zz /= l;
    let xx = u[1] * zz - u[2] * zy, xy = u[2] * zx - u[0] * zz, xz = u[0] * zy - u[1] * zx;
    l = Math.hypot(xx, xy, xz); xx /= l; xy /= l; xz /= l;
    const yx = zy * xz - zz * xy, yy = zz * xx - zx * xz, yz = zx * xy - zy * xx;
    return new Float32Array([xx, yx, zx, 0, xy, yy, zy, 0, xz, yz, zz, 0, -(xx * e[0] + xy * e[1] + xz * e[2]), -(yx * e[0] + yy * e[1] + yz * e[2]), -(zx * e[0] + zy * e[1] + zz * e[2]), 1]);
  },
  mul(a, b) {
    const o = new Float32Array(16);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
      o[j * 4 + i] = a[i] * b[j * 4] + a[4 + i] * b[j * 4 + 1] + a[8 + i] * b[j * 4 + 2] + a[12 + i] * b[j * 4 + 3];
    }
    return o;
  },
};

const cssColor = (name, fallback) => {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const m = /^#([0-9a-f]{6})$/i.exec(v);
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return [(n >> 16) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

function workerUrl() {
  try {
    const map = JSON.parse(document.querySelector("script[type=importmap]").textContent).imports;
    if (map["mf/workers/gcode-worker.js"]) return map["mf/workers/gcode-worker.js"];
  } catch { /* fall through */ }
  return `${boot.staticBase}/js/workers/gcode-worker.js`;
}

export class ToolpathView {
  constructor(canvas, { onChange } = {}) {
    this.canvas = canvas;
    this.onChange = onChange || (() => {});
    this.gl = canvas.getContext("webgl", { antialias: true, alpha: true, powerPreference: "high-performance" });
    this.ok = !!this.gl;
    this.data = null;
    this.mode = 0;
    this.layerMin = 0;
    this.layerMax = 0;
    this.solo = false;
    this.showTravel = false;
    this.showBed = true;
    this.filepos = 0;
    this.follow = false;
    this.bed = { w: 250, d: 250, origin: "lowerleft" };
    this.cam = { theta: -0.75, phi: 0.62, dist: 400, target: [0, 0, 0] };
    this.dirty = true;
    this.destroyed = false;
    if (!this.ok) return;
    this.initGL();
    this.bind();
    this.ro = new ResizeObserver(() => { this.resize(); });
    this.ro.observe(canvas);
    this.loop = this.loop.bind(this);
    requestAnimationFrame(this.loop);
  }

  // ~~ GL setup ~~
  initGL() {
    const gl = this.gl;
    const prog = (vs, fs) => {
      const p = gl.createProgram();
      for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
        const s = gl.createShader(type);
        gl.shaderSource(s, src); gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
        gl.attachShader(p, s);
      }
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
      return p;
    };
    this.pExt = prog(VS, FS);
    this.pSimple = prog(VS2, FS2);
    const u = (p, names) => Object.fromEntries(names.map((n) => [n, gl.getUniformLocation(p, n)]));
    this.uExt = u(this.pExt, ["uMVP", "uMode", "uLayers", "uFilepos", "uSpeedMax", "uHi", "uColA", "uColB", "uT0", "uT1", "uT2", "uT3", "uT4", "uT5", "uT6", "uT7"]);
    this.uSimple = u(this.pSimple, ["uMVP", "uColor", "uSize"]);
    this.bExt = gl.createBuffer();
    this.bTrv = gl.createBuffer();
    this.bBed = gl.createBuffer();
    this.bMark = gl.createBuffer();
    this.nBed = 0;
    this.buildBed();
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    this.canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); this.ok = false; });
    this.canvas.addEventListener("webglcontextrestored", () => { this.ok = true; this.initGL(); if (this.data) this.upload(); this.invalidate(); });
  }

  buildBed() {
    const gl = this.gl, { w, d, origin } = this.bed;
    const x0 = origin === "center" ? -w / 2 : 0, y0 = origin === "center" ? -d / 2 : 0;
    const v = [];
    const line = (a, b, c, e) => v.push(a, b, 0, c, e, 0);
    line(x0, y0, x0 + w, y0); line(x0 + w, y0, x0 + w, y0 + d); line(x0 + w, y0 + d, x0, y0 + d); line(x0, y0 + d, x0, y0);
    for (let x = 50; x < w; x += 50) line(x0 + x, y0, x0 + x, y0 + d);
    for (let y = 50; y < d; y += 50) line(x0, y0 + y, x0 + w, y0 + y);
    this.nBedOutline = 8;
    this.nBed = v.length / 3;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bBed);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(v), gl.STATIC_DRAW);
  }

  setBed(bed) {
    this.bed = { w: bed.w || 250, d: bed.d || 250, origin: bed.origin || "lowerleft" };
    if (this.ok) this.buildBed();
    this.invalidate();
  }

  // ~~ data ~~
  /** Load from an ArrayBuffer of G-code. Resolves when uploaded. */
  parse(buffer, { keepTravel = true, onProgress } = {}) {
    return new Promise((resolve, reject) => {
      const w = new Worker(workerUrl());
      this.worker?.terminate();
      this.worker = w;
      w.onmessage = (ev) => {
        const m = ev.data;
        if (m.type === "progress") onProgress?.(m.value);
        else if (m.type === "error") { w.terminate(); reject(new Error(m.message)); }
        else if (m.type === "done") {
          w.terminate(); this.worker = null;
          this.data = m;
          if (this.ok) this.upload();
          this.layerMin = 0;
          this.layerMax = Math.max(0, m.counts.layers - 1);
          this.fit();
          this.invalidate();
          this.onChange("loaded");
          resolve(m);
        }
      };
      w.onerror = (e) => reject(new Error(e.message || "The parser crashed"));
      w.postMessage({ buffer, keepTravel }, [buffer]);
    });
  }

  upload() {
    const gl = this.gl, d = this.data;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bExt);
    gl.bufferData(gl.ARRAY_BUFFER, d.ext, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bTrv);
    gl.bufferData(gl.ARRAY_BUFFER, d.trv, gl.STATIC_DRAW);
    let maxSpeed = 1;
    for (let i = 5; i < d.ext.length; i += 7 * 16) if (d.ext[i] > maxSpeed) maxSpeed = d.ext[i];
    this.speedMax = Math.max(60, Math.min(maxSpeed, 400));
  }

  get layerCount() { return this.data?.counts.layers || 0; }
  layerZ(i) { return this.data?.layers.z[Math.max(0, Math.min(i, this.layerCount - 1))]; }

  setMode(m) { this.mode = { layer: 0, speed: 1, type: 2, progress: 3 }[m] ?? 0; this.invalidate(); }
  setRange(min, max, solo = false) { this.layerMin = Math.max(0, min); this.layerMax = Math.min(Math.max(min, max), Math.max(0, this.layerCount - 1)); this.solo = solo; this.invalidate(); }
  setTravel(on) { this.showTravel = !!on; this.invalidate(); }
  setBedVisible(on) { this.showBed = !!on; this.invalidate(); }
  setFilepos(pos) { this.filepos = pos || 0; this.invalidate(); }

  /** Layer index and position of the head at a byte offset, found by binary search on the segments. */
  headAt(filepos) {
    const d = this.data;
    if (!d || !d.counts.ext) return null;
    const e = d.ext;
    let lo = 0, hi = d.counts.ext - 1, ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (e[mid * 14 + 4] <= filepos) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    const o = ans * 14;
    return { x: e[o + 7], y: e[o + 8], z: e[o + 9], layer: e[o + 10] };
  }

  // ~~ camera ~~
  fit() {
    const d = this.data;
    let c, diag;
    if (d) {
      const [a, b, s, x, y, z] = d.bbox;
      c = [(a + x) / 2, (b + y) / 2, (s + z) / 2];
      diag = Math.hypot(x - a, y - b, z - s);
    } else {
      c = [this.bed.origin === "center" ? 0 : this.bed.w / 2, this.bed.origin === "center" ? 0 : this.bed.d / 2, 0];
      diag = Math.hypot(this.bed.w, this.bed.d);
    }
    this.cam.target = [c[0], c[2], -c[1]];
    this.cam.dist = Math.max(30, diag * 1.35);
    this.center = c;
  }
  preset(name) {
    this.fit();
    if (name === "top") { this.cam.theta = -1.5708; this.cam.phi = 1.5; }
    else if (name === "front") { this.cam.theta = -1.5708; this.cam.phi = 0.12; }
    else if (name === "side") { this.cam.theta = 0; this.cam.phi = 0.12; }
    else { this.cam.theta = -0.75; this.cam.phi = 0.62; }
    this.invalidate();
  }

  matrix() {
    const c = this.cam, cp = Math.cos(c.phi), sp = Math.sin(c.phi);
    const eye = [c.target[0] + c.dist * cp * Math.cos(c.theta), c.target[1] + c.dist * sp, c.target[2] - c.dist * cp * Math.sin(c.theta)];
    // theta measured from +x toward the viewer; keep "front" facing the camera at theta = -pi/2
    const view = mat.lookAt(eye, c.target, [0, 1, 0]);
    const aspect = this.canvas.width / Math.max(1, this.canvas.height);
    return mat.mul(mat.perspective(0.75, aspect, Math.max(1, c.dist * 0.02), c.dist * 12), view);
  }

  // ~~ input ~~
  bind() {
    const cv = this.canvas;
    const pts = new Map();
    let last = null, pinch = null;
    cv.style.touchAction = "none";
    cv.addEventListener("pointerdown", (e) => { cv.setPointerCapture(e.pointerId); pts.set(e.pointerId, e); last = { x: e.clientX, y: e.clientY, btn: e.button, shift: e.shiftKey }; pinch = null; });
    cv.addEventListener("pointermove", (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, e);
      if (pts.size >= 2) {
        const [a, b] = [...pts.values()];
        const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        const mid = { x: (a.clientX + b.clientX) / 2, y: (a.clientY + b.clientY) / 2 };
        if (pinch) { this.zoom(pinch.dist / dist); this.pan(mid.x - pinch.mid.x, mid.y - pinch.mid.y); }
        pinch = { dist, mid };
        return;
      }
      if (!last) return;
      const dx = e.clientX - last.x, dy = e.clientY - last.y;
      last.x = e.clientX; last.y = e.clientY;
      if (last.btn === 2 || last.btn === 1 || last.shift || e.shiftKey) this.pan(dx, dy);
      else { this.cam.theta -= dx * 0.008; this.cam.phi = Math.max(0.03, Math.min(1.55, this.cam.phi + dy * 0.008)); this.invalidate(); }
    });
    const up = (e) => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; if (!pts.size) last = null; };
    cv.addEventListener("pointerup", up); cv.addEventListener("pointercancel", up);
    cv.addEventListener("wheel", (e) => { e.preventDefault(); this.zoom(Math.exp(e.deltaY * 0.0012)); }, { passive: false });
    cv.addEventListener("contextmenu", (e) => e.preventDefault());
    cv.addEventListener("dblclick", () => this.preset("iso"));
  }
  zoom(f) { this.cam.dist = Math.max(20, Math.min(3000, this.cam.dist * f)); this.invalidate(); }
  pan(dx, dy) {
    const c = this.cam, k = c.dist * 0.0016;
    // the scene follows the finger: move the camera target opposite to the drag
    const rx = Math.sin(c.theta), rz = Math.cos(c.theta);
    c.target[0] += dx * rx * k; c.target[2] += dx * rz * k;
    c.target[1] += dy * k;
    this.invalidate();
  }

  // ~~ drawing ~~
  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr)), h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) { this.canvas.width = w; this.canvas.height = h; }
    this.invalidate();
  }
  invalidate() { this.dirty = true; }
  loop() {
    if (this.destroyed) return;
    if (this.dirty && this.ok) { this.dirty = false; try { this.draw(); } catch (e) { console.error("[viewer]", e); } }
    requestAnimationFrame(this.loop);
  }

  draw() {
    const gl = this.gl;
    if (this.canvas.width < 2) this.resize();
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const mvp = this.matrix();

    // bed
    if (this.showBed) {
      gl.useProgram(this.pSimple);
      gl.uniformMatrix4fv(this.uSimple.uMVP, false, mvp);
      gl.uniform1f(this.uSimple.uSize, 1);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.bBed);
      const aPos = gl.getAttribLocation(this.pSimple, "aPos");
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 12, 0);
      gl.uniform4f(this.uSimple.uColor, 1, 1, 1, 0.07);
      gl.drawArrays(gl.LINES, this.nBedOutline, this.nBed - this.nBedOutline);
      gl.uniform4f(this.uSimple.uColor, 1, 1, 1, 0.32);
      gl.drawArrays(gl.LINES, 0, this.nBedOutline);
    }

    const d = this.data;
    if (!d) return;

    // travel moves
    if (this.showTravel && d.counts.trv) {
      const L = d.layers;
      const first = L.trv[this.layerMin] * 2;
      const end = (this.layerMax + 1 < L.trv.length ? L.trv[this.layerMax + 1] : d.counts.trv) * 2;
      gl.useProgram(this.pSimple);
      gl.uniformMatrix4fv(this.uSimple.uMVP, false, mvp);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.bTrv);
      const aPos = gl.getAttribLocation(this.pSimple, "aPos");
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 12, 0);
      gl.uniform4f(this.uSimple.uColor, 0.55, 0.6, 0.7, 0.22);
      gl.drawArrays(gl.LINES, first, end - first);
    }

    // extrusion
    gl.useProgram(this.pExt);
    const u = this.uExt;
    gl.uniformMatrix4fv(u.uMVP, false, mvp);
    gl.uniform1f(u.uMode, this.mode);
    gl.uniform1f(u.uLayers, d.counts.layers);
    gl.uniform1f(u.uFilepos, this.filepos);
    gl.uniform1f(u.uSpeedMax, this.speedMax || 200);
    gl.uniform3fv(u.uColA, cssColor("--accent", [0.4, 1, 0]));
    gl.uniform3fv(u.uColB, cssColor("--accent-2", [1, 0.2, 0.8]));
    TYPE_COLORS.forEach((c, i) => gl.uniform3fv(u[`uT${i}`], c));
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bExt);
    const aPos = gl.getAttribLocation(this.pExt, "aPos"), aMeta = gl.getAttribLocation(this.pExt, "aMeta");
    gl.enableVertexAttribArray(aPos); gl.enableVertexAttribArray(aMeta);
    gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 28, 0);
    gl.vertexAttribPointer(aMeta, 4, gl.FLOAT, false, 28, 12);
    const L = d.layers;
    const segStart = (i) => L.ext[i] * 2;
    const segEnd = (i) => (i + 1 < L.ext.length ? L.ext[i + 1] : d.counts.ext) * 2;
    const lo = this.solo ? this.layerMax : this.layerMin;
    gl.uniform1f(u.uHi, 0);
    gl.drawArrays(gl.LINES, segStart(lo), segEnd(this.layerMax) - segStart(lo));
    // the top visible layer gets a brighter pass so you can see where you are
    if (!this.solo && this.layerMax > this.layerMin) {
      gl.uniform1f(u.uHi, 1);
      gl.drawArrays(gl.LINES, segStart(this.layerMax), segEnd(this.layerMax) - segStart(this.layerMax));
    }

    // nozzle marker in progress mode
    if (this.mode === 3 && this.filepos > 0) {
      const h = this.headAt(this.filepos);
      if (h) {
        gl.useProgram(this.pSimple);
        gl.uniformMatrix4fv(this.uSimple.uMVP, false, mvp);
        gl.bindBuffer(gl.ARRAY_BUFFER, this.bMark);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([h.x, h.y, h.z, h.x, h.y, 0]), gl.DYNAMIC_DRAW);
        const p = gl.getAttribLocation(this.pSimple, "aPos");
        gl.enableVertexAttribArray(p);
        gl.vertexAttribPointer(p, 3, gl.FLOAT, false, 12, 0);
        gl.uniform4f(this.uSimple.uColor, 1, 1, 1, 0.35);
        gl.drawArrays(gl.LINES, 0, 2);
        gl.uniform4f(this.uSimple.uColor, 1, 1, 1, 1);
        gl.uniform1f(this.uSimple.uSize, 9 * Math.min(window.devicePixelRatio || 1, 2));
        gl.drawArrays(gl.POINTS, 0, 1);
      }
    }
  }

  destroy() {
    this.destroyed = true;
    this.ro?.disconnect();
    this.worker?.terminate();
    if (this.ok) {
      const gl = this.gl;
      [this.bExt, this.bTrv, this.bBed, this.bMark].forEach((b) => gl.deleteBuffer(b));
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    }
  }
}

/** Fetch a file with progress. Resolves to an ArrayBuffer. */
export async function fetchBuffer(url, onProgress, maxBytes = 160 * 1024 * 1024) {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`The file couldn't be downloaded (HTTP ${res.status}).`);
  const total = Number(res.headers.get("content-length")) || 0;
  if (total && total > maxBytes) throw new Error(`This file is ${(total / 1048576).toFixed(0)} MB, which is too large to preview in a browser.`);
  if (!res.body?.getReader) return res.arrayBuffer();
  const reader = res.body.getReader();
  const chunks = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    if (got > maxBytes) throw new Error("This file is too large to preview in a browser.");
    if (total) onProgress?.(got / total);
  }
  const out = new Uint8Array(got);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out.buffer;
}
