(function () {
  "use strict";
  var state = { period: "weekly", game: "", online: "", level: "", items: [], rules: null };

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function medal(rank) {
    if (rank === 1) return '<span class="pop-medal gold">冠军</span>';
    if (rank === 2) return '<span class="pop-medal silver">亚军</span>';
    if (rank === 3) return '<span class="pop-medal bronze">季军</span>';
    return "<strong>#" + esc(rank) + "</strong>";
  }
  function orderAttrs(item) {
    return (
      ' data-rank-order="' +
      esc(item.companionId || "") +
      '" data-rank-name="' +
      esc(item.nickname || "") +
      '" data-rank-price="' +
      esc(item.price || "") +
      '" data-rank-game="' +
      esc(item.mainService || item.game || "") +
      '" data-rank-avatar="' +
      esc(item.avatar || "") +
      '" data-rank-public-id="' +
      esc(item.publicId || "") +
      '"'
    );
  }
  function openOrderFromEl(el) {
    var id = el.getAttribute("data-rank-order") || "";
    if (!id) {
      alert("陪玩资料缺失，无法下单");
      return;
    }
    if (!window.MCJPlaceOrder || typeof window.MCJPlaceOrder.openFromCompanion !== "function") {
      location.href = "profile.html?id=" + encodeURIComponent(id) + "&open_order=1";
      return;
    }
    var price = Number(el.getAttribute("data-rank-price") || 0);
    if (!(price > 0)) {
      // Fallback: go to profile so catalog can fill price; never leave blank blur.
      location.href = "profile.html?id=" + encodeURIComponent(id) + "&open_order=1";
      return;
    }
    try {
      window.MCJPlaceOrder.openFromCompanion({
        companionId: id,
        id: id,
        uid: id,
        companionName: el.getAttribute("data-rank-name") || "陪玩",
        name: el.getAttribute("data-rank-name") || "陪玩",
        unitPrice: price,
        priceValue: price,
        price: price,
        service: el.getAttribute("data-rank-game") || "陪玩",
        game: el.getAttribute("data-rank-game") || "陪玩",
        avatar: el.getAttribute("data-rank-avatar") || "",
        publicId: el.getAttribute("data-rank-public-id") || "",
        pricingUnit: "小时",
      });
    } catch (err) {
      if (window.MCJPlaceOrder && typeof window.MCJPlaceOrder.close === "function") {
        window.MCJPlaceOrder.close();
      }
      alert((err && err.message) || "打开下单弹窗失败，请重试");
    }
  }
  function paint() {
    var box = document.getElementById("rankBoard");
    if (!box) return;
    var items = state.items || [];
    if (!items.length) {
      box.innerHTML = '<div class="pop-empty">当前分类暂无上榜陪玩</div>';
      return;
    }
    var top = items.slice(0, 3);
    var rest = items.slice(3);
    var podium =
      '<div class="pop-podium">' +
      top
        .map(function (item) {
          return (
            '<article class="pop-podium-card rank-' +
            item.rank +
            '">' +
            medal(item.rank) +
            '<a class="pop-avatar" href="profile.html?id=' +
            esc(item.companionId) +
            '"><img src="' +
            esc(item.avatar || "/default-avatar.png") +
            '" alt="" onerror="this.onerror=null;this.src=\'/default-avatar.png\'"></a><h3>' +
            esc(item.nickname) +
            "</h3><div class=\"pop-meta\"><span>" +
            esc(item.publicId) +
            "</span><span>" +
            esc(item.level) +
            "</span></div><div class=\"pop-stats\"><div><span>人气</span><strong>" +
            esc(item.popularityScore) +
            "</strong></div><div><span>接单</span><strong>" +
            esc(item.completedOrders) +
            '</strong></div></div><button type="button" class="pop-order-btn"' +
            orderAttrs(item) +
            ">立即下单</button></article>"
          );
        })
        .join("") +
      "</div>";

    var rows = rest
      .map(function (item) {
        return (
          '<div class="pop-full-row">' +
          "<div>" +
          medal(item.rank) +
          '</div><img src="' +
          esc(item.avatar || "/default-avatar.png") +
          '" alt="" style="width:48px;height:48px;border-radius:50%;object-fit:cover" onerror="this.onerror=null;this.src=\'/default-avatar.png\'">' +
          "<div><strong>" +
          esc(item.nickname) +
          '</strong><div class="muted">' +
          esc(item.publicId) +
          " · " +
          esc(item.mainService || item.game || "-") +
          "</div></div>" +
          '<div class="hide-sm"><span class="muted">等级</span><div>' +
          esc(item.level) +
          "</div></div>" +
          '<div class="hide-sm"><span class="muted">状态</span><div>' +
          esc(item.availabilityText) +
          "</div></div>" +
          '<div class="hide-sm"><span class="muted">接单</span><div>' +
          esc(item.completedOrders) +
          "</div></div>" +
          '<div class="hide-sm"><span class="muted">礼物猫粮</span><div>' +
          esc(item.giftCatFood) +
          "</div></div>" +
          "<div><span class=\"muted\">人气值</span><div><strong>" +
          esc(item.popularityScore) +
          '</strong></div></div><button type="button" class="pop-order-btn" style="width:auto;padding:0 14px"' +
          orderAttrs(item) +
          ">下单</button></div>"
        );
      })
      .join("");
    box.innerHTML = podium + rows;
  }

  function loadGames(items) {
    var sel = document.getElementById("rankGame");
    if (!sel) return;
    var set = {};
    (items || []).forEach(function (i) {
      if (i.game) set[i.game] = 1;
      if (i.mainService) set[i.mainService] = 1;
      if (i.gameKey) set[i.gameKey] = 1;
    });
    var current = state.game;
    var opts = ['<option value="">全部分类</option>'];
    Object.keys(set)
      .sort()
      .forEach(function (g) {
        opts.push('<option value="' + esc(g) + '"' + (current === g ? " selected" : "") + ">" + esc(g) + " 人气榜</option>");
      });
    ["LOL", "三角洲", "语音陪聊", "APEX"].forEach(function (g) {
      if (!set[g]) opts.push('<option value="' + g + '"' + (current === g ? " selected" : "") + ">" + g + " 人气榜</option>");
    });
    sel.innerHTML = opts.join("");
  }

  function fetchBoard() {
    var box = document.getElementById("rankBoard");
    if (box) box.innerHTML = '<div class="pop-empty">正在读取榜单...</div>';
    var q =
      "/api/popularity?action=board&period=" +
      encodeURIComponent(state.period) +
      "&limit=50&game=" +
      encodeURIComponent(state.game) +
      (state.online ? "&online=1" : "") +
      (state.level ? "&level=" + encodeURIComponent(state.level) : "");
    fetch(q, { headers: { Accept: "application/json" }, cache: "no-store" })
      .then(function (res) {
        return res.json().then(function (body) {
          if (!res.ok || body.ok === false) throw new Error(body.message || "读取失败");
          return body;
        });
      })
      .then(function (body) {
        state.items = body.items || [];
        state.rules = body.rules || null;
        loadGames(state.items);
        paint();
      })
      .catch(function (err) {
        var b = document.getElementById("rankBoard");
        if (b) b.innerHTML = '<div class="pop-empty">' + esc(err.message || "榜单暂不可用") + "</div>";
      });
  }

  document.getElementById("rankFilters").addEventListener("click", function (e) {
    var btn = e.target.closest("[data-period]");
    if (!btn) return;
    state.period = btn.getAttribute("data-period");
    document.querySelectorAll("[data-period]").forEach(function (b) {
      b.classList.toggle("active", b === btn);
    });
    fetchBoard();
  });
  document.getElementById("rankGame").addEventListener("change", function () {
    state.game = this.value;
    fetchBoard();
  });
  document.getElementById("rankOnline").addEventListener("change", function () {
    state.online = this.value;
    fetchBoard();
  });
  document.getElementById("rankLevel").addEventListener("change", function () {
    state.level = this.value;
    fetchBoard();
  });
  document.getElementById("rankBoard").addEventListener("click", function (e) {
    var btn = e.target.closest("[data-rank-order]");
    if (!btn) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.stopImmediatePropagation) e.stopImmediatePropagation();
    openOrderFromEl(btn);
  });

  fetchBoard();
})();
