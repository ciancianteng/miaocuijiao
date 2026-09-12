/**
 * Release Mode: no 「功能开发中」 intercept overlays on boss pages.
 * Non-core pages open with real empty states; core flows stay live.
 */
(function () {
  "use strict";
  if (window.__MCJLaunchFreeze) return;
  window.__MCJLaunchFreeze = true;

  // Release: do not freeze any public pages.
  var FROZEN = {};

  function hrefFile(href) {
    try {
      var u = new URL(href, location.href);
      if (u.origin !== location.origin) return "";
      var name = u.pathname.split("/").pop() || "";
      return String(name).toLowerCase();
    } catch (e) {
      return "";
    }
  }

  window.MCJLaunchFreeze = {
    isFrozen: function (hrefOrFile) {
      var f = String(hrefOrFile || "").toLowerCase();
      if (f.indexOf("/") >= 0 || f.indexOf(".html") >= 0) f = hrefFile(f) || f.split("/").pop();
      return !!FROZEN[f];
    },
    show: function () {},
    message: "",
    releaseMode: true,
  };
})();
