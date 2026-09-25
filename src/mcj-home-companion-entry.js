/**
 * Home-only companion entry CTA — do NOT load full companion-application.js on homepage.
 */
(function () {
  "use strict";
  function existingApplication() {
    try {
      var raw = localStorage.getItem("mcjCompanionApplication") || localStorage.getItem("companionApplication");
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch (e) {
      return null;
    }
  }
  function init() {
    var entry = document.querySelector("[data-companion-entry]");
    if (!entry) return;
    var app = existingApplication();
    if (app && (app.status === "approved" || app.applicationStatus === "approved")) {
      entry.href = "companion/index.html";
      entry.innerHTML = "<i>🐱</i><div><strong>陪玩中心</strong><span>进入工作台，开始接单</span></div>";
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
