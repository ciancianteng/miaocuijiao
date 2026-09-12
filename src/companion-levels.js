(function () {
  "use strict";

  var STORAGE_KEYS = ["mcj_companionLevels", "mcj_player_levels"];
  var STYLE_ID = "mcj-companion-level-theme";

  var DEFAULT_LEVELS = [
    {
      id: "lv1", level: 1, code: "Lv1", name: "萌喵", icon: "🩶",
      color: "#9CA3AF", displayColor: "#9CA3AF", cardBackground: "solid",
      badgeBorder: "#9CA3AF", badgeText: "#E5E7EB", badgeIcon: "#D1D5DB",
      min: 20, max: 30, maxPlus: false, commissionRate: 20,
      description: "新加入平台，需要累积订单与评价。",
      upgradeCondition: "完成基础资料审核并开始接单。\n订单数：达标\n好评率：达标\n认证完成：是",
      sort: 1, open: true, enabled: true
    },
    {
      id: "lv2", level: 2, code: "Lv2", name: "灵喵", icon: "💙",
      color: "#3B82F6", displayColor: "#3B82F6", cardBackground: "gradient",
      badgeBorder: "#60A5FA", badgeText: "#DBEAFE", badgeIcon: "#93C5FD",
      min: 30, max: 40, maxPlus: false, commissionRate: 18,
      description: "已有订单与基础好评，稳定接单。",
      upgradeCondition: "累计订单与基础好评达到后台设置条件。\n订单数：达标\n好评率：达标\n认证完成：是",
      sort: 2, open: true, enabled: true
    },
    {
      id: "lv3", level: 3, code: "Lv3", name: "猎喵", icon: "💜",
      color: "#A855F7", displayColor: "#A855F7", cardBackground: "gradient",
      badgeBorder: "#C084FC", badgeText: "#F3E8FF", badgeIcon: "#D8B4FE",
      min: 40, max: 45, maxPlus: false, commissionRate: 16,
      description: "技术表现优秀、评价较高。",
      upgradeCondition: "技术表现、评价和在线时长达到后台设置条件。\n订单数：达标\n好评率：达标\n认证完成：是",
      sort: 3, open: true, enabled: true
    },
    {
      id: "lv4", level: 4, code: "Lv4", name: "喵神", icon: "💛",
      color: "#EAB308", displayColor: "#EAB308", cardBackground: "gradient",
      badgeBorder: "#FACC15", badgeText: "#FEF9C3", badgeIcon: "#FDE047",
      min: 60, max: 75, maxPlus: false, commissionRate: 14,
      description: "热门游戏专精陪玩。",
      upgradeCondition: "热门游戏专精表现通过后台审核。\n订单数：达标\n好评率：达标\n认证完成：是",
      sort: 4, open: false, enabled: true
    },
    {
      id: "lv5", level: 5, code: "Lv5", name: "喵皇", icon: "👑",
      color: "#F59E0B", displayColor: "#EF4444", cardBackground: "glass",
      badgeBorder: "#F59E0B", badgeText: "#FEE2E2", badgeIcon: "#FBBF24",
      min: 75, max: 100, maxPlus: true, commissionRate: 12,
      description: "俱乐部招牌、人气主播或大神级陪玩。",
      upgradeCondition: "招牌陪玩、人气主播或大神级资质通过后台审核。\n订单数：达标\n好评率：达标\n认证完成：是",
      sort: 5, open: false, enabled: true
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

  function normalizeLevelRecord(level) {
    var fallback = DEFAULT_LEVELS[0];
    var raw = Object.assign({}, fallback, level || {});
    var levelNo = Number(raw.level || String(raw.id || raw.code || "").match(/\d+/) || fallback.level);
    var official = DEFAULT_LEVELS.find(function (item) { return item.level === levelNo; }) || fallback;
    var merged = Object.assign({}, official, raw);
    merged.level = levelNo || official.level;
    merged.id = merged.id || "lv" + merged.level;
    merged.code = String(merged.code || "Lv" + merged.level).replace(/^Lv\.?/i, "Lv");
    if (!/^Lv\d+/i.test(merged.code)) merged.code = "Lv" + merged.level;
    merged.name = merged.name || official.name;
    merged.icon = merged.icon || official.icon;
    merged.color = merged.color || merged.levelColor || official.color;
    merged.displayColor = merged.displayColor || merged.homeColor || merged.color;
    merged.cardBackground = ["solid", "gradient", "glass"].indexOf(String(merged.cardBackground || merged.cardStyle || "")) > -1
      ? String(merged.cardBackground || merged.cardStyle)
      : (official.cardBackground || "solid");
    merged.badgeBorder = merged.badgeBorder || merged.badge_border || merged.color;
    merged.badgeText = merged.badgeText || merged.badge_text || "#fff";
    merged.badgeIcon = merged.badgeIcon || merged.badge_icon || merged.color;
    merged.min = Math.max(0, Number(merged.min != null ? merged.min : (merged.minPrice != null ? merged.minPrice : official.min)));
    merged.max = Math.max(merged.min, Number(merged.max != null ? merged.max : (merged.maxPrice != null ? merged.maxPrice : official.max)));
    merged.maxPlus = Boolean(merged.maxPlus || merged.allowAboveMax || merged.maximum_price_plus);
    merged.commissionRate = Math.max(0, Math.min(100, Number(merged.commissionRate != null ? merged.commissionRate : (merged.commission != null ? merged.commission : official.commissionRate))));
    merged.description = merged.description || merged.desc || official.description;
    merged.upgradeCondition = merged.upgradeCondition || merged.upgrade_condition || official.upgradeCondition;
    merged.sort = Number(merged.sort || merged.sort_weight || merged.level);
    merged.open = merged.open !== false && merged.open !== "否" && merged.open !== "关闭";
    merged.enabled = merged.enabled !== false && merged.enabled !== "停用" && merged.status !== "disabled";
    return merged;
  }

  function save(levels) {
    var clean = levels.map(normalizeLevelRecord).sort(function (a, b) {
      return Number(a.sort || a.level) - Number(b.sort || b.level);
    });
    STORAGE_KEYS.forEach(function (key) {
      localStorage.setItem(key, JSON.stringify(clean));
    });
    applyTheme(clean);
    return clean;
  }

  function read() {
    for (var i = 0; i < STORAGE_KEYS.length; i += 1) {
      var levels = parseJSON(localStorage.getItem(STORAGE_KEYS[i]));
      if (levels && levels.length) {
        var clean = levels.map(normalizeLevelRecord);
        applyTheme(clean);
        return clean;
      }
    }
    return save(DEFAULT_LEVELS);
  }

  function formatRange(level) {
    var item = normalizeLevelRecord(level);
    if (typeof window !== "undefined" && window.MCJCurrency) {
      return window.MCJCurrency.formatRange(item.min, item.max, item.maxPlus);
    }
    return item.min + "–" + item.max + (item.maxPlus ? "+" : "") + " 猫粮";
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

  function findLevel(value) {
    var levels = read();
    var text = String(value == null ? "" : value).trim();
    var number = Number((text.match(/\d+/) || [])[0]);
    return levels.find(function (level) {
      return level.id === text || level.code === text || level.name === text || level.level === number || text.indexOf(level.name) > -1;
    }) || levels[0] || copy(DEFAULT_LEVELS[0]);
  }

  function label(value) {
    var level = findLevel(value);
    return level.code + " " + level.name;
  }

  function labelWithIcon(value) {
    var level = findLevel(value);
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
    var item = normalizeLevelRecord(level);
    var color = item.color || "#9CA3AF";
    var display = item.displayColor || color;
    if (item.cardBackground === "glass") {
      return "linear-gradient(180deg, rgba(255,255,255,.10), rgba(255,255,255,.02)), rgba(14,13,18,.72)";
    }
    if (item.cardBackground === "gradient") {
      return "linear-gradient(145deg, " + color + "33, " + display + "18 48%, rgba(14,13,18,.92))";
    }
    return "linear-gradient(180deg, " + color + "22, rgba(14,13,18,.92))";
  }

  function themeCss(levels) {
    return (levels || []).map(function (level) {
      var item = normalizeLevelRecord(level);
      var id = item.id;
      return [
        '[data-companion-level="' + id + '"],.player-card[data-level-id="' + id + '"]{--mcj-level-color:' + item.color + ';--mcj-level-display:' + item.displayColor + ';--mcj-level-badge-border:' + item.badgeBorder + ';--mcj-level-badge-text:' + item.badgeText + ';--mcj-level-badge-icon:' + item.badgeIcon + ';}',
        '.player-card[data-level-id="' + id + '"]{border-color:' + item.color + '55!important;background:' + cardBackgroundCss(item) + '!important;}',
        '.player-card[data-level-id="' + id + '"] .companion-level-pill,.companion-level-pill[data-level-id="' + id + '"],[data-companion-level="' + id + '"] .companion-level-pill{border:1px solid ' + item.badgeBorder + ';color:' + item.badgeText + ';background:' + item.color + '22;}',
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

  function normalizeCompanion(item) {
    var source = item || {};
    var level = findLevel(source.levelId || source.player_level_id || source.level || source.level_name || source.rank);
    var price = clampPrice(level, source.hourlyPrice || source.servicePrice || source.price || source.unitPrice);
    return Object.assign({}, source, {
      levelId: level.id,
      levelNumber: level.level,
      levelLabel: label(level.id),
      levelLabelWithIcon: labelWithIcon(level.id),
      levelRange: formatRange(level),
      levelDescription: level.description,
      levelColor: level.color,
      displayColor: level.displayColor,
      cardBackground: level.cardBackground,
      badgeBorder: level.badgeBorder,
      badgeText: level.badgeText,
      badgeIcon: level.badgeIcon,
      commissionRate: level.commissionRate,
      priceValue: price,
      priceDisplay: formatHourlyPrice(price)
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
    return save(list.map(normalizeLevelRecord));
  }

  function hydrateFromApi() {
    return fetch("/api/platform/companion-levels", { headers: { Accept: "application/json" } })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (body) {
          if (!res.ok || body.ok === false) throw new Error(body.message || "等级读取失败");
          return hydrateFromList(body.levels || []);
        });
      })
      .catch(function () {
        return read();
      });
  }

  // Keep local defaults available immediately; refresh from server when possible.
  read();
  if (typeof window !== "undefined") {
    hydrateFromApi();
  }

  window.MCJCompanionLevels = {
    defaults: DEFAULT_LEVELS.map(copy),
    read: read,
    save: save,
    find: findLevel,
    label: label,
    labelWithIcon: labelWithIcon,
    formatRange: formatRange,
    formatHourlyPrice: formatHourlyPrice,
    priceNumber: priceNumber,
    validatePrice: validatePrice,
    normalizeCompanion: normalizeCompanion,
    selectOptions: selectOptions,
    applyTheme: applyTheme,
    cardBackgroundCss: cardBackgroundCss,
    hydrateFromApi: hydrateFromApi,
    hydrateFromList: hydrateFromList,
    normalizeLevelRecord: normalizeLevelRecord
  };
})();
