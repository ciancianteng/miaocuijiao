(function () {
  "use strict";

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
    lockBodyScroll();
    return modal;
  }

  function closeModal() {
    var modal = document.getElementById("modal");
    if (modal) modal.classList.remove("open");
    unlockBodyScroll();
  }

  function openLogin(mode) {
    var html =
      typeof window.bossLoginHtml === "function"
        ? window.bossLoginHtml(mode === "register" ? "register" : "login")
        : '<div class="boss-login-modal"><h2>登录 MEOW CUI JIAO</h2><button class="login-submit" type="button" data-login-confirm>登录</button></div>';
    return openModal(html, { auth: true });
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

  window.MCJModal = {
    ensurePortal: ensurePortal,
    open: openModal,
    close: closeModal,
    openLogin: openLogin,
    lockBodyScroll: lockBodyScroll,
    unlockBodyScroll: unlockBodyScroll,
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
