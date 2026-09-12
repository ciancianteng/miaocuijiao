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

  var ICON_CACHE_V = "20260912pwaIcon4";
  var LOGO_FALLBACKS = [
    "/icons/icon-192.png",
    "/apple-touch-icon.png",
    "/icons/apple-touch-icon.png",
    "/assets/meow-cuijiao-brand-96.jpg",
    "/assets/meow-cuijiao-brand-96.webp",
    "/src/assets/meow-cuijiao-brand-96.jpg"
  ];

  function canonicalOrigin() {
    try {
      var origin = String((location && location.origin) || "");
      if (!origin || origin === "null") return "";
      // Production canonical host is www — avoid apex path quirks after redirect.
      if (origin === "https://meowcuijiao.com") return "https://www.meowcuijiao.com";
      return origin;
    } catch (e) {
      return "";
    }
  }

  function absoluteAsset(path) {
    var p = String(path || "");
    if (!p) return "";
    if (/^https?:\/\//i.test(p) || p.indexOf("data:") === 0) return p;
    if (p.charAt(0) !== "/") p = "/" + p;
    var origin = canonicalOrigin();
    return origin ? origin + p : p;
  }

  function logoCandidates() {
    var q = "?v=" + ICON_CACHE_V;
    return LOGO_FALLBACKS.map(function (path) {
      return absoluteAsset(path + q);
    });
  }

  function logoSrc() {
    return logoCandidates()[0];
  }

  function bindLogoFallback(img) {
    if (!img || img.getAttribute("data-mcj-logo-bound") === "1") return;
    img.setAttribute("data-mcj-logo-bound", "1");
    img.alt = "";
    img.setAttribute("aria-hidden", "true");
    img.addEventListener("error", function onLogoError() {
      var list = logoCandidates();
      var cur = String(img.getAttribute("src") || "");
      var idx = -1;
      for (var i = 0; i < list.length; i += 1) {
        if (list[i] === cur || cur.indexOf(LOGO_FALLBACKS[i]) !== -1) {
          idx = i;
          break;
        }
      }
      var next = list[idx + 1];
      if (next) {
        img.setAttribute("src", next);
        return;
      }
      // Prefer hide over broken-image + alt text.
      img.classList.add("is-failed");
      img.removeAttribute("src");
      img.style.display = "none";
      var wrap = img.parentElement;
      if (wrap && wrap.classList && wrap.classList.contains("mcj-pwa-logo-wrap")) {
        wrap.classList.add("is-empty");
        wrap.style.backgroundImage = "none";
      }
    });
    // If already broken before listener attached (cached fail), hide immediately.
    if (img.complete && img.naturalWidth === 0 && img.getAttribute("src")) {
      img.dispatchEvent(new Event("error"));
    }
  }

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
    var iconV = typeof ICON_CACHE_V !== "undefined" ? ICON_CACHE_V : "20260912pwaPortal2";
    function portalManifestHref() {
      var p = "";
      try {
        p = String(location.pathname || "/");
      } catch (e) {
        p = "/";
      }
      if (/^\/companion(\/|$)/i.test(p) || /^\/companion-apply\.html$/i.test(p)) {
        return absoluteAsset("/manifest-companion.webmanifest?v=" + iconV);
      }
      if (/^\/customer-service(\/|$)/i.test(p)) {
        return absoluteAsset("/manifest-cs.webmanifest?v=" + iconV);
      }
      if (
        /^\/admin(\/|$)/i.test(p) ||
        /^\/admin\.html$/i.test(p) ||
        /^\/admin-(dashboard|center|audit)\.html$/i.test(p)
      ) {
        return absoluteAsset("/manifest-admin.webmanifest?v=" + iconV);
      }
      return absoluteAsset("/manifest.webmanifest?v=" + iconV);
    }
    ensureMetaTag('link[rel="manifest"][data-mcj-pwa-manifest]', function () {
      var l = document.createElement("link");
      l.rel = "manifest";
      l.href = portalManifestHref();
      l.setAttribute("data-mcj-pwa-manifest", "1");
      return l;
    });
    // If a static/boot manifest link already exists, retarget it to this portal.
    try {
      var href = portalManifestHref();
      document.head.querySelectorAll('link[rel="manifest"]').forEach(function (el) {
        el.href = href;
        el.setAttribute("data-mcj-pwa-manifest", "1");
      });
    } catch (eRetarget) {}
    ensureMetaTag('link[rel="apple-touch-icon"][data-mcj-pwa-ati]', function () {
      var l = document.createElement("link");
      l.rel = "apple-touch-icon";
      l.href = absoluteAsset("/apple-touch-icon.png?v=" + iconV);
      l.setAttribute("data-mcj-pwa-ati", "1");
      return l;
    });
    ensureMetaTag('link[rel="apple-touch-icon"][data-mcj-pwa-ati-icons]', function () {
      var l = document.createElement("link");
      l.rel = "apple-touch-icon";
      l.sizes = "180x180";
      l.href = absoluteAsset("/icons/apple-touch-icon.png?v=" + iconV);
      l.setAttribute("data-mcj-pwa-ati-icons", "1");
      return l;
    });
    ensureMetaTag('link[rel="icon"][data-mcj-pwa-favicon-32]', function () {
      var l = document.createElement("link");
      l.rel = "icon";
      l.type = "image/png";
      l.sizes = "32x32";
      l.href = absoluteAsset("/favicon-32.png?v=" + iconV);
      l.setAttribute("data-mcj-pwa-favicon-32", "1");
      return l;
    });
    ensureMetaTag('link[rel="icon"][data-mcj-pwa-favicon-192]', function () {
      var l = document.createElement("link");
      l.rel = "icon";
      l.type = "image/png";
      l.sizes = "192x192";
      l.href = absoluteAsset("/icons/icon-192.png?v=" + iconV);
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
      var title = "妙脆角";
      try {
        var p = String(location.pathname || "/");
        if (/^\/companion(\/|$)/i.test(p) || /^\/companion-apply\.html$/i.test(p)) title = "妙脆角陪玩";
        else if (/^\/customer-service(\/|$)/i.test(p)) title = "妙脆角客服";
        else if (
          /^\/admin(\/|$)/i.test(p) ||
          /^\/admin\.html$/i.test(p) ||
          /^\/admin-(dashboard|center|audit)\.html$/i.test(p)
        ) {
          title = "妙脆角后台";
        }
      } catch (eTitle) {}
      m.content = title;
      m.setAttribute("data-mcj-pwa", "1");
      return m;
    });
    try {
      var titleEl = document.head.querySelector('meta[name="apple-mobile-web-app-title"]');
      if (titleEl) {
        var p2 = String(location.pathname || "/");
        if (/^\/companion(\/|$)/i.test(p2) || /^\/companion-apply\.html$/i.test(p2)) {
          titleEl.content = "妙脆角陪玩";
        } else if (/^\/customer-service(\/|$)/i.test(p2)) {
          titleEl.content = "妙脆角客服";
        } else if (
          /^\/admin(\/|$)/i.test(p2) ||
          /^\/admin\.html$/i.test(p2) ||
          /^\/admin-(dashboard|center|audit)\.html$/i.test(p2)
        ) {
          titleEl.content = "妙脆角后台";
        } else {
          titleEl.content = "妙脆角";
        }
      }
    } catch (eTitle2) {}
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
      '<div class="mcj-pwa-logo-wrap" aria-hidden="true">' +
      '<img class="mcj-pwa-logo" src="' +
      logoSrc() +
      '" alt="" width="56" height="56" decoding="async" fetchpriority="high">' +
      "</div>" +
      "<div>" +
      '<h2 id="mcjPwaTitle">把妙脆角装到主屏幕</h2>' +
      '<p data-mcj-pwa-sub>打开更快，使用起来更像 App</p>' +
      "</div></div>" +
      '<div data-mcj-pwa-body></div>' +
      '<div class="mcj-pwa-actions" data-mcj-pwa-actions></div>' +
      "</div>";
    document.body.appendChild(rootEl);
    var logoImg = rootEl.querySelector(".mcj-pwa-logo");
    var logoWrap = rootEl.querySelector(".mcj-pwa-logo-wrap");
    if (logoWrap) {
      logoWrap.style.backgroundImage = 'url("' + logoSrc().replace(/"/g, "") + '")';
    }
    bindLogoFallback(logoImg);

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
