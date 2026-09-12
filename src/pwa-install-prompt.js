(function () {
  "use strict";

  if (window.__MCJPwaInstallLoaded) return;
  window.__MCJPwaInstallLoaded = true;

  var LS_INSTALLED = "mcj_pwa_installed";
  var LS_DISMISSED = "mcj_pwa_prompt_dismissed_at";
  var LS_SEEN = "mcj_pwa_prompt_seen";
  var LS_COUNT = "mcj_pwa_prompt_count";
  var SS_AUTO_SHOWN = "mcj_pwa_prompt_session_shown";
  var MAX_AUTO = 3;
  var DISMISS_MS = 7 * 24 * 60 * 60 * 1000;
  var DELAY_MIN = 2500;
  var DELAY_MAX = 3500;
  var INTERACT_MIN = 1500;

  var deferredPrompt = null;
  var rootEl = null;
  var openState = false;
  var autoScheduled = false;
  var bipWaitTimer = null;

  function lsGet(key) {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  function lsSet(key, val) {
    try {
      localStorage.setItem(key, String(val));
    } catch (e) {}
  }

  function isStandalone() {
    try {
      if (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) return true;
      if (window.navigator && window.navigator.standalone === true) return true;
    } catch (e) {}
    return false;
  }

  function markInstalled() {
    lsSet(LS_INSTALLED, "1");
  }

  function isInstalledFlag() {
    return lsGet(LS_INSTALLED) === "1";
  }

  function promptCount() {
    var n = parseInt(lsGet(LS_COUNT) || "0", 10);
    return isFinite(n) && n > 0 ? n : 0;
  }

  function parseDismissedAt() {
    var raw = lsGet(LS_DISMISSED);
    if (!raw) return 0;
    var n = Number(raw);
    if (isFinite(n) && n > 0) return n;
    var t = Date.parse(raw);
    return isFinite(t) ? t : 0;
  }

  function withinDismissWindow() {
    var at = parseDismissedAt();
    if (!at) return false;
    return Date.now() - at < DISMISS_MS;
  }

  function ssGet(key) {
    try {
      return sessionStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }

  function ssSet(key, val) {
    try {
      sessionStorage.setItem(key, String(val));
    } catch (e) {}
  }

  function canAutoShow() {
    if (isStandalone()) {
      markInstalled();
      return false;
    }
    if (isInstalledFlag()) return false;
    if (promptCount() >= MAX_AUTO) return false;
    if (withinDismissWindow()) return false;
    // One auto prompt per browser tab session — avoids re-pop on portal HTML switches.
    if (ssGet(SS_AUTO_SHOWN) === "1") return false;
    return true;
  }

  function detectPlatform() {
    var ua = String(navigator.userAgent || "");
    var iOS =
      /iPad|iPhone|iPod/i.test(ua) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    var android = /Android/i.test(ua);
    return { iOS: !!iOS, android: !!android };
  }

  function ensureMetaTag(selector, create) {
    var el = document.head.querySelector(selector);
    if (el) return el;
    el = create();
    document.head.appendChild(el);
    return el;
  }

  function ensurePwaMeta() {
    if (!document.head) return;
    var iconV = "20260911pwaIcon2";
    ensureMetaTag('link[rel="manifest"][data-mcj-pwa-manifest]', function () {
      var l = document.createElement("link");
      l.rel = "manifest";
      l.href = "/manifest.webmanifest?v=" + iconV;
      l.setAttribute("data-mcj-pwa-manifest", "1");
      return l;
    });
    ensureMetaTag('link[rel="apple-touch-icon"][data-mcj-pwa-ati]', function () {
      var l = document.createElement("link");
      l.rel = "apple-touch-icon";
      l.href = "/apple-touch-icon.png?v=" + iconV;
      l.setAttribute("data-mcj-pwa-ati", "1");
      return l;
    });
    ensureMetaTag('link[rel="apple-touch-icon"][data-mcj-pwa-ati-icons]', function () {
      var l = document.createElement("link");
      l.rel = "apple-touch-icon";
      l.sizes = "180x180";
      l.href = "/icons/apple-touch-icon.png?v=" + iconV;
      l.setAttribute("data-mcj-pwa-ati-icons", "1");
      return l;
    });
    ensureMetaTag('link[rel="icon"][data-mcj-pwa-favicon-32]', function () {
      var l = document.createElement("link");
      l.rel = "icon";
      l.type = "image/png";
      l.sizes = "32x32";
      l.href = "/favicon-32.png?v=" + iconV;
      l.setAttribute("data-mcj-pwa-favicon-32", "1");
      return l;
    });
    ensureMetaTag('link[rel="icon"][data-mcj-pwa-favicon-192]', function () {
      var l = document.createElement("link");
      l.rel = "icon";
      l.type = "image/png";
      l.sizes = "192x192";
      l.href = "/icons/icon-192.png?v=" + iconV;
      l.setAttribute("data-mcj-pwa-favicon-192", "1");
      return l;
    });
    ensureMetaTag('meta[name="apple-mobile-web-app-capable"][data-mcj-pwa]', function () {
      var m = document.createElement("meta");
      m.name = "apple-mobile-web-app-capable";
      m.content = "yes";
      m.setAttribute("data-mcj-pwa", "1");
      return m;
    });
    ensureMetaTag('meta[name="apple-mobile-web-app-status-bar-style"][data-mcj-pwa]', function () {
      var m = document.createElement("meta");
      m.name = "apple-mobile-web-app-status-bar-style";
      m.content = "black-translucent";
      m.setAttribute("data-mcj-pwa", "1");
      return m;
    });
    ensureMetaTag('meta[name="apple-mobile-web-app-title"][data-mcj-pwa]', function () {
      var m = document.createElement("meta");
      m.name = "apple-mobile-web-app-title";
      m.content = "妙脆角";
      m.setAttribute("data-mcj-pwa", "1");
      return m;
    });
    ensureMetaTag('meta[name="theme-color"][data-mcj-pwa]', function () {
      var m = document.createElement("meta");
      m.name = "theme-color";
      m.content = "#0a0610";
      m.setAttribute("data-mcj-pwa", "1");
      return m;
    });
    ensureMetaTag('meta[name="mobile-web-app-capable"][data-mcj-pwa]', function () {
      var m = document.createElement("meta");
      m.name = "mobile-web-app-capable";
      m.content = "yes";
      m.setAttribute("data-mcj-pwa", "1");
      return m;
    });
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    try {
      navigator.serviceWorker.register("/sw-mcj.js", { scope: "/" }).catch(function () {});
    } catch (e) {}
  }

  function logoSrc() {
    return "/icons/icon-192.png?v=20260911pwaIcon2";
  }

  function buildFlow(platform, hasBip) {
    if (platform.iOS) {
      return (
        '<div class="mcj-pwa-flow" aria-hidden="true">' +
        '<div class="mcj-pwa-step"><div class="mcj-pwa-step-ico">⇪</div><span>分享</span></div>' +
        '<div class="mcj-pwa-arrow">→</div>' +
        '<div class="mcj-pwa-step"><div class="mcj-pwa-step-ico">＋</div><span>添加到主屏幕</span></div>' +
        '<div class="mcj-pwa-arrow">→</div>' +
        '<div class="mcj-pwa-step"><div class="mcj-pwa-step-ico">✓</div><span>添加</span></div>' +
        "</div>" +
        '<div class="mcj-pwa-hint"><span class="mcj-pwa-chevron">▼</span><span>点击 Safari 分享按钮 → 添加到主屏幕</span></div>'
      );
    }
    if (platform.android && hasBip) {
      return (
        '<div class="mcj-pwa-flow" aria-hidden="true">' +
        '<div class="mcj-pwa-step"><div class="mcj-pwa-step-ico">◎</div><span>安装妙脆角</span></div>' +
        '<div class="mcj-pwa-arrow">→</div>' +
        '<div class="mcj-pwa-step"><div class="mcj-pwa-step-ico">⌂</div><span>出现在主屏幕</span></div>' +
        "</div>"
      );
    }
    return (
      '<div class="mcj-pwa-flow" aria-hidden="true">' +
      '<div class="mcj-pwa-step"><div class="mcj-pwa-step-ico">⋮</div><span>Chrome 菜单</span></div>' +
      '<div class="mcj-pwa-arrow">→</div>' +
      '<div class="mcj-pwa-step"><div class="mcj-pwa-step-ico">＋</div><span>安装应用 / 添加到主屏幕</span></div>' +
      '<div class="mcj-pwa-arrow">→</div>' +
      '<div class="mcj-pwa-step"><div class="mcj-pwa-step-ico">✓</div><span>确认</span></div>' +
      "</div>"
    );
  }

  function titles(platform, hasBip) {
    if (platform.iOS) {
      return {
        title: "把妙脆角装到主屏幕",
        sub: "打开更快，使用起来更像 App",
        hint: "点击 Safari 分享按钮 → 添加到主屏幕 → 添加",
      };
    }
    if (platform.android && hasBip) {
      return {
        title: "把妙脆角装到主屏幕",
        sub: "打开更快，使用起来更像 App",
        hint: "点击下方「安装妙脆角」，使用系统原生安装提示",
      };
    }
    if (platform.android) {
      return {
        title: "把妙脆角装到主屏幕",
        sub: "打开更快，使用起来更像 App",
        hint: "打开 Chrome 菜单 → 安装应用 / 添加到主屏幕",
      };
    }
    return {
      title: "把妙脆角装到主屏幕",
      sub: "打开更快，使用起来更像 App",
      hint: "使用浏览器菜单中的「安装应用 / 添加到主屏幕」",
    };
  }

  function ensureDom() {
    if (rootEl && document.body.contains(rootEl)) return rootEl;
    rootEl = document.createElement("div");
    rootEl.className = "mcj-pwa-root";
    rootEl.setAttribute("data-mcj-pwa-root", "1");
    rootEl.innerHTML =
      '<div class="mcj-pwa-overlay" data-mcj-pwa-overlay></div>' +
      '<div class="mcj-pwa-sheet" role="dialog" aria-modal="true" aria-labelledby="mcjPwaTitle">' +
      '<button type="button" class="mcj-pwa-close" data-mcj-pwa-close aria-label="关闭">×</button>' +
      '<div class="mcj-pwa-brand">' +
      '<img class="mcj-pwa-logo" src="' +
      logoSrc() +
      '" alt="妙脆角" width="56" height="56" decoding="async">' +
      "<div>" +
      '<h2 id="mcjPwaTitle">把妙脆角装到主屏幕</h2>' +
      '<p data-mcj-pwa-sub>打开更快，使用起来更像 App</p>' +
      "</div></div>" +
      '<div data-mcj-pwa-body></div>' +
      '<div class="mcj-pwa-actions" data-mcj-pwa-actions></div>' +
      "</div>";
    document.body.appendChild(rootEl);

    rootEl.addEventListener("click", function (e) {
      if (e.target.closest("[data-mcj-pwa-close]") || e.target.closest("[data-mcj-pwa-overlay]")) {
        dismiss("close");
        return;
      }
      var later = e.target.closest("[data-mcj-pwa-later]");
      if (later) {
        dismiss("later");
        return;
      }
      var ok = e.target.closest("[data-mcj-pwa-ok]");
      if (ok) {
        dismiss("ok");
        return;
      }
      var install = e.target.closest("[data-mcj-pwa-install]");
      if (install) {
        triggerNativeInstall();
      }
    });

    return rootEl;
  }

  function renderContent() {
    var platform = detectPlatform();
    var hasBip = !!deferredPrompt;
    var t = titles(platform, hasBip);
    var root = ensureDom();
    root.classList.toggle("is-ios", !!platform.iOS);
    var titleEl = root.querySelector("#mcjPwaTitle");
    var subEl = root.querySelector("[data-mcj-pwa-sub]");
    var body = root.querySelector("[data-mcj-pwa-body]");
    var actions = root.querySelector("[data-mcj-pwa-actions]");
    if (titleEl) titleEl.textContent = t.title;
    if (subEl) subEl.textContent = t.sub + (t.hint ? " · " + t.hint : "");
    if (body) body.innerHTML = buildFlow(platform, hasBip);
    if (actions) {
      if (platform.android && hasBip) {
        actions.innerHTML =
          '<button type="button" class="mcj-pwa-btn" data-mcj-pwa-later>稍后再说</button>' +
          '<button type="button" class="mcj-pwa-btn primary" data-mcj-pwa-install>安装妙脆角</button>';
      } else if (platform.iOS) {
        actions.innerHTML =
          '<button type="button" class="mcj-pwa-btn" data-mcj-pwa-later>稍后再说</button>' +
          '<button type="button" class="mcj-pwa-btn primary" data-mcj-pwa-ok>我知道了</button>';
      } else {
        actions.innerHTML =
          '<button type="button" class="mcj-pwa-btn" data-mcj-pwa-later>稍后再说</button>' +
          '<button type="button" class="mcj-pwa-btn primary" data-mcj-pwa-ok>我知道了</button>';
      }
    }
  }

  function recordDismiss() {
    lsSet(LS_DISMISSED, String(Date.now()));
    lsSet(LS_SEEN, "1");
    lsSet(LS_COUNT, String(promptCount() + 1));
  }

  function close() {
    openState = false;
    if (!rootEl) return;
    rootEl.classList.remove("is-open");
  }

  function dismiss(/* reason */) {
    recordDismiss();
    close();
  }

  function open(opts) {
    opts = opts || {};
    var force = !!opts.force;
    // Already running as installed app — never show install chrome.
    if (isStandalone()) {
      markInstalled();
      return false;
    }
    // Auto prompt respects dismiss cooldown / install flag / max autos.
    // force=true (settings entry) always reopens the guide while not standalone.
    if (!force) {
      if (isInstalledFlag()) return false;
      if (!canAutoShow()) return false;
    }

    renderContent();
    ensureDom().classList.add("is-open");
    openState = true;
    lsSet(LS_SEEN, "1");
    if (!force) ssSet(SS_AUTO_SHOWN, "1");
    return true;
  }

  function triggerNativeInstall() {
    if (!deferredPrompt) {
      dismiss("ok");
      return;
    }
    var evt = deferredPrompt;
    deferredPrompt = null;
    try {
      evt.prompt();
      Promise.resolve(evt.userChoice)
        .then(function (choice) {
          if (choice && choice.outcome === "accepted") {
            markInstalled();
            close();
          } else {
            recordDismiss();
            close();
          }
        })
        .catch(function () {
          recordDismiss();
          close();
        });
    } catch (e) {
      recordDismiss();
      close();
    }
  }

  function scheduleAutoShow() {
    if (autoScheduled) return;
    if (!canAutoShow()) return;
    autoScheduled = true;

    var started = Date.now();
    var shown = false;
    var delay = DELAY_MIN + Math.floor(Math.random() * (DELAY_MAX - DELAY_MIN + 1));

    function tryShow() {
      if (shown) return;
      if (!canAutoShow()) return;
      shown = true;
      cleanup();
      open({ force: false });
    }

    function onInteract() {
      if (Date.now() - started < INTERACT_MIN) return;
      tryShow();
    }

    function cleanup() {
      window.clearTimeout(timer);
      document.removeEventListener("pointerdown", onInteract, true);
      document.removeEventListener("scroll", onInteract, true);
    }

    var timer = window.setTimeout(tryShow, delay);
    document.addEventListener("pointerdown", onInteract, true);
    document.addEventListener("scroll", onInteract, true);
  }

  function waitBrieflyForBipThenSchedule() {
    var platform = detectPlatform();
    if (!platform.android || deferredPrompt) {
      scheduleAutoShow();
      return;
    }
    if (bipWaitTimer) return;
    bipWaitTimer = window.setTimeout(function () {
      bipWaitTimer = null;
      scheduleAutoShow();
    }, 1200);
  }

  function onBeforeInstallPrompt(e) {
    try {
      e.preventDefault();
    } catch (err) {}
    deferredPrompt = e;
    if (bipWaitTimer) {
      window.clearTimeout(bipWaitTimer);
      bipWaitTimer = null;
    }
    if (openState) renderContent();
    scheduleAutoShow();
  }

  function onAppInstalled() {
    deferredPrompt = null;
    markInstalled();
    close();
  }

  function boot() {
    ensurePwaMeta();
    registerServiceWorker();

    if (isStandalone()) {
      markInstalled();
      return;
    }

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", waitBrieflyForBipThenSchedule);
    } else {
      waitBrieflyForBipThenSchedule();
    }
  }

  window.MCJPwaInstall = {
    open: open,
    openGuide: function () {
      return open({ force: true });
    },
    close: close,
    isStandalone: isStandalone,
    canAutoShow: canAutoShow,
    markInstalled: markInstalled,
    ensurePwaMeta: ensurePwaMeta,
  };

  boot();
})();
