(function () {
  "use strict";

  if (window.__MCJLoginPortalBooted) return;
  window.__MCJLoginPortalBooted = true;

  var scrollY = 0;
  var locked = false;
  var pendingAction = null;
  var closeBound = false;

  function ensureCss() {
    if (document.querySelector('link[data-mcj-login-modal-css]')) return;
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/src/login-modal.css";
    link.setAttribute("data-mcj-login-modal-css", "1");
    (document.head || document.documentElement).appendChild(link);
  }

  function defaultBossLoginHtml(mode) {
    mode = mode === "register" ? "register" : "login";
    var loginPanel =
      '<div class="login-panel' +
      (mode === "login" ? " active" : "") +
      '" data-login-panel="email" data-auth-panel="login"><label class="wide">邮箱<input id="loginGmail" type="email" autocomplete="username" placeholder="请输入邮箱"></label><label class="wide">密码<input id="loginGmailCode" type="password" autocomplete="current-password" placeholder="请输入密码"></label><button class="login-submit" type="button" data-login-confirm data-login-method="email">登录</button></div>';
    var registerPanel =
      '<div class="login-panel' +
      (mode === "register" ? " active" : "") +
      '" data-login-panel="register" data-auth-panel="register"><label class="wide">昵称<input id="registerNickname" type="text" autocomplete="nickname" placeholder="请输入昵称" maxlength="40"></label><label class="wide">邮箱<input id="registerEmail" type="email" autocomplete="email" placeholder="请输入邮箱"></label><label class="wide">密码<input id="registerPassword" type="password" autocomplete="new-password" placeholder="至少 6 位密码"></label><label class="wide">确认密码<input id="registerPasswordConfirm" type="password" autocomplete="new-password" placeholder="再次输入密码"></label><button class="login-submit" type="button" data-register-confirm>注册</button></div>';
    var links =
      mode === "register"
        ? '<div class="login-links"><button class="linkish" type="button" data-switch-auth="login">已有账号？立即登录</button></div>'
        : '<div class="login-links"><a href="mine.html?forgot=1">忘记密码</a><button class="linkish" type="button" data-switch-auth="register">还没有账号？立即注册</button></div>';
    return (
      '<div class="boss-login-modal" data-auth-mode="' +
      mode +
      '"><h2>' +
      (mode === "register" ? "注册老板账号" : "登录 MEOW CUI JIAO") +
      "</h2><p class=\"muted\">" +
      (mode === "register" ? "注册成功后将自动登录，并生成唯一老板 UID。" : "邮箱密码登录，支持注册新账号。") +
      "</p>" +
      loginPanel +
      registerPanel +
      '<p id="loginState" data-login-error></p>' +
      links +
      "</div>"
    );
  }

  if (typeof window.bossLoginHtml !== "function") {
    window.bossLoginHtml = defaultBossLoginHtml;
  }

  function ensurePortal() {
    ensureCss();
    var modal = document.getElementById("modal");
    if (!modal) {
      modal = document.createElement("div");
      modal.className = "modal";
      modal.id = "modal";
      modal.setAttribute("aria-hidden", "true");
      modal.innerHTML =
        '<div class="dialog"><button class="close" data-close type="button" aria-label="关闭">×</button><div id="modalBody"></div></div>';
      (document.body || document.documentElement).appendChild(modal);
    }
    if (modal.parentNode !== document.body && document.body) {
      document.body.appendChild(modal);
    }
    modal.setAttribute("data-mcj-portal", "1");
    if (!closeBound) {
      closeBound = true;
      document.addEventListener(
        "click",
        function (event) {
          var modalEl = document.getElementById("modal");
          if (!modalEl || !modalEl.classList.contains("open")) return;
          var closeBtn = event.target && event.target.closest && event.target.closest("[data-close]");
          if (closeBtn && modalEl.contains(closeBtn)) {
            event.preventDefault();
            clearPending();
            closeModal();
            return;
          }
          if (event.target === modalEl) {
            clearPending();
            closeModal();
          }
        },
        true
      );
    }
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

  function scrollAuthFieldIntoView(target) {
    if (!target || !target.closest) return;
    var dialog = target.closest(".dialog.is-auth-dialog, .dialog:has(.boss-login-modal)");
    if (!dialog) dialog = document.querySelector("#modal .dialog.is-auth-dialog");
    if (!dialog) return;
    try {
      target.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
    } catch (e) {
      try {
        target.scrollIntoView(true);
      } catch (e2) {}
    }
    setTimeout(function () {
      if (!dialog) return;
      var max = dialog.scrollHeight - dialog.clientHeight;
      if (max > 0 && dialog.scrollTop > max) dialog.scrollTop = max;
    }, 320);
  }

  function bindAuthScrollHelpers(modal) {
    if (!modal || modal.getAttribute("data-auth-scroll-bound") === "1") return;
    modal.setAttribute("data-auth-scroll-bound", "1");
    modal.addEventListener(
      "focusin",
      function (event) {
        var t = event.target;
        if (!t || !/INPUT|SELECT|TEXTAREA/.test(t.tagName || "")) return;
        if (!modal.classList.contains("open")) return;
        setTimeout(function () {
          scrollAuthFieldIntoView(t);
        }, 50);
      },
      true
    );
    if (window.visualViewport) {
      window.visualViewport.addEventListener("resize", function () {
        if (!modal.classList.contains("open")) return;
        var active = document.activeElement;
        if (active && modal.contains(active) && /INPUT|SELECT|TEXTAREA/.test(active.tagName || "")) {
          scrollAuthFieldIntoView(active);
        }
      });
    }
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
    modal.setAttribute("aria-hidden", "false");
    lockBodyScroll();
    if (isAuth) bindAuthScrollHelpers(modal);
    return modal;
  }

  function closeModal() {
    var modal = document.getElementById("modal");
    if (modal) {
      modal.classList.remove("open");
      modal.setAttribute("aria-hidden", "true");
    }
    unlockBodyScroll();
  }

  function openLogin(mode) {
    var html =
      typeof window.bossLoginHtml === "function"
        ? window.bossLoginHtml(mode === "register" ? "register" : "login")
        : defaultBossLoginHtml(mode);
    return openModal(html, { auth: true });
  }

  function isBossLoggedIn() {
    if (window.MCJRoleGate && typeof window.MCJRoleGate.isLogged === "function") {
      if (window.MCJRoleGate.isLogged("customer") || window.MCJRoleGate.isLogged("boss")) return true;
    }
    var token =
      localStorage.getItem("mcjAuthAccessToken") ||
      sessionStorage.getItem("mcjAuthAccessToken") ||
      localStorage.getItem("customerAuthToken") ||
      sessionStorage.getItem("customerAuthToken") ||
      "";
    if (!token) return false;
    var role = localStorage.getItem("mcjRole") || sessionStorage.getItem("mcjRole") || "";
    if (role && !/^(boss|customer|owner|user)$/i.test(role)) return false;
    return true;
  }

  function setPending(fn) {
    pendingAction = typeof fn === "function" ? fn : null;
  }

  function clearPending() {
    pendingAction = null;
  }

  function hasPending() {
    return typeof pendingAction === "function";
  }

  function consumePending() {
    var fn = pendingAction;
    pendingAction = null;
    return fn;
  }

  function runPending() {
    var fn = consumePending();
    if (!fn) return false;
    setTimeout(function () {
      try {
        fn();
      } catch (err) {
        try {
          console.error("[MCJAuthContinue] pending action failed", err);
        } catch (e) {}
      }
    }, 0);
    return true;
  }

  /**
   * If logged in: return true (caller continues). Does NOT run onSuccess.
   * If not: stash onSuccess, open login modal in-place, return false.
   * Login success (role-gates afterAuthSuccess) closes modal and runs onSuccess.
   */
  function requireLogin(onSuccess, opts) {
    opts = opts || {};
    if (isBossLoggedIn()) return true;
    if (typeof onSuccess === "function") setPending(onSuccess);
    openLogin(opts.mode === "register" ? "register" : "login");
    return false;
  }

  function handleHashLogin() {
    var hash = String(location.hash || "")
      .replace(/^#/, "")
      .toLowerCase();
    if (hash !== "login" && hash !== "register") return;
    var y = window.scrollY || window.pageYOffset || 0;
    openLogin(hash === "register" ? "register" : "login");
    window.scrollTo(0, y);
  }

  function handleQueryLogin() {
    try {
      var q = new URLSearchParams(location.search || "");
      if (q.get("login") === "1" || q.get("login") === "true") {
        openLogin(q.get("mode") === "register" ? "register" : "login");
      }
    } catch (e) {}
  }

  if (!window.MCJModal) {
    window.MCJModal = {
      ensurePortal: ensurePortal,
      open: openModal,
      close: closeModal,
      openLogin: openLogin,
      lockBodyScroll: lockBodyScroll,
      unlockBodyScroll: unlockBodyScroll,
      bossLoginHtml: defaultBossLoginHtml,
    };
  } else {
    window.MCJModal.ensurePortal = ensurePortal;
    window.MCJModal.open = openModal;
    window.MCJModal.close = closeModal;
    window.MCJModal.openLogin = openLogin;
    window.MCJModal.lockBodyScroll = lockBodyScroll;
    window.MCJModal.unlockBodyScroll = unlockBodyScroll;
    window.MCJModal.bossLoginHtml = defaultBossLoginHtml;
  }

  window.MCJAuthContinue = {
    isLoggedIn: isBossLoggedIn,
    requireLogin: requireLogin,
    setPending: setPending,
    clearPending: clearPending,
    hasPending: hasPending,
    consumePending: consumePending,
    runPending: runPending,
    openLogin: openLogin,
  };

  window.loginRequiredModal = function () {
    openLogin("login");
  };

  function boot() {
    ensurePortal();
    handleHashLogin();
    handleQueryLogin();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
  window.addEventListener("hashchange", handleHashLogin);
})();
