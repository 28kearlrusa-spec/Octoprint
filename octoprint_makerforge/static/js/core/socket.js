// Live data from OctoPrint. Speaks the SockJS wire protocol directly over a WebSocket so the
// app needs no client library, and falls back to polling the REST API if sockets are blocked.
import { store, bus } from "mf/core/store.js";
import { BASE, octo } from "mf/core/api.js";
import { temps, term } from "mf/core/telemetry.js";

const BACKOFF = [500, 1000, 2000, 3000, 5000, 8000, 13000, 20000];
const POLL_AFTER_FAILURES = 4;

let ws = null;
let creds = null;          // {user, session}
let attempt = 0;
let failuresWithoutOpen = 0;
let reconnectTimer = null;
let closedByUs = false;
let pollTimer = null;
let throttle = 1;
let lastPluginHash = null;
let lastConfigHash = null;

const rand = (n) => Array.from({ length: n }, () => "abcdefghijklmnopqrstuvwxyz0123456789"[Math.floor(Math.random() * 36)]).join("");

function socketUrl() {
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const server = String(Math.floor(Math.random() * 900) + 100);
  return `${proto}//${location.host}${BASE}/sockjs/${server}/${rand(12)}/websocket`;
}

function setNet(patch) { store.patch("net", patch); }

export function connect(credentials) {
  creds = credentials || null;
  closedByUs = false;
  stopPolling();
  open();
}

export function disconnect() {
  closedByUs = true;
  clearTimeout(reconnectTimer);
  stopPolling();
  if (ws) { try { ws.close(1000); } catch { /* already closed */ } ws = null; }
  setNet({ socket: "closed" });
}

function open() {
  clearTimeout(reconnectTimer);
  setNet({ socket: attempt ? "reconnecting" : "connecting" });
  let sock;
  try { sock = new WebSocket(socketUrl()); } catch (e) { return scheduleReconnect(); }
  ws = sock;
  let opened = false;

  sock.onopen = () => { /* the server greets with an "o" frame */ };
  sock.onmessage = (ev) => {
    const data = ev.data;
    const kind = data[0];
    if (kind === "o") {
      opened = true;
      failuresWithoutOpen = 0;
      attempt = 0;
      send({ auth: creds ? `${creds.user}:${creds.session}` : undefined });
      send({ throttle });
      return;
    }
    if (kind === "a") {
      try {
        // OctoPrint sends objects straight in the array; plain SockJS servers send JSON strings
        for (const frame of JSON.parse(data.slice(1))) handleFrame(typeof frame === "string" ? JSON.parse(frame) : frame);
      } catch (e) { console.error("[socket] bad frame", e, data.slice(0, 200)); }
    } else if (kind === "c") {
      try { sock.close(); } catch { /* ignore */ }
    }
  };
  sock.onerror = () => { /* onclose follows */ };
  sock.onclose = () => {
    if (ws === sock) ws = null;
    if (closedByUs) return;
    if (!opened) failuresWithoutOpen++;
    setNet({ socket: "down", reason: opened ? "Connection to OctoPrint dropped" : "Can't open a live connection" });
    scheduleReconnect();
  };
}

function scheduleReconnect() {
  if (closedByUs) return;
  if (failuresWithoutOpen >= POLL_AFTER_FAILURES) startPolling();
  const wait = BACKOFF[Math.min(attempt++, BACKOFF.length - 1)];
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(open, wait);
}

export function send(msg) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  const clean = Object.fromEntries(Object.entries(msg).filter(([, v]) => v !== undefined));
  if (!Object.keys(clean).length) return false;
  ws.send(JSON.stringify([JSON.stringify(clean)]));
  return true;
}

/** Ask OctoPrint to send updates less often (hidden tab, kiosk on a slow link). 1 = every 500ms. */
export function setThrottle(n) {
  throttle = Math.max(1, Math.round(n));
  send({ throttle });
}

