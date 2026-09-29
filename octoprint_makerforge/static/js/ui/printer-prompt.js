// Shows the questions the printer asks (macro prompts) and the messages it sends
// (action:notification). The protocol lives in core/prompts.js.
import { h } from "mf/core/dom.js";
import { store, bus } from "mf/core/store.js";
import { octo } from "mf/core/api.js";
import { can } from "mf/core/auth.js";
import { gcode } from "mf/core/actions.js";
import { chime } from "mf/core/events.js";
import { PromptReader } from "mf/core/prompts.js";
import { openDialog } from "mf/ui/dialog.js";
import { toast } from "mf/ui/toast.js";

const reader = new PromptReader();
let hostPrompt = null;   // {text, choices} from OctoPrint's Action Command Prompt plugin
let open = null;         // {source, sig, dialog}

// Mainsail's colour names, in this theme
const KIND = { primary: "btn-primary", secondary: "btn-alt", info: "btn-info", warning: "btn-warn", error: "btn-danger" };

// Which prompt belongs on screen. On Klipper, the macro lines. On other firmware, OctoPrint's
// plugin (its buttons answer with M876; the macro dialect's buttons would send their labels).
// Until the firmware is known (a second or two after the page opens), only OctoPrint's.
function wanted() {
  if (store.get("klipper.detected") === true) return reader.shown ? { source: "macro", prompt: reader.shown } : null;
  return hostPrompt ? { source: "host", prompt: hostPrompt } : null;
}

const signature = (w) => JSON.stringify(w.source === "macro" ? [w.prompt.title, w.prompt.items, w.prompt.footer] : [w.prompt.text, w.prompt.choices]);

function sync() {
  if (open && !open.dialog.el.isConnected) open = null;   // the overlays were cleared (signed out)
  const w = wanted();
  if (open && (!w || w.source !== open.source)) {
    const was = open;
    open = null;
    was.dialog.close("printer");
  }
  if (!w) return;
  if (!open) return show(w);
  // the same prompt again (a replayed log), or the printer added to it and showed it again
  const sig = signature(w);
  if (sig !== open.sig) { open.sig = sig; fill(open.dialog, w); }
}

function button(b, kind, onClick) {
  const cls = KIND[b.color] || kind;
  const el = h(cls ? `button.btn.${cls}` : "button.btn", { type: "button" }, b.label);
  if (b.gcode && b.gcode !== b.label) el.dataset.tip = b.gcode;   // what it will run
  el.addEventListener("click", () => onClick(el));
  return el;
}

async function runMacroButton(b, el) {
  el.classList.add("is-busy");
  try { await gcode(b.gcode); } catch { /* the failure toast is already up */ }
  // the macro closes the prompt itself when it is done with it (prompt_end)
  setTimeout(() => el.classList.remove("is-busy"), 500);
}

async function answerHost(i, el) {
  el.classList.add("is-busy");
  try {
    await octo.answerPrompt(i);
    hostPrompt = null;
    sync();
  } catch (e) {
    el.classList.remove("is-busy");
    toast.fail("Couldn't answer the printer", e);
  }
}

function fill(dialog, w) {
  const title = (w.source === "macro" && w.prompt.title) || "The printer is asking";
  const head = dialog.el.querySelector(".dialog-title");
  if (head) head.textContent = title;
  dialog.el.setAttribute("aria-label", title);

  const body = h("div.mprompt");
  let foot;
  if (w.source === "macro") {
    for (const it of w.prompt.items) {
      if (it.kind === "text") { if (it.text) body.append(h("p.mprompt-text", it.text)); continue; }
      if (!it.buttons.length) continue;
      const row = h(it.grouped ? "div.mprompt-row.is-group" : "div.mprompt-row");
      for (const b of it.buttons) row.append(button(b, "", (el) => runMacroButton(b, el)));
      body.append(row);
    }
    foot = w.prompt.footer.map((b) => button(b, "btn-ghost", (el) => runMacroButton(b, el)));
  } else {
    body.append(h("p.mprompt-text", w.prompt.text));
    foot = w.prompt.choices.map((c, i) => button({ label: c }, i === 0 ? "btn-primary" : "", (el) => answerHost(i, el)));
  }
  body.append(h("p.mprompt-src", w.source === "macro" ? "Asked by a macro on the printer" : "Asked by the printer"));
  dialog.body.replaceChildren(body);

  let footEl = dialog.el.querySelector(".mprompt-foot");
  if (foot.length) {
    if (!footEl) { footEl = h("div.dialog-foot.mprompt-foot"); dialog.el.append(footEl); }
    footEl.replaceChildren(...foot);
  } else footEl?.remove();
}

function show(w) {
  const dialog = openDialog({
    title: "The printer is asking",
    className: "mprompt-dialog",
    scrimClose: false,   // a stray click must not throw away the printer's question
    // Focus the dialog itself, not a button: someone typing when it pops up must not answer it with Enter
    onOpen: (api) => requestAnimationFrame(() => { api.el.tabIndex = -1; api.el.focus({ preventScroll: true }); }),
  });
  const state = { source: w.source, sig: signature(w), dialog };
  open = state;
  fill(dialog, w);
  chime("attention");
  dialog.closed.then((why) => {
    if (open === state) open = null;
    if (why !== undefined) return;   // closed because the printer said so
    if (state.source === "macro") {
      // the person closed it: tell the printer, like Mainsail does, so every screen closes it
      reader.shown = null;
      gcode('RESPOND TYPE=command MSG="action:prompt_end"').catch(() => {});
    } else {
      hostPrompt = null;   // hidden here only; OctoPrint's own dialog behaves the same
    }
  });
}

export function initPrompts() {
  // a (re)connected socket replays the recent log: read it from a clean slate
  bus.on("socket:connected", () => reader.reset());
  bus.on("logs", (lines) => {
    let changed = false;
    for (const l of lines) if (reader.feed(l)) changed = true;
    if (changed) sync();
  });
  store.on("klipper", sync);

  bus.on("plugin:action_command_prompt", (d) => {
    if (d?.action === "show") hostPrompt = { text: d.text || "", choices: d.choices || [] };
    else if (d?.action === "close") hostPrompt = null;
    sync();
  });
  // a prompt that was already up when this page opened (the plugin only talks to signed-in users)
  bus.on("socket:connected", () => {
    if (!store.get("auth.loggedIn") || !can("plugin_action_command_prompt_interact")) return;
    octo.promptState().then((d) => {
      if (d?.text && Array.isArray(d.choices)) { hostPrompt = { text: d.text, choices: d.choices }; sync(); }
    }).catch(() => { /* plugin disabled, or no permission for it */ });
  });

  bus.on("plugin:action_command_notification", (d) => {
    if (d?.message) toast.info("Message from the printer", d.message, { timeout: 15000 });
  });
}
