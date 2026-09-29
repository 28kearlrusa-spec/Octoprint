// Popup menus anchored to an element, with keyboard navigation.
import { html, raw } from "mf/core/dom.js";
import { icon } from "mf/ui/icons.js";

let openMenuState = null;

export function closeMenu() {
  if (!openMenuState) return;
  const { el, off } = openMenuState;
  openMenuState = null;
  off();
  el.remove();
}

/**
 * openMenu(anchor, items, {align:'start'|'end'})
 * items: [{label, icon, onClick, danger, kbd, disabled, checked}] | {sep:true} | {header:'Text'}
 */
export function openMenu(anchor, items, { align = "start", width } = {}) {
  closeMenu();
  const el = html`<div class="menu cut cut-s" role="menu"></div>`;
  if (width) el.style.minWidth = `${width}px`;
  const buttons = [];
  for (const it of items) {
    if (!it) continue;
    if (it.sep) { el.append(html`<div class="menu-sep" role="separator"></div>`); continue; }
    if (it.header) { el.append(html`<div class="menu-label">${it.header}</div>`); continue; }
    const b = html`
      <button class="menu-item ${it.danger ? "is-danger" : ""}" role="menuitem" ${it.disabled ? "disabled" : ""}>
        ${it.icon ? raw(icon(it.icon)) : it.checked !== undefined ? raw(icon(it.checked ? "check" : "minus", "i i-sm")) : raw('<svg class="i" viewBox="0 0 24 24"></svg>')}
        <span class="grow truncate">${it.label}</span>
        ${it.kbd ? html`<span class="kbd">${it.kbd}</span>` : ""}
      </button>`;
    if (it.checked === false && !it.icon) b.querySelector("svg").style.opacity = "0";
    b.addEventListener("click", () => { closeMenu(); it.onClick?.(); });
    el.append(b);
    if (!it.disabled) buttons.push(b);
  }
  document.getElementById("overlays").append(el);

  const r = anchor.getBoundingClientRect();
  const mw = el.offsetWidth, mh = el.offsetHeight;
  let left = align === "end" ? r.right - mw : r.left;
  let top = r.bottom + 6;
  if (top + mh > innerHeight - 8) top = Math.max(8, r.top - mh - 6);
  left = Math.min(Math.max(8, left), innerWidth - mw - 8);
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;

  const onDown = (e) => { if (!el.contains(e.target) && !anchor.contains(e.target)) closeMenu(); };
  const onKey = (e) => {
    if (e.key === "Escape") { e.preventDefault(); closeMenu(); anchor.focus?.(); return; }
    const i = buttons.indexOf(document.activeElement);
    if (e.key === "ArrowDown") { e.preventDefault(); buttons[(i + 1) % buttons.length]?.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); buttons[(i - 1 + buttons.length) % buttons.length]?.focus(); }
    else if (e.key === "Tab") closeMenu();
  };
  const onScroll = () => closeMenu();
  document.addEventListener("pointerdown", onDown, true);
  document.addEventListener("keydown", onKey, true);
  window.addEventListener("resize", onScroll);
  window.addEventListener("scroll", onScroll, true);
  openMenuState = {
    el,
    off: () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("scroll", onScroll, true);
    },
  };
  buttons[0]?.focus({ preventScroll: true });
  return { close: closeMenu };
}
