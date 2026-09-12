/**
 * Meow Butler floating widget — permanently removed from public pages.
 * This stub only strips leftover DOM/CSS so old caches cannot resurrect the float.
 * Bosses contact CS via 消息中心 / support.html (客服中心), not a homepage float.
 */
(function () {
  "use strict";
  if (window.__MCJMeowButlerRemoved) return;
  window.__MCJMeowButlerRemoved = true;
  window.__MCJMeowButlerDisabled = true;
  window.__MCJMeowButlerLoaded = true;

  var SELECTOR = [
    "#floatingCustomerService",
    "#floatingService",
    ".floating-service",
    ".floating-cs-button",
    ".floating-cs-panel",
    ".floating-cs-root",
    ".service-float",
    ".online-service",
    "#mcjButler",
    "#mcjButlerModal",
    "#mcjFloatingAssistant",
    "#mcjFloatingAssistantBackdrop",
    "[data-mcj-meow-butler]",
    "link[data-mcj-meow-butler-css]",
    'script[src*="meow-butler.js"]',
  ].join(",");

  function purge() {
    try {
      document.querySelectorAll(SELECTOR).forEach(function (el) {
        if (el && el.parentNode) el.parentNode.removeChild(el);
      });
      document.documentElement.classList.remove("mcj-floating-cs-lock");
      if (document.body) document.body.classList.remove("mcj-floating-cs-lock");
    } catch (e) {}
  }

  purge();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", purge);
  }
  window.addEventListener("load", purge);
  // Catch late injections from stale bundles.
  setTimeout(purge, 0);
  setTimeout(purge, 500);
  setTimeout(purge, 2000);
})();
