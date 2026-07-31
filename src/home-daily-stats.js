(function () {
  "use strict";

  var API_URL = "/api/gateway?path=" + encodeURIComponent("home/daily-stats");
  var fields = [
    ["ordersCreated", "今日订单", ""],
    ["ordersCompleted", "今日完成订单", ""],
    ["newCustomers", "今日新增老板", ""],
    ["newCompanions", "今日新增陪玩", ""],
    ["onlineCompanions", "当前在线陪玩", ""],
    ["grossRevenue", "今日交易额", "currency"],
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
      return esc(String(Math.round(amount))) + " 猫粮";
    }
    return String(Math.round(numberValue(data, key)));
  }

  function renderEmpty() {
    var root = document.querySelector("[data-home-daily-stats]");
    if (!root) return;
    root.hidden = false;
    root.innerHTML =
      '<div class="section-title compact-title"><div><h2>今日平台数据</h2><p>暂无平台数据</p></div></div>' +
      '<div class="home-daily-empty" role="status">暂无平台数据</div>';
  }

  function render(data) {
    var root = document.querySelector("[data-home-daily-stats]");
    if (!root) return;
    root.hidden = false;
    if (!data || data.configured === false || data.ok === false) {
      renderEmpty();
      return;
    }
    var meta = data.date ? "<p>" + esc(data.date) + " · " + esc(data.timezone || "Asia/Kuala_Lumpur") + "</p>" : "";
    root.innerHTML =
      '<div class="section-title compact-title"><div><h2>今日平台数据</h2>' +
      meta +
      "</div></div>" +
      '<div class="home-daily-grid">' +
      fields
        .map(function (field) {
          return (
            '<article class="home-daily-card"><span>' +
            esc(field[1]) +
            "</span><strong>" +
            valueText(data, field[0], field[2]) +
            "</strong></article>"
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
