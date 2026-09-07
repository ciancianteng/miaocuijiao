(function () {
  "use strict";

  var STORAGE_KEYS = ["mcj_companionLevels", "mcj_player_levels"];
  var STYLE_ID = "mcj-companion-level-theme";
  var CACHE_META_KEY = "mcj_companionLevels_meta";
  var memoryLevels = null;
  var hydratedFromApi = false;

  // Structural seed only — never used for live card rendering once API hydrate succeeds.
  var DEFAULT_LEVELS = [
    {
      id: "lv1", level: 1, code: "Lv1", name: "萌喵", icon: "🩶",
      color: "#9CA3AF", displayColor: "#9CA3AF", cardBackground: "solid",
      badgeBorder: "#9CA3AF", badgeText: "#E5E7EB", badgeIcon: "#D1D5DB",
      min: 20, max: 30, maxPlus: false, commissionRate: 20,
      description: "", upgradeCondition: "", sort: 1, open: true, enabled: true
    },
    {
      id: "lv2", level: 2, code: "Lv2", name: "灵喵", icon: "💙",
      color: "#3B82F6", displayColor: "#3B82F6", cardBackground: "gradient",
      badgeBorder: "#60A5FA", badgeText: "#DBEAFE", badgeIcon: "#93C5FD",
      min: 30, max: 40, maxPlus: false, commissionRate: 18,
      description: "", upgradeCondition: "", sort: 2, open: true, enabled: true
    },
    {
      id: "lv3", level: 3, code: "Lv3", name: "猎喵", icon: "💜",
      color: "#A855F7", displayColor: "#A855F7", cardBackground: "gradient",
      badgeBorder: "#C084FC", badgeText: "#F3E8FF", badgeIcon: "#D8B4FE",
      min: 40, max: 45, maxPlus: false, commissionRate: 16,
      description: "", upgradeCondition: "", sort: 3, open: true, enabled: true
    },
    {
      id: "lv4", level: 4, code: "Lv4", name: "喵神", icon: "💛",
      color: "#EAB308", displayColor: "#EAB308", cardBackground: "gradient",
      badgeBorder: "#FACC15", badgeText: "#FEF9C3", badgeIcon: "#FDE047",
      min: 60, max: 75, maxPlus: false, commissionRate: 14,
      description: "", upgradeCondition: "", sort: 4, open: false, enabled: true
    },
    {
      id: "lv5", level: 5, code: "Lv5", name: "喵皇", icon: "👑",
      color: "#F59E0B", displayColor: "#EF4444", cardBackground: "glass",
      badgeBorder: "#F59E0B", badgeText: "#FEE2E2", badgeIcon: "#FBBF24",
      min: 75, max: 100, maxPlus: true, commissionRate: 12,
      description: "", upgradeCondition: "", sort: 5, open: false, enabled: true
    }
  ];

  function copy(level) {
    return Object.assign({}, level);
  }

  function parseJSON(value) {
    try {
      var parsed = JSON.parse(value || "null");
      return Array.isArray(parsed) ? parsed : null;
    } catch (e) {
      return null;
    }
  }

  function isHexColor(value) {
    return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(String(value || "").trim());
  }

  function normalizeLevelRecord(level, opts) {
    var fromApi = !!(opts && opts.fromApi);
    var raw = level || {};
    var levelNo = Number(raw.level || String(raw.id || raw.code || "").match(/\d+/) || 0) || 0;
    var seed = (!fromApi && DEFAULT_LEVELS.find(function (item) { return item.level === levelNo; })) || null;
    var base = seed ? Object.assign({}, seed) : {};
    var merged = Object.assign({}, base, raw);

    merged.level = levelNo || Number(base.level) || 1;
    merged.id = String(merged.id || ("lv" + merged.level)).trim();
    merged.code = String(merged.code || ("Lv" + merged.level)).replace(/^Lv\.?/i, "Lv");
    if (!/^Lv\d+/i.test(merged.code)) merged.code = "Lv" + merged.level;
    merged.name = String(merged.name || base.name || "").trim() || ("等级" + merged.level);
    merged.icon = String(merged.icon || base.icon || "").trim();

    // Visuals: prefer API/DB values; only use neutral fallbacks when missing.
    merged.color = isHexColor(merged.color || merged.levelColor)
      ? String(merged.color || merged.levelColor).trim()
      : (isHexColor(base.color) ? base.color : "#9CA3AF");
    merged.displayColor = isHexColor(merged.displayColor || merged.homeColor)
      ? String(merged.displayColor || merged.homeColor).trim()
      : merged.color;
    merged.cardBackground = ["solid", "gradient", "glass"].indexOf(String(merged.cardBackground || merged.cardStyle || "")) > -1
      ? String(merged.cardBackground || merged.cardStyle)
      : (base.cardBackground || "solid");
    merged.badgeBorder = isHexColor(merged.badgeBorder || merged.badge_border)
      ? String(merged.badgeBorder || merged.badge_border).trim()
      : merged.color;
    merged.badgeText = isHexColor(merged.badgeText || merged.badge_text)
      ? String(merged.badgeText || merged.badge_text).trim()
      : "#FFFFFF";
    merged.badgeIcon = isHexColor(merged.badgeIcon || merged.badge_icon)
      ? String(merged.badgeIcon || merged.badge_icon).trim()
      : merged.color;

    merged.min = Math.max(0, Number(merged.min != null ? merged.min : (merged.minPrice != null ? merged.minPrice : (base.min != null ? base.min : 0))));
    merged.max = Math.max(merged.min, Number(merged.max != null ? merged.max : (merged.maxPrice != null ? merged.maxPrice : (base.max != null ? base.max : merged.min))));
    merged.maxPlus = Boolean(merged.maxPlus || merged.allowAboveMax || merged.maximum_price_plus);
    merged.commissionRate = Math.max(0, Math.min(100, Number(merged.commissionRate != null ? merged.commissionRate : (merged.commission != null ? merged.commission : (base.commissionRate != null ? base.commissionRate : 0)))));
    merged.description = String(merged.description || merged.desc || base.description || "");
    merged.upgradeCondition = String(merged.upgradeCondition || merged.upgrade_condition || base.upgradeCondition || "");
    merged.sort = Number(merged.sort || merged.sort_weight || merged.level);
    merged.open = merged.open !== false && merged.open !== "否" && merged.open !== "关闭";
    merged.enabled = merged.enabled !== false && merged.enabled !== "停用" && merged.status !== "disabled";
    merged.priceRangeLabel = merged.maxPlus ? (merged.min + "–" + merged.max + "+") : (merged.min + "–" + merged.max);
    merged.priceRangeText = merged.priceRangeLabel + " 猫粮";
    merged.title = (merged.code + " " + merged.name).trim();
    return merged;
  }

  function persistCache(levels) {
    var clean = (levels || []).map(function (row) { return normalizeLevelRecord(row, { fromApi: true }); });
    STORAGE_KEYS.forEach(function (key) {
      localStorage.setItem(key, JSON.stringify(clean));
    });
    localStorage.setItem(CACHE_META_KEY, JSON.stringify({ source: "api", updatedAt: Date.now() }));
    return clean;
  }

  function readCachedApiLevels() {
    var meta = parseJSON(localStorage.getItem(CACHE_META_KEY));
    if (!meta || meta.source !== "api") return null;
    for (var i = 0; i < STORAGE_KEYS.length; i += 1) {
      var levels = parseJSON(localStorage.getItem(STORAGE_KEYS[i]));
      if (levels && levels.length) {
        return levels.map(function (row) { return normalizeLevelRecord(row, { fromApi: true }); });
      }
    }
    return null;
  }

  function save(levels, opts) {
    var fromApi = !!(opts && opts.fromApi);
    var clean = (levels || []).map(function (row) {
      return normalizeLevelRecord(row, { fromApi: fromApi });
    }).sort(function (a, b) {
      return Number(a.sort || a.level) - Number(b.sort || b.level);
    });
    memoryLevels = clean;
    if (fromApi) {
      hydratedFromApi = true;
      persistCache(clean);
    }
    applyTheme(clean);
    return clean;
  }

  function read() {
    if (memoryLevels && memoryLevels.length) return memoryLevels;
    var cached = readCachedApiLevels();
    if (cached && cached.length) {
      memoryLevels = cached;
      applyTheme(cached);
      return cached;
    }
    // No API cache yet — keep in-memory structural seed without writing mock data to localStorage.
    memoryLevels = DEFAULT_LEVELS.map(function (row) { return normalizeLevelRecord(row); });
    applyTheme(memoryLevels);
    return memoryLevels;
  }

  function formatRange(level) {
    var item = normalizeLevelRecord(level, { fromApi: true });
    if (typeof window !== "undefined" && window.MCJCurrency) {
      return window.MCJCurrency.formatRange(item.min, item.max, item.maxPlus);
    }
    return item.priceRangeText;
  }

  function formatHourlyPrice(value, lang) {
    var amount = priceNumber(value);
    if (typeof window !== "undefined" && window.MCJCurrency) {
      return window.MCJCurrency.formatRate(amount, lang === "en" ? "hr" : "小时");
    }
    return amount + (lang === "en" ? " catfood/hr" : " 猫粮/小时");
  }

  function priceNumber(value) {
    var match = String(value == null ? "" : value).match(/\d+(?:\.\d+)?/);
    var number = match ? Number(match[0]) : 0;
    return Number.isFinite(number) ? Math.max(0, number) : 0;
  }

  function normalizeLookupKey(value) {
    return String(value == null ? "" : value)
      .trim()
      .toLowerCase()
      .replace(/lv\.?\s*/gi, "lv")
      .replace(/\s+/g, " ");
  }

  function resolveLevel(value) {
    var levels = read();
    var text = String(value == null ? "" : value).trim();
    if (!text || /^未设置/.test(text)) return null;
    var key = normalizeLookupKey(text);
    var number = Number((text.match(/\d+/) || [])[0]);
    return levels.find(function (level) {
      var keys = [
        level.id,
        level.code,
        level.name,
        level.code + " " + level.name,
        "Lv" + level.level + " " + level.name,
        "lv" + level.level
      ].map(normalizeLookupKey);
      return keys.indexOf(key) > -1 || level.level === number || (level.name && key.indexOf(normalizeLookupKey(level.name)) > -1);
    }) || null;
  }

  function findLevel(value) {
    return resolveLevel(value) || read()[0] || copy(DEFAULT_LEVELS[0]);
  }

  function label(value) {
    var level = resolveLevel(value);
    if (!level) {
      var raw = String(value == null ? "" : value).trim();
      return raw && !/^未设置/.test(raw) ? raw : "未设置等级";
    }
    return level.code + " " + level.name;
  }

  function labelWithIcon(value) {
    var level = resolveLevel(value);
    if (!level) return label(value);
    return (level.icon ? level.icon + " " : "") + level.code + " " + level.name;
  }

  function clampPrice(level, price) {
    var item = findLevel(level);
    var value = priceNumber(price);
    if (!value) value = item.min;
    if (value < item.min) return item.min;
    if (!item.maxPlus && value > item.max) return item.max;
    return value;
  }

  function validatePrice(level, price) {
    var item = findLevel(level);
    var value = priceNumber(price);
    var valid = value >= item.min && (item.maxPlus ? value >= item.min : value <= item.max);
    return {
      valid: valid,
      value: value,
      message: valid ? "" : "当前等级可设置的价格范围为 " + formatRange(item) + "。"
    };
  }

  function cardBackgroundCss(level) {
    var item = normalizeLevelRecord(level, { fromApi: true });
    var color = item.color || "#9CA3AF";
    var display = item.displayColor || color;
    if (item.cardBackground === "glass") {
      return "linear-gradient(165deg, " + color + "3a, rgba(255,255,255,.08) 42%, rgba(14,13,18,.78)), rgba(14,13,18,.70)";
    }
    if (item.cardBackground === "gradient") {
      return "linear-gradient(145deg, " + color + "40, " + display + "22 48%, rgba(14,13,18,.92))";
    }
    return "linear-gradient(180deg, " + color + "2e, rgba(14,13,18,.92))";
  }

  function themeCss(levels) {
    return (levels || []).map(function (level) {
      var item = normalizeLevelRecord(level, { fromApi: hydratedFromApi });
      var id = item.id;
      var bg = cardBackgroundCss(item);
      return [
        '[data-companion-level="' + id + '"],.player-card[data-level-id="' + id + '"],.companion-hall-grid .player-card[data-level-id="' + id + '"],.hot-card[data-level-id="' + id + '"]{--mcj-level-color:' + item.color + ';--mcj-level-display:' + item.displayColor + ';--mcj-level-badge-border:' + item.badgeBorder + ';--mcj-level-badge-text:' + item.badgeText + ';--mcj-level-badge-icon:' + item.badgeIcon + ';--mcj-level-card-bg:' + bg + ';}',
        '.companion-hall-grid .player-card[data-level-id="' + id + '"],.player-card[data-level-id="' + id + '"],.hot-card[data-level-id="' + id + '"]{border-color:' + item.color + '88!important;background:' + bg + '!important;}',
        '.companion-hall-grid .player-card[data-level-id="' + id + '"]:hover,.player-card[data-level-id="' + id + '"]:hover{border-color:' + item.color + '!important;background:' + bg + '!important;}',
        '.companion-hall-grid .player-card[data-level-id="' + id + '"] .companion-level-pill,.player-card[data-level-id="' + id + '"] .companion-level-pill,.companion-level-pill[data-level-id="' + id + '"],[data-companion-level="' + id + '"] .companion-level-pill{border:1px solid ' + item.badgeBorder + '!important;color:' + item.badgeText + '!important;background:' + item.color + '33!important;}',
        '.mcj-level-badge[data-level-id="' + id + '"]{border-color:' + item.badgeBorder + ';color:' + item.badgeText + ';}'
      ].join("");
    }).join("");
  }

  function applyTheme(levels) {
    var css = themeCss(levels || read());
    var node = document.getElementById(STYLE_ID);
    if (!node) {
      node = document.createElement("style");
      node.id = STYLE_ID;
      document.head.appendChild(node);
    }
    node.textContent = css;
  }

  function inlineCardStyle(levelOrConfig) {
    var cfg = levelOrConfig || {};
    if (!cfg.color && cfg.levelConfig) cfg = cfg.levelConfig;
    if (!cfg || !cfg.color) return "";
    var item = normalizeLevelRecord(cfg, { fromApi: true });
    var bg = cardBackgroundCss(item);
    return [
      "--mcj-level-color:" + item.color,
      "--mcj-level-display:" + item.displayColor,
      "--mcj-level-badge-border:" + item.badgeBorder,
      "--mcj-level-badge-text:" + item.badgeText,
      "--mcj-level-badge-icon:" + item.badgeIcon,
      "--mcj-level-card-bg:" + bg,
      "border-color:" + item.color + "88",
      "background:" + bg
    ].join(";");
  }

  function preferLevelConfig(source) {
    var cfg = source && source.levelConfig ? source.levelConfig : null;
    if (cfg && (cfg.id || cfg.color || cfg.min != null)) {
      return normalizeLevelRecord(cfg, { fromApi: true });
    }
    return resolveLevel(
      (source && (source.levelId || source.player_level_id || source.level_id || source.level || source.levelName || source.level_name || source.rank)) || ""
    );
  }

  function normalizeCompanion(item) {
    var source = item || {};
    var level = preferLevelConfig(source);
    var rawPrice =
      source.priceValue != null
        ? source.priceValue
        : source.hourlyPrice != null
          ? source.hourlyPrice
          : source.servicePrice != null
            ? source.servicePrice
            : source.price != null
              ? source.price
              : source.unitPrice;
    var price = priceNumber(rawPrice);
    var levelId = level ? level.id : String(source.levelId || source.level_id || "").trim();
    var levelLabel = level
      ? level.code + " " + level.name
      : String(source.levelName || source.level || source.level_name || "").trim() || "未设置等级";
    return Object.assign({}, source, {
      levelId: levelId,
      levelNumber: level ? level.level : Number(String(levelId).replace(/\D+/g, "")) || 0,
      levelLabel: levelLabel,
      levelLabelWithIcon: level ? labelWithIcon(level.id) : levelLabel,
      levelRange: level ? formatRange(level) : "",
      levelPriceRange: level ? level.priceRangeLabel : (source.levelPriceRange || ""),
      levelPriceRangeText: level ? level.priceRangeText : (source.levelPriceRangeText || ""),
      levelMinPrice: level ? level.min : source.levelMinPrice,
      levelMaxPrice: level ? level.max : source.levelMaxPrice,
      levelDescription: level ? level.description : "",
      levelColor: level ? level.color : (source.levelColor || ""),
      displayColor: level ? level.displayColor : (source.displayColor || ""),
      cardBackground: level ? level.cardBackground : (source.cardBackground || source.cardStyle || ""),
      cardStyle: level ? level.cardBackground : (source.cardStyle || source.cardBackground || ""),
      badgeBorder: level ? level.badgeBorder : (source.badgeBorder || ""),
      badgeText: level ? level.badgeText : (source.badgeText || ""),
      badgeIcon: level ? level.badgeIcon : (source.badgeIcon || ""),
      levelConfig: level || source.levelConfig || null,
      commissionRate: level ? level.commissionRate : source.commissionRate,
      priceValue: price,
      priceDisplay: formatHourlyPrice(price),
      cardStyleInline: level ? inlineCardStyle(level) : ""
    });
  }

  function selectOptions(allLabel) {
    return ['<option value="">' + (allLabel || "全部等级") + "</option>"].concat(read().filter(function (level) {
      return level.enabled;
    }).map(function (level) {
      return '<option value="' + level.id + '">' + label(level.id) + "</option>";
    })).join("");
  }

  function hydrateFromList(list) {
    if (!Array.isArray(list) || !list.length) return read();
    return save(list, { fromApi: true });
  }

  function hydrateFromApi() {
    return fetch("/api/platform/companion-levels", { headers: { Accept: "application/json" }, cache: "no-store" })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (body) {
          if (!res.ok || body.ok === false) throw new Error(body.message || "等级读取失败");
          var levels = body.levels || [];
          if (!levels.length) throw new Error("等级配置为空");
          return hydrateFromList(levels);
        });
      });
  }

  // Prefer previous API cache; refresh from server when possible.
  read();
  if (typeof window !== "undefined") {
    hydrateFromApi().catch(function () { /* keep API cache / structural seed */ });
  }

  window.MCJCompanionLevels = {
    defaults: DEFAULT_LEVELS.map(copy),
    read: read,
    save: function (levels) { return save(levels, { fromApi: true }); },
    find: findLevel,
    resolve: resolveLevel,
    label: label,
    labelWithIcon: labelWithIcon,
    formatRange: formatRange,
    formatHourlyPrice: formatHourlyPrice,
    priceNumber: priceNumber,
    validatePrice: validatePrice,
    clampPrice: clampPrice,
    normalizeCompanion: normalizeCompanion,
    selectOptions: selectOptions,
    applyTheme: applyTheme,
    cardBackgroundCss: cardBackgroundCss,
    inlineCardStyle: inlineCardStyle,
    hydrateFromApi: hydrateFromApi,
    hydrateFromList: hydrateFromList,
    normalizeLevelRecord: normalizeLevelRecord,
    isHydratedFromApi: function () { return hydratedFromApi; }
  };
})();
