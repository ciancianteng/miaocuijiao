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
    var match = String(value || "").match(/\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : 0;
  }

  function normalizeTags(item) {
    var tags = Array.isArray(item.tags) ? item.tags : String(item.tags || item.serviceTags || "").split(/[，,]/);
    return tags.map(function (tag) { return String(tag || "").trim(); }).filter(Boolean);
  }

  function isApprovedVisible(item) {
    return item && item.auditStatus === "approved" && item.visible !== false && item.visible !== "false";
  }

  function matchesVoiceService(item) {
    var value = [item.serviceType, item.serviceTypes, item.category, item.tags, item.serviceTags].join(" ");
    return /voice|语音|语聊|陪聊/.test(value);
  }

  function readItems() {
    var dataItems = [];
    if (window.MCJRealData && typeof window.MCJRealData.approvedCompanions === "function") {
      dataItems = window.MCJRealData.approvedCompanions();
    } else if (window.MCJPlatformStore) {
      dataItems = window.MCJPlatformStore.list("companions").filter(isApprovedVisible);
    }
    var params = new URLSearchParams(location.search);
    var voiceOnly = params.get("type") === "voice" || params.get("service") === "voice";
    if (voiceOnly) dataItems = dataItems.filter(matchesVoiceService);
    return dataItems.filter(isApprovedVisible).map(function (item) {
      var price = item.price || item.servicePrice || "";
      return {
        id: item.id || item.name || "",
        name: item.name || "未命名",
        game: item.game || item.mainGame || "未填写",
        price: price,
        priceValue: priceNumber(price),
        rating: item.rating || item.score || "",
        level: item.level || "Lv.1",
        gender: item.gender || "保密",
        status: item.status || item.onlineStatus || "可预约",
        image: item.cover || item.cardCover || item.avatar || item.image || "assets/meow-cuijiao-brand.jpg",
        tags: normalizeTags(item),
        desc: item.desc || item.description || ""
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
    fillSelect("levelFilter", Array.from(new Set(items.map(function (x) { return x.level; }))), "全部等级");
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
      if (level) ok = ok && item.level === level;
      return ok;
    });

    var sort = value("sortFilter");
    items.sort(function (a, b) {
      if (sort === "ratingDesc") return Number(b.rating) - Number(a.rating);
      if (sort === "priceAsc") return a.priceValue - b.priceValue;
      if (sort === "priceDesc") return b.priceValue - a.priceValue;
      if (sort === "levelDesc") return String(b.level).localeCompare(String(a.level));
      return 0;
    });
    return items;
  }

  function card(item) {
    return '<article class="card player-card" data-player data-name="' + esc(item.name) + '" data-game="' + esc(item.game) + '" data-tags="' + esc(item.tags.join(",")) + '" data-price="' + esc(item.priceValue) + '" data-online="' + esc(item.status) + '" data-score="' + esc(item.rating) + '" data-gender="' + esc(item.gender) + '">' +
      '<img src="' + esc(item.image) + '" alt="' + esc(item.name) + '" style="width:100%;aspect-ratio:16/10;object-fit:cover;border-radius:8px">' +
      '<div class="row"><h3>' + esc(item.name) + '</h3><span class="price">' + esc(item.price) + '</span></div>' +
      '<p class="muted game-line">' + esc(item.game) + ' · ' + esc(item.level) + ' · ' + esc(item.status) + '</p>' +
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
    if (count) count.textContent = items.length ? "共 " + items.length + " 位陪玩" : "暂无已上架陪玩";

    var empty = document.getElementById("emptyState");
    if (empty) {
      empty.hidden = !!items.length;
      if (!items.length) empty.textContent = "暂无符合条件的陪玩。";
    }

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
    var params = new URLSearchParams(location.search);
    if (params.get("type") === "voice" || params.get("service") === "voice") {
      var title = document.querySelector(".companion-hall-hero h1, h1");
      if (title) title.textContent = "语音大厅";
    }
    state.items = readItems();
    setupFilters(state.items);
    bind();
    render();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
