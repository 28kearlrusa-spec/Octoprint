// System: the computer OctoPrint runs on, the printer connection, and the power buttons.
import { html, raw, refs, esc } from "mf/core/dom.js";
import { store } from "mf/core/store.js";
import { icon } from "mf/ui/icons.js";
import { get, octo } from "mf/core/api.js";
import { can } from "mf/core/auth.js";
import { bytes, DASH } from "mf/core/format.js";
import { confirmDialog } from "mf/ui/dialog.js";
import { toast } from "mf/ui/toast.js";

const SOCKET = { open: "Live", connecting: "Connecting", reconnecting: "Reconnecting", polling: "Polling", down: "Down" };

// Raspberry Pi undervoltage and throttling, decoded the way OctoPrint's Pi support plugin does
function piPower(state) {
  const v = typeof state === "string" ? parseInt(state, 16) : Number(state);
  if (!Number.isFinite(v)) return null;
  if (v & 0x1) return ["Undervoltage now", "is-err"];
  if (v & 0x4) return ["Throttled now", "is-err"];
  if (v & 0x10000) return ["Undervoltage earlier", "is-warn"];
  if (v & 0x40000) return ["Throttled earlier", "is-warn"];
  return ["Power OK", "is-ok"];
}

export function mountSystem(host) {
  const el = html`
    <section class="panel a-system" aria-label="System">
      <div class="panel-head"><h2 class="panel-title">System</h2><span class="chip" data-ref="power" hidden></span></div>
      <div class="panel-body col gap-4">
        <dl class="kv" data-ref="kv"></dl>
        <div class="col gap-1" data-ref="diskWrap" hidden>
          <div class="row between"><span class="label">Upload storage</span><span class="hint tnum" data-ref="diskText"></span></div>
          <div class="bar is-thin" data-ref="disk"><i></i></div>
        </div>
        <div class="row wrap" data-ref="cmds"></div>
      </div>
    </section>`;
  const r = refs(el);
  host.append(el);

  let info = null, disk = null, commands = [];

  function render() {
    const s = store.state;
    const i = info || {};
    const c = s.conn?.current || {};
    const net = s.net || {};
    const ram = i["env.hardware.ram"];
    const pi = i["env.plugins.pi_support.model"];
    const os = i["env.plugins.pi_support.octopi_version"] ? `OctoPi ${i["env.plugins.pi_support.octopi_version"]}` : i["env.os.id"] ? `${i["env.os.id"]}${i["env.os.bits"] ? `, ${i["env.os.bits"]}-bit` : ""}` : null;
    const rows = [
      ["OctoPrint", i["octoprint.version"] || s.server?.version || DASH],
      ["Python", i["env.python.version"] || DASH],
      ["Computer", pi || (i["env.hardware.cores"] ? `${i["env.hardware.cores"]} cores${ram ? `, ${bytes(ram)} RAM` : ""}` : DASH)],
      ["System", os || DASH],
      ["Printer port", c.port ? `${c.port}${c.baudrate ? ` at ${c.baudrate}` : ""}` : "Not connected"],
      ["Live updates", SOCKET[net.socket] || net.socket || DASH],
      ["Internet", i["connectivity.online"] == null ? DASH : i["connectivity.online"] ? "Online" : "Offline"],
    ];
    if (i["octoprint.safe_mode"]) rows.push(["Safe mode", "On: third-party plugins are off"]);
    r.kv.innerHTML = rows.map(([dt, dd]) => `<dt>${esc(dt)}</dt><dd>${esc(dd)}</dd>`).join("");

    const pw = piPower(i["env.plugins.pi_support.throttle_state"]);
    r.power.hidden = !pw;
    if (pw) { r.power.textContent = pw[0]; r.power.className = `chip ${pw[1]}`; }

    r.diskWrap.hidden = !disk;
    if (disk) {
      const used = disk.total - disk.free;
      const frac = disk.total ? used / disk.total : 0;
      r.diskText.textContent = `${bytes(disk.free)} free of ${bytes(disk.total)}`;
      r.disk.style.setProperty("--p", `${(frac * 100).toFixed(1)}%`);
      r.disk.querySelector("i").style.background = frac > 0.92 ? "var(--err)" : frac > 0.8 ? "var(--warn)" : "";
    }
  }

  function renderCommands() {
    r.cmds.replaceChildren(...commands.map((cmd) => {
      const danger = /shutdown|reboot/i.test(cmd.action);
      const b = html`<button class="btn btn-sm ${danger ? "btn-danger" : ""}">${raw(icon(/shutdown/i.test(cmd.action) ? "power" : "refresh"))}${cmd.name}</button>`;
      b.addEventListener("click", async () => {
        if (!(await confirmDialog({ title: `${cmd.name}?`, text: cmd.confirm || "OctoPrint and this page will be unavailable for a while.", confirm: cmd.name, danger }))) return;
        try { await octo.runSystem(cmd.source, cmd.action); toast.info(cmd.name, "Sent. This page reconnects by itself when OctoPrint is back."); }
        catch (e) { toast.fail(`Couldn't run “${cmd.name}”`, e); }
      });
      return b;
    }));
    if (!commands.length && can("admin")) r.cmds.append(html`<span class="hint">No restart or shutdown commands are set up in OctoPrint (Settings › Server).</span>`);
  }

  async function load() {
    const [si, files, sc] = await Promise.allSettled([
      get("/api/system/info"),
      get("/api/files/local?recursive=false"),
      can("admin") ? octo.systemCommands() : Promise.resolve(null),
    ]);
    if (si.status === "fulfilled") info = si.value?.systeminfo || null;
    if (files.status === "fulfilled" && typeof files.value?.free === "number") disk = { free: files.value.free, total: files.value.total };
    if (sc.status === "fulfilled" && sc.value) {
      commands = [...(sc.value.core || []), ...(sc.value.custom || [])].filter((x) => x && x.action && x.name);
      renderCommands();
    }
    render();
  }

  const offs = [store.on("conn", render), store.on("net", render), store.on("server", render)];
  const poll = setInterval(() => { if (!document.hidden) load(); }, 60000);
  load();
  render();
  return { dispose() { clearInterval(poll); offs.forEach((o) => o()); el.remove(); } };
}
