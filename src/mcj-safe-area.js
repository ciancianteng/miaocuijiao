/* iPhone portrait fallback when viewport-fit=cover is set but the
   WebView still reports a 0 inset and draws under the Dynamic Island
   or Home Indicator. If env() is already non-zero, leave that side
   alone so the inset is not applied twice. */
(function () {
  if (window.__MCJSafeAreaBoot) return;
  window.__MCJSafeAreaBoot = true;

  function readEnv(side) {
    var probe = document.createElement("div");
    probe.setAttribute("aria-hidden", "true");
    probe.style.cssText =
      "position:fixed;left:0;top:0;visibility:hidden;pointer-events:none;" +
      "padding-" + side + ":constant(safe-area-inset-" + side + ");" +
      "padding-" + side + ":env(safe-area-inset-" + side + ");";
    document.documentElement.appendChild(probe);
    var value = parseFloat(window.getComputedStyle(probe)["padding" + (side === "top" ? "Top" : "Bottom")]) || 0;
    probe.remove();
    return value;
  }

  function apply() {
    var root = document.documentElement;
    var iphone = /iPhone|iPod/.test(navigator.userAgent || "");
    var portrait = window.innerHeight >= window.innerWidth;
    var useFallback = iphone && portrait;
    if (!useFallback || readEnv("top") > 0) root.style.removeProperty("--mcj-sat");
    else root.style.setProperty("--mcj-sat", "59px");
    if (!useFallback || readEnv("bottom") > 0) root.style.removeProperty("--mcj-sab");
    else root.style.setProperty("--mcj-sab", "34px");
  }

  apply();
  window.addEventListener("orientationchange", apply);
  window.addEventListener("resize", apply);
  window.MCJApplySafeArea = apply;
})();
