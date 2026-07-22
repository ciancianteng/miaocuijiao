(function () {
  "use strict";

  var API_URL = "/api/home/daily-stats";
  var fields = [
    ["ordersCreated", "今日订单数", ""],
    ["ordersCompleted", "今日完成订单", ""],
    ["newCustomers", "今日新增老板", ""],
    ["newCompanions", "今日新增陪玩", ""],
    ["onlineCompanions", "当前在线陪玩", ""],
    ["grossRevenue", "今日交易额", "currency"]
  ];

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function valueText(data, key, currencyKey) {
    var value = data && data[key];
    if (value == null || value === "" || Number.isNaN(Number(value))) return "0";
    if (currencyKey) return esc(data[currencyKey] || "MYR") + " " + Number(value).toFixed(2);
    return String(Number(value));
  }

  function render(data) {
    var root = document.querySelector("[data-home-daily-stats]");
    if (!root) return;
    root.hidden = false;
    var meta = data && data.date ? '<p>' + esc(data.date) + ' · ' + esc(data.timezone || "Asia/Kuala_Lumpur") + '</p>' : "";
    root.innerHTML = '<div class="section-title compact-title"><div><h2>今日平台数据</h2>' + meta + '</div></div>' +
      '<div class="home-daily-grid">' + fields.map(function (field) {
        return '<article class="home-daily-card"><span>' + esc(field[1]) + '</span><strong>' + valueText(data, field[0], field[2]) + '</strong></article>';
      }).join("") + '</div>';
  }

  function renderError() {
    var root = document.querySelector("[data-home-daily-stats]");
    if (!root) return;
    root.hidden = false;
    root.innerHTML = '<div class="section-title compact-title"><div><h2>今日平台数据</h2></div></div><div class="home-daily-grid">' +
      fields.map(function (field) {
        return '<article class="home-daily-card"><span>' + esc(field[1]) + '</span><strong>暂时无法读取</strong></article>';
      }).join("") + '</div>';
  }

  async function load() {
    try {
      var response = await fetch(API_URL, { headers: { "Accept": "application/json" }, cache: "no-store" });
      if (!response.ok) throw new Error("daily stats unavailable");
      render(await response.json());
    } catch (error) {
      renderError();
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", load);
  else load();
})();
