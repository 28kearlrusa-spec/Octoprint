// Tooltips from a data-tip attribute. Hover waits a beat; keyboard focus shows immediately.
let tip = null;
let timer = null;
let current = null;

function ensure() {
  if (tip) return tip;
  tip = document.createElement("div");
  tip.className = "tip";
  tip.setAttribute("role", "tooltip");
  document.getElementById("overlays").append(tip);
  return tip;
}

function show(target) {
  const text = target.getAttribute("data-tip");
  if (!text) return;
  current = target;
  const t = ensure();
  t.textContent = text;
  t.classList.remove("is-shown");
  t.style.left = "0px"; t.style.top = "0px";
  const r = target.getBoundingClientRect();
  const w = t.offsetWidth, h = t.offsetHeight;
  let left = r.left + r.width / 2 - w / 2;
  let top = r.top - h - 8;
  if (top < 6) top = r.bottom + 8;
  left = Math.max(6, Math.min(left, innerWidth - w - 6));
  t.style.left = `${left}px`;
  t.style.top = `${top}px`;
  requestAnimationFrame(() => t.classList.add("is-shown"));
}

function hide() {
  clearTimeout(timer);
  current = null;
  tip?.classList.remove("is-shown");
}

export function initTooltips() {
  document.addEventListener("pointerover", (e) => {
    if (e.pointerType === "touch") return;
    const t = e.target instanceof Element ? e.target.closest("[data-tip]") : null;
    if (!t || t === current) return;
    clearTimeout(timer);
    timer = setTimeout(() => show(t), 650);
  });
  document.addEventListener("pointerout", (e) => {
    const t = e.target instanceof Element ? e.target.closest("[data-tip]") : null;
    if (t && !t.contains(e.relatedTarget)) hide();
  });
  document.addEventListener("focusin", (e) => {
    const t = e.target instanceof Element ? e.target.closest("[data-tip]") : null;
    if (t && t.matches(":focus-visible")) show(t);
  });
  document.addEventListener("focusout", hide);
  document.addEventListener("pointerdown", hide, true);
  document.addEventListener("scroll", hide, true);
}
