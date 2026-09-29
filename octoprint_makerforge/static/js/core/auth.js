// Sign-in state. OctoPrint owns the session cookie; we only ask who we are.
import { store, bus } from "mf/core/store.js";
import { octo, ApiError, setSessionLive } from "mf/core/api.js";

function apply(me, authorised) {
  const roles = new Set(me?.needs?.role || []);
  if (me?.admin) roles.add("admin");
  store.set("auth", {
    ready: true,
    loggedIn: !!me?.name,
    authorised,
    name: me?.name || null,
    admin: !!me?.admin,
    groups: me?.groups || me?.needs?.group || [],
    roles: Array.from(roles),
    session: me?.session || null,
  });
  setSessionLive(authorised);
}

/** Works out who we are and whether we may look at the printer at all. */
export async function bootstrap() {
  // any response from the server plants the CSRF cookie the POSTs below need
  await octo.version().catch(() => null);
  let me = null;
  try { me = await octo.passive(); } catch (e) { me = null; }
  let authorised = false;
  try { await octo.version(); authorised = true; } catch (e) { authorised = false; }
  apply(me, authorised);
  return { authorised, me };
}

export async function signIn(user, pass, remember) {
  try {
    const me = await octo.login(user, pass, remember);
    apply(me, true);
    return { ok: true, me };
  } catch (e) {
    if (e instanceof ApiError) {
      if (e.status === 403 && e.body?.mfa) return { ok: false, mfa: true, message: "This account uses two-factor login. Sign in with the classic UI, then come back." };
      if (e.status === 403) return { ok: false, message: "That username and password don't match." };
      if (e.status === 429) return { ok: false, message: "Too many attempts. Wait a minute, then try again." };
    }
    return { ok: false, message: e.message || "Sign-in failed." };
  }
}

export async function signOut() {
  try { await octo.logout(); } catch { /* already gone */ }
  setSessionLive(false);
  store.set("auth", { ready: true, loggedIn: false, authorised: false, name: null, admin: false, groups: [], roles: [], session: null });
  bus.emit("auth:out");
}

/** Does the current user hold this OctoPrint permission role? e.g. can("control") */
export function can(role) {
  const a = store.get("auth");
  if (!a) return false;
  if (a.admin) return true;
  return a.roles.includes(role.toLowerCase());
}
