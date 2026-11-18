(function () {
  "use strict";

  var state = { items: [], rules: null, loading: true, error: "", periodStart: "", periodEnd: "", periodLabel: "" };

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
  function formatUnits(v) {
    var n = Number(v || 0);
    if (!Number.isFinite(n) || n <= 0) return "0";
    if (Number.isInteger(n)) return String(n);
    return String(Math.round(n * 100) / 100);
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
  /** Compact TOP badge pinned to the cover's top-left corner. */
  function topBadge(rank) {
    var tone = rank === 1 ? "gold" : rank === 2 ? "silver" : "rose";
    return (
      '<span class="pop-rank-badge ' +
      tone +
      '" aria-label="本周第' +
      esc(rank) +
      '名"><em>TOP</em><strong>' +
      esc(rank) +
      "</strong></span>"
    );
  }
  function profileHref(item) {
    var uuid = String(item.companionId || item.id || item.uid || "").trim();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(uuid)) return "companion-center.html";
    return "profile.html?id=" + encodeURIComponent(uuid);
  }

  function rankActionsHtml(item) {
    return (
      '<div class="pop-rank-foot">' +
      '<div class="pop-rank-stats">' +
      '<span class="pop-rank-stat"><small>本周完成</small><b>' +
      esc(formatUnits(item.completedOrders)) +
      " 单</b></span>" +
      '<span class="pop-rank-stat price"><small>单价</small><b>' +
      esc(money(item.price).toFixed(0)) +
      " 猫粮</b></span>" +
      "</div>" +
      '<a class="mini-order pop-rank-cta" href="' +
      esc(profileHref(item)) +
      '">查看详情</a>' +
      "</div>"
    );
  }

  function toCardItem(item) {
    return {
      id: item.companionId || "",
      companionId: item.companionId || "",
      publicId: item.publicId || "",
      name: displayName(item),
      avatar: avatarUrl(item.avatar),
      cover: item.cover ? avatarUrl(item.cover) : "",
      level: item.level || "未设置等级",
      levelId: item.levelId || "",
      game: item.mainService || item.game || (item.services || []).map(function (s) { return s && s.name; }).filter(Boolean).join("、"),
      availabilityStatus: presenceCode(item),
      availabilityText: item.availabilityText || "",
      tags: [],
    };
  }

  /** Fallback when the shared card renderer is unavailable — same DOM contract. */
  function fallbackCardHtml(card, opts) {
    var code = card.availabilityStatus || "offline";
    return (
      '<article class="neon-card companion-card hot-card ' +
      esc(opts.extraClass) +
      '" ' +
      opts.extraAttrs +
      '><div class="hot-cover"><img src="' +
      esc(card.cover || card.avatar || DEFAULT_AVATAR) +
      '" alt="' +
      esc(card.name) +
      '" loading="lazy" decoding="async" onerror="this.onerror=null;this.src=\'' +
      DEFAULT_AVATAR +
      '\'"><span class="online-dot ' +
      statusClass(code) +
      '" aria-hidden="true"></span></div><div class="hot-info"><div class="hot-name-row"><h3>' +
      esc(card.name) +
      '</h3><span class="mcj-brand-mark">MCJ</span></div><div class="hot-meta"><span class="companion-level-pill" data-level-id="' +
      esc(card.levelId) +
      '">' +
      esc(card.level) +
      '</span><span class="hot-status">' +
      esc(presenceLabel(card)) +
      "</span></div>" +
      (card.game ? '<p class="hot-game">' + esc(card.game) + "</p>" : "") +
      opts.actionsHtml +
      "</div></article>"
    );
  }

  /** Homepage ranking variant of the shared hall/home companion card. */
  function rankCard(item) {
    var r = item.rank;
    var card = toCardItem(item);
    var opts = {
      variant: "home",
      extraClass: "pop-rank-card rank-" + r,
      extraAttrs: 'data-pop-rank="' + esc(r) + '" data-completed-orders="' + esc(formatUnits(item.completedOrders || 0)) + '"',
      actionsHtml: rankActionsHtml(item),
      maxTags: 1,
    };
    var shared = window.MCJRealData && window.MCJRealData.companionCardHtml;
    var html = typeof shared === "function" ? shared(card, opts) : fallbackCardHtml(card, opts);
    return String(html).replace('<div class="hot-cover">', '<div class="hot-cover">' + topBadge(r));
  }

  function shortWeekLabel(start, end, fallback) {
    var fromApi = String(fallback || "").trim();
    if (/^\d{1,2}月\d{1,2}日\s*[–-]\s*\d{1,2}月\d{1,2}日$/.test(fromApi)) return fromApi;
    var s = String(start || "").split("-");
    var e = String(end || "").split("-");
    if (s.length < 3 || e.length < 3) return "";
    var sm = Number(s[1]);
    var sd = Number(s[2]);
    var em = Number(e[1]);
    var ed = Number(e[2]);
    if (!(sm > 0 && sd > 0 && em > 0 && ed > 0)) return "";
    return sm + "月" + sd + "日 – " + em + "月" + ed + "日";
  }

  function syncWeekLabel() {
    var el = document.getElementById("homePopularityWeek");
    if (!el) return;
    var label = shortWeekLabel(state.periodStart, state.periodEnd, state.periodLabel);
    if (label) el.textContent = label;
  }

  /** Slot 4: MORE → 俱乐部总接单榜. Same card chrome as TOP3. */
  function moreCardHtml() {
    return (
      '<a class="pop-rank-card pop-rank-more" href="ranking.html" data-pop-rank="more" aria-label="查看全俱乐部接单榜">' +
      '<span class="rank-border-flow" aria-hidden="true"></span>' +
      '<div class="pop-rank-more-inner">' +
      '<span class="pop-rank-more-badge">MORE</span>' +
      "<strong>更多</strong>" +
      "<p>查看全俱乐部接单榜</p>" +
      "</div></a>"
    );
  }

  /** Honest ranks only — never pad with zero-unit companions; never show TOP 4. */
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
        '<div class="pop-rank-grid pop-rank-count-0">' +
        '<div class="pop-empty">本周暂无有效完成服务的陪玩</div>' +
        moreCardHtml() +
        "</div>";
      return;
    }
    var top = state.items.slice(0, 3);
    // Fixed slots: TOP1…TOP3 (as available) + always「查看更多」as 4th slot — never TOP4.
    root.innerHTML =
      '<div class="pop-rank-grid pop-rank-count-' +
      top.length +
      '">' +
      top.map(rankCard).join("") +
      moreCardHtml() +
      "</div>";
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
        state.periodLabel = body.periodLabel || "";
        state.error = "";
        syncWeekLabel();
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
})();
