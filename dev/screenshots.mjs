// Renders README screenshots with headless Chrome over the DevTools protocol (Node built-ins only).
//
//   node dev/screenshots.mjs [out-dir]
//
// Needs the sandbox running (dev/dev-instance.sh bg), the virtual printer connected
// (dev/fixture.sh connect) and guest access opened up on the sandbox so no sign-in is needed.
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.resolve(process.argv.slice(2).find((a) => !a.startsWith("--")) || path.join(root, "docs", "screenshots"));
const HOST = process.env.MF_HOST || "http://127.0.0.1:5055";
const CHROME = process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(OUT, { recursive: true });

const profile = mkdtempSync(path.join(tmpdir(), "mf-shots-"));
const chrome = spawn(CHROME, [
  "--headless=new", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, "--no-first-run", "--hide-scrollbars",
  "--enable-unsafe-swiftshader", "--use-angle=swiftshader", "--ignore-gpu-blocklist", "about:blank",
], { stdio: "ignore" });

async function connect() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* not up yet */ }
    await sleep(200);
  }
  throw new Error("Chrome did not start");
}

const ws = new WebSocket(await connect());
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let id = 0;
let scriptId = null;
const pending = new Map();
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const { res, rej } = pending.get(m.id); pending.delete(m.id); m.error ? rej(new Error(m.error.message)) : res(m.result); }
});
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pending.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })); });
await send("Page.enable");
const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.value;

async function waitFor(expr, timeout = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) { if (await evaluate(expr)) return true; await sleep(250); }
  throw new Error("timed out waiting for: " + expr);
}

async function shot(name, { route, width = 1440, height = 900, dpr = 2, theme = "forge", ready = "!!document.querySelector('#stage .view')", after, settle = 1500, clipToContent = false, mobile = false } = {}) {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: dpr, mobile });
  if (scriptId) await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: scriptId });
  ({ identifier: scriptId } = await send("Page.addScriptToEvaluateOnNewDocument", { source: `try{localStorage.setItem('mf.prefs.v1', JSON.stringify({theme:'${theme}', sound:false, camOpen:true}));localStorage.setItem('mf.welcome.dismissed.v1','1')}catch(e){}` }));
  await send("Page.navigate", { url: `${HOST}/?shot=${Date.now()}#/${route}` });
  await waitFor("!!document.querySelector('.shell')");
  await waitFor(ready);
  if (after) await evaluate(after);
  await sleep(settle);
  if (process.env.DEBUG_SHOTS) console.log("  welcome flag:", await evaluate("localStorage.getItem('mf.welcome.dismissed.v1')"), "panel:", await evaluate("!!document.querySelector('.welcome')"));
  const params = { format: "png", captureBeyondViewport: false };
  if (clipToContent) {
    const h = await evaluate("Math.ceil(document.documentElement.scrollHeight)");
    await send("Emulation.setDeviceMetricsOverride", { width, height: Math.min(h, 2400), deviceScaleFactor: dpr, mobile });
    await sleep(500);
  }
  const { data } = await send("Page.captureScreenshot", params);
  const file = path.join(OUT, `${name}.png`);
  writeFileSync(file, Buffer.from(data, "base64"));
  // sips ships with macOS: shrink to a repo-friendly JPEG
  try {
    execFileSync("sips", ["-Z", mobile ? "1400" : "1800", "-s", "format", "jpeg", "-s", "formatOptions", "86", file, "--out", file.replace(/\.png$/, ".jpg")], { stdio: "ignore" });
    rmSync(file);
  } catch { /* keep the PNG */ }
  console.log("captured", name);
}

const fixture = (...args) => execFileSync(path.join(root, "dev", "fixture.sh"), args, { encoding: "utf8" }).trim();
const jobProgress = async () => {
  const j = await (await fetch(`${HOST}/api/job`)).json();
  return { state: j.state, pct: j.progress?.completion ?? 0 };
};

const only = (process.argv.find((a) => a.startsWith("--only=")) || "").replace("--only=", "").split(",").filter(Boolean);
const want = (name) => !only.length || only.includes(name);

const TUNE_FEED = `(async()=>{const {bus}=await import('mf/core/store.js');bus.emit('logs',[
  'Recv: // Retries: 1/5 Probed points range: 0.002500 tolerance: 0.007500',
  'Recv: // probe accuracy results: maximum 2.522500, minimum 2.517500, range 0.005000, average 2.519880, median 2.520000, standard deviation 0.001590',
  'Recv: // Mesh Leveling Probed Z positions:',
  'Recv: //  0.031250 0.018750 0.006250 -0.006250 -0.012500 -0.006250 0.012500',
  'Recv: //  0.025000 0.012500 0.000000 -0.012500 -0.018750 -0.012500 0.006250',
  'Recv: //  0.018750 0.006250 -0.006250 -0.018750 -0.025000 -0.018750 0.000000',
  'Recv: //  0.012500 0.000000 -0.012500 -0.025000 -0.031250 -0.025000 -0.006250',
  'Recv: //  0.018750 0.006250 -0.006250 -0.018750 -0.025000 -0.018750 0.000000',
  'Recv: //  0.025000 0.012500 0.000000 -0.012500 -0.018750 -0.012500 0.006250',
  'Recv: //  0.037500 0.025000 0.012500 0.000000 -0.006250 0.000000 0.018750',
  'Recv: // Mesh X,Y: 7,7']);
  const {parseMesh}=await import('mf/core/klipper.js');
  const lines=['Recv: // Mesh Leveling Probed Z positions:','Recv: //  0.031250 0.018750 0.006250 -0.006250 -0.012500 -0.006250 0.012500','Recv: //  0.025000 0.012500 0.000000 -0.012500 -0.018750 -0.012500 0.006250','Recv: //  0.018750 0.006250 -0.006250 -0.018750 -0.025000 -0.018750 0.000000','Recv: //  0.012500 0.000000 -0.012500 -0.025000 -0.031250 -0.025000 -0.006250','Recv: //  0.018750 0.006250 -0.006250 -0.018750 -0.025000 -0.018750 0.000000','Recv: //  0.025000 0.012500 0.000000 -0.012500 -0.018750 -0.012500 0.006250','Recv: //  0.037500 0.025000 0.012500 0.000000 -0.006250 0.000000 0.018750'];
  const {store}=await import('mf/core/store.js');store.patch('klipper',{mesh:{...parseMesh(lines),at:Date.now()}});})()`;
