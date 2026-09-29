# coding=utf-8
"""MakerForge UI: a complete custom control surface for OctoPrint and Klipper.

The plugin does three jobs:

* ``UiPlugin``  - serves the single page app at ``/`` (the classic UI stays one click away)
* ``Blueprint`` - a small JSON API for the things OctoPrint itself does not offer:
                  G-code thumbnails, slicer metadata, layer maps, shared UI config and stats
* ``Event``     - records print history and fires optional notifications

Everything is designed to fail safe: if anything in here misbehaves, OctoPrint's classic UI
keeps working and can always be reached with ``/?classic``.
"""
from __future__ import absolute_import

import base64
import hashlib
import logging
import os
import re
import time

import flask
import octoprint.plugin
from octoprint.access.permissions import Permissions

from ._version import __version__
from .notify import Notifier, clean_hook
from .services import FileMeta
from .stats import StatsStore
from .store import ConfigStore, ConflictError

__plugin_name__ = "MakerForge UI"
__plugin_pythoncompat__ = ">=3.7,<4"
__plugin_version__ = __version__
__plugin_description__ = (
    "A replacement interface for OctoPrint and Klipper, made for Voron printers and styled "
    "after the MakerForge logo."
)
__plugin_author__ = "MakerForge"
__plugin_url__ = "https://github.com/28kearlrusa-spec/Octoprint"
__plugin_license__ = "AGPLv3"

CLASSIC_COOKIE = "mf_ui"

# Headers for every page of the app. The content security policy is the important one: the
# page may only run scripts from this plugin, so injected markup can't run code.
SECURITY_HEADERS = {
    "Referrer-Policy": "same-origin",
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Opener-Policy": "same-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
}
_INLINE_SCRIPT = re.compile(r"<script(?P<attrs>[^>]*)>(?P<body>.*?)</script>", re.S | re.I)


def content_security_policy(html, host):
    """A strict policy for the app shell.

    The page's two small inline scripts (the import map and a browser check) are allowed by
    their hash rather than a nonce: OctoPrint caches this page, and a hash stays valid for a
    cached copy. Camera streams may live on another port or host, so images are the one thing
    allowed from anywhere.
    """
    hashes = []
    for m in _INLINE_SCRIPT.finditer(html):
        attrs = m.group("attrs").lower()
        if "src=" in attrs or "application/json" in attrs:
            continue   # external files are covered by 'self'; JSON data blocks never run
        digest = hashlib.sha256(m.group("body").encode("utf-8")).digest()
        hashes.append("'sha256-{}'".format(base64.b64encode(digest).decode("ascii")))
    sockets = "ws://{0} wss://{0}".format(host) if host else ""
    return "; ".join([
        "default-src 'self'",
        " ".join(["script-src 'self'"] + hashes),
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob: http: https:",
        "media-src 'self' blob:",
        "font-src 'self'",
        "connect-src 'self' {}".format(sockets).strip(),
        "worker-src 'self' blob:",
        "frame-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'self'",
    ])


