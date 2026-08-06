(function () {
  "use strict";

  var TYPES = ["services", "games", "service_types", "companion_tags", "voice_types", "companion_levels", "hot_games", "featured_players", "profile_services"];
  var state = { loaded: false, loading: null, byType: {} };
  TYPES.forEach(function (type) { state.byType[type] = []; });

  function text(value) { return value == null ? "" : String(value); }
  function isEnabled(item) { return item && item.enabled !== false && item.status !== "disabled" && item.status !== "unpublished"; }
  function sortItems(items) {
    return (items || []).slice().sort(function (a, b) {
      return (Number(a.sort || a.draft && a.draft.sort || 100) - Number(b.sort || b.draft && b.draft.sort || 100)) || text(a.name || a.title).localeCompare(text(b.name || b.title), "zh-Hans-CN");
    });
  }
  function normalize(item) {
    var draft = item && typeof item.draft === "object" && item.draft ? item.draft : {};
    var data = Object.assign({}, item || {}, draft);
    data.id = text(item && item.id || data.id || data.slug || data.code || data.name || data.title);
    data.name = text(data.name || data.title || data.game || data.code);
    data.title = text(data.title || data.name);
    data.category = text(data.category || "");
    data.icon = text(data.icon || "");
    data.defaultPrice = text(data.defaultPrice || data.default_price || "");
    data.displayPositions = Array.isArray(data.displayPositions)
      ? data.displayPositions
      : (Array.isArray(data.display_positions) ? data.display_positions : []);
    data.sort = Number(data.sort || 100);
    data.enabled = isEnabled(item);
    data.showOnHome = data.showOnHome !== false && data.showHome !== false;
    data.allowApply = data.allowApply !== false;
    data.allowOrder = data.allowOrder !== false;
    return data;
  }
  var FIXED_SERVICE_TYPES = [
    { id: "play_service", name: "陪玩服务", title: "陪玩服务", category: "服务类型", enabled: true, sort: 1 },
    { id: "chat_service", name: "陪聊服务", title: "陪聊服务", category: "服务类型", enabled: true, sort: 2 }
  ];
  function applyServices(list) {
    var services = sortItems((list || []).map(normalize).filter(isEnabled));
    state.byType.services = services;
    // 游戏分类：来自 services 表（启用中的游戏）
    state.byType.games = services.filter(function (item) {
      var positions = item.displayPositions || [];
      return item.allowApply !== false && (positions.indexOf("companion_apply") >= 0 || !positions.length);
    });
    if (!state.byType.games.length) state.byType.games = services.slice();
    // 服务类型：固定「陪玩服务 / 陪聊服务」，禁止把游戏名塞进服务类型
    state.byType.service_types = FIXED_SERVICE_TYPES.map(normalize);
    state.byType.hot_games = services.filter(function (item) {
      var positions = item.displayPositions || [];
      return item.showOnHome !== false && positions.indexOf("home") >= 0;
    });
    state.byType.profile_services = services.filter(function (item) {
      var positions = item.displayPositions || [];
      return item.allowApply !== false && positions.indexOf("companion_profile") >= 0;
    });
  }
  function loadFromServicesApi() {
    return fetch("/api/platform/services", { headers: { Accept: "application/json" } })
      .then(function (res) {
        return res.text().then(function (raw) {
          var body = {};
          try { body = raw ? JSON.parse(raw) : {}; } catch (err) { throw new Error("服务接口返回非 JSON：HTTP " + res.status); }
          if (!res.ok || body.ok === false) throw new Error(body.message || ("HTTP " + res.status));
          return body;
        });
      })
      .then(function (body) {
        applyServices(body.services || []);
        return state;
      });
  }
  var TAXONOMY_CHANNEL = "mcj-taxonomy-reload";
  var loadedAt = 0;
  var TTL_MS = 60 * 1000;

  function load(force) {
    var stale = loadedAt && Date.now() - loadedAt > TTL_MS;
    if (force || stale) {
      state.loaded = false;
      state.loading = null;
    }
    if (state.loaded) return Promise.resolve(state);
    if (state.loading) return state.loading;
    state.loading = loadFromServicesApi()
      .then(function () {
        return fetch("/api/platform/content?types=" + encodeURIComponent(["companion_tags", "voice_types", "companion_levels", "featured_players"].join(",")), {
          headers: { Accept: "application/json" },
          cache: "no-store"
        })
          .then(function (res) {
            return res.text().then(function (raw) {
              var body = {};
              try { body = raw ? JSON.parse(raw) : {}; } catch (err) { return { byType: {} }; }
              if (!res.ok || body.ok === false) return { byType: {} };
              return body;
            });
          })
          .catch(function () { return { byType: {} }; });
      })
      .then(function (body) {
        var byType = (body && body.byType) || {};
        ["companion_tags", "voice_types", "companion_levels", "featured_players"].forEach(function (type) {
          state.byType[type] = sortItems((Array.isArray(byType[type]) ? byType[type] : []).map(normalize).filter(isEnabled));
        });
        // Hall filter tags: only those marked supportsFilter / showInHall
        state.byType.companion_tags = state.byType.companion_tags.filter(function (item) {
          return item.supportsFilter !== false && item.showInHall !== false;
        });
        if (window.MCJCompanionLevels && window.MCJCompanionLevels.hydrateFromList && state.byType.companion_levels.length) {
          window.MCJCompanionLevels.hydrateFromList(state.byType.companion_levels);
        }
        state.loaded = true;
        loadedAt = Date.now();
        state.loading = null;
        return state;
      })
      .catch(function (err) {
        console.error("[平台配置] 读取失败", err);
        state.loaded = true;
        loadedAt = Date.now();
        state.loading = null;
        return state;
      });
    return state.loading;
  }
  function reload() { return load(true); }
  function notifyChanged() {
    try {
      if (typeof BroadcastChannel !== "undefined") {
        var ch = new BroadcastChannel(TAXONOMY_CHANNEL);
        ch.postMessage({ type: "reload", at: Date.now() });
        ch.close();
      }
    } catch (e) { /* ignore */ }
    try { localStorage.setItem(TAXONOMY_CHANNEL, String(Date.now())); } catch (e2) { /* ignore */ }
  }
  try {
    if (typeof BroadcastChannel !== "undefined") {
      var taxonomyCh = new BroadcastChannel(TAXONOMY_CHANNEL);
      taxonomyCh.onmessage = function () { reload(); };
    }
  } catch (e3) { /* ignore */ }
  try {
    window.addEventListener("storage", function (ev) {
      if (ev && ev.key === TAXONOMY_CHANNEL) reload();
    });
  } catch (e4) { /* ignore */ }
  function items(type) { return state.byType[type] || []; }
  function label(item) { return text(item && (item.name || item.title || item.game || item.code)); }
  function value(item) { return text(item && (item.slug || item.code || item.id || item.name || item.title || item.game)); }
  function levelId(item) {
    var raw = value(item) || text(item && (item.levelId || item.level || item.levelName));
    var match = raw.match(/\d+/);
    return item && item.id ? item.id : (match ? "lv" + match[0] : raw);
  }
  function levelLabel(id) {
    var found = items("companion_levels").find(function (item) {
      return levelId(item) === id || value(item) === id || label(item) === id;
    });
    if (!found) return text(id || "");
    return [found.code, found.name].filter(Boolean).join(" ") || label(found);
  }

  window.MCJTaxonomy = {
    load: load,
    reload: reload,
    notifyChanged: notifyChanged,
    items: items,
    enabled: items,
    label: label,
    value: value,
    levelId: levelId,
    levelLabel: levelLabel,
    byType: state.byType
  };
})();
