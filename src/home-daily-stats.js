import "./home-trust-stats.css";
import "./home-brand-hero.css";
import "./home-app-mobile.css";
import "./home-banner-promo.css";

(function () {
  "use strict";

  var API_URL = "/api/gateway?path=" + encodeURIComponent("home/daily-stats");
  /* Homepage trust metrics only — never show 今日有效订单 / 今日营业额. */
  var lastData = null;
  var lastEmpty = false;

  function tt(key, fallback, vars) {
    try {
      if (window.MCJI18n && typeof window.MCJI18n.t === "function") {
        var out = window.MCJI18n.t(key, vars);
        if (out && out !== key) return out;
      }
    } catch (e) {}
    var text = fallback != null ? String(fallback) : String(key || "");
    if (vars && typeof vars === "object") {
      text = text.replace(/\{(\w+)\}/g, function (_, name) {
        return vars[name] != null ? String(vars[name]) : "{" + name + "}";
      });
    }
    return text;
  }

  function fieldDefs() {
    return [
      ["onlineCompanions", tt("home.stats_online", "在线陪玩"), "number"],
      ["completedOrders", tt("home.stats_orders", "完成订单"), "number"],
      ["goodRate", tt("home.stats_good_rate", "好评率"), "percent"],
    ];
  }

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function numberValue(data, key) {
    if (!data || data[key] == null || data[key] === "") return null;
    var number = Number(data[key]);
    return Number.isFinite(number) ? number : null;
  }

  function valueText(data, key, kind) {
    if (kind === "percent") {
      if (data && Number(data.reviewCount) === 0) return tt("home.stats_na", "暂无");
      if (data && data.goodRateLabel) return esc(data.goodRateLabel);
      var rate = numberValue(data, key);
      if (rate == null) rate = numberValue(data, "goodRatePercent");
      if (rate == null) return tt("home.stats_na", "暂无");
      return esc(String(rate).replace(/%$/, "") + "%");
    }
    var n = numberValue(data, key);
    if (n == null) return "—";
    return String(Math.round(n));
  }

  function statsRoot() {
    return (
      document.querySelector("[data-home-brand-hero-stats]") ||
      document.querySelector("[data-home-daily-stats]")
    );
  }

  function renderEmpty() {
    var root = statsRoot();
    if (!root) return;
    lastEmpty = true;
    lastData = null;
    root.hidden = false;
    root.classList.add("home-trust-stats");
    root.innerHTML =
      '<div class="home-trust-empty" role="status">' +
      esc(tt("home.no_platform_stats", "暂无平台数据")) +
      "</div>";
  }

  function render(data) {
    var root = statsRoot();
    if (!root) return;
    root.hidden = false;
    if (!data || data.configured === false || data.ok === false) {
      renderEmpty();
      return;
    }
    lastEmpty = false;
    lastData = data;
    root.classList.add("home-trust-stats");
    root.innerHTML =
      '<div class="home-trust-strip" role="group" aria-label="' +
      esc(tt("home.stats_aria", "平台实时数据")) +
      '">' +
      fieldDefs()
        .map(function (field) {
          return (
            '<div class="home-trust-item">' +
            '<strong class="home-trust-value">' +
            valueText(data, field[0], field[2]) +
            "</strong>" +
            '<span class="home-trust-label">' +
            esc(field[1]) +
            "</span></div>"
          );
        })
        .join("") +
      "</div>";
  }

  function fetchOnce() {
    return fetch(API_URL, { headers: { Accept: "application/json" }, cache: "no-store" }).then(function (response) {
      return response
        .json()
        .catch(function () {
          return {};
        })
        .then(function (body) {
          if (!response.ok || body.ok === false) {
            throw new Error(body.message || "request_failed");
          }
          return body;
        });
    });
  }

  function load() {
    fetchOnce()
      .catch(function () {
        return fetchOnce();
      })
      .then(function (body) {
        render(body);
      })
      .catch(function () {
        renderEmpty();
      });
  }

  function repaintLocale() {
    if (lastData) render(lastData);
    else if (lastEmpty) renderEmpty();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", load);
  else load();

  window.addEventListener("mcj:localechange", repaintLocale);
})();
