// Turns OctoPrint events into things people notice: toasts, a chime, the tab title.
import { store, bus } from "mf/core/store.js";
import { toast } from "mf/ui/toast.js";
import { prefs } from "mf/core/prefs.js";
import { duration } from "mf/core/format.js";

let audio = null;

/** A short two-note chime made with WebAudio, so no sound file has to ship. */
export function chime(kind = "done") {
  if (!prefs.get("sound")) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === "suspended") audio.resume();
    const notes = kind === "fail" ? [392, 294] : kind === "attention" ? [660, 660] : [523.25, 783.99];
    const t0 = audio.currentTime;
    notes.forEach((f, i) => {
      const o = audio.createOscillator();
      const g = audio.createGain();
      o.type = "sine";
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0 + i * 0.16);
      g.gain.exponentialRampToValueAtTime(0.16, t0 + i * 0.16 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.16 + 0.5);
      o.connect(g).connect(audio.destination);
      o.start(t0 + i * 0.16);
      o.stop(t0 + i * 0.16 + 0.55);
    });
  } catch { /* audio blocked until the first tap: fine */ }
}

const name = (p) => (p?.name || p?.path || "the print").replace(/\.(gcode|gco|g)$/i, "");

export function initEvents() {
  bus.on("event:PrintDone", (p) => {
    toast.ok("Print finished", `${name(p)} took ${duration(p?.time)}.`, { timeout: 0 });
    chime("done");
  });
  bus.on("event:PrintFailed", (p) => {
    toast.err("Print failed", `${name(p)}${p?.reason ? ` (${p.reason})` : ""}`);
    chime("fail");
  });
  bus.on("event:PrintCancelled", (p) => toast.warn("Print cancelled", name(p)));
  bus.on("event:PrintPaused", (p) => toast.info("Print paused", name(p)));
  bus.on("event:PrintResumed", (p) => toast.info("Print resumed", name(p)));
  bus.on("event:PrintStarted", (p) => toast.ok("Print started", name(p)));
  bus.on("event:Connected", (p) => toast.ok("Printer connected", p?.port ? `${p.port} at ${p.baudrate || "auto"}` : ""));
  bus.on("event:Disconnected", () => toast.warn("Printer disconnected"));
  bus.on("event:Error", (p) => toast.err("Printer error", p?.error || ""));
  bus.on("event:UpdatedFiles", () => bus.emit("files:changed"));
  bus.on("event:FileAdded", () => bus.emit("files:changed"));
  bus.on("event:FileRemoved", () => bus.emit("files:changed"));
  bus.on("event:FolderAdded", () => bus.emit("files:changed"));
  bus.on("event:FolderRemoved", () => bus.emit("files:changed"));
  bus.on("event:MetadataAnalysisFinished", () => bus.emit("files:changed"));
  bus.on("event:MovieDone", (p) => toast.ok("Timelapse ready", p?.movie_basename || ""));
  bus.on("event:MovieFailed", (p) => toast.err("Timelapse failed", p?.returncode != null ? `ffmpeg exited with code ${p.returncode}` : ""));
}
