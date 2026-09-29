// Sign-in screen. The logo wall is your banner, untouched, fading into the form.
import { html, raw, refs } from "mf/core/dom.js";
import { icon } from "mf/ui/icons.js";
import { boot } from "mf/core/api.js";
import { signIn } from "mf/core/auth.js";

/** Renders the login card into `root`. Resolves when the user is signed in. */
export function showLogin(root, { message = "" } = {}) {
  return new Promise((resolve) => {
    const el = html`
      <div class="login">
        <form class="login-card cut" novalidate>
          <div class="login-banner"><img src="${boot.staticBase}/img/logo-banner.jpg" alt="MakerForge" width="1600" height="399"></div>
          <div class="login-body">
            <div>
              <h1>Sign in to your printer</h1>
              <p class="muted" style="margin-top:4px">Use your OctoPrint account.</p>
            </div>
            <div class="login-error" data-ref="err" role="alert" ${message ? "" : "hidden"}>${message}</div>
            <div class="field">
              <label for="lg-user">Username</label>
              <input class="input" id="lg-user" name="username" data-ref="user" autocomplete="username" autocapitalize="off" spellcheck="false" autofocus required>
            </div>
            <div class="field">
              <label for="lg-pass">Password</label>
              <div class="pw-wrap">
                <input class="input" id="lg-pass" name="password" data-ref="pass" type="password" autocomplete="current-password" required>
                <button type="button" class="btn btn-ghost btn-icon btn-sm" data-ref="peek" aria-label="Show password">${raw(icon("eye"))}</button>
              </div>
            </div>
            <label class="check"><input type="checkbox" data-ref="remember" checked> Keep me signed in on this device</label>
            <button class="btn btn-primary btn-lg btn-block" type="submit" data-ref="go">Sign in</button>
            <div class="login-foot">
              <a class="link" href="${boot.classicUrl}">Use the classic OctoPrint UI</a>
              <span>MakerForge ${boot.version}</span>
            </div>
          </div>
        </form>
      </div>`;
    const r = refs(el);
    root.replaceChildren(el);
    root.hidden = false;

    r.peek.addEventListener("click", () => {
      const show = r.pass.type === "password";
      r.pass.type = show ? "text" : "password";
      r.peek.innerHTML = icon(show ? "eye-off" : "eye");
      r.peek.setAttribute("aria-label", show ? "Hide password" : "Show password");
    });

    el.querySelector("form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const user = r.user.value.trim();
      const pass = r.pass.value;
      if (!user || !pass) {
        r.err.textContent = !user ? "Enter your username." : "Enter your password.";
        r.err.hidden = false;
        (!user ? r.user : r.pass).focus();
        return;
      }
      r.go.classList.add("is-busy");
      r.err.hidden = true;
      const res = await signIn(user, pass, r.remember.checked);
      r.go.classList.remove("is-busy");
      if (res.ok) { resolve(res); return; }
      r.err.textContent = res.message;
      r.err.hidden = false;
      r.pass.select();
    });
  });
}
