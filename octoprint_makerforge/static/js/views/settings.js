// Settings: how the UI looks and what your printer's buttons do.
import { html, raw, refs, debounce, esc, uid, download, copyText } from "mf/core/dom.js";
import { store } from "mf/core/store.js";
import { icon } from "mf/ui/icons.js";
import { boot, octo, mf } from "mf/core/api.js";
import { prefs, THEMES } from "mf/core/prefs.js";
import { config } from "mf/core/config.js";
import { DEFAULT_CONFIG } from "mf/core/defaults.js";
import { can } from "mf/core/auth.js";
import * as router from "mf/core/router.js";
import { toast } from "mf/ui/toast.js";
import { confirmDialog, promptDialog, openDialog } from "mf/ui/dialog.js";
import { openMacroEditor } from "mf/ui/macros.js";
import { chime } from "mf/core/events.js";
import { webcamInfo, bust } from "mf/core/webcam.js";

const SECTIONS = [
  ["appearance", "Appearance", "palette"],
  ["printer", "Printer", "cube"],
  ["presets", "Presets", "flame"],
  ["macros", "Macros", "bolt"],
  ["fans", "Fans and lights", "fan"],
  ["camera", "Camera", "camera"],
  ["print", "Before printing", "list-checks"],
  ["upkeep", "Maintenance", "wrench"],
  ["notify", "Notifications", "bell"],
  ["interface", "Interface", "settings"],
  ["data", "Data", "save"],
  ["about", "About", "info"],
];

const clone = (v) => JSON.parse(JSON.stringify(v));
const num = (v, d = 0) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };

