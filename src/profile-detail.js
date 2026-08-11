(function () {
  "use strict";

  var state = {
    companion: null,
    catalog: null,
    draft: null,
  };

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function money(v) {
    if (window.MCJCurrency) return window.MCJCurrency.formatPlain(v);
    var n = Number(v || 0);
    return (Number.isFinite(n) ? n : 0).toFixed(2).replace(/\.00$/, "") + " 猫粮";
  }
  function moneyRate(v, unit) {
    if (window.MCJCurrency) return window.MCJCurrency.formatRate(v, unit || "小时");
    return money(v).replace(/\s*猫粮$/, "") + " 猫粮/" + (unit || "小时");
  }
  function param() {
    var p = new URLSearchParams(location.search);
    return p.get("player") || p.get("id") || p.get("uid") || "";
  }
  function shell() {
    return document.querySelector(".profile-detail-shell");
  }
  function bottom() {
    return document.querySelector(".profile-bottom-bar");
  }
  function token() {
    return localStorage.getItem("mcjAuthAccessToken") || sessionStorage.getItem("mcjAuthAccessToken") || "";
  }
  function authHeaders() {
    var t = token();
    var h = { Accept: "application/json", "Content-Type": "application/json" };
    if (t) {
      h.Authorization = "Bearer " + t;
      h["x-mcj-access-token"] = t;
    }
    return h;
  }
  function statusHtml(c) {
    if (window.MCJCompanionPresence && typeof window.MCJCompanionPresence.statusDotHtml === "function") {
      return window.MCJCompanionPresence.statusDotHtml(c, esc);
    }
    var code = String((c && c.availabilityStatus) || "offline");
    var text = (c && (c.availabilityText || c.status || c.onlineStatus)) || "离线";
    var cls =
      code === "online" || /在线/.test(text)
        ? "is-online"
        : code === "busy" || /忙碌/.test(text)
          ? "is-busy"
          : code === "paused" || /暂停/.test(text)
            ? "is-paused"
            : "is-offline";
    return (
      '<span class="mcj-status-dot ' +
      cls +
      '" data-online-status-label="' +
      esc(text) +
      '"><i></i>' +
      esc(text) +
      "</span>"
    );
  }
  function syncPresence(c) {
    if (window.MCJCompanionPresence && typeof window.MCJCompanionPresence.normalizeCompanionFields === "function") {
      return window.MCJCompanionPresence.normalizeCompanionFields(c);
    }
    return c;
  }
  function plainEmptyMetric(n, whenPositive) {
    var v = Number(n);
    if (!Number.isFinite(v) || v <= 0) return "暂无数据";
    return typeof whenPositive === "function" ? whenPositive(v) : String(v);
  }
  function isPlayableVoice(url) {
    var s = String(url || "").trim();
    return !!(s && /^https?:\/\//i.test(s) && !/^storage:\/\//i.test(s));
  }
  function idem() {
    return "idem-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10);
  }

  function renderLoading() {
    var s = shell();
    if (s) s.innerHTML = '<section class="detail-card"><h1>陪玩资料</h1><p>正在读取真实陪玩资料...</p></section>';
  }
  function renderError(msg, opts) {
    opts = opts || {};
    var raw = String(msg || "");
    var friendly = raw;
    if (/invalid input syntax for type uuid|uuid|PGRST|postgres|数据库/i.test(raw)) {
      friendly = "该陪玩资料不存在";
    } else if (!friendly.trim()) {
      friendly = "该陪玩资料不存在或已下架";
    }
    var s = shell();
    var retry =
      opts.retry !== false
        ? '<button type="button" class="order-now" data-profile-reload>重新加载</button>'
        : "";
    if (s)
      s.innerHTML =
        '<section class="detail-card"><h1>暂无资料</h1><p>' +
        esc(friendly) +
        '</p><div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px">' +
        retry +
        '<a class="order-now" href="companion-center.html" style="opacity:.9">返回陪玩大厅</a></div></section>';
    var b = bottom();
    if (b) b.hidden = true;
  }

  function displayCurrency(text) {
    if (window.MCJCurrency && window.MCJCurrency.rewriteLegacy) {
      return window.MCJCurrency.rewriteLegacy(text);
    }
    return String(text == null ? "" : text).replace(/RM\s*/gi, "").replace(/(\d+(?:\.\d+)?)\s*[-–]\s*RM?\s*(\d+(?:\.\d+)?)/i, "$1–$2 猫粮");
  }
  function rankText(rank) {
    var n = Number(rank || 0);
    if (n > 0) return "第 " + n + " 名";
    return "暂无数据";
  }
  function metaRow(label, valueHtml, empty) {
    return (
      '<div class="pd-meta-row"><span class="pd-meta-label">' +
      esc(label) +
      '</span><strong class="pd-meta-value' +
      (empty ? " is-empty" : "") +
      '">' +
      valueHtml +
      "</strong></div>"
    );
  }

  function middleEllipsis(text, maxLen) {
    text = String(text || "");
    maxLen = maxLen || 22;
    if (text.length <= maxLen) return text;
    var head = Math.max(6, Math.ceil((maxLen - 3) * 0.55));
    var tail = Math.max(4, maxLen - 3 - head);
    return text.slice(0, head) + "..." + text.slice(-tail);
  }

  function reviewBadge(rating) {
    var n = Number(rating) || 0;
    if (n >= 5) return "终验好评";
    if (n >= 4) return "好评";
    if (n >= 3) return "中评";
    if (n > 0) return "评价";
    return "";
  }

  function reviewDate(raw) {
    var s = String(raw || "").trim();
    if (!s) return "";
    return s.slice(0, 10);
  }

  function bindReviewExpand(root) {
    if (!root) return;
    root.querySelectorAll(".pd-review-item").forEach(function (card) {
      var body = card.querySelector(".pd-review-body");
      var btn = card.querySelector("[data-review-expand]");
      if (!body || !btn) return;
      body.classList.remove("is-expanded");
      btn.hidden = true;
      btn.setAttribute("aria-expanded", "false");
      btn.textContent = "展开↓";
      requestAnimationFrame(function () {
        var prevClamp = body.style.webkitLineClamp;
        var prevDisplay = body.style.display;
        var prevOverflow = body.style.overflow;
        body.style.webkitLineClamp = "unset";
        body.style.display = "block";
        body.style.overflow = "visible";
        var fullH = body.scrollHeight;
        body.style.webkitLineClamp = prevClamp;
        body.style.display = prevDisplay;
        body.style.overflow = prevOverflow;
        void body.offsetHeight;
        var clampedH = body.clientHeight;
        btn.hidden = !(fullH > clampedH + 2);
      });
    });
  }

  function render(c) {
    var s = shell();
    if (!s) return;
    if (window.MCJCompanionLevels && window.MCJCompanionLevels.normalizeCompanion) {
      c = window.MCJCompanionLevels.normalizeCompanion(c);
    }
    c = syncPresence(c);
    state.companion = c;
    var image =
      (window.MCJCompanionMedia && window.MCJCompanionMedia.resolveCover
        ? window.MCJCompanionMedia.resolveCover(c)
        : "") ||
      c.cardImageUrl ||
      c.cover ||
      c.avatar ||
      "/default-avatar.png";
    if (
      !String(image).trim() ||
      /meow-cuijiao-brand\.(jpe?g|png|webp)$/i.test(String(image)) ||
      /^(blob:|data:)/i.test(String(image)) ||
      /^(https?:\/\/)?(localhost|127\.0\.0\.1)/i.test(String(image))
    ) {
      image = "/default-avatar.png";
    }
    var hasVoice = isPlayableVoice(c.voiceUrl);
    var voiceBody = hasVoice
      ? '<div class="pd-voice-player"><audio controls preload="none" src="' +
        esc(c.voiceUrl) +
        '"></audio></div>'
      : '<p class="pd-voice-empty">暂未上传语音介绍</p>';
    var videoUrl = String(c.videoUrl || c.showcaseVideoUrl || "").trim();
    var hasVideo = !!(videoUrl && /^https?:\/\//i.test(videoUrl));
    var videoHtml = hasVideo
      ? '<div class="pd-video-player"><video controls playsinline preload="metadata" src="' +
        esc(videoUrl) +
        '"></video></div>'
      : "";
    var galleryList = Array.isArray(c.gallery) ? c.gallery.filter(function (g) { return g && g.url; }) : [];
    var levelText = c.levelLabel || c.level || c.levelName || "-";
    var priceText = displayCurrency(
      (window.MCJCurrency && c.priceDisplay ? window.MCJCurrency.rewriteLegacy(c.priceDisplay) : "") ||
        moneyRate(c.priceValue || c.price, c.pricingUnit || "小时")
    );
    var rangeText = displayCurrency(
      c.levelRange ||
        (window.MCJCompanionLevels && window.MCJCompanionLevels.formatRange
          ? window.MCJCompanionLevels.formatRange(c.levelId || c)
          : "") ||
        "-"
    );
    if (!rangeText || rangeText === "-") rangeText = "暂无数据";
    var publicId = c.publicId || (c.companionUid ? "P" + c.companionUid : "");
    var identityApi = window.MCJCompanionIdentity;
    var tagsHtml = identityApi
      ? identityApi.renderTags({
          levelId: c.levelId || "",
          levelLabel: levelText,
          gender: c.gender || "",
          voiceType: c.voiceType || c.voice_type || "",
          certTags: c.certTags || c.certificationTags || [],
          tags: c.tags || [],
          className: "tag-row companion-tags",
          includeLevel: true,
          includeGender: true,
          serviceLimit: 8,
        })
      : (function () {
          var tags = (c.tags || [])
            .slice(0, 6)
            .map(function (t) {
              return "<span class=\"mcj-service-tag\">" + esc(t) + "</span>";
            })
            .join("");
          var certTags = (c.certTags || c.certificationTags || [])
            .slice(0, 6)
            .map(function (t) {
              var name = typeof t === "string" ? t : t.name || t.title || "";
              if (!name) return "";
              var icon = typeof t === "object" && t.icon ? t.icon + " " : "";
              return '<span class="mcj-cert-badge">' + esc(icon + name) + "</span>";
            })
            .filter(Boolean)
            .join("");
          return certTags || tags
            ? '<div class="mcj-id-tags tag-row companion-tags">' + certTags + tags + "</div>"
            : "";
        })();
    var galleryUrls = galleryList.map(function (g) {
      return g.url;
    });
    var galleryWall =
      galleryList.length > 0
        ? galleryList
            .slice(0, 6)
            .map(function (g, idx) {
              return (
                '<img class="mcj-album-thumb" data-album-index="' +
                idx +
                '" src="' +
                esc(g.url) +
                '" alt="相册" loading="lazy" onerror="this.onerror=null;this.src=\'/default-avatar.png\'">'
              );
            })
            .join("")
        : "";
    var pop = c.popularity || state.popularity || null;
    var weeklyRank = pop && pop.weekly ? pop.weekly.rank : 0;
    var monthlyRank = pop && pop.monthly ? pop.monthly.rank : 0;
    var popScore = (pop && pop.weekly && (pop.weekly.score || pop.weekly.popularityScore)) || 0;
    var popBadges = "";
    if (pop && pop.weekly) {
      var wr = Number(pop.weekly.rank || 0);
      if (wr === 1) popBadges += '<span class="pop-medal gold">冠军</span>';
      else if (wr === 2) popBadges += '<span class="pop-medal silver">亚军</span>';
      else if (wr === 3) popBadges += '<span class="pop-medal bronze">季军</span>';
      else if (wr > 0 && wr <= 10) popBadges += '<span class="pop-medal" style="background:rgba(255,150,200,.2);color:#ffd6e8">TOP ' + esc(wr) + "</span>";
      if (wr > 0 && wr <= 20) popBadges += '<span class="pop-medal" style="background:rgba(255,150,200,.12);color:#ffd0e4">热门陪玩</span>';
    }
    var giftActions = token()
      ? '<div class="pd-info-actions"><button type="button" class="mcj-secondary" data-open-gift>送礼物</button><button type="button" data-open-tip>打赏猫粮</button></div>'
      : "";

    var reviewList = Array.isArray(c.reviews) ? c.reviews : [];
    var reviewCount = Number(c.reviewCount != null ? c.reviewCount : reviewList.length) || 0;
    var completedOrders = Number(c.completedOrders || c.orderCount || 0) || 0;
    var isNewcomer = !(reviewCount > 0 || completedOrders > 0 || Number(weeklyRank) > 0 || Number(monthlyRank) > 0);
    var reviewHtml = reviewList.length
      ? reviewList
          .slice(0, 12)
          .map(function (r) {
            var stars = "";
            var n = Math.max(0, Math.min(5, Math.round(Number(r.rating) || 0)));
            for (var i = 0; i < 5; i++) stars += i < n ? "★" : "☆";
            var code = String(r.bossCode || r.bossUid || "").trim();
            if (!code || /@/.test(code) || /^[0-9a-f-]{20,}$/i.test(code)) code = "";
            var bossLabel = code || "老板";
            var orderFull = String(r.orderNo || r.orderId || "").trim() || "-";
            var orderShown = middleEllipsis(orderFull, 22);
            var gameLabel = String(r.gameName || r.game || "").trim() || "-";
            var when = reviewDate(r.createdAt);
            var badge = reviewBadge(n);
            var avatarUrl = String(r.avatarUrl || r.bossAvatar || "").trim();
            var content = String(r.content || "").trim() || "老板已完成真实订单评价";
            var letter = esc(bossLabel.slice(0, 1) || "匿");
            var avatarHtml = avatarUrl
              ? '<img class="pd-review-avatar" src="' +
                esc(avatarUrl) +
                '" alt="" loading="lazy" onerror="this.style.display=\'none\';this.nextElementSibling&&(this.nextElementSibling.hidden=false)">' +
                '<span class="pd-review-avatar is-letter" hidden>' +
                letter +
                "</span>"
              : '<span class="pd-review-avatar is-letter">' + letter + "</span>";
            return (
              '<article class="pd-review-item">' +
              '<p class="pd-review-stars" aria-label="' +
              n +
              ' 星">' +
              esc(stars) +
              "</p>" +
              (badge ? '<p class="pd-review-badge">' + esc(badge) + "</p>" : "") +
              '<div class="pd-review-boss">' +
              avatarHtml +
              '<span class="pd-review-boss-code">' +
              esc(bossLabel) +
              "</span></div>" +
              '<p class="pd-review-order" title="' +
              esc(orderFull) +
              '">订单：' +
              esc(orderShown) +
              "</p>" +
              '<p class="pd-review-game">' +
              esc(gameLabel) +
              "</p>" +
              (when ? '<p class="pd-review-time">' + esc(when) + "</p>" : "") +
              '<p class="pd-review-body">' +
              esc(content) +
              '</p><button type="button" class="pd-review-expand" data-review-expand hidden aria-expanded="false">展开↓</button>' +
              "</article>"
            );
          })
          .join("")
      : isNewcomer
        ? '<p class="muted pd-review-empty">⭐ 新人陪玩 · 完成订单后将展示真实评价与排名</p>'
        : '<p class="muted pd-review-empty">暂无真实订单评价</p>';
    var hasRating = c.rating != null && Number(c.rating) > 0;
    var ratingText = hasRating
      ? Number(c.rating).toFixed(1) + "（" + reviewCount + " 条）"
      : "暂无数据";
    var goodCount = Number(c.goodReviewCount != null ? c.goodReviewCount : 0) || 0;
    var goodText = plainEmptyMetric(goodCount);
    var bioRaw = String(c.desc || c.description || "").trim();
    var bioText = bioRaw || "该陪玩暂未填写个人介绍";
    var bioEmpty = !bioRaw;
    var weeklyRankText = rankText(weeklyRank);
    var monthlyRankText = rankText(monthlyRank);
    var popScoreText = plainEmptyMetric(popScore);
    var newcomerBadge = isNewcomer ? '<span class="pd-newcomer-badge">⭐ 新人陪玩</span>' : "";

    s.setAttribute("data-companion-level", c.levelId || "");
    s.innerHTML =
      '<section class="profile-hero detail-card" data-companion-level="' +
      esc(c.levelId || "") +
      '"><div class="profile-avatar-wrap"><img class="profile-avatar" src="' +
      esc(image) +
      '" alt="' +
      esc(c.name) +
      ' 头像" onerror="this.onerror=null;this.src=\'/default-avatar.png\'">' +
      (popBadges ? '<div class="profile-pop-badges" style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;justify-content:center">' + popBadges + "</div>" : "") +
      '</div><div class="profile-info-panel"><p class="detail-label">MEOW CUI JIAO COMPANION</p><h1>' +
      esc(c.name || c.nickname || "陪玩") +
      " " +
      statusHtml(c) +
      (newcomerBadge ? " " + newcomerBadge : "") +
      '</h1><div class="profile-id">ID：' +
      esc(publicId || "待生成") +
      '</div><p class="profile-bio' +
      (bioEmpty ? " is-empty" : "") +
      '">' +
      esc(bioText) +
      '</p><div class="game-line">' +
      esc(c.game || "未设置游戏") +
      " · " +
      esc(priceText) +
      " · ★ " +
      esc(ratingText) +
      "</div>" +
      (tagsHtml || "") +
      '<div class="detail-card price-card pd-voice-card pd-voice-in-hero' +
      (hasVoice ? "" : " is-empty") +
      '"><div class="section-head"><h2>语音介绍</h2></div><div class="pd-voice-body">' +
      voiceBody +
      "</div></div>" +
      (hasVideo
        ? '<div class="detail-card pd-video-card"><div class="section-head"><h2>个人展示视频</h2></div>' + videoHtml + "</div>"
        : "") +
      '</div></section><section class="detail-card info-card pd-info-card pd-info-card--full"><div class="section-head"><h2>基本资料</h2></div><div class="pd-meta-list">' +
      metaRow("游戏", esc(c.game || "综合游戏")) +
      metaRow(
        "等级",
        '<span class="companion-level-pill" data-level-id="' + esc(c.levelId || "") + '">' + esc(levelText) + "</span>"
      ) +
      metaRow("评分", esc(ratingText), !hasRating) +
      metaRow("好评数", esc(goodText), !(goodCount > 0)) +
      metaRow("人气值", esc(popScoreText), !(Number(popScore) > 0)) +
      metaRow("在线状态", statusHtml(c)) +
      metaRow("价格区间", esc(rangeText), rangeText === "暂无数据") +
      metaRow("本周排名", esc(weeklyRankText), !(Number(weeklyRank) > 0)) +
      metaRow("本月排名", esc(monthlyRankText), !(Number(monthlyRank) > 0)) +
      '</div><div class="pd-stat-grid">' +
      '<div class="pd-stat-cell"><span>评价</span><strong class="' +
      (hasRating ? "" : "is-empty") +
      '">' +
      esc(ratingText) +
      "</strong></div>" +
      '<div class="pd-stat-cell"><span>人气值</span><strong class="' +
      (Number(popScore) > 0 ? "" : "is-empty") +
      '">' +
      esc(popScoreText) +
      "</strong></div>" +
      '<div class="pd-stat-cell"><span>本周排名</span><strong class="' +
      (Number(weeklyRank) > 0 ? "" : "is-empty") +
      '">' +
      esc(weeklyRankText) +
      "</strong></div>" +
      '<div class="pd-stat-cell"><span>完成订单</span><strong class="' +
      (completedOrders > 0 ? "" : "is-empty") +
      '">' +
      esc(plainEmptyMetric(completedOrders)) +
      "</strong></div>" +
      "</div>" +
      giftActions +
      "</section>" +
      (galleryList.length
        ? '<section class="detail-card game-wall"><div class="section-head"><h2>相册</h2></div><div class="wall-grid" data-profile-album>' +
          galleryWall +
          "</div></section>"
        : "") +
      '<section class="detail-card real-review-wall"><div class="section-head"><h2>真实订单评价</h2><span>' +
      (isNewcomer
        ? "新人陪玩"
        : "好评 " + esc(goodText) + " · 共 " + esc(reviewCount) + " 条") +
      '</span></div><div class="review-list" id="realReviewList">' +
      reviewHtml +
      "</div></section>";

    bindReviewExpand(s.querySelector("#realReviewList"));

    if (window.MCJCompanionIdentity && typeof window.MCJCompanionIdentity.bindAlbum === "function") {
      window.MCJCompanionIdentity.bindAlbum(s.querySelector("[data-profile-album]"), galleryUrls);
    }

    var b = bottom();
    if (b) {
      b.hidden = false;
      b.className = "profile-bottom-bar pd-bottom-bar";
      b.innerHTML =
        '<a class="pd-bottom-secondary" href="support.html?start=1">咨询客服</a>' +
        '<button type="button" class="order-now mcj-primary pd-bottom-primary" data-open-order>立即下单</button>';
    }

    // Empty / corrupt voice files must not leave a dead 0:00/0:00 control.
    s.querySelectorAll(".pd-voice-player audio").forEach(function (audio) {
      var card = audio.closest(".pd-voice-card");
      var body = audio.closest(".pd-voice-body");
      function showVoiceEmpty() {
        if (!body) return;
        body.innerHTML = '<p class="pd-voice-empty">暂未上传语音介绍</p>';
        if (card) card.classList.add("is-empty");
      }
      audio.addEventListener("error", showVoiceEmpty);
      audio.addEventListener("loadedmetadata", function () {
        var d = Number(audio.duration);
        if (!Number.isFinite(d) || d <= 0.05) showVoiceEmpty();
      });
    });
  }

  function closeSheet() {
    document.querySelectorAll(".mcj-sheet-mask").forEach(function (n) {
      n.remove();
    });
  }

  function openSheet(html) {
    closeSheet();
    var mask = document.createElement("div");
    mask.className = "mcj-sheet-mask";
    mask.innerHTML = '<div class="mcj-sheet" role="dialog">' + html + "</div>";
    document.body.appendChild(mask);
    mask.addEventListener("click", function (e) {
      if (e.target === mask) closeSheet();
    });
    return mask;
  }

  function loadCatalog() {
    var id = state.companion && (state.companion.id || state.companion.uid);
    return fetch("/api/boss/marketplace?action=catalog&companionId=" + encodeURIComponent(id), {
      headers: { Accept: "application/json" },
      cache: "no-store",
    })
      .then(function (res) {
        return res.json().then(function (body) {
          if (!res.ok || body.ok === false) throw new Error(body.message || "读取服务失败");
          return body;
        });
      })
      .then(function (body) {
        state.catalog = body;
        return body;
      });
  }

  function openOrderSheet() {
    var c = state.companion;
    if (!c) {
      alert("陪玩资料尚未加载完成");
      return;
    }
    function tryOpen(attempt) {
      if (!window.MCJPlaceOrder || typeof window.MCJPlaceOrder.openFromCompanion !== "function") {
        if ((attempt || 0) < 20) {
          setTimeout(function () {
            tryOpen((attempt || 0) + 1);
          }, 100);
          return;
        }
        alert("下单组件未加载，请刷新页面后重试");
        return;
      }
      // Open immediately so 立即下单 never feels like a no-op; catalog upgrades price if它回来得及.
      try {
        c = syncPresence(c);
        var presence =
          window.MCJCompanionPresence && window.MCJCompanionPresence.fromCompanion
            ? window.MCJCompanionPresence.fromCompanion(c)
            : null;
        window.MCJPlaceOrder.openFromCompanion(c, {
          companionId: c.id || c.uid,
          companionName: c.name || c.nickname,
          unitPrice: Number(c.priceValue != null ? c.priceValue : c.price) || 0,
          service: (c.services && c.services[0] && c.services[0].name) || c.game || c.mainGame || "",
          services: Array.isArray(c.services) ? c.services : [],
          serviceIds: c.serviceIds || c.service_ids || [],
          gamePrices: c.gamePrices || c.game_prices || {},
          avatar: c.avatar || c.cover || c.cardImageUrl || "",
          publicId: c.publicId || "",
          pricingUnit: c.pricingUnit || "小时",
          availabilityStatus: presence ? presence.code : c.availabilityStatus || "",
          availabilityText: presence ? presence.label : c.availabilityText || c.status || c.onlineStatus || "",
          online: presence ? presence.code === "online" || presence.code === "busy" : c.online != null ? c.online : c.canOrderNow,
          certTags: c.certTags || c.certificationTags || [],
          publishReady: c.publishReady,
          canAcceptOrders: c.canAcceptOrders,
          canOrderNow: presence ? presence.canOrderNow : c.canOrderNow,
          level: c.level || c.levelName || "",
        });
      } catch (err) {
        if (window.MCJPlaceOrder && window.MCJPlaceOrder.close) window.MCJPlaceOrder.close();
        alert((err && err.message) || "打开下单弹窗失败");
        return;
      }
      loadCatalog()
        .then(function (cat) {
          if (!window.MCJPlaceOrder || typeof window.MCJPlaceOrder.isOpen === "function" && !window.MCJPlaceOrder.isOpen()) return;
          if (!document.querySelector(".mcj-po-mask,[data-mcj-po-mask]")) return;
          if (window.MCJPlaceOrder && typeof window.MCJPlaceOrder.isSubmitting === "function" && window.MCJPlaceOrder.isSubmitting()) {
            return;
          }
          var catC = (cat && cat.companion) || {};
          var services = (cat && cat.services) || [];
          var selected = services[0] || null;
          var unitPrice = Number(
            (selected && selected.price) || catC.price || c.priceValue || c.price || 0
          );
          if (!(unitPrice > 0)) return;
          var serviceName =
            (selected && selected.name) || catC.game || c.game || c.mainGame || "";
          window.MCJPlaceOrder.openFromCompanion(c, {
            companionId: c.id || c.uid,
            companionName: catC.name || c.name || c.nickname,
            unitPrice: unitPrice,
            service: serviceName,
            services: services,
            serviceIds: c.serviceIds || c.service_ids || [],
            gamePrices: catC.gamePrices || c.gamePrices || c.game_prices || {},
            avatar: catC.avatar || c.avatar,
            publicId: catC.publicId || c.publicId || "",
            pricingUnit: (selected && selected.pricingUnit) || catC.pricingUnit || c.pricingUnit || "小时",
            availabilityStatus: c.availabilityStatus || catC.availabilityStatus || "",
            availabilityText: c.availabilityText || c.status || c.onlineStatus || "",
            online: c.online != null ? c.online : c.canOrderNow,
            certTags: c.certTags || c.certificationTags || [],
            publishReady: c.publishReady,
            canAcceptOrders: c.canAcceptOrders,
            canOrderNow: c.canOrderNow,
            level: c.level || c.levelName || "",
          });
        })
        .catch(function () {});
    }
    tryOpen(0);
  }

  function openGiftSheet() {
    loadCatalog()
      .then(function (cat) {
        var gifts = cat.gifts || [];
        if (!gifts.length) {
          alert("暂无上架礼物，请先在后台礼物管理配置");
          return;
        }
        var selected = gifts[0];
        var qty = 1;
        var rate = Number((cat.companion && cat.companion.giftCommissionRate) || 20);
        function paint() {
          var gross = Number(selected.catFoodPrice || 0) * qty;
          var fee = Math.round(gross * (rate / 100) * 100) / 100;
          var income = Math.round((gross - fee) * 100) / 100;
          openSheet(
            "<h3>送礼物</h3><div class=\"mcj-gift-grid\">" +
              gifts
                .map(function (g) {
                  return (
                    '<button type="button" class="mcj-gift-card' +
                    (g.id === selected.id ? " active" : "") +
                    '" data-gift="' +
                    esc(g.id) +
                    '"><div style="font-size:28px">🎁</div><strong>' +
                    esc(g.name) +
                    "</strong><span>" +
                    esc(g.catFoodPrice) +
                    " 猫粮</span></button>"
                  );
                })
                .join("") +
              '</div><div class="mcj-qty" style="margin-top:12px">数量 <button type="button" data-gqty="-">-</button><strong data-gqty-val>' +
              qty +
              '</strong><button type="button" data-gqty="+">+</button></div>' +
              "<p>总计 <strong>" +
              gross +
              "</strong> 猫粮 · 平台抽成 " +
              rate +
              "%（" +
              fee +
              "）· 陪玩所得 " +
              income +
              '</p><div class="mcj-actions"><button type="button" class="ghost" data-close-sheet>取消</button><button type="button" class="primary" data-send-gift>确认赠送</button></div>'
          );
          var sheet = document.querySelector(".mcj-sheet");
          sheet.querySelectorAll("[data-gift]").forEach(function (btn) {
            btn.onclick = function () {
              selected =
                gifts.find(function (g) {
                  return g.id === btn.getAttribute("data-gift");
                }) || selected;
              paint();
            };
          });
          sheet.querySelectorAll("[data-gqty]").forEach(function (btn) {
            btn.onclick = function () {
              qty = Math.max(1, qty + (btn.getAttribute("data-gqty") === "+" ? 1 : -1));
              paint();
            };
          });
          sheet.querySelector("[data-close-sheet]").onclick = closeSheet;
          sheet.querySelector("[data-send-gift]").onclick = function () {
        if (!token()) {
          if (window.MCJAuthContinue && typeof window.MCJAuthContinue.requireLogin === "function") {
            window.MCJAuthContinue.requireLogin(function () {
              sheet.querySelector("[data-send-gift]").click();
            });
            return;
          }
          if (window.MCJModal && typeof window.MCJModal.openLogin === "function") {
            window.MCJModal.openLogin("login");
            return;
          }
          alert("请先登录老板账号");
          return;
        }
            fetch("/api/boss/marketplace", {
              method: "POST",
              headers: authHeaders(),
              body: JSON.stringify({
                action: "send_gift",
                companionId: state.companion.id || state.companion.uid,
                giftId: selected.id,
                quantity: qty,
                idempotencyKey: idem(),
              }),
            })
              .then(function (res) {
                return res.json().then(function (body) {
                  if (!res.ok || body.ok === false) throw Object.assign(new Error(body.message || "赠送失败"), body);
                  return body;
                });
              })
              .then(function (body) {
                alert(body.message || "礼物已送出");
                closeSheet();
              })
              .catch(function (err) {
                if (err.code === "INSUFFICIENT_BALANCE" || /余额不足/.test(err.message || "")) {
                  if (confirm("猫粮余额不足，是否去充值？")) location.href = err.rechargeUrl || "recharge.html";
                  return;
                }
                alert(err.message || "赠送失败");
              });
          };
        }
        paint();
      })
      .catch(function (err) {
        alert(err.message || "礼物加载失败");
      });
  }

  function openTipSheet() {
    loadCatalog().then(function (cat) {
      var rate = Number((cat.companion && cat.companion.giftCommissionRate) || 20);
      var amount = 50;
      openSheet(
        "<h3>打赏猫粮</h3><div class=\"mcj-spec-row\">" +
          [10, 20, 50, 100, 200]
            .map(function (n) {
              return '<button type="button" data-tip="' + n + '">' + n + "</button>";
            })
            .join("") +
          '</div><label>自定义数量<input type="number" min="1" data-tip-amount value="50"></label><label>留言<textarea data-tip-msg rows="2" placeholder="陪得很好，谢谢～"></textarea></label><p data-tip-preview></p><div class="mcj-actions"><button type="button" class="ghost" data-close-sheet>取消</button><button type="button" class="primary" data-send-tip>确认打赏</button></div>'
      );
      var sheet = document.querySelector(".mcj-sheet");
      function preview() {
        amount = Math.max(1, Number(sheet.querySelector("[data-tip-amount]").value || 0));
        var fee = Math.round(amount * (rate / 100) * 100) / 100;
        var income = Math.round((amount - fee) * 100) / 100;
        sheet.querySelector("[data-tip-preview]").textContent =
          "打赏 " + amount + " · 平台抽成 " + rate + "%（" + fee + "）· 陪玩所得 " + income;
      }
      preview();
      sheet.querySelectorAll("[data-tip]").forEach(function (btn) {
        btn.onclick = function () {
          sheet.querySelector("[data-tip-amount]").value = btn.getAttribute("data-tip");
          preview();
        };
      });
      sheet.querySelector("[data-tip-amount]").oninput = preview;
      sheet.querySelector("[data-close-sheet]").onclick = closeSheet;
      sheet.querySelector("[data-send-tip]").onclick = function () {
        if (!token()) {
          if (window.MCJAuthContinue && typeof window.MCJAuthContinue.requireLogin === "function") {
            window.MCJAuthContinue.requireLogin(function () {
              sheet.querySelector("[data-send-tip]").click();
            });
            return;
          }
          if (window.MCJModal && typeof window.MCJModal.openLogin === "function") {
            window.MCJModal.openLogin("login");
            return;
          }
          alert("请先登录老板账号");
          return;
        }
        preview();
        fetch("/api/boss/marketplace", {
          method: "POST",
          headers: authHeaders(),
          body: JSON.stringify({
            action: "send_tip",
            companionId: state.companion.id || state.companion.uid,
            amount: amount,
            message: sheet.querySelector("[data-tip-msg]").value || "",
            idempotencyKey: idem(),
          }),
        })
          .then(function (res) {
            return res.json().then(function (body) {
              if (!res.ok || body.ok === false) throw Object.assign(new Error(body.message || "打赏失败"), body);
              return body;
            });
          })
          .then(function (body) {
            alert(body.message || "打赏成功");
            closeSheet();
          })
          .catch(function (err) {
            if (err.code === "INSUFFICIENT_BALANCE" || /余额不足/.test(err.message || "")) {
              if (confirm("猫粮余额不足，是否去充值？")) location.href = err.rechargeUrl || "recharge.html";
              return;
            }
            alert(err.message || "打赏失败");
          });
      };
    });
  }

  document.addEventListener("click", function (e) {
    var expandBtn = e.target.closest("[data-review-expand]");
    if (expandBtn) {
      e.preventDefault();
      var card = expandBtn.closest(".pd-review-item");
      var body = card && card.querySelector(".pd-review-body");
      if (!body) return;
      var open = body.classList.toggle("is-expanded");
      expandBtn.setAttribute("aria-expanded", open ? "true" : "false");
      expandBtn.textContent = open ? "收起↑" : "展开↓";
      return;
    }
    if (e.target.closest("[data-profile-reload]")) {
      e.preventDefault();
      load();
      return;
    }
    if (e.target.closest("[data-open-order]")) {
      e.preventDefault();
      openOrderSheet();
      return;
    }
    if (e.target.closest("[data-open-gift]")) {
      e.preventDefault();
      openGiftSheet();
      return;
    }
    if (e.target.closest("[data-open-tip]")) {
      e.preventDefault();
      openTipSheet();
      return;
    }
  });

  function load() {
    var id = param();
    if (!id) {
      renderError("缺少陪玩 ID");
      return;
    }
    renderLoading();
    var settled = false;
    var failSafe = setTimeout(function () {
      if (settled) return;
      settled = true;
      renderError("陪玩资料读取超时，请点击重新加载");
    }, 12000);
    fetch("/api/public/companions?id=" + encodeURIComponent(id), {
      headers: { Accept: "application/json" },
      cache: "no-store",
    })
      .then(function (res) {
        return res.json().then(function (body) {
          if (!res.ok || body.ok === false) throw new Error(body.message || "陪玩资料读取失败");
          return body;
        });
      })
      .then(function (body) {
        var c = (body.companions || [])[0];
        if (!c) {
          if (!settled) {
            settled = true;
            clearTimeout(failSafe);
            renderError("该陪玩资料不存在", { retry: false });
          }
          return;
        }
        if (!settled) {
          settled = true;
          clearTimeout(failSafe);
          render(syncPresence(c));
        }
        var cid = c.id || c.uid || id;
        var popCtl = typeof AbortController !== "undefined" ? new AbortController() : null;
        var popTimer = setTimeout(function () {
          if (popCtl) popCtl.abort();
        }, 4000);
        fetch("/api/popularity?action=companion&id=" + encodeURIComponent(cid), {
          headers: { Accept: "application/json" },
          cache: "no-store",
          signal: popCtl ? popCtl.signal : undefined,
        })
          .then(function (res) {
            return res.json().catch(function () {
              return {};
            });
          })
          .then(function (pop) {
            clearTimeout(popTimer);
            state.popularity = pop && pop.ok ? pop : null;
            c.popularity = state.popularity;
            if (state.companion && (state.companion.id === c.id || state.companion.uid === c.uid)) {
              render(c);
            }
          })
          .catch(function () {
            clearTimeout(popTimer);
          });
      })
      .catch(function (err) {
        if (settled) return;
        settled = true;
        clearTimeout(failSafe);
        renderError(err.message || "该陪玩资料不存在");
      });
  }

  load();
  (function maybeAutoOpenOrder() {
    var q = new URLSearchParams(location.search);
    if (q.get("open_order") !== "1" && q.get("order") !== "1") return;
    var tries = 0;
    var timer = setInterval(function () {
      tries += 1;
      if (state.companion) {
        clearInterval(timer);
        openOrderSheet();
        return;
      }
      if (tries > 80) clearInterval(timer);
    }, 150);
  })();
  // Soft poll: availability + real order reviews stay in sync without hard refresh.
  (function pollStatus() {
    function reviewFingerprint(c) {
      if (!c) return "";
      var list = Array.isArray(c.reviews) ? c.reviews : [];
      return [
        Number(c.reviewCount || list.length) || 0,
        Number(c.rating || 0) || 0,
        list
          .slice(0, 12)
          .map(function (r) {
            return String(r.id || "") + ":" + String(r.createdAt || "") + ":" + String(r.content || "").slice(0, 24);
          })
          .join("|"),
      ].join("#");
    }
    function applyCompanionPayload(c, opts) {
      opts = opts || {};
      if (!c) return;
      c = syncPresence(c);
      var prevFp = reviewFingerprint(state.companion);
      var nextFp = reviewFingerprint(c);
      var prevAvail = state.companion && state.companion.availabilityStatus;
      if (state.companion && (state.companion.id === c.id || state.companion.uid === c.uid)) {
        state.companion = Object.assign({}, state.companion, c);
      } else {
        state.companion = c;
      }
      if (opts.force || prevFp !== nextFp || prevAvail !== c.availabilityStatus) {
        render(state.companion);
        return;
      }
      var p =
        window.MCJCompanionPresence && window.MCJCompanionPresence.fromCompanion
          ? window.MCJCompanionPresence.fromCompanion(state.companion)
          : null;
      document.querySelectorAll(".mcj-status-dot").forEach(function (el) {
        if (!p) {
          if (c.availabilityText) el.lastChild && (el.childNodes[el.childNodes.length - 1].textContent = c.availabilityText);
          return;
        }
        el.className = "mcj-status-dot " + p.className;
        el.setAttribute("data-online-status", p.code);
        el.setAttribute("data-online-status-label", p.label);
        el.innerHTML = "<i></i>" + esc(p.label);
      });
    }
    function refetchCompanion(opts) {
      opts = opts || {};
      var id = param();
      if (!id) return;
      fetch("/api/public/companions?id=" + encodeURIComponent(id) + "&_=" + Date.now(), {
        headers: { Accept: "application/json" },
        cache: "no-store",
      })
        .then(function (res) {
          return res.json().catch(function () {
            return null;
          });
        })
        .then(function (body) {
          var c = body && body.companions && body.companions[0];
          if (!c) return;
          if (state.popularity) c.popularity = state.popularity;
          applyCompanionPayload(c, opts);
        })
        .catch(function () {});
    }
    var id = param();
    if (!id) return;
    setInterval(function () {
      if (!state.companion || document.hidden) return;
      refetchCompanion({});
    }, 8000);
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) refetchCompanion({});
    });
    window.addEventListener("storage", function (e) {
      if (!e || e.key !== "mcjCompanionReviewBump") return;
      try {
        var payload = JSON.parse(e.newValue || "{}");
        var cid = String(payload.companionId || "");
        if (cid && state.companion && cid !== String(state.companion.id || state.companion.uid || "")) return;
      } catch (_) {}
      refetchCompanion({ force: true });
    });
  })();
  if (window.MCJBossHeader && typeof window.MCJBossHeader.sync === "function") {
    window.MCJBossHeader.sync();
  } else {
    document.body.classList.toggle(
      "is-logged-in",
      !!(
        localStorage.getItem("mcjAuthAccessToken") ||
        sessionStorage.getItem("mcjAuthAccessToken") ||
        localStorage.getItem("customerAuthToken") ||
        sessionStorage.getItem("customerAuthToken")
      )
    );
  }
})();
