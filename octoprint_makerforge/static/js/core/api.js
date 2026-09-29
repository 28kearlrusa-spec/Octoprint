// HTTP client for OctoPrint's REST API and this plugin's own API.
import { bus } from "mf/core/store.js";

const bootEl = document.getElementById("mf-boot");
export const boot = bootEl ? JSON.parse(bootEl.textContent) : {};
export const BASE = boot.base || "";
export const PLUGIN = boot.pluginBase || `${BASE}/plugin/makerforge`;

export class ApiError extends Error {
  constructor(status, message, body) {
    super(message || `HTTP ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

// OctoPrint names its CSRF cookie after the port and (behind a proxy) the path prefix.
function csrfCookieName() {
  const port = location.port || (location.protocol === "https:" ? "443" : "80");
  const path = BASE ? `_R${BASE.replace(/\//g, "|")}` : "";
  return `csrf_token_P${port}${path}`;
}
function csrfToken() {
  const wanted = csrfCookieName();
  let fallback = null;
  for (const part of document.cookie.split("; ")) {
    const i = part.indexOf("=");
    const name = part.slice(0, i);
    if (name === wanted) return decodeURIComponent(part.slice(i + 1));
    if (name.startsWith("csrf_token") && !fallback) fallback = decodeURIComponent(part.slice(i + 1));
  }
  return fallback;
}

export const enc = (path) => String(path || "").split("/").map(encodeURIComponent).join("/");
export const url = (p) => (/^(https?:)?\/\//.test(p) ? p : p.startsWith(BASE + "/") || p === BASE ? p : BASE + p);
export const qs = (obj) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj || {})) if (v !== undefined && v !== null) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
};

let sessionExpectedLive = false;
export const setSessionLive = (v) => { sessionExpectedLive = v; };

// OctoPrint answers 403 both for "you are signed out" and for "your account may not do that".
// Ask something every live session may ask to tell them apart, so a missing permission never
// throws anyone back to the sign-in screen.
let sessionCheck = null;
function checkSession(status, path) {
  if (!sessionCheck) {
    sessionCheck = fetch(url("/api/version"), { credentials: "same-origin", headers: { Accept: "application/json" } })
      .then((r) => { if ((r.status === 401 || r.status === 403) && sessionExpectedLive) bus.emit("auth:lost", { status, path }); })
      .catch(() => { /* can't reach OctoPrint: the socket code reports that */ })
      .finally(() => setTimeout(() => { sessionCheck = null; }, 3000));
  }
  return sessionCheck;
}

export async function request(method, path, { body, headers = {}, signal, timeout = 30000, raw = false, retry = true } = {}) {
  const ctl = new AbortController();
  const timer = timeout ? setTimeout(() => ctl.abort(new DOMException("Timed out", "TimeoutError")), timeout) : null;
  if (signal) signal.addEventListener("abort", () => ctl.abort(signal.reason), { once: true });

  const init = { method, headers: { Accept: "application/json", ...headers }, credentials: "same-origin", signal: ctl.signal };
  if (!/^(GET|HEAD|OPTIONS)$/.test(method)) {
    const t = csrfToken();
    if (t) init.headers["X-CSRF-Token"] = t;
  }
  if (body !== undefined) {
    if (body instanceof FormData || body instanceof Blob || typeof body === "string") init.body = body;
    else { init.body = JSON.stringify(body); init.headers["Content-Type"] = "application/json"; }
  }

  let res;
  try {
    res = await fetch(url(path), init);
  } catch (e) {
    if (timer) clearTimeout(timer);
    if (e?.name === "AbortError" || e?.name === "TimeoutError") throw new ApiError(0, "Request timed out");
    throw new ApiError(0, "Can't reach OctoPrint");
  }
  if (timer) clearTimeout(timer);

  if (raw) return res;

  const ctype = res.headers.get("content-type") || "";
  let data = null;
  if (res.status !== 204) {
    data = ctype.includes("json") ? await res.json().catch(() => null) : await res.text().catch(() => "");
  }

  if (!res.ok) {
    const msg = (data && (data.error || data.message)) || (typeof data === "string" && data.trim().slice(0, 200)) || `HTTP ${res.status}`;
    // A stale CSRF cookie: fetch a fresh one and try once more.
    if (res.status === 400 && /CSRF/i.test(String(msg)) && retry) {
      await fetch(url("/api/version"), { credentials: "same-origin" }).catch(() => {});
      return request(method, path, { body, headers, signal, timeout, raw, retry: false });
    }
    if ((res.status === 401 || res.status === 403) && sessionExpectedLive && !path.includes("/api/login")) {
      if (path.endsWith("/api/version")) bus.emit("auth:lost", { status: res.status, path });
      else checkSession(res.status, path);
    }
    // Werkzeug's stock 403 text (or an HTML page) says nothing useful in a toast
    const generic = res.status === 403 && /<\w|don't have the permission/i.test(String(msg));
    throw new ApiError(res.status, generic ? "Your OctoPrint account isn't allowed to do that." : String(msg), data);
  }
  return data;
}

export const get = (p, o) => request("GET", p, o);
export const post = (p, body, o) => request("POST", p, { ...o, body });
export const put = (p, body, o) => request("PUT", p, { ...o, body });
export const del = (p, o) => request("DELETE", p, o);

/** Upload with progress. Returns a promise; call .abort() on it to cancel. */
export function upload(path, file, fields = {}, onProgress) {
  const xhr = new XMLHttpRequest();
  const promise = new Promise((resolve, reject) => {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    form.append("file", file, file.name);
    xhr.open("POST", url(path));
    xhr.withCredentials = true;
    xhr.setRequestHeader("Accept", "application/json");
    const t = csrfToken();
    if (t) xhr.setRequestHeader("X-CSRF-Token", t);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total, e.loaded, e.total); };
    xhr.onload = () => {
      let data = null;
      try { data = JSON.parse(xhr.responseText); } catch { /* not json */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new ApiError(xhr.status, data?.error || `Upload failed (HTTP ${xhr.status})`, data));
    };
    xhr.onerror = () => reject(new ApiError(0, "Upload failed: connection lost"));
    xhr.onabort = () => reject(new ApiError(0, "Upload cancelled"));
    xhr.send(form);
  });
  promise.abort = () => xhr.abort();
  return promise;
}

