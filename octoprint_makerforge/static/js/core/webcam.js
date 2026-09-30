// Works out which webcam stream to show. OctoPrint 1.10+ keeps the URLs in the classic webcam
// plugin's settings; older versions use webcam.streamUrl. The shared MakerPrint config can
// override both (useful when the camera lives behind a different port or proxy).
import { store } from "mf/core/store.js";
import { config } from "mf/core/config.js";
import { BASE } from "mf/core/api.js";

function resolve(u) {
  if (!u) return "";
  if (/^(https?:)?\/\//i.test(u)) return u;
  if (u.startsWith("/")) return `${BASE}${u}`.replace(/^\/\//, "/");
  return u;
}

export function webcamInfo() {
  const s = store.get("settings");
  const override = config.data.webcam || {};
  const classic = s?.plugins?.classicwebcam || {};
  const legacy = s?.webcam || {};
  const stream = override.streamUrl || classic.stream || legacy.streamUrl || "";
  const snapshot = override.snapshotUrl || classic.snapshot || legacy.snapshotUrl || "";
  const hasOverride = !!(override.streamUrl || override.rotate || override.flipH || override.flipV);
  return {
    stream: resolve(stream),
    snapshot: resolve(snapshot),
    configured: !!stream,
    flipH: hasOverride ? !!override.flipH : !!(classic.flipH ?? legacy.flipH),
    flipV: hasOverride ? !!override.flipV : !!(classic.flipV ?? legacy.flipV),
    rotate: hasOverride && override.rotate != null ? override.rotate : ((classic.rotate90 ?? legacy.rotate90) ? 90 : 0),
    ratio: classic.streamRatio || legacy.streamRatio || "16:9",
    isMjpeg: !/\.(m3u8|mp4|webm)(\?|$)/i.test(stream) && !/webrtc/i.test(stream),
    isHls: /\.m3u8(\?|$)/i.test(stream),
    isWebrtc: /webrtc/i.test(stream),
  };
}

/** CSS transform for the configured flips/rotation. */
export function webcamTransform(info) {
  const t = [];
  if (info.rotate) t.push(`rotate(${info.rotate}deg)`);
  if (info.flipH) t.push("scaleX(-1)");
  if (info.flipV) t.push("scaleY(-1)");
  return t.join(" ") || "none";
}

/** Adds a cache-busting query so the browser re-requests a snapshot or restarts a stream. */
export function bust(url) {
  return url + (url.includes("?") ? "&" : "?") + "_=" + Date.now();
}
