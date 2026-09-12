(function () {
  "use strict";

  var state = { items: [], rules: null, loading: true, error: "", errorKey: "" };

  function tt(key, fallback, vars) {
    try {
      if (window.MCJI18n && typeof window.MCJI18n.t === "function") {
        var out = window.MCJI18n.t(key, vars);
        if (out && out !== key) return out;
      }
    } catch (e) {}
    var text = fallback != null ? String(fallback) : String(key || "");
    if (vars && typeof vars === "object") {
      text = text.replace(/\{(\w+)\}/g, function (_, name) {
        return vars[name] != null ? String(vars[name]) : "{" + name + "}";
      });
    }
    return text;
  }

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  var DEFAULT_AVATAR = "/default-avatar.png";
  function avatarUrl(v) {
    if (window.MCJCompanionMedia && window.MCJCompanionMedia.pickStableMediaUrl) {
      return window.MCJCompanionMedia.pickStableMediaUrl(v) || DEFAULT_AVATAR;
    }
    var s = String(v == null ? "" : v).trim();
    if (!s || /meow-cuijiao-brand\.(jpe?g|png|webp)$/i.test(s)) return DEFAULT_AVATAR;
    if (/^(blob:|data:)/i.test(s) || /\/storage\/v1\/object\/sign\//i.test(s)) return DEFAULT_AVATAR;
    return s;
  }
  function isGarbledName(value) {
    var s = String(value == null ? "" : value).trim();
    if (!s) return true;
    var marks = (s.match(/[?\uFFFD？]/g) || []).length;
    if (marks >= 2 && marks >= Math.ceil(s.length * 0.4)) return true;
    if (/^(?:\?|？|\uFFFD){2,}/.test(s)) return true;
    return false;
  }
  function displayName(item) {
    var n = String((item && (item.nickname || item.name)) || "").trim();
    if (isGarbledName(n)) return tt("home.unnamed_companion", "未命名陪玩");
    return n || tt("home.unnamed_companion", "未命名陪玩");
  }
  function money(v) {
    var n = Number(v || 0);
    return Number.isFinite(n) ? n : 0;
  }
  function statusClass(code) {
    if (window.MCJCompanionPresence) {
      return window.MCJCompanionPresence.fromCompanion({ availabilityStatus: code }).className;
    }
    if (code === "online") return "is-online";
    if (code === "busy") return "is-busy";
    if (code === "paused") return "is-paused";
    return "is-offline";
  }
  function presenceLabel(item) {
    if (window.MCJCompanionPresence) {
      return window.MCJCompanionPresence.fromCompanion(item).label;
    }
    return item.availabilityText || item.status || item.onlineStatus || tt("hall.status_offline", "离线");
  }
  function presenceCode(item) {
    if (window.MCJCompanionPresence) {
      return window.MCJCompanionPresence.fromCompanion(item).code;
    }
    return item.availabilityStatus || "offline";
  }
  function badge(rank) {
    if (rank === 1) return '<span class="pop-medal gold">' + esc(tt("home.pop_champion", "冠军")) + "</span>";
    if (rank === 2) return '<span class="pop-medal silver">' + esc(tt("home.pop_runner_up", "亚军")) + "</span>";
    if (rank === 3) return '<span class="pop-medal bronze">' + esc(tt("home.pop_third", "季军")) + "</span>";
    return '<span class="pop-rank-num">' + esc(rank) + "</span>";
  }
  function profileHref(item) {
    var uuid = String(item.companionId || item.id || item.uid || "").trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid)) return "companion-center.html";
    return "profile.html?id=" + encodeURIComponent(uuid);
  }
  function orderHref(item) {
    var uuid = String(item.companionId || item.id || item.uid || "").trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid)) return "companion-center.html";
    return "profile.html?id=" + encodeURIComponent(uuid) + "&open_order=1";
  }

  function podiumCard(item) {
    var r = item.rank;
    var levelLabel = String(item.level || "").trim();
    if (!levelLabel || levelLabel === "未设置等级") levelLabel = tt("home.level_unset", "未设置等级");
    return (
      '<article class="pop-podium-card rank-' +
      r +
      '">' +
      badge(r) +
      '<a class="pop-avatar" href="' +
      esc(profileHref(item)) +
      '"><img src="' +
      esc(avatarUrl(item.avatar)) +
      '" alt="" loading="lazy" decoding="async" onerror="this.onerror=null;this.src=\'' +
      DEFAULT_AVATAR +
      '\'"></a>' +
      "<h3>" +
      esc(displayName(item)) +
      "</h3>" +
      '<div class="pop-meta"><span class="companion-level-pill" data-level-id="' +
      esc(item.levelId || "") +
      '">' +
      esc(levelLabel) +
      '</span><span class="mcj-status-dot ' +
      statusClass(presenceCode(item)) +
      '"><i></i>' +
      esc(presenceLabel(item)) +
      "</span></div>" +
      '<div class="pop-stats">' +
      (state.rules && state.rules.showScore !== false
        ? "<div><span>" + esc(tt("home.pop_score", "人气值")) + "</span><strong>" + esc(money(item.popularityScore)) + "</strong></div>"
        : "") +
      (state.rules && state.rules.showOrders !== false
        ? "<div><span>" + esc(tt("home.pop_week_orders", "本周接单")) + "</span><strong>" + esc(item.completedOrders) + "</strong></div>"
        : "") +
      "<div><span>" +
      esc(tt("home.pop_reviews", "好评")) +
      "</span><strong>" +
      esc(item.fiveStarReviews) +
      "</strong></div>" +
      "<div><span>" +
      esc(tt("home.pop_unit_price", "单价")) +
      "</span><strong>" +
      esc(money(item.price).toFixed(0)) +
      " " +
      esc(tt("home.pop_catfood", "猫粮")) +
      "</strong></div>" +
      "</div>" +
      '<button type="button" class="pop-order-btn" data-pop-order="' +
      esc(item.companionId || "") +
      '" data-pop-name="' +
      esc(displayName(item)) +
      '" data-pop-price="' +
      esc(item.price || "") +
      '" data-pop-game="' +
      esc(item.mainService || item.game || "") +
      '" data-pop-avatar="' +
      esc(avatarUrl(item.avatar)) +
      '" data-pop-public-id="' +
      esc(item.publicId || "") +
      '" data-pop-status="' +
      esc(item.availabilityStatus || "") +
      '" data-pop-status-text="' +
      esc(presenceLabel(item) || item.availabilityText || "") +
      '">' +
      esc(tt("home.pop_order_now", "立即下单")) +
      "</button>" +
      "</article>"
    );
  }

  function listRow(item) {
    var levelLabel = String(item.level || "").trim();
    if (!levelLabel || levelLabel === "未设置等级") levelLabel = tt("home.level_unset", "未设置等级");
    return (
      '<article class="pop-list-row" style="display:grid">' +
      '<a class="pop-list-rank" href="' +
      esc(profileHref(item)) +
      '" style="text-decoration:none;color:inherit">' +
      esc(item.rank) +
      "</a>" +
      '<a href="' +
      esc(profileHref(item)) +
      '"><img class="pop-list-avatar" src="' +
      esc(avatarUrl(item.avatar)) +
      '" alt="" loading="lazy" decoding="async" onerror="this.onerror=null;this.src=\'' +
      DEFAULT_AVATAR +
      '\'"></a>' +
      '<div class="pop-list-main"><strong>' +
      esc(displayName(item)) +
      "</strong><span>" +
      esc(item.publicId || "") +
      ' · <span class="companion-level-pill" data-level-id="' +
      esc(item.levelId || "") +
      '">' +
      esc(levelLabel) +
      "</span> · " +
      esc(presenceLabel(item)) +
      "</span><span>" +
      esc(item.mainService || item.game || "-") +
      " · " +
      esc(money(item.price).toFixed(0)) +
      " " +
      esc(tt("home.pop_catfood", "猫粮")) +
      " · " +
      esc(tt("home.pop_orders_short", "单")) +
      esc(item.completedOrders) +
      " · " +
      esc(tt("home.pop_reviews", "好评")) +
      esc(item.fiveStarReviews) +
      " · " +
      esc(tt("home.pop_gifts", "礼物")) +
      esc(money(item.giftCatFood)) +
      "</span></div>" +
      '<div class="pop-list-side"><strong>' +
      esc(money(item.popularityScore)) +
      "</strong><span>" +
      esc(tt("home.pop_score", "人气值")) +
      "</span></div>" +
      '<div style="display:flex;gap:6px">' +
      '<button type="button" class="pop-list-cta" data-pop-order="' +
      esc(item.companionId || "") +
      '" data-pop-name="' +
      esc(displayName(item)) +
      '" data-pop-price="' +
      esc(item.price || "") +
      '" data-pop-game="' +
      esc(item.mainService || item.game || "") +
      '" data-pop-avatar="' +
      esc(avatarUrl(item.avatar)) +
      '" data-pop-public-id="' +
      esc(item.publicId || "") +
      '" data-pop-status="' +
      esc(item.availabilityStatus || "") +
      '" data-pop-status-text="' +
      esc(presenceLabel(item) || item.availabilityText || "") +
      '">' +
      esc(tt("home.pop_order", "下单")) +
      "</button></div></article>"
    );
  }

  /** Honest ranks only — never pad podium with zero-score public companions. */
  function normalizeRankItems(items) {
    return (items || [])
      .filter(function (it) {
        return it && (it.companionId || it.publicId) && !isGarbledName(it.nickname);
      })
      .map(function (it, idx) {
        if (!(Number(it.rank) > 0)) it.rank = idx + 1;
        return it;
      });
  }

  function resolveErrorText() {
    if (state.errorKey) return tt(state.errorKey, state.error || "");
    return state.error || "";
  }

  function paint() {
    var root = document.getElementById("homePopularityBoard");
    if (!root) return;
    if (state.loading) {
      root.innerHTML = '<div class="pop-empty">' + esc(tt("home.pop_loading", "正在读取本周人气榜...")) + "</div>";
      return;
    }
    if (state.error) {
      root.innerHTML = '<div class="pop-empty">' + esc(resolveErrorText()) + "</div>";
      return;
    }
    if (!state.items.length) {
      var empty = esc(tt("home.no_companions", "暂无陪玩"));
      root.innerHTML =
        '<div class="pop-desktop-grid"><div class="pop-empty pop-desktop-empty">' + empty + "</div></div>" +
        '<div class="pop-empty">' + empty + "</div>";
      return;
    }
    var top = state.items.slice(0, 3);
    var rest = state.items.slice(3);
    var desktopFour = state.items.slice(0, Math.max(3, Math.min(4, state.items.length)));
    var desktopHtml =
      '<div class="pop-desktop-grid">' +
      desktopFour
        .map(function (item) {
          return String(podiumCard(item)).replace("pop-podium-card", "pop-podium-card pop-desktop-card");
        })
        .join("") +
      "</div>";
    // Rank order must stay 冠军 → 亚军 → 季军 → TOP4+ (no visual reordering).
    var podiumHtml = "";
    if (top.length) {
      podiumHtml = '<div class="pop-podium">' + top.map(podiumCard).join("") + "</div>";
    }
    var listHtml = rest.length ? '<div class="pop-list">' + rest.map(listRow).join("") + "</div>" : "";
    root.innerHTML = desktopHtml + podiumHtml + listHtml;
  }

  function load() {
    state.loading = true;
    state.errorKey = "";
    paint();
    fetch("/api/popularity?action=home&period=weekly&limit=10", { headers: { Accept: "application/json" }, cache: "no-store" })
      .then(function (res) {
        return res.json().then(function (body) {
          if (!res.ok || body.ok === false) throw new Error(body.message || tt("home.pop_failed", "人气榜读取失败"));
          return body;
        });
      })
      .then(function (body) {
        state.rules = body.rules || null;
        state.error = "";
        state.errorKey = "";
        if (body.enabled === false) {
          state.items = [];
          state.errorKey = "home.pop_disabled";
          state.error = "人气榜暂未开启";
          return null;
        }
        state.items = normalizeRankItems(body.items || []);
      })
      .catch(function (err) {
        state.items = [];
        var msg = String((err && err.message) || "");
        if (!msg || /failed to fetch|fetch failed|networkerror|network request failed|load failed/i.test(msg)) {
          state.errorKey = "";
          state.error = "暂时无法连接服务器，请稍后重试";
        } else if (msg === "人气榜读取失败" || msg === tt("home.pop_failed", "人气榜读取失败")) {
          state.errorKey = "home.pop_failed";
          state.error = "人气榜读取失败";
        } else {
          state.errorKey = "";
          state.error = msg || "人气榜暂不可用";
        }
      })
      .finally(function () {
        state.loading = false;
        paint();
      });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", load);
  else load();

  window.addEventListener("mcj:localechange", function () {
    paint();
  });

  document.addEventListener("click", function (e) {
    var orderBtn = e.target.closest("[data-pop-order]");
    if (orderBtn) {
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      var id = orderBtn.getAttribute("data-pop-order") || "";
      if (!id) {
        alert("陪玩资料缺失，无法下单");
        return;
      }
      if (!window.MCJPlaceOrder || typeof window.MCJPlaceOrder.openFromCompanion !== "function") {
        location.href = "profile.html?id=" + encodeURIComponent(id) + "&open_order=1";
        return;
      }
      var price = Number(orderBtn.getAttribute("data-pop-price") || 0);
      if (!(price > 0)) {
        location.href = "profile.html?id=" + encodeURIComponent(id) + "&open_order=1";
        return;
      }
      try {
        window.MCJPlaceOrder.openFromCompanion({
          companionId: id,
          id: id,
          uid: id,
          companionName: orderBtn.getAttribute("data-pop-name") || "陪玩",
          name: orderBtn.getAttribute("data-pop-name") || "陪玩",
          unitPrice: price,
          priceValue: price,
          price: price,
          service: orderBtn.getAttribute("data-pop-game") || "陪玩",
          game: orderBtn.getAttribute("data-pop-game") || "陪玩",
          avatar: orderBtn.getAttribute("data-pop-avatar") || "",
          publicId: orderBtn.getAttribute("data-pop-public-id") || "",
          pricingUnit: "小时",
          availabilityStatus: orderBtn.getAttribute("data-pop-status") || "",
          availabilityText: orderBtn.getAttribute("data-pop-status-text") || "",
          status: orderBtn.getAttribute("data-pop-status-text") || "",
          publishReady: true,
        });
      } catch (err) {
        if (window.MCJPlaceOrder && typeof window.MCJPlaceOrder.close === "function") {
          window.MCJPlaceOrder.close();
        }
        alert((err && err.message) || "打开下单弹窗失败，请重试");
      }
      return;
    }
  });
})();
