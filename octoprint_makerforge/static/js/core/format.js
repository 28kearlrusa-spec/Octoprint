// Number, time and size formatting. Everything returns plain strings; "–" means "no data".

export const DASH = "–";
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

export function num(v, digits = 0) {
  return isNum(v) ? v.toFixed(digits) : DASH;
}

/** 4930 -> "1h 22m", 75 -> "1m 15s", 40 -> "40s". compact drops the small unit for long spans. */
export function duration(sec, { long = false } = {}) {
  if (!isNum(sec) || sec < 0) return DASH;
  sec = Math.round(sec);
  const d = Math.floor(sec / 86400);
  const hr = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (long) {
    const parts = [];
    if (d) parts.push(`${d}d`);
    if (hr) parts.push(`${hr}h`);
    if (m) parts.push(`${m}m`);
    if (!parts.length || (!d && !hr)) parts.push(`${s}s`);
    return parts.join(" ");
  }
  if (d) return `${d}d ${hr}h`;
  if (hr) return `${hr}h ${String(m).padStart(2, "0")}m`;
  if (m) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

/** 4930 -> "1:22:10" for tight readouts */
export function clockDuration(sec) {
  if (!isNum(sec) || sec < 0) return "--:--:--";
  sec = Math.round(sec);
  const hr = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return `${hr}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function timeOfDay(date) {
  if (!(date instanceof Date) || isNaN(date)) return DASH;
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** "9:42 PM", or "Tomorrow 1:10 AM" / "Thu 6:05 PM" when it lands on another day */
export function finishTime(date, now = new Date()) {
  if (!(date instanceof Date) || isNaN(date)) return DASH;
  const t = timeOfDay(date);
  const startOf = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOf(date) - startOf(now)) / 86400000);
  if (days <= 0) return t;
  if (days === 1) return `Tomorrow ${t}`;
  if (days < 7) return `${date.toLocaleDateString([], { weekday: "short" })} ${t}`;
  return `${date.toLocaleDateString([], { month: "short", day: "numeric" })} ${t}`;
}

export function dateTime(ts) {
  const d = ts instanceof Date ? ts : new Date(ts * 1000);
  if (isNaN(d)) return DASH;
  return d.toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function dateOnly(ts) {
  const d = ts instanceof Date ? ts : new Date(ts * 1000);
  if (isNaN(d)) return DASH;
  return d.toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
}

export function relative(ts, now = Date.now()) {
  const t = ts instanceof Date ? ts.getTime() : ts * 1000;
  const sec = Math.round((now - t) / 1000);
  if (!isNum(sec)) return DASH;
  const abs = Math.abs(sec);
  const fmt = (n, u) => (sec >= 0 ? `${n}${u} ago` : `in ${n}${u}`);
  if (abs < 45) return "just now";
  if (abs < 3600) return fmt(Math.round(abs / 60), "m");
  if (abs < 86400) return fmt(Math.round(abs / 3600), "h");
  if (abs < 86400 * 30) return fmt(Math.round(abs / 86400), "d");
  return dateOnly(t / 1000);
}

export function bytes(n) {
  if (!isNum(n)) return DASH;
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
  return `${n >= 100 || i === 0 ? n.toFixed(0) : n.toFixed(1)} ${u[i]}`;
}

/** mm of filament -> "5.32 m" or "812 mm" */
export function filamentLength(mm) {
  if (!isNum(mm)) return DASH;
  return mm >= 1000 ? `${(mm / 1000).toFixed(2)} m` : `${Math.round(mm)} mm`;
}

/** mm of 1.75mm filament -> grams, using density in g/cm3 */
export function filamentGrams(mm, diameter = 1.75, density = 1.24) {
  if (!isNum(mm)) return null;
  const r = diameter / 2;
  const cm3 = (Math.PI * r * r * mm) / 1000;
  return cm3 * density;
}

export function grams(g) {
  if (!isNum(g)) return DASH;
  return g >= 1000 ? `${(g / 1000).toFixed(2)} kg` : `${g.toFixed(g < 10 ? 1 : 0)} g`;
}

export function temp(v, digits = 0) {
  return isNum(v) ? `${v.toFixed(digits)}°` : DASH;
}

export function percent(v, digits = 0) {
  return isNum(v) ? `${v.toFixed(digits)}%` : DASH;
}

/** "1h 41m 12s" / "6072" / "1:41:12" -> seconds. Returns null when unparseable. */
export function parseDuration(text) {
  if (text == null) return null;
  const s = String(text).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return parseFloat(s);
  let total = 0, hit = false;
  for (const m of s.matchAll(/(\d+(?:\.\d+)?)\s*(d|h|m|s)\b/gi)) {
    hit = true;
    const v = parseFloat(m[1]);
    total += { d: 86400, h: 3600, m: 60, s: 1 }[m[2].toLowerCase()] * v;
  }
  if (hit) return total;
  const c = /^(\d+):(\d{1,2}):(\d{1,2})$/.exec(s);
  if (c) return (+c[1]) * 3600 + (+c[2]) * 60 + (+c[3]);
  return null;
}

export function plural(n, one, many = one + "s") {
  return `${n} ${n === 1 ? one : many}`;
}

export function basename(path) {
  return String(path || "").split("/").pop();
}
export function dirname(path) {
  const p = String(path || "");
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
}
export function stripExt(name) {
  return String(name || "").replace(/\.(gcode|gco|g|nc|stl)$/i, "");
}
