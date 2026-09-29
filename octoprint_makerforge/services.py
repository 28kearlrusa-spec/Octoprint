# coding=utf-8
"""File metadata service: slicer summary, thumbnails and layer maps, with on-disk caches.

Layer maps are built in a separate low-priority process (see layer_scan.py) one at a time.
"""
from __future__ import absolute_import

import hashlib
import io
import json
import logging
import os
import queue
import subprocess
import sys
import threading
import time

from . import gcode_meta
from . import layer_scan

CACHE_LIMIT = 300          # cached entries of each kind before the oldest are pruned
SCAN_TIMEOUT = 60 * 45     # give up on a single scan after this long


class FileMeta(object):
    def __init__(self, data_folder, resolve, logger=None):
        """`resolve(rel_path) -> absolute path on disk` (raises if not a local file)."""
        self._resolve = resolve
        self._log = logger or logging.getLogger(__name__)
        self._meta_dir = os.path.join(data_folder, "meta")
        self._layer_dir = os.path.join(data_folder, "layers")
        for d in (self._meta_dir, self._layer_dir):
            if not os.path.isdir(d):
                os.makedirs(d)
        self._lock = threading.RLock()
        self._mem = {}                         # key -> summary
        self._queue = queue.Queue()
        self._queued = set()
        self._running = {}                     # abs path -> started
        self._failed = {}                      # abs path -> time
        self._worker = threading.Thread(target=self._work, name="makerforge-layer-scan", daemon=True)
        self._worker.start()

    # ~~ keys ~~
    @staticmethod
    def _stat(abs_path):
        st = os.stat(abs_path)
        return int(st.st_size), float(st.st_mtime)

    @staticmethod
    def _key(abs_path, size, mtime):
        return hashlib.sha1("{}|{}|{}".format(abs_path, size, int(mtime)).encode("utf-8")).hexdigest()

    # ~~ summary ~~
    def summary(self, rel):
        abs_path = self._resolve(rel)
        size, mtime = self._stat(abs_path)
        key = self._key(abs_path, size, mtime)
        with self._lock:
            if key in self._mem:
                return self._mem[key], size, mtime
        cache_file = os.path.join(self._meta_dir, key + ".json")
        info = None
        if os.path.exists(cache_file):
            try:
                with io.open(cache_file, "r", encoding="utf-8") as fh:
                    info = json.load(fh)
            except (IOError, ValueError):
                info = None
        if info is None:
            info = gcode_meta.summarise(abs_path)
            self._write_json(cache_file, info)
            self._prune(self._meta_dir)
        with self._lock:
            self._mem[key] = info
            if len(self._mem) > 500:
                self._mem.pop(next(iter(self._mem)))
        return info, size, mtime

    # ~~ thumbnail ~~
    def thumbnail(self, rel, width=None):
        """Returns (bytes, mime, etag) or None."""
        abs_path = self._resolve(rel)
        size, mtime = self._stat(abs_path)
        key = self._key(abs_path, size, mtime) + ("-%s" % width if width else "")
        cache_file = os.path.join(self._meta_dir, key + ".thumb")
        mime_file = cache_file + ".mime"
        if os.path.exists(cache_file) and os.path.exists(mime_file):
            with open(cache_file, "rb") as fh:
                data = fh.read()
            with open(mime_file, "r") as fh:
                mime = fh.read().strip()
            return (data, mime, key) if data else None
        head, _tail, _size = gcode_meta.read_ends(abs_path)
        best = gcode_meta.best_thumbnail(head, prefer_width=width)
        if not best:
            # remember "no thumbnail" so we do not re-read a big file every time
            with open(cache_file, "wb") as fh:
                fh.write(b"")
            with open(mime_file, "w") as fh:
                fh.write("none")
            return None
        mime = "image/png" if best["format"] == "PNG" else "image/jpeg"
        with open(cache_file, "wb") as fh:
            fh.write(best["data"])
        with open(mime_file, "w") as fh:
            fh.write(mime)
        self._prune(self._meta_dir)
        return best["data"], mime, key

    # ~~ layers ~~
    def layers(self, rel, start=True):
        """Returns ("ready", data) | ("running", None) | ("error", None)."""
        abs_path = self._resolve(rel)
        size, mtime = self._stat(abs_path)
        key = self._key(abs_path, size, mtime)
        out = os.path.join(self._layer_dir, key + ".json")
        if os.path.exists(out):
            try:
                with io.open(out, "r", encoding="utf-8") as fh:
                    data = json.load(fh)
                if data.get("size") == size:
                    return "ready", data
            except (IOError, ValueError):
                pass
        with self._lock:
            if abs_path in self._running or abs_path in self._queued:
                return "running", None
            failed = self._failed.get(abs_path)
            if failed and time.time() - failed < 300:
                return "error", None
            if not start:
                return "missing", None
            self._queued.add(abs_path)
            self._queue.put((abs_path, out))
        return "running", None

    def prefetch(self, rel):
        """Queue a layer scan without waiting for it. Errors are only logged."""
        try:
            self.layers(rel, start=True)
        except Exception as exc:  # noqa: BLE001
            self._log.debug("Layer prefetch for %s skipped: %s", rel, exc)

    def _work(self):
        while True:
            abs_path, out = self._queue.get()
            with self._lock:
                self._queued.discard(abs_path)
                self._running[abs_path] = time.time()
            try:
                self._scan_process(abs_path, out)
            except Exception as exc:  # noqa: BLE001
                self._log.warning("Layer scan failed for %s: %s", abs_path, exc)
                with self._lock:
                    self._failed[abs_path] = time.time()
            finally:
                with self._lock:
                    self._running.pop(abs_path, None)
                self._prune(self._layer_dir)

    def _scan_process(self, abs_path, out):
        cmd = [sys.executable, layer_scan.__file__.replace(".pyc", ".py"), abs_path, out]
        self._log.info("Scanning layers of %s", os.path.basename(abs_path))
        proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        try:
            _stdout, stderr = proc.communicate(timeout=SCAN_TIMEOUT)
        except subprocess.TimeoutExpired:
            proc.kill()
            raise RuntimeError("timed out")
        if proc.returncode != 0:
            raise RuntimeError((stderr or b"").decode("utf-8", "replace")[-300:] or "exit %s" % proc.returncode)

    # ~~ housekeeping ~~
    @staticmethod
    def _write_json(path, data):
        tmp = path + ".tmp"
        with io.open(tmp, "w", encoding="utf-8") as fh:
            fh.write(json.dumps(data, ensure_ascii=False))
        os.replace(tmp, path)

    def _prune(self, folder):
        try:
            entries = [
                (os.path.getmtime(os.path.join(folder, n)), n)
                for n in os.listdir(folder)
                if not n.endswith(".tmp")
            ]
            if len(entries) <= CACHE_LIMIT:
                return
            entries.sort()
            for _mt, name in entries[: len(entries) - CACHE_LIMIT]:
                try:
                    os.remove(os.path.join(folder, name))
                except OSError:
                    pass
        except OSError:
            pass
