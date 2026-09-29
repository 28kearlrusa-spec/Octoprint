// The frame around every screen: rail, top bar, tab bar, status LED, gantry progress line.
import { html, raw, refs, on } from "mf/core/dom.js";
import { store, bus } from "mf/core/store.js";
import { boot } from "mf/core/api.js";
import { icon } from "mf/ui/icons.js";
import { machineStatus, progressFrac, timeLeft } from "mf/core/status.js";
import * as router from "mf/core/router.js";
import { prefs, THEMES } from "mf/core/prefs.js";
import { openMenu } from "mf/ui/menu.js";
import { holdToConfirm } from "mf/ui/dialog.js";
import * as actions from "mf/core/actions.js";
import { signOut, can } from "mf/core/auth.js";
import { config } from "mf/core/config.js";
import { duration, num } from "mf/core/format.js";
import { openConnect } from "mf/ui/connect.js";

export const NAV = [
  { id: "print", label: "Print", icon: "cube" },
  { id: "control", label: "Control", icon: "control" },
  { id: "files", label: "Files", icon: "folder" },
  { id: "terminal", label: "Terminal", icon: "terminal" },
  { id: "tune", label: "Tune", icon: "tune" },
  { id: "timelapse", label: "Timelapse", icon: "film" },
];
const MOBILE_MAIN = ["print", "control", "files", "terminal"];

const sb = boot.staticBase;

