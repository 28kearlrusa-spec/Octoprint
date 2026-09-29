// Macros: named buttons that send G-code or Klipper commands. Shared by Control, Tune and
// the command palette. The list lives in the shared config so every device sees the same one.
import { html, raw, refs, uid } from "mf/core/dom.js";
import { store } from "mf/core/store.js";
import { config } from "mf/core/config.js";
import { icon, iconNames } from "mf/ui/icons.js";
import * as actions from "mf/core/actions.js";
import { hasCommand } from "mf/core/klipper-watch.js";
import { openDialog, confirmDialog, promptDialog } from "mf/ui/dialog.js";
import { toast } from "mf/ui/toast.js";
import { can } from "mf/core/auth.js";
import { KLIPPER_HOT_MIN, DEFAULT_CONFIG } from "mf/core/defaults.js";
import { copyText } from "mf/core/dom.js";
import { refreshSoon } from "mf/core/position.js";

export const isPrintingNow = () => {
  const f = store.get("printer.flags");
  return !!(f.printing || f.paused || f.pausing || f.cancelling);
};

/** Can this macro run right now? Returns {ok, reason}. */
export function availability(m) {
  const f = store.get("printer.flags");
  if (!can("control")) return { ok: false, reason: "Your account can't control the printer." };
  if (!(f.operational || f.printing || f.paused)) return { ok: false, reason: "Connect the printer first." };
  if (isPrintingNow() && !m.duringPrint) return { ok: false, reason: "Not while a print is running." };
  if (m.needs) {
    const known = hasCommand(m.needs);
    if (known === false) return { ok: false, reason: `${m.needs} isn't defined in your Klipper config.` };
  }
  if (m.requires === "hot") {
    const t = store.get("temps.tool0")?.actual;
    if (t != null && t < KLIPPER_HOT_MIN) return { ok: false, reason: `Heat the nozzle to ${KLIPPER_HOT_MIN}° first (it's ${Math.round(t)}°).` };
  }
  return { ok: true, reason: "" };
}

function askParams(macro, params) {
  return new Promise((resolve) => {
    const body = html`<form class="col gap-3">${params.map((p) => html`
      <div class="field"><label for="mp-${p.name}">${p.name}</label><input class="input" id="mp-${p.name}" data-name="${p.name}" value="${p.default}" autocomplete="off" ${p === params[0] ? "autofocus" : ""}></div>`)}</form>`;
    const dlg = openDialog({
      title: macro.name,
      body,
      buttons: [
        { label: "Cancel", kind: "ghost", value: null },
        { label: "Run", kind: "primary", icon: "play", onClick: () => {
          const out = {};
          body.querySelectorAll("input").forEach((i) => { out[i.dataset.name] = i.value.trim(); });
          dlg.close(out);
          return false;
        } },
      ],
    });
    body.addEventListener("submit", (e) => { e.preventDefault(); dlg.el.querySelector(".btn-primary").click(); });
    dlg.closed.then(resolve);
  });
}

/** Run a macro with confirmation and parameter prompts. Resolves true if it was sent. */
export async function runMacro(m) {
  const a = availability(m);
  if (!a.ok) { toast.warn(m.name, a.reason); return false; }
  if (m.confirm) {
    const ok = await confirmDialog({ title: `${m.name}?`, text: typeof m.confirm === "string" ? m.confirm : "Run this now?", confirm: "Run", danger: /restart|reset|erase/i.test(m.gcode) });
    if (!ok) return false;
  }
  const params = actions.macroParams(m.gcode);
  let extra = {};
  if (params.length) {
    extra = await askParams(m, params);
    if (!extra) return false;
  }
  try {
    await actions.gcode(actions.expandMacro(m.gcode, extra));
    toast.info(m.name, "Sent to the printer.", { timeout: 1800 });
    if (/^G28|^G0|^G1|HOME|LEVEL|PARK/i.test(m.gcode)) refreshSoon(2500);
    return true;
  } catch {
    return false;
  }
}

export const macroIcon = (m) => icon(iconNames().includes(m.icon) ? m.icon : "bolt");

/** Macros grouped by category, in the order first seen. */
export function grouped(list = config.data.macros) {
  const map = new Map();
  for (const m of list) {
    const c = m.cat || "Other";
    if (!map.has(c)) map.set(c, []);
    map.get(c).push(m);
  }
  return map;
}

