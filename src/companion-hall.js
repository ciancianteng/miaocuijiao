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
    if (window.MCJCompanionMedia && window.MCJCompanionMedia.pickStableMediaUrl) {
      return window.MCJCompanionMedia.pickStableMediaUrl(value) || DEFAULT_AVATAR;
    }
    var src = String(value || "").trim();
    if (!src || /meow-cuijiao-brand\.(jpe?g|png|webp)$/i.test(src)) return DEFAULT_AVATAR;
    if (/^(blob:|data:)/i.test(src) || /\/storage\/v1\/object\/sign\//i.test(src)) return DEFAULT_AVATAR;
    return src;
  }
  function cardImage(item) {
    if (window.MCJCompanionMedia && window.MCJCompanionMedia.resolveCover) {
      return window.MCJCompanionMedia.resolveCover(item);
    }
    return avatarUrl(item && (item.cover || item.cardImageUrl || item.avatar || item.image));
  }
  function priceNumber(value) {
    if (window.MCJCompanionLevels) return window.MCJCompanionLevels.priceNumber(value);
    var match = String(value || "").match(/\d+(?:\.\d+)?/);
    return match ? Number(match[0]) : 0;
  }
  function levelIdFrom(value) {
    if (window.MCJCompanionLevels && typeof window.MCJCompanionLevels.resolve === "function") {
      var found = window.MCJCompanionLevels.resolve(value);
      if (found && found.id) return found.id;
    }
    var text = String(value || "").trim();
    if (!text || /^未设置/.test(text)) return "";
    var match = text.toLowerCase().match(/lv\.?\s*([1-9]\d*)/);
    return match ? "lv" + match[1] : "";
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
  function enabledLevelOptions() {
    var levelsApi = window.MCJCompanionLevels;
    if (levelsApi && typeof levelsApi.read === "function") {
      var rows = (levelsApi.read() || []).filter(function (item) {
        return item && item.enabled !== false && item.status !== "disabled";
      });
      if (rows.length) {
        return rows
          .slice()
          .sort(function (a, b) { return Number(a.sort || a.level || 0) - Number(b.sort || b.level || 0); })
          .map(function (item) {
            var id = String(item.id || "").trim() || ("lv" + (item.level || ""));
            var label = levelsApi.label ? levelsApi.label(id) : [item.code, item.name].filter(Boolean).join(" ");
            return { value: id, label: label || id, min: Number(item.min) || 0, max: Number(item.max) || 0, maxPlus: !!item.maxPlus };
          })
          .filter(function (item) { return item.value; });
      }
    }
    // Taxonomy/API path — already filtered to enabled companion_levels on the server.
    return taxonomyItems("companion_levels").map(function (item) {
      var api = taxonomy();
      var value = api && api.levelId ? api.levelId(item) : taxonomyValue(item);
      var label = [item.code, item.name || item.title].filter(Boolean).join(" ") || taxonomyLabel(item);
      return {
        value: value,
        label: label,
        min: Number(item.min != null ? item.min : item.minPrice) || 0,
        max: Number(item.max != null ? item.max : item.maxPrice) || 0,
        maxPlus: !!(item.maxPlus || item.maximum_price_plus)
      };
    }).filter(function (item) { return item.value; });
  }
  function levelLabel(item) {
    var id = item.levelId || levelIdFrom(item.level || item.rank || item.levelName);
    var levels = window.MCJCompanionLevels;
    if (levels && levels.label && id) {
      var fromLevels = levels.label(id);
      if (fromLevels && fromLevels !== "未设置等级") return fromLevels;
    }
    var api = taxonomy();
    if (api && api.levelLabel && id) {
      var fromConfig = api.levelLabel(id);
      if (fromConfig) return fromConfig;
    }
    var raw = String(item.levelName || item.level || "").trim();
    if (raw && raw !== "未设置等级" && raw !== "未设置") return raw;
    return id ? String(id) : "未设置等级";
  }
  function formatHourlyPrice(value) {
    if (window.MCJCurrency) return window.MCJCurrency.formatRate(value, "小时");
    return priceNumber(value) + " 猫粮/小时";
  }
  function formatHourlyPriceFx(value) {
    if (window.MCJCurrency && typeof window.MCJCurrency.formatCatFoodWithFx === "function") {
      return window.MCJCurrency.formatCatFoodWithFx(value);
    }
    if (window.MCJCurrency && typeof window.MCJCurrency.formatRmWithFx === "function") {
      return "≈ " + window.MCJCurrency.formatRmWithFx(value);
    }
    return "";
  }
  function normalizeStatus(value) {
    if (window.MCJCompanionPresence) {
      return window.MCJCompanionPresence.label(value);
    }
    var text = String(value || "离线").trim();
    if (/^online$/i.test(text) || /在线可接单|在线/.test(text)) return "在线可接单";
    if (/^busy$/i.test(text) || /忙碌/.test(text)) return "忙碌中";
    if (/^paused$/i.test(text) || /暂停/.test(text)) return "暂停接单";
    if (/^offline$/i.test(text) || /离线/.test(text)) return "离线";
    return text || "离线";
  }
  function statusBadgeClass(status) {
    if (window.MCJCompanionPresence) {
      return window.MCJCompanionPresence.badgeClass({ availabilityText: status, status: status });
    }
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
      var normalized = levelApi && levelApi.normalizeCompanion ? levelApi.normalizeCompanion(item) : item;
      var levelId = String(normalized.levelId || item.levelId || levelIdFrom(normalized.level || normalized.rank || normalized.levelName || item.level) || "").trim();
      // Prefer API/admin-saved price; do not invent prices from level bands.
      var apiPrice = priceNumber(item.priceValue != null ? item.priceValue : item.price || item.hourlyPrice || item.servicePrice);
      var priceValue = apiPrice > 0 ? apiPrice : priceNumber(normalized.priceValue || normalized.price || normalized.servicePrice || normalized.hourlyPrice);
      return {
        id: normalized.uid || normalized.companionId || normalized.id || "",
        name: normalized.name || normalized.nickname || "未命名陪玩",
        game: normalized.game || normalized.mainGame || "未设置游戏",
        price: formatHourlyPrice(priceValue || normalized.price || normalized.servicePrice || normalized.hourlyPrice),
        priceValue: priceValue,
        rating: normalized.rating || normalized.score || "0",
        level: levelLabel(Object.assign({}, normalized, { levelId: levelId })),
        levelId: levelId,
        levelNumber: normalized.levelNumber || Number(String(levelId).replace(/\D+/g, "")) || 0,
        gender: normalized.gender || "保密",
        voiceType: normalized.voiceType || normalized.voice_type || "",
        serviceType: (Array.isArray(normalized.serviceTypes) && normalized.serviceTypes[0])
          || normalized.serviceType
          || normalized.service_type
          || "陪玩服务",
        serviceTypes: Array.isArray(normalized.serviceTypes) && normalized.serviceTypes.length
          ? normalized.serviceTypes.slice()
          : String(normalized.serviceType || normalized.service_type || "陪玩服务")
              .split(/[,，、/|]+/)
              .map(function (part) { return String(part || "").trim(); })
              .filter(Boolean),
        serviceIds: Array.isArray(normalized.serviceIds) && normalized.serviceIds.length
          ? normalized.serviceIds.map(function (id) { return String(id); })
          : Array.isArray(normalized.service_ids)
            ? normalized.service_ids.map(function (id) { return String(id); })
            : [],
        status: normalizeStatus(normalized.availabilityStatus || normalized.availabilityText || normalized.status || normalized.onlineStatus),
        availabilityStatus: String(normalized.availabilityStatus || "").toLowerCase() || "",
        publicId: normalized.publicId || "",
        avatar: avatarUrl(normalized.avatar || normalized.cover || normalized.image),
        cover: cardImage(normalized),
        image: cardImage(normalized),
        objectPositionX: normalized.objectPositionX != null ? normalized.objectPositionX : normalized.object_position_x,
        objectPositionY: normalized.objectPositionY != null ? normalized.objectPositionY : normalized.object_position_y,
        tags: Array.isArray(normalized.tags) ? normalized.tags : String(normalized.tags || normalized.serviceTags || "").split(/[,，、\s]+/).filter(Boolean),
        certTags: Array.isArray(normalized.certTags)
          ? normalized.certTags
          : Array.isArray(normalized.certificationTags)
            ? normalized.certificationTags
            : [],
        desc: normalized.desc || normalized.description || ""
      };
    }).filter(function (item) {
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(item.id || ""));
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
  var SERVICE_TYPE_OPTIONS = [
    { value: "陪玩服务", label: "陪玩服务" },
    { value: "陪聊服务", label: "陪聊服务" }
  ];
  var stateGameOptions = [];
  function companionGames(item) {
    return String(item && item.game || "")
      .split(/[,，、/|]+/)
      .map(function (part) { return String(part || "").trim(); })
      .filter(Boolean);
  }
  function companionServiceIds(item) {
    if (Array.isArray(item && item.serviceIds) && item.serviceIds.length) {
      return item.serviceIds.map(function (id) { return String(id); });
    }
    if (Array.isArray(item && item.service_ids) && item.service_ids.length) {
      return item.service_ids.map(function (id) { return String(id); });
    }
    // Legacy fallback: map game names → service ids from loaded options
    var names = companionGames(item);
    if (!names.length || !stateGameOptions.length) return [];
    return stateGameOptions
      .filter(function (opt) { return names.indexOf(opt.label) > -1; })
      .map(function (opt) { return opt.value; });
  }
  function setupPriceOptions(levelOpts) {
    var rows = Array.isArray(levelOpts) ? levelOpts : enabledLevelOptions();
    var seen = {};
    var options = [];
    rows.forEach(function (row) {
      var min = Number(row.min) || 0;
      var max = Number(row.max) || 0;
      if (!(min > 0) && !(max > 0)) return;
      var hi = row.maxPlus ? 99999 : max;
      if (!(hi >= min) || min <= 0) return;
      var value = min + "-" + hi;
      if (seen[value]) return;
      seen[value] = 1;
      options.push({
        value: value,
        label: row.maxPlus ? (min + "+ 猫粮") : (min + "-" + max + " 猫粮")
      });
    });
    if (options.length) setOptions("priceFilter", options, "全部价格");
  }
  function setupFilters() {
    // 服务类型：固定陪玩/陪聊，禁止游戏名进入此下拉
    setOptions("typeFilter", SERVICE_TYPE_OPTIONS, "全部类型");
    // 游戏分类：优先已加载的 services（value=service_id）
    if (stateGameOptions.length) {
      setOptions("gameFilter", stateGameOptions, "全部游戏");
    } else {
      var gameRows = taxonomyItems("games");
      if (!gameRows.length) gameRows = taxonomyItems("services");
      setOptions("gameFilter", gameRows.map(function (item) {
        var id = String(item.id || item.value || "").trim();
        var label = taxonomyLabel(item);
        return { value: id || label, label: label };
      }).filter(function (item) { return item.value && item.label; }), "全部游戏");
    }
    // 陪玩等级：唯一来源 = 后台启用中的 companion_levels（禁止写死 Lv1/Lv2）
    var levelOpts = enabledLevelOptions();
    setOptions("levelFilter", levelOpts.map(function (item) {
      return { value: item.value, label: item.label };
    }), "全部等级");
    setupPriceOptions(levelOpts);
  }
  function loadGameFilterFromServicesApi() {
    return fetch("/api/platform/services", { headers: { Accept: "application/json" } })
      .then(function (res) {
        return res.text().then(function (raw) {
          var body = {};
          try { body = raw ? JSON.parse(raw) : {}; } catch (err) { body = {}; }
          if (!res.ok || body.ok === false) return [];
          return Array.isArray(body.services) ? body.services : [];
        });
      })
      .then(function (services) {
        var enabled = (services || []).filter(function (item) {
          return item && item.enabled !== false && item.status !== "disabled";
        });
        stateGameOptions = enabled.map(function (item) {
          var id = String(item.id || "").trim();
          var name = String(item.name || item.title || item.game || "").trim();
          return { value: id || name, label: name };
        }).filter(function (item) { return item.value && item.label; });
        setOptions("gameFilter", stateGameOptions, "全部游戏");
      })
      .catch(function () {});
  }
  function value(id) {
    var el = document.getElementById(id);
    return el ? el.value : "";
  }
  function hasActiveFilters() {
    return !!(
      value("searchInput").trim() ||
      value("typeFilter") ||
      value("gameFilter") ||
      value("priceFilter") ||
      value("onlineFilter") ||
      value("scoreFilter") ||
      value("genderFilter") ||
      value("levelFilter")
    );
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
      var ok = true;
      if (q) {
        var name = String(item.name || "").toLowerCase();
        var publicId = String(item.publicId || "").toLowerCase();
        var id = String(item.id || "").toLowerCase();
        var games = companionGames(item).join(" ").toLowerCase();
        var tags = (item.tags || []).join(" ").toLowerCase();
        // Nickname / public ID first; also allow game/tag contains for the shared search box.
        ok =
          name.indexOf(q) > -1 ||
          publicId.indexOf(q) > -1 ||
          id.indexOf(q) > -1 ||
          games.indexOf(q) > -1 ||
          tags.indexOf(q) > -1 ||
          String(item.level || "").toLowerCase().indexOf(q) > -1;
      }
      if (type) {
        var types = Array.isArray(item.serviceTypes) && item.serviceTypes.length
          ? item.serviceTypes
          : [item.serviceType].filter(Boolean);
        ok = ok && types.indexOf(type) > -1;
      }
      if (game) {
        var ids = companionServiceIds(item);
        var gameLabels = companionGames(item);
        var opt = stateGameOptions.find(function (row) { return row.value === game; });
        ok = ok && (
          ids.indexOf(game) > -1 ||
          gameLabels.indexOf(game) > -1 ||
          (opt && opt.label && gameLabels.indexOf(opt.label) > -1)
        );
      }
      if (price) {
        var range = String(price).split("-").map(Number);
        var lo = Number(range[0]) || 0;
        var hi = Number(range[1]) || 0;
        ok = ok && item.priceValue >= lo && item.priceValue <= hi;
      }
      if (online) ok = ok && item.status === online;
      if (score) ok = ok && Number(item.rating) >= score;
      if (gender) ok = ok && item.gender === gender;
      if (level) ok = ok && String(item.levelId || "") === String(level);
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
  function gameChips(item) {
    var raw = item.game || item.mainGame || "";
    var list = Array.isArray(raw)
      ? raw
      : String(raw)
          .split(/[,，、/|]+/)
          .map(function (part) { return String(part || "").trim(); })
          .filter(Boolean);
    if (!list.length) list = ["未设置游戏"];
    return list.slice(0, 4).map(function (game) {
      return '<span class="mcj-service-tag companion-game-chip">' + esc(game) + "</span>";
    }).join("");
  }
  function card(item) {
    var identityApi = window.MCJCompanionIdentity;
    var identityRow = identityApi
      ? identityApi.renderTags({
          levelId: item.levelId || "",
          levelLabel: item.level,
          gender: item.gender,
          voiceType: item.voiceType || "",
          certTags: item.certTags || [],
          tags: item.tags || [],
          className: "companion-identity-row companion-tags",
          includeLevel: true,
          includeGender: true,
          serviceLimit: 3,
          certLimit: 2,
        })
      : (function () {
          var level = item.level
            ? '<span class="companion-level-pill mcj-level-tag" data-level-id="' + esc(item.levelId || "") + '">' + esc(item.level) + "</span>"
            : "";
          var gender = item.gender && !/^(保密|不公开|未知|-|—)$/.test(String(item.gender))
            ? '<span class="mcj-gender-tag">' + esc(item.gender) + "</span>"
            : "";
          var styleTags = (item.tags || []).slice(0, 3).map(function (tag) {
            return '<span class="mcj-service-tag">' + esc(tag) + "</span>";
          }).join("");
          var voice = String(item.voiceType || "").trim().replace(/^声线\s*[:：]\s*/, "");
          var voiceParts = voice
            ? voice.split(/[,，、|/]+/).map(function (x) { return String(x || "").trim(); }).filter(Boolean)
            : [];
          var voiceHtml =
            '<span class="mcj-voice-tag' +
            (voiceParts.length ? "" : " is-unset") +
            '"><span class="mcj-voice-label">声线：</span>' +
            esc(voiceParts.length ? voiceParts.join(" / ") : "未设置") +
            "</span>";
          return '<div class="mcj-id-tags companion-identity-row companion-tags">' + level + gender + voiceHtml + styleTags + "</div>";
        })();
    var gamesRow = '<div class="mcj-id-tags companion-games-row companion-tags">' + gameChips(item) + "</div>";
    var fx = formatHourlyPriceFx(item.priceValue);
    var priceHtml =
      '<div class="price companion-price">' +
      esc(item.price) +
      (fx ? ' <span class="price-fx-approx">' + esc(fx) + "</span>" : "") +
      "</div>";
    var badgeClass = statusBadgeClass(item.status);
    var publicId = item.publicId || "未生成";
    var uuid = String(item.id || "").trim();
    var detailHref = uuid ? ("profile.html?id=" + encodeURIComponent(uuid)) : "#";
    var focusX = item.objectPositionX != null ? item.objectPositionX : 50;
    var focusY = item.objectPositionY != null ? item.objectPositionY : 25;
    var pos = Number(focusX) + "% " + Number(focusY) + "%";
    return '<article class="card player-card" data-player data-public-id="' + esc(String(publicId).toUpperCase()) + '" data-level-id="' + esc(item.levelId || "") + '" data-companion-level="' + esc(item.levelId || "") + '" data-companion-id="' + esc(uuid) + '" data-name="' + esc(item.name) + '" data-game="' + esc(item.game) + '" data-tags="' + esc(item.tags.join(",")) + '" data-price="' + esc(item.priceValue) + '" data-online="' + esc(item.status) + '" data-score="' + esc(item.rating) + '" data-gender="' + esc(item.gender) + '">' +
      '<div class="companion-card-media"><img src="' + esc(item.image) + '" alt="' + esc(item.name) + '" loading="lazy" decoding="async" style="object-position:' + esc(pos) + ';--mcj-cover-pos:' + esc(pos) + '" onerror="this.onerror=null;this.src=\'' + DEFAULT_AVATAR + '\'"><span class="companion-online-badge' + badgeClass + '">' + esc(item.status) + '</span></div>' +
      '<div class="companion-card-body">' +
        '<div class="row companion-card-head companion-card-title-row"><h3>' + esc(item.name) + '</h3><span class="companion-status-inline' + badgeClass + '">' + esc(item.status) + '</span></div>' +
        '<p class="muted companion-id">陪玩 ID：' + esc(publicId) + '</p>' +
        '<div class="companion-meta companion-meta-desktop"><span class="companion-level-pill mcj-level-tag" data-level-id="' + esc(item.levelId || "") + '">' + esc(item.level) + '</span><span class="companion-game-text">' + esc(item.game) + '</span></div>' +
        identityRow +
        gamesRow +
        priceHtml +
        '<div class="companion-card-actions"><a class="companion-card-action" href="' + esc(detailHref) + '">查看详情</a><button type="button" class="companion-card-action primary" data-hall-order="' + esc(uuid) + '" data-hall-name="' + esc(item.name || "") + '" data-hall-price="' + esc(item.priceValue || "") + '" data-hall-level="' + esc(item.levelId || "") + '" data-hall-game="' + esc(item.game || "") + '" data-hall-avatar="' + esc(item.image || "") + '" data-hall-public-id="' + esc(publicId || "") + '" data-hall-status="' + esc(item.availabilityStatus || "") + '" data-hall-status-text="' + esc(item.status || "") + '">立即下单</button></div>' +
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
    // Never keep stale cards when the filtered set is empty.
    list.innerHTML = items.length ? items.slice(start, start + PER_PAGE).map(card).join("") : "";
    var count = document.getElementById("resultCount");
    if (count) count.textContent = "共 " + items.length + " 位陪玩";
    var empty = document.getElementById("emptyState");
    if (empty) {
      var showEmpty = !items.length;
      empty.hidden = !showEmpty;
      if (showEmpty) {
        var filteredEmpty = hasActiveFilters() && !state.loadError;
        var title = empty.querySelector("strong");
        var hint = empty.querySelector("span");
        if (state.loadError) {
          if (title) title.textContent = "陪玩列表加载失败";
          if (hint) hint.textContent = state.loadError;
        } else if (filteredEmpty) {
          if (title) title.textContent = "暂无符合条件的陪玩";
          if (hint) hint.textContent = "试试调整搜索词或筛选条件。";
        } else {
          if (title) title.textContent = "目前暂无可接单陪玩";
          if (hint) hint.textContent = "通过审核并上线接单的陪玩将在这里展示。";
        }
      }
    }
    var pager = document.getElementById("companionPagination");
    if (pager) {
      pager.innerHTML = items.length
        ? Array.from({ length: pages }, function (_, i) {
            var page = i + 1;
            return '<button type="button" class="' + (page === state.page ? "active" : "") + '" data-page="' + page + '">' + page + '</button>';
          }).join("")
        : "";
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
        location.href = "profile.html?id=" + encodeURIComponent(id) + "&open_order=1";
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
        levelId: orderBtn.getAttribute("data-hall-level") || "",
        level: (function () {
          var lid = orderBtn.getAttribute("data-hall-level") || "";
          if (lid && window.MCJCompanionLevels && window.MCJCompanionLevels.label) {
            return window.MCJCompanionLevels.label(lid);
          }
          var card = orderBtn.closest(".player-card");
          var pill = card && card.querySelector(".companion-level-pill");
          return (pill && pill.textContent) || "";
        })(),
        pricingUnit: "小时",
        availabilityStatus: orderBtn.getAttribute("data-hall-status") || "",
        availabilityText: orderBtn.getAttribute("data-hall-status-text") || "",
      });
    });
  }
  async function start() {
    var count = document.getElementById("resultCount");
    if (count) count.textContent = "正在加载陪玩…";
    // Never auto-seed on Production hosts. Preview/local may call the gated seed endpoint.
    try {
      var host = String(location.hostname || "").toLowerCase();
      var isProdHost = /(^|\.)meowcuijiao\.com$/.test(host);
      if (!isProdHost) {
        fetch("/api/dev/seed-p03-preview", { method: "POST", headers: { "Content-Type": "application/json" } }).catch(function () {});
      }
    } catch (e) { /* ignore */ }
    // Hydrate admin levels before building the level/price dropdowns.
    if (window.MCJCompanionLevels && typeof window.MCJCompanionLevels.hydrateFromApi === "function") {
      try { await window.MCJCompanionLevels.hydrateFromApi(); } catch (e) { /* keep last known */ }
    }
    state.items = await readItems();
    setupFilters();
    await loadGameFilterFromServicesApi();
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
          return loadGameFilterFromServicesApi();
        })
        .then(function () { render(); })
        .catch(function () {});
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
