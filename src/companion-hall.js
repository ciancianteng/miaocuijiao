(function () {
  "use strict";

  var PER_PAGE = 12;
  var state = { page: 1, items: [], taxonomyReady: false };

  function esc(value) {
    return String(value || "").replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }
  var DEFAULT_AVATAR = "/default-avatar.png";
  function avatarUrl(value) {
    var src = String(value || "").trim();
    if (!src || /meow-cuijiao-brand\.(jpe?g|png|webp)$/i.test(src)) return DEFAULT_AVATAR;
    return src;
  }
  function priceNumber(value) {
    if (window.MCJCompanionLevels) return window.MCJCompanionLevels.priceNumber(value);
    var match = String(value || "").match(/\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : 0;
  }
  function levelIdFrom(value) {
    var text = String(value || "").toLowerCase();
    var match = text.match(/lv\.?\s*([1-9])|([1-9])/);
    return match ? "lv" + (match[1] || match[2]) : "";
  }
  function taxonomy() { return window.MCJTaxonomy || null; }
  function taxonomyItems(type) {
    var api = taxonomy();
    return api && api.items ? api.items(type) : [];
  }
  function taxonomyLabel(item) {
    var api = taxonomy();
    return api && api.label ? api.label(item) : String(item && (item.name || item.title || "") || "");
  }
  function taxonomyValue(item) {
    var api = taxonomy();
    return api && api.value ? api.value(item) : String(item && (item.slug || item.code || item.id || item.name || item.title || "") || "");
  }
  function levelLabel(item) {
    var id = item.levelId || levelIdFrom(item.level || item.rank || item.levelName);
    var levels = window.MCJCompanionLevels;
    if (levels && levels.label && id) {
      var fromLevels = levels.label(id);
      if (fromLevels) return fromLevels;
    }
    var api = taxonomy();
    if (api && api.levelLabel) {
      var fromConfig = api.levelLabel(id);
      if (fromConfig) return fromConfig;
    }
    var raw = String(item.levelName || item.level || "").trim();
    if (raw && raw !== "未设置等级" && raw !== "未设置") return raw;
    return id || "未设置等级";
  }
  function formatHourlyPrice(value) {
    if (window.MCJCurrency) return window.MCJCurrency.formatRate(value, "小时");
    return priceNumber(value) + " 猫粮/小时";
  }
  function normalizeStatus(value) {
    var text = String(value || "离线").trim();
    if (/^online$/i.test(text) || /在线可接单|在线/.test(text)) return "在线可接单";
    if (/^busy$/i.test(text) || /忙碌/.test(text)) return "忙碌中";
    if (/^paused$/i.test(text) || /暂停/.test(text)) return "暂停接单";
    if (/^offline$/i.test(text) || /离线/.test(text)) return "离线";
    return text || "离线";
  }
  function statusBadgeClass(status) {
    if (status === "在线可接单") return " is-online";
    if (status === "忙碌中") return " is-busy";
    if (status === "暂停接单") return " is-paused";
    return " is-offline";
  }
  async function readItems() {
    var dataItems = [];
    state.loadError = "";
    try {
      var response = await fetch("/api/public/companions", { headers: { Accept: "application/json" }, cache: "no-store" });
      var body = await response.json().catch(function () { return {}; });
      if (!response.ok || !body.ok) throw new Error(body.message || "陪玩列表读取失败");
      dataItems = Array.isArray(body.companions) ? body.companions : [];
    } catch (error) {
      console.error("陪玩大厅读取失败", error);
      state.loadError = error.message || "陪玩列表读取失败";
      dataItems = [];
    }
    var levelApi = window.MCJCompanionLevels;
    return dataItems.map(function (item) {
      var normalized = levelApi ? levelApi.normalizeCompanion(item) : item;
      var levelId = normalized.levelId || levelIdFrom(normalized.level || normalized.rank || normalized.levelName);
      // Prefer API/admin-saved price; only fall back to level clamp when still zero/empty.
      var apiPrice = priceNumber(item.priceValue != null ? item.priceValue : item.price || item.hourlyPrice || item.servicePrice);
      var priceValue = apiPrice > 0 ? apiPrice : (normalized.priceValue || priceNumber(normalized.price || normalized.servicePrice || normalized.hourlyPrice));
      return {
        id: normalized.uid || normalized.companionId || normalized.id || normalized.name || "",
        name: normalized.name || normalized.nickname || "未命名陪玩",
        game: normalized.game || normalized.mainGame || "未设置游戏",
        price: formatHourlyPrice(priceValue || normalized.price || normalized.servicePrice || normalized.hourlyPrice),
        priceValue: priceValue,
        rating: normalized.rating || normalized.score || "0",
        level: levelLabel(Object.assign({}, normalized, { levelId: levelId })),
        levelId: levelId,
        levelNumber: normalized.levelNumber || Number(String(levelId).replace("lv", "")) || 0,
        gender: normalized.gender || "保密",
        serviceType: normalized.serviceType || normalized.type || normalized.category || normalized.service || "未设置类型",
        status: normalizeStatus(normalized.availabilityStatus || normalized.availabilityText || normalized.status || normalized.onlineStatus),
        publicId: normalized.publicId || "",
        image: avatarUrl(normalized.cover || normalized.cardCover || normalized.avatar || normalized.image),
        tags: Array.isArray(normalized.tags) ? normalized.tags : String(normalized.tags || normalized.serviceTags || "").split(/[,，、\s]+/).filter(Boolean),
        desc: normalized.desc || normalized.description || ""
      };
    });
  }  function setOptions(id, options, allLabel) {
    var el = document.getElementById(id);
    if (!el) return;
    var current = el.value;
    el.innerHTML = '<option value="">' + esc(allLabel) + '</option>' + options.map(function (option) {
      return '<option value="' + esc(option.value) + '">' + esc(option.label) + '</option>';
    }).join("");
    el.value = Array.prototype.some.call(el.options, function (opt) { return opt.value === current; }) ? current : "";
  }
  function setupFilters() {
    var serviceRows = taxonomyItems("services");
    if (!serviceRows.length) serviceRows = taxonomyItems("games");
    setOptions("gameFilter", serviceRows.map(function (item) {
      return { value: taxonomyLabel(item), label: taxonomyLabel(item) };
    }).filter(function (item) { return item.value; }), "全部服务");
    setOptions("typeFilter", (taxonomyItems("service_types").length ? taxonomyItems("service_types") : serviceRows).map(function (item) {
      return { value: taxonomyLabel(item), label: taxonomyLabel(item) };
    }).filter(function (item) { return item.value; }), "全部类型");
    setOptions("levelFilter", taxonomyItems("companion_levels").map(function (item) {
      var api = taxonomy();
      var value = api && api.levelId ? api.levelId(item) : taxonomyValue(item);
      return { value: value, label: [item.code, item.name || item.title].filter(Boolean).join(" ") || taxonomyLabel(item) };
    }).filter(function (item) { return item.value; }), "全部等级");
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
      var hay = [item.name, item.id, item.game, item.serviceType, item.level, item.gender, item.status, item.desc].concat(item.tags).join(" ").toLowerCase();
      var ok = !q || hay.indexOf(q) > -1;
      if (type) ok = ok && item.serviceType === type;
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
      return Number(b.levelNumber || 0) - Number(a.levelNumber || 0);
    });
    return items;
  }
  function card(item) {
    var tags = item.tags.slice(0, 3).map(function (tag) { return '<span>' + esc(tag) + '</span>'; }).join("");
    var badgeClass = statusBadgeClass(item.status);
    var publicId = item.publicId || item.id || "未生成";
    return '<article class="card player-card" data-player data-level-id="' + esc(item.levelId || "") + '" data-companion-level="' + esc(item.levelId || "") + '" data-name="' + esc(item.name) + '" data-game="' + esc(item.game) + '" data-tags="' + esc(item.tags.join(",")) + '" data-price="' + esc(item.priceValue) + '" data-online="' + esc(item.status) + '" data-score="' + esc(item.rating) + '" data-gender="' + esc(item.gender) + '">' +
      '<div class="companion-card-media"><img src="' + esc(item.image) + '" alt="' + esc(item.name) + '" onerror="this.onerror=null;this.src=\'' + DEFAULT_AVATAR + '\'"><span class="companion-online-badge' + badgeClass + '">' + esc(item.status) + '</span></div>' +
      '<div class="companion-card-body">' +
        '<div class="row companion-card-head"><h3>' + esc(item.name) + '</h3><span class="price companion-price">' + esc(item.price) + '</span></div>' +
        '<p class="muted companion-id" style="display:block!important;opacity:.7;font-size:12px;margin:4px 0 0">陪玩 ID：' + esc(publicId) + '</p>' +
        '<div class="companion-meta"><span class="companion-level-pill" data-level-id="' + esc(item.levelId || "") + '">' + esc(item.level) + '</span><span>' + esc(item.game) + '</span></div>' +
        '<div class="tag-row companion-tags">' + tags + '</div>' +
        '<div class="companion-card-actions"><a class="companion-card-action" href="profile.html?player=' + encodeURIComponent(item.id || item.name || "") + '">查看详情</a><button type="button" class="companion-card-action primary" data-hall-order="' + esc(item.id || "") + '" data-hall-name="' + esc(item.name || "") + '" data-hall-price="' + esc(item.priceValue || "") + '" data-hall-game="' + esc(item.game || "") + '" data-hall-avatar="' + esc(item.image || "") + '" data-hall-public-id="' + esc(publicId || "") + '">立即下单</button></div>' +
      '</div>' +
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
    if (count) count.textContent = "共 " + items.length + " 位陪玩";
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
    document.addEventListener("click", function (event) {
      var orderBtn = event.target.closest("[data-hall-order]");
      if (!orderBtn) return;
      event.preventDefault();
      var id = orderBtn.getAttribute("data-hall-order") || "";
      if (!id) return;
      if (!window.MCJPlaceOrder || typeof window.MCJPlaceOrder.openFromCompanion !== "function") {
        location.href = "profile.html?player=" + encodeURIComponent(id) + "&open_order=1";
        return;
      }
      window.MCJPlaceOrder.openFromCompanion({
        companionId: id,
        id: id,
        uid: id,
        companionName: orderBtn.getAttribute("data-hall-name") || "陪玩",
        name: orderBtn.getAttribute("data-hall-name") || "陪玩",
        unitPrice: Number(orderBtn.getAttribute("data-hall-price") || 0),
        priceValue: Number(orderBtn.getAttribute("data-hall-price") || 0),
        price: Number(orderBtn.getAttribute("data-hall-price") || 0),
        service: orderBtn.getAttribute("data-hall-game") || "陪玩",
        game: orderBtn.getAttribute("data-hall-game") || "陪玩",
        avatar: orderBtn.getAttribute("data-hall-avatar") || "",
        publicId: orderBtn.getAttribute("data-hall-public-id") || "",
        pricingUnit: "小时",
      });
    });
  }
  async function start() {
    var count = document.getElementById("resultCount");
    if (count) count.textContent = "正在加载陪玩…";
    // Fire-and-forget seed; never block the hall list on it.
    fetch("/api/dev/seed-p03-preview", { method: "POST", headers: { "Content-Type": "application/json" } }).catch(function () {});
    state.items = await readItems();
    setupFilters();
    bind();
    render();
  }
  function init() {
    // Load companions immediately; refresh filter options when taxonomy arrives.
    start();
    if (window.MCJTaxonomy && window.MCJTaxonomy.load) {
      window.MCJTaxonomy.load()
        .then(function () {
          setupFilters();
          render();
        })
        .catch(function () {});
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
