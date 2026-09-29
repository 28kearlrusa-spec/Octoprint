// Live isometric schematic of a Voron-style cube printer.
//   * the bed glows with its temperature and drops as Z climbs (moving-bed kinematics)
//   * the part grows on the bed as the print height increases
//   * the gantry, X beam and toolhead follow the head position
//   * the chamber tints the whole cube as it warms up; the toolhead LED shows machine status
//
// Projection: x runs down-right, y runs up-right, z runs up.
const COS = 0.8660254, SIN = 0.5;
const NS = "http://www.w3.org/2000/svg";

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;

export class Machine {
  constructor(host) {
    this.host = host;
    this.model = null;
    this.geom = null;
    this.build();
  }

  // ~~ geometry ~~
  setup(volume, kin) {
    const W = volume.w, D = volume.d, H = volume.h;
    const g = {
      W, D, H, kin,
      Wf: W + 100, Df: D + 100, Hf: H + 150,
    };
    g.ox = (g.Wf - W) / 2;
    g.oy = (g.Df - D) / 2;
    g.zTop = g.Hf - 30;                 // height of the X beam
    g.headH = 46;                       // beam to nozzle tip
    // scale so the whole cube fits the viewBox
    const sw = (g.Wf + g.Df) * COS, sh = (g.Wf + g.Df) * SIN + g.Hf;
    g.s = Math.min(560 / sw, 500 / sh);
    g.pad = 30;
    g.vbw = sw * g.s + g.pad * 2;
    g.vbh = sh * g.s + g.pad * 2;
    this.geom = g;
  }

  /** Frame coordinates (mm) -> viewBox coordinates. */
  pt(x, y, z) {
    const g = this.geom;
    return [
      g.pad + (x + y) * COS * g.s,
      g.pad + ((x - y) * SIN - z + g.Df * SIN + g.Hf) * g.s,
    ];
  }

  path(points, close = true) {
    return points.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ") + (close ? " Z" : "");
  }

  el(tag, attrs = {}, parent) {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    parent?.appendChild(e);
    return e;
  }

  // ~~ build once, update often ~~
  build() {
    this.svg = this.el("svg", { class: "machine", role: "img", "aria-label": "Printer schematic" });
    this.defs = this.el("defs", {}, this.svg);
    this.layers = {};
    for (const name of ["floor", "tint", "back", "bed", "part", "gantry", "front"]) {
      this.layers[name] = this.el("g", { class: `m-${name}` }, this.svg);
    }
    this.host.append(this.svg);
    this.lastVolume = "";
  }

