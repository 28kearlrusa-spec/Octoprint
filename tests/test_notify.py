# coding=utf-8
import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# The modules under test have no OctoPrint dependency: load them straight from the package
# folder so the tests run with a plain Python (importing the package itself needs OctoPrint).
sys.path.insert(0, os.path.join(ROOT, "octoprint_makerforge"))

import notify  # noqa: E402


class HookTests(unittest.TestCase):
    def test_clean_hook_rejects_bad_urls(self):
        self.assertIsNone(notify.clean_hook({"url": "file:///etc/passwd"}))
        self.assertIsNone(notify.clean_hook({"url": "javascript:alert(1)"}))
        self.assertIsNone(notify.clean_hook("nope"))
        self.assertIsNone(notify.clean_hook({"url": ""}))

    def test_clean_hook_defaults(self):
        h = notify.clean_hook({"url": " https://ntfy.sh/my-forge ", "type": "weird", "events": ["Nope"]})
        self.assertEqual(h["url"], "https://ntfy.sh/my-forge")
        self.assertEqual(h["type"], "json")
        self.assertEqual(h["events"], ["PrintDone", "PrintFailed"])
        self.assertTrue(h["enabled"])

    def test_formats(self):
        payload = {"name": "benchy.gcode", "time": 5400}
        d_url, d = notify.build_request({"type": "discord", "url": "https://d/x"}, "PrintDone", payload, "Voron")
        self.assertIn("embeds", d["json"])
        self.assertIn("Voron", d["json"]["embeds"][0]["title"])
        n_url, n = notify.build_request({"type": "ntfy", "url": "https://ntfy.sh/t"}, "PrintFailed", {"name": "x", "reason": "error"}, "")
        self.assertIn(b"error", n["data"])
        self.assertEqual(n["headers"]["Priority"], "5")
        j_url, j = notify.build_request({"type": "json", "url": "https://h/x"}, "PrintDone", payload, "")
        self.assertEqual(j["json"]["event"], "PrintDone")
        self.assertIn("Took 1h 30m", j["json"]["message"])

    def test_snapshot_attachments(self):
        jpeg = b"\xff\xd8fake"
        _u, d = notify.build_request({"type": "discord", "url": "https://d/x"}, "PrintDone", {"name": "a"}, "", jpeg)
        self.assertEqual(d["files"]["file"][1], jpeg)
        self.assertIn("attachment://snapshot.jpg", d["data"]["payload_json"])
        _u, n = notify.build_request({"type": "ntfy", "url": "https://n/t"}, "FirstLayerDone", {"name": "a"}, "", jpeg)
        self.assertEqual(n["data"], jpeg)
        self.assertEqual(n["headers"]["Filename"], "snapshot.jpg")
        _u, sl = notify.build_request({"type": "slack", "url": "https://s/x"}, "PrintDone", {"name": "a"}, "", jpeg)
        self.assertIn("text", sl["json"])   # Slack webhooks can't take files: text only
        self.assertTrue(notify.clean_hook({"url": "https://x/", "events": ["FirstLayerDone"]})["snapshot"])

    def test_handle_only_matching_events(self):
        sent = []

        class Spy(notify.Notifier):
            def _send(self, hook, event, payload, report=False):
                sent.append((hook["name"], event))

        n = Spy(lambda: [{"name": "a", "url": "https://a/", "events": ["PrintDone"]},
                         {"name": "b", "url": "https://b/", "events": ["PrintFailed"], "enabled": False}], lambda: "")
        n.handle("PrintDone", {})
        n.handle("PrintFailed", {})
        n.handle("ClientOpened", {})
        import time; time.sleep(0.2)
        self.assertEqual(sent, [("a", "PrintDone")])


if __name__ == "__main__":
    unittest.main()
