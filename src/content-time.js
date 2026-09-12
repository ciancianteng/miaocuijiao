(function () {
  "use strict";

  function fmtContentTime(v) {
    if (!v) return "";
    try {
      return new Intl.DateTimeFormat("sv-SE", {
        timeZone: "Asia/Kuala_Lumpur",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      })
        .format(new Date(v))
        .replace(" ", " ");
    } catch (e) {
      return String(v).slice(0, 16).replace("T", " ");
    }
  }

  window.MCJContentTime = { fmtContentTime: fmtContentTime };
})();
