# coding=utf-8
"""Tests for the G-code metadata reader and the layer scanner.

    python -m unittest discover -s tests -v
"""
import json
import os
import subprocess
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# The modules under test have no OctoPrint dependency: load them straight from the package
# folder so the tests run with a plain Python (importing the package itself needs OctoPrint).
sys.path.insert(0, os.path.join(ROOT, "octoprint_makerforge"))

import gcode_meta  # noqa: E402
import layer_scan  # noqa: E402

SAMPLES = os.path.join(ROOT, "dev", "samples")


def sample(name):
    path = os.path.join(SAMPLES, name)
    if not os.path.exists(path):
        subprocess.check_call([sys.executable, os.path.join(ROOT, "dev", "make_samples.py")])
    return path


class DurationTests(unittest.TestCase):
    def test_formats(self):
        self.assertEqual(gcode_meta.parse_duration("1h 41m 12s"), 6072)
        self.assertEqual(gcode_meta.parse_duration("2d 3h"), 2 * 86400 + 3 * 3600)
        self.assertEqual(gcode_meta.parse_duration("6072"), 6072)
        self.assertEqual(gcode_meta.parse_duration("1:41:12"), 6072)
        self.assertEqual(gcode_meta.parse_duration("45s"), 45)
        self.assertIsNone(gcode_meta.parse_duration("soon"))
        self.assertIsNone(gcode_meta.parse_duration(None))


class SummaryTests(unittest.TestCase):
    def test_prusaslicer(self):
        info = gcode_meta.summarise(sample("voron-test-cube-30mm.gcode"))
        self.assertTrue(info["slicer"].startswith("PrusaSlicer"))
        self.assertEqual(info["layerHeight"], 0.2)
        self.assertEqual(info["nozzleDiameter"], 0.4)
        self.assertEqual(info["nozzleTemp"], 210)
        self.assertEqual(info["bedTemp"], 60)
        self.assertEqual(info["filamentType"], "PLA")
        self.assertEqual(info["filamentName"], "Polymaker PolyLite PLA")
        self.assertEqual(info["infill"], "15%")
        self.assertGreater(info["estimatedSeconds"], 3000)
        self.assertGreater(info["filamentMm"], 100)
        self.assertGreater(info["filamentGrams"], 1)
        self.assertEqual(len(info["thumbnails"]), 3)

    def test_orca_layer_count(self):
        info = gcode_meta.summarise(sample("twisted-vase-orca.gcode"))
        self.assertIn("Orca", info["slicer"])
        self.assertEqual(info["layerCount"], 220)

    def test_cura(self):
        info = gcode_meta.summarise(sample("cura-calibration-tower.gcode"))
        self.assertIn("Cura", info["slicer"])
        self.assertEqual(info["estimatedSeconds"], 120 * 38)
        self.assertEqual(info["layerCount"], 120)
        self.assertEqual(info["bounds"]["x"], [155.0, 195.0])
        self.assertNotIn("thumbnails", info)          # Cura sample has none

    def test_multi_extruder_filament_is_summed(self):
        self.assertEqual(gcode_meta._sum_numbers("100.5, 20.0"), 120.5)


class ThumbnailTests(unittest.TestCase):
    def test_extracts_png_and_picks_sizes(self):
        head, _tail, _size = gcode_meta.read_ends(sample("voron-test-cube-30mm.gcode"))
        biggest = gcode_meta.best_thumbnail(head)
        self.assertEqual((biggest["width"], biggest["height"]), (300, 300))
        self.assertEqual(biggest["data"][:8], b"\x89PNG\r\n\x1a\n")
        small = gcode_meta.best_thumbnail(head, prefer_width=48)
        self.assertEqual(small["width"], 48)

    def test_no_thumbnail(self):
        head, _t, _s = gcode_meta.read_ends(sample("cura-calibration-tower.gcode"))
        self.assertIsNone(gcode_meta.best_thumbnail(head))

    def test_garbage_base64_does_not_crash(self):
        text = "; thumbnail begin 10x10 5\n; !!!not base64!!!\n; thumbnail end\n"
        self.assertEqual(list(gcode_meta.find_thumbnails(text)), [])


class LayerScanTests(unittest.TestCase):
    def test_cube_layers(self):
        result = layer_scan.scan(sample("voron-test-cube-30mm.gcode"))
        self.assertEqual(result["count"], 150)
        self.assertAlmostEqual(result["layers"][0][0], 0.2, places=3)
        self.assertAlmostEqual(result["layers"][-1][0], 30.0, places=3)
        self.assertAlmostEqual(result["height"], 30.0, places=2)
        offsets = [l[1] for l in result["layers"]]
        self.assertEqual(offsets, sorted(set(offsets)))
        es = [l[2] for l in result["layers"]]
        self.assertEqual(es, sorted(es))
        min_x, max_x, min_y, max_y = result["bbox"]
        self.assertAlmostEqual(min_x, 160, delta=0.6)
        self.assertAlmostEqual(max_x, 190, delta=0.6)

    def test_offsets_point_at_layer_starts(self):
        path = sample("voron-test-cube-30mm.gcode")
        result = layer_scan.scan(path)
        with open(path, "rb") as fh:
            data = fh.read()
        # every recorded offset must sit on a line start, and belong to the right layer
        for i in (0, 10, 75, 149):
            z, off, _e = result["layers"][i]
            self.assertTrue(off == 0 or data[off - 1:off] == b"\n", "layer %d offset is mid-line" % i)
            window = data[off: off + 900].decode("utf-8", "replace")
            self.assertIn("Z%.3f" % z if z != int(z) else "Z%d" % z, window.replace("Z%.3f" % (z + 0.4), "") or window)

    def test_absolute_extrusion_cura(self):
        result = layer_scan.scan(sample("cura-calibration-tower.gcode"))
        self.assertEqual(result["count"], 120)
        self.assertGreater(result["filamentMm"], 50)

    def test_vase_layers_are_not_split_per_line(self):
        result = layer_scan.scan(sample("twisted-vase-orca.gcode"))
        self.assertEqual(result["count"], 220)

    def test_z_hop_does_not_create_layers(self):
        gcode = "\n".join([
            "G90", "M83",
            "G1 Z0.2 F600", "G1 X10 Y10", "G1 X20 Y10 E1.0",
            "G1 E-0.8", "G1 Z0.6", "G1 X30 Y30", "G1 Z0.2", "G1 E0.8", "G1 X40 Y30 E1.0",   # hop, same layer
            "G1 E-0.8", "G1 Z0.6", "G1 X10 Y10", "G1 Z0.4", "G1 E0.8", "G1 X20 Y10 E1.0",   # real next layer
            "",
        ])
        with tempfile.NamedTemporaryFile("w", suffix=".gcode", delete=False) as fh:
            fh.write(gcode)
            name = fh.name
        try:
            result = layer_scan.scan(name)
        finally:
            os.remove(name)
        self.assertEqual([round(l[0], 2) for l in result["layers"]], [0.2, 0.4])

    def test_command_line_entry_point(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = os.path.join(tmp, "layers.json")
            subprocess.check_call([sys.executable, os.path.join(ROOT, "octoprint_makerforge", "layer_scan.py"),
                                   sample("stepped-tower-abs.gcode"), out])
            with open(out) as fh:
                data = json.load(fh)
        self.assertEqual(data["count"], 200)
        self.assertIn("scanSeconds", data)


if __name__ == "__main__":
    unittest.main()
