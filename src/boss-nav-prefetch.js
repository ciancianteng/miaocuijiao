/**
 * Low-priority prefetch of common boss page shells after mine (or other hubs) become usable.
 * Prefetches shared static JS/CSS only (no-store HTML shells are skipped) — never sensitive realtime APIs.
 */
(function () {
  "use strict";
  if (window.MCJBossNavPrefetch) return;

  var DONE_KEY = "mcjBossNavPrefetch.v1";
  var DEFAULT_PAGES = [
    "orders.html",
    "messages.html",
    "support.html",
    "recharge.html",
    "companion-center.html",
  ];
  var DEFAULT_ASSETS = [
    "/src/boss-auth-session.js?v=20260911authPerfP0",
    "/src/role-gates.js?v=20260911authPerfP0",
    "/src/boss-header.js",
    "/src/boss-header.css",
    "/src/boss-profile-cache.js?v=20260911perfP2",
    "/portal-early-gate.js?v=20260911authPerfP0",
  ];

  function already(url) {
    try {
      var raw = sessionStorage.getItem(DONE_KEY);
      var map = raw ? JSON.parse(raw) : {};
      return !!map[url];
    } catch (e) {
      return false;
    }
  }

  function mark(url) {
    try {
      var raw = sessionStorage.getItem(DONE_KEY);
      var map = raw ? JSON.parse(raw) : {};
      map[url] = Date.now();
      sessionStorage.setItem(DONE_KEY, JSON.stringify(map));
    } catch (e) {}
  }

  function loadedOnPage(url) {
    try {
      return performance.getEntriesByName(new URL(url, location.href).href).length > 0;
    } catch (e) {
      return false;
    }
  }

  // HTML is served with Cache-Control: no-store, so a prefetched page can never be
  // reused by the next navigation — fetching it only doubles the download.
  function isPageShell(url) {
    var path = String(url || "").split(/[?#]/)[0];
    return /\.html$/i.test(path) || /\/$/.test(path) || path === "";
  }

  function injectLink(url, as) {
    if (!url || already(url) || isPageShell(url)) return;
    if (loadedOnPage(url)) {
      mark(url);
      return;
    }
    if (document.querySelector('link[data-mcj-prefetch="' + url + '"]')) return;
    var link = document.createElement("link");
    link.rel = "prefetch";
    link.href = url;
    if (as) link.as = as;
    link.setAttribute("data-mcj-prefetch", url);
    document.head.appendChild(link);
    mark(url);
  }

  function prefetchUrl(url) {
    if (!url || already(url) || isPageShell(url)) return;
    if (loadedOnPage(url)) {
      mark(url);
      return;
    }
    if (window.fetch) {
      mark(url);
      fetch(url, {
        method: "GET",
        credentials: "same-origin",
        cache: "force-cache",
        priority: "low",
      }).catch(function () {});
      return;
    }
    injectLink(url);
  }

  function run(opts) {
    opts = opts || {};
    var pages = opts.pages || DEFAULT_PAGES;
    var assets = opts.assets || DEFAULT_ASSETS;
    var delay = opts.delayMs != null ? opts.delayMs : 700;
    var start = function () {
      pages.forEach(function (p) {
        injectLink(p, "document");
      });
      assets.forEach(function (a) {
        var as = /\.css(\?|$)/i.test(a) ? "style" : /\.js(\?|$)/i.test(a) ? "script" : undefined;
        injectLink(a, as);
      });
    };
    if (typeof requestIdleCallback === "function") {
      requestIdleCallback(function () {
        setTimeout(start, delay);
      }, { timeout: 2500 });
    } else {
      setTimeout(start, delay + 200);
    }
  }

  window.MCJBossNavPrefetch = { run: run, prefetchUrl: prefetchUrl };
})();
