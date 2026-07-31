(function () {
  "use strict";

  var TYPES = ["services", "games", "service_types", "companion_tags", "companion_levels", "hot_games", "featured_players", "profile_services"];
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
  function applyServices(list) {
    var services = sortItems((list || []).map(normalize).filter(isEnabled));
    state.byType.services = services;
    state.byType.games = services.filter(function (item) {
      var positions = item.displayPositions || [];
      return item.allowApply !== false && positions.indexOf("companion_apply") >= 0;
    });
    state.byType.service_types = services.filter(function (item) {
      var positions = item.displayPositions || [];
      return item.allowOrder !== false && (positions.indexOf("boss_order") >= 0 || positions.indexOf("cs_order") >= 0);
    });
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
  function load() {
    if (state.loaded) return Promise.resolve(state);
    if (state.loading) return state.loading;
    state.loading = loadFromServicesApi()
      .then(function () {
        return fetch("/api/platform/content?types=" + encodeURIComponent(["companion_tags", "companion_levels", "featured_players"].join(",")), { headers: { Accept: "application/json" } })
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
        ["companion_tags", "companion_levels", "featured_players"].forEach(function (type) {
          state.byType[type] = sortItems((Array.isArray(byType[type]) ? byType[type] : []).map(normalize).filter(isEnabled));
        });
        if (window.MCJCompanionLevels && window.MCJCompanionLevels.hydrateFromList && state.byType.companion_levels.length) {
          window.MCJCompanionLevels.hydrateFromList(state.byType.companion_levels);
        }
        state.loaded = true;
        return state;
      })
      .catch(function (err) {
        console.error("[平台配置] 读取失败", err);
        state.loaded = true;
        return state;
      });
    return state.loading;
  }
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
    items: items,
    enabled: items,
    label: label,
    value: value,
    levelId: levelId,
    levelLabel: levelLabel,
    byType: state.byType
  };
})();
