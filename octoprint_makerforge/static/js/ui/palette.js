// Command palette (Ctrl/Cmd+K): jump anywhere, run a macro, preheat, find a file, or send G-code.
import { html, raw, refs, esc } from "mf/core/dom.js";
import { store } from "mf/core/store.js";
import { icon } from "mf/ui/icons.js";
import { octo, boot } from "mf/core/api.js";
import { config } from "mf/core/config.js";
import { prefs, THEMES } from "mf/core/prefs.js";
import * as router from "mf/core/router.js";
import * as actions from "mf/core/actions.js";
import { availability, runMacro, macroIcon } from "mf/ui/macros.js";
import { can, signOut } from "mf/core/auth.js";
import { confirmDialog } from "mf/ui/dialog.js";
import { openConnect } from "mf/ui/connect.js";
import { stripExt } from "mf/core/format.js";

let open = false;

/** Subsequence fuzzy score: higher is better, 0 means no match. */
export function score(query, text) {
  if (!query) return 1;
  const q = query.toLowerCase(), t = text.toLowerCase();
  const idx = t.indexOf(q);
  if (idx === 0) return 1000 - t.length;
  if (idx > 0) return (t[idx - 1] === " " || t[idx - 1] === "_" ? 800 : 600) - idx;
  let ti = 0, s = 0, run = 0;
  for (const ch of q) {
    const j = t.indexOf(ch, ti);
    if (j < 0) return 0;
    run = j === ti ? run + 1 : 0;
    s += 10 + run * 5 - Math.min(j - ti, 8);
    ti = j + 1;
  }
  return Math.max(1, s);
}

async function build() {
  const s = store.state;
  const f = s.printer.flags;
  const printing = f.printing || f.paused || f.pausing;
  const items = [];
  const add = (group, label, ic, run, extra = {}) => items.push({ group, label, ic, run, ...extra });

  for (const [id, label, ic] of [["print", "Print", "cube"], ["control", "Control", "control"], ["files", "Files", "folder"], ["terminal", "Terminal", "terminal"], ["tune", "Tune", "tune"], ["timelapse", "Timelapse", "film"], ["settings", "Settings", "settings"], ["kiosk", "Kiosk mode", "maximize"]]) {
    add("Go to", label, ic, () => router.go(id));
  }
  if (f.operational && can("control")) {
    add("Printer", "Home all axes", "home", () => actions.home());
    add("Printer", "Cool down (all heaters off)", "snow", () => actions.cooldown());
    for (const p of config.data.presets) add("Preheat", `${p.name}  ${p.nozzle}° / ${p.bed}°`, "flame", () => actions.preheat(p), { key: `preheat ${p.name}` });
  }
  if (printing && can("print")) {
    add("Print", f.paused || f.pausing ? "Resume print" : "Pause print", f.paused ? "play" : "pause", () => (f.paused || f.pausing ? actions.resumePrint() : actions.pausePrint()));
    add("Print", "Cancel print…", "stop", async () => { if (await confirmDialog({ title: "Cancel this print?", text: "The print stops and can't be resumed.", confirm: "Cancel print", cancel: "Keep printing", danger: true })) actions.cancelPrint(); });
  }
  if (f.operational) {
    add("Klipper", "Restart Klipper", "refresh", async () => { if (await confirmDialog({ title: "Restart Klipper?", confirm: "Restart", danger: true })) actions.klipperRestart(); });
    add("Klipper", "Firmware restart", "refresh", async () => { if (await confirmDialog({ title: "Restart the firmware?", confirm: "Restart", danger: true })) actions.firmwareRestart(); });
  }
  add("Printer", f.operational || printing ? "Disconnect printer" : "Connect printer…", "plug", () => (f.operational || printing ? actions.disconnectPrinter() : openConnect()));
  for (const m of config.data.macros) {
    const a = availability(m);
    add(`Macros: ${m.cat || "Other"}`, m.name, "bolt", () => runMacro(m), { ic: null, rawIcon: macroIcon(m), disabled: !a.ok, hint: a.ok ? m.gcode.split("\n")[0] : a.reason, key: `${m.name} ${m.gcode}` });
  }
  for (const t of THEMES) add("Theme", `${t.name} theme`, "palette", () => prefs.set("theme", t.id));
  add("Account", "Open the classic OctoPrint UI", "external", () => { document.cookie = "mf_ui=classic; path=/; max-age=31536000; SameSite=Lax"; location.href = boot.classicUrl; });
  if (s.auth.loggedIn) add("Account", "Sign out", "logout", () => signOut());

  // files, fetched fresh
  if (can("files_list")) {
    try {
      const res = await octo.files();
      const walk = (list) => list.forEach((x) => (x.children ? walk(x.children) : x.type === "machinecode" && add("File", stripExt(x.display || x.name), "file-code", () => import("mf/ui/panels/job.js").then((m) => m.startWithChecks(x.path)), { hint: `Print ${x.path}`, key: x.path })));
      walk(res.files || []);
    } catch { /* offline: skip files */ }
  }
  return items;
}

