(function () {
  "use strict";
  var STYLES = {
    1: { edge: "#A9A5B2", ink: "#C8C4CE", crown: "#C8C4CE" },
    2: { edge: "#75B8F7", ink: "#75B8F7", crown: "#75B8F7" },
    3: { edge: "#D69CFB", ink: "#D69CFB", crown: "#D69CFB" },
    4: { edge: "#F2B77D", ink: "#F2B77D", crown: "#F2B77D" },
    5: { edge: "#EAA4C9", ink: "#F7D4E6", crown: "#F7C779" },
  };
  var state = { levels: [], games: [], open: "" };

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function crown() {
    return '<span class="price-crown" aria-hidden="true"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M3 18.2 5.1 8.4l4.2 3.2L12 5.6l2.7 6 4.2-3.2L21 18.2H3zm1.4 1.3h15.2v1.6H4.4v-1.6z"/></svg></span>';
  }
  function star() {
    return '<span class="price-star" aria-hidden="true"><svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 1.6 13.4 8l6.2-.4-4.8 3.8 1.7 6.2L12 14.4 7.5 17.6 9.2 11.4 4.4 7.6 10.6 8 12 1.6z"/></svg></span>';
  }
  function moneyOf(raw) {
    var text = String(raw == null ? "" : raw).replace(/,/g, "");
    var match = text.match(/(\d+(?:\.\d+)?)/);
    if (!match) return null;
    var n = Number(match[1]);
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
  }
  function plusText(n) {
    if (!(n > 0)) return "待配置";
    return "+" + (Number.isInteger(n) ? String(n) : String(n));
  }
  function markupOf(level) {
    var base = moneyOf(level && (level.basePrice != null ? level.basePrice : level.base_price));
    if (base) return base;
    return moneyOf(level && (level.minPrice != null ? level.minPrice : level.min));
  }
  function unitLabel(unit) {
    return /per_game|局/i.test(String(unit || "")) ? "猫粮/局" : "猫粮/小时";
  }
  function gameName(service) {
    var name = String((service && (service.name || service.title)) || "").trim();
    if (name.indexOf("三角洲") >= 0) return "三角洲行动";
    return name || "未命名游戏";
  }
  function groupGames(services) {
    var map = {};
    var order = [];
    (services || []).forEach(function (service) {
      if (service && service.enabled === false) return;
      var key = gameName(service);
      if (!map[key]) {
        map[key] = { name: key, icon: service.icon || "🎮", services: [] };
        order.push(key);
      }
      map[key].services.push(service);
    });
    return order.map(function (key) { return map[key]; });
  }
  function levelCards(levels) {
    var list = (levels || []).slice().sort(function (a, b) { return Number(a.level || a.sort) - Number(b.level || b.sort); }).slice(0, 5);
    if (!list.length) return '<p class="price-empty">后台暂未发布等级加价</p>';
    return '<div class="price-level-grid">' + list.map(function (level) {
      var n = Number(level.level) || 0;
      var style = STYLES[n] || STYLES[1];
      var amount = markupOf(level);
      var marks = (n === 5 ? '<span class="price-badge">最高等级</span>' : "") + crown();
      return '<article class="price-level-card' + (n === 5 ? " is-lv5" : "") + '" style="--edge:' + style.edge + ";--ink:" + style.ink + ";--crown:" + style.crown + '">' +
        '<div class="price-level-top"><span class="price-lv">LV' + esc(n || "") + '</span><span class="price-level-marks">' + marks + "</span></div>" +
        '<p class="price-name">' + esc(level.name || "未命名") + "</p>" +
        '<p class="price-amount' + (amount ? "" : " is-empty") + '">' + esc(plusText(amount)) + "</p>" +
        '<p class="price-foot">等级加价 · 猫粮/小时</p></article>';
    }).join("") + "</div>";
  }
  function serviceBlock(service, levels) {
    var base = moneyOf(service.defaultPrice != null ? service.defaultPrice : service.default_price);
    var unit = unitLabel(service.pricingUnit || service.pricing_unit);
    var rows = (levels || []).map(function (level) {
      var add = markupOf(level);
      var finalText = base && add ? String(Math.round((base + add) * 100) / 100) + " 猫粮" : "暂未定价";
      return "LV" + esc(level.level) + " " + esc(level.name || "") + " 加价 " + esc(plusText(add)) + " · 最终 " + esc(finalText);
    }).join("<br>");
    return '<div class="price-service"><div class="price-service-name">' + esc(service.name || service.title || "服务") + "</div>" +
      "<p>基础单价 <strong>" + esc(base ? base + " 猫粮" : "暂未定价") + "</strong></p>" +
      "<p>计价单位 <strong>" + esc(unit) + "</strong></p>" +
      "<p>" + (rows || "暂未定价") + "</p></div>";
  }
  function render() {
    var root = document.getElementById("clubLevelsRoot");
    if (!root) return;
    var open = state.games.filter(function (g) { return g.name === state.open; })[0];
    root.innerHTML =
      '<header class="price-hero"><div><h1>✦ 陪玩等级 · 加价权益</h1><p>不同等级，专属服务加价权益</p></div>' + star() + "</header>" +
      levelCards(state.levels) +
      '<section class="price-section"><h2>游戏服务价格表</h2><p class="price-sub">选择游戏，查看全部陪玩项目及单价</p>' +
      '<div class="price-games">' +
      (state.games.length ? state.games.map(function (game) {
        return '<button type="button" class="price-game' + (game.name === state.open ? " is-on" : "") + '" data-price-game="' + esc(game.name) + '">' +
          '<span class="price-game-icon">' + esc(game.icon || "🎮") + '</span><span class="price-game-name">' + esc(game.name) + "</span></button>";
      }).join("") : '<p class="price-empty">暂无已发布游戏</p>') +
      "</div>" +
      (open
        ? '<div class="price-detail"><h3>' + esc(open.name) + "</h3>" + open.services.map(function (s) { return serviceBlock(s, state.levels); }).join("") + "</div>"
        : "") +
      "</section>";
  }
  function bind(root) {
    if (!root || root.getAttribute("data-bound") === "1") return;
    root.setAttribute("data-bound", "1");
    root.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-price-game]");
      if (!btn) return;
      var name = btn.getAttribute("data-price-game");
      state.open = state.open === name ? "" : name;
      render();
    });
  }
  function load() {
    var root = document.getElementById("clubLevelsRoot");
    bind(root);
    return Promise.all([
      fetch("/api/platform/companion-levels", { cache: "no-store", headers: { Accept: "application/json" } }).then(function (r) { return r.json(); }).catch(function () { return {}; }),
      fetch("/api/platform/services", { cache: "no-store", headers: { Accept: "application/json" } }).then(function (r) { return r.json(); }).catch(function () { return {}; }),
    ]).then(function (pair) {
      state.levels = ((pair[0] && pair[0].levels) || []).filter(function (l) { return l.enabled !== false; });
      state.games = groupGames((pair[1] && pair[1].services) || []);
      render();
    });
  }
  load();
})();
