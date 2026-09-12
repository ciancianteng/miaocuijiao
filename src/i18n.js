/**
 * Boss/public i18n runtime (phase 1).
 * Locales: zh-CN (default) + en. Preference: localStorage mcj_locale.
 * Fallback: missing en key → zh-CN → key (dev only; production prefers zh-CN text).
 * Does not alter API payloads, auth, pricing, or PWA start_url.
 */
(function (root) {
  "use strict";

  var STORAGE_KEY = "mcj_locale";
  var DEFAULT_LOCALE = "zh-CN";
  var SUPPORTED = { "zh-CN": true, en: true };
  var catalog = (root.__MCJ_I18N_CATALOG__ && typeof root.__MCJ_I18N_CATALOG__ === "object")
    ? root.__MCJ_I18N_CATALOG__
    : { "zh-CN": {}, en: {} };

  function normalizeLocale(raw) {
    var v = String(raw || "").trim();
    if (v === "zh" || v === "zh_CN" || v === "zh-cn" || v === "cn") return "zh-CN";
    if (v === "en" || v === "en-US" || v === "en-GB" || v === "english") return "en";
    if (SUPPORTED[v]) return v;
    return DEFAULT_LOCALE;
  }

  function readStoredLocale() {
    try {
      var fromLs = localStorage.getItem(STORAGE_KEY);
      if (fromLs) return normalizeLocale(fromLs);
    } catch (e0) {}
    try {
      var fromSs = sessionStorage.getItem(STORAGE_KEY);
      if (fromSs) return normalizeLocale(fromSs);
    } catch (e1) {}
    return DEFAULT_LOCALE;
  }

  function persistLocale(locale) {
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch (e0) {}
    try {
      sessionStorage.setItem(STORAGE_KEY, locale);
    } catch (e1) {}
  }

  var current = readStoredLocale();

  function pack(locale) {
    return catalog[locale] || {};
  }

  function t(key, vars) {
    var k = String(key || "");
    if (!k) return "";
    var primary = pack(current);
    var fallback = pack(DEFAULT_LOCALE);
    var text = primary[k];
    if (text == null || text === "") text = fallback[k];
    if (text == null || text === "") text = k;
    text = String(text);
    if (vars && typeof vars === "object") {
      text = text.replace(/\{(\w+)\}/g, function (_, name) {
        return vars[name] != null ? String(vars[name]) : "{" + name + "}";
      });
    }
    return text;
  }

  function applyElement(el) {
    if (!el || el.nodeType !== 1) return;
    var key = el.getAttribute("data-i18n");
    if (key) {
      var mode = el.getAttribute("data-i18n-mode") || "text";
      var val = t(key);
      if (mode === "html") el.innerHTML = val;
      else el.textContent = val;
    }
    var ph = el.getAttribute("data-i18n-placeholder");
    if (ph) el.setAttribute("placeholder", t(ph));
    var aria = el.getAttribute("data-i18n-aria");
    if (aria) el.setAttribute("aria-label", t(aria));
    var title = el.getAttribute("data-i18n-title");
    if (title) el.setAttribute("title", t(title));
    var valueKey = el.getAttribute("data-i18n-value");
    if (valueKey && "value" in el) el.value = t(valueKey);
  }

  function apply(rootEl) {
    var scope = rootEl && rootEl.querySelectorAll ? rootEl : document;
    if (!scope || !scope.querySelectorAll) return;
    if (scope.nodeType === 1) applyElement(scope);
    scope.querySelectorAll("[data-i18n], [data-i18n-placeholder], [data-i18n-aria], [data-i18n-title], [data-i18n-value]").forEach(applyElement);
    try {
      document.documentElement.setAttribute("lang", current === "en" ? "en" : "zh-CN");
      document.documentElement.setAttribute("data-mcj-locale", current);
    } catch (eLang) {}
  }

  function setLocale(locale, opts) {
    opts = opts || {};
    var next = normalizeLocale(locale);
    var prev = current;
    current = next;
    persistLocale(next);
    if (!opts.skipApply) apply(document);
    if (!opts.silent && prev !== next) {
      try {
        root.dispatchEvent(
          new CustomEvent("mcj:localechange", {
            detail: { locale: next, previous: prev },
          })
        );
      } catch (eEvt) {}
    }
    return current;
  }

  function getLocale() {
    return current;
  }

  function has(key, locale) {
    var packLocale = pack(locale || current);
    return Object.prototype.hasOwnProperty.call(packLocale, key);
  }

  // Keep stub-compatible surface.
  var api = {
    locale: current,
    fallbackLocale: DEFAULT_LOCALE,
    supported: ["zh-CN", "en"],
    storageKey: STORAGE_KEY,
    t: t,
    setLocale: function (locale) {
      var next = setLocale(locale);
      api.locale = next;
      return next;
    },
    getLocale: getLocale,
    apply: apply,
    has: has,
    ready: true,
  };

  Object.defineProperty(api, "locale", {
    get: function () {
      return current;
    },
    set: function (v) {
      setLocale(v);
    },
  });

  root.MCJI18n = api;
  root.MCJLocaleReady = root.MCJLocaleReady || {
    multiLanguage: true,
    multiCurrency: false,
    internationalPayment: false,
    languages: ["zh-CN", "en"],
    displayCurrencies: ["MYR"],
    paymentRails: ["manual"],
  };
  root.MCJLocaleReady.multiLanguage = true;
  root.MCJLocaleReady.languages = ["zh-CN", "en"];

  // Early apply when DOM is ready.
  function bootApply() {
    apply(document);
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bootApply);
  } else {
    bootApply();
  }
})(typeof window !== "undefined" ? window : globalThis);