export function mountShell(root) {
  const linkHtml = (n) => `<a class="rail-link" href="#/${n.id}" data-id="${n.id}" aria-label="${n.label}">${icon(n.icon)}<span>${n.label}</span></a>`;
  const el = html`
    <div class="shell" data-state="offline" data-tone="off" data-active="0">
      <aside class="rail" aria-label="Main">
        <a class="rail-led" href="#/print" data-ref="led" aria-label="Printer status" data-tip="Printer status">
          <img src="${sb}/img/icon-192.png" alt="" width="44" height="44">
        </a>
        <nav class="rail-nav" data-ref="nav">
          <i class="tnut" data-ref="tnut"></i>
          ${raw(NAV.map(linkHtml).join(""))}
        </nav>
        <div class="rail-foot">
          <a class="rail-link" href="#/settings" data-id="settings" aria-label="Settings">${raw(icon("settings"))}<span>Settings</span></a>
        </div>
      </aside>

      <header class="topbar">
        <a class="top-mark" href="#/print" aria-label="MakerForge, home"><img src="${sb}/img/icon-192.png" alt="" width="32" height="32"></a>
        <div class="top-status">
          <div class="top-name truncate" data-ref="name">Printer</div>
          <div class="top-state"><span class="dot"></span><span data-ref="state" class="truncate">Connecting…</span></div>
        </div>
        <a class="top-job" href="#/print" data-ref="job">
          <span class="truncate" data-ref="jobname"></span>
          <span class="num tnum" data-ref="jobpct"></span>
          <span class="tnum nowrap muted" data-ref="jobleft"></span>
        </a>
        <div class="top-actions">
          <button class="btn btn-sm" data-ref="conn">${raw(icon("plug"))}<span class="btn-label">Connect</span></button>
          <button class="btn btn-icon btn-ghost" data-ref="palette" aria-label="Search and commands" data-tip="Commands  ⌘K">${raw(icon("command"))}</button>
          <button class="btn btn-danger btn-sm" data-ref="estop" aria-label="Emergency stop" data-tip="Hold to stop the printer (M112)">${raw(icon("octagon"))}<span class="btn-label">E-stop</span></button>
          <button class="btn btn-icon btn-ghost" data-ref="user" aria-label="Account and appearance">${raw(icon("user"))}</button>
        </div>
        <div class="gantry" data-ref="gantry"><i></i></div>
      </header>

      <main class="stage" tabindex="-1">
        <div class="netbar" data-ref="netbar" role="status" hidden><span class="netbar-ic" data-ref="netic"></span><span data-ref="nettext" class="grow"></span><button class="btn btn-sm" data-ref="netact" hidden></button><button class="btn btn-sm btn-ghost" data-ref="netretry">Retry now</button></div>
        <div id="stage"></div>
      </main>

      <nav class="tabbar" data-ref="tabbar" aria-label="Main">
        ${raw(NAV.filter((n) => MOBILE_MAIN.includes(n.id)).map(linkHtml).join(""))}
        <button class="rail-link" data-ref="more" aria-label="More">${raw(icon("menu"))}<span>More</span></button>
      </nav>
    </div>`;
  const r = refs(el);
  root.replaceChildren(el);

  // ~~ nav highlight + sliding T-nut ~~
  function markActive(route) {
    const id = route?.id || "print";
    el.querySelectorAll(".rail-link[data-id]").forEach((a) => {
      if (a.dataset.id === id) a.setAttribute("aria-current", "page");
      else a.removeAttribute("aria-current");
    });
    const active = r.nav.querySelector(`.rail-link[data-id="${id}"]`);
    if (active && active.offsetParent) {
      const y = active.offsetTop + (active.offsetHeight - r.tnut.offsetHeight) / 2;
      r.tnut.style.setProperty("--y", `${y}px`);
      r.tnut.style.setProperty("--o", "1");
    } else {
      // Settings sits in the footer, outside the nav: park the nut beside it
      const foot = el.querySelector(`.rail-foot .rail-link[data-id="${id}"]`);
      if (foot && foot.offsetParent) {
        const y = foot.getBoundingClientRect().top - r.nav.getBoundingClientRect().top + (foot.offsetHeight - r.tnut.offsetHeight) / 2;
        r.tnut.style.setProperty("--y", `${y}px`);
        r.tnut.style.setProperty("--o", "1");
      } else r.tnut.style.setProperty("--o", "0");
    }
  }
  const offRoute = router.onChange(markActive);
  window.addEventListener("resize", () => markActive(router.currentRoute()));

  // ~~ live status ~~
  function refresh() {
    const s = store.state;
    const st = machineStatus(s);
    el.dataset.state = st.key;
    el.dataset.tone = st.tone;
    el.dataset.active = st.active && (st.key === "printing" || st.key === "paused" || st.key === "heating" || st.key === "pausing" || st.key === "cancelling") && s.job?.file?.name ? "1" : "0";

    r.name.textContent = config.data.printerName || s.profile?.name || "Printer";
    // the label says it all for the calm states; errors and warnings add what to do about it
    r.state.textContent = st.detail && (st.tone === "err" || st.tone === "warn") ? `${st.label}: ${st.detail}` : st.label;
    r.state.title = st.detail || "";

    const frac = progressFrac(s);
    const left = timeLeft(s);
    r.gantry.style.setProperty("--p", `${((frac ?? 0) * 100).toFixed(2)}%`);
    if (el.dataset.active === "1") {
      r.jobname.textContent = (s.job?.file?.display || s.job?.file?.name || "").replace(/\.(gcode|gco|g)$/i, "");
      r.jobpct.textContent = frac == null ? "" : `${Math.floor(frac * 100)}%`;
      r.jobleft.textContent = left == null ? "" : `${duration(left)} left`;
    }

    // connection chip
    const f = s.printer.flags;
    if (f.operational || f.printing || f.paused) {
      r.conn.innerHTML = `${icon("plug")}<span class="btn-label">Connected</span>`;
      r.conn.classList.add("btn-ghost");
    } else if (st.key === "connecting") {
      r.conn.innerHTML = `${icon("refresh", "i spin")}<span class="btn-label">Connecting…</span>`;
    } else {
      r.conn.innerHTML = `${icon("plug")}<span class="btn-label">Connect</span>`;
      r.conn.classList.remove("btn-ghost");
    }
    r.estop.disabled = !(f.operational || f.printing || f.paused);

    // one banner for the two things that need attention from anywhere: a stopped Klipper, or a lost live link
    const k = s.klipper;
    const sock = s.net?.socket;
    const stopped = k?.state === "shutdown" || k?.state === "disconnected" || st.key === "error";
    const shaky = sock === "down" || sock === "reconnecting" || sock === "polling";
    r.netbar.hidden = !(stopped || shaky);
    r.netbar.classList.toggle("is-alert", !!stopped);
    r.netact.hidden = !stopped;
    r.netretry.hidden = !!stopped;
    if (stopped) {
      r.netic.innerHTML = icon("octagon", "i i-sm");
      const why = k?.message || s.printer?.error || k?.lastError || "The printer stopped.";
      r.nettext.textContent = `${k?.state === "shutdown" ? "Klipper has shut down" : "The printer reported an error"}: ${String(why).slice(0, 140)}`;
      r.netact.textContent = k?.detected ? "Firmware restart" : "Open terminal";
    } else if (shaky) {
      r.netic.innerHTML = icon("wifi-off", "i i-sm");
      r.nettext.textContent = sock === "polling" ? "Live updates are blocked here, so the page refreshes every couple of seconds." : "Lost the live connection to OctoPrint. Reconnecting…";
    }

    // browser tab: "42% benchy – MakerForge", so progress shows from another tab
    if (prefs.get("tabTitle") && el.dataset.active === "1" && frac != null) {
      document.title = `${st.key === "paused" ? "Paused " : ""}${Math.floor(frac * 100)}% ${r.jobname.textContent} – MakerForge`;
    }
  }
  const offs = [
    store.on("printer", refresh), store.on("temps", refresh), store.on("progress", refresh), store.on("job", refresh),
    store.on("klipper", refresh), store.on("net", refresh), store.on("config", refresh), store.on("profile", refresh),
  ];
  refresh();
  const tick = setInterval(refresh, 5000);   // "unreachable" is time-based

  // ~~ controls ~~
  holdToConfirm(r.estop, () => actions.emergencyStop(), 650);
  r.conn.addEventListener("click", () => {
    const f = store.get("printer.flags");
    if (f.operational || f.printing || f.paused) connectionMenu(r.conn);
    else openConnect();
  });
  r.palette.addEventListener("click", () => bus.emit("palette:open"));
  r.netretry.addEventListener("click", () => bus.emit("socket:retry"));
  r.netact.addEventListener("click", () => (store.get("klipper.detected") ? actions.firmwareRestart().catch(() => {}) : router.go("terminal")));
  r.user.addEventListener("click", () => userMenu(r.user));
  r.more.addEventListener("click", () => moreMenu(r.more));

  return {
    stage: el.querySelector("#stage"),
    el,
    markActive,
    dispose() { offRoute(); offs.forEach((o) => o()); clearInterval(tick); },
  };
}

