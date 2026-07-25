(function () {
  var ROOT_ID = "floatingCustomerService";
  var STYLE_ID = "floatingCustomerServiceStyle";
  var AFTER_LOGIN_KEY = "mcjButlerAfterLogin.v2";

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

  function removeOldWidgets() {
    document.querySelectorAll(
      "#floatingService,.floating-service,.service-float,.online-service,#mcjButler,#mcjButlerModal,#mcjFloatingAssistant,#mcjFloatingAssistantBackdrop,#" + ROOT_ID
    ).forEach(function (el) {
      el.remove();
    });
  }

  function catLogo(extraClass) {
    var cls = ["floating-cs-ai-logo", extraClass || ""].join(" ").trim();
    return [
      '<svg class="' + cls + '" viewBox="0 0 64 64" role="img" aria-label="喵管家 Meow Assistant" focusable="false">',
      '<path class="logo-shadow" d="M14.2 31c0-8.1 4.8-14.2 11.6-16L32 8l6.4 7c6.8 1.8 11.6 7.9 11.6 16v6.4c0 9.3-7.5 15.9-17.6 15.9H28l-8.1 5 1.7-7.4c-4.8-2.8-7.4-7.4-7.4-13.5V31Z" />',
      '<path class="logo-outline" d="M14.2 31c0-8.1 4.8-14.2 11.6-16L32 8l6.4 7c6.8 1.8 11.6 7.9 11.6 16v6.4c0 9.3-7.5 15.9-17.6 15.9H28l-8.1 5 1.7-7.4c-4.8-2.8-7.4-7.4-7.4-13.5V31Z" />',
      '<path class="logo-whisker" d="M22.6 35.6H7.9M23.1 40.6 10.4 43.5M41.4 35.6h14.7M40.9 40.6l12.7 2.9" />',
      '<path class="logo-circuit" d="M31.8 27.9v12.7M26.4 32.3h10.8M37.2 32.3l4.7-4.7M37.2 36.9l4.7 4.7" />',
      '<circle class="logo-node logo-node-main" cx="31.8" cy="27.9" r="2.05" />',
      '<circle class="logo-node" cx="26.4" cy="32.3" r="1.75" />',
      '<circle class="logo-node" cx="37.2" cy="32.3" r="1.75" />',
      '<circle class="logo-node" cx="41.9" cy="27.6" r="1.7" />',
      '<circle class="logo-node" cx="41.9" cy="41.6" r="1.7" />',
      '<path class="logo-bubble" d="M41.9 17.2h6.2c2.9 0 5 2 5 4.6V26c0 2.6-2.1 4.6-5 4.6h-2.3l-4.7 3.3 1-3.3h-.2c-2.9 0-5-2-5-4.6v-4.2c0-2.6 2.1-4.6 5-4.6Z" />',
      '<path class="logo-spark" d="M47.5 21v4.3M45.4 23.1h4.3" />',
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
#${ROOT_ID}{position:fixed!important;right:24px!important;bottom:24px!important;z-index:9999!important;width:60px!important;height:60px!important;margin:0!important;padding:0!important;pointer-events:none!important;font-family:"Microsoft YaHei UI","PingFang SC",Arial,sans-serif!important}
#${ROOT_ID},#${ROOT_ID} *{box-sizing:border-box!important}
.floating-cs-button{position:absolute!important;right:0!important;bottom:0!important;width:60px!important;height:60px!important;border-radius:50%!important;border:1px solid rgba(255,145,195,.55)!important;background:rgba(18,14,18,.88)!important;background-image:none!important;color:#ffd6e8!important;display:grid!important;place-items:center!important;padding:0!important;cursor:pointer!important;pointer-events:auto!important;backdrop-filter:blur(14px)!important;-webkit-backdrop-filter:blur(14px)!important;box-shadow:0 8px 30px rgba(0,0,0,.45),0 0 18px rgba(255,80,160,.18)!important;transition:transform .2s cubic-bezier(.2,.8,.2,1),border-color .2s ease,box-shadow .2s ease,background-color .2s ease!important}
.floating-cs-button:hover,.floating-cs-button:focus-visible{transform:translateY(-1px) scale(1.04)!important;border-color:rgba(255,176,214,.86)!important;background:rgba(22,16,22,.94)!important;box-shadow:0 14px 36px rgba(0,0,0,.52),0 0 28px rgba(255,92,170,.34)!important;outline:0!important}
.floating-cs-button:active{transform:scale(.96)!important;box-shadow:0 7px 20px rgba(0,0,0,.46),0 0 14px rgba(255,92,170,.22)!important}
.floating-cs-button::after{content:"喵管家";position:absolute;right:70px;top:50%;transform:translateY(-50%) translateX(6px);height:32px;padding:0 12px;border-radius:999px;border:1px solid rgba(255,145,195,.38);background:rgba(18,14,18,.92);color:#ffe2ef;font-size:13px;font-weight:700;line-height:30px;white-space:nowrap;box-shadow:0 10px 26px rgba(0,0,0,.36),0 0 14px rgba(255,92,170,.16);opacity:0;pointer-events:none;transition:opacity .2s ease,transform .2s ease}
.floating-cs-button:hover::after,.floating-cs-button:focus-visible::after{opacity:1;transform:translateY(-50%) translateX(0)}
.floating-cs-ai-logo{display:block!important;fill:none!important;stroke-linecap:round!important;stroke-linejoin:round!important;overflow:visible!important;flex:0 0 auto!important;filter:drop-shadow(0 0 9px rgba(255,110,180,.30))!important}
.floating-cs-ai-logo.logo-24{width:24px!important;height:24px!important}.floating-cs-ai-logo.logo-32{width:32px!important;height:32px!important}.floating-cs-ai-logo.logo-48{width:48px!important;height:48px!important}.floating-cs-ai-logo.logo-64{width:64px!important;height:64px!important}
.floating-cs-cat{width:34px!important;height:34px!important}
.floating-cs-ai-logo .logo-shadow{fill:rgba(255,145,195,.045)!important;stroke:rgba(255,92,170,.58)!important;stroke-width:5.3!important;filter:drop-shadow(0 0 9px rgba(255,92,170,.42))!important}
.floating-cs-ai-logo .logo-outline{fill:rgba(255,255,255,.025)!important;stroke:#fff8fc!important;stroke-width:2.7!important}
.floating-cs-ai-logo .logo-whisker{stroke:#fff8fc!important;stroke-width:2.35!important}
.floating-cs-ai-logo .logo-circuit,.floating-cs-ai-logo .logo-spark{stroke:#ff9bcf!important;stroke-width:2.25!important}
.floating-cs-ai-logo .logo-bubble{fill:rgba(18,11,18,.96)!important;stroke:#ff9bcf!important;stroke-width:2.1!important;filter:drop-shadow(0 0 7px rgba(255,92,170,.24))!important}
.floating-cs-ai-logo .logo-node{fill:#ff9bcf!important;stroke:#fff8fc!important;stroke-width:.65!important}
.floating-cs-ai-logo .logo-node-main{filter:drop-shadow(0 0 6px rgba(255,92,170,.54))!important}.floating-cs-panel{position:absolute!important;right:0!important;bottom:72px!important;width:360px!important;height:520px!important;max-width:calc(100vw - 48px)!important;max-height:calc(100vh - 120px)!important;display:flex!important;flex-direction:column!important;overflow:hidden!important;border:1px solid rgba(255,145,195,.45)!important;border-radius:20px!important;background:linear-gradient(145deg,rgba(20,14,20,.94),rgba(8,7,11,.96))!important;box-shadow:0 24px 70px rgba(0,0,0,.58),0 0 28px rgba(255,80,160,.18),inset 0 1px 0 rgba(255,255,255,.06)!important;backdrop-filter:blur(18px)!important;-webkit-backdrop-filter:blur(18px)!important;opacity:0;transform:translateY(12px) scale(.98);transform-origin:right bottom;pointer-events:none!important;transition:opacity .2s cubic-bezier(.2,.8,.2,1),transform .2s cubic-bezier(.2,.8,.2,1)!important;will-change:opacity,transform!important}
#${ROOT_ID}[data-cs-open="true"] .floating-cs-panel{opacity:1;transform:translateY(0) scale(1);pointer-events:auto!important}
.floating-cs-panel:focus{outline:0}.floating-cs-panel:focus-visible{box-shadow:0 24px 70px rgba(0,0,0,.58),0 0 0 3px rgba(255,145,195,.18),0 0 28px rgba(255,80,160,.18)!important}
.floating-cs-head{display:flex;align-items:center;gap:12px;min-height:72px;padding:14px 14px 12px;border-bottom:1px solid rgba(255,145,195,.16);background:rgba(255,255,255,.025)}
.floating-cs-head-logo{width:40px;height:40px;border-radius:14px;border:1px solid rgba(255,145,195,.34);display:grid;place-items:center;background:rgba(255,255,255,.035);flex:0 0 auto}.floating-cs-head-logo .floating-cs-cat{width:28px!important;height:28px!important}
.floating-cs-title{min-width:0;flex:1}.floating-cs-title h3{margin:0;color:#fff7fb;font-size:18px;font-weight:800;line-height:1.2;letter-spacing:0}.floating-cs-title p{margin:4px 0 0;color:rgba(255,226,239,.72);font-size:13px;line-height:1.2}
.floating-cs-icon-btn{width:34px;height:34px;border-radius:12px;border:1px solid rgba(255,145,195,.22);background:rgba(255,255,255,.045);color:#ffe2ef;display:grid;place-items:center;font-size:18px;font-weight:700;line-height:1;cursor:pointer;transition:background .18s ease,border-color .18s ease,transform .18s ease}.floating-cs-icon-btn:hover,.floating-cs-icon-btn:focus-visible{border-color:rgba(255,145,195,.62);background:rgba(255,145,195,.12);outline:0;transform:translateY(-1px)}
.floating-cs-body{padding:16px;display:flex;flex:1;min-height:0;flex-direction:column;gap:14px;overflow:auto}.floating-cs-message{border:1px solid rgba(255,145,195,.20);border-radius:18px;background:rgba(255,255,255,.045);padding:14px;color:#fff1f8;line-height:1.65;font-size:14px}.floating-cs-message strong{display:block;margin-bottom:2px;color:#fff;font-size:15px;font-weight:800}
.floating-cs-actions{display:grid;gap:10px}.floating-cs-action{width:100%;min-height:46px;border-radius:14px;border:1px solid rgba(255,145,195,.24);background:rgba(255,255,255,.038);color:#fff7fb;text-decoration:none;display:flex;align-items:center;justify-content:space-between;gap:14px;padding:0 14px;font-size:14px;font-weight:750;cursor:pointer;text-align:left;transition:border-color .18s ease,background .18s ease,box-shadow .18s ease,transform .18s ease}.floating-cs-action span{color:rgba(255,226,239,.56);font-size:18px}.floating-cs-action:hover,.floating-cs-action:focus-visible{border-color:rgba(255,145,195,.64);background:rgba(255,145,195,.10);box-shadow:0 0 18px rgba(255,80,160,.13);outline:0;transform:translateY(-1px)}
.floating-cs-note{margin-top:auto;color:rgba(255,226,239,.58);font-size:12px;line-height:1.5}
@media(max-width:640px){#${ROOT_ID}{right:16px!important;bottom:18px!important;width:54px!important;height:54px!important}.floating-cs-button{width:54px!important;height:54px!important}.floating-cs-cat{width:30px!important;height:30px!important}.floating-cs-button::after{right:62px}.floating-cs-panel{right:-16px!important;bottom:66px!important;width:calc(100vw - 24px)!important;height:auto!important;max-height:70vh!important;max-width:calc(100vw - 24px)!important}.floating-cs-head{min-height:66px;padding:12px}.floating-cs-body{padding:14px}.floating-cs-action{min-height:44px}}
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
    root.innerHTML = [
      '<button class="floating-cs-button" type="button" aria-label="打开喵管家" title="喵管家">' + catLogo("floating-cs-cat") + "</button>",
      '<section class="floating-cs-panel" role="dialog" aria-label="喵管家在线客服" tabindex="-1">',
      '<header class="floating-cs-head">',
      '<span class="floating-cs-head-logo">' + catLogo("floating-cs-cat") + "</span>",
      '<div class="floating-cs-title"><h3>喵管家</h3><p>Meow Assistant</p></div>',
      '<button class="floating-cs-icon-btn" type="button" data-floating-cs-minimize aria-label="最小化喵管家">-</button>',
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

  function closePanel(root, button) {
    root.dataset.csOpen = "false";
    if (button) button.focus({ preventScroll: true });
  }

  function openPanel(root) {
    root.dataset.csOpen = "true";
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
    document.documentElement.appendChild(root);

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
      var close = event.target.closest("[data-floating-cs-close],[data-floating-cs-minimize]");
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
