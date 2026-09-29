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

export const term = {
  lines: [],
  max: 3000,
  silent: false,       // while true, new lines are flagged hidden (background queries like HELP)
  on: listeners(logSubs),
  push(rawLines) {
    if (!rawLines?.length) return;
    const now = Date.now();
    const added = [];
    for (const raw of rawLines) {
      const c = classify(String(raw));
      const line = { id: ++lineId, t: now, raw, kind: c.kind, body: c.body, dir: c.dir, hidden: this.silent && c.kind !== "err" };
      this.lines.push(line);
      added.push(line);
    }
    if (this.lines.length > this.max) this.lines.splice(0, this.lines.length - this.max);
    for (const fn of logSubs) fn(added, this);
  },
  /** Echo a command we sent ourselves, so it shows up even if OctoPrint's log is throttled. */
  clear() { this.lines.length = 0; for (const fn of logSubs) fn(null, this); },
};
