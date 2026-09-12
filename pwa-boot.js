/**
 * MCJ PWA boot — keep standalone across multi-HTML portals.
 * - Re-assert apple-web-app meta (static tags remain primary for iOS).
 * - Register SW at scope "/".
 * - Load shared PWA install guide (boss / companion / CS / admin).
 * - In standalone/display-mode, force same-origin navigations to stay in-app
 *   (no target=_blank / window.open that would eject to Safari).
 */
(function () {
  var ICON_V = "20260911pwa3";
  var INSTALL_V = "20260912pwaSheet2";
  function inStandalone() {
    try {
      if (window.navigator && navigator.standalone === true) return true;
      if (window.matchMedia && matchMedia("(display-mode: standalone)").matches) return true;
      if (window.matchMedia && matchMedia("(display-mode: minimal-ui)").matches) return true;
    } catch (e) {}
    return false;
  }
  function ensureHead() {
    if (!document.head) return;
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
    upsertLink("manifest", "/manifest.webmanifest?v=" + ICON_V);
    upsertLink("apple-touch-icon", "/apple-touch-icon.png?v=" + ICON_V);
    upsertMeta("apple-mobile-web-app-capable", "yes");
    upsertMeta("apple-mobile-web-app-title", "妙脆角");
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
        if (!u) return; // external: leave alone
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
      registerSw();
      installNavGuards();
      loadInstallGuide();
    });
  } else {
    registerSw();
    installNavGuards();
  }
})();