// ~~ editor ~~
export function openMacroEditor() {
  let draft = JSON.parse(JSON.stringify(config.data.macros));
  const wrap = html`<div class="col gap-3"></div>`;

  const iconChoices = ["bolt", "home", "qgl", "mesh", "nozzle", "spool", "eject", "power", "refresh", "save", "info", "target", "compass", "fan", "led", "light", "flame", "snow", "probe", "waves", "layers", "toolhead", "zoffset", "filament", "wrench", "flask"];

  function edit(m, isNew) {
    const f = html`
      <div class="col gap-3">
        <div class="row gap-3 wrap">
          <div class="field grow" style="min-width:180px"><label>Name</label><input class="input" data-k="name" value="${m.name || ""}" autofocus></div>
          <div class="field grow" style="min-width:140px"><label>Group</label><input class="input" data-k="cat" value="${m.cat || ""}" placeholder="Voron" list="mf-cats"></div>
          <div class="field" style="min-width:120px"><label>Icon</label><select class="select" data-k="icon">${iconChoices.map((i) => html`<option ${i === (m.icon || "bolt") ? "selected" : ""}>${i}</option>`)}</select></div>
        </div>
        <div class="field"><label>G-code</label><textarea class="textarea is-mono" data-k="gcode" rows="5" placeholder="QUAD_GANTRY_LEVEL">${m.gcode || ""}</textarea>
          <div class="hint">One command per line. <code>{name|default}</code> asks for a value when you run it. <code>{safeZ}</code>, <code>{parkX}</code> and <code>{parkY}</code> come from Settings.</div></div>
        <div class="row gap-3 wrap">
          <div class="field grow" style="min-width:200px"><label>Needs Klipper command <span class="muted">(optional)</span></label><input class="input is-mono" data-k="needs" value="${m.needs || ""}" placeholder="QUAD_GANTRY_LEVEL"></div>
          <div class="field grow" style="min-width:200px"><label>Ask before running <span class="muted">(optional)</span></label><input class="input" data-k="confirm" value="${typeof m.confirm === "string" ? m.confirm : ""}" placeholder="Restarts Klipper."></div>
        </div>
        <div class="row gap-4 wrap">
          <label class="check"><input type="checkbox" data-k="hot" ${m.requires === "hot" ? "checked" : ""}> Only when the nozzle is hot</label>
          <label class="check"><input type="checkbox" data-k="duringPrint" ${m.duringPrint ? "checked" : ""}> Allow during a print</label>
        </div>
      </div>`;
    const dlg = openDialog({
      title: isNew ? "New macro" : `Edit ${m.name}`,
      body: f, wide: true,
      buttons: [
        { label: "Cancel", kind: "ghost" },
        { label: "Save macro", kind: "primary", onClick: () => {
          const v = (k) => f.querySelector(`[data-k="${k}"]`);
          const name = v("name").value.trim();
          const gcode = v("gcode").value.trim();
          if (!name || !gcode) { toast.warn("Give the macro a name and some G-code."); return false; }
          Object.assign(m, {
            name, gcode, cat: v("cat").value.trim() || "Other", icon: v("icon").value,
            needs: v("needs").value.trim() || undefined, confirm: v("confirm").value.trim() || undefined,
            requires: v("hot").checked ? "hot" : undefined, duringPrint: v("duringPrint").checked || undefined,
          });
          if (isNew) { m.id = m.id || uid(6); draft.push(m); }
          dlg.close(true);
          return false;
        } },
      ],
    });
    return dlg.closed;
  }

  function render() {
    wrap.replaceChildren(
      html`<div class="row between wrap"><span class="muted">${draft.length} macros</span>
        <div class="row"><button class="btn btn-sm" data-a="add">${raw(icon("plus"))}New macro</button>
        <button class="btn btn-sm btn-ghost" data-a="export">${raw(icon("copy"))}Copy as JSON</button>
        <button class="btn btn-sm btn-ghost" data-a="import">${raw(icon("download"))}Paste JSON</button>
        <button class="btn btn-sm btn-ghost" data-a="reset">Reset</button></div></div>`,
      html`<table class="table"><thead><tr><th>Name</th><th>Group</th><th>G-code</th><th></th></tr></thead><tbody>
        ${draft.map((m, i) => html`<tr>
          <td><span class="row" style="gap:8px">${raw(macroIcon(m))}${m.name}</span></td><td class="muted">${m.cat || ""}</td>
          <td class="mono muted truncate" style="max-width:240px">${m.gcode.split("\n")[0]}${m.gcode.includes("\n") ? " …" : ""}</td>
          <td class="r nowrap"><button class="btn btn-icon btn-sm btn-ghost" data-a="up" data-i="${i}" aria-label="Move up">${raw(icon("arrow-up", "i i-sm"))}</button>
            <button class="btn btn-icon btn-sm btn-ghost" data-a="edit" data-i="${i}" aria-label="Edit ${m.name}">${raw(icon("edit", "i i-sm"))}</button>
            <button class="btn btn-icon btn-sm btn-ghost" data-a="del" data-i="${i}" aria-label="Delete ${m.name}">${raw(icon("trash", "i i-sm"))}</button></td></tr>`)}
      </tbody></table>`
    );
  }
  wrap.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-a]");
    if (!b) return;
    const i = Number(b.dataset.i);
    switch (b.dataset.a) {
      case "add": await edit({}, true); break;
      case "edit": await edit(draft[i], false); break;
      case "del": draft.splice(i, 1); break;
      case "up": if (i > 0) [draft[i - 1], draft[i]] = [draft[i], draft[i - 1]]; break;
      case "export": await copyText(JSON.stringify(draft, null, 2)); toast.ok("Copied", "Macros are on your clipboard as JSON."); break;
      case "import": {
        const text = await promptDialog({
          title: "Paste macros", label: "Macro JSON (an array)", multiline: true, mono: true, confirm: "Import",
          validate: (v) => { try { return Array.isArray(JSON.parse(v)) ? null : "That should be a JSON array of macros."; } catch { return "That isn't valid JSON."; } },
        });
        if (text) draft = JSON.parse(text);
        break;
      }
      case "reset": if (await confirmDialog({ title: "Reset macros?", text: "This replaces your list with the built-in Voron and Klipper set.", confirm: "Reset", danger: true })) draft = JSON.parse(JSON.stringify(DEFAULT_CONFIG.macros)); break;
      default: break;
    }
    render();
  });
  render();

  const dlg = openDialog({
    title: "Edit macros", body: wrap, full: true,
    buttons: [
      { label: "Cancel", kind: "ghost" },
      { label: "Save", kind: "primary", onClick: async () => {
        try { await config.update((c) => { c.macros = draft; }); toast.ok("Macros saved"); }
        catch (err) { toast.fail("Couldn't save macros", err); return false; }
      } },
    ],
  });
  return dlg.closed;
}
