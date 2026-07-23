(function () {
  "use strict";

  var PER_PAGE = 12;
  var state = { page: 1, items: [] };

  function esc(value) {
    return String(value || "").replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function priceNumber(value) {
    if (window.MCJCompanionLevels) return window.MCJCompanionLevels.priceNumber(value);
    var match = String(value || "").match(/\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : 0;
  }

  function readItems() {
    var dataItems = [];
    if (window.MCJRealData && typeof window.MCJRealData.approvedCompanions === "function") {
      dataItems = window.MCJRealData.approvedCompanions();
    } else if (window.MCJPlatformStore) {
      dataItems = window.MCJPlatformStore.list("companions").filter(function (item) {
        return item.auditStatus === "approved" && item.visible !== false;
      });
    }
    var levelApi = window.MCJCompanionLevels;
    return dataItems.map(function (item) {
      var normalized = levelApi ? levelApi.normalizeCompanion(item) : item;
      var priceValue = normalized.priceValue || priceNumber(normalized.price || normalized.servicePrice || normalized.hourlyPrice);
      var priceDisplay = normalized.priceDisplay || ("RM" + priceValue + "/小时");
      var levelLabel = normalized.levelLabel || normalized.level || "Lv.1 萌喵";
      return {
        id: normalized.uid || normalized.companionId || normalized.id || normalized.name || "",
        name: normalized.name || normalized.nickname || "未命名陪玩",
        game: normalized.game || normalized.mainGame || "游戏",
        price: priceDisplay,
        priceValue: priceValue,
        rating: normalized.rating || normalized.score || "0",
        level: levelLabel,
        levelId: normalized.levelId || "lv1",
        levelNumber: normalized.levelNumber || 1,
        gender: normalized.gender || "保密",
        status: normalized.status || normalized.onlineStatus || "离线",
        image: normalized.cover || normalized.cardCover || normalized.avatar || normalized.image || "assets/meow-cuijiao-brand.jpg",
        tags: Array.isArray(normalized.tags) ? normalized.tags : String(normalized.tags || normalized.serviceTags || "").split(/[，,]/).filter(Boolean),
        desc: normalized.desc || normalized.description || ""
      };
    });
  }

  function fillSelect(id, values, allLabel) {
    var el = document.getElementById(id);
    if (!el) return;
    var current = el.value;
    el.innerHTML = '<option value="">' + esc(allLabel) + "</option>" + values.map(function (value) {
      return '<option value="' + esc(value) + '">' + esc(value) + "</option>";
    }).join("");
    el.value = current;
  }

  function setupFilters(items) {
    fillSelect("typeFilter", Array.from(new Set(items.map(function (x) { return x.game; }))), "全部类型");
    fillSelect("gameFilter", Array.from(new Set(items.map(function (x) { return x.game; }))), "全部游戏");
    var levelEl = document.getElementById("levelFilter");
    if (levelEl && window.MCJCompanionLevels) {
      var current = levelEl.value;
      levelEl.innerHTML = window.MCJCompanionLevels.selectOptions("全部等级");
      levelEl.value = current;
    } else {
      fillSelect("levelFilter", Array.from(new Set(items.map(function (x) { return x.level; }))), "全部等级");
    }
  }

  function value(id) {
    var el = document.getElementById(id);
    return el ? el.value : "";
  }

  function filtered() {
    var q = value("searchInput").trim().toLowerCase();
    var type = value("typeFilter");
    var game = value("gameFilter");
    var price = value("priceFilter");
    var online = value("onlineFilter");
    var score = Number(value("scoreFilter") || 0);
    var gender = value("genderFilter");
    var level = value("levelFilter");

    var items = state.items.filter(function (item) {
      var hay = [item.name, item.id, item.game, item.level, item.gender, item.status, item.desc].concat(item.tags).join(" ").toLowerCase();
      var ok = !q || hay.indexOf(q) > -1;
      if (type) ok = ok && item.game === type;
      if (game) ok = ok && item.game === game;
      if (price) {
        var range = price.split("-").map(Number);
        ok = ok && item.priceValue >= range[0] && item.priceValue <= range[1];
      }
      if (online) ok = ok && item.status === online;
      if (score) ok = ok && Number(item.rating) >= score;
      if (gender) ok = ok && item.gender === gender;
      if (level) ok = ok && item.levelId === level;
      return ok;
    });

    var sort = value("sortFilter");
    items.sort(function (a, b) {
      if (sort === "ratingDesc") return Number(b.rating) - Number(a.rating);
      if (sort === "priceAsc") return a.priceValue - b.priceValue;
      if (sort === "priceDesc") return b.priceValue - a.priceValue;
      if (sort === "levelDesc") return Number(b.levelNumber || 0) - Number(a.levelNumber || 0);
      return 0;
    });
    return items;
  }

  function card(item) {
    return '<article class="card player-card" data-player data-name="' + esc(item.name) + '" data-game="' + esc(item.game) + '" data-tags="' + esc(item.tags.join(",")) + '" data-price="' + esc(item.priceValue) + '" data-online="' + esc(item.status) + '" data-score="' + esc(item.rating) + '" data-gender="' + esc(item.gender) + '">' +
      '<img src="' + esc(item.image) + '" alt="' + esc(item.name) + '" style="width:100%;aspect-ratio:16/10;object-fit:cover;border-radius:8px">' +
      '<div class="row companion-card-head"><h3>' + esc(item.name) + '</h3><span class="price">' + esc(item.price) + '</span></div>' +
      '<p class="muted companion-id">陪玩 ID：' + esc(item.id || "未生成") + '</p>' +
      '<div class="companion-meta"><span>' + esc(item.level) + '</span><span>' + esc(item.game) + '</span><span>' + esc(item.status) + '</span></div>' +
      (item.desc ? '<p class="muted">' + esc(item.desc) + '</p>' : '') +
      '<div class="tag-row">' + item.tags.map(function (tag) { return '<span>' + esc(tag) + '</span>'; }).join("") + '</div>' +
      '<button class="btn primary" data-book type="button">立即下单</button>' +
      '</article>';
  }

  function render() {
    var list = document.getElementById("playerList");
    if (!list) return;
    var items = filtered();
    var pages = Math.max(1, Math.ceil(items.length / PER_PAGE));
    if (state.page > pages) state.page = pages;
    var start = (state.page - 1) * PER_PAGE;
    list.innerHTML = items.slice(start, start + PER_PAGE).map(card).join("");

    var count = document.getElementById("resultCount");
    if (count) count.textContent = "共" + items.length + "位陪玩";

    var empty = document.getElementById("emptyState");
    if (empty) empty.hidden = !!items.length;

    var pager = document.getElementById("companionPagination");
    if (pager) {
      pager.innerHTML = Array.from({ length: pages }, function (_, i) {
        var page = i + 1;
        return '<button type="button" class="' + (page === state.page ? "active" : "") + '" data-page="' + page + '">' + page + '</button>';
      }).join("");
    }
  }

  function bind() {
    ["searchInput", "typeFilter", "priceFilter", "onlineFilter", "scoreFilter", "genderFilter", "gameFilter", "levelFilter", "sortFilter"].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("input", function () { state.page = 1; render(); });
      el.addEventListener("change", function () { state.page = 1; render(); });
    });
    var apply = document.getElementById("applyFilter");
    if (apply) apply.addEventListener("click", function () { state.page = 1; render(); });
    var pager = document.getElementById("companionPagination");
    if (pager) pager.addEventListener("click", function (event) {
      var button = event.target.closest("[data-page]");
      if (!button) return;
      state.page = Number(button.dataset.page || 1);
      render();
    });
  }

  function init() {
    state.items = readItems();
    setupFilters(state.items);
    bind();
    render();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
