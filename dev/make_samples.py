#!/usr/bin/env python3
"""Generates sample G-code files (with thumbnails and slicer-style comments) for testing the UI.

    python3 dev/make_samples.py            # writes dev/samples/*.gcode

The shapes are simple on purpose (a cube, a twisted vase, a stepped tower) but the files are
structured like real slicer output: layer-change comments, Z-hops, retractions, relative or
absolute extrusion, summary footers and embedded PNG thumbnails.
"""
import base64
import math
import os
import struct
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "samples")


# ~~ tiny PNG writer (no dependencies) ~~
def png(width, height, pixel):
    raw = bytearray()
    for y in range(height):
        raw.append(0)
        for x in range(width):
            raw.extend(pixel(x, y))

    def chunk(kind, data):
        c = struct.pack(">I", len(data)) + kind + data
        return c + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(bytes(raw), 9))
        + chunk(b"IEND", b"")
    )


def thumb(width, height, kind="cube"):
    def px(x, y):
        # dark plate with a lit shape in the middle, tinted lime -> pink like the brand
        u, v = x / width, y / height
        base = (18, 18, 22, 255)
        inside = False
        if kind == "cube":
            inside = 0.28 < u < 0.72 and 0.22 < v < 0.8
        elif kind == "vase":
            r = 0.16 + 0.05 * math.sin(v * 9)
            inside = abs(u - 0.5) < r and 0.15 < v < 0.85
        else:
            inside = (0.3 < u < 0.7 and 0.6 < v < 0.85) or (0.38 < u < 0.62 and 0.4 < v < 0.6) or (0.44 < u < 0.56 and 0.2 < v < 0.4)
        if not inside:
            return (base[0] + int(10 * v), base[1] + int(8 * v), base[2] + int(14 * v), 255)
        t = v
        return (int(102 + (255 - 102) * t), int(255 + (51 - 255) * t), int(0 + 204 * t), 255)

    return png(width, height, px)


def thumb_block(data, w, h, kind="thumbnail"):
    b64 = base64.b64encode(data).decode()
    lines = ["; %s begin %dx%d %d" % (kind, w, h, len(b64))]
    for i in range(0, len(b64), 78):
        lines.append("; " + b64[i : i + 78])
    lines.append("; %s end" % kind)
    return "\n".join(lines) + "\n"


# ~~ shapes: each returns a list of closed loops (lists of (x, y)) for a layer ~~
def circle(cx, cy, r, n=56, rot=0.0):
    return [(cx + r * math.cos(rot + 2 * math.pi * i / n), cy + r * math.sin(rot + 2 * math.pi * i / n)) for i in range(n)]


def square(cx, cy, s):
    h = s / 2
    return [(cx - h, cy - h), (cx + h, cy - h), (cx + h, cy + h), (cx - h, cy + h)]


class Writer:
    def __init__(self, bed=(350, 350), relative_e=True, flavor="prusa"):
        self.lines = []
        self.x = self.y = 0.0
        self.z = 0.0
        self.e = 0.0
        self.total_e = 0.0
        self.relative_e = relative_e
        self.flavor = flavor
        self.bed = bed
        self.layer_z = []

    def w(self, s):
        self.lines.append(s)

    def move(self, x, y, f=12000):
        self.w("G1 X%.3f Y%.3f F%d" % (x, y, f))
        self.x, self.y = x, y

    def extrude_to(self, x, y, f=2400, width=0.45, h=0.2):
        d = math.hypot(x - self.x, y - self.y)
        de = d * width * h / (math.pi * 0.875 * 0.875) * 1.0
        self.total_e += de
        if self.relative_e:
            self.w("G1 X%.3f Y%.3f E%.5f F%d" % (x, y, de, f))
        else:
            self.e += de
            self.w("G1 X%.3f Y%.3f E%.5f F%d" % (x, y, self.e, f))
        self.x, self.y = x, y

    def retract(self, mm=0.8):
        if self.relative_e:
            self.w("G1 E-%.2f F2100" % mm)
        else:
            self.e -= mm
            self.w("G1 E%.5f F2100" % self.e)

    def unretract(self, mm=0.8):
        if self.relative_e:
            self.w("G1 E%.2f F1500" % mm)
        else:
            self.e += mm
            self.w("G1 E%.5f F1500" % self.e)

    def travel_z(self, z, hop=0.4):
        self.retract()
        self.w("G1 Z%.3f F600" % (z + hop))
        self.z = z + hop

    def drop_z(self, z):
        self.w("G1 Z%.3f F600" % z)
        self.z = z
        self.unretract()

    def loop(self, pts, speed=2400):
        self.move(*pts[0])
        for p in pts[1:] + [pts[0]]:
            self.extrude_to(*p, f=speed)

    def infill(self, x0, y0, x1, y1, spacing=2.4, angle=0):
        y = y0
        flip = False
        while y < y1:
            a, b = ((x0, y), (x1, y)) if not flip else ((x1, y), (x0, y))
            self.move(*a)
            self.extrude_to(*b, f=4200)
            y += spacing
            flip = not flip


