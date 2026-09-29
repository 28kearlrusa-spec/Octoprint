// Hash router with lazily loaded views.
//   #/print   #/control   #/files/some/folder   #/settings/themes   #/kiosk
// A view module's default export is {id, title, mount(el, ctx) -> {unmount?, onRoute?}}.

const table = new Map();
let stage = null;
let current = null;      // {def, instance, key}
let token = 0;
const listeners = new Set();
const scrollMemory = new Map();

export function define(defs) {
  for (const d of defs) table.set(d.id, d);
}

export function parse(hash = location.hash) {
  const raw = hash.replace(/^#\/?/, "");
  const [pathPart, queryPart = ""] = raw.split("?");
  const segs = pathPart.split("/").filter(Boolean).map(decodeURIComponent);
  const id = segs[0] || "";
  return { id, rest: segs.slice(1), path: "/" + segs.join("/"), query: Object.fromEntries(new URLSearchParams(queryPart)) };
}

export function href(id, rest = []) {
  return "#/" + [id, ...[].concat(rest)].filter((s) => s !== "" && s != null).map(encodeURIComponent).join("/");
}

export function go(id, rest, { replace = false } = {}) {
  const target = href(id, rest);
  if (replace) history.replaceState(null, "", target);
  else location.hash = target;
  if (replace) resolve();
}

export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function currentRoute() { return parse(); }

export function start(container, { fallback = "print" } = {}) {
  stage = container;
  window.addEventListener("hashchange", resolve);
  if (!location.hash || location.hash === "#") history.replaceState(null, "", href(fallback));
  return resolve();
}

async function resolve() {
  const route = parse();
  const def = table.get(route.id) || table.get("print");
  if (!def) return;
  const my = ++token;

  // same view, new params: let it handle that itself instead of remounting
  if (current && current.def === def && current.instance?.onRoute) {
    current.instance.onRoute(route);
    notify(route, def);
    return;
  }

  if (current) {
    scrollMemory.set(current.def.id, window.scrollY);
    try { current.instance?.unmount?.(); } catch (e) { console.error("[router] unmount failed", e); }
    current = null;
  }
  stage.replaceChildren();
  stage.dataset.view = def.id;

  let mod;
  try {
    mod = await def.load();
  } catch (e) {
    console.error("[router] failed to load view", def.id, e);
    stage.innerHTML = `<div class="empty"><div class="empty-title">This screen didn't load</div><p class="empty-text">${String(e.message || e).replace(/</g, "&lt;")}</p><button class="btn" onclick="location.reload()">Reload</button></div>`;
    return;
  }
  if (my !== token) return;   // user already navigated elsewhere

  const el = document.createElement("section");
  el.className = "view";
  el.dataset.view = def.id;
  stage.append(el);
  const view = mod.default || mod;
  try {
    const instance = view.mount(el, { route, def });
    current = { def, instance: instance || {} };
  } catch (e) {
    console.error("[router] mount failed", def.id, e);
    el.innerHTML = `<div class="empty"><div class="empty-title">Something went wrong</div><p class="empty-text">${String(e.message || e).replace(/</g, "&lt;")}</p></div>`;
  }
  requestAnimationFrame(() => window.scrollTo(0, scrollMemory.get(def.id) || 0));
  notify(route, def);
}

function notify(route, def) {
  document.title = `${def.title ? def.title + " · " : ""}MakerForge`;
  for (const fn of listeners) fn(route, def);
}
