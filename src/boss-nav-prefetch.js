/**
 * Low-priority prefetch of common boss page shells after mine (or other hubs) become usable.
 * Prefetches HTML + shared static JS/CSS only — never sensitive realtime APIs.
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

  function injectLink(url, as) {
    if (!url || already(url)) return;
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
    if (!url || already(url)) return;
    if (window.fetch) {
      fetch(url, {
        method: "GET",
        credentials: "same-origin",
        cache: "force-cache",
        priority: "low",
      })
        .catch(function () {})
        .finally(function () {
          mark(url);
        });
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
        prefetchUrl(p);
        injectLink(p, "document");
      });
      assets.forEach(function (a) {
        var as = /\.css(\?|$)/i.test(a) ? "style" : /\.js(\?|$)/i.test(a) ? "script" : undefined;
        injectLink(a, as);
        prefetchUrl(a);
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
