/**
 * Platform currency display helpers.
 * Internal surfaces: 猫粮 only.
 * RM only for recharge / third-party payment pages.
 */
(function (root) {
  "use strict";

  function amountNumber(value) {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    var match = String(value == null ? "" : value).replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
    var n = match ? Number(match[0]) : 0;
    return Number.isFinite(n) ? n : 0;
  }

  function trimAmount(value) {
    var n = amountNumber(value);
    if (Math.abs(n - Math.round(n)) < 0.005) return String(Math.round(n));
    return (Math.round(n * 100) / 100).toFixed(2).replace(/\.?0+$/, "");
  }

  /** Example: 🐱 60 猫粮 */
  function formatAmount(value) {
    return "🐱 " + trimAmount(value) + " 猫粮";
  }

  /** Example: 60 猫粮 */
  function formatPlain(value) {
    return trimAmount(value) + " 猫粮";
  }

  /** Example: 30 猫粮/小时 */
  function formatRate(value, unit) {
    var u = String(unit == null || unit === "" ? "小时" : unit).replace(/^\/+/, "");
    if (/^hr$/i.test(u)) u = "小时";
    return trimAmount(value) + " 猫粮/" + u;
  }

  /** Example: 20–30 猫粮 */
  function formatRange(min, max, maxPlus) {
    var a = trimAmount(min);
    var b = trimAmount(max);
    return a + "–" + b + (maxPlus ? "+" : "") + " 猫粮";
  }

  /** Third-party / recharge only. Example: RM60.00 */
  function formatRm(value) {
    var n = amountNumber(value);
    return "RM" + (Number.isFinite(n) ? n : 0).toFixed(2);
  }

  /** Rewrite legacy "RM30/小时" / "RM60.00" / "RM20-RM30" strings into 猫粮 copy. */
  function rewriteLegacy(text) {
    var raw = String(text == null ? "" : text);
    if (!raw) return raw;
    if (/猫粮/.test(raw) && !/RM/i.test(raw)) return raw;
    var rangeRm = raw.match(/RM\s*(\d+(?:\.\d+)?)\s*[-–]\s*RM?\s*(\d+(?:\.\d+)?)/i);
    if (rangeRm) return formatRange(rangeRm[1], rangeRm[2], /\+/.test(raw));
    var hourly = raw.match(/RM\s*(\d+(?:\.\d+)?)\s*\/\s*(小时|hr|h)/i);
    if (hourly) return formatRate(hourly[1], hourly[2]);
    var range = raw.match(/(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)/);
    if (range && /RM/i.test(raw)) return formatRange(range[1], range[2], /\+/.test(raw));
    var plain = raw.match(/RM\s*(\d+(?:\.\d+)?)/i);
    if (plain) {
      if (/\/\s*(小时|hr|h)/i.test(raw) || /每小时/.test(raw)) return formatRate(plain[1], "小时");
      return formatPlain(plain[1]);
    }
    return raw;
  }

  var api = {
    amountNumber: amountNumber,
    trimAmount: trimAmount,
    formatAmount: formatAmount,
    formatPlain: formatPlain,
    formatRate: formatRate,
    formatRange: formatRange,
    formatRm: formatRm,
    rewriteLegacy: rewriteLegacy,
  };

  root.MCJCurrency = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
