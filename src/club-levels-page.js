(function () {
  "use strict";

  var FALLBACK_CATS = [
    { id: "端游", name: "端游" },
    { id: "手游", name: "手游" },
    { id: "娱乐陪伴", name: "娱乐陪伴" },
  ];

  var state = {
    mode: "games",
    levels: [],
    games: [],
    groups: [],
    categories: [],
    openGroupId: "",
    category: "all",
  };

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function starSvg() {
    return (
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#F7D4E6" d="M12 2.4l1.62 5.1h5.36l-4.34 3.16 1.66 5.1L12 12.6 7.7 15.76l1.66-5.1L5.02 7.5h5.36L12 2.4z"/></svg>'
    );
  }

  function crownSvg(fill) {
    return (
      '<svg class="mcj-lv-crown" viewBox="0 0 24 24" aria-hidden="true"><path fill="' +
      esc(fill) +
      '" d="M4 17.2 6.1 8.4l3.9 3.7L12 6.2l2 5.9 3.9-3.7 2.1 8.8H4zm0 1.6h16V20H4v-1.2z"/></svg>'
    );
  }

  function crownFill(id) {
    if (id === "lv5") return "#F7C779";
    if (id === "lv4") return "#F2B77D";
    if (id === "lv3") return "#D69CFB";
    if (id === "lv2") return "#75B8F7";
    return "#A9A5B2";
  }

  function moneyText(n) {
    if (n == null || !isFinite(Number(n))) return "";
    var v = Math.round(Number(n) * 100) / 100;
    return String(v);
  }

  function priceCell(configured, value) {
    if (!configured || value == null) return "暂未定价";
    return moneyText(value) + " 猫粮";
  }

  function iconHtml(item) {
    var icon = String((item && item.icon) || "").trim();
    if (/^(https?:)?\/\//.test(icon) || icon.indexOf("/") === 0 || /\.(png|jpe?g|webp|gif|svg)$/i.test(icon)) {
      return '<img class="mcj-game-icon" src="' + esc(icon) + '" alt="">';
    }
    return '<span class="mcj-game-icon" aria-hidden="true">' + esc(icon || "◆") + "</span>";
  }

  function categoryTabs() {
    var cats = [{ id: "all", name: "全部" }].concat(
      (state.categories || []).map(function (c) {
        return { id: c.name || c.id, name: c.name || c.id };
      })
    );
    if (cats.length <= 1) {
      cats = [{ id: "all", name: "全部" }].concat(FALLBACK_CATS);
    }
    return (
      '<div class="mcj-game-tabs" role="tablist" aria-label="游戏分类">' +
      cats
        .map(function (tab) {
          var on = state.category === tab.id;
          return (
            '<button type="button" class="mcj-game-tab' +
            (on ? " is-active" : "") +
            '" role="tab" aria-selected="' +
            (on ? "true" : "false") +
            '" data-game-cat="' +
            esc(tab.id) +
            '">' +
            esc(tab.name) +
            "</button>"
          );
        })
        .join("") +
      "</div>"
    );
  }

  function modeTabs() {
    return (
      '<div class="mcj-mode-tabs" role="tablist" aria-label="价格表切换">' +
      '<button type="button" class="mcj-mode-tab' +
      (state.mode === "games" ? " is-active" : "") +
      '" role="tab" aria-selected="' +
      (state.mode === "games" ? "true" : "false") +
      '" data-price-mode="games">游戏价格表</button>' +
      '<button type="button" class="mcj-mode-tab' +
      (state.mode === "levels" ? " is-active" : "") +
      '" role="tab" aria-selected="' +
      (state.mode === "levels" ? "true" : "false") +
      '" data-price-mode="levels">等级加价</button>' +
      "</div>"
    );
  }

  function filteredGroups() {
    var cat = state.category || "all";
    var list = (state.groups || []).filter(function (g) {
      if (cat === "all") return true;
      return String(g.category || "") === String(cat);
    });
    if (cat !== "all") return list;
    // Under「全部」, merge same game family across 端游/手游 so one card expands all variants.
    var map = {};
    var order = [];
    list.forEach(function (g) {
      var title = String(g.title || g.name || "").trim() || "未命名";
      if (!map[title]) {
        map[title] = {
          id: "all::" + title,
          title: title,
          category: "all",
          icon: g.icon || "🎮",
          sort: Number(g.sort || 100) || 100,
          services: [],
        };
        order.push(title);
      }
      map[title].sort = Math.min(map[title].sort, Number(g.sort || 100) || 100);
      if (g.icon) map[title].icon = g.icon;
      (g.services || []).forEach(function (svc) {
        map[title].services.push(svc);
      });
    });
    return order
      .map(function (title) {
        var row = map[title];
        row.services = row.services.slice().sort(function (a, b) {
          return (a.sort || 0) - (b.sort || 0) || String(a.name).localeCompare(String(b.name), "zh");
        });
        return row;
      })
      .sort(function (a, b) {
        return a.sort - b.sort || String(a.title).localeCompare(String(b.title), "zh");
      });
  }

  function serviceRowsHtml(services) {
    return (services || [])
      .map(function (svc) {
        return (
          '<div class="mcj-svc-item">' +
          '<p class="mcj-svc-name">' +
          esc(svc.name) +
          "</p>" +
          '<div class="mcj-svc-price">' +
          "<strong>" +
          esc(priceCell(svc.baseConfigured, svc.basePrice)) +
          "</strong>" +
          "<span>/" +
          esc(svc.unit || "局") +
          "</span></div></div>"
        );
      })
      .join("");
  }

  function gamesPaneHtml() {
    var list = filteredGroups();
    var cards = list
      .map(function (g) {
        var open = String(state.openGroupId) === String(g.id);
        return (
          '<article class="mcj-game-block' +
          (open ? " is-open" : "") +
          '">' +
          '<button type="button" class="mcj-game-card" data-open-group="' +
          esc(g.id) +
          '" aria-expanded="' +
          (open ? "true" : "false") +
          '">' +
          iconHtml(g) +
          '<span class="mcj-game-name">' +
          esc(g.title || g.name) +
          "</span>" +
          '<span class="mcj-game-chevron" aria-hidden="true"></span></button>' +
          '<div class="mcj-game-panel"' +
          (open ? "" : " hidden") +
          ">" +
          (open
            ? serviceRowsHtml(g.services) || '<p class="club-levels-empty">暂无服务项目</p>'
            : "") +
          "</div></article>"
        );
      })
      .join("");
    return (
      '<section class="mcj-games-head"><h2>游戏服务价格表</h2><p>按分类查看服务，点击游戏展开区服 / 模式 / 机密等项目（仅基础单价）</p></section>' +
      categoryTabs() +
      '<section class="mcj-game-list">' +
      (cards || '<div class="club-levels-empty">该分类暂无启用服务</div>') +
      "</section>"
    );
  }

  function lvAmountHtml(level) {
    if (!level || !level.markupConfigured) return '<strong class="mcj-lv-amount is-empty">待配置</strong>';
    return '<strong class="mcj-lv-amount">+' + esc(moneyText(level.markupAllowance)) + "</strong>";
  }

  function lvCard(level) {
    var id = String(level.id || "").toLowerCase();
    var name = String(level.name || "").trim() || id.toUpperCase();
    var extra =
      id === "lv5"
        ? '<span style="display:flex;align-items:center;gap:6px">' +
          crownSvg(crownFill(id)) +
          '<span class="mcj-lv-badge">最高等级</span></span>'
        : crownSvg(crownFill(id));
    return (
      '<article class="mcj-lv-card mcj-lv-card--' +
      esc(id) +
      '">' +
      '<div class="mcj-lv-top"><span class="mcj-lv-code">' +
      esc(level.code || id.toUpperCase()) +
      "</span>" +
      extra +
      "</div>" +
      '<span class="mcj-lv-name">' +
      esc(name) +
      "</span>" +
      lvAmountHtml(level) +
      '<span class="mcj-lv-foot">等级加价 · 猫粮/小时</span>' +
      "</article>"
    );
  }

  function levelsPaneHtml() {
    var lvHtml = (state.levels || []).map(lvCard).join("");
    var intros = (state.levels || [])
      .filter(function (lv) {
        return String(lv.description || "").trim();
      })
      .map(function (lv) {
        return (
          '<div class="mcj-lv-intro-row"><strong>' +
          esc(lv.code || lv.id) +
          " · " +
          esc(lv.name || "") +
          "</strong><p>" +
          esc(lv.description) +
          "</p></div>"
        );
      })
      .join("");
    return (
      '<section class="mcj-pt-hero"><div><h1>✦ 陪玩等级 · 加价权益</h1><p>不同等级，专属服务加价权益</p></div><div class="mcj-pt-stars">' +
      starSvg() +
      starSvg() +
      "</div></section>" +
      '<section class="mcj-pt-card"><div class="mcj-lv-grid">' +
      (lvHtml || '<div class="club-levels-empty">暂无等级配置</div>') +
      "</div></section>" +
      (intros ? '<section class="mcj-lv-intros">' + intros + "</section>" : "")
    );
  }

  function render() {
    var root = document.getElementById("clubLevelsRoot");
    if (!root) return;
    root.innerHTML =
      modeTabs() + (state.mode === "levels" ? levelsPaneHtml() : gamesPaneHtml());
  }

  function bind() {
    var root = document.getElementById("clubLevelsRoot");
    if (!root || root.getAttribute("data-bound") === "1") return;
    root.setAttribute("data-bound", "1");
    root.addEventListener("click", function (e) {
      var modeBtn = e.target.closest("[data-price-mode]");
      if (modeBtn) {
        var mode = modeBtn.getAttribute("data-price-mode") || "games";
        if (state.mode === mode) return;
        state.mode = mode;
        render();
        return;
      }
      var tab = e.target.closest("[data-game-cat]");
      if (tab) {
        var next = tab.getAttribute("data-game-cat") || "all";
        if (state.category === next) return;
        state.category = next;
        if (state.openGroupId) {
          var still = filteredGroups().some(function (g) {
            return String(g.id) === String(state.openGroupId);
          });
          if (!still) state.openGroupId = "";
        }
        render();
        return;
      }
      var btn = e.target.closest("[data-open-group]");
      if (!btn) return;
      var id = btn.getAttribute("data-open-group");
      state.openGroupId = String(state.openGroupId) === String(id) ? "" : id;
      render();
    });
  }

  function normalizeGroups(body) {
    if (body && Array.isArray(body.groups) && body.groups.length) return body.groups;
    var games = (body && body.games) || [];
    var map = {};
    games.forEach(function (g) {
      var cat = g.priceCategory || g.category || "端游";
      var title = g.family || g.name;
      var key = cat + "::" + title;
      if (!map[key]) {
        map[key] = {
          id: key,
          title: title,
          category: cat,
          icon: g.icon || "🎮",
          sort: Number(g.sort || 100) || 100,
          services: [],
        };
      }
      map[key].services.push(g);
      map[key].sort = Math.min(map[key].sort, Number(g.sort || 100) || 100);
    });
    return Object.keys(map)
      .map(function (k) {
        return map[k];
      })
      .sort(function (a, b) {
        return a.sort - b.sort || String(a.title).localeCompare(String(b.title), "zh");
      });
  }

  function load() {
    bind();
    fetch("/api/public/club-price-table", { cache: "no-store", headers: { Accept: "application/json" } })
      .then(function (r) {
        return r.json();
      })
      .then(function (body) {
        state.levels = (body && body.levels) || [];
        state.games = (body && body.games) || [];
        state.categories = (body && body.categories) || FALLBACK_CATS.slice();
        state.groups = normalizeGroups(body);
        state.mode = "games";
        state.category = "all";
        state.openGroupId = "";
        render();
      })
      .catch(function () {
        var root = document.getElementById("clubLevelsRoot");
        if (root) root.innerHTML = '<div class="club-levels-empty">价格表暂时无法读取</div>';
      });
  }

  load();
})();
