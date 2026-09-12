(function () {
  "use strict";

  function tt(key, fallback) {
    try {
      if (window.MCJI18n && typeof window.MCJI18n.t === "function") {
        var out = window.MCJI18n.t(key);
        if (out && out !== key) return out;
      }
    } catch (e) {}
    return fallback != null ? String(fallback) : String(key || "");
  }

  if (window.MCJModal) return;

  var scrollY = 0;
  var locked = false;

  function ensurePortal() {
    var modal = document.getElementById("modal");
    if (!modal) return null;
    if (modal.parentNode !== document.body) {
      document.body.appendChild(modal);
    }
    modal.setAttribute("data-mcj-portal", "1");
    return modal;
  }

  function lockBodyScroll() {
    if (locked) return;
    locked = true;
    scrollY = window.scrollY || window.pageYOffset || document.documentElement.scrollTop || 0;
    document.documentElement.classList.add("mcj-modal-open");
    document.body.classList.add("mcj-modal-open");
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";
    document.body.style.position = "fixed";
    document.body.style.top = "-" + scrollY + "px";
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.style.width = "100%";
  }

  function unlockBodyScroll() {
    if (!locked) return;
    locked = false;
    document.documentElement.classList.remove("mcj-modal-open");
    document.body.classList.remove("mcj-modal-open");
    document.documentElement.style.overflow = "";
    document.body.style.overflow = "";
    document.body.style.position = "";
    document.body.style.top = "";
    document.body.style.left = "";
    document.body.style.right = "";
    document.body.style.width = "";
    window.scrollTo(0, scrollY);
  }

  function authShell() {
    return window.MCJAuthShell || null;
  }

  function prepareAuthSurface(root, opts) {
    var shell = authShell();
    if (shell && typeof shell.prepareAuthForm === "function") {
      shell.prepareAuthForm(root, opts || { clearAccount: true });
      return;
    }
    if (!root || !root.querySelectorAll) return;
    root.querySelectorAll("input[type='password'], input[autocomplete='one-time-code'], [data-auth-code], #loginOtpCode, #loginGmailCode, #loginCode").forEach(function (el) {
      try {
        el.value = "";
        el.defaultValue = "";
        el.removeAttribute("value");
      } catch (e) {}
    });
  }

  function clearAuthSurface(root) {
    var shell = authShell();
    if (shell && typeof shell.clearAuthFields === "function") {
      shell.clearAuthFields(root || document.getElementById("modalBody"), {
        clearCode: true,
        clearPassword: true,
        clearAccount: true,
      });
      return;
    }
    prepareAuthSurface(root, { clearAccount: true });
  }

  function openModal(html, options) {
    options = options || {};
    var modal = ensurePortal();
    if (!modal) return null;
    var body = document.getElementById("modalBody");
    var dialog = modal.querySelector(".dialog");
    var content = html == null ? "" : String(html);
    if (body && html != null) body.innerHTML = content;
    var isAuth =
      options.auth === true ||
      /boss-login-modal/.test(content) ||
      (body && body.querySelector && !!body.querySelector(".boss-login-modal"));
    if (dialog) {
      dialog.classList.toggle("is-auth-dialog", !!isAuth);
      dialog.scrollTop = 0;
    }
    modal.scrollTop = 0;
    if (body) body.scrollTop = 0;
    modal.classList.add("open");
    try {
      if (window.MCJI18n && typeof window.MCJI18n.apply === "function") window.MCJI18n.apply(modal);
    } catch (eI18n) {}
    lockBodyScroll();
    if (isAuth && body) {
      prepareAuthSurface(body.querySelector(".boss-login-modal") || body, { clearAccount: true });
    }
    return modal;
  }

  function closeModal() {
    var modal = document.getElementById("modal");
    var body = document.getElementById("modalBody");
    if (body && body.querySelector && body.querySelector(".boss-login-modal")) {
      clearAuthSurface(body);
      body.innerHTML = "";
    }
    if (modal) {
      var dialog = modal.querySelector(".dialog");
      if (dialog) dialog.classList.remove("is-auth-dialog");
      modal.classList.remove("open");
    }
    unlockBodyScroll();
  }

  function isBossLoggedIn() {
    try {
      if (window.MCJRoleGate && typeof window.MCJRoleGate.isLogged === "function") {
        if (window.MCJRoleGate.isLogged("boss") || window.MCJRoleGate.isLogged("customer")) return true;
      }
      if (window.MCJBossAuth && typeof window.MCJBossAuth.hasValidAccessToken === "function") {
        return !!window.MCJBossAuth.hasValidAccessToken();
      }
      var token =
        sessionStorage.getItem("mcjAuthAccessToken") || localStorage.getItem("mcjAuthAccessToken") || "";
      return String(token).split(".").length === 3 && token.length > 20;
    } catch (e) {
      return false;
    }
  }

  function openLogin(mode) {
    if (isBossLoggedIn()) {
      closeModal();
      try {
        if (/^#(login|register)$/i.test(location.hash || "")) {
          history.replaceState(null, "", location.pathname + location.search);
        }
      } catch (e) {}
      return null;
    }
    var want = mode === "register" ? "register" : "login";
    var html =
      typeof window.bossLoginHtml === "function"
        ? window.bossLoginHtml(want)
        : '<div class="boss-login-modal" data-auth-mode="login"><h2 data-i18n="auth.login_title">' +
          tt("auth.login_title", "登录 MEOW CUI JIAO") +
          '</h2><p class="muted" data-i18n="auth.login_sub">' +
          tt("auth.login_sub", "邮箱验证码登录（也可使用密码）。") +
          '</p><div class="login-tabs"><button class="login-tab active" type="button" data-login-tab="otp" data-i18n="auth.tab_otp">' +
          tt("auth.tab_otp", "验证码登录") +
          '</button><button class="login-tab" type="button" data-login-tab="email" data-i18n="auth.tab_password">' +
          tt("auth.tab_password", "密码登录") +
          '</button></div><div class="login-panel active" data-login-panel="otp"><label class="wide"><span data-i18n="auth.email">' +
          tt("auth.email", "邮箱") +
          '</span><input id="loginOtpEmail" type="email" inputmode="email" autocomplete="email" placeholder="' +
          tt("auth.email_placeholder", "请输入邮箱") +
          '" data-i18n-placeholder="auth.email_placeholder" value=""></label><label class="wide"><span data-i18n="auth.code">' +
          tt("auth.code", "验证码") +
          '</span><div class="login-code-row"><input id="loginOtpCode" name="otp" type="text" inputmode="numeric" autocomplete="one-time-code" data-auth-code="1" data-auth-sensitive="1" placeholder="' +
          tt("auth.code_placeholder", "6 位验证码") +
          '" data-i18n-placeholder="auth.code_placeholder" maxlength="6" value=""><button class="login-small-btn" type="button" data-send-login-otp data-login-role="boss" data-i18n="auth.get_code">' +
          tt("auth.get_code", "获取验证码") +
          '</button></div></label><button class="login-submit" type="button" data-login-confirm data-login-method="otp" data-i18n="auth.login_otp_submit">' +
          tt("auth.login_otp_submit", "验证码登录") +
          '</button></div><div class="login-panel" data-login-panel="email"><label class="wide"><span data-i18n="auth.email">' +
          tt("auth.email", "邮箱") +
          '</span><input id="loginGmail" type="email" inputmode="email" autocomplete="email" placeholder="' +
          tt("auth.email_placeholder", "请输入邮箱") +
          '" data-i18n-placeholder="auth.email_placeholder" value=""></label><label class="wide"><span data-i18n="auth.password">' +
          tt("auth.password", "密码") +
          '</span><input id="loginGmailCode" type="password" autocomplete="current-password" data-auth-sensitive="1" placeholder="' +
          tt("auth.password_placeholder", "请输入密码") +
          '" data-i18n-placeholder="auth.password_placeholder" value=""></label><button class="login-submit" type="button" data-login-confirm data-login-method="email" data-i18n="auth.login_password_submit">' +
          tt("auth.login_password_submit", "密码登录") +
          '</button></div><p id="loginState" data-login-error></p></div>';
    return openModal(html, { auth: true });
  }

  function handleHashLogin() {
    var hash = String(location.hash || "")
      .replace(/^#/, "")
      .toLowerCase();
    if (hash !== "login" && hash !== "register") return;
    if (isBossLoggedIn()) {
      try {
        history.replaceState(null, "", location.pathname + location.search);
      } catch (e) {}
      return;
    }
    var y = window.scrollY || window.pageYOffset || 0;
    openLogin(hash === "register" ? "register" : "login");
    window.scrollTo(0, y);
  }

  window.MCJModal = {
    ensurePortal: ensurePortal,
    open: openModal,
    close: closeModal,
    openLogin: openLogin,
    lockBodyScroll: lockBodyScroll,
    unlockBodyScroll: unlockBodyScroll,
    prepareAuthSurface: prepareAuthSurface,
    clearAuthSurface: clearAuthSurface,
  };

  function boot() {
    ensurePortal();
    handleHashLogin();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
  window.addEventListener("hashchange", handleHashLogin);
})();
