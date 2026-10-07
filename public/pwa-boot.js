/**
 * MCJ PWA boot — keep standalone across multi-HTML portals.
 * - Pick portal-specific manifest (different start_url / id) so home-screen
 *   launches open boss / companion / CS / admin — not always "/".
 * - Re-assert apple-web-app meta (static tags remain primary for iOS).
 * - Register SW at scope "/" (shared Web Push / #248 — do not split SW scope).
 * - In standalone/display-mode, force same-origin navigations to stay in-app.
 * - Touch scroll stability (iOS Safari + PWA): no focus/double-tap/pinch zoom
 *   drift, no per-card GPU layers that render as black tiles while scrolling.
 */
(function () {
  var ICON_V = "20260914pwaPortal4";
  var INSTALL_V = "20260914pwaPortal4";

  // Companion cards (dozens per carousel/grid) sit on a >=96% opaque gradient,
  // so their backdrop blur is invisible but each costs a composited layer that
  // iOS drops as black tiles while scrolling. They are position:relative, so
  // absolute children keep their containing block; isolation keeps stacking.
  // Fixed/sticky chrome (header, tabbar, drawers, modals) keeps its blur.
  var FLAT_CARD_SELECTOR = ".neon-card,.companion-card,.hot-card";
  var TOUCH_STABILITY_CSS =
    "@media (hover:none) and (pointer:coarse){" +
    "html{touch-action:manipulation;-webkit-text-size-adjust:100%;text-size-adjust:100%}" +
    // :not(#…) lifts specificity above the existing !important card rules.
    "html body :is(" + FLAT_CARD_SELECTOR + "):not(#mcj-touch-stability){" +
    "-webkit-backdrop-filter:none!important;backdrop-filter:none!important;" +
    "will-change:auto!important;isolation:isolate}" +
    "}";

  function isIOS() {
    try {
      var ua = navigator.userAgent || "";
      if (/iPad|iPhone|iPod/.test(ua)) return true;
      return navigator.platform === "MacIntel" && Number(navigator.maxTouchPoints || 0) > 1;
    } catch (e) {
      return false;
    }
  }

  function inStandalone() {
    try {
      if (window.navigator && navigator.standalone === true) return true;
      if (window.matchMedia && matchMedia("(display-mode: standalone)").matches) return true;
      if (window.matchMedia && matchMedia("(display-mode: minimal-ui)").matches) return true;
    } catch (e) {}
    return false;
  }

  /** @returns {{ key: string, manifest: string, title: string }} */
  function detectPortal() {
    var p = "";
    try {
      p = String(location.pathname || "/");
    } catch (e) {
      p = "/";
    }
    if (/^\/companion\/pw\d+\/?$/i.test(p)) {
      return { key: "boss", manifest: "/manifest.webmanifest", title: "妙脆角老板" };
    }
    if (/^\/companion(\/|$)/i.test(p) || /^\/companion-apply\.html$/i.test(p)) {
      return { key: "companion", manifest: "/manifest-companion.webmanifest", title: "妙脆角陪玩" };
    }
    if (/^\/customer-service(\/|$)/i.test(p)) {
      return { key: "cs", manifest: "/manifest-cs.webmanifest", title: "妙脆角客服" };
    }
    if (
      /^\/admin(\/|$)/i.test(p) ||
      /^\/admin\.html$/i.test(p) ||
      /^\/admin-(dashboard|center|audit)\.html$/i.test(p)
    ) {
      return { key: "admin", manifest: "/manifest-admin.webmanifest", title: "妙脆角后台" };
    }
    return { key: "boss", manifest: "/manifest.webmanifest", title: "妙脆角老板" };
  }

  function ensureHead() {
    if (!document.head) return;
    var portal = detectPortal();
    try {
      window.__MCJ_PWA_PORTAL__ = portal.key;
    } catch (e) {}

    function upsertMeta(name, content) {
      var el = document.head.querySelector('meta[name="' + name + '"]');
      if (!el) {
        el = document.createElement("meta");
        el.setAttribute("name", name);
        document.head.appendChild(el);
      }
      el.setAttribute("content", content);
    }
    function upsertLink(rel, href, attrs) {
      var sel = 'link[rel="' + rel + '"]';
      if (attrs && attrs.sizes) sel += '[sizes="' + attrs.sizes + '"]';
      var el = document.head.querySelector(sel);
      if (!el) {
        el = document.createElement("link");
        el.rel = rel;
        document.head.appendChild(el);
      }
      el.href = href;
      if (attrs) Object.keys(attrs).forEach(function (k) { el.setAttribute(k, attrs[k]); });
    }

    // Prefer a single canonical manifest link for the active portal.
    // CRITICAL: never force boss manifest onto companion/CS/admin pages.
    var existingManifests = document.head.querySelectorAll('link[rel="manifest"]');
    var primary = existingManifests[0];
    if (!primary) {
      primary = document.createElement("link");
      primary.rel = "manifest";
      document.head.appendChild(primary);
    }
    primary.href = portal.manifest + "?v=" + ICON_V;
    primary.setAttribute("data-mcj-pwa-portal", portal.key);
    for (var i = 1; i < existingManifests.length; i++) {
      try {
        existingManifests[i].parentNode.removeChild(existingManifests[i]);
      } catch (e2) {}
    }

    upsertLink("apple-touch-icon", "/apple-touch-icon.png?v=" + ICON_V);
    upsertMeta("apple-mobile-web-app-capable", "yes");
    upsertMeta("apple-mobile-web-app-title", portal.title);
    upsertMeta("apple-mobile-web-app-status-bar-style", "black-translucent");
    upsertMeta("theme-color", "#0a0610");
    upsertMeta("mobile-web-app-capable", "yes");
  }

  function registerSw() {
    if (!("serviceWorker" in navigator)) return;
    try {
      navigator.serviceWorker.register("/sw-mcj.js", { scope: "/" }).catch(function () {});
    } catch (e) {}
  }

  function sameOriginUrl(raw) {
    try {
      var u = new URL(raw, location.href);
      return u.origin === location.origin ? u : null;
    } catch (e) {
      return null;
    }
  }

  function installNavGuards() {
    if (!inStandalone()) return;
    document.addEventListener(
      "click",
      function (ev) {
        var a = ev.target && ev.target.closest ? ev.target.closest("a[href]") : null;
        if (!a) return;
        var href = a.getAttribute("href") || "";
        if (!href || href.charAt(0) === "#" || /^(mailto:|tel:|javascript:)/i.test(href)) return;
        var u = sameOriginUrl(href);
        if (!u) return;
        var target = (a.getAttribute("target") || "").toLowerCase();
        if (target === "_blank" || a.hasAttribute("download")) {
          ev.preventDefault();
          location.assign(u.pathname + u.search + u.hash);
        }
      },
      true
    );
    var nativeOpen = window.open;
    window.open = function (url) {
      var u = sameOriginUrl(String(url || ""));
      if (u) {
        location.assign(u.pathname + u.search + u.hash);
        return null;
      }
      return nativeOpen.apply(window, arguments);
    };
  }

  function installTouchStyles() {
    if (!document.head || document.querySelector("style[data-mcj-touch-stability]")) return;
    var style = document.createElement("style");
    style.setAttribute("data-mcj-touch-stability", "1");
    style.textContent = TOUCH_STABILITY_CSS;
    document.head.appendChild(style);
  }

  // iOS zooms into inputs under 16px and keeps the zoom after blur; it also
  // zooms out to fit any overflow. Pin the scale (Safari still honours user
  // pinch for accessibility; Android is left untouched).
  function lockIOSViewportScale() {
    if (!isIOS() || !document.head) return;
    var meta = document.head.querySelector('meta[name="viewport"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", "viewport");
      document.head.insertBefore(meta, document.head.firstChild);
    }
    var order = [];
    var map = {};
    String(meta.getAttribute("content") || "").split(",").forEach(function (part) {
      var kv = part.split("=");
      var k = String(kv[0] || "").trim().toLowerCase();
      if (!k) return;
      if (!(k in map)) order.push(k);
      map[k] = String(kv.slice(1).join("=") || "").trim();
    });
    var want = { width: "device-width", "initial-scale": "1", "minimum-scale": "1", "maximum-scale": "1" };
    Object.keys(want).forEach(function (k) {
      if (k === "width" && map.width) return;
      if (!(k in map)) order.push(k);
      map[k] = want[k];
    });
    var next = order.map(function (k) { return k + "=" + map[k]; }).join(", ");
    if (meta.getAttribute("content") !== next) meta.setAttribute("content", next);
  }

  // Home-screen web app has no browser chrome to reset a stray pinch zoom.
  function blockStandalonePinch() {
    if (!isIOS() || !inStandalone() || window.__MCJ_PINCH_GUARD__) return;
    window.__MCJ_PINCH_GUARD__ = true;
    var stop = function (ev) { ev.preventDefault(); };
    ["gesturestart", "gesturechange", "gestureend"].forEach(function (type) {
      document.addEventListener(type, stop, { passive: false });
    });
  }

  function loadInstallGuide() {
    if (!document.head) return;
    if (!document.querySelector('link[data-mcj-pwa-install-css]')) {
      var css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = "/src/pwa-install-prompt.css?v=" + INSTALL_V;
      css.setAttribute("data-mcj-pwa-install-css", "1");
      document.head.appendChild(css);
    }
    if (!document.querySelector('script[data-mcj-pwa-install-js]')) {
      var s = document.createElement("script");
      s.src = "/src/pwa-install-prompt.js?v=" + INSTALL_V;
      s.defer = true;
      s.setAttribute("data-mcj-pwa-install-js", "1");
      document.head.appendChild(s);
    }
  }

  ensureHead();
  lockIOSViewportScale();
  installTouchStyles();
  blockStandalonePinch();
  registerSw();
  installNavGuards();
  loadInstallGuide();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      ensureHead();
      registerSw();
      installNavGuards();
    });
  }
})();
