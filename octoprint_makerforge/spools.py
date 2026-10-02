# coding=utf-8
"""Filament spools: a simple list kept by the plugin, or a Spoolman server when one is set up.

Filament used by a print is taken off the active spool when the print ends, by the printer's
computer, so it counts even when no browser is open.
"""
from __future__ import absolute_import

import io
import json
import math
import os
import re
import threading
import time
import uuid

FIELDS = ("name", "material", "color", "weightG", "remainingG", "costPerKg", "density", "diameter", "spoolWeightG")
MAX_SPOOLS = 200


def grams_from_mm(mm, diameter=1.75, density=1.24):
    r = (float(diameter or 1.75) / 2.0) / 10.0           # cm
    return math.pi * r * r * (float(mm) / 10.0) * float(density or 1.24)


def clean_spool(raw):
    """Keep only known fields, with sane types and ranges."""
    if not isinstance(raw, dict):
        return None
    out = {}
    out["name"] = str(raw.get("name") or "Spool").strip()[:80] or "Spool"
    out["material"] = re.sub(r"[^A-Za-z0-9+\- ]", "", str(raw.get("material") or "PLA"))[:20] or "PLA"
    color = str(raw.get("color") or "#888888").strip()
    out["color"] = color if re.match(r"^#[0-9a-fA-F]{6}$", color) else "#888888"
    for key, default, lo, hi in (("weightG", 1000.0, 1, 20000), ("remainingG", None, 0, 20000), ("costPerKg", 20.0, 0, 10000),
                                  ("density", 1.24, 0.5, 3.0), ("diameter", 1.75, 1.0, 3.5), ("spoolWeightG", 0.0, 0, 2000)):
        try:
            value = float(raw.get(key)) if raw.get(key) not in (None, "") else default
        except (TypeError, ValueError):
            value = default
        if value is not None:
            value = max(lo, min(hi, value))
        out[key] = value
    if out["remainingG"] is None:
        out["remainingG"] = out["weightG"]
    out["remainingG"] = min(out["remainingG"], out["weightG"])
    sid = str(raw.get("id") or "")
    out["id"] = sid if re.match(r"^[a-z0-9]{6,32}$", sid) else uuid.uuid4().hex[:12]
    return out


class SpoolStore(object):
    def __init__(self, folder, logger):
        self._path = os.path.join(folder, "spools.json")
        self._log = logger
        self._lock = threading.RLock()
        self._data = self._load()

    def _load(self):
        try:
            with io.open(self._path, "r", encoding="utf-8") as fh:
                data = json.load(fh)
            spools = [s for s in (clean_spool(x) for x in data.get("spools", [])) if s]
            return {"spools": spools, "active": data.get("active"), "spoolmanActive": data.get("spoolmanActive"), "log": data.get("log", [])[-50:]}
        except IOError:
            return {"spools": [], "active": None, "spoolmanActive": None, "log": []}
        except ValueError:
            self._log.exception("Unreadable spool list, starting fresh")
            return {"spools": [], "active": None, "spoolmanActive": None, "log": []}

    def _save(self):
        folder = os.path.dirname(self._path)
        if not os.path.isdir(folder):
            os.makedirs(folder)
        tmp = self._path + ".tmp"
        with io.open(tmp, "w", encoding="utf-8") as fh:
            fh.write(json.dumps(self._data, ensure_ascii=False))
        os.replace(tmp, self._path)

    def get(self):
        with self._lock:
            return json.loads(json.dumps(self._data))

    def put(self, raw):
        spool = clean_spool(raw)
        if not spool:
            raise ValueError("That isn't a spool.")
        with self._lock:
            spools = self._data["spools"]
            for i, s in enumerate(spools):
                if s["id"] == spool["id"]:
                    spools[i] = spool
                    break
            else:
                if len(spools) >= MAX_SPOOLS:
                    raise ValueError("That's a lot of spools. Remove some first.")
                spools.append(spool)
            if not self._data.get("active"):
                self._data["active"] = spool["id"]
            self._save()
            return spool

    def delete(self, sid):
        with self._lock:
            self._data["spools"] = [s for s in self._data["spools"] if s["id"] != sid]
            if self._data.get("active") == sid:
                self._data["active"] = None
            self._save()

    def set_active(self, sid, spoolman=False):
        with self._lock:
            if spoolman:
                self._data["spoolmanActive"] = sid
            else:
                if sid and not any(s["id"] == sid for s in self._data["spools"]):
                    raise ValueError("Unknown spool.")
                self._data["active"] = sid or None
            self._save()

    def spoolman_active(self):
        return self._data.get("spoolmanActive")

    def use(self, mm, name=""):
        """Take `mm` of filament off the active spool. Returns (spool, grams) or (None, 0)."""
        with self._lock:
            sid = self._data.get("active")
            spool = next((s for s in self._data["spools"] if s["id"] == sid), None)
            if not spool or not mm:
                return None, 0.0
            g = grams_from_mm(mm, spool["diameter"], spool["density"])
            spool["remainingG"] = max(0.0, round(spool["remainingG"] - g, 1))
            self._data["log"] = (self._data.get("log") or [])[-49:] + [{"ts": int(time.time()), "spool": sid, "grams": round(g, 1), "print": name[:120]}]
            self._save()
            return spool, g


class Spoolman(object):
    """A Spoolman server (https://github.com/Donkie/Spoolman), reached from the printer's computer."""

    def __init__(self, url, timeout=5):
        self.url = (url or "").rstrip("/")
        self.timeout = timeout

    def _req(self, method, path, **kw):
        import requests
        res = requests.request(method, self.url + path, timeout=self.timeout, **kw)
        res.raise_for_status()
        return res.json() if res.content else None

    def spools(self):
        out = []
        for s in self._req("GET", "/api/v1/spool", params={"allow_archived": "false"}) or []:
            f = s.get("filament") or {}
            vendor = (f.get("vendor") or {}).get("name")
            out.append({
                "id": str(s.get("id")),
                "name": " ".join(x for x in (vendor, f.get("name")) if x) or "Spool {}".format(s.get("id")),
                "material": f.get("material") or "",
                "color": "#" + f["color_hex"][:6] if f.get("color_hex") else "#888888",
                "weightG": s.get("initial_weight") or f.get("weight"),
                "remainingG": s.get("remaining_weight"),
                "costPerKg": (f.get("price") / f["weight"] * 1000) if f.get("price") and f.get("weight") else None,
                "density": f.get("density"),
                "diameter": f.get("diameter"),
            })
        return out

    def use(self, spool_id, mm):
        return self._req("PUT", "/api/v1/spool/{}/use".format(int(spool_id)), json={"use_length": round(float(mm), 1)})