export default {
  id: "settings",
  mount(el, { route }) {
    const view = html`
      <div>
        <div class="view-head"><h1>Settings</h1><span class="saved" data-ref="saved">${raw(icon("check", "i i-sm"))}Saved</span></div>
        <div class="set-layout">
          <nav class="set-nav" data-ref="nav" aria-label="Settings sections"></nav>
          <div class="set-pane" data-ref="pane"></div>
        </div>
      </div>`;
    const r = refs(view);
    r.nav.innerHTML = SECTIONS.map(([id, label, ic]) => `<a href="#/settings/${id}" data-id="${id}">${icon(ic)}${label}</a>`).join("");
    el.append(view);

    let flash;
    const saved = () => { r.saved.classList.add("is-on"); clearTimeout(flash); flash = setTimeout(() => r.saved.classList.remove("is-on"), 1600); };
    /** Edit the shared config and save. */
    const commit = debounce(async (mutator) => {
      try { await config.update(mutator); saved(); } catch (e) { toast.fail("Couldn't save that", e); }
    }, 350);
    const ctx = { commit, saved, view: r };

    let cleanup = null;
    function show(id) {
      if (!SECTIONS.some(([s]) => s === id)) id = "appearance";
      r.nav.querySelectorAll("a").forEach((a) => (a.dataset.id === id ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
      cleanup?.();
      r.pane.replaceChildren();
      cleanup = BUILDERS[id](r.pane, ctx) || null;
    }
    show(route.rest[0] || "appearance");
    return { onRoute: (rt) => show(rt.rest[0] || "appearance"), unmount() { cleanup?.(); } };
  },
};

const card = (title, sub, body) => html`
  <section class="panel"><div class="panel-head"><h2 class="panel-title">${title}</h2>${sub ? html`<span class="panel-sub">${sub}</span>` : ""}</div><div class="panel-body"></div></section>`;

function section(host, title, sub, ...children) {
  const c = card(title, sub);
  c.querySelector(".panel-body").append(...children);
  host.append(c);
  return c;
}

function labelled(label, inputEl, hint) {
  const f = document.createElement("div");
  f.className = "field";
  const l = document.createElement("label");
  l.textContent = label;
  f.append(l, inputEl);
  if (hint) { const h = document.createElement("div"); h.className = "hint"; h.textContent = hint; f.append(h); }
  return f;
}
function input(type, value, attrs = {}) {
  const i = document.createElement("input");
  i.className = "input";
  i.type = type;
  i.value = value ?? "";
  for (const [k, v] of Object.entries(attrs)) i.setAttribute(k, v);
  return i;
}
function seg(options, current, onPick) {
  const s = html`<div class="seg" role="group">${options.map(([v, l]) => html`<button type="button" data-v="${v}" aria-pressed="${String(v) === String(current)}">${l}</button>`)}</div>`;
  s.addEventListener("click", (e) => {
    const b = e.target.closest("button"); if (!b) return;
    s.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    onPick(b.dataset.v);
  });
  return s;
}

const BUILDERS = {
  appearance(host, { }) {
    const grid = html`<div class="theme-grid"></div>`;
    const paint = () => grid.replaceChildren(...THEMES.map((t) => {
      const b = html`<button class="theme-card" aria-pressed="${prefs.get("theme") === t.id}"><div class="sw">${t.swatch.map((c) => html`<i style="background:${c}"></i>`)}<i style="background:#0b0b0d"></i></div><b>${t.name}</b><small>${t.note}</small></button>`;
      b.addEventListener("click", () => { prefs.set("theme", t.id); paint(); });
      return b;
    }));
    paint();
    const sound = html`<label class="check"><input type="checkbox" ${prefs.get("sound") ? "checked" : ""}> Play a chime when a print finishes or fails</label>`;
    sound.querySelector("input").addEventListener("change", (e) => { prefs.set("sound", e.target.checked); if (e.target.checked) chime("done"); });
    const tab = html`<label class="check"><input type="checkbox" ${prefs.get("tabTitle") ? "checked" : ""}> Show progress in the browser tab title</label>`;
    tab.querySelector("input").addEventListener("change", (e) => prefs.set("tabTitle", e.target.checked));
    section(host, "Look and feel", "saved in this browser",
      grid,
      html`<div class="form-grid"><div class="field"><label>Density</label></div><div class="field"><label>Motion</label></div></div>`,
      sound, tab);
    const fg = host.querySelector(".form-grid");
    fg.children[0].append(seg([["comfortable", "Comfortable"], ["compact", "Compact"]], prefs.get("density"), (v) => prefs.set("density", v)));
    fg.children[1].append(seg([["auto", "Follow my system"], ["reduced", "Reduce motion"]], prefs.get("motion"), (v) => prefs.set("motion", v)));
    const kiosk = html`<div class="row wrap"><span class="grow muted">A stripped-back full-screen view for a tablet or screen mounted at the printer.</span><button class="btn">${raw(icon("maximize"))}Open kiosk mode</button></div>`;
    kiosk.querySelector("button").addEventListener("click", () => router.go("kiosk"));
    section(host, "Kiosk display", "", kiosk);
  },

  printer(host, { commit }) {
    const c = config.data;
    const name = input("text", c.printerName, { placeholder: "Voron 2.4" });
    name.addEventListener("input", () => commit((d) => { d.printerName = name.value.trim(); }));
    const kin = seg([["bed-z", "Bed moves in Z"], ["gantry-z", "Gantry moves in Z"]], c.kinematics, (v) => commit((d) => { d.kinematics = v; }));
    const sz = input("number", c.safeZ, { min: 0, step: 1 });
    sz.addEventListener("input", () => commit((d) => { d.safeZ = num(sz.value, 30); }));
    const px = input("number", c.parkXY?.[0] ?? 10), py = input("number", c.parkXY?.[1] ?? 10);
    const park = () => commit((d) => { d.parkXY = [num(px.value, 10), num(py.value, 10)]; });
    px.addEventListener("input", park); py.addEventListener("input", park);
    const dia = input("number", c.filament.diameter, { step: 0.01 }), den = input("number", c.filament.density, { step: 0.01 }), cost = input("number", c.filament.costPerKg, { step: 0.5 });
    const fil = () => commit((d) => { d.filament = { diameter: num(dia.value, 1.75), density: num(den.value, 1.24), costPerKg: num(cost.value, 20) }; });
    [dia, den, cost].forEach((i) => i.addEventListener("input", fil));
    section(host, "Printer", "shared with everyone who uses this printer",
      labelled("Name", name, "Shown in the top bar. OctoPrint's own name is used if this is empty."),
      labelled("Z axis", kin, "On a Voron 2.4, Trident or 0.x the bed moves and the gantry stays put. The schematic follows this."),
      html`<div class="form-grid"></div>`);
    host.lastElementChild.querySelector(".form-grid").append(
      labelled("Safe Z for the Park macro (mm)", sz), labelled("Park X (mm)", px), labelled("Park Y (mm)", py));
    section(host, "Filament", "used to turn metres into grams",
      html`<div class="form-grid"></div>`);
    host.lastElementChild.querySelector(".form-grid").append(
      labelled("Diameter (mm)", dia), labelled("Density (g/cm³)", den, "PLA 1.24, PETG 1.27, ABS 1.04, ASA 1.07"), labelled("Cost per kg", cost));
  },

  presets(host, { commit }) {
    const tb = document.createElement("tbody");
    const draw = () => {
      tb.replaceChildren(...config.data.presets.map((p, i) => {
        const tr = html`<tr><td><input class="input" value="${p.name}" aria-label="Name"></td>
          <td class="num-col"><input class="input" type="number" value="${p.nozzle}" aria-label="Nozzle"></td>
          <td class="num-col"><input class="input" type="number" value="${p.bed}" aria-label="Bed"></td>
          <td class="num-col"><input class="input" type="number" value="${p.chamber || 0}" aria-label="Chamber"></td>
          <td><button class="btn btn-ghost btn-icon btn-sm" aria-label="Remove ${p.name}">${raw(icon("trash", "i i-sm"))}</button></td></tr>`;
        const ins = tr.querySelectorAll("input");
        const upd = () => commit((d) => { d.presets[i] = { ...d.presets[i], name: ins[0].value.trim() || "Preset", nozzle: num(ins[1].value), bed: num(ins[2].value), chamber: num(ins[3].value) }; });
        ins.forEach((x) => x.addEventListener("input", upd));
        tr.querySelector("button").addEventListener("click", async () => { await config.update((d) => { d.presets.splice(i, 1); }); draw(); });
        return tr;
      }));
    };
    const table = html`<table class="edit-table"><thead><tr><th>Name</th><th>Nozzle °C</th><th>Bed °C</th><th>Chamber °C</th><th></th></tr></thead></table>`;
    table.append(tb);
    draw();
    const add = html`<div class="row"><button class="btn">${raw(icon("plus"))}Add preset</button><button class="btn btn-ghost">Reset to defaults</button></div>`;
    add.children[0].addEventListener("click", async () => { await config.update((d) => { d.presets.push({ id: uid(5), name: "New", nozzle: 210, bed: 60, chamber: 0 }); }); draw(); });
    add.children[1].addEventListener("click", async () => { if (await confirmDialog({ title: "Reset presets?", confirm: "Reset", danger: true })) { await config.update((d) => { d.presets = clone(DEFAULT_CONFIG.presets); }); draw(); } });
    section(host, "Temperature presets", "the Preheat chips on Print and Control", table, add);
  },

  macros(host) {
    const list = config.data.macros;
    const groups = new Set(list.map((m) => m.cat || "Other"));
    const btn = html`<div class="row wrap"><span class="grow muted">${list.length} macros in ${groups.size} groups. Macros are plain G-code or Klipper commands and appear on the Control screen and in the command palette.</span><button class="btn btn-primary">${raw(icon("edit"))}Edit macros</button></div>`;
    btn.querySelector("button").addEventListener("click", () => openMacroEditor());
    section(host, "Macros", "shared with everyone", btn);
  },

  fans(host, { commit }) {
    const wrap = html`<div class="col gap-5"></div>`;
    const draw = () => {
      const c = config.data;
      const fanRows = c.fans.filter((f) => f.type === "generic").map((f) => {
        const idx = c.fans.indexOf(f);
        const row = html`<div class="hook"><div class="row wrap"><label class="check grow"><input type="checkbox" ${f.enabled ? "checked" : ""}> ${f.name}</label></div>
          <div class="form-grid"><div class="field"><label>Name</label><input class="input" value="${f.name}"></div><div class="field"><label>Klipper name</label><input class="input is-mono" value="${f.klipper}" placeholder="nevermore"></div></div></div>`;
        const [en, nm, kl] = [row.querySelector("input[type=checkbox]"), ...row.querySelectorAll(".input")];
        const upd = () => commit((d) => { d.fans[idx] = { ...d.fans[idx], enabled: en.checked, name: nm.value.trim() || "Fan", klipper: kl.value.trim() }; });
        [en, nm, kl].forEach((x) => x.addEventListener("input", upd));
        return row;
      });
      const ledRows = c.leds.map((l, idx) => {
        const row = html`<div class="hook"><div class="row wrap"><label class="check grow"><input type="checkbox" ${l.enabled ? "checked" : ""}> ${l.name} LEDs</label></div>
          <div class="form-grid"><div class="field"><label>Name</label><input class="input" value="${l.name}"></div><div class="field"><label>Klipper LED name</label><input class="input is-mono" value="${l.klipper}" placeholder="sb_leds"></div></div></div>`;
        const [en, nm, kl] = [row.querySelector("input[type=checkbox]"), ...row.querySelectorAll(".input")];
        const upd = () => commit((d) => { d.leds[idx] = { ...d.leds[idx], enabled: en.checked, name: nm.value.trim() || "LEDs", klipper: kl.value.trim() }; });
        [en, nm, kl].forEach((x) => x.addEventListener("input", upd));
        return row;
      });
      const add = html`<div class="row"><button class="btn" data-a="fan">${raw(icon("plus"))}Add a fan</button><button class="btn" data-a="led">${raw(icon("plus"))}Add LEDs</button></div>`;
      add.addEventListener("click", async (e) => {
        const a = e.target.closest("[data-a]")?.dataset.a; if (!a) return;
        await config.update((d) => { a === "fan" ? d.fans.push({ id: uid(5), name: "Fan", type: "generic", klipper: "", enabled: true }) : d.leds.push({ id: uid(5), name: "LEDs", klipper: "", enabled: true }); });
        draw();
      });
      wrap.replaceChildren(html`<div class="hint">These map to <code>[fan_generic name]</code> and <code>[neopixel name]</code> or <code>[led name]</code> sections in printer.cfg. The part cooling fan is always available.</div>`,
        html`<h3>Fans</h3>`, ...fanRows, html`<h3>LEDs</h3>`, ...ledRows, add);
    };
    draw();
    section(host, "Fans and lights", "controls appear on Control and Print", wrap);
  },

  camera(host, { commit }) {
    const c = config.data.webcam;
    const wi = webcamInfo();
    const stream = input("url", c.streamUrl, { placeholder: wi.stream || "/webcam/?action=stream" });
    const snap = input("url", c.snapshotUrl, { placeholder: wi.snapshot || "/webcam/?action=snapshot" });
    const rot = seg([[0, "0°"], [90, "90°"], [180, "180°"], [270, "270°"]], c.rotate || 0, (v) => { upd({ rotate: Number(v) }); });
    const fh = html`<label class="check"><input type="checkbox" ${c.flipH ? "checked" : ""}> Flip horizontally</label>`;
    const fv = html`<label class="check"><input type="checkbox" ${c.flipV ? "checked" : ""}> Flip vertically</label>`;
    const prev = html`<div class="cam-frame" style="max-width:520px"><img alt="Camera preview" hidden><div class="cam-empty"><b>Preview</b><span>Enter an address and press Test.</span></div></div>`;
    const img = prev.querySelector("img");
    function upd(patch) { commit((d) => { d.webcam = { ...d.webcam, ...patch }; }); }
    stream.addEventListener("input", () => upd({ streamUrl: stream.value.trim() }));
    snap.addEventListener("input", () => upd({ snapshotUrl: snap.value.trim() }));
    fh.querySelector("input").addEventListener("change", (e) => upd({ flipH: e.target.checked }));
    fv.querySelector("input").addEventListener("change", (e) => upd({ flipV: e.target.checked }));
    const test = html`<div class="row"><button class="btn">${raw(icon("video"))}Test</button><button class="btn btn-ghost">Use OctoPrint's camera settings</button></div>`;
    test.children[0].addEventListener("click", () => {
      const url = stream.value.trim() || wi.stream || snap.value.trim() || wi.snapshot;
      if (!url) return toast.info("No address yet", "Type the stream address first.");
      prev.querySelector(".cam-empty").hidden = true; img.hidden = false;
      img.onerror = () => { img.hidden = true; prev.querySelector(".cam-empty").hidden = false; prev.querySelector(".cam-empty").innerHTML = "<b>Couldn't load that address</b><span>Check it in a new tab, and that the camera service is running.</span>"; };
      img.src = bust(url.startsWith("/") ? (boot.base || "") + url : url);
    });
    test.children[1].addEventListener("click", async () => { await config.update((d) => { d.webcam = clone(DEFAULT_CONFIG.webcam); }); toast.ok("Using OctoPrint's camera settings"); host.replaceChildren(); BUILDERS.camera(host, { commit }); });
    section(host, "Camera", "used by Print, Timelapse and the kiosk",
      html`<div class="callout is-info">${raw(icon("info"))}<div>OctoPrint currently uses ${wi.stream ? `<code>${esc(wi.stream)}</code>` : "no stream address"}. Leave these fields empty to use that, or fill them in to override it here.</div></div>`,
      labelled("Stream address", stream, "MJPEG works everywhere. On OctoPi and Crowsnest that's usually /webcam/?action=stream."),
      labelled("Snapshot address", snap, "Used for saving pictures and for timelapse."),
      labelled("Rotate", rot), fh, fv, test, prev);
  },

  print(host, { commit }) {
    const pf = config.data.preflight;
    const on = html`<label class="check"><input type="checkbox" ${pf.enabled ? "checked" : ""}> Ask me to confirm a checklist before every print</label>`;
    const items = document.createElement("textarea");
    items.className = "textarea"; items.rows = 6; items.value = (pf.items || []).join("\n");
    const upd = () => commit((d) => { d.preflight = { enabled: on.querySelector("input").checked, items: items.value.split("\n").map((s) => s.trim()).filter(Boolean) }; });
    on.querySelector("input").addEventListener("change", upd);
    items.addEventListener("input", upd);
    section(host, "Before printing", "a last look before the nozzle heats", on, labelled("Checklist (one item per line)", items, "Every box has to be ticked before Start print unlocks."));
  },

  upkeep(host, { commit }) {
    const tb = document.createElement("tbody");
    const draw = () => {
      tb.replaceChildren(...config.data.maintenance.map((m, i) => {
        const tr = html`<tr><td><input class="input" value="${m.name}" aria-label="Task"></td><td class="num-col"><input class="input" type="number" min="1" value="${m.everyHours}" aria-label="Every hours"></td><td><button class="btn btn-ghost btn-icon btn-sm" aria-label="Remove ${m.name}">${raw(icon("trash", "i i-sm"))}</button></td></tr>`;
        const ins = tr.querySelectorAll("input");
        const upd = () => commit((d) => { d.maintenance[i] = { ...d.maintenance[i], name: ins[0].value.trim() || "Task", everyHours: Math.max(1, num(ins[1].value, 100)) }; });
        ins.forEach((x) => x.addEventListener("input", upd));
        tr.querySelector("button").addEventListener("click", async () => { await config.update((d) => { d.maintenance.splice(i, 1); }); draw(); });
        return tr;
      }));
    };
    const table = html`<table class="edit-table"><thead><tr><th>Task</th><th>Every (print hours)</th><th></th></tr></thead></table>`;
    table.append(tb); draw();
    const add = html`<button class="btn">${raw(icon("plus"))}Add task</button>`;
    add.addEventListener("click", async () => { await config.update((d) => { d.maintenance.push({ id: uid(5), name: "New task", everyHours: 100 }); }); draw(); });
    section(host, "Maintenance reminders", "counted from real print time", table, add,
      html`<div class="hint">Progress shows on the Tune screen. Mark a task done there and the count starts over.</div>`);
  },

  notify(host) {
    if (!can("settings")) {
      section(host, "Notifications", "", html`<div class="callout is-info">${raw(icon("lock"))}<div>Only an administrator can set up notifications, because the addresses often contain secret tokens.</div></div>`);
      return;
    }
    const s = store.get("settings")?.plugins?.makerforge || {};
    let hooks = clone(s.webhooks || []);
    const list = html`<div class="col gap-3"></div>`;
    const EV = [["PrintStarted", "Started"], ["PrintDone", "Finished"], ["PrintFailed", "Failed"], ["PrintCancelled", "Cancelled"], ["PrintPaused", "Paused"], ["Error", "Error"]];
    const persist = async () => {
      try { await octo.saveSettings({ plugins: { makerforge: { webhooks: hooks } } }); toast.ok("Notifications saved", "", { timeout: 1500 }); const fresh = await octo.settings(); store.set("settings", fresh); }
      catch (e) { toast.fail("Couldn't save notifications", e); }
    };
    const save = debounce(persist, 700);
    const draw = () => {
      list.replaceChildren(...hooks.map((h, i) => {
        const row = html`<div class="hook">
          <div class="form-grid">
            <div class="field"><label>Name</label><input class="input" value="${h.name || ""}" data-k="name"></div>
            <div class="field"><label>Service</label><select class="select" data-k="type">${raw([["ntfy", "ntfy (phone push)"], ["discord", "Discord"], ["slack", "Slack"], ["json", "Any URL (JSON)"]].map(([v, l]) => `<option value="${v}" ${h.type === v ? "selected" : ""}>${l}</option>`).join(""))}</select></div>
          </div>
          <div class="field"><label>Address</label><input class="input is-mono" type="url" value="${h.url || ""}" data-k="url" placeholder="https://ntfy.sh/your-secret-topic"></div>
          <div class="events">${raw(EV.map(([v, l]) => `<label class="check"><input type="checkbox" data-ev="${v}" ${(h.events || []).includes(v) ? "checked" : ""}> ${l}</label>`).join(""))}</div>
          <div class="row"><button class="btn btn-sm" data-a="test">${raw(icon("bell", "i i-sm"))}Send a test</button><button class="btn btn-sm btn-ghost" data-a="del">${raw(icon("trash", "i i-sm"))}Remove</button></div></div>`;
        row.addEventListener("input", (e) => {
          const k = e.target.dataset.k, ev = e.target.dataset.ev;
          if (k) h[k] = e.target.value; if (ev) h.events = Array.from(row.querySelectorAll("[data-ev]")).filter((x) => x.checked).map((x) => x.dataset.ev);
          save();
        });
        row.addEventListener("click", async (e) => {
          const a = e.target.closest("[data-a]")?.dataset.a;
          if (a === "del") { hooks.splice(i, 1); draw(); persist(); }
          if (a === "test") {
            e.target.closest("button").classList.add("is-busy");
            try { const res = await mf.testNotify(h); toast.ok("Test sent", res.message); } catch (err) { toast.fail("The test didn't go through", err); }
            finally { e.target.closest("button")?.classList.remove("is-busy"); }
          }
        });
        return row;
      }));
      if (!hooks.length) list.append(html`<div class="hint">Nothing set up. Add a service to get a message on your phone when a print finishes or fails.</div>`);
    };
    draw();
    const add = html`<button class="btn">${raw(icon("plus"))}Add a service</button>`;
    add.addEventListener("click", () => { hooks.push({ name: "Phone", type: "ntfy", url: "", events: ["PrintDone", "PrintFailed"], enabled: true }); draw(); });
    section(host, "Notifications", "sent from the printer's computer, so they work with the tab closed",
      html`<div class="callout is-info">${raw(icon("info"))}<div><b>ntfy.sh</b> is the easiest: install the ntfy app, pick a hard-to-guess topic, and use <code>https://ntfy.sh/your-topic</code> here. Discord and Slack take a webhook URL.</div></div>`, list, add);
  },

  interface(host) {
    if (!can("settings")) { section(host, "Interface", "", html`<div class="callout is-info">${raw(icon("lock"))}<div>Only an administrator can change these.</div></div>`); return; }
    const s = store.get("settings")?.plugins?.makerforge || {};
    const set = async (patch) => { try { await octo.saveSettings({ plugins: { makerforge: patch } }); toast.ok("Saved", "", { timeout: 1400 }); store.set("settings", await octo.settings()); } catch (e) { toast.fail("Couldn't save", e); } };
    const def = html`<label class="check"><input type="checkbox" ${s.default_ui !== false ? "checked" : ""}> Use MakerForge as the main page of this OctoPrint</label>`;
    def.querySelector("input").addEventListener("change", async (e) => {
      if (!e.target.checked && !(await confirmDialog({ title: "Go back to the classic page?", text: "The MakerForge UI stays available at /plugin/makerforge/ and from the OctoPrint navbar.", confirm: "Use classic" }))) { e.target.checked = true; return; }
      set({ default_ui: e.target.checked });
    });
    const skin = html`<label class="check"><input type="checkbox" ${s.classic_skin !== false ? "checked" : ""}> Give the classic OctoPrint UI the MakerForge colours</label>`;
    skin.querySelector("input").addEventListener("change", (e) => set({ classic_skin: e.target.checked }));
    section(host, "Interface", "this changes OctoPrint for everyone", def, skin,
      html`<div class="hint">If you ever need the stock page back, add <code>?classic</code> to the address (for example <code>${location.origin}/?classic</code>).</div>`);
  },

  data(host) {
    const body = html`<div class="col gap-4">
      <div class="row wrap"><button class="btn" data-a="export">${raw(icon("download"))}Export shared config</button><button class="btn" data-a="import">${raw(icon("upload"))}Import…</button></div>
      <div class="row wrap"><button class="btn btn-ghost" data-a="prefs">Reset this browser's preferences</button><button class="btn btn-danger" data-a="reset">Reset shared config to defaults</button></div>
      <div class="hint">Shared config is your macros, presets, fans, camera and reminders. Browser preferences are theme, density and terminal filters.</div></div>`;
    body.addEventListener("click", async (e) => {
      const a = e.target.closest("[data-a]")?.dataset.a;
      if (a === "export") download("makerforge-config.json", JSON.stringify(config.data, null, 2), "application/json");
      if (a === "import") {
        const text = await promptDialog({ title: "Import config", label: "Paste an exported config", multiline: true, mono: true, confirm: "Import", validate: (v) => { try { const o = JSON.parse(v); return o && typeof o === "object" && !Array.isArray(o) ? null : "That should be a JSON object."; } catch { return "That isn't valid JSON."; } } });
        if (text) { const o = JSON.parse(text); delete o.rev; await config.update((d) => { Object.assign(d, o); }); toast.ok("Config imported"); }
      }
      if (a === "prefs" && await confirmDialog({ title: "Reset preferences?", text: "Theme, density and filters go back to normal in this browser.", confirm: "Reset" })) { prefs.reset(); toast.ok("Preferences reset"); }
      if (a === "reset" && await confirmDialog({ title: "Reset shared config?", text: "This replaces every macro, preset, fan, camera and reminder setting with the built-in defaults, for everyone.", confirm: "Reset everything", danger: true })) {
        await config.update((d) => { for (const k of Object.keys(d)) delete d[k]; Object.assign(d, clone(DEFAULT_CONFIG)); }); toast.ok("Defaults restored");
      }
    });
    section(host, "Data", "", body);
  },

  about(host) {
    const s = store.get("server");
    const kv = html`<dl class="kv"><dt>MakerForge UI</dt><dd>${boot.version}</dd><dt>OctoPrint</dt><dd>${s.version || "–"}</dd><dt>Python</dt><dd>${s.pythonVersion || "–"}</dd><dt>Signed in as</dt><dd>${store.get("auth.name") || "guest"}</dd></dl>`;
    const keys = html`<div class="col gap-2"><h3>Shortcuts</h3><div class="row wrap gap-4"><span><kbd>Ctrl</kbd> <kbd>K</kbd> command palette</span><span><kbd>←</kbd><kbd>→</kbd><kbd>↑</kbd><kbd>↓</kbd> move X and Y (Control)</span><span><kbd>PgUp</kbd><kbd>PgDn</kbd> move Z (Control)</span></div></div>`;
    const links = html`<div class="row wrap"><a class="btn" href="${boot.classicUrl}">${raw(icon("external"))}Classic OctoPrint UI</a><a class="btn btn-ghost" target="_blank" rel="noopener" href="https://github.com/28kearlrusa-spec/Octoprint">${raw(icon("external"))}Project on GitHub</a></div>`;
    section(host, "About", "", kv, keys, links,
      html`<div class="hint">Fonts: Space Grotesk, Inter and JetBrains Mono, all under the SIL Open Font License. Built for a Voron; made in the MakerForge shop.</div>`);
  },
};