  rebuild(volume, kin) {
    const key = `${volume.w}x${volume.d}x${volume.h}|${kin}`;
    if (key === this.lastVolume) return;
    this.lastVolume = key;
    this.setup(volume, kin);
    const g = this.geom;
    this.svg.setAttribute("viewBox", `0 0 ${g.vbw.toFixed(0)} ${g.vbh.toFixed(0)}`);
    for (const l of Object.values(this.layers)) l.replaceChildren();
    this.defs.replaceChildren();
    const P = (x, y, z) => this.pt(x, y, z);

    // gradients + glow filters
    this.defs.innerHTML = `
      <linearGradient id="mf-part" x1="0" y1="1" x2="0" y2="0">
        <stop offset="0" stop-color="var(--accent)"/><stop offset="1" stop-color="var(--accent-2)"/>
      </linearGradient>
      <linearGradient id="mf-sheen" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#fff" stop-opacity=".07"/><stop offset=".5" stop-color="#fff" stop-opacity=".015"/><stop offset="1" stop-color="#fff" stop-opacity=".05"/>
      </linearGradient>
      <filter id="mf-blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${(7 * g.s * 1.6).toFixed(1)}"/></filter>
      <filter id="mf-blur-s" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${(3 * g.s * 1.6).toFixed(1)}"/></filter>`;

    // floor shadow
    this.el("path", { class: "m-shadow", d: this.path([P(0, 0, 0), P(g.Wf, 0, 0), P(g.Wf, g.Df, 0), P(0, g.Df, 0)]) }, this.layers.floor);

    // chamber tint: five faces (no lid) so the interior can be seen from above
    this.tintFaces = [
      [P(0, 0, 0), P(g.Wf, 0, 0), P(g.Wf, 0, g.Hf), P(0, 0, g.Hf)],
      [P(g.Wf, 0, 0), P(g.Wf, g.Df, 0), P(g.Wf, g.Df, g.Hf), P(g.Wf, 0, g.Hf)],
      [P(0, g.Df, 0), P(g.Wf, g.Df, 0), P(g.Wf, g.Df, g.Hf), P(0, g.Df, g.Hf)],
      [P(0, 0, 0), P(0, g.Df, 0), P(0, g.Df, g.Hf), P(0, 0, g.Hf)],
      [P(0, 0, 0), P(g.Wf, 0, 0), P(g.Wf, g.Df, 0), P(0, g.Df, 0)],
    ].map((pts) => this.el("path", { class: "m-tintface", d: this.path(pts) }, this.layers.tint));

    // far edges (dim), drawn behind everything
    const edge = (a, b, cls, parent) => this.el("path", { class: cls, d: this.path([a, b], false) }, parent);
    edge(P(0, g.Df, 0), P(g.Wf, g.Df, 0), "m-edge m-far", this.layers.back);
    edge(P(0, 0, 0), P(0, g.Df, 0), "m-edge m-far", this.layers.back);
    edge(P(0, g.Df, 0), P(0, g.Df, g.Hf), "m-edge m-far", this.layers.back);
    edge(P(0, g.Df, g.Hf), P(g.Wf, g.Df, g.Hf), "m-edge m-far", this.layers.back);
    edge(P(0, 0, g.Hf), P(0, g.Df, g.Hf), "m-edge m-far", this.layers.back);

    // bed
    this.bed = {};
    this.bed.glow = this.el("path", { class: "m-bedglow", filter: "url(#mf-blur)" }, this.layers.bed);
    this.bed.plate = this.el("path", { class: "m-bed" }, this.layers.bed);
    this.bed.grid = this.el("path", { class: "m-bedgrid" }, this.layers.bed);
    this.bed.side = this.el("path", { class: "m-bedside" }, this.layers.bed);

    // part
    this.part = {
      left: this.el("path", { class: "m-partface m-part-l" }, this.layers.part),
      right: this.el("path", { class: "m-partface m-part-r" }, this.layers.part),
      top: this.el("path", { class: "m-partface m-part-t" }, this.layers.part),
    };

    // gantry: Y rails, X beam, toolhead
    this.gantry = {
      railL: this.el("path", { class: "m-rail" }, this.layers.gantry),
      railR: this.el("path", { class: "m-rail" }, this.layers.gantry),
      beam: this.el("path", { class: "m-beam" }, this.layers.gantry),
      beamHi: this.el("path", { class: "m-beamhi" }, this.layers.gantry),
    };
    this.head = {
      g: this.el("g", { class: "m-head" }, this.layers.gantry),
    };
    this.head.glow = this.el("circle", { class: "m-noz-glow", r: 6, filter: "url(#mf-blur-s)" }, this.head.g);
    this.head.nozzle = this.el("path", { class: "m-nozzle" }, this.head.g);
    this.head.left = this.el("path", { class: "m-headface m-head-l" }, this.head.g);
    this.head.right = this.el("path", { class: "m-headface m-head-r" }, this.head.g);
    this.head.top = this.el("path", { class: "m-headface m-head-t" }, this.head.g);
    this.head.led = this.el("path", { class: "m-led" }, this.head.g);
    this.head.tip = this.el("circle", { class: "m-noz-tip", r: 2.2 }, this.head.g);

    // front panels (acrylic) and near edges (bright)
    const front = [
      [P(0, 0, 0), P(g.Wf, 0, 0), P(g.Wf, 0, g.Hf), P(0, 0, g.Hf)],
      [P(g.Wf, 0, 0), P(g.Wf, g.Df, 0), P(g.Wf, g.Df, g.Hf), P(g.Wf, 0, g.Hf)],
    ];
    front.forEach((pts) => this.el("path", { class: "m-panel", d: this.path(pts), fill: "url(#mf-sheen)" }, this.layers.front));
    // door handle on the front panel
    const hx = g.Wf * 0.5;
    this.el("path", { class: "m-handle", d: this.path([P(hx - 30, 0, g.Hf * 0.5 + 40), P(hx - 30, 0, g.Hf * 0.5 - 40)], false) }, this.layers.front);
    this.el("path", { class: "m-handle", d: this.path([P(hx + 30, 0, g.Hf * 0.5 + 40), P(hx + 30, 0, g.Hf * 0.5 - 40)], false) }, this.layers.front);

    const near = [
      [P(0, 0, 0), P(g.Wf, 0, 0)], [P(g.Wf, 0, 0), P(g.Wf, g.Df, 0)],
      [P(0, 0, g.Hf), P(g.Wf, 0, g.Hf)], [P(g.Wf, 0, g.Hf), P(g.Wf, g.Df, g.Hf)],
      [P(0, 0, 0), P(0, 0, g.Hf)], [P(g.Wf, 0, 0), P(g.Wf, 0, g.Hf)], [P(g.Wf, g.Df, 0), P(g.Wf, g.Df, g.Hf)],
    ];
    near.forEach(([a, b]) => {
      this.el("path", { class: "m-edge m-extr", d: this.path([a, b], false) }, this.layers.front);
      this.el("path", { class: "m-edge m-extr-hi", d: this.path([a, b], false) }, this.layers.front);
    });
    // corner brackets
    [[0, 0], [g.Wf, 0], [g.Wf, g.Df]].forEach(([x, y]) => {
      [0, g.Hf].forEach((z) => this.el("circle", { class: "m-bolt", cx: this.pt(x, y, z)[0], cy: this.pt(x, y, z)[1], r: 3.2 }, this.layers.front));
    });

    if (this.model) this.draw(this.model);
  }