def prusa_like(name, layers, shape, kind, layer_h=0.2, nozzle=210, bed_t=60, relative_e=True, orca=False):
    wr = Writer(relative_e=relative_e)
    head = []
    if orca:
        head.append("; HEADER_BLOCK_START\n; OrcaSlicer 2.1.1\n; total layer number: %d\n; HEADER_BLOCK_END\n" % layers)
        head.append("; generated by OrcaSlicer 2.1.1 on 2026-09-28 at 20:11:32 UTC\n")
    else:
        head.append("; generated by PrusaSlicer 2.7.4 on 2026-09-28 at 19:58:11 UTC\n")
    head.append(thumb_block(thumb(48, 48, kind), 48, 48))
    head.append(thumb_block(thumb(220, 124, kind), 220, 124))
    head.append(thumb_block(thumb(300, 300, kind), 300, 300))
    wr.w("M107")
    wr.w("PRINT_START BED=%d EXTRUDER=%d CHAMBER=0" % (bed_t, nozzle))
    wr.w("G21\nG90\n%s\nG92 E0" % ("M83" if relative_e else "M82"))
    for i in range(layers):
        z = round(layer_h * (i + 1), 3)
        wr.layer_z.append(z)
        wr.w(";LAYER_CHANGE\n;Z:%.3f\n;HEIGHT:%.2f" % (z, layer_h))
        if not relative_e:
            wr.e = 0.0
            wr.w("G92 E0.0")
        loops, box = shape(i, z)
        wr.travel_z(z)
        wr.move(*loops[0][0])
        wr.drop_z(z)
        wr.w(";TYPE:Perimeter")
        for lp in loops:
            wr.loop(lp, speed=2100)
        if box:
            wr.w(";TYPE:Internal infill")
            wr.infill(*box)
    wr.w("PRINT_END")
    body = "\n".join(wr.lines) + "\n"
    filament_mm = wr.total_e
    grams = filament_mm * math.pi * 0.875 ** 2 * 1.24 / 1000
    seconds = int(layers * 41 + 300)
    foot = [
        "; filament used [mm] = %.2f\n" % filament_mm,
        "; filament used [cm3] = %.2f\n" % (filament_mm * math.pi * 0.875 ** 2 / 1000),
        "; filament used [g] = %.2f\n" % grams,
        "; total filament cost = %.2f\n" % (grams * 0.02),
        "; estimated printing time (normal mode) = %dh %dm %ds\n" % (seconds // 3600, seconds % 3600 // 60, seconds % 60),
        "\n; prusaslicer_config = begin\n",
        "; layer_height = %.2f\n; first_layer_height = 0.2\n; nozzle_diameter = 0.4\n" % layer_h,
        "; temperature = %d\n; first_layer_temperature = %d\n; bed_temperature = %d\n; first_layer_bed_temperature = %d\n" % (nozzle, nozzle + 5, bed_t, bed_t),
        "; filament_type = PLA\n; filament_settings_id = \"Polymaker PolyLite PLA\"\n; filament_colour = #66FF00\n",
        "; fill_density = 15%\n; support_material = 0\n; printer_model = VORON24\n",
        "; prusaslicer_config = end\n",
    ]
    return "".join(head) + body + "".join(foot), wr


def cube_shape(size=30, cx=175, cy=175):
    def shape(i, z):
        outer = square(cx, cy, size)
        inner = square(cx, cy, size - 0.9)
        h = size / 2 - 1.4
        return [outer, inner], (cx - h, cy - h, cx + h, cy + h)
    return shape


def vase_shape(cx=175, cy=175):
    def shape(i, z):
        r = 16 + 5 * math.sin(z * 0.35)
        return [circle(cx, cy, r, rot=z * 0.05), circle(cx, cy, r - 0.9, rot=z * 0.05)], None
    return shape


def tower_shape(cx=175, cy=175):
    def shape(i, z):
        size = 36 - (i // 40) * 8
        h = size / 2 - 1.4
        return [square(cx, cy, size), square(cx, cy, size - 0.9)], (cx - h, cy - h, cx + h, cy + h)
    return shape


def cura_like(name, layers, shape, layer_h=0.2):
    wr = Writer(relative_e=False)
    wr.w(";FLAVOR:Marlin\n;TIME:%d\n;Filament used: 0m\n;Layer height: %.2f\n;MINX:155\n;MINY:155\n;MINZ:0.2\n;MAXX:195\n;MAXY:195\n;MAXZ:%.2f\n;Generated with Cura_SteamEngine 5.7.1"
         % (layers * 38, layer_h, layers * layer_h))
    wr.w(";LAYER_COUNT:%d" % layers)
    wr.w("M140 S60\nM104 S205\nG28\nM190 S60\nM109 S205\nG21\nG90\nM82\nG92 E0")
    for i in range(layers):
        z = round(layer_h * (i + 1), 3)
        wr.w(";LAYER:%d" % i)
        loops, box = shape(i, z)
        wr.travel_z(z)
        wr.move(*loops[0][0])
        wr.drop_z(z)
        wr.w(";TYPE:WALL-OUTER")
        for lp in loops:
            wr.loop(lp, speed=1800)
        if box:
            wr.w(";TYPE:FILL")
            wr.infill(*box)
    wr.w("M104 S0\nM140 S0\nM84")
    text = "\n".join(wr.lines) + "\n;End of Gcode\n"
    return text.replace(";Filament used: 0m", ";Filament used: %.5fm" % (wr.total_e / 1000))


def main():
    os.makedirs(OUT, exist_ok=True)
    jobs = [
        ("voron-test-cube-30mm.gcode", prusa_like("cube", 150, cube_shape(), "cube")[0]),
        ("twisted-vase-orca.gcode", prusa_like("vase", 220, vase_shape(), "vase", orca=True, nozzle=215)[0]),
        ("stepped-tower-abs.gcode", prusa_like("tower", 200, tower_shape(), "tower", nozzle=250, bed_t=100, relative_e=True)[0]),
        ("cura-calibration-tower.gcode", cura_like("tower", 120, tower_shape())),
    ]
    for name, text in jobs:
        path = os.path.join(OUT, name)
        with open(path, "w") as fh:
            fh.write(text)
        print("%-34s %7.1f KB" % (name, os.path.getsize(path) / 1024.0))


if __name__ == "__main__":
    main()