const TERM_FEED = `(async()=>{const {term}=await import('mf/core/telemetry.js');term.clear();
  term.push(['Send: STATUS','Recv: // Klipper state: Ready','Send: QUAD_GANTRY_LEVEL','Recv: // Gantry-relative probe points:','Recv: // 0: -50.000,-50.000 -> Z 1.850','Recv: // Retries: 0/5 Probed points range: 0.001875 tolerance: 0.007500','Send: BED_MESH_CALIBRATE','Recv: // Mesh Bed Leveling Complete','Send: SHAPER_CALIBRATE AXIS=X',"Recv: // Fitted shaper 'mzv' frequency = 53.8 Hz (vibrations = 1.2%, smoothing ~= 0.128)","Recv: // To avoid too much smoothing with 'mzv', suggested max_accel <= 6400 mm/sec^2",'Recv: // Recommended shaper_type_x = mzv, shaper_freq_x = 53.8 Hz','Send: SET_PRESSURE_ADVANCE ADVANCE=0.042','Recv: ok']);})()`;

// A macro prompt exactly as OctoPrint logs Klipper's RESPOND TYPE=command output.
const PROMPT_FEED = `(async()=>{const {store,bus}=await import('mf/core/store.js');store.patch('klipper',{detected:true});bus.emit('logs',[
  'Recv: // action:prompt_begin Filament runout',
  'Recv: // action:prompt_text The runout sensor tripped on layer 58. Load new filament, then resume.',
  'Recv: // action:prompt_button Unload filament|UNLOAD_FILAMENT',
  'Recv: // action:prompt_button_group_start',
  'Recv: // action:prompt_button Heat to 240°|M104 S240|warning',
  'Recv: // action:prompt_button Purge 50 mm|PURGE LENGTH=50|secondary',
  'Recv: // action:prompt_button_group_end',
  'Recv: // action:prompt_footer_button Cancel print|CANCEL_PRINT|error',
  'Recv: // action:prompt_footer_button Resume|RESUME|primary',
  'Recv: // action:prompt_show']);})()`;

async function startPrintAt(file, pct) {
  fixture("print", file);
  for (let i = 0; i < 160; i++) { const j = await jobProgress(); if (j.state === "Printing" && j.pct >= pct) return; await sleep(400); }
}

try {
  if (["control", "files", "tune", "terminal", "settings"].some(want)) { fixture("cool"); await sleep(500); }
  if (want("control")) await shot("control", { route: "control", ready: "!!document.querySelector('.a-jog .pad')" });
  if (want("files")) await shot("files", { route: "files", ready: "!!document.querySelector('.fcard[data-path]')", settle: 2200 });
  // The virtual printer isn't Klipper, so the Tune screen is fed text formatted exactly as Klipper's source prints it.
  if (want("tune")) await shot("tune", { route: "tune", height: 1500, ready: "!!document.querySelector('.tune-grid .panel')", after: TUNE_FEED, settle: 1800 });
  if (want("terminal")) await shot("terminal", { route: "terminal", ready: "!!document.querySelector('.term-log .tl')", after: TERM_FEED });
  if (want("settings")) await shot("settings", { route: "settings/appearance", ready: "!!document.querySelector('.theme-card')" });

  if (want("theme-voron")) {
    fixture("heat", "215", "60"); await sleep(9000);
    await shot("theme-voron", { route: "print", theme: "voron", ready: "!!document.querySelector('.a-stage .machine')", settle: 2200 });
  }
  if (["dashboard", "toolpath", "mobile-print", "kiosk", "prompt"].some(want)) {
    fixture("heat", "215", "60"); await sleep(9000);   // hot before the print starts, like a real one
    await startPrintAt("twisted-vase-orca.gcode", 22);
    if (want("dashboard")) await shot("dashboard", { route: "print", height: 1760, ready: "!!document.querySelector('.a-job .job-bar')", settle: 1200 });
    if (want("toolpath")) await shot("toolpath", { route: "print", height: 1240, ready: "!!document.querySelector('.a-job .job-bar')", after: "document.querySelector('[data-mode=toolpath]').click()", settle: 5000 });
    if (want("mobile-print")) await shot("mobile-print", { route: "print", width: 390, height: 844, dpr: 3, mobile: true, ready: "!!document.querySelector('.a-job .job-bar')", settle: 1200 });
    if (want("kiosk")) await shot("kiosk", { route: "kiosk", ready: "!!document.querySelector('.kiosk:not(.is-idle)')", settle: 1500 });
    if (want("prompt")) await shot("prompt", { route: "print", height: 900, ready: "!!document.querySelector('.a-job .job-bar')", after: PROMPT_FEED, settle: 1200 });
    fixture("cancel"); await sleep(1500); fixture("cool");
  }
} finally {
  try { ws.close(); } catch { /* closed */ }
  chrome.kill();
  await sleep(700);   // let Chrome finish writing before its profile folder goes
  try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch { /* it is in the OS temp folder anyway */ }
}
console.log("done ->", OUT);
