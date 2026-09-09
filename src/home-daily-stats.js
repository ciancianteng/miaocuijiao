import "./home-trust-stats.css";
import "./home-brand-hero.css";

(function () {
  "use strict";

  var API_URL = "/api/gateway?path=" + encodeURIComponent("home/daily-stats");
  /* Real daily-stats fields only — no invented rating. */
  var fields = [
    ["onlineCompanions", "在线陪玩", ""],
    ["ordersCreated", "今日有效订单", ""],
    ["grossRevenue", "今日营业额", "currency"],
  ];

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function numberValue(data, key) {
    var number = Number(data && data[key]);
    return Number.isFinite(number) ? number : 0;
  }

  function valueText(data, key, currencyKey) {
    if (currencyKey) {
      var amount = numberValue(data, key);
      if (window.MCJCurrency) return esc(window.MCJCurrency.formatPlain(amount));
      /* Compact number only — unit lives in the label (今日营业额). */
      return esc(String(Math.round(amount)));
    }
    return String(Math.round(numberValue(data, key)));
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
