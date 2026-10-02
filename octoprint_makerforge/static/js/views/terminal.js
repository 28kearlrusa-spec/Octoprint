// Terminal: the raw conversation with the printer, made pleasant.
import { html, raw, refs, debounce, download, copyText, esc } from "mf/core/dom.js";
import { store } from "mf/core/store.js";
import { term } from "mf/core/telemetry.js";
import { icon } from "mf/ui/icons.js";
import { prefs } from "mf/core/prefs.js";
import * as actions from "mf/core/actions.js";
import { can } from "mf/core/auth.js";
import { COMMON_GCODE, KLIPPER_COMMANDS } from "mf/core/klipper.js";
import { config } from "mf/core/config.js";
import { toast } from "mf/ui/toast.js";
import { confirmDialog } from "mf/ui/dialog.js";

const MAX_DOM = 900;
const HISTORY_KEY = "mf.term.history.v1";
const QUICK = ["M105", "M114", "STATUS", "HELP", "QUERY_ENDSTOPS", "GET_POSITION", "BED_MESH_OUTPUT"];

const loadHistory = () => { try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); } catch { return []; } };
const saveHistory = (h) => { try { localStorage.setItem(HISTORY_KEY, JSON.stringify(h.slice(-200))); } catch { /* ignore */ } };
const pad = (n, w = 2) => String(n).padStart(w, "0");
const stamp = (t) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`; };

export default {
  id: "terminal",
  mount(el) {
    const view = html`
      <div>
        <div class="view-head"><h1>Terminal</h1><span class="view-sub" data-ref="sub"></span></div>
        <section class="panel term-panel" aria-label="Printer terminal">
          <div class="term-tools" role="toolbar" aria-label="Terminal options">
            <input class="input" type="search" placeholder="Search the log" aria-label="Search the log" data-ref="q">
            <span class="sep"></span>
            <button class="chip" data-f="temps" aria-pressed="false" data-tip="Temperature reports (ok T:…)">Hide temps</button>
            <button class="chip" data-f="ok" aria-pressed="false" data-tip="Plain “ok” replies">Hide ok</button>
            <button class="chip" data-f="hidden" aria-pressed="false" data-tip="Background queries such as HELP and M114 that the UI sends for you">Show background</button>
            <button class="chip" data-f="time" aria-pressed="false">Timestamps</button>
            <span class="grow"></span>
            <button class="chip" data-f="scroll" aria-pressed="true">${raw(icon("arrow-down", "i i-sm"))}Follow</button>
            <button class="btn btn-sm btn-ghost btn-icon" data-a="copy" aria-label="Copy log" data-tip="Copy the visible log">${raw(icon("copy"))}</button>
            <button class="btn btn-sm btn-ghost btn-icon" data-a="save" aria-label="Download log" data-tip="Download as text">${raw(icon("download"))}</button>
            <button class="btn btn-sm btn-ghost btn-icon" data-a="clear" aria-label="Clear log" data-tip="Clear the log">${raw(icon("trash"))}</button>
          </div>
          <div class="term-log" data-ref="log" role="log" aria-live="off" tabindex="0"></div>
          <div class="quick-row" data-ref="quick"></div>
          <div class="term-input">
            <span class="prompt">›</span>
            <textarea rows="1" data-ref="inp" spellcheck="false" autocomplete="off" autocapitalize="characters" placeholder="Send G-code or a Klipper command…  (↑ history, Tab completes, Shift+Enter for a new line)" aria-label="G-code command"></textarea>
            <button class="btn btn-primary" data-ref="send">${raw(icon("arrow-right"))}Send</button>
            <div class="suggest" data-ref="sug" hidden role="listbox"></div>
          </div>
        </section>
      </div>`;
    const r = refs(view);
    el.append(view);

    const f = {
      temps: prefs.get("termHideTemps"), ok: prefs.get("termHideOk"), hidden: false, time: false, scroll: prefs.get("termAutoscroll"),
    };
    const syncChips = () => view.querySelectorAll("[data-f]").forEach((b) => b.setAttribute("aria-pressed", String(!!f[b.dataset.f])));
    syncChips();

    // ~~ rendering ~~
    let query = "";
    const visible = (l) => {
      if (l.hidden && !f.hidden) return false;
      if (l.kind === "temp" && f.temps) return false;
      if (l.kind === "ok" && f.ok) return false;
      if (query && !l.raw.toLowerCase().includes(query)) return false;
      return true;
    };
    const GLYPH = { send: "›", recv: "‹", info: "‹", err: "!", warn: "!", ok: "·", temp: "·", sys: "·" };

    function lineEl(l) {
      const body = query ? highlight(l.body, query) : esc(l.body);
      const d = document.createElement("div");
      d.className = `tl tl-${l.kind}`;
      d.innerHTML = `${f.time ? `<span class="ts">${stamp(l.t)}</span>` : ""}<span class="gl">${GLYPH[l.kind] || "·"}</span><span class="tx">${body}</span>`;
      return d;
    }
    function highlight(text, q) {
      const low = text.toLowerCase();
      let out = "", i = 0;
      for (;;) {
        const j = low.indexOf(q, i);
        if (j < 0) { out += esc(text.slice(i)); break; }
        out += esc(text.slice(i, j)) + "<mark>" + esc(text.slice(j, j + q.length)) + "</mark>";
        i = j + q.length;
      }
      return out;
    }

    function fullRender() {
      const frag = document.createDocumentFragment();
      const list = term.lines.filter(visible).slice(-MAX_DOM);
      for (const l of list) frag.append(lineEl(l));
      r.log.replaceChildren(frag);
      stick();
      r.sub.textContent = `${term.lines.length} lines in memory`;
    }
    function stick() { if (f.scroll) r.log.scrollTop = r.log.scrollHeight; }

    let pending = [];
    const flush = debounce(() => {
      const nearBottom = r.log.scrollHeight - r.log.scrollTop - r.log.clientHeight < 60;
      const frag = document.createDocumentFragment();
      for (const l of pending) if (visible(l)) frag.append(lineEl(l));
      pending = [];
      r.log.append(frag);
      while (r.log.childElementCount > MAX_DOM) r.log.firstElementChild.remove();
      if (f.scroll || nearBottom) stick();
      r.sub.textContent = `${term.lines.length} lines in memory`;
    }, 60);
    const offTerm = term.on((added) => {
      if (added === null) { fullRender(); return; }
      pending.push(...added);
      flush();
    });

    // scrolling up pauses "Follow"; reaching the bottom again resumes it
    r.log.addEventListener("scroll", () => {
      const atBottom = r.log.scrollHeight - r.log.scrollTop - r.log.clientHeight < 8;
      if (!atBottom && f.scroll && r.log.dataset.user === "1") { f.scroll = false; syncChips(); }
      else if (atBottom && !f.scroll) { f.scroll = true; syncChips(); }
    });
    for (const ev of ["wheel", "touchmove", "pointerdown"]) r.log.addEventListener(ev, () => { r.log.dataset.user = "1"; }, { passive: true });

    view.addEventListener("click", async (e) => {
      const chip = e.target.closest("[data-f]");
      if (chip) {
        const k = chip.dataset.f;
        f[k] = !f[k];
        if (k === "temps") prefs.set("termHideTemps", f[k]);
        if (k === "ok") prefs.set("termHideOk", f[k]);
        if (k === "scroll") { prefs.set("termAutoscroll", f[k]); r.log.dataset.user = ""; }
        syncChips();
        fullRender();
        return;
      }
      const a = e.target.closest("[data-a]")?.dataset.a;
      if (a === "clear") { term.clear(); }
      else if (a === "copy") { await copyText(Array.from(r.log.children, (n) => n.textContent).join("\n")); toast.ok("Log copied"); }
      else if (a === "save") download(`printer-log-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.txt`, term.lines.filter(visible).map((l) => `${stamp(l.t)}  ${l.raw}`).join("\n"));
    });
    r.q.addEventListener("input", debounce(() => { query = r.q.value.trim().toLowerCase(); fullRender(); }, 150));

    // ~~ sending ~~
    const history = loadHistory();
    let hIdx = history.length;
    let draft = "";
    async function submit() {
      // like OctoPrint's own terminal: the command name is upper-cased, arguments are left alone
      const text = r.inp.value.trim().split("\n").map((l) => l.replace(/^\s*[a-z][a-z0-9_]*/i, (w) => w.toUpperCase())).join("\n");
      if (!text) return;
      if (!can("control")) { toast.warn("Not allowed", "Your account can't send commands."); return; }
      // M112 kills the printer; ask first when typed by hand
      if (/^\s*M112\b/i.test(text) && !(await confirmDialog({ title: "Emergency stop?", text: "M112 halts the printer immediately. You'll need a firmware restart afterwards.", confirm: "Send M112", danger: true }))) return;
      try {
        if (/\bM114\b/i.test(text)) term.unhide();
        term.markTyped(text);
        await actions.gcode(text);
        if (history[history.length - 1] !== text) { history.push(text); saveHistory(history); }
        hIdx = history.length;
        r.inp.value = "";
        autosize();
        hideSuggest();
        f.scroll = true; syncChips(); r.log.dataset.user = "";
      } catch { /* toast shown */ }
    }
    r.send.addEventListener("click", submit);
    const autosize = () => { r.inp.style.height = "auto"; r.inp.style.height = Math.min(140, r.inp.scrollHeight) + "px"; };

    // ~~ autocomplete ~~
    let sugItems = [], sugIdx = -1;
    function dictionary() {
      const seen = new Map();
      for (const [c, d] of COMMON_GCODE) seen.set(c, d);
      for (const [c, d] of KLIPPER_COMMANDS) seen.set(c, d);
      const discovered = store.get("klipper.commands");
      if (discovered) for (const [c, d] of Object.entries(discovered)) seen.set(c, d || seen.get(c) || "Klipper command");
      for (const m of config.data.macros) { const c = m.gcode.split(/\s|\n/)[0]; if (/^[A-Z_]/.test(c) && !seen.has(c)) seen.set(c, m.name); }
      return seen;
    }
    function updateSuggest() {
      const val = r.inp.value;
      const firstLine = val.split("\n").pop();
      if (!firstLine || /\s/.test(firstLine.trim()) && firstLine.trim().includes(" ")) return hideSuggest();
      const token = firstLine.trim().toUpperCase();
      if (token.length < 1) return hideSuggest();
      sugItems = [];
      for (const [c, d] of dictionary()) if (c.startsWith(token) && c !== token) sugItems.push([c, d]);
      sugItems.sort((a, b) => a[0].length - b[0].length || a[0].localeCompare(b[0]));
      sugItems = sugItems.slice(0, 8);
      if (!sugItems.length) return hideSuggest();
      sugIdx = 0;
      renderSuggest();
    }
    function renderSuggest() {
      r.sug.hidden = false;
      r.sug.replaceChildren(...sugItems.map(([c, d], i) => {
        const b = html`<button role="option" class="${i === sugIdx ? "is-on" : ""}" aria-selected="${i === sugIdx}"><b>${c}</b><span>${d}</span></button>`;
        b.addEventListener("mousedown", (e) => { e.preventDefault(); accept(i); });
        return b;
      }));
    }
    function hideSuggest() { r.sug.hidden = true; sugItems = []; sugIdx = -1; }
    function accept(i) {
      const [c] = sugItems[i];
      const lines = r.inp.value.split("\n");
      lines[lines.length - 1] = c + " ";
      r.inp.value = lines.join("\n");
      hideSuggest();
      r.inp.focus();
    }
    r.inp.addEventListener("input", () => { autosize(); updateSuggest(); });
    r.inp.addEventListener("blur", () => setTimeout(hideSuggest, 120));
    r.inp.addEventListener("keydown", (e) => {
      const open = !r.sug.hidden && sugItems.length;
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (open && sugItems[sugIdx] && r.inp.value.trim().toUpperCase() !== sugItems[sugIdx][0] && e.altKey) return accept(sugIdx);
        submit();
      } else if (e.key === "Tab" && open) { e.preventDefault(); accept(sugIdx); }
      else if (e.key === "ArrowDown" && open) { e.preventDefault(); sugIdx = (sugIdx + 1) % sugItems.length; renderSuggest(); }
      else if (e.key === "ArrowUp" && open) { e.preventDefault(); sugIdx = (sugIdx - 1 + sugItems.length) % sugItems.length; renderSuggest(); }
      else if (e.key === "Escape") hideSuggest();
      else if (e.key === "ArrowUp" && !open && !r.inp.value.includes("\n") && r.inp.selectionStart === 0) {
        e.preventDefault();
        if (hIdx === history.length) draft = r.inp.value;
        if (hIdx > 0) { hIdx--; r.inp.value = history[hIdx]; autosize(); }
      } else if (e.key === "ArrowDown" && !open && hIdx < history.length) {
        e.preventDefault();
        hIdx++;
        r.inp.value = hIdx === history.length ? draft : history[hIdx];
        autosize();
      }
    });

    // quick commands
    r.quick.replaceChildren(...QUICK.map((c) => {
      const b = html`<button class="chip">${c}</button>`;
      b.addEventListener("click", () => { r.inp.value = c; submit(); });
      return b;
    }));

    function enable() {
      const on = (store.get("printer.flags.operational") || store.get("printer.flags.printing")) && can("control");
      r.inp.disabled = r.send.disabled = !on;
      r.inp.placeholder = on ? r.inp.placeholder : "Connect the printer to send commands.";
      r.quick.querySelectorAll("button").forEach((b) => { b.disabled = !on; });
    }
    const offs = [store.on("printer", enable), store.on("auth", enable)];
    enable();
    fullRender();
    requestAnimationFrame(() => { r.log.scrollTop = r.log.scrollHeight; });
    if (matchMedia("(hover: hover)").matches) r.inp.focus();

    return { unmount() { offTerm(); offs.forEach((o) => o()); } };
  },
};