  /**
   * model: {volume:{w,d,h}, kin, nozzle:{a,t}, bed:{a,t}, chamber:{a,t}, pos:{x,y,z}|null,
   *         z, part:{w,d,cx,cy,h}|null, state, online}
   */
  /** Public entry: eases the head toward new positions instead of teleporting it. */
  update(m) {
    this.model = m;
    const target = m.pos ? { x: m.pos.x, y: m.pos.y } : null;
    if (target && this.shown && (Math.abs(target.x - this.shown.x) > 0.05 || Math.abs(target.y - this.shown.y) > 0.05) && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      this.ease = { from: { ...this.shown }, to: target, t0: performance.now(), dur: 1400 };
      if (!this.raf) this.raf = requestAnimationFrame((t) => this.tick(t));
      this.draw({ ...m, pos: { ...m.pos, ...this.shown } });
      return;
    }
    this.ease = null;
    this.shown = target;
    this.draw(m);
  }

  tick(now) {
    this.raf = null;
    const e = this.ease;
    if (!e || !this.model) return;
    const k = Math.min(1, (now - e.t0) / e.dur);
    const eased = 1 - Math.pow(1 - k, 3);
    this.shown = { x: e.from.x + (e.to.x - e.from.x) * eased, y: e.from.y + (e.to.y - e.from.y) * eased };
    this.draw({ ...this.model, pos: { ...this.model.pos, ...this.shown } });
    if (k < 1) this.raf = requestAnimationFrame((t) => this.tick(t));
    else this.ease = null;
  }