function connectionMenu(anchor) {
  const klipper = store.get("klipper.detected");
  openMenu(anchor, [
    { header: "Printer connection" },
    klipper && { label: "Firmware restart", icon: "refresh", onClick: () => actions.firmwareRestart() },
    klipper && { label: "Restart Klipper", icon: "refresh", onClick: () => actions.klipperRestart() },
    klipper && { sep: true },
    { label: "Disconnect", icon: "power", danger: true, onClick: () => actions.disconnectPrinter() },
  ], { align: "end" });
}

export function userMenu(anchor) {
  const a = store.get("auth");
  const cur = prefs.get("theme");
  openMenu(anchor, [
    { header: a.loggedIn ? `Signed in as ${a.name}` : "Guest" },
    { header: "Theme" },
    ...THEMES.map((t) => ({ label: t.name, checked: cur === t.id, onClick: () => prefs.set("theme", t.id) })),
    { sep: true },
    { label: "Settings", icon: "settings", onClick: () => router.go("settings") },
    { label: "Classic OctoPrint UI", icon: "external", onClick: () => {
      document.cookie = "mf_ui=classic; path=/; max-age=31536000; SameSite=Lax";
      location.href = boot.classicUrl;
    } },
    a.loggedIn && { sep: true },
    a.loggedIn && { label: "Sign out", icon: "logout", danger: true, onClick: () => signOut() },
  ], { align: "end" });
}

function moreMenu(anchor) {
  openMenu(anchor, [
    ...NAV.filter((n) => !MOBILE_MAIN.includes(n.id)).map((n) => ({ label: n.label, icon: n.icon, onClick: () => router.go(n.id) })),
    { label: "Settings", icon: "settings", onClick: () => router.go("settings") },
    { sep: true },
    { label: "Commands", icon: "command", onClick: () => bus.emit("palette:open") },
    { label: "Appearance", icon: "palette", onClick: () => userMenu(anchor) },
  ], { align: "end" });
}