// ~~ message routing ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
function handleFrame(msg) {
  setNet({ lastMessage: Date.now() });
  for (const [type, data] of Object.entries(msg)) {
    switch (type) {
      case "connected":
        setNet({ socket: "live", reason: null });
        store.patch("server", { version: data.display_version || data.version, pythonVersion: data.python_version, safeMode: data.safe_mode });
        if (lastPluginHash && (data.plugin_hash !== lastPluginHash || data.config_hash !== lastConfigHash)) {
          bus.emit("server:changed", data);
        }
        lastPluginHash = data.plugin_hash;
        lastConfigHash = data.config_hash;
        bus.emit("socket:connected", data);
        break;
      case "history":
      case "current":
        ingest(data, type === "history");
        break;
      case "event":
        bus.emit("event", data);
        bus.emit(`event:${data.type}`, data.payload);
        break;
      case "plugin":
        bus.emit(`plugin:${data.plugin}`, data.data);
        break;
      case "timelapse":
        store.set("timelapse", data);
        break;
      case "reauthRequired":
        bus.emit("auth:lost", { reason: data.reason });
        break;
      case "slicingProgress":
        bus.emit("slicing", data);
        break;
      case "renderProgress":
        bus.emit("render", data);
        break;
      default:
        break;
    }
  }
}

function ingest(data, isHistory) {
  if (data.serverTime) {
    const skew = data.serverTime * 1000 - Date.now();
    // smooth it a little; server time is stamped before the message is sent
    const cur = store.get("net.clockSkew") || 0;
    setNet({ clockSkew: cur ? cur * 0.8 + skew * 0.2 : skew });
  }
  if (data.state) {
    store.setIfChanged("printer", { text: data.state.text, flags: data.state.flags, error: data.state.error || null });
  }
  if (data.job) store.setIfChanged("job", data.job);
  if (data.progress) store.setIfChanged("progress", data.progress);
  if (data.currentZ !== undefined) store.setIfChanged("currentZ", data.currentZ);
  if (data.offsets) store.setIfChanged("offsets", data.offsets);
  if (data.busyFiles) store.setIfChanged("busyFiles", data.busyFiles);

  if (isHistory) {
    temps.reset();
    term.clear();
  }
  if (data.temps?.length) {
    const skew = store.get("net.clockSkew") || 0;
    temps.ingest(data.temps, skew);
    const last = data.temps[data.temps.length - 1];
    const cur = {};
    for (const [k, v] of Object.entries(last)) if (k !== "time" && v && typeof v === "object") cur[k] = { actual: v.actual, target: v.target };
    store.setIfChanged("temps", cur);
  }
  if (data.logs?.length) {
    term.push(data.logs);
    bus.emit("logs", data.logs);
  }
  if (data.messages?.length) bus.emit("messages", data.messages);
  if (isHistory) bus.emit("history", data);
}

// ~~ polling fallback ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
function startPolling() {
  if (pollTimer) return;
  setNet({ socket: "polling", reason: "Live updates are blocked, refreshing every 2 seconds instead" });
  const tick = async () => {
    try {
      const [p, j] = await Promise.all([octo.printer({ history: false }).catch(() => null), octo.job().catch(() => null)]);
      const payload = { serverTime: Date.now() / 1000 };
      if (p) {
        payload.state = p.state;
        const entry = { time: Date.now() / 1000 };
        for (const [k, v] of Object.entries(p.temperature || {})) if (v && typeof v === "object" && "actual" in v) entry[k] = v;
        payload.temps = [entry];
      }
      if (j) { payload.job = j.job; payload.progress = j.progress; if (j.state && !payload.state) payload.state = { text: j.state, flags: {} }; }
      ingest(payload, false);
    } catch (e) { /* keep trying */ }
  };
  tick();
  pollTimer = setInterval(tick, 2000);
}
function stopPolling() { if (pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

bus.on("socket:retry", () => { if (!ws || ws.readyState !== WebSocket.OPEN) { clearTimeout(reconnectTimer); attempt = 0; open(); } });

// be kind to slow links and phones: less traffic while the tab is hidden
document.addEventListener("visibilitychange", () => {
  setThrottle(document.hidden ? 6 : 1);
});
