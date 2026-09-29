// Connect-to-printer dialog. With Klipper the serial port is almost always /tmp/printer.
import { html, raw, refs } from "mf/core/dom.js";
import { icon } from "mf/ui/icons.js";
import { openDialog } from "mf/ui/dialog.js";
import { octo } from "mf/core/api.js";
import { store } from "mf/core/store.js";
import * as actions from "mf/core/actions.js";
import { toast } from "mf/ui/toast.js";

export async function loadConnectionOptions() {
  try {
    const c = await octo.connection();
    store.set("conn", c);
    return c;
  } catch (e) {
    return store.get("conn");
  }
}

/** Pick sensible defaults: saved preference, then a Klipper socket, then the first real port. */
export function pickDefaults(opts) {
  const ports = opts?.ports || [];
  const port = opts?.portPreference && ports.includes(opts.portPreference) ? opts.portPreference
    : ports.find((p) => /\/tmp\/printer|klipper/i.test(p)) || ports.find((p) => /ttyACM|ttyUSB|serial\/by-id|usbmodem/i.test(p)) || ports[0] || "";
  const baud = opts?.baudratePreference || (/\/tmp\/printer/.test(port) ? 250000 : opts?.baudrates?.[0]) || 250000;
  return { port, baud };
}

export async function openConnect() {
  const conn = (await loadConnectionOptions()) || {};
  const o = conn.options || { ports: [], baudrates: [250000, 115200], printerProfiles: [] };
  const def = pickDefaults(o);
  const ports = o.ports.includes(def.port) || !def.port ? o.ports : [def.port, ...o.ports];

  const body = html`
    <form class="col gap-4" autocomplete="off">
      <div class="callout is-info">${raw(icon("info"))}<div>Running Klipper through OctoKlipper? Choose <code>/tmp/printer</code>. Baud rate doesn't matter there, but 250000 is the convention.</div></div>
      <div class="field">
        <label for="c-port">Serial port</label>
        <select class="select" id="c-port" data-ref="port">
          <option value="AUTO">Auto-detect</option>
          ${ports.map((p) => html`<option value="${p}" ${p === def.port ? "selected" : ""}>${p}</option>`)}
        </select>
        <div class="hint" data-ref="noports" ${ports.length ? "hidden" : ""}>OctoPrint doesn't see any serial ports. If you use Klipper, make sure the klipper service is running.</div>
      </div>
      <div class="row gap-3 wrap">
        <div class="field grow" style="min-width:140px">
          <label for="c-baud">Baud rate</label>
          <select class="select" id="c-baud" data-ref="baud">
            <option value="AUTO">Auto-detect</option>
            ${(o.baudrates || []).map((b) => html`<option value="${b}" ${b === def.baud ? "selected" : ""}>${b}</option>`)}
          </select>
        </div>
        <div class="field grow" style="min-width:140px">
          <label for="c-prof">Printer profile</label>
          <select class="select" id="c-prof" data-ref="profile">
            ${(o.printerProfiles || []).map((p) => html`<option value="${p.id}" ${p.id === o.printerProfilePreference ? "selected" : ""}>${p.name}</option>`)}
          </select>
        </div>
      </div>
      <label class="check"><input type="checkbox" data-ref="save" checked> Remember these settings</label>
      <label class="check"><input type="checkbox" data-ref="auto"> Connect automatically when OctoPrint starts</label>
    </form>`;
  const r = refs(body);
  r.auto.checked = !!o.autoconnect;

  openDialog({
    title: "Connect to printer",
    body,
    buttons: [
      { label: "Cancel", kind: "ghost" },
      {
        label: "Connect", kind: "primary", icon: "plug", autofocus: true,
        onClick: async () => {
          try {
            await actions.connectPrinter({
              port: r.port.value === "AUTO" ? undefined : r.port.value,
              baudrate: r.baud.value === "AUTO" ? undefined : Number(r.baud.value),
              printerProfile: r.profile.value || undefined,
              save: r.save.checked,
              autoconnect: r.auto.checked,
            });
            toast.info("Connecting…", "Opening the serial port.");
          } catch { return false; }
        },
      },
    ],
  });
}
