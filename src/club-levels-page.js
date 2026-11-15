(function () {
  "use strict";

  var state = {
    levels: [],
    games: [],
    selectedGameId: "",
    openGameId: "",
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

  function selectedGame() {
    return (state.games || []).find(function (g) {
      return String(g.id) === String(state.selectedGameId);
    }) || state.games[0] || null;
  }

  function markupByLevel(game, levelId) {
    var rows = (game && game.levels) || [];
    return rows.find(function (row) {
      return String(row.levelId) === String(levelId);
    }) || null;
  }

  function moneyText(n) {
    if (n == null || !isFinite(Number(n))) return "";
    var v = Math.round(Number(n) * 100) / 100;
    return String(v);
  }

  function lvAmountHtml(hit) {
    if (!hit || !hit.markupConfigured) return '<strong class="mcj-lv-amount is-empty">待配置</strong>';
    return '<strong class="mcj-lv-amount">+' + esc(moneyText(hit.markupAllowance)) + "</strong>";
  }

  function priceCell(configured, value) {
    if (!configured || value == null) return "暂未定价";
    return moneyText(value) + " 猫粮";
  }

  function iconHtml(game) {
    var icon = String(game.icon || "").trim();
    if (/^(https?:)?\/\//.test(icon) || icon.indexOf("/") === 0 || /\.(png|jpe?g|webp|gif|svg)$/i.test(icon)) {
      return '<img class="mcj-game-icon" src="' + esc(icon) + '" alt="">';
    }
    return '<span class="mcj-game-icon" aria-hidden="true">' + esc(icon || "◆") + "</span>";
  }

  function lvCard(level, game) {
    var id = String(level.id || "").toLowerCase();
    var hit = markupByLevel(game, id);
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
      lvAmountHtml(hit) +
      '<span class="mcj-lv-foot">等级加价 · 猫粮/小时</span>' +
      "</article>"
    );
  }

  function gameDetailHtml(game) {
    if (!game) return '<p class="club-levels-empty">暂无该游戏服务</p>';
    var rows = (state.levels || []).map(function (level) {
      var hit = markupByLevel(game, level.id);
      return (
        '<div class="mcj-svc-lv"><span>' +
        esc(level.code || level.id) +
        " 加价 / 最终单价</span><strong>" +
        esc(hit && hit.markupConfigured ? "+" + moneyText(hit.markupAllowance) : "待配置") +
        " · " +
        esc(priceCell(hit && hit.finalConfigured, hit && hit.finalPrice)) +
        "</strong></div>"
      );
    }).join("");
    return (
      '<div class="mcj-game-detail" data-game-detail="' +
      esc(game.id) +
      '">' +
      '<div class="mcj-svc-row">' +
      '<p class="mcj-svc-name">' +
      esc(game.name) +
      "</p>" +
      '<p class="mcj-svc-meta">基础单价：' +
      esc(priceCell(game.baseConfigured, game.basePrice)) +
      "　计价单位：" +
      esc(game.unit || "局") +
      "</p>" +
      '<div class="mcj-svc-levels">' +
      rows +
      "</div></div></div>"
    );
  }

  function render() {
    var root = document.getElementById("clubLevelsRoot");
    if (!root) return;
    var game = selectedGame();
    var selector = "";
    if ((state.games || []).length > 1) {
      selector =
        '<label class="mcj-pt-select-wrap"><select class="mcj-pt-select" data-price-game>' +
        state.games
          .map(function (g) {
            return (
              '<option value="' +
              esc(g.id) +
              '"' +
              (String(g.id) === String(state.selectedGameId) ? " selected" : "") +
              ">" +
              esc(g.name) +
              "</option>"
            );
          })
          .join("") +
        "</select></label>";
    }
    var lvHtml = (state.levels || [])
      .map(function (level) {
        return lvCard(level, game);
      })
      .join("");
    var gamesHtml = (state.games || [])
      .map(function (g) {
        var open = String(state.openGameId) === String(g.id);
        return (
          '<button type="button" class="mcj-game-card' +
          (open ? " is-open" : "") +
          '" data-open-game="' +
          esc(g.id) +
          '">' +
          iconHtml(g) +
          '<span class="mcj-game-name">' +
          esc(g.name) +
          "</span></button>" +
          (open ? gameDetailHtml(g) : "")
        );
      })
      .join("");
    root.innerHTML =
      '<section class="mcj-pt-hero"><div><h1>✦ 陪玩等级 · 加价权益</h1><p>不同等级，专属服务加价权益</p></div><div class="mcj-pt-stars">' +
      starSvg() +
      starSvg() +
      "</div></section>" +
      '<section class="mcj-pt-card">' +
      selector +
      '<div class="mcj-lv-grid">' +
      (lvHtml || '<div class="club-levels-empty">暂无等级配置</div>') +
      "</div></section>" +
      '<section class="mcj-games-head"><h2>游戏服务价格表</h2><p>选择游戏，查看全部陪玩项目及单价</p></section>' +
      '<section class="mcj-game-grid">' +
      (gamesHtml || '<div class="club-levels-empty">暂无启用游戏</div>') +
      "</section>";
  }

  function bind() {
    var root = document.getElementById("clubLevelsRoot");
    if (!root || root.getAttribute("data-bound") === "1") return;
    root.setAttribute("data-bound", "1");
    root.addEventListener("change", function (e) {
      var sel = e.target.closest("[data-price-game]");
      if (!sel) return;
      state.selectedGameId = sel.value;
      render();
    });
    root.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-open-game]");
      if (!btn) return;
      var id = btn.getAttribute("data-open-game");
      state.openGameId = String(state.openGameId) === String(id) ? "" : id;
      state.selectedGameId = id;
      render();
    });
  }

  function pickDefaultGame(games) {
    var delta = (games || []).find(function (g) {
      return /三角洲/.test(String(g.name || ""));
    });
    return (delta && delta.id) || (games[0] && games[0].id) || "";
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
        state.selectedGameId = pickDefaultGame(state.games);
        render();
      })
      .catch(function () {
        var root = document.getElementById("clubLevelsRoot");
        if (root) root.innerHTML = '<div class="club-levels-empty">价格表暂时无法读取</div>';
      });
  }

  load();
})();
