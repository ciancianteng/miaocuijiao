(function () {
  "use strict";

  var ROOT_ID = "floatingCustomerService";
  var STYLE_ID = "floatingCustomerServiceStyle";
  var BODY_LOCK_CLASS = "mcj-floating-cs-lock";
  var AFTER_LOGIN_KEY = "mcjButlerAfterLogin.v2";
  var savedScrollY = 0;

  function pagePath() {
    try {
      return decodeURIComponent(location.pathname || "").toLowerCase();
    } catch (e) {
      return String(location.pathname || "").toLowerCase();
    }
  }

  function shouldHide() {
    var path = pagePath();
    return /\/admin\/|\/companion\/|customer-service|admin-center/.test(path);
  }

  function isMobile() {
    return window.matchMedia && window.matchMedia("(max-width: 640px)").matches;
  }

  function removeOldWidgets() {
    document.querySelectorAll(
      "#floatingService,.floating-service,.service-float,.online-service,#mcjButler,#mcjButlerModal,#mcjFloatingAssistant,#mcjFloatingAssistantBackdrop,#" + ROOT_ID
    ).forEach(function (el) {
      el.remove();
    });
  }

  function assistantLogo(extraClass) {
    var cls = ["floating-cs-ai-logo", extraClass || ""].join(" ").trim();
    return [
      '<svg class="' + cls + '" viewBox="0 0 64 64" role="img" aria-label="喵管家 Meow Assistant" focusable="false">',
      '<path class="logo-halo" d="M17 31c0-7.8 4.5-13.9 11.1-16.1L32 9.5l3.9 5.4C42.5 17.1 47 23.2 47 31v8.4c0 8.6-6.5 14.6-15 14.6h-6.1l-7.2 4.4 1.5-6.7C16.2 49.1 14 44.7 14 39.4V31Z"/>',
      '<path class="logo-face" d="M17 31c0-7.8 4.5-13.9 11.1-16.1L32 9.5l3.9 5.4C42.5 17.1 47 23.2 47 31v8.4c0 8.6-6.5 14.6-15 14.6h-6.1l-7.2 4.4 1.5-6.7C16.2 49.1 14 44.7 14 39.4V31Z"/>',
      '<path class="logo-whisker" d="M22.8 36.3H8.6M23 41.2 10.9 44M41.2 36.3h14.2M41 41.2 53.1 44"/>',
      '<path class="logo-bubble" d="M39.5 18.2h8c3.4 0 5.8 2.3 5.8 5.4v4.3c0 3.1-2.4 5.4-5.8 5.4h-2.7l-4.8 3.2 1-3.2h-1.5c-3.4 0-5.8-2.3-5.8-5.4v-4.3c0-3.1 2.4-5.4 5.8-5.4Z"/>',
      '<path class="logo-node-line" d="M22.5 27.5h12.2M28.5 27.5v10.8M28.5 38.3h8.8"/>',
      '<circle class="logo-node" cx="22.5" cy="27.5" r="1.8"/>',
      '<circle class="logo-node" cx="28.5" cy="38.3" r="1.8"/>',
      '<circle class="logo-node" cx="37.3" cy="38.3" r="1.8"/>',
      '<path class="logo-spark" d="M46.6 23.1v5.4M43.9 25.8h5.4"/>',
      '</svg>'
    ].join("");
  }


  function floatingButtonIcon() {
    return [
      '<svg class="floating-cs-button-icon" viewBox="0 0 64 64" role="img" aria-label="喵管家" focusable="false">',
      '<path class="cat-bubble" d="M20 23 25.5 15.5 30.2 23h3.6l4.7-7.5L44 23c6.4.9 10 5.7 10 12.6 0 9.2-7 15.4-18.2 15.4h-5.9L20 56l2-7.2C14.6 46.2 10 41.2 10 34.8 10 28 14 24 20 23Z"/>',
      '<circle class="cat-dot" cx="27" cy="36" r="2.6"/>',
      '<circle class="cat-dot" cx="37" cy="36" r="2.6"/>',
      '</svg>'
    ].join("");
  }
  function addStyle() {
    var old = document.getElementById(STYLE_ID);
    if (old) old.remove();

    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
#floatingService,.floating-service,.service-float,.online-service,#mcjButler,#mcjButlerModal,#mcjFloatingAssistant,#mcjFloatingAssistantBackdrop{display:none!important}
#${ROOT_ID}{position:fixed!important;right:24px!important;bottom:24px!important;z-index:2147483000!important;width:56px!important;height:56px!important;margin:0!important;padding:0!important;pointer-events:none!important;font-family:"Microsoft YaHei UI","PingFang SC",Arial,sans-serif!important;color:#fff!important}
#${ROOT_ID},#${ROOT_ID} *{box-sizing:border-box!important}
.floating-cs-button{position:fixed!important;right:24px!important;bottom:24px!important;width:56px!important;height:56px!important;border-radius:18px!important;border:1px solid rgba(255,145,195,.42)!important;background:linear-gradient(180deg,rgba(22,18,24,.94),rgba(8,7,11,.94))!important;color:#ffc8e3!important;display:grid!important;place-items:center!important;padding:0!important;cursor:pointer!important;pointer-events:auto!important;backdrop-filter:blur(14px)!important;-webkit-backdrop-filter:blur(14px)!important;box-shadow:0 12px 32px rgba(0,0,0,.45),0 0 18px rgba(255,90,165,.14),inset 0 1px 0 rgba(255,255,255,.06)!important;transition:transform .18s ease,border-color .18s ease,box-shadow .18s ease,background-color .18s ease!important}
.floating-cs-button:hover,.floating-cs-button:focus-visible{transform:translateY(-1px) scale(1.035)!important;border-color:rgba(255,181,218,.75)!important;box-shadow:0 16px 38px rgba(0,0,0,.52),0 0 24px rgba(255,105,180,.24),inset 0 1px 0 rgba(255,255,255,.08)!important;outline:0!important}
.floating-cs-button:active{transform:scale(.97)!important}
.floating-cs-button::after{content:"喵管家";position:absolute;right:66px;top:50%;transform:translateY(-50%) translateX(6px);height:32px;padding:0 12px;border-radius:999px;border:1px solid rgba(255,145,195,.30);background:rgba(15,12,17,.94);color:#ffe4f1;font-size:13px;font-weight:700;line-height:30px;white-space:nowrap;box-shadow:0 10px 24px rgba(0,0,0,.34),0 0 12px rgba(255,92,170,.12);opacity:0;pointer-events:none;transition:opacity .18s ease,transform .18s ease}
.floating-cs-button:hover::after,.floating-cs-button:focus-visible::after{opacity:1;transform:translateY(-50%) translateX(0)}
.floating-cs-ai-logo{display:block!important;fill:none!important;stroke-linecap:round!important;stroke-linejoin:round!important;overflow:visible!important;flex:0 0 auto!important;filter:drop-shadow(0 0 8px rgba(255,110,180,.22))!important}
.floating-cs-cat{width:34px!important;height:34px!important}
.floating-cs-ai-logo .logo-halo{fill:rgba(255,145,195,.035)!important;stroke:rgba(255,92,170,.44)!important;stroke-width:5.2!important;filter:drop-shadow(0 0 8px rgba(255,92,170,.28))!important}
.floating-cs-ai-logo .logo-face{fill:rgba(255,255,255,.018)!important;stroke:#fff8fc!important;stroke-width:2.55!important}
.floating-cs-ai-logo .logo-whisker{stroke:#fff8fc!important;stroke-width:2.35!important}
.floating-cs-ai-logo .logo-bubble,.floating-cs-ai-logo .logo-spark,.floating-cs-ai-logo .logo-node-line{stroke:#ff9bcf!important;stroke-width:2.15!important}
.floating-cs-ai-logo .logo-bubble{fill:rgba(18,11,18,.96)!important;filter:drop-shadow(0 0 6px rgba(255,92,170,.18))!important}
.floating-cs-ai-logo .logo-node{fill:#ff9bcf!important;stroke:#fff8fc!important;stroke-width:.55!important}
.floating-cs-panel{position:fixed!important;right:24px!important;bottom:92px!important;width:360px!important;height:520px!important;max-width:calc(100vw - 48px)!important;max-height:70vh!important;display:flex!important;flex-direction:column!important;overflow:hidden!important;border:1px solid rgba(255,145,195,.38)!important;border-radius:20px!important;background:linear-gradient(145deg,rgba(20,15,22,.96),rgba(8,7,11,.98))!important;box-shadow:0 24px 70px rgba(0,0,0,.58),0 0 24px rgba(255,80,160,.16),inset 0 1px 0 rgba(255,255,255,.06)!important;backdrop-filter:blur(18px)!important;-webkit-backdrop-filter:blur(18px)!important;opacity:0;transform:translateY(12px) scale(.98);transform-origin:right bottom;pointer-events:none!important;transition:opacity .2s ease,transform .2s ease!important;will-change:opacity,transform!important}
#${ROOT_ID}[data-cs-open="true"] .floating-cs-panel{opacity:1;transform:translateY(0) scale(1);pointer-events:auto!important}
.floating-cs-panel:focus{outline:0}.floating-cs-panel:focus-visible{box-shadow:0 24px 70px rgba(0,0,0,.58),0 0 0 3px rgba(255,145,195,.16),0 0 24px rgba(255,80,160,.16)!important}
.floating-cs-head{display:flex;align-items:center;gap:12px;min-height:70px;padding:14px;border-bottom:1px solid rgba(255,145,195,.14);background:rgba(255,255,255,.024)}
.floating-cs-head-logo{width:38px;height:38px;border-radius:13px;border:1px solid rgba(255,145,195,.26);display:grid;place-items:center;background:rgba(255,255,255,.032);flex:0 0 auto}.floating-cs-head-logo .floating-cs-cat{width:27px!important;height:27px!important}
.floating-cs-title{min-width:0;flex:1}.floating-cs-title h3{margin:0;color:#fff7fb;font-size:18px;font-weight:800;line-height:1.2;letter-spacing:0}.floating-cs-title p{margin:4px 0 0;color:rgba(255,226,239,.70);font-size:13px;line-height:1.2}
.floating-cs-icon-btn{width:34px;height:34px;border-radius:12px;border:1px solid rgba(255,145,195,.20);background:rgba(255,255,255,.04);color:#ffe2ef;display:grid;place-items:center;font-size:18px;font-weight:700;line-height:1;cursor:pointer;transition:background .18s ease,border-color .18s ease,transform .18s ease}.floating-cs-icon-btn:hover,.floating-cs-icon-btn:focus-visible{border-color:rgba(255,145,195,.58);background:rgba(255,145,195,.10);outline:0;transform:translateY(-1px)}
.floating-cs-body{padding:16px;display:flex;flex:1;min-height:0;flex-direction:column;gap:14px;overflow:auto;overscroll-behavior:contain;-webkit-overflow-scrolling:touch}.floating-cs-message{border:1px solid rgba(255,145,195,.18);border-radius:18px;background:rgba(255,255,255,.040);padding:14px;color:#fff1f8;line-height:1.65;font-size:14px}.floating-cs-message strong{display:block;margin-bottom:2px;color:#fff;font-size:15px;font-weight:800}
.floating-cs-actions{display:grid;gap:10px}.floating-cs-action{width:100%;min-height:46px;border-radius:14px;border:1px solid rgba(255,145,195,.22);background:rgba(255,255,255,.035);color:#fff7fb;text-decoration:none;display:flex;align-items:center;justify-content:space-between;gap:14px;padding:0 14px;font-size:14px;font-weight:750;cursor:pointer;text-align:left;transition:border-color .18s ease,background .18s ease,box-shadow .18s ease,transform .18s ease}.floating-cs-action span{color:rgba(255,226,239,.56);font-size:18px}.floating-cs-action:hover,.floating-cs-action:focus-visible{border-color:rgba(255,145,195,.58);background:rgba(255,145,195,.085);box-shadow:0 0 16px rgba(255,80,160,.11);outline:0;transform:translateY(-1px)}
.floating-cs-note{margin-top:auto;color:rgba(255,226,239,.56);font-size:12px;line-height:1.5}
html.${BODY_LOCK_CLASS},body.${BODY_LOCK_CLASS}{overflow:hidden!important} body.${BODY_LOCK_CLASS}{touch-action:none!important}
@media(max-width:640px){#${ROOT_ID}{right:16px!important;bottom:calc(86px + env(safe-area-inset-bottom))!important;width:52px!important;height:52px!important}.floating-cs-button{right:16px!important;bottom:calc(86px + env(safe-area-inset-bottom))!important;width:52px!important;height:52px!important;border-radius:17px!important}.floating-cs-cat{width:31px!important;height:31px!important}.floating-cs-button::after{display:none!important}.floating-cs-panel{left:0!important;right:0!important;bottom:0!important;width:100vw!important;height:auto!important;max-width:100vw!important;max-height:75dvh!important;border-radius:22px 22px 0 0!important;border-left:0!important;border-right:0!important;border-bottom:0!important;transform:translateY(14px)!important;transform-origin:center bottom!important;padding-bottom:env(safe-area-inset-bottom)!important}.floating-cs-head{min-height:64px!important;padding:12px 14px!important}.floating-cs-body{padding:14px 14px calc(14px + env(safe-area-inset-bottom))!important}.floating-cs-action{min-height:44px!important}#${ROOT_ID}[data-cs-open="true"] .floating-cs-panel{transform:translateY(0)!important}}
#${ROOT_ID} .floating-cs-button::after,#${ROOT_ID} .floating-cs-button:hover::after,#${ROOT_ID} .floating-cs-button:focus-visible::after{content:none!important;display:none!important}
#${ROOT_ID} .floating-cs-button{width:56px!important;height:56px!important;border-radius:18px!important;background:rgba(12,10,14,.92)!important;background-image:none!important;border:1px solid rgba(255,145,195,.32)!important;box-shadow:0 12px 30px rgba(0,0,0,.42),0 0 12px rgba(255,145,195,.10),inset 0 1px 0 rgba(255,255,255,.055)!important}
#${ROOT_ID} .floating-cs-button:hover,#${ROOT_ID} .floating-cs-button:focus-visible{transform:scale(1.04)!important;border-color:rgba(255,145,195,.56)!important;box-shadow:0 14px 34px rgba(0,0,0,.48),0 0 16px rgba(255,145,195,.18),inset 0 1px 0 rgba(255,255,255,.07)!important}
#${ROOT_ID} .floating-cs-button:active{transform:scale(.98)!important}
#${ROOT_ID} .floating-cs-button-icon{width:32px!important;height:32px!important;display:block!important;overflow:visible!important;fill:none!important;stroke:#ffc2df!important;stroke-linecap:round!important;stroke-linejoin:round!important;filter:drop-shadow(0 0 5px rgba(255,145,195,.24))!important}
#${ROOT_ID} .floating-cs-button-icon .cat-bubble{fill:rgba(255,145,195,.025)!important;stroke:#ffc2df!important;stroke-width:3.8!important}
#${ROOT_ID} .floating-cs-button-icon .cat-dot{fill:#ffc2df!important;stroke:none!important}
@media(max-width:640px){#${ROOT_ID} .floating-cs-button{width:52px!important;height:52px!important;border-radius:17px!important}#${ROOT_ID} .floating-cs-button-icon{width:30px!important;height:30px!important}}
`;
    document.head.appendChild(style);
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

    if (window.MCJChatAPI && window.MCJChatAPI.createCustomerServiceConversation) {
      try {
        var user = currentCustomer() || {};
        var result = await window.MCJChatAPI.createCustomerServiceConversation("customer", {
          source: "meow_butler",
          customer_id: user.user_id || user.id || user.customer_id || "",
          customer_name: user.nickname || user.name || ""
        });
        var data = result && result.data ? result.data : {};
        var conversation = data.conversation || {};
        var id = data.conversation_id || conversation.id || data.id || "";
        location.href = "messages.html" + (id ? "?conversation=" + encodeURIComponent(id) : "");
        return;
      } catch (e) {}
    }

    location.href = "messages.html";
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
    root.innerHTML = [
      '<button class="floating-cs-button" type="button" aria-label="打开喵管家" title="喵管家">' + floatingButtonIcon() + "</button>",
      '<section class="floating-cs-panel" role="dialog" aria-label="喵管家在线客服" tabindex="-1">',
      '<header class="floating-cs-head">',
      '<span class="floating-cs-head-logo">' + assistantLogo("floating-cs-cat") + "</span>",
      '<div class="floating-cs-title"><h3>喵管家</h3><p>在线客服</p></div>',
      '<button class="floating-cs-icon-btn" type="button" data-floating-cs-close aria-label="关闭喵管家">×</button>',
      "</header>",
      '<div class="floating-cs-body">',
      '<div class="floating-cs-message"><strong>您好，我是喵管家 ฅ՞•ﻌ•՞ฅ</strong>请问有什么可以帮您？</div>',
      '<nav class="floating-cs-actions" aria-label="喵管家快捷入口">',
      '<button class="floating-cs-action" type="button" data-floating-cs-action="chat">联系人工客服 <span aria-hidden="true">›</span></button>',
      '<button class="floating-cs-action" type="button" data-floating-cs-action="orders">订单问题 <span aria-hidden="true">›</span></button>',
      '<button class="floating-cs-action" type="button" data-floating-cs-action="recharge">猫粮充值问题 <span aria-hidden="true">›</span></button>',
      '<button class="floating-cs-action" type="button" data-floating-cs-action="refunds">退款与售后 <span aria-hidden="true">›</span></button>',
      '<button class="floating-cs-action" type="button" data-floating-cs-action="apply">申请成为陪玩 <span aria-hidden="true">›</span></button>',
      "</nav>",
      '<p class="floating-cs-note">客服入口会连接当前账号的聊天、订单、猫粮充值和售后页面。</p>',
      "</div>",
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

  function init() {
    removeOldWidgets();
    if (shouldHide()) return;

    addStyle();

    var root = buildWidget();
    var button = root.querySelector(".floating-cs-button");
    document.body.appendChild(root);

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
      if (type === "recharge") requireLogin({ href: "miao-coin.html" });
      if (type === "refunds") requireLogin({ href: "orders.html?tab=refunds" });
      if (type === "apply") location.href = "companion-apply.html";
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