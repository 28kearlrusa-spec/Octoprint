# coding=utf-8
import logging
import os
import sys
import tempfile
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# The modules under test have no OctoPrint dependency: load them straight from the package
# folder so the tests run with a plain Python (importing the package itself needs OctoPrint).
sys.path.insert(0, os.path.join(ROOT, "octoprint_makerforge"))

from stats import StatsStore  # noqa: E402
from store import ConfigStore, ConflictError  # noqa: E402

LOG = logging.getLogger("test")


class StatsTests(unittest.TestCase):
    def test_records_and_maintenance(self):
        with tempfile.TemporaryDirectory() as d:
            s = StatsStore(d, LOG)
            s.record("success", "a.gcode", "a.gcode", 3600, 1000)
            s.record("failed", "b.gcode", "b.gcode", 1800, 250, estimated=True)
            s.record("cancelled", "c.gcode", "c.gcode", 600)
            t = s.summary()["totals"]
            self.assertEqual((t["prints"], t["success"], t["failed"], t["cancelled"]), (3, 1, 1, 1))
            self.assertAlmostEqual(t["seconds"], 6000)
            self.assertAlmostEqual(t["filamentMm"], 1250)
            # a task reset now counts print time from here on
            s.reset_task("rails")
            s.record("success", "d.gcode", "d.gcode", 7200)
            m = s.summary()["maintenance"]["rails"]
            self.assertAlmostEqual(m["sinceSeconds"], 7200)
            # survives a restart
            s2 = StatsStore(d, LOG)
            self.assertEqual(s2.summary()["totals"]["prints"], 4)
            self.assertEqual(s2.summary()["history"][0]["name"], "d.gcode")

    def test_corrupt_file_is_set_aside(self):
        with tempfile.TemporaryDirectory() as d:
            with open(os.path.join(d, "stats.json"), "w") as fh:
                fh.write("{not json")
            s = StatsStore(d, LOG)
            self.assertEqual(s.summary()["totals"]["prints"], 0)
            self.assertTrue(os.path.exists(os.path.join(d, "stats.json.corrupt")))


class ConfigStoreTests(unittest.TestCase):
    def test_revision_conflict(self):
        with tempfile.TemporaryDirectory() as d:
            c = ConfigStore(d, LOG)
            doc = c.put({"printerName": "A"}, expected_rev=0)
            self.assertEqual(doc["rev"], 1)
            with self.assertRaises(ConflictError):
                c.put({"printerName": "B"}, expected_rev=0)
            self.assertEqual(c.put({"printerName": "C"}, expected_rev=1)["rev"], 2)
            self.assertEqual(ConfigStore(d, LOG).get()["printerName"], "C")

    def test_rejects_huge_and_non_objects(self):
        with tempfile.TemporaryDirectory() as d:
            c = ConfigStore(d, LOG)
            with self.assertRaises(ValueError):
                c.put(["nope"])
            with self.assertRaises(ValueError):
                c.put({"x": "y" * (600 * 1024)})


if __name__ == "__main__":
    unittest.main()
