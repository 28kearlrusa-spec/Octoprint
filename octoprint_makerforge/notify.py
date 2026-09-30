# coding=utf-8
"""Outgoing notifications (Discord, Slack, ntfy or any URL) for print events.

Runs entirely in a background thread with short timeouts, so a slow or dead webhook can
never delay a print or the UI. Webhook URLs are treated as secrets: the plugin marks them
admin-only in its settings.
"""
from __future__ import absolute_import

import json
import logging
import threading

try:  # requests ships with OctoPrint
    import requests
except ImportError:  # pragma: no cover
    requests = None

TIMEOUT = 8
# event: (title, ntfy priority 1-5)
EVENTS = {
    "PrintStarted": ("Print started", 3),
    "PrintDone": ("Print finished", 3),
    "PrintFailed": ("Print failed", 5),
    "PrintCancelled": ("Print cancelled", 3),
    "PrintPaused": ("Print paused", 4),
    "Error": ("Printer error", 5),
}
# the MakerPrint palette: logo green for good news, red for failures, amber in between
DISCORD_COLORS = {"PrintStarted": 0x86D929, "PrintDone": 0x86D929, "PrintFailed": 0xEF5F6B,
                  "PrintCancelled": 0xE3B341, "PrintPaused": 0xE3B341, "Error": 0xEF5F6B}


def clean_hook(raw):
    """Validate one webhook definition from the settings. Returns a safe dict or None."""
    if not isinstance(raw, dict):
        return None
    url = str(raw.get("url", "")).strip()
    if not (url.startswith("http://") or url.startswith("https://")):
        return None
    kind = raw.get("type") if raw.get("type") in ("json", "discord", "slack", "ntfy") else "json"
    events = [e for e in (raw.get("events") or []) if e in EVENTS] or ["PrintDone", "PrintFailed"]
    return {"name": str(raw.get("name") or "Webhook")[:60], "type": kind, "url": url, "events": events,
            "enabled": raw.get("enabled", True) is not False}


def describe(event, payload, printer_name=""):
    title, _prio = EVENTS.get(event, (event, 3))
    payload = payload or {}
    name = payload.get("name") or payload.get("path") or ""
    lines = []
    if name:
        lines.append(str(name))
    if event == "PrintDone" and payload.get("time") is not None:
        s = int(payload["time"])
        lines.append("Took %dh %02dm" % (s // 3600, (s % 3600) // 60))
    if event in ("PrintFailed", "Error") and (payload.get("reason") or payload.get("error")):
        lines.append(str(payload.get("reason") or payload.get("error")))
    body = "\n".join(lines) or title
    head = title
    if printer_name:
        head += " on " + printer_name
    return head, body


def build_request(hook, event, payload, printer_name=""):
    """Returns (url, kwargs) for requests.post."""
    head, body = describe(event, payload, printer_name)
    kind = hook["type"]
    if kind == "discord":
        return hook["url"], {"json": {"embeds": [{"title": head, "description": body, "color": DISCORD_COLORS.get(event, 0x86D929)}]}}
    if kind == "slack":
        return hook["url"], {"json": {"text": "*%s*\n%s" % (head, body)}}
    if kind == "ntfy":
        _t, prio = EVENTS.get(event, ("", 3))
        headers = {"Title": head.encode("utf-8"), "Priority": str(prio), "Tags": event.lower()}
        return hook["url"], {"data": body.encode("utf-8"), "headers": headers}
    return hook["url"], {"json": {"event": event, "title": head, "message": body, "printer": printer_name, "payload": payload or {}}}


class Notifier(object):
    def __init__(self, get_hooks, get_printer_name, logger=None):
        self._get_hooks = get_hooks
        self._printer_name = get_printer_name
        self._log = logger or logging.getLogger(__name__)

    def handle(self, event, payload):
        if event not in EVENTS:
            return
        for raw in self._get_hooks() or []:
            hook = clean_hook(raw)
            if hook and hook["enabled"] and event in hook["events"]:
                threading.Thread(target=self._send, args=(hook, event, payload), daemon=True,
                                 name="makerforge-notify").start()

    def test(self, raw):
        """Send a sample notification synchronously. Returns (ok, message)."""
        hook = clean_hook(raw)
        if not hook:
            return False, "That needs a full http:// or https:// address."
        if requests is None:
            return False, "The requests library is not available."
        return self._send(hook, "PrintDone", {"name": "test-print.gcode", "time": 5400}, report=True)

    def _send(self, hook, event, payload, report=False):
        if requests is None:   # OctoPrint ships it; only a bare test environment lacks it
            self._log.warning("Webhook %s skipped: the requests library is not available", hook["name"])
            return (False, "The requests library is not available.") if report else None
        try:
            url, kwargs = build_request(hook, event, payload, self._printer_name())
            res = requests.post(url, timeout=TIMEOUT, allow_redirects=False, **kwargs)
            ok = 200 <= res.status_code < 300
            if not ok:
                self._log.warning("Webhook %s answered HTTP %s", hook["name"], res.status_code)
            return (ok, "Delivered." if ok else "The service answered HTTP %s." % res.status_code) if report else None
        except Exception as exc:  # noqa: BLE001 - a notification must never raise into OctoPrint
            self._log.warning("Webhook %s failed: %s", hook["name"], exc.__class__.__name__)
            return (False, "Couldn't reach it: %s" % exc.__class__.__name__) if report else None
