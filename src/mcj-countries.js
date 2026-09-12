/**
 * Shared country / dial-code catalog for boss registration & admin filters.
 * Additive only — does not affect settlement or order logic.
 */
(function (root) {
  "use strict";

  var COUNTRIES = [
    { code: "MY", name: "Malaysia", nameZh: "马来西亚", dial: "+60", flag: "🇲🇾" },
    { code: "CN", name: "China", nameZh: "中国", dial: "+86", flag: "🇨🇳" },
    { code: "SG", name: "Singapore", nameZh: "新加坡", dial: "+65", flag: "🇸🇬" },
    { code: "TW", name: "Taiwan", nameZh: "台湾", dial: "+886", flag: "🇹🇼" },
    { code: "HK", name: "Hong Kong", nameZh: "香港", dial: "+852", flag: "🇭🇰" },
    { code: "JP", name: "Japan", nameZh: "日本", dial: "+81", flag: "🇯🇵" },
    { code: "KR", name: "South Korea", nameZh: "韩国", dial: "+82", flag: "🇰🇷" },
    { code: "TH", name: "Thailand", nameZh: "泰国", dial: "+66", flag: "🇹🇭" },
    { code: "ID", name: "Indonesia", nameZh: "印尼", dial: "+62", flag: "🇮🇩" },
    { code: "PH", name: "Philippines", nameZh: "菲律宾", dial: "+63", flag: "🇵🇭" },
    { code: "VN", name: "Vietnam", nameZh: "越南", dial: "+84", flag: "🇻🇳" },
    { code: "US", name: "United States", nameZh: "美国", dial: "+1", flag: "🇺🇸" },
    { code: "GB", name: "United Kingdom", nameZh: "英国", dial: "+44", flag: "🇬🇧" },
    { code: "AU", name: "Australia", nameZh: "澳大利亚", dial: "+61", flag: "🇦🇺" },
    { code: "CA", name: "Canada", nameZh: "加拿大", dial: "+1", flag: "🇨🇦" },
    { code: "DE", name: "Germany", nameZh: "德国", dial: "+49", flag: "🇩🇪" },
    { code: "FR", name: "France", nameZh: "法国", dial: "+33", flag: "🇫🇷" },
  ];

  function byCode(code) {
    var key = String(code || "MY").toUpperCase();
    return COUNTRIES.find(function (c) {
      return c.code === key;
    }) || COUNTRIES[0];
  }

  function digitsOnly(value) {
    return String(value || "").replace(/\D+/g, "");
  }

  function normalizeLocalPhone(local, dial) {
    var digits = digitsOnly(local);
    var dialDigits = digitsOnly(dial);
    // Strip leading 0 for national format, and accidental dial prefix
    if (dialDigits && digits.indexOf(dialDigits) === 0) digits = digits.slice(dialDigits.length);
    if (digits.charAt(0) === "0") digits = digits.slice(1);
    return digits;
  }

  function toE164(countryCode, localPhone) {
    var c = byCode(countryCode);
    var local = normalizeLocalPhone(localPhone, c.dial);
    if (!local) return "";
    return c.dial + local;
  }

  function optionHtml(selected) {
    var sel = String(selected || "MY").toUpperCase();
    return COUNTRIES.map(function (c) {
      return (
        '<option value="' +
        c.code +
        '" data-dial="' +
        c.dial +
        '"' +
        (c.code === sel ? " selected" : "") +
        ">" +
        c.flag +
        " " +
        c.nameZh +
        " (" +
        c.dial +
        ")</option>"
      );
    }).join("");
  }

  function labelOf(code) {
    var c = byCode(code);
    return c.flag + " " + c.nameZh;
  }

  root.MCJCountries = {
    list: COUNTRIES,
    byCode: byCode,
    digitsOnly: digitsOnly,
    normalizeLocalPhone: normalizeLocalPhone,
    toE164: toE164,
    optionHtml: optionHtml,
    labelOf: labelOf,
    defaultCode: "MY",
  };
})(typeof window !== "undefined" ? window : globalThis);
