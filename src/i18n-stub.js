/**
 * i18n / multi-currency / international payment stubs (structure only).
 * Do not wire UI strings yet — reserved for future V1.x.
 */
(function (root) {
  "use strict";

  root.MCJI18n = root.MCJI18n || {
    locale: "zh-CN",
    fallbackLocale: "en",
    t: function (key) {
      return String(key || "");
    },
    setLocale: function (locale) {
      this.locale = String(locale || this.fallbackLocale);
      return this.locale;
    },
  };

  root.MCJLocaleReady = root.MCJLocaleReady || {
    multiLanguage: false,
    multiCurrency: false,
    internationalPayment: false,
    /** Future: load language packs without changing order settlement. */
    languages: ["zh-CN", "en", "ms"],
    /** Future: display currencies; settlement remains MYR/猫粮. */
    displayCurrencies: ["MYR", "CNY", "SGD", "USD"],
    /** Future: payment rails. */
    paymentRails: ["manual", "fpx", "card", "intl_gateway"],
  };
})(typeof window !== "undefined" ? window : globalThis);
