// DOM helpers: tiny on purpose. Templates escape everything by default.

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ESC[c]);

class Raw {
  constructor(s) { this.s = s; }
  toString() { return this.s; }
}
/** Mark a string as trusted markup (icons, pre-escaped fragments). */
export const raw = (s) => new Raw(s);

function toHtml(v) {
  if (v == null || v === false || v === true) return "";
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(toHtml).join("");
  // nested html`` results: serialise (listeners added before nesting are not carried over)
  if (v.nodeType === 1) return v.outerHTML;
  if (v.nodeType === 11) return Array.from(v.childNodes, (n) => (n.nodeType === 1 ? n.outerHTML : esc(n.textContent))).join("");
  return esc(v);
}

/**
 * html`<div>${userText}</div>` -> the element (or a fragment when there are several roots).
 * Interpolations are escaped; wrap trusted markup in raw().
 */
export function html(strings, ...values) {
  let out = strings[0];
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    // Inside an attribute value a boolean is a value ("true"/"false", for aria-pressed and the
    // like); anywhere else `cond && html\`…\`` should render nothing when the condition is false.
    if ((v === true || v === false) && /\s[\w:.-]+=(["'])[^"']*$/.test(out)) out += String(v);
    else out += toHtml(v);
    out += strings[i + 1];
  }
  const tpl = document.createElement("template");
  tpl.innerHTML = out.trim();
  const c = tpl.content;
  return c.childElementCount === 1 && c.childNodes.length === 1 ? c.firstElementChild : c;
}

/** Collect [data-ref="name"] descendants into an object. */
export function refs(root) {
  const map = {};
  if (root.matches?.("[data-ref]")) map[root.dataset.ref] = root;
  root.querySelectorAll("[data-ref]").forEach((el) => { map[el.dataset.ref] = el; });
  return map;
}

/** Hyperscript for dynamic bits. h("div.cls#id", {onclick}, child, ...) */
export function h(spec, props, ...children) {
  const m = /^([a-z0-9-]*)((?:[.#][\w-]+)*)$/i.exec(spec);
  const el = document.createElement(m?.[1] || "div");
  if (m?.[2]) {
    for (const part of m[2].match(/[.#][\w-]+/g)) {
      if (part[0] === ".") el.classList.add(part.slice(1));
      else el.id = part.slice(1);
    }
  }
  if (props && (props.nodeType || typeof props === "string" || Array.isArray(props))) {
    children.unshift(props);
    props = null;
  }
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.classList.add(...String(v).split(/\s+/).filter(Boolean));
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "html") el.innerHTML = v;
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, v);
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

/** Event delegation. on(root, "click", "[data-act]", (ev, target) => ...). Returns an off(). */
export function on(root, type, selector, handler, opts) {
  if (typeof selector === "function") { opts = handler; handler = selector; selector = null; }
  const fn = (ev) => {
    if (!selector) return handler(ev, root);
    const t = ev.target instanceof Element ? ev.target.closest(selector) : null;
    if (t && root.contains(t)) handler(ev, t);
  };
  root.addEventListener(type, fn, opts);
  return () => root.removeEventListener(type, fn, opts);
}

/** Collects teardown callbacks so views can clean up in one call. */
export function scope() {
  const fns = [];
  return {
    add(fn) { if (fn) fns.push(fn); return fn; },
    on(target, type, handler, opts) {
      target.addEventListener(type, handler, opts);
      fns.push(() => target.removeEventListener(type, handler, opts));
    },
    interval(fn, ms) { const id = setInterval(fn, ms); fns.push(() => clearInterval(id)); return id; },
    timeout(fn, ms) { const id = setTimeout(fn, ms); fns.push(() => clearTimeout(id)); return id; },
    dispose() { while (fns.length) { try { fns.pop()(); } catch (e) { console.error(e); } } },
  };
}

export function debounce(fn, ms = 200) {
  let t;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.cancel = () => clearTimeout(t);
  d.flush = (...a) => { clearTimeout(t); fn(...a); };
  return d;
}

export function throttle(fn, ms = 100) {
  let last = 0, timer = null, lastArgs;
  return (...a) => {
    lastArgs = a;
    const now = performance.now();
    const wait = ms - (now - last);
    if (wait <= 0) { last = now; fn(...a); }
    else if (!timer) {
      timer = setTimeout(() => { timer = null; last = performance.now(); fn(...lastArgs); }, wait);
    }
  };
}

/** Coalesce many calls into one per animation frame. */
export function frame(fn) {
  let queued = false, args;
  return (...a) => {
    args = a;
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; fn(...args); });
  };
}

export const uid = (n = 8) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => (b % 36).toString(36)).join("");

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function copyText(text) {
  if (navigator.clipboard?.writeText && window.isSecureContext) return navigator.clipboard.writeText(text);
  // plain http on a LAN address is not a "secure context", so fall back to execCommand
  const ta = h("textarea", { style: { position: "fixed", opacity: 0, top: 0 } });
  ta.value = text;
  document.body.append(ta);
  ta.select();
  try { document.execCommand("copy"); } finally { ta.remove(); }
  return Promise.resolve();
}

export function download(filename, data, type = "text/plain") {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = h("a", { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
