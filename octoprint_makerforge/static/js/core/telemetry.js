// High-frequency data lives outside the store: temperature samples and the terminal log.
// Views subscribe to the change callbacks and read straight from these buffers.

const listeners = (set) => (fn) => { set.add(fn); return () => set.delete(fn); };

// ~~ temperature history ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
const tempSubs = new Set();
export const temps = {
  samples: [],      // [{t: ms epoch, tool0:{a,t}, tool1.., bed:{a,t}, chamber:{a,t}}]
  latest: null,
  maxAgeMs: 2 * 60 * 60 * 1000,
  maxCount: 12000,
  on: listeners(tempSubs),

  /** Accepts OctoPrint's temp entries: {time, tool0:{actual,target}, bed:{...}, chamber:{...}} */
  ingest(entries, skewMs = 0) {
    if (!entries?.length) return;
    for (const e of entries) {
      const s = { t: (e.time || Date.now() / 1000) * 1000 - skewMs };
      for (const [k, v] of Object.entries(e)) {
        if (k === "time" || !v || typeof v !== "object") continue;
        s[k] = { a: v.actual ?? null, t: v.target ?? null };
      }
      const last = this.samples[this.samples.length - 1];
      if (last && s.t <= last.t) continue;   // out of order or duplicate
      this.samples.push(s);
      this.latest = s;
    }
    const cutoff = Date.now() - this.maxAgeMs;
    let drop = 0;
    while (drop < this.samples.length && this.samples[drop].t < cutoff) drop++;
    if (drop) this.samples.splice(0, drop);
    if (this.samples.length > this.maxCount) this.samples.splice(0, this.samples.length - this.maxCount);
    for (const fn of tempSubs) fn(this);
  },
  /** Series names seen so far (tool0, tool1, bed, chamber ...) in a stable display order. */
  series() {
    const seen = new Set();
    for (const s of this.samples.slice(-50)) for (const k of Object.keys(s)) if (k !== "t") seen.add(k);
    return Array.from(seen).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  },
  reset() { this.samples.length = 0; this.latest = null; for (const fn of tempSubs) fn(this); },
};
const rank = (k) => (k.startsWith("tool") ? 0 : k === "bed" ? 1 : k === "chamber" ? 2 : 3);

// ~~ terminal ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~
const logSubs = new Set();
let lineId = 0;

/** Classify a raw OctoPrint log line so the terminal can colour and filter it. */
export function classify(raw) {
  const isSend = raw.startsWith("Send:");
  const isRecv = raw.startsWith("Recv:");
  const body = isSend ? raw.slice(5).trim() : isRecv ? raw.slice(5).trim() : raw;
  let kind = "sys";
  if (isSend) kind = "send";
  else if (isRecv) {
    if (body.startsWith("!!")) kind = "err";
    else if (body.startsWith("//")) kind = "info";
    else if (/^(ok\b)?\s*(T\d*|B|C):\s*-?\d/.test(body) || /^ok\s+T:/.test(body)) kind = "temp";
    else if (/^ok\b/.test(body)) kind = "ok";
    else if (/^(Error|error)|^Klipper state: Shutdown/.test(body)) kind = "err";
    else kind = "recv";
  } else if (/^(Error|Warning)/i.test(raw)) kind = /^Warning/i.test(raw) ? "warn" : "err";
  return { kind, body, dir: isSend ? "tx" : isRecv ? "rx" : "sys" };
}

// Position reads (M114) and their replies come from the Toolhead and Control screens, often
// every few seconds, and from other open tabs and the log history too. They stay out of the
// terminal unless someone typed M114 themselves (see term.unhide) or turns on "Show background".
export const POSITION_POLL = [/^Send:\s*(N\d+\s+)?M114\b/, /^Recv:\s*(ok\s+)?X:-?[\d.]+\s+Y:-?[\d.]+/];

export const term = {
  lines: [],
  max: 3000,
  silent: false,       // while true, new lines are flagged hidden (background queries like HELP)
  showUntil: 0,        // someone typed M114 by hand: show position replies until then
  on: listeners(logSubs),
  /** The person asked for the position themselves, so show the reply. */
  unhide(ms = 6000) { this.showUntil = Date.now() + ms; },
  typed: [],           // commands someone typed in the terminal or console: [{cmd, at}]
  /** Remember a typed command, so views that hide streamed print G-code still show it. */
  markTyped(text) {
    const now = Date.now();
    this.typed = this.typed.filter((t) => now - t.at < 120000);
    for (const line of String(text).split("\n")) {
      const cmd = line.trim().toUpperCase();
      if (cmd) this.typed.push({ cmd, at: now });
    }
  },
  /** Was this "Send:" line one of the typed commands (and not G-code from the file)? */
  isTyped(line) {
    if (line.kind !== "send" || !this.typed.length) return false;
    const body = line.body.replace(/^N\d+\s+/, "").replace(/\*\d+$/, "").trim().toUpperCase();
    return this.typed.some((t) => line.t >= t.at - 1000 && line.t - t.at < 120000 && body === t.cmd);
  },
  push(rawLines) {
    if (!rawLines?.length) return;
    const now = Date.now();
    const added = [];
    for (const raw of rawLines) {
      const c = classify(String(raw));
      const poll = now > this.showUntil && POSITION_POLL.some((re) => re.test(raw));
      const hidden = (this.silent || poll) && c.kind !== "err";
      const line = { id: ++lineId, t: now, raw, kind: c.kind, body: c.body, dir: c.dir, hidden };
      this.lines.push(line);
      added.push(line);
    }
    if (this.lines.length > this.max) this.lines.splice(0, this.lines.length - this.max);
    for (const fn of logSubs) fn(added, this);
  },
  /** Echo a command we sent ourselves, so it shows up even if OctoPrint's log is throttled. */
  clear() { this.lines.length = 0; for (const fn of logSubs) fn(null, this); },
};