export async function openPalette() {
  if (open) return;
  open = true;
  const previous = document.activeElement;
  const scrim = html`
    <div class="scrim" style="align-items:start;padding-top:12vh">
      <div class="dialog cut cut-l" role="dialog" aria-modal="true" aria-label="Command palette" style="width:min(640px,100%)">
        <div class="row" style="padding:var(--s-3) var(--s-4);border-bottom:1px solid var(--line-2)">${raw(icon("search"))}
          <input class="input" style="border:0;background:transparent;font-size:var(--fs-lg);min-height:40px" data-ref="q" placeholder="Type a command, macro or file name…  (start with &gt; to send G-code)" autocomplete="off" spellcheck="false" aria-label="Command"></div>
        <div data-ref="list" role="listbox" style="max-height:min(56vh,460px);overflow:auto;padding:var(--s-1)"></div>
        <div class="row" style="padding:var(--s-2) var(--s-4);border-top:1px solid var(--line-2);color:var(--tx-3);font-size:var(--fs-xs)"><span><kbd>↑</kbd><kbd>↓</kbd> choose</span><span><kbd>⏎</kbd> run</span><span><kbd>Esc</kbd> close</span></div>
      </div>
    </div>`;
  const r = refs(scrim);
  document.getElementById("overlays").append(scrim);
  r.q.focus();

  let items = [], shown = [], sel = 0;
  const close = () => { open = false; scrim.remove(); document.removeEventListener("keydown", onKey, true); previous?.focus?.(); };
  build().then((all) => { items = all; render(); });

  function render() {
    const q = r.q.value.trim();
    if (q.startsWith(">")) {
      const cmd = q.slice(1).trim();
      shown = cmd ? [{ group: "G-code", label: `Send  ${cmd.toUpperCase()}`, ic: "terminal", run: () => actions.gcode(cmd.toUpperCase()), hint: "Sent exactly as typed" }] : [];
    } else {
      shown = items.map((it) => ({ it, s: score(q, `${it.label} ${it.key || ""} ${it.group}`) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 12).map((x) => x.it);
    }
    sel = Math.min(sel, Math.max(0, shown.length - 1));
    r.list.innerHTML = shown.length ? shown.map((it, i) => `
      <button class="menu-item ${i === sel ? "is-sel" : ""}" role="option" aria-selected="${i === sel}" data-i="${i}" ${it.disabled ? 'aria-disabled="true" style="opacity:.5"' : ""} style="min-height:44px;${i === sel ? "background:var(--bg-5)" : ""}">
        ${it.rawIcon || icon(it.ic || "bolt")}<span class="grow truncate">${esc(it.label)}${it.hint ? `<span class="muted" style="margin-left:10px;font-size:var(--fs-xs)">${esc(it.hint)}</span>` : ""}</span><span class="chip" style="min-height:20px">${esc(it.group)}</span></button>`).join("")
      : `<div class="empty" style="padding:var(--s-6)"><div class="empty-text">${items.length ? "Nothing matches." : "Loading…"}</div></div>`;
    r.list.querySelector(".is-sel")?.scrollIntoView({ block: "nearest" });
  }
  async function run(i) {
    const it = shown[i];
    if (!it || it.disabled) return;
    close();
    try { await it.run(); } catch { /* the action reports its own errors */ }
  }
  function onKey(e) {
    if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(shown.length - 1, sel + 1); render(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(0, sel - 1); render(); }
    else if (e.key === "Enter") { e.preventDefault(); run(sel); }
  }
  document.addEventListener("keydown", onKey, true);
  r.q.addEventListener("input", () => { sel = 0; render(); });
  r.list.addEventListener("click", (e) => { const b = e.target.closest("[data-i]"); if (b) run(Number(b.dataset.i)); });
  scrim.addEventListener("mousedown", (e) => { if (e.target === scrim) close(); });
}
