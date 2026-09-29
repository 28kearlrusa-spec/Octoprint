# coding=utf-8
"""Print statistics and maintenance counters, recorded from real OctoPrint events.

Nothing is invented: history starts at zero on install and only grows when a print ends.
Maintenance reminders count print hours since you last marked a task done.
"""
from __future__ import absolute_import

import copy
import io
import json
import os
import threading
import time

MAX_HISTORY = 500


class StatsStore(object):
    def __init__(self, folder, logger):
        self._path = os.path.join(folder, "stats.json")
        self._log = logger
        self._lock = threading.RLock()
        self._data = self._load()

    @staticmethod
    def _empty():
        return {
            "version": 1,
            "totals": {"prints": 0, "success": 0, "failed": 0, "cancelled": 0, "seconds": 0.0, "filamentMm": 0.0},
            "history": [],
            "maintenance": {},
        }

    def _load(self):
        try:
            with io.open(self._path, "r", encoding="utf-8") as fh:
                data = json.load(fh)
            base = self._empty()
            base.update({k: data[k] for k in base if k in data})
            base["totals"] = dict(self._empty()["totals"], **data.get("totals", {}))
            return base
        except IOError:
            return self._empty()
        except ValueError:
            self._log.exception("Unreadable MakerForge stats, starting fresh")
            try:
                os.replace(self._path, self._path + ".corrupt")
            except OSError:
                pass
            return self._empty()

    def _save(self):
        folder = os.path.dirname(self._path)
        if not os.path.isdir(folder):
            os.makedirs(folder)
        tmp = self._path + ".tmp"
        with io.open(tmp, "w", encoding="utf-8") as fh:
            fh.write(json.dumps(self._data, ensure_ascii=False))
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, self._path)

    def record(self, result, name, path, seconds, filament_mm=None, estimated=False):
        """result: 'success' | 'failed' | 'cancelled'"""
        seconds = max(0.0, float(seconds or 0))
        with self._lock:
            t = self._data["totals"]
            t["prints"] += 1
            t[result] = t.get(result, 0) + 1
            t["seconds"] += seconds
            if filament_mm:
                t["filamentMm"] += float(filament_mm)
            self._data["history"].append({
                "ts": int(time.time()),
                "name": name,
                "path": path,
                "result": result,
                "seconds": round(seconds, 1),
                "filamentMm": round(float(filament_mm), 1) if filament_mm else None,
                "estimated": bool(estimated),
            })
            del self._data["history"][:-MAX_HISTORY]
            self._save()

    def summary(self):
        with self._lock:
            data = copy.deepcopy(self._data)
        totals = data["totals"]
        maintenance = {}
        for task_id, m in data["maintenance"].items():
            maintenance[task_id] = {
                "sinceSeconds": max(0.0, totals["seconds"] - m.get("atSeconds", 0.0)),
                "resetAt": m.get("resetAt"),
            }
        # print seconds per day for the last 30 days
        now = int(time.time())
        day = 86400
        buckets = {}
        for h in data["history"]:
            if now - h["ts"] <= 30 * day:
                key = (h["ts"] // day) * day
                buckets[key] = buckets.get(key, 0.0) + h["seconds"]
        daily = [{"day": k, "seconds": round(v, 1)} for k, v in sorted(buckets.items())]
        return {
            "totals": totals,
            "history": list(reversed(data["history"][-60:])),
            "daily": daily,
            "maintenance": maintenance,
        }

    def reset_task(self, task_id):
        with self._lock:
            self._data["maintenance"][task_id] = {
                "atSeconds": self._data["totals"]["seconds"],
                "resetAt": int(time.time()),
            }
            self._save()
            return self.summary()["maintenance"][task_id]
