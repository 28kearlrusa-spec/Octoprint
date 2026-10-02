// The Claude button: opens claude.ai in a window docked to the right edge of the screen.
// claude.ai refuses to be shown inside another site's page (X-Frame-Options), so a side window
// is as close to a built-in panel as a browser allows. It is the full claude.ai, with this
// browser's own sign-in, chats and Claude Code sessions. Off unless turned on in Settings,
// and the choice is kept in this browser only.
const URLS = { code: "https://claude.ai/code", chat: "https://claude.ai/new" };

export function openClaude(kind = "code") {
  const url = URLS[kind] || URLS.code;
  const sw = screen.availWidth || window.innerWidth;
  const sh = screen.availHeight || window.innerHeight;
  const w = Math.round(Math.min(640, Math.max(420, sw * 0.34)));
  const left = (screen.availLeft || 0) + sw - w;
  const top = screen.availTop || 0;
  // phones and tablets ignore the size and open a tab, which is the right thing there
  window.open(url, "makerprint-claude", `popup=yes,noopener,width=${w},height=${sh},left=${left},top=${top}`);
}

export const claudeEnabled = (value) => value === "code" || value === "chat";