class MakerForgePlugin(
    octoprint.plugin.UiPlugin,
    octoprint.plugin.BlueprintPlugin,
    octoprint.plugin.AssetPlugin,
    octoprint.plugin.TemplatePlugin,
    octoprint.plugin.SettingsPlugin,
    octoprint.plugin.StartupPlugin,
    octoprint.plugin.EventHandlerPlugin,
):
    def __init__(self):
        super(MakerForgePlugin, self).__init__()
        self._config = None
        self._meta = None
        self._stats = None
        self._notifier = Notifier(lambda: self._settings.get(["webhooks"]), self._printer_name, None)
        self._import_map_cache = None
        self._log = logging.getLogger("octoprint.plugins.makerforge")

    # ~~ Startup ------------------------------------------------------------------------

    def on_after_startup(self):
        self._config = ConfigStore(self.get_plugin_data_folder(), self._log)
        self._meta = FileMeta(self.get_plugin_data_folder(), self._resolve_local, self._log)
        self._stats = StatsStore(self.get_plugin_data_folder(), self._log)
        self._log.info(
            "MakerForge UI %s ready (default UI: %s)",
            __version__,
            "on" if self._settings.get_boolean(["default_ui"]) else "off",
        )

    def _cfg(self):
        # `on_after_startup` may not have run yet for very early requests
        if self._config is None:
            self._config = ConfigStore(self.get_plugin_data_folder(), self._log)
        return self._config

    # ~~ Settings -----------------------------------------------------------------------

    def get_settings_defaults(self):
        return dict(
            # take over the main page at "/". Users can always reach the stock UI at "/?classic"
            default_ui=True,
            # lightly restyle OctoPrint's classic UI with the MakerForge palette
            classic_skin=True,
            # outgoing notifications: [{name, type: json|discord|slack|ntfy, url, events: [...], enabled}]
            webhooks=[],
        )

    def get_settings_restricted_paths(self):
        # webhook URLs are secrets (they often contain tokens)
        return dict(admin=[["webhooks"]], never=[])

    def on_settings_save(self, data):
        if isinstance(data, dict) and "webhooks" in data:
            data["webhooks"] = [h for h in (clean_hook(x) for x in (data["webhooks"] or [])) if h][:12]
        octoprint.plugin.SettingsPlugin.on_settings_save(self, data)

    def _printer_name(self):
        try:
            return self._settings.global_get(["appearance", "name"]) or ""
        except Exception:
            return ""

    def get_settings_version(self):
        return 1

    # ~~ UI plugin ----------------------------------------------------------------------

    def get_ui_permissions(self):
        # An empty list tells OctoPrint never to redirect to its own login page: the app has
        # its own login screen. The HTML shell contains nothing user specific.
        return []

    def will_handle_ui(self, request):
        try:
            if not self._settings.get_boolean(["default_ui"]):
                return False
            # Until OctoPrint's setup wizard has been completed only the classic UI can show it.
            if self._settings.global_get_boolean(["server", "firstRun"]):
                return False
            if "classic" in request.args:
                return False
            if request.cookies.get(CLASSIC_COOKIE) == "classic" and "mf" not in request.args:
                return False
            return True
        except Exception:  # pragma: no cover - never take the classic UI down with us
            self._log.exception("will_handle_ui failed, falling back to the classic UI")
            return False

    def on_ui_render(self, now, request, render_kwargs):
        response = flask.make_response(self._render_shell(request, render_kwargs))
        if "mf" in request.args:
            # ?mf explicitly asks for this UI: forget any "stay on classic" preference
            response.delete_cookie(CLASSIC_COOKIE)
        return response

    def get_ui_custom_tracked_files(self):
        # The shell embeds content hashes of every script (the import map), so OctoPrint's
        # server side UI cache must be invalidated when any of them change.
        files = [
            os.path.join(self._basefolder, "templates", "makerforge_index.jinja2"),
            os.path.join(self._basefolder, "_version.py"),
        ]
        for sub in ("js", "css"):
            for dirpath, _dirs, names in os.walk(os.path.join(self._basefolder, "static", sub)):
                files.extend(os.path.join(dirpath, n) for n in names if n.endswith((".js", ".css")))
        return files

    def get_ui_preemptive_caching_enabled(self):
        return False

    def _render_shell(self, request, render_kwargs=None):
        render_kwargs = render_kwargs or {}
        base = request.script_root or ""
        # Everyone sees this page, signed in or not: nothing about the server beyond our own version
        # (OctoPrint only tells signed-in users its version, so the app asks for it after sign-in).
        boot = dict(
            version=__version__,
            base=base,
            pluginBase="{}/plugin/makerforge".format(base),
            staticBase="{}/plugin/makerforge/static".format(base),
            debug=bool(render_kwargs.get("debug")),
            classicUrl="{}/?classic".format(base),
        )
        html = flask.render_template(
            "makerforge_index.jinja2",
            boot=boot,
            import_map=self._import_map(boot["staticBase"]),
            version=__version__,
            asset_v=self._asset_version(),
        )
        response = flask.make_response(html)
        response.headers["Content-Security-Policy"] = content_security_policy(html, request.host)
        for name, value in SECURITY_HEADERS.items():
            response.headers[name] = value
        return response

    # ~~ Import map: content hashed module URLs (cache busting without a bundler) -------

    def _asset_version(self):
        return self._import_map_data()[1]

    def _import_map(self, static_base):
        modules, _ = self._import_map_data()
        return {
            "imports": {
                "mf/" + name: "{}/js/{}?v={}".format(static_base, name, digest)
                for name, digest in modules.items()
            }
        }

    def _import_map_data(self):
        js_root = os.path.join(self._basefolder, "static", "js")
        stamp = self._tree_stamp(js_root)
        if self._import_map_cache and self._import_map_cache[0] == stamp:
            return self._import_map_cache[1], self._import_map_cache[2]

        modules = {}
        overall = hashlib.sha1(__version__.encode("utf-8"))
        for dirpath, _dirs, files in os.walk(js_root):
            for name in sorted(files):
                if not name.endswith(".js"):
                    continue
                full = os.path.join(dirpath, name)
                rel = os.path.relpath(full, js_root).replace(os.sep, "/")
                with open(full, "rb") as fh:
                    digest = hashlib.sha1(fh.read()).hexdigest()[:10]
                modules[rel] = digest
                overall.update((rel + digest).encode("utf-8"))
        version = overall.hexdigest()[:10]
        self._import_map_cache = (stamp, modules, version)
        return modules, version

    @staticmethod
    def _tree_stamp(root):
        latest = 0.0
        count = 0
        for dirpath, _dirs, files in os.walk(root):
            for name in files:
                try:
                    latest = max(latest, os.path.getmtime(os.path.join(dirpath, name)))
                    count += 1
                except OSError:
                    pass
        return (latest, count)

    # ~~ Templates / assets -------------------------------------------------------------

    def get_template_configs(self):
        return [
            dict(type="navbar", template="makerforge_navbar.jinja2", custom_bindings=False),
            dict(type="settings", name="MakerForge UI", template="makerforge_settings.jinja2", custom_bindings=False),
        ]

    def get_assets(self):
        # only what the *classic* UI needs. The app itself loads its own files.
        return dict(css=["css/classic.css"], js=["js/classic.js"])

    # ~~ Blueprint ----------------------------------------------------------------------

    def is_blueprint_protected(self):
        # the shell and static files must load before anyone is logged in. Every API route
        # below enforces its own permission.
        return False

    def is_blueprint_csrf_protected(self):
        return True

    def get_blueprint_api_prefixes(self):
        return ["/api/"]

    @octoprint.plugin.BlueprintPlugin.route("/", methods=["GET"])
    def app_shell(self):
        return self._render_shell(flask.request)

    @octoprint.plugin.BlueprintPlugin.route("/manifest.webmanifest", methods=["GET"])
    def manifest(self):
        base = flask.request.script_root or ""
        static = "{}/plugin/makerforge/static".format(base)
        data = {
            "name": "MakerForge Control",
            "short_name": "MakerForge",
            "description": "Control surface for your OctoPrint and Klipper printer.",
            "start_url": "{}/".format(base) if self._settings.get_boolean(["default_ui"]) else "{}/plugin/makerforge/".format(base),
            "scope": "{}/".format(base),
            "display": "standalone",
            "background_color": "#17181b",
            "theme_color": "#17181b",
            "icons": [
                {"src": static + "/img/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any"},
                {"src": static + "/img/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any"},
            ],
        }
        response = flask.jsonify(data)
        response.headers["Content-Type"] = "application/manifest+json"
        return response

    @octoprint.plugin.BlueprintPlugin.route("/api/hello", methods=["GET"])
    @Permissions.STATUS.require(403)
    def api_hello(self):
        return flask.jsonify(plugin="makerforge", version=__version__)

    # ~~ Shared config (macros, presets, ...) ----------------------------------------

    @octoprint.plugin.BlueprintPlugin.route("/api/config", methods=["GET"])
    @Permissions.STATUS.require(403)
    def api_config_get(self):
        return flask.jsonify(self._cfg().get())

    @octoprint.plugin.BlueprintPlugin.route("/api/config", methods=["PUT"])
    @Permissions.CONTROL.require(403)
    def api_config_put(self):
        data = flask.request.get_json(silent=True)
        if not isinstance(data, dict):
            return flask.make_response(flask.jsonify(error="Expected a JSON object."), 400)
        expected = data.pop("rev", None)
        try:
            doc = self._cfg().put(data, expected_rev=expected)
        except ConflictError:
            return flask.make_response(
                flask.jsonify(error="The config changed somewhere else. Reload and try again."), 409
            )
        except ValueError as exc:
            return flask.make_response(flask.jsonify(error=str(exc)), 400)
        return flask.jsonify(doc)

    # ~~ File metadata: slicer summary, thumbnails, layer maps ---------------------

    def _resolve_local(self, rel):
        """Map a path inside OctoPrint's local storage to a real file, refusing anything that
        would escape the uploads folder."""
        rel = (rel or "").strip().lstrip("/")
        if not rel:
            raise ValueError("A file path is required.")
        base = os.path.realpath(self._settings.global_get_basefolder("uploads"))
        abs_path = os.path.realpath(self._file_manager.path_on_disk("local", rel))
        if not (abs_path == base or abs_path.startswith(base + os.sep)):
            raise ValueError("That path is outside the uploads folder.")
        if not os.path.isfile(abs_path):
            raise FileNotFoundError(rel)
        return abs_path

    def _meta_service(self):
        if self._meta is None:
            self._meta = FileMeta(self.get_plugin_data_folder(), self._resolve_local, self._log)
        return self._meta

    def _file_error(self, exc):
        if isinstance(exc, FileNotFoundError):
            return flask.make_response(flask.jsonify(error="File not found."), 404)
        # never echo server-side paths back to the browser
        return flask.make_response(flask.jsonify(error="That isn't a valid file path."), 400)

    @octoprint.plugin.BlueprintPlugin.route("/api/meta", methods=["GET"])
    @Permissions.FILES_LIST.require(403)
    def api_meta(self):
        path = flask.request.args.get("path", "")
        try:
            info, size, mtime = self._meta_service().summary(path)
            status, layers = self._meta_service().layers(path, start=False)
        except (ValueError, IOError, OSError) as exc:
            return self._file_error(exc)
        out = {"path": path, "size": size, "mtime": mtime, "info": info, "layers": {"status": status}}
        if layers:
            out["layers"].update({k: layers[k] for k in ("count", "height", "bbox", "filamentMm") if k in layers})
        return flask.jsonify(out)

    @octoprint.plugin.BlueprintPlugin.route("/api/layers", methods=["GET"])
    @Permissions.FILES_LIST.require(403)
    def api_layers(self):
        path = flask.request.args.get("path", "")
        try:
            status, data = self._meta_service().layers(path, start=True)
        except (ValueError, IOError, OSError) as exc:
            return self._file_error(exc)
        if status == "ready":
            return flask.jsonify(dict(data, status="ready"))
        return flask.make_response(flask.jsonify(status=status), 202 if status == "running" else 200)

    @octoprint.plugin.BlueprintPlugin.route("/api/thumb", methods=["GET"])
    @Permissions.FILES_LIST.require(403)
    def api_thumb(self):
        path = flask.request.args.get("path", "")
        width = flask.request.args.get("w", type=int)
        try:
            found = self._meta_service().thumbnail(path, width=width)
        except (ValueError, IOError, OSError) as exc:
            return self._file_error(exc)
        if not found:
            # A file without a thumbnail is normal, not an error: answer "nothing here" so the
            # browser doesn't log a failed request for every such file in the list. It may be
            # cached briefly, since the answer only changes when the file is replaced.
            response = flask.make_response("", 204)
            response.headers["Cache-Control"] = "private, max-age=300"
            return response
        data, mime, etag = found
        response = flask.make_response(data)
        response.headers["Content-Type"] = mime
        response.headers["ETag"] = '"{}"'.format(etag)
        response.headers["Cache-Control"] = "private, max-age=86400"
        return response.make_conditional(flask.request)

    # ~~ Stats and maintenance ------------------------------------------------------

    def _stats_store(self):
        if self._stats is None:
            self._stats = StatsStore(self.get_plugin_data_folder(), self._log)
        return self._stats

    @octoprint.plugin.BlueprintPlugin.route("/api/stats", methods=["GET"])
    @Permissions.STATUS.require(403)
    def api_stats(self):
        return flask.jsonify(self._stats_store().summary())

    @octoprint.plugin.BlueprintPlugin.route("/api/maintenance/<task_id>/reset", methods=["POST"])
    @Permissions.CONTROL.require(403)
    def api_maintenance_reset(self, task_id):
        task_id = "".join(c for c in task_id if c.isalnum() or c in "-_")[:64]
        if not task_id:
            return flask.make_response(flask.jsonify(error="Unknown task."), 400)
        return flask.jsonify(self._stats_store().reset_task(task_id))

    @octoprint.plugin.BlueprintPlugin.route("/api/notify/test", methods=["POST"])
    @Permissions.ADMIN.require(403)
    def api_notify_test(self):
        data = flask.request.get_json(silent=True) or {}
        ok, message = self._notifier.test(data)
        return flask.make_response(flask.jsonify(ok=ok, message=message), 200 if ok else 502)

    # ~~ Events ---------------------------------------------------------------------

    def on_event(self, event, payload):
        try:
            payload = payload or {}
            if event == "PrintStarted" and payload.get("origin") == "local":
                # make sure the layer map exists for the file we are about to spend hours on
                self._meta_service().prefetch(payload.get("path"))
            elif event in ("PrintDone", "PrintFailed", "PrintCancelled"):
                self._record_print(event, payload)
            self._notifier.handle(event, payload)
        except Exception:  # pragma: no cover - never let bookkeeping disturb a print
            self._log.exception("makerforge event handler failed for %s", event)

    def _record_print(self, event, payload):
        result = {"PrintDone": "success", "PrintFailed": "failed", "PrintCancelled": "cancelled"}[event]
        seconds = payload.get("time")
        if seconds is None:
            seconds = payload.get("elapsedTime") or 0
        name = payload.get("name") or os.path.basename(payload.get("path") or "") or "unknown"
        mm, estimated = None, False
        # prefer the layer scan (real extrusion) and scale it by how far the print got
        try:
            if payload.get("origin") == "local" and payload.get("path"):
                status, data = self._meta_service().layers(payload["path"], start=False)
                if status == "ready" and data.get("filamentMm"):
                    mm = float(data["filamentMm"])
        except Exception:
            mm = None
        if mm is None:
            try:
                job = self._printer.get_current_data().get("job", {})
                mm = (job.get("filament") or {}).get("tool0", {}).get("length")
            except Exception:
                mm = None
        if mm and result != "success":
            try:
                completion = (self._printer.get_current_data().get("progress") or {}).get("completion")
                if completion is not None:
                    mm = mm * max(0.0, min(1.0, completion / 100.0))
                    estimated = True
            except Exception:
                estimated = True
        self._stats_store().record(result, name, payload.get("path"), seconds, mm, estimated)

    # ~~ Software update ---------------------------------------------------------------

    def get_update_information(self):
        return dict(
            makerforge=dict(
                displayName="MakerForge UI",
                displayVersion=__version__,
                type="github_release",
                user="28kearlrusa-spec",
                repo="Octoprint",
                current=__version__,
                pip="https://github.com/28kearlrusa-spec/Octoprint/archive/{target_version}.zip",
            )
        )


__plugin_implementation__ = MakerForgePlugin()
__plugin_hooks__ = {
    "octoprint.plugin.softwareupdate.check_config": __plugin_implementation__.get_update_information,
}
