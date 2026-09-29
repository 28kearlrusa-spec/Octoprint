// Toasts: short, dismissable, de-duplicated. Errors stay until read.
import { html, esc, raw } from "mf/core/dom.js";
import { icon } from "mf/ui/icons.js";

const ICONS = { ok: "check", info: "info", warn: "alert", err: "octagon" };
const LIFETIME = { ok: 3200, info: 4500, warn: 7000, err: 10000 };
let host = null;
const live = new Map(); // key -> {el, count, timer}

function ensureHost() {
  if (host && host.isConnected) return host;
  host = document.getElementById("toasts");
  if (!host) {
    host = document.createElement("div");
    host.id = "toasts";
    host.setAttribute("role", "region");
    host.setAttribute("aria-label", "Notifications");
    host.setAttribute("aria-live", "polite");
    document.getElementById("overlays").append(host);
  }
  return host;
}

export function toast({ kind = "info", title = "", text = "", timeout, action } = {}) {
  ensureHost();
  const key = `${kind}|${title}|${text}`;
  const existing = live.get(key);
  if (existing) {
    existing.count++;
    existing.badge.textContent = `×${existing.count}`;
    existing.badge.hidden = false;
    arm(key, timeout ?? LIFETIME[kind]);
    return existing.api;
  }

  const el = html`
    <div class="toast cut ${"is-" + kind}" role="${kind === "err" ? "alert" : "status"}">
      ${raw(icon(ICONS[kind] || "info"))}
      <div class="grow">
        ${title ? html`<div class="toast-title">${title}</div>` : ""}
        ${text ? html`<div class="toast-text">${text}</div>` : ""}
      </div>
      <span class="chip" data-ref="badge" hidden>×1</span>
      ${action ? html`<button class="btn btn-sm" data-ref="act">${action.label}</button>` : ""}
      <button class="btn btn-ghost btn-icon btn-sm" aria-label="Dismiss" data-ref="close">${raw(icon("x", "i i-sm"))}</button>
    </div>`;
  const badge = el.querySelector("[data-ref=badge]");
  const api = { dismiss: () => dismiss(key), key };
  live.set(key, { el, count: 1, badge, timer: null, api });
  el.querySelector("[data-ref=close]").addEventListener("click", () => dismiss(key));
  el.querySelector("[data-ref=act]")?.addEventListener("click", () => { try { action.onClick(); } finally { dismiss(key); } });
  el.addEventListener("pointerenter", () => clearTimeout(live.get(key)?.timer));
  el.addEventListener("pointerleave", () => arm(key, 2500));

  host.append(el);
  while (host.children.length > 5) host.firstElementChild.remove();
  arm(key, timeout ?? LIFETIME[kind]);
  return api;
}

function arm(key, ms) {
  const t = live.get(key);
  if (!t) return;
  clearTimeout(t.timer);
  if (ms === 0) return;   // sticky
  t.timer = setTimeout(() => dismiss(key), ms);
}

function dismiss(key) {
  const t = live.get(key);
  if (!t) return;
  clearTimeout(t.timer);
  live.delete(key);
  t.el.classList.add("is-leaving");
  setTimeout(() => t.el.remove(), 240);
}

toast.ok = (title, text, o) => toast({ kind: "ok", title, text, ...o });
toast.info = (title, text, o) => toast({ kind: "info", title, text, ...o });
toast.warn = (title, text, o) => toast({ kind: "warn", title, text, ...o });
toast.err = (title, text, o) => toast({ kind: "err", title, text, ...o });
/** Turn any thrown error into a readable toast. */
toast.fail = (title, e) => toast({ kind: "err", title, text: e?.message || String(e || "") });
