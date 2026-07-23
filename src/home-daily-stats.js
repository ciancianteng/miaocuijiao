(function () {
  "use strict";

  var API_URL = "/api/home/daily-stats";
  var ZERO_STATS = {
    date: "",
    timezone: "Asia/Kuala_Lumpur",
    ordersCreated: 0,
    ordersCompleted: 0,
    newCustomers: 0,
    newCompanions: 0,
    onlineCompanions: 0,
    grossRevenue: 0,
    currency: "MYR"
  };
  var fields = [
    ["ordersCreated", "今日订单", ""],
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

  function numberValue(data, key) {
    var value = data && data[key];
    var number = Number(value);
    return Number.isFinite(number) ? number : 0;
  }

  function currencyLabel(value) {
    return String(value || "MYR").toUpperCase() === "MYR" ? "RM" : String(value || "RM");
  }

  function valueText(data, key, currencyKey) {
    if (currencyKey) return '<span class="home-daily-unit">' + esc(currencyLabel(data && data[currencyKey])) + '</span>' + numberValue(data, key).toFixed(2);
    return String(Math.round(numberValue(data, key)));
  }

  function render(input) {
    var root = document.querySelector("[data-home-daily-stats]");
    if (!root) return;
    var data = Object.assign({}, ZERO_STATS, input || {});
    root.hidden = false;
    var meta = data.date ? '<p>' + esc(data.date) + ' · ' + esc(data.timezone || "Asia/Kuala_Lumpur") + '</p>' : "";
    root.innerHTML = '<div class="section-title compact-title"><div><h2>今日平台数据</h2>' + meta + '</div></div>' +
      '<div class="home-daily-grid">' + fields.map(function (field) {
        return '<article class="home-daily-card"><span>' + esc(field[1]) + '</span><strong>' + valueText(data, field[0], field[2]) + '</strong></article>';
      }).join("") + '</div>';
  }

  async function load() {
    try {
      var response = await fetch(API_URL, { headers: { "Accept": "application/json" }, cache: "no-store" });
      if (!response.ok) throw new Error("daily stats unavailable");
      render(await response.json());
    } catch (error) {
      render(ZERO_STATS);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", load);
  else load();
})();
