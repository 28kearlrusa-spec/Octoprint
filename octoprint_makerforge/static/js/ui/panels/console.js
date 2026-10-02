// Console: the last few lines from the printer and a command line, on the Print page.
// The full terminal (search, filters, autocomplete) is one click away.
import { html, raw, refs, debounce, esc } from "mf/core/dom.js";
import { store } from "mf/core/store.js";
import { term } from "mf/core/telemetry.js";
import { icon } from "mf/ui/icons.js";
import { prefs } from "mf/core/prefs.js";
import * as actions from "mf/core/actions.js";
import { can } from "mf/core/auth.js";
import { confirmDialog } from "mf/ui/dialog.js";
import * as router from "mf/core/router.js";

// shared with the Terminal screen, so ↑ brings back commands typed in either place
const HISTORY_KEY = "mf.term.history.v1";
const loadHistory = () => { try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); } catch { return []; } };
const saveHistory = (h) => { try { localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(-200))); } catch { /* storage blocked */ } };
const GLYPH = { send: "›", recv: "‹", info: "‹", err: "!", warn: "!", ok: "·", temp: "·", sys: "·" };

export function mountConsole(host) {
  const el = html`
    <section class="panel a-console" aria-label="Console">
      <div class="panel-head"><h2 class="panel-title">Console</h2>
        <div class="panel-tools"><a class="btn btn-sm btn-ghost" href="${router.href("terminal")}">${raw(icon("terminal"))}Full terminal</a></div></div>
      <div class="con-log term-log" data-ref="log" role="log" aria-live="off" tabindex="0"></div>
      <form class="con-input" data-ref="form">
        <span class="prompt" aria-hidden="true">›</span>
        <input class="input is-mono" data-ref="inp" spellcheck="false" autocomplete="off" autocapitalize="characters" placeholder="G-code or a Klipper command" aria-label="Command to send">
        <button class="btn btn-sm btn-primary" data-ref="send">Send</button>
      </form>
    </section>`;
  const r = refs(el);
  host.append(el);

  const visible = (l) => !l.hidden && !(l.kind === "temp" && prefs.get("termHideTemps")) && !(l.kind === "ok" && prefs.get("termHideOk"));
  const lineEl = (l) => {
    const d = document.createElement("div");
    d.className = `tl tl-${l.kind}`;
    d.innerHTML = `<span class="gl">${GLYPH[l.kind] || "·"}</span><span class="tx">${esc(l.body)}</span>`;
    return d;
  };

  function sizeLog() {
    const n = Math.max(4, Math.min(40, Number(prefs.get("consoleLines")) || 12));
    r.log.style.setProperty("--lines", String(n));
    return n;
  }
  function render() {
    const n = sizeLog();
    const list = term.lines.filter(visible).slice(-n * 3);
    r.log.replaceChildren(...list.map(lineEl));
    r.log.scrollTop = r.log.scrollHeight;
  }
  const flush = debounce(render, 80);
  const offTerm = term.on(flush);

  const history = loadHistory();
  let hIdx = history.length, draft = "";
  r.form.addEventListener("submit", async (e) => {
    e.preventDefault();
    // like OctoPrint's terminal: the command word is upper-cased, the arguments are left alone
    const text = r.inp.value.trim().replace(/^\s*[a-z][a-z0-9_]*/i, (w) => w.toUpperCase());
    if (!text) return;
    if (/^M112\b/i.test(text) && !(await confirmDialog({ title: "Emergency stop?", text: "M112 halts the printer immediately. You'll need a firmware restart afterwards.", confirm: "Send M112", danger: true }))) return;
    try {
      if (/\bM114\b/i.test(text)) term.unhide();
      await actions.gcode(text);
      if (history[history.length - 1] !== text) { history.push(text); saveHistory(history); }
      hIdx = history.length;
      r.inp.value = "";
    } catch { /* toast shown */ }
  });
  r.inp.addEventListener("keydown", (e) => {
    if (e.key === "ArrowUp" && hIdx > 0) {
      e.preventDefault();
      if (hIdx === history.length) draft = r.inp.value;
      r.inp.value = history[--hIdx];
    } else if (e.key === "ArrowDown" && hIdx < history.length) {
      e.preventDefault();
      hIdx++;
      r.inp.value = hIdx === history.length ? draft : history[hIdx];
    }
  });

  function enable() {
    const f = store.get("printer.flags");
    const on = !!(f.operational || f.printing || f.paused) && can("control");
    r.inp.disabled = r.send.disabled = !on;
    r.inp.placeholder = on ? "G-code or a Klipper command" : "Connect the printer to send commands";
  }
  const offs = [
    store.on("printer", enable), store.on("auth", enable),
    prefs.on((k) => { if (k === "consoleLines" || k === "termHideTemps" || k === "termHideOk" || k === "*") render(); }),
  ];
  enable();
  render();
  return { dispose() { offTerm(); offs.forEach((o) => o()); el.remove(); } };
}
