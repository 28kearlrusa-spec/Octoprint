# coding=utf-8
"""Builds a layer map for a G-code file: where each layer starts (byte offset), its Z height
and how much filament has been pushed by then.

OctoPrint reports progress as a byte position in the file, so this map turns "byte 4,812,330"
into "layer 87 of 318" for any slicer, without needing slicer-specific comments.

This module is run as a *separate, low-priority process* (see LayerService) so scanning a big
file can never steal time from Klipper or OctoPrint's serial thread on a small computer:

    python -m octoprint_makerforge.layer_scan <gcode> <output.json>
"""
from __future__ import absolute_import

import json
import os
import re
import sys
import time

_Z = re.compile(rb"Z(-?\d*\.?\d+)")
_E = re.compile(rb"E(-?\d*\.?\d+)")
_X = re.compile(rb"X(-?\d*\.?\d+)")
_Y = re.compile(rb"Y(-?\d*\.?\d+)")

MOVES = (b"G0", b"G1", b"G2", b"G3")
MIN_LAYER_STEP = 0.04     # ignore Z creeps smaller than this (vase mode, spiralize)
MAX_LAYERS = 20000
EPS = 1e-4


def scan(path, progress=None):
    """Return the layer map dict for `path`."""
    size = os.path.getsize(path)
    layers = []                 # [z, offset, filament_mm_at_start]
    layer_z = None
    z = 0.0
    x = y = 0.0
    e_pos = 0.0
    e_total = 0.0
    relative_e = False
    relative_xyz = False
    z_line_offset = None        # offset of the first Z move since the last extrusion
    min_x = min_y = float("inf")
    max_x = max_y = float("-inf")
    max_z = 0.0
    offset = 0
    count = 0

    with open(path, "rb") as fh:
        for raw in fh:
            line_offset = offset
            offset += len(raw)
            count += 1
            if progress and count % 20000 == 0:
                progress(offset / float(size) if size else 1.0)

            if not raw or raw[:1] == b";":
                continue
            if b";" in raw:
                raw = raw.split(b";", 1)[0]
            word = raw[:3].rstrip()
            if word == b"G90":
                relative_xyz = False
                continue
            if word == b"G91":
                relative_xyz = True
                continue
            if word == b"M82":
                relative_e = False
                continue
            if word == b"M83":
                relative_e = True
                continue
            if word == b"G92":
                m = _E.search(raw)
                if m:
                    e_pos = float(m.group(1))
                m = _Z.search(raw)
                if m:
                    z = float(m.group(1))
                continue
            if word not in MOVES:
                continue

            mz = _Z.search(raw)
            if mz:
                v = float(mz.group(1))
                z = z + v if relative_xyz else v
                if z_line_offset is None:
                    z_line_offset = line_offset
            mx = _X.search(raw)
            if mx:
                v = float(mx.group(1))
                x = x + v if relative_xyz else v
            my = _Y.search(raw)
            if my:
                v = float(my.group(1))
                y = y + v if relative_xyz else v

            me = _E.search(raw)
            if not me:
                continue
            ev = float(me.group(1))
            if relative_e:
                delta = ev
                e_pos += ev
            else:
                delta = ev - e_pos
                e_pos = ev
            if delta <= 0.0:
                continue                      # retraction or a pure travel move
            e_before = e_total
            e_total += delta

            # an extruding move: track extents and detect a new layer
            if z > EPS:                       # ignore priming lines drawn at Z=0
                if x < min_x: min_x = x
                if x > max_x: max_x = x
                if y < min_y: min_y = y
                if y > max_y: max_y = y
                if z > max_z: max_z = z
                if (layer_z is None or (z - layer_z) >= MIN_LAYER_STEP) and len(layers) < MAX_LAYERS:
                    start = z_line_offset if z_line_offset is not None else line_offset
                    if not layers or start > layers[-1][1]:
                        layers.append([round(z, 4), start, round(e_before, 2)])
                        layer_z = z
            z_line_offset = None

    bbox = None
    if min_x != float("inf"):
        bbox = [round(min_x, 2), round(max_x, 2), round(min_y, 2), round(max_y, 2)]
    return {
        "version": 1,
        "size": size,
        "count": len(layers),
        "height": round(max_z, 3),
        "filamentMm": round(e_total, 1),
        "bbox": bbox,
        "layers": layers,
    }


def main(argv):
    if len(argv) != 3:
        sys.stderr.write("usage: layer_scan <gcode> <output.json>\n")
        return 2
    src, out = argv[1], argv[2]
    try:
        os.nice(15)          # polite: let Klipper and OctoPrint have the CPU
    except (AttributeError, OSError):
        pass
    started = time.time()
    result = scan(src)
    result["mtime"] = os.path.getmtime(src)
    result["scanSeconds"] = round(time.time() - started, 2)
    tmp = out + ".tmp"
    with open(tmp, "w") as fh:
        json.dump(result, fh, separators=(",", ":"))
    os.replace(tmp, out)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
