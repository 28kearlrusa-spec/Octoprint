// Dialogs: confirm, prompt and a general-purpose modal. Focus is trapped and restored.
import { html, raw, refs } from "mf/core/dom.js";
import { icon } from "mf/ui/icons.js";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * openDialog({title, body, buttons, wide, dismissable}) -> {el, body, close(result), closed: Promise}
 * `body` may be a string (escaped), a Node, or a function(api) returning either.
 * `buttons`: [{label, value, kind:'primary'|'danger'|'ghost', autofocus, onClick(api)->false to keep open}]
 * `scrimClose: false` keeps a dismissable dialog open when the backdrop is clicked.
 */
export function openDialog({ title, body, buttons = [], wide = false, full = false, dismissable = true, scrimClose = true, className = "", onOpen } = {}) {
  const previouslyFocused = document.activeElement;
  const overlays = document.getElementById("overlays");
  const scrim = html`
    <div class="scrim" role="presentation">
      <div class="dialog cut cut-l ${wide ? "is-wide" : ""} ${full ? "is-full" : ""} ${className}" role="dialog" aria-modal="true" aria-label="${title || "Dialog"}">
        ${title ? html`<div class="panel-head"><h2 class="dialog-title grow">${title}</h2>${dismissable ? html`<button class="btn btn-ghost btn-icon btn-sm" data-ref="x" aria-label="Close">${raw(icon("x"))}</button>` : ""}</div>` : ""}
        <div class="dialog-body" data-ref="body"></div>
        ${buttons.length ? html`<div class="dialog-foot" data-ref="foot"></div>` : ""}
      </div>
    </div>`;
  const r = refs(scrim);
  const dialog = scrim.querySelector(".dialog");

  let resolveClosed;
  const closed = new Promise((res) => { resolveClosed = res; });
  let done = false;
  const api = {
    el: dialog,
    body: r.body,
    refs: r,
    close(result) {
      if (done) return;
      done = true;
      document.removeEventListener("keydown", onKey, true);
      scrim.remove();
      document.body.style.overflow = "";
      if (previouslyFocused?.isConnected) { try { previouslyFocused.focus({ preventScroll: true }); } catch { /* gone */ } }
      resolveClosed(result);
    },
    closed,
  };

  const content = typeof body === "function" ? body(api) : body;
  if (content instanceof Node) r.body.append(content);
  else if (content != null) r.body.innerHTML = `<p class="dialog-text" style="margin:0">${String(content).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]))}</p>`;

  const btnEls = [];
  for (const b of buttons) {
    const cls = { primary: "btn-primary", danger: "btn-danger", ghost: "btn-ghost", warn: "btn-warn" }[b.kind] || "";
    const el = html`<button class="btn ${cls}">${b.icon ? raw(icon(b.icon)) : ""}${b.label}</button>`;
    el.addEventListener("click", async () => {
      if (b.onClick) {
        el.classList.add("is-busy");
        try {
          const keep = await b.onClick(api);
          if (keep === false) return;
        } finally { el.classList.remove("is-busy"); }
      }
      api.close(b.value);
    });
    r.foot?.append(el);
    btnEls.push([b, el]);
  }

  r.x?.addEventListener("click", () => api.close(undefined));
  if (dismissable && scrimClose) scrim.addEventListener("mousedown", (e) => { if (e.target === scrim) api.close(undefined); });

  function onKey(e) {
    if (e.key === "Escape" && dismissable) { e.stopPropagation(); api.close(undefined); return; }
    if (e.key === "Tab") {
      const items = Array.from(dialog.querySelectorAll(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (!items.length) return;
      const first = items[0], last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  }
  document.addEventListener("keydown", onKey, true);

  overlays.append(scrim);
  document.body.style.overflow = "hidden";
  const auto = btnEls.find(([b]) => b.autofocus)?.[1] || dialog.querySelector("[autofocus]") || dialog.querySelector(FOCUSABLE);
  requestAnimationFrame(() => auto?.focus({ preventScroll: true }));
  onOpen?.(api);
  return api;
}

export async function confirmDialog({ title = "Are you sure?", text = "", confirm = "Confirm", cancel = "Cancel", danger = false, body } = {}) {
  const res = await openDialog({
    title,
    body: body || text,
    buttons: [
      { label: cancel, value: false, kind: "ghost" },
      { label: confirm, value: true, kind: danger ? "danger" : "primary", autofocus: !danger },
    ],
  }).closed;
  return res === true;
}

export async function promptDialog({ title = "Enter a value", label = "", value = "", placeholder = "", confirm = "Save", validate, hint, mono = false, multiline = false } = {}) {
  const field = html`
    <div class="field">
      ${label ? html`<label>${label}</label>` : ""}
      ${multiline
        ? html`<textarea class="textarea ${mono ? "is-mono" : ""}" data-ref="input" rows="6" placeholder="${placeholder}" autofocus></textarea>`
        : html`<input class="input ${mono ? "is-mono" : ""}" data-ref="input" type="text" placeholder="${placeholder}" autocomplete="off" autocapitalize="off" spellcheck="false" autofocus>`}
      <div class="hint err" data-ref="err" hidden></div>
      ${hint ? html`<div class="hint">${hint}</div>` : ""}
    </div>`;
  const r = refs(field);
  r.input.value = value;
  let dlg;
  const submit = async () => {
    const v = r.input.value;
    const problem = validate ? await validate(v) : null;
    if (problem) { r.err.textContent = problem; r.err.hidden = false; r.input.setAttribute("aria-invalid", "true"); return false; }
    dlg.close(v);
  };
  r.input.addEventListener("keydown", (e) => { if (e.key === "Enter" && (!multiline || e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); } });
  dlg = openDialog({
    title, body: field,
    buttons: [{ label: "Cancel", kind: "ghost", value: null }, { label: confirm, kind: "primary", onClick: async () => { await submit(); return false; } }],
  });
  return dlg.closed;
}

/** Hold a button to confirm: a guard for actions that must never fire by accident. */
export function holdToConfirm(btn, onConfirm, ms = 800) {
  let timer = null;
  const start = (e) => {
    if (btn.disabled || timer) return;
    if (e.type === "keydown" && !(e.key === " " || e.key === "Enter")) return;
    if (e.type === "keydown" && e.repeat) return;
    btn.style.setProperty("--hold-ms", `${ms}ms`);
    btn.classList.add("is-holding");
    timer = setTimeout(() => {
      timer = null;
      btn.classList.remove("is-holding");
      navigator.vibrate?.(35);
      onConfirm();
    }, ms);
  };
  const cancel = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    btn.classList.remove("is-holding");
  };
  btn.classList.add("btn-hold");
  btn.addEventListener("pointerdown", start);
  btn.addEventListener("keydown", start);
  for (const t of ["pointerup", "pointerleave", "pointercancel", "blur"]) btn.addEventListener(t, cancel);
  btn.addEventListener("keyup", cancel);
  btn.addEventListener("contextmenu", (e) => e.preventDefault());
  return cancel;
}
