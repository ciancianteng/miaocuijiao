(function (root) {
  "use strict";
  var ICON =
    '<svg class="mcj-bell-ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M6 9a6 6 0 0 1 12 0c0 7 3 7 3 9H3c0-2 3-2 3-9"/>' +
    '<path d="M10 21a2 2 0 0 0 4 0"/>' +
    "</svg>";

  function ensureCss() {
    if (document.getElementById("mcj-bell-css")) return;
    var style = document.createElement("style");
    style.id = "mcj-bell-css";
    style.textContent =
      ".mcj-bell{position:relative;display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;min-width:36px;flex:0 0 36px;padding:0;margin:0;border:0;border-radius:50%;background:transparent;color:#ffd6ea;text-decoration:none;box-shadow:none;line-height:0;vertical-align:middle}" +
      ".mcj-bell-ico{width:22px;height:22px;display:block}" +
      ".mcj-bell [data-mcj-badge-count]{position:absolute;top:2px;right:2px;min-width:16px;height:16px;padding:0 4px;border-radius:999px;background:#ff8fc5;color:#1a0710;font-size:10px;font-weight:800;line-height:16px;text-align:center;box-sizing:border-box;pointer-events:none}" +
      ".mcj-bell [data-mcj-badge-count][hidden]{display:none!important}" +
      ".pw-header-bell.pw-btn{width:36px;height:36px;min-width:36px;flex:0 0 36px;padding:0;border:0;background:transparent;box-shadow:none}" +
      "header.mcj-boss-header .mcj-bell{align-self:center;flex:0 0 36px!important;position:relative;z-index:3}" +
      "a.mcj-bell,button.mcj-bell,a.cs-bell.mcj-bell,a.mcj-header-bell.mcj-bell{width:36px !important;height:36px !important;min-width:36px !important;flex:0 0 36px !important;padding:0 !important;border:0 !important;border-radius:50% !important;background:transparent !important;box-shadow:none !important;color:#ffd6ea !important}" +
      ".cs-account{display:flex;align-items:center;gap:8px;flex:0 0 auto}" +
      ".cs-top > div:first-child{min-width:0}" +
      "@media(max-width:899px){header.mcj-boss-header .mcj-header-brand{flex:1 1 auto!important;min-width:0!important;max-width:calc(100% - 96px)!important;overflow:hidden!important}header.mcj-boss-header .mcj-header-brand-en,header.mcj-boss-header .mcj-header-brand-zh{max-width:100%!important;overflow:hidden!important;text-overflow:ellipsis!important}header.mcj-boss-header .mcj-bell{margin-left:8px!important}}";
    document.head.appendChild(style);
  }

  function icon() {
    return ICON;
  }

  function inner(count) {
    var n = Number(count);
    var show = isFinite(n) && n > 0;
    var label = show ? (n > 99 ? "99+" : String(Math.floor(n))) : "";
    return ICON + '<span data-mcj-badge-count class="mcj-bell-badge"' + (show ? "" : " hidden") + ">" + label + "</span>";
  }

  root.MCJBell = { ensureCss: ensureCss, icon: icon, inner: inner };
  if (typeof document !== "undefined" && document.head) ensureCss();
})(typeof globalThis !== "undefined" ? globalThis : this);
