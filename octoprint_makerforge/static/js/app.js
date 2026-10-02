// MakerPrint UI: entry point
import { store, bus } from "mf/core/store.js";
import { boot, octo } from "mf/core/api.js";
import * as auth from "mf/core/auth.js";
import { config } from "mf/core/config.js";
import * as socket from "mf/core/socket.js";
import * as router from "mf/core/router.js";
import * as klipperWatch from "mf/core/klipper-watch.js";
import { initTooltips } from "mf/ui/tooltip.js";
import { toast } from "mf/ui/toast.js";
import { mountShell } from "mf/ui/shell.js";
import { showLogin } from "mf/views/login.js";
import { loadConnectionOptions } from "mf/ui/connect.js";
import { initEvents } from "mf/core/events.js";
import { initPrompts } from "mf/ui/printer-prompt.js";
import * as jobinfo from "mf/core/jobinfo.js";
import * as position from "mf/core/position.js";
import { initDropzone } from "mf/ui/uploads.js";
import { prefs } from "mf/core/prefs.js";
import { setClock } from "mf/core/format.js";

const appRoot = document.getElementById("app");
const bootEl = document.getElementById("boot");
let shell = null;
let started = false;

const ROUTES = [
  { id: "print", title: "Print", load: () => import("mf/views/dashboard.js") },
  { id: "control", title: "Control", load: () => import("mf/views/control.js") },
  { id: "files", title: "Files", load: () => import("mf/views/files.js") },
  { id: "terminal", title: "Terminal", load: () => import("mf/views/terminal.js") },
  { id: "tune", title: "Tune", load: () => import("mf/views/tune.js") },
  { id: "timelapse", title: "Timelapse", load: () => import("mf/views/timelapse.js") },
  { id: "settings", title: "Settings", load: () => import("mf/views/settings.js") },
  { id: "plugins", title: "Plugins", load: () => import("mf/views/plugins.js") },
  { id: "kiosk", title: "Kiosk", load: () => import("mf/views/kiosk.js") },
];

function hideBoot() {
  bootEl.classList.add("is-done");
  setTimeout(() => bootEl.remove(), 600);
}

async function loadServerData() {
  const settled = await Promise.allSettled([octo.settings(), octo.profiles(), loadConnectionOptions(), config.load()]);
  const [settings, profiles] = settled;
  if (settings.status === "fulfilled") store.set("settings", settings.value);
  if (profiles.status === "fulfilled") {
    const map = profiles.value.profiles || {};
    store.set("profiles", map);
    store.set("profile", Object.values(map).find((p) => p.current) || Object.values(map).find((p) => p.default) || null);
  }
  const v = await octo.version().catch(() => null);
  if (v) store.patch("server", { version: v.text || v.server, apiVersion: v.api });
}

// the printer profile can change under us (connect picks one, or the user edits it)
async function refreshProfile() {
  try {
    const p = await octo.profiles();
    const map = p.profiles || {};
    store.set("profiles", map);
    store.set("profile", Object.values(map).find((x) => x.current) || Object.values(map).find((x) => x.default) || null);
  } catch { /* keep what we have */ }
}

// Listeners that live for the whole page. Signing in again after a session ends restarts the
// app, and must not stack a second copy of each (double toasts, double HELP on connect).
let wired = false;
function wireOnce() {
  if (wired) return;
  wired = true;
  klipperWatch.init();
  initEvents();
  initPrompts();
  jobinfo.init();
  position.init();
  bus.on("event:Connected", refreshProfile);
  bus.on("event:PrinterProfileModified", refreshProfile);
}

async function startApp() {
  if (started) return;
  started = true;
  await loadServerData();

  shell = mountShell(appRoot);
  appRoot.hidden = false;
  router.define(ROUTES);

  wireOnce();
  const a = store.get("auth");
  socket.connect(a.loggedIn && a.session ? { user: a.name, session: a.session } : null);

  const mine = shell;
  await router.start(mine.stage, { fallback: "print" });
  if (shell !== mine) return;   // signed out while starting: the sign-in flow owns the page now
  mine.markActive(router.currentRoute());
  hideBoot();
}

function stopApp() {
  socket.disconnect();
  shell?.dispose();
  shell = null;
  started = false;
}

async function requireLogin(message) {
  stopApp();
  document.getElementById("overlays").replaceChildren();
  await showLogin(appRoot, { message });
  await startApp();
}

bus.on("auth:lost", ({ reason }) => {
  if (!started) return;
  requireLogin(reason === "logout" ? "You were signed out." : "Your session ended. Sign in again to keep going.");
});
bus.on("auth:out", () => requireLogin(""));
bus.on("server:changed", () => {
  toast({
    kind: "info", title: "OctoPrint was updated", text: "Reload to pick up the changes.", timeout: 0,
    action: { label: "Reload", onClick: () => location.reload() },
  });
});
bus.on("palette:open", async () => {
  const m = await import("mf/ui/palette.js");
  m.openPalette();
});

document.addEventListener("keydown", (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    bus.emit("palette:open");
  }
});

async function main() {
  initTooltips();
  initDropzone();
  prefs.set("theme", prefs.get("theme"));   // make sure <html> reflects saved prefs
  setClock(prefs.get("clock"));
  prefs.on((k) => { if (k === "clock" || k === "*") setClock(prefs.get("clock")); });
  let ok = false;
  try {
    ({ authorised: ok } = await auth.bootstrap());
  } catch (e) {
    console.error("[boot] auth bootstrap failed", e);
  }
  if (!ok) {
    hideBoot();
    await showLogin(appRoot);
  }
  await startApp();
}

main().catch((e) => {
  console.error("[boot] fatal", e);
  bootEl.querySelector(".boot-text").textContent = "Couldn't start the MakerPrint UI.";
  const f = bootEl.querySelector(".boot-fail");
  f.hidden = false;
  f.append(document.createElement("br"), Object.assign(document.createElement("code"), { textContent: String(e.message || e) }));
});
