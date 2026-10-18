/* iPhone portrait fallback when viewport-fit=cover is set but the
   WebView still reports a 0 top inset and draws under the Dynamic Island.
   If env() is already non-zero, leave it alone so the inset is not applied twice. */
(function () {
  if (window.__MCJSafeAreaBoot) return;
  window.__MCJSafeAreaBoot = true;

  function readEnvTop() {
    var probe = document.createElement("div");
    probe.setAttribute("aria-hidden", "true");
    probe.style.cssText = "position:fixed;left:0;top:0;padding-top:constant(safe-area-inset-top);padding-top:env(safe-area-inset-top);visibility:hidden;pointer-events:none;";
    document.documentElement.appendChild(probe);
    var value = parseFloat(window.getComputedStyle(probe).paddingTop) || 0;
    probe.remove();
    return value;
  }

  function apply() {
    var root = document.documentElement;
    var iphone = /iPhone/.test(navigator.userAgent || "");
    var portrait = window.innerHeight >= window.innerWidth;
    if (!iphone || !portrait || readEnvTop() > 0) {
      root.style.removeProperty("--mcj-sat");
      return;
    }
    /* iPhone 15 Pro Max status bar + Dynamic Island. */
    root.style.setProperty("--mcj-sat", "59px");
  }

  apply();
  window.addEventListener("orientationchange", apply);
  window.addEventListener("resize", apply);
  window.MCJApplySafeArea = apply;
})();