  draw(m) {
    const vol = m.volume || { w: 250, d: 250, h: 250 };
    this.rebuild(vol, m.kin || "bed-z");
    const g = this.geom;
    const P = (x, y, z) => this.pt(x, y, z);
    const svg = this.svg;
    svg.dataset.state = m.state || "offline";
    svg.classList.toggle("is-offline", !m.online);

    // temperatures -> glow levels
    const heat = (h, cold, hot) => (h && h.a != null ? clamp((h.a - cold) / (hot - cold), 0, 1) : 0);
    const bedHeat = heat(m.bed, 32, 110);
    const nozHeat = heat(m.nozzle, 40, 260);
    const chHeat = heat(m.chamber, 27, 65);
    svg.style.setProperty("--bed-heat", bedHeat.toFixed(3));
    svg.style.setProperty("--noz-heat", nozHeat.toFixed(3));
    svg.style.setProperty("--ch-heat", chHeat.toFixed(3));
    svg.style.setProperty("--bed-target", m.bed?.t > 0 ? 1 : 0);

    // z positions in frame coordinates
    const z = clamp(m.z ?? m.pos?.z ?? 0, 0, vol.h);
    let zNoz, zBed;
    if ((m.kin || "bed-z") === "bed-z") {
      zNoz = g.zTop - g.headH;
      zBed = clamp(zNoz - z, 40, g.zTop);
    } else {
      zBed = 40;
      zNoz = zBed + z;
    }
    const zBeam = zNoz + g.headH;

    // bed
    const bx0 = g.ox, bx1 = g.ox + g.W, by0 = g.oy, by1 = g.oy + g.D;
    const corners = [P(bx0, by0, zBed), P(bx1, by0, zBed), P(bx1, by1, zBed), P(bx0, by1, zBed)];
    this.bed.plate.setAttribute("d", this.path(corners));
    this.bed.glow.setAttribute("d", this.path(corners));
    this.bed.side.setAttribute("d", this.path([P(bx0, by0, zBed), P(bx1, by0, zBed), P(bx1, by0, zBed - 12), P(bx0, by0, zBed - 12)]) + " " +
      this.path([P(bx1, by0, zBed), P(bx1, by1, zBed), P(bx1, by1, zBed - 12), P(bx1, by0, zBed - 12)]));
    // 4x4 probe-point grid on the plate
    let grid = "";
    for (let i = 1; i < 4; i++) {
      const t = i / 4;
      grid += this.path([P(bx0 + g.W * t, by0, zBed), P(bx0 + g.W * t, by1, zBed)], false) + " ";
      grid += this.path([P(bx0, by0 + g.D * t, zBed), P(bx1, by0 + g.D * t, zBed)], false) + " ";
    }
    this.bed.grid.setAttribute("d", grid);

    // part on the bed
    const part = m.part;
    const pz = clamp(z, 0, part?.h || vol.h);
    if (part && pz > 0.05) {
      const px0 = g.ox + part.cx - part.w / 2, px1 = g.ox + part.cx + part.w / 2;
      const py0 = g.oy + part.cy - part.d / 2, py1 = g.oy + part.cy + part.d / 2;
      const top = zBed + pz;
      this.part.left.setAttribute("d", this.path([P(px0, py0, zBed), P(px1, py0, zBed), P(px1, py0, top), P(px0, py0, top)]));
      this.part.right.setAttribute("d", this.path([P(px1, py0, zBed), P(px1, py1, zBed), P(px1, py1, top), P(px1, py0, top)]));
      this.part.top.setAttribute("d", this.path([P(px0, py0, top), P(px1, py0, top), P(px1, py1, top), P(px0, py1, top)]));
      this.layers.part.style.opacity = 1;
      // fill by height fraction so the brand gradient reads as "progress"
      const frac = clamp(pz / (part.h || vol.h), 0, 1);
      svg.style.setProperty("--part-frac", frac.toFixed(3));
    } else this.layers.part.style.opacity = 0;

    // gantry
    const hx = m.pos?.x != null ? clamp(m.pos.x, 0, g.W) : g.W / 2;
    const hy = m.pos?.y != null ? clamp(m.pos.y, 0, g.D) : g.D / 2;
    const X = g.ox + hx, Y = g.oy + hy;
    const railX0 = g.ox - 14, railX1 = g.ox + g.W + 14;
    this.gantry.railL.setAttribute("d", this.path([P(railX0, g.oy - 10, zBeam), P(railX0, g.oy + g.D + 10, zBeam)], false));
    this.gantry.railR.setAttribute("d", this.path([P(railX1, g.oy - 10, zBeam), P(railX1, g.oy + g.D + 10, zBeam)], false));
    this.gantry.beam.setAttribute("d", this.path([P(railX0, Y, zBeam), P(railX1, Y, zBeam)], false));
    this.gantry.beamHi.setAttribute("d", this.path([P(railX0, Y, zBeam + 3), P(railX1, Y, zBeam + 3)], false));

    // toolhead: small box under the beam, nozzle below it
    const hw = 30, hd = 36, hh = 34;
    const hz1 = zBeam, hz0 = zBeam - hh;
    const x0 = X - hw / 2, x1 = X + hw / 2, y0 = Y - hd / 2, y1 = Y + hd / 2;
    this.head.left.setAttribute("d", this.path([P(x0, y0, hz0), P(x1, y0, hz0), P(x1, y0, hz1), P(x0, y0, hz1)]));
    this.head.right.setAttribute("d", this.path([P(x1, y0, hz0), P(x1, y1, hz0), P(x1, y1, hz1), P(x1, y0, hz1)]));
    this.head.top.setAttribute("d", this.path([P(x0, y0, hz1), P(x1, y0, hz1), P(x1, y1, hz1), P(x0, y1, hz1)]));
    this.head.led.setAttribute("d", this.path([P(x0 + 5, y0, hz0 + 7), P(x1 - 5, y0, hz0 + 7), P(x1 - 5, y0, hz0 + 12), P(x0 + 5, y0, hz0 + 12)]));
    const tip = P(X, Y, zNoz);
    const base = P(X, Y, hz0);
    this.head.nozzle.setAttribute("d", this.path([P(X - 4, Y, hz0), P(X + 4, Y, hz0), P(X, Y, zNoz)]));
    this.head.tip.setAttribute("cx", tip[0]); this.head.tip.setAttribute("cy", tip[1]);
    this.head.glow.setAttribute("cx", tip[0]); this.head.glow.setAttribute("cy", tip[1]);
    this.head.glow.setAttribute("r", (5 + nozHeat * 8) * g.s * 1.6);
    this.head.g.dataset.base = base.join(",");

    // chamber tint
    for (const f of this.tintFaces) f.style.opacity = (0.02 + chHeat * 0.2).toFixed(3);
  }
}
