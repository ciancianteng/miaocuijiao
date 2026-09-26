(function () {
  "use strict";

  var state = { items: [], rules: null, loading: true, error: "", periodStart: "", periodEnd: "" };

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
    if (isGarbledName(n)) return "未命名陪玩";
    return n || "未命名陪玩";
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
    return item.availabilityText || item.status || item.onlineStatus || "离线";
  }
  function presenceCode(item) {
    if (window.MCJCompanionPresence) {
      return window.MCJCompanionPresence.fromCompanion(item).code;
    }
    return item.availabilityStatus || "offline";
  }
  /** Premium TOP badge — top-left corner, gold/silver/rose metal. */
  function topBadge(rank) {
    if (rank === 1) {
      return (
        '<span class="pop-top-badge gold" aria-label="TOP1">' +
        '<span class="pop-top-badge-icon" aria-hidden="true">👑</span>' +
        "<strong>TOP1</strong></span>"
      );
    }
    if (rank === 2) {
      return (
        '<span class="pop-top-badge silver" aria-label="TOP2">' +
        '<span class="pop-top-badge-icon" aria-hidden="true">🥈</span>' +
        "<strong>TOP2</strong></span>"
      );
    }
    if (rank === 3) {
      return (
        '<span class="pop-top-badge bronze" aria-label="TOP3">' +
        '<span class="pop-top-badge-icon" aria-hidden="true">🥉</span>' +
        "<strong>TOP3</strong></span>"
      );
    }
    return '<span class="pop-rank-num">' + esc(rank) + "</span>";
  }
  function profileHref(item) {
    var uuid = String(item.companionId || item.id || item.uid || "").trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid)) return "companion-center.html";
    return "profile.html?id=" + encodeURIComponent(uuid);
  }

  function podiumCard(item) {
    var r = item.rank;
    var rating = Number(item.averageRating || 0);
    var ratingHtml =
      rating > 0
        ? "<div><span>好评星级</span><strong>" + esc(rating.toFixed(1)) + "</strong></div>"
        : "";
    return (
      '<article class="pop-podium-card rank-' +
      r +
      '">' +
      topBadge(r) +
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
      esc(item.level) +
      '</span><span class="mcj-status-dot ' +
      statusClass(presenceCode(item)) +
      '"><i></i>' +
      esc(presenceLabel(item)) +
      "</span></div>" +
      '<div class="pop-stats">' +
      '<div class="pop-stat-orders"><span>本周完成</span><strong>' +
      esc(item.completedOrders || 0) +
      " 单</strong></div>" +
      "<div><span>单价</span><strong>" +
      esc(money(item.price).toFixed(0)) +
      " 猫粮</strong></div>" +
      ratingHtml +
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
      '">立即下单</button>' +
      "</article>"
    );
  }

  /** Honest ranks only — never pad podium with zero-score public companions. */
  function normalizeRankItems(items) {
    return (items || [])
      .filter(function (it) {
        return (
          it &&
          (it.companionId || it.publicId) &&
          !isGarbledName(it.nickname) &&
          Number(it.completedOrders || 0) > 0
        );
      })
      .slice(0, 3)
      .map(function (it, idx) {
        it.rank = idx + 1;
        return it;
      });
  }

  function paint() {
    var root = document.getElementById("homePopularityBoard");
    if (!root) return;
    if (state.loading) {
      root.innerHTML = '<div class="pop-empty">正在读取本周人气榜...</div>';
      return;
    }
    if (state.error) {
      root.innerHTML = '<div class="pop-empty">' + esc(state.error) + "</div>";
      return;
    }
    if (!state.items.length) {
      root.innerHTML =
        '<div class="pop-desktop-grid"><div class="pop-empty pop-desktop-empty">本周暂无已完成订单排行</div></div>' +
        '<div class="pop-empty">本周暂无已完成订单排行</div>';
      return;
    }
    var top = state.items.slice(0, 3);
    var desktopHtml =
      '<div class="pop-desktop-grid">' +
      top
        .map(function (item) {
          return String(podiumCard(item)).replace("pop-podium-card", "pop-podium-card pop-desktop-card");
        })
        .join("") +
      "</div>";
    // Rank order must stay TOP1 → TOP2 → TOP3 (no visual reordering).
    var podiumHtml = "";
    if (top.length) {
      podiumHtml =
        '<div class="pop-podium pop-podium-count-' + top.length + '">' + top.map(podiumCard).join("") + "</div>";
    }
    root.innerHTML = desktopHtml + podiumHtml;
  }

  function load() {
    state.loading = true;
    paint();
    fetch("/api/popularity?action=home&period=weekly&limit=3", { headers: { Accept: "application/json" }, cache: "no-store" })
      .then(function (res) {
        return res.json().then(function (body) {
          if (!res.ok || body.ok === false) throw new Error(body.message || "人气榜读取失败");
          return body;
        });
      })
      .then(function (body) {
        state.rules = body.rules || null;
        state.periodStart = body.periodStart || "";
        state.periodEnd = body.periodEnd || "";
        state.error = "";
        if (body.enabled === false) {
          state.items = [];
          state.error = "人气榜暂未开启";
          return null;
        }
        state.items = normalizeRankItems(body.items || []);
      })
      .catch(function (err) {
        state.items = [];
        var msg = String((err && err.message) || "");
        state.error = !msg || /failed to fetch|fetch failed|networkerror|network request failed|load failed/i.test(msg)
          ? "暂时无法连接服务器，请稍后重试"
          : (msg || "人气榜暂不可用");
      })
      .finally(function () {
        state.loading = false;
        paint();
      });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", load);
  else load();

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
