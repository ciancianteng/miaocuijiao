import "./home-trust-stats.css";
import "./home-brand-hero.css";
import "./home-app-mobile.css";
import "./home-banner-promo.css";

(function () {
  "use strict";

  var API_URL = "/api/gateway?path=" + encodeURIComponent("home/daily-stats");
  /* Homepage trust metrics only — never show 今日有效订单 / 今日营业额. */
  var fields = [
    ["onlineCompanions", "在线陪玩", "number"],
    ["completedOrders", "完成订单", "number"],
    ["goodRate", "好评率", "percent"],
  ];

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
      if (data && Number(data.reviewCount) === 0) return "暂无";
      if (data && data.goodRateLabel) return esc(data.goodRateLabel);
      var rate = numberValue(data, key);
      if (rate == null) rate = numberValue(data, "goodRatePercent");
      if (rate == null) return "暂无";
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

  function renderLoading() {
    var root = statsRoot();
    if (!root) return;
    root.hidden = false;
    root.classList.add("home-trust-stats");
    root.innerHTML = '<div class="home-trust-empty" role="status">正在加载…</div>';
  }

  function renderEmpty() {
    var root = statsRoot();
    if (!root) return;
    root.hidden = false;
    root.classList.add("home-trust-stats");
    root.innerHTML = '<div class="home-trust-empty" role="status">暂无平台数据</div>';
  }

  function render(data) {
    var root = statsRoot();
    if (!root) return;
    root.hidden = false;
    if (!data || data.configured === false || data.ok === false) {
      renderEmpty();
      return;
    }
    root.classList.add("home-trust-stats");
    root.innerHTML =
      '<div class="home-trust-strip" role="group" aria-label="平台实时数据">' +
      fields
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
    renderLoading();
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

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", load);
  else load();
})();