// ~~ OctoPrint REST endpoints, named for what they do ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
export const octo = {
  version: () => get("/api/version"),
  login: (user, pass, remember) => post("/api/login", { user, pass, remember: !!remember }),
  passive: () => post("/api/login", { passive: true }),
  logout: () => post("/api/logout"),

  settings: () => get("/api/settings"),
  saveSettings: (patch) => post("/api/settings", patch),

  printer: (qsobj) => get("/api/printer" + qs(qsobj)),
  command: (cmds) => post("/api/printer/command", { commands: [].concat(cmds) }),
  tool: (body) => post("/api/printer/tool", body),
  bed: (body) => post("/api/printer/bed", body),
  chamber: (body) => post("/api/printer/chamber", body),
  printhead: (body) => post("/api/printer/printhead", body),

  job: () => get("/api/job"),
  jobCommand: (command, action) => post("/api/job", action ? { command, action } : { command }),

  files: () => get("/api/files/local" + qs({ recursive: true })),
  file: (path) => get(`/api/files/local/${enc(path)}`),
  select: (path, print = false) => post(`/api/files/local/${enc(path)}`, { command: "select", print }),
  slice: (path, body) => post(`/api/files/local/${enc(path)}`, { command: "slice", ...body }),
  moveFile: (path, destination) => post(`/api/files/local/${enc(path)}`, { command: "move", destination }),
  copyFile: (path, destination) => post(`/api/files/local/${enc(path)}`, { command: "copy", destination }),
  deleteFile: (path) => del(`/api/files/local/${enc(path)}`),
  createFolder: (foldername, path = "") => {
    const f = new FormData();
    f.append("foldername", foldername);
    if (path) f.append("path", path);
    return post("/api/files/local", f);
  },
  uploadFile: (file, { path = "", select = false, print = false } = {}, onProgress) =>
    upload("/api/files/local", file, { ...(path ? { path } : {}), select, print }, onProgress),
  downloadUrl: (path) => url(`/downloads/files/local/${enc(path)}`),

  connection: () => get("/api/connection"),
  connect: (opts) => post("/api/connection", { command: "connect", ...opts }),
  disconnect: () => post("/api/connection", { command: "disconnect" }),
  profiles: () => get("/api/printerprofiles"),

  timelapse: () => get("/api/timelapse" + qs({ unrendered: true })),
  saveTimelapse: (cfg) => post("/api/timelapse", cfg),
  deleteTimelapse: (name) => del(`/api/timelapse/${encodeURIComponent(name)}`),
  deleteUnrendered: (name) => del(`/api/timelapse/unrendered/${encodeURIComponent(name)}`),
  renderUnrendered: (name) => post(`/api/timelapse/unrendered/${encodeURIComponent(name)}`, { command: "render" }),
  timelapseUrl: (name) => url(`/downloads/timelapse/${encodeURIComponent(name)}`),

  systemCommands: () => get("/api/system/commands"),
  runSystem: (source, action) => post(`/api/system/commands/${source}/${action}`),

  webcamSnapshot: () => get("/webcam/?action=snapshot", { raw: true }),

  // OctoPrint's bundled Action Command Prompt plugin (host prompts answered with M876)
  promptState: () => get("/api/plugin/action_command_prompt"),
  answerPrompt: (choice) => post("/api/plugin/action_command_prompt", { command: "select", choice }),
};

// ~~ this plugin's own API ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
export const mf = {
  config: () => get(`${PLUGIN}/api/config`),
  saveConfig: (doc) => put(`${PLUGIN}/api/config`, doc),
  meta: (path) => get(`${PLUGIN}/api/meta${qs({ path })}`),
  layers: (path) => get(`${PLUGIN}/api/layers${qs({ path })}`),
  thumbUrl: (path, v) => url(`${PLUGIN}/api/thumb${qs({ path, v })}`),
  stats: () => get(`${PLUGIN}/api/stats`),
  addMaintenance: (task) => post(`${PLUGIN}/api/maintenance`, task),
  resetMaintenance: (id) => post(`${PLUGIN}/api/maintenance/${encodeURIComponent(id)}/reset`),
  testNotify: (body) => post(`${PLUGIN}/api/notify/test`, body),
};
