(function () {
  "use strict";

  /** Platform clock = Asia/Kuala_Lumpur (UTC+8, no DST). Returns a Date whose getUTC* fields are KL wall-clock.
   *  Zoned strings (Z / ±hh:mm) are converted; zone-less strings are already KL wall-clock and kept as-is. */
  function klDate(v) {
    if (v == null || v === "") return null;
    if (typeof v === "number" || v instanceof Date) {
      var t = new Date(v);
      return isNaN(t.getTime()) ? null : new Date(t.getTime() + 288e5);
    }
    var s = String(v).trim();
    var n = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?$/);
    if (n) return new Date(Date.UTC(+n[1], +n[2] - 1, +n[3], +(n[4] || 0), +(n[5] || 0), +(n[6] || 0)));
    var d = new Date(s.replace(/^(\d{4}-\d{2}-\d{2}) /, "$1T").replace(/([+-]\d{2})(\d{2})$/, "$1:$2").replace(/([+-]\d{2})$/, "$1:00"));
    return isNaN(d.getTime()) ? null : new Date(d.getTime() + 288e5);
  }

  function fmtContentTime(v, withSeconds) {
    if (!v) return "";
    var d = klDate(v);
    if (!d) return String(v);
    function p(n) { return n < 10 ? "0" + n : String(n); }
    return (
      d.getUTCFullYear() + "-" + p(d.getUTCMonth() + 1) + "-" + p(d.getUTCDate()) + " " +
      p(d.getUTCHours()) + ":" + p(d.getUTCMinutes()) + (withSeconds ? ":" + p(d.getUTCSeconds()) : "")
    );
  }

  window.MCJContentTime = { fmtContentTime: fmtContentTime, klDate: klDate };
})();
