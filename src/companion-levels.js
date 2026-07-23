(function () {
  "use strict";

  var STORAGE_KEYS = ["mcj_companionLevels", "mcj_player_levels"];

  var DEFAULT_LEVELS = [
    {
      id: "lv1",
      level: 1,
      code: "Lv.1",
      name: "萌喵",
      icon: "🩶",
      min: 20,
      max: 30,
      maxPlus: false,
      description: "新加入平台，需要累积订单与评价。",
      upgradeCondition: "完成基础资料审核并开始接单。",
      sort: 1,
      open: true,
      enabled: true
    },
    {
      id: "lv2",
      level: 2,
      code: "Lv.2",
      name: "灵喵",
      icon: "💙",
      min: 30,
      max: 40,
      maxPlus: false,
      description: "已有订单与基础好评，稳定接单、沟通良好、回头客较多。",
      upgradeCondition: "累计订单与基础好评达到后台设置条件。",
      sort: 2,
      open: true,
      enabled: true
    },
    {
      id: "lv3",
      level: 3,
      code: "Lv.3",
      name: "猎喵",
      icon: "💜",
      min: 40,
      max: 45,
      maxPlus: false,
      description: "技术表现优秀、评价较高、长期在线，并具备一定人气。",
      upgradeCondition: "技术表现、评价和在线时长达到后台设置条件。",
      sort: 3,
      open: true,
      enabled: true
    },
    {
      id: "lv4",
      level: 4,
      code: "Lv.4",
      name: "喵神",
      icon: "❤️",
      min: 60,
      max: 75,
      maxPlus: false,
      description: "热门游戏专精陪玩，技术与服务表现突出。",
      upgradeCondition: "热门游戏专精表现通过后台审核。",
      sort: 4,
      open: false,
      enabled: true
    },
    {
      id: "lv5",
      level: 5,
      code: "Lv.5",
      name: "喵皇",
      icon: "👑",
      min: 75,
      max: 100,
      maxPlus: true,
      description: "俱乐部招牌、人气主播或大神级陪玩。",
      upgradeCondition: "招牌陪玩、人气主播或大神级资质通过后台审核。",
      sort: 5,
      open: false,
      enabled: true
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

  function save(levels) {
    var clean = levels.map(normalizeLevelRecord).sort(function (a, b) {
      return Number(a.sort || a.level) - Number(b.sort || b.level);
    });
    STORAGE_KEYS.forEach(function (key) {
      localStorage.setItem(key, JSON.stringify(clean));
    });
    return clean;
  }

  function read() {
    for (var i = 0; i < STORAGE_KEYS.length; i += 1) {
      var levels = parseJSON(localStorage.getItem(STORAGE_KEYS[i]));
      if (levels && levels.length) return levels.map(normalizeLevelRecord);
    }
    return save(DEFAULT_LEVELS);
  }

  function formatRange(level) {
    var item = normalizeLevelRecord(level);
    return "RM" + item.min + "–RM" + item.max + (item.maxPlus ? "+" : "");
  }

  function formatHourlyPrice(value, lang) {
    var amount = priceNumber(value);
    return "RM" + amount + (lang === "en" ? "/hr" : "/小时");
  }

  function priceNumber(value) {
    var match = String(value == null ? "" : value).match(/\d+(?:\.\d+)?/);
    var number = match ? Number(match[0]) : 0;
    return Number.isFinite(number) ? Math.max(0, number) : 0;
  }

  function normalizeLevelRecord(level) {
    var fallback = DEFAULT_LEVELS[0];
    var raw = Object.assign({}, fallback, level || {});
    var levelNo = Number(raw.level || String(raw.id || raw.code || "").match(/\d+/) || fallback.level);
    var official = DEFAULT_LEVELS.find(function (item) { return item.level === levelNo; }) || fallback;
    var merged = Object.assign({}, official, raw);
    merged.level = levelNo || official.level;
    merged.id = merged.id || "lv" + merged.level;
    merged.code = "Lv." + merged.level;
    merged.name = merged.name || official.name;
    merged.icon = merged.icon || official.icon;
    merged.min = Math.max(0, Number(merged.min || merged.minimum_price || official.min));
    merged.max = Math.max(merged.min, Number(merged.max || merged.maximum_price || official.max));
    merged.maxPlus = Boolean(merged.maxPlus || merged.allowAboveMax || merged.maximum_price_plus);
    merged.description = merged.description || merged.desc || official.description;
    merged.upgradeCondition = merged.upgradeCondition || merged.upgrade_condition || official.upgradeCondition;
    merged.sort = Number(merged.sort || merged.sort_weight || merged.level);
    merged.open = merged.open !== false && merged.open !== "否" && merged.open !== "关闭";
    merged.enabled = merged.enabled !== false && merged.enabled !== "停用" && merged.status !== "disabled";
    return merged;
  }

  function findLevel(value) {
    var levels = read();
    var text = String(value == null ? "" : value).trim();
    var number = Number(text.match(/\d+/));
    return levels.find(function (level) {
      return level.id === text || level.code === text || level.name === text || level.level === number || text.indexOf(level.name) > -1;
    }) || levels[0] || copy(DEFAULT_LEVELS[0]);
  }

  function label(value) {
    var level = findLevel(value);
    return level.icon + " " + level.code + " " + level.name;
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

  function normalizeCompanion(item) {
    var source = item || {};
    var level = findLevel(source.levelId || source.player_level_id || source.level || source.level_name || source.rank);
    var price = clampPrice(level, source.hourlyPrice || source.servicePrice || source.price || source.unitPrice);
    return Object.assign({}, source, {
      levelId: level.id,
      levelNumber: level.level,
      levelLabel: label(level.id),
      levelRange: formatRange(level),
      levelDescription: level.description,
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

  window.MCJCompanionLevels = {
    defaults: DEFAULT_LEVELS.map(copy),
    read: read,
    save: save,
    find: findLevel,
    label: label,
    formatRange: formatRange,
    formatHourlyPrice: formatHourlyPrice,
    priceNumber: priceNumber,
    validatePrice: validatePrice,
    normalizeCompanion: normalizeCompanion,
    selectOptions: selectOptions
  };
})();
