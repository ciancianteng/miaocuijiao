/**
 * Boss order pages: every native datetime-local without an explicit min only offers
 * future times in business time (Asia/Kuala_Lumpur), independent of device timezone.
 */
(function () {
  "use strict";
  function myNowInputValue() {
    var parts = {};
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kuala_Lumpur",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date())
      .forEach(function (p) {
        parts[p.type] = p.value;
      });
    return parts.year + "-" + parts.month + "-" + parts.day + "T" + parts.hour + ":" + parts.minute;
  }
  function apply(root) {
    (root || document).querySelectorAll('input[type="datetime-local"]:not([data-mcj-min-managed])').forEach(function (el) {
      if (el.min) return;
      el.setAttribute("data-mcj-min-managed", "1");
      el.min = myNowInputValue();
      el.addEventListener("focus", function () {
        el.min = myNowInputValue();
      });
    });
  }
  window.MCJDateTimeMin = { apply: apply, now: myNowInputValue };
  function start() {
    apply(document);
    if (typeof MutationObserver === "function") {
      new MutationObserver(function () {
        apply(document);
      }).observe(document.body, { childList: true, subtree: true });
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
