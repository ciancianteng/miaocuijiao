(function () {
  "use strict";

  if (window.__MCJMeowButlerLoaded) return;
  window.__MCJMeowButlerLoaded = true;

  var ROOT_ID = "floatingCustomerService";
  var CSS_ATTR = "data-mcj-meow-butler-css";
  var BODY_LOCK_CLASS = "mcj-floating-cs-lock";
  var AFTER_LOGIN_KEY = "mcjButlerAfterLogin.v2";
  var LOGO_SRC = "/default-avatar.png";
  var savedScrollY = 0;

  function pagePath() {
    try {
      return decodeURIComponent(location.pathname || "").toLowerCase().replace(/\\/g, "/");
    } catch (e) {
      return String(location.pathname || "").toLowerCase().replace(/\\/g, "/");
    }
  }

  function shouldHide() {
    var path = pagePath();
    return (
      /\/admin(\/|\.html|$)/.test(path) ||
      /\/companion\//.test(path) ||
      /customer-service/.test(path) ||
      /admin-center/.test(path) ||
      /\/report(\/|$)/.test(path)
    );
  }

  function isMobile() {
    return window.matchMedia && window.matchMedia("(max-width: 640px)").matches;
  }

  function ensureCss() {
    if (document.querySelector("link[" + CSS_ATTR + "]")) return;
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "/src/meow-butler.css";
    link.setAttribute(CSS_ATTR, "1");
    document.head.appendChild(link);
  }

  function removeOldWidgets() {
    document.querySelectorAll(
      "#floatingService,.floating-service,.service-float,.online-service,#mcjButler,#mcjButlerModal,#mcjFloatingAssistant,#mcjFloatingAssistantBackdrop,#" + ROOT_ID
    ).forEach(function (el) {
      el.remove();
    });
  }

  function logoImg(className) {
    return (
      '<img class="' + className + '" src="' + LOGO_SRC + '" alt="喵管家" data-mcj-butler-logo="1" decoding="async" />'
    );
  }

  function bindLogoFallback(root) {
    root.querySelectorAll("[data-mcj-butler-logo]").forEach(function (img) {
      img.dataset.fallbackApplied = "1";
      function fail() {
        img.dataset.fallbackApplied = "1";
        img.style.display = "none";
        var parent = img.parentElement;
        if (!parent) return;
        parent.classList.add("is-fallback");
        if (parent.classList.contains("floating-cs-head-logo") && !parent.querySelector(".floating-cs-head-fallback")) {
          var span = document.createElement("span");
          span.className = "floating-cs-head-fallback";
          span.textContent = "喵";
          parent.appendChild(span);
        }
      }
      img.addEventListener("error", fail);
      if (img.complete && img.naturalWidth === 0) fail();
    });
  }

  function currentCustomer() {
    if (window.MCJRoleGate && window.MCJRoleGate.isLogged && window.MCJRoleGate.isLogged("customer")) {
      return window.MCJRoleGate.user("customer") || {};
    }
    if (localStorage.getItem("mcjLoggedIn") === "1") {
      try {
        return JSON.parse(localStorage.getItem("mcjCurrentUser") || "{}") || {};
      } catch (e) {
        return {};
      }
    }
    if (localStorage.getItem("customerAuthToken")) {
      try {
        return JSON.parse(localStorage.getItem("customerUser") || "{}") || {};
      } catch (e2) {
        return {};
      }
    }
    return null;
  }

  function isLoggedIn() {
    return Boolean(currentCustomer());
  }

  function triggerLogin(intent) {
    sessionStorage.setItem(AFTER_LOGIN_KEY, JSON.stringify(intent || {}));
    window.dispatchEvent(new CustomEvent("mcj:open-login", { detail: { source: "meow-butler", intent: intent || {} } }));
    var trigger = document.querySelector('.top-actions .login[data-modal="login"],[data-customer-login],[data-modal="login"],[data-login]');
    if (trigger) {
      trigger.click();
      return;
    }
    if (!/index\.html$|\/$/.test(location.pathname)) {
      location.href = "/index.html#login";
    }
  }

  function runIntent(intent) {
    if (!intent) return;
    if (intent.type === "chat") {
      openChat();
      return;
    }
    if (intent.href) {
      location.href = intent.href;
    }
  }

  function requireLogin(intent) {
    if (isLoggedIn()) {
      runIntent(intent);
      return;
    }
    triggerLogin(intent);
  }

  async function openChat() {
    if (!isLoggedIn()) {
      triggerLogin({ type: "chat" });
      return;
    }
    location.href = "support.html?start=1";
  }

  function takePendingIntent() {
    var raw = sessionStorage.getItem(AFTER_LOGIN_KEY);
    if (!raw || !isLoggedIn()) return null;
    sessionStorage.removeItem(AFTER_LOGIN_KEY);
    try {
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function buildWidget() {
    var root = document.createElement("div");
    root.id = ROOT_ID;
    root.dataset.csOpen = "false";
    root.setAttribute("data-mcj-meow-butler", "1");
    root.innerHTML = [
      '<button class="floating-cs-button" type="button" aria-label="打开喵管家" title="喵管家">',
      logoImg("floating-cs-button-logo"),
      '<span class="floating-cs-button-fallback" aria-hidden="true">喵</span>',
      "</button>",
      '<section class="floating-cs-panel" role="dialog" aria-label="喵管家在线客服" aria-modal="true" tabindex="-1">',
      '<header class="floating-cs-head">',
      '<span class="floating-cs-head-logo">' + logoImg("floating-cs-head-logo-img") + "</span>",
      '<div class="floating-cs-title"><h3>喵管家</h3><p>在线客服</p></div>',
      '<button class="floating-cs-icon-btn" type="button" data-floating-cs-close aria-label="关闭喵管家">×</button>',
      "</header>",
      '<div class="floating-cs-body">',
      '<div class="floating-cs-message"><strong>您好，我是喵管家</strong>请问有什么可以帮您？</div>',
      '<nav class="floating-cs-actions" aria-label="喵管家快捷入口">',
      '<button class="floating-cs-action" type="button" data-floating-cs-action="chat">联系人工客服 <span aria-hidden="true">›</span></button>',
      '<button class="floating-cs-action" type="button" data-floating-cs-action="orders">订单问题 <span aria-hidden="true">›</span></button>',
      '<button class="floating-cs-action" type="button" data-floating-cs-action="recharge">猫粮充值问题 <span aria-hidden="true">›</span></button>',
      '<button class="floating-cs-action" type="button" data-floating-cs-action="refunds">退款与售后 <span aria-hidden="true">›</span></button>',
      "</nav>",
      "</div>",
      '<footer class="floating-cs-foot">客服入口会连接当前账号的聊天、订单、猫粮充值和售后流程。</footer>',
      "</section>"
    ].join("");
    return root;
  }

  function lockBodyScroll() {
    if (!isMobile() || document.body.classList.contains(BODY_LOCK_CLASS)) return;
    savedScrollY = window.scrollY || document.documentElement.scrollTop || 0;
    document.body.classList.add(BODY_LOCK_CLASS);
    document.documentElement.classList.add(BODY_LOCK_CLASS);
  }

  function unlockBodyScroll() {
    if (!document.body.classList.contains(BODY_LOCK_CLASS)) return;
    var restoreY = savedScrollY || 0;
    document.body.classList.remove(BODY_LOCK_CLASS);
    document.documentElement.classList.remove(BODY_LOCK_CLASS);
    window.scrollTo(0, restoreY);
  }

  function closePanel(root, button) {
    root.dataset.csOpen = "false";
    unlockBodyScroll();
    if (button) button.focus({ preventScroll: true });
  }

  function openPanel(root) {
    root.dataset.csOpen = "true";
    lockBodyScroll();
    var panel = root.querySelector(".floating-cs-panel");
    if (panel) {
      window.setTimeout(function () {
        panel.focus({ preventScroll: true });
      }, 30);
    }
  }

  /** Mount to document.body — equivalent to a React portal (avoids transform/overflow ancestors). */
  function mountToBody(node) {
    if (!document.body) return;
    document.body.appendChild(node);
  }

  function init() {
    removeOldWidgets();
    if (shouldHide()) return;

    ensureCss();

    var root = buildWidget();
    var button = root.querySelector(".floating-cs-button");
    mountToBody(root);
    bindLogoFallback(root);

    button.addEventListener("click", function (event) {
      event.preventDefault();
      event.stopPropagation();
      if (root.dataset.csOpen === "true") {
        closePanel(root, button);
      } else {
        openPanel(root);
      }
    });

    root.addEventListener("click", function (event) {
      var close = event.target.closest("[data-floating-cs-close]");
      if (close) {
        event.preventDefault();
        closePanel(root, button);
        return;
      }

      var action = event.target.closest("[data-floating-cs-action]");
      if (!action) return;
      event.preventDefault();

      var type = action.getAttribute("data-floating-cs-action");
      if (type === "chat") requireLogin({ type: "chat" });
      if (type === "orders") requireLogin({ href: "orders.html" });
      if (type === "recharge") requireLogin({ href: "recharge.html" });
      if (type === "refunds") requireLogin({ href: "orders.html?tab=refunds" });
    });

    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && root.dataset.csOpen === "true") {
        closePanel(root, button);
      }
    });

    window.addEventListener("resize", function () {
      if (root.dataset.csOpen !== "true") return;
      if (isMobile()) lockBodyScroll();
      else unlockBodyScroll();
    });

    document.addEventListener("click", function (event) {
      if (event.target && event.target.closest && event.target.closest("[data-login-confirm]")) {
        window.setTimeout(function () {
          var pending = takePendingIntent();
          if (pending) runIntent(pending);
        }, 150);
      }
    });

    window.addEventListener("mcj:login-success", function () {
      var pending = takePendingIntent();
      if (pending) runIntent(pending);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
