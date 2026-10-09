// OctoPrint's custom controls: the buttons from config.yaml's `controls:` (and the ones some
// plugins add) that classic OctoPrint shows under its Control tab. Drawn natively here.
// https://docs.octoprint.org/en/master/features/custom_controls.html
import { html, raw, refs } from "mf/core/dom.js";
import { get, post } from "mf/core/api.js";
import { icon } from "mf/ui/icons.js";
import { store } from "mf/core/store.js";
import { can } from "mf/core/auth.js";
import { confirmDialog } from "mf/ui/dialog.js";
import { toast } from "mf/ui/toast.js";

// OctoPrint fills %(name)s from the control's inputs
const fill = (text, values) => String(text).replace(/%\((\w+)\)s/g, (m, k) => (k in values ? values[k] : m));

export function mountCustomControls(host) {
  const el = html`
    <section class="panel a-custom" aria-label="Custom controls" hidden>
      <div class="panel-head"><h2 class="panel-title">Custom controls</h2><span class="panel-sub">from OctoPrint and its plugins</span></div>
      <div class="cc-body" data-ref="body"></div>
    </section>`;
  const r = refs(el);
  host.append(el);

  let controls = [];
  const enabled = () => {
    const f = store.get("printer.flags");
    return can("control") && !!(f.operational || f.printing || f.paused);
  };

  async function run(c, scope) {
    const values = {};
    scope?.querySelectorAll("[data-param]").forEach((i) => { values[i.dataset.param] = i.value; });
    if (c.confirm && !(await confirmDialog({ title: `${c.name}?`, text: c.confirm, confirm: "Run" }))) return;
    try {
      if (c.script) await post("/api/printer/command", { script: c.script, parameters: values });
      else {
        const cmds = (c.commands || [c.command]).filter(Boolean).map((x) => fill(x, values));
        await post("/api/printer/command", { commands: cmds });
      }
      toast.info(c.name, "Sent to the printer.", { timeout: 1500 });
    } catch (e) { toast.fail(`${c.name} failed`, e); }
  }

  function node(c) {
    if (c.children) {
      const box = html`<div class="cc-group ${c.layout === "horizontal" ? "is-row" : ""}">${c.name ? html`<h3>${c.name}</h3>` : ""}<div class="cc-items"></div></div>`;
      const items = box.querySelector(".cc-items");
      for (const ch of c.children) { const n = node(ch); if (n) items.append(n); }
      return box;
    }
    if (c.javascript) return null;   // runs classic-page code: only the classic page can
    if (c.type === "output" || (!c.command && !c.commands && !c.script)) {
      return c.template ? html`<div class="cc-out muted">${c.name ? `${c.name}: ` : ""}${c.template.replace(/\{[^}]*\}/g, "…")}</div>` : null;
    }
    const wrap = html`<div class="cc-ctl"></div>`;
    for (const inp of c.input || []) {
      const s = inp.slider;
      const field = s
        ? html`<label class="cc-in"><span>${inp.name}</span><input type="range" data-param="${inp.parameter}" min="${s.min ?? 0}" max="${s.max ?? 255}" step="${s.step ?? 1}" value="${inp.default ?? s.min ?? 0}"><output>${inp.default ?? ""}</output></label>`
        : html`<label class="cc-in"><span>${inp.name}</span><input class="input" data-param="${inp.parameter}" value="${inp.default ?? ""}"></label>`;
      const range = field.querySelector('input[type="range"]');
      if (range) range.addEventListener("input", () => { field.querySelector("output").textContent = range.value; });
      wrap.append(field);
    }
    const b = html`<button class="btn btn-sm" data-tip="${(c.commands || [c.command || c.script || ""]).join(" · ")}">${raw(icon("bolt", "i i-sm"))}<span>${c.name || c.command || "Run"}</span></button>`;
    b.addEventListener("click", () => run(c, wrap));
    wrap.append(b);
    return wrap;
  }

  function render() {
    el.hidden = !controls.length;
    r.body.replaceChildren(...controls.map(node).filter(Boolean));
    sync();
  }
  function sync() {
    const on = enabled();
    r.body.querySelectorAll("button, input").forEach((x) => { x.disabled = !on; });
  }

  get("/api/printer/command/custom").then((d) => { controls = d?.controls || []; render(); }).catch(() => {});
  const offs = [store.on("printer", sync), store.on("auth", sync)];
  return { dispose() { offs.forEach((o) => o()); el.remove(); } };
}
