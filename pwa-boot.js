/**
 * MCJ PWA boot — keep standalone across multi-HTML portals.
 * - Pick portal-specific manifest (different start_url / id) so home-screen
 *   launches open boss / companion / CS / admin — not always "/".
 * - Re-assert apple-web-app meta (static tags remain primary for iOS).
 * - Register SW at scope "/".
 * - Load shared PWA install guide.
 * - In standalone/display-mode, force same-origin navigations to stay in-app
 *   (no target=_blank / window.open that would eject to Safari).
 */
(function () {
  var ICON_V = "20260912pwaPortal2";
  var INSTALL_V = "20260912pwaPortal2";

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
    if (/^\/companion(\/|$)/i.test(p) || /^\/companion-apply\.html$/i.test(p)) {
      return {
        key: "companion",
        manifest: "/manifest-companion.webmanifest",
        title: "妙脆角陪玩",
      };
    }
    if (/^\/customer-service(\/|$)/i.test(p)) {
      return {
        key: "cs",
        manifest: "/manifest-cs.webmanifest",
        title: "妙脆角客服",
      };
    }
    if (
      /^\/admin(\/|$)/i.test(p) ||
      /^\/admin\.html$/i.test(p) ||
      /^\/admin-(dashboard|center|audit)\.html$/i.test(p)
    ) {
      return {
        key: "admin",
        manifest: "/manifest-admin.webmanifest",
        title: "妙脆角后台",
      };
    }
    return {
      key: "boss",
      manifest: "/manifest.webmanifest",
      title: "妙脆角",
    };
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
    try {
      document.title = document.title || portal.title;
    } catch (e3) {}
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
    window.open = function (url, target, features) {
      var u = sameOriginUrl(String(url || ""));
      if (u) {
        location.assign(u.pathname + u.search + u.hash);
        return null;
      }
      return nativeOpen.apply(window, arguments);
    };
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
    if (
      document.querySelector('script[data-mcj-pwa-install-js]') ||
      window.__MCJPwaInstallLoaded
    ) {
      return;
    }
    var js = document.createElement("script");
    js.src = "/src/pwa-install-prompt.js?v=" + INSTALL_V;
    js.defer = true;
    js.setAttribute("data-mcj-pwa-install-js", "1");
    document.head.appendChild(js);
  }

  ensureHead();
  loadInstallGuide();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
      ensureHead();
      registerSw();
      installNavGuards();
      loadInstallGuide();
    });
  } else {
    registerSw();
    installNavGuards();
  }
})();
