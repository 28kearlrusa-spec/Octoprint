# coding=utf-8
"""Tiny, safe JSON store for the config shared by everyone who uses the UI.

Written atomically (temp file + rename) so a power cut in the middle of a save can never
leave a half written file behind. A ``rev`` counter lets the UI notice when two browsers
edit at the same time instead of silently overwriting each other.
"""
from __future__ import absolute_import

import copy
import io
import json
import os
import threading

MAX_BYTES = 512 * 1024  # a config bigger than this is a bug or an attack, not a config

DEFAULT_CONFIG = {
    "rev": 0,
    # Everything the UI can customise lives in here. Missing keys are filled from the
    # defaults built into the front end, so this file can stay small.
}


class ConflictError(Exception):
    """Raised when the caller edited an older revision than the one on disk."""


class ConfigStore(object):
    def __init__(self, folder, logger):
        self._path = os.path.join(folder, "config.json")
        self._log = logger
        self._lock = threading.RLock()
        self._data = self._load()

    def _load(self):
        try:
            with io.open(self._path, "r", encoding="utf-8") as fh:
                data = json.load(fh)
            if not isinstance(data, dict):
                raise ValueError("config root must be an object")
            data.setdefault("rev", 0)
            return data
        except IOError:
            return copy.deepcopy(DEFAULT_CONFIG)
        except ValueError:
            self._log.exception("Unreadable MakerPrint config, starting from defaults")
            self._backup_corrupt()
            return copy.deepcopy(DEFAULT_CONFIG)

    def _backup_corrupt(self):
        try:
            os.replace(self._path, self._path + ".corrupt")
        except OSError:
            pass

    def get(self):
        with self._lock:
            return copy.deepcopy(self._data)

    def put(self, new_data, expected_rev=None):
        """Replace the config. Returns the stored document (with the new ``rev``)."""
        if not isinstance(new_data, dict):
            raise ValueError("config must be an object")
        encoded = json.dumps(new_data, ensure_ascii=False, sort_keys=True)
        if len(encoded.encode("utf-8")) > MAX_BYTES:
            raise ValueError("config too large")

        with self._lock:
            current_rev = self._data.get("rev", 0)
            if expected_rev is not None and expected_rev != current_rev:
                raise ConflictError(current_rev)

            doc = copy.deepcopy(new_data)
            doc["rev"] = current_rev + 1
            self._write(doc)
            self._data = doc
            return copy.deepcopy(doc)

    def _write(self, doc):
        folder = os.path.dirname(self._path)
        if not os.path.isdir(folder):
            os.makedirs(folder)
        tmp = self._path + ".tmp"
        with io.open(tmp, "w", encoding="utf-8") as fh:
            fh.write(json.dumps(doc, ensure_ascii=False, indent=2, sort_keys=True))
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, self._path)
