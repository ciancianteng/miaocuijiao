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
  function pathPublicId() {
    var m = String(location.pathname || "").match(/\/companion\/(PW\d+)\/?$/i);
    return m ? String(m[1] || "").toUpperCase() : "";
  }
  function param() {
    var fromPath = pathPublicId();
    if (fromPath) return fromPath;
    var p = new URLSearchParams(location.search);
    return p.get("player") || p.get("id") || p.get("uid") || p.get("code") || p.get("publicId") || "";
  }
  function exclusiveProfileUrl(publicId) {
    var id = String(publicId || "").trim().toUpperCase();
    if (!/^PW\d+$/.test(id)) return "";
    return location.origin + "/companion/" + id;
  }
  function profileToast(msg) {
    var el = document.querySelector("[data-pd-toast]");
    if (!el) {
      el = document.createElement("div");
      el.className = "pd-share-toast";
      el.setAttribute("data-pd-toast", "1");
      el.setAttribute("role", "status");
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add("is-on");
    clearTimeout(el._pdToast);
    el._pdToast = setTimeout(function () {
      el.classList.remove("is-on");
    }, 1800);
  }
  function copyProfileLink(url) {
    try {
      var ta = document.createElement("textarea");
      ta.value = url;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.top = "0";
      ta.style.left = "0";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, String(url).length);
      var ok = document.execCommand("copy");
      ta.remove();
      if (ok) return Promise.resolve();
    } catch (e) {}
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      return navigator.clipboard.writeText(url);
    }
    return Promise.reject(new Error("copy"));
  }
  function shareProfileLink(btn) {
    var url = btn ? String(btn.getAttribute("data-share-url") || "") : "";
    var name = btn ? String(btn.getAttribute("data-share-name") || "陪玩") : "陪玩";
    var publicId = btn ? String(btn.getAttribute("data-share-id") || "") : "";
    if (!url) {
      profileToast("专属链接暂不可用");
      return;
    }
    var text = "来看看 MEOW CUI JIAO 的陪玩 " + name + (publicId ? " " + publicId : "");
    function copied() {
      profileToast("专属链接已复制");
    }
    if (navigator.share) {
      navigator
        .share({ title: "MEOW CUI JIAO · " + name, text: text, url: url })
        .catch(function (err) {
          if (err && err.name === "AbortError") return;
          copyProfileLink(url).then(copied).catch(function () {
            profileToast("复制失败");
          });
        });
      return;
    }
    copyProfileLink(url).then(copied).catch(function () {
      profileToast("复制失败");
    });
  }
  function lookupCandidates() {
    var p = new URLSearchParams(location.search);
    var primary = param();
    var extras = [pathPublicId(), p.get("code"), p.get("publicId"), p.get("player"), p.get("uid"), p.get("id")].filter(Boolean);
    var out = [];
    [primary].concat(extras).forEach(function (v) {
      var s = String(v || "").trim();
      if (s && out.indexOf(s) < 0) out.push(s);
    });
    return out;
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

  // Retries of the same send reuse one key until it succeeds, so the server replays instead of charging twice.
  var pendingKeys = {};
  function stableKey(sig) {
    if (!pendingKeys[sig]) pendingKeys[sig] = idem();
    return pendingKeys[sig];
  }
  function clearKey(sig) {
    delete pendingKeys[sig];
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
    stopProfileVoices();
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
      ? '<div class="pd-voice" data-pd-voice>' +
        '<button type="button" class="pd-voice-toggle is-paused" data-voice-toggle aria-label="播放语音"><span data-voice-glyph>▶</span></button>' +
        '<audio preload="metadata" src="' +
        esc(c.voiceUrl) +
        '"></audio></div>'
      : "";
    var videoUrl = String(c.videoUrl || c.showcaseVideoUrl || "").trim();
    var hasVideo = !!(videoUrl && /^https?:\/\//i.test(videoUrl));
    var videoList = Array.isArray(c.videos)
      ? c.videos.filter(function (v) {
          return v && v.url && /^https?:\/\//i.test(String(v.url));
        })
      : [];
    if (!videoList.length && hasVideo) videoList = [{ url: videoUrl }];
    var videoHtml = videoList.length
      ? '<div class="pd-video-rail" data-pd-video-rail>' +
        videoList
          .slice(0, 20)
          .map(function (v, i) {
            return (
              '<div class="pd-video-player"><video controls playsinline preload="none" src="' +
              esc(v.url) +
              '" data-pd-video-index="' +
              i +
              '"></video></div>'
            );
          })
          .join("") +
        "</div>"
      : "";
    var galleryList = Array.isArray(c.gallery) ? c.gallery.filter(function (g) { return g && g.url; }) : [];
    var achievementList = Array.isArray(c.achievements)
      ? c.achievements.filter(function (a) {
          return a && a.url;
        })
      : [];
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
    var publicId =
      (window.MCJCompanionPublicId && window.MCJCompanionPublicId.customerFacingCompanionId
        ? window.MCJCompanionPublicId.customerFacingCompanionId(c)
        : "") ||
      c.publicId ||
      c.companionCode ||
      "";
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(String(publicId))) publicId = "";
    if (!publicId && c.companionUid) {
      var n = Number(c.companionUid);
      if (n >= 100001) publicId = "PW" + String(n - 100000).padStart(5, "0");
      else if (n > 0) publicId = "PW" + String(n).padStart(5, "0");
    }
    var identityApi = window.MCJCompanionIdentity;
    // Hero: certification only. Game / level / price live once in service chips (no voice "未设置").
    var certHtml = identityApi
      ? identityApi.renderTags({
          levelId: "",
          levelLabel: "",
          gender: "",
          voiceType: "",
          certTags: c.certTags || c.certificationTags || [],
          tags: [],
          className: "pd-cert-row tag-row companion-tags companion-identity-row",
          includeLevel: false,
          includeGender: false,
          includeVoice: false,
          serviceLimit: 0,
          certLimit: 3,
        })
      : (function () {
          var certTags = (c.certTags || c.certificationTags || [])
            .slice(0, 3)
            .map(function (t) {
              var name = typeof t === "string" ? t : t.name || t.title || "";
              if (!name) return "";
              var icon = typeof t === "object" && t.icon ? t.icon + " " : "";
              return '<span class="mcj-cert-badge">' + esc(icon + name) + "</span>";
            })
            .filter(Boolean)
            .join("");
          return certTags
            ? '<div class="pd-cert-row mcj-id-tags tag-row companion-tags companion-identity-row">' +
                certTags +
                "</div>"
            : "";
        })();
    var voiceLineRaw = String(c.voiceType || c.voice_type || "")
      .trim()
      .replace(/^声线\s*[:：]\s*/, "");
    if (/^(无|暂无|未设置|-|—)$/.test(voiceLineRaw)) voiceLineRaw = "";
    var voiceChipHtml = voiceLineRaw
      ? '<span class="pd-service-chip pd-service-chip--voice">声线：' + esc(voiceLineRaw) + "</span>"
      : "";
    var gameChipLabel = String(c.game || "").trim();
    if (!gameChipLabel || /^(未设置|综合游戏|-|—)$/.test(gameChipLabel)) gameChipLabel = "";
    var levelChipLabel = levelText && levelText !== "-" ? String(levelText).trim() : "";
    var priceChipLabel = "";
    if (rangeText && rangeText !== "暂无数据") {
      priceChipLabel = /猫粮/.test(rangeText) ? String(rangeText).trim() : String(rangeText).trim() + " 猫粮";
    }
    var serviceChips = [];
    if (gameChipLabel) {
      serviceChips.push('<span class="pd-service-chip">' + esc(gameChipLabel) + "</span>");
    }
    (Array.isArray(c.gameRanks) ? c.gameRanks : []).forEach(function (r) {
      if (!r || !String(r.rank || "").trim() || !String(r.name || "").trim()) return;
      serviceChips.push(
        '<span class="pd-service-chip pd-service-chip--rank" data-game-rank>' + esc(r.name) + " 段位：" + esc(r.rank) + "</span>"
      );
    });
    if (levelChipLabel) {
      serviceChips.push(
        '<span class="pd-service-chip pd-service-chip--level" data-level-id="' +
          esc(c.levelId || "") +
          '">' +
          esc(levelChipLabel) +
          "</span>"
      );
    }
    if (priceChipLabel) {
      serviceChips.push('<span class="pd-service-chip">' + esc(priceChipLabel) + "</span>");
    }
    if (voiceChipHtml) serviceChips.push(voiceChipHtml);
    var serviceChipsHtml = serviceChips.length
      ? '<div class="pd-service-chips" aria-label="服务标签">' + serviceChips.join("") + "</div>"
      : "";
    var galleryUrls = galleryList.map(function (g) {
      return g.url;
    });
    var galleryWall =
      galleryList.length > 0
        ? galleryList
            .map(function (g, idx) {
              var url = String(g.url || "");
              var isVideo = /\.(mp4|webm|mov)(\?|$)/i.test(url) || /video/i.test(String(g.mediaType || g.media_type || g.type || ""));
              if (isVideo) {
                return (
                  '<button type="button" class="mcj-album-thumb mcj-album-thumb--video" data-album-index="' +
                  idx +
                  '" data-album-url="' +
                  esc(url) +
                  '" aria-label="播放相册视频">' +
                  '<video src="' +
                  esc(url) +
                  '" muted playsinline preload="metadata"></video>' +
                  '<span class="mcj-album-play" aria-hidden="true">▶</span></button>'
                );
              }
              return (
                '<img class="mcj-album-thumb" data-album-index="' +
                idx +
                '" src="' +
                esc(url) +
                '" alt="陪玩相册" loading="lazy" onerror="this.onerror=null;this.src=\'/default-avatar.png\'">'
              );
            })
            .join("")
        : '<p class="pd-album-empty">暂无相册内容</p>';
    var albumSectionHtml = galleryList.length
      ? '<section class="pd-block" data-pd-album-section>' +
        '<div class="pd-head"><h2>照片相册</h2><span>' +
        galleryList.length +
        " 张</span></div>" +
        '<div class="pd-rail" data-profile-album>' +
        galleryWall +
        "</div></section>"
      : '<section class="pd-block" data-pd-album-section><div class="pd-head"><h2>照片相册</h2></div><p class="pd-empty">暂无照片</p></section>';
    var achievementWall =
      achievementList.length > 0
        ? achievementList
            .map(function (g, idx) {
              var url = String(g.url || "");
              var isVideo =
                /\.(mp4|webm|mov)(\?|$)/i.test(url) ||
                /^video\//i.test(String(g.contentType || g.content_type || "")) ||
                /video/i.test(String(g.mediaType || g.media_type || ""));
              if (isVideo) {
                return (
                  '<button type="button" class="mcj-album-thumb mcj-album-thumb--video" data-album-index="' +
                  idx +
                  '" data-album-url="' +
                  esc(url) +
                  '" aria-label="播放战绩视频">' +
                  '<video src="' +
                  esc(url) +
                  '" muted playsinline preload="metadata"></video>' +
                  '<span class="mcj-album-play" aria-hidden="true">▶</span></button>'
                );
              }
              return (
                '<img class="mcj-album-thumb" data-album-index="' +
                idx +
                '" src="' +
                esc(url) +
                '" alt="游戏战绩" loading="lazy" onerror="this.onerror=null;this.src=\'/default-avatar.png\'">'
              );
            })
            .join("")
        : '<p class="pd-album-empty">暂无游戏战绩</p>';
    var achievementSectionHtml = achievementList.length
      ? '<section class="pd-block" data-pd-achieve-section>' +
        '<div class="pd-head"><h2>游戏战绩</h2><span>' +
        achievementList.length +
        " 个</span></div>" +
        '<div class="pd-rail" data-profile-achieve>' +
        achievementWall +
        "</div></section>"
      : '<section class="pd-block" data-pd-achieve-section><div class="pd-head"><h2>游戏战绩</h2></div><p class="pd-empty">暂无游戏战绩</p></section>';
    var videoSectionHtml = videoList.length
      ? '<section class="pd-block"><div class="pd-head"><h2>视频</h2><span>' +
        videoList.length +
        " 个</span></div>" +
        videoHtml +
        "</section>"
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
            var content = String(r.content || "").trim();
            var metaBits = [];
            if (orderShown && orderShown !== "-") metaBits.push("订单 " + orderShown);
            if (gameLabel && gameLabel !== "-") metaBits.push(gameLabel);
            if (when) metaBits.push(when);
            var images = (Array.isArray(r.images) ? r.images : [])
              .filter(function (u) {
                return /^https:\/\//i.test(String(u || ""));
              })
              .slice(0, 3);
            var imagesHtml = images.length
              ? '<div class="pd-review-images">' +
                images
                  .map(function (u, idx) {
                    return (
                      '<a href="' +
                      esc(u) +
                      '" target="_blank" rel="noopener"><img src="' +
                      esc(u) +
                      '" alt="评价图片 ' +
                      (idx + 1) +
                      '" loading="lazy"></a>'
                    );
                  })
                  .join("") +
                "</div>"
              : "";
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
              '<div class="pd-review-top">' +
              avatarHtml +
              '<div class="pd-review-who"><span class="pd-review-boss-code">' +
              esc(bossLabel) +
              '</span><span class="pd-review-stars" aria-label="' +
              n +
              ' 星">' +
              esc(stars) +
              "</span></div></div>" +
              (badge ? '<p class="pd-review-badge">' + esc(badge) + "</p>" : "") +
              '<p class="pd-review-body">' +
              esc(content) +
              '</p><button type="button" class="pd-review-expand" data-review-expand hidden aria-expanded="false">展开↓</button>' +
              (metaBits.length ? '<p class="pd-review-meta">' + esc(metaBits.join(" · ")) + "</p>" : "") +
              imagesHtml +
              "</article>"
            );
          })
          .join("")
      : '<p class="pd-empty">暂无评价</p>';
    var hasRating = c.rating != null && Number(c.rating) > 0;
    var ratingText = hasRating
      ? Number(c.rating).toFixed(1) + "（" + reviewCount + " 条）"
      : "暂无数据";
    var goodCount = Number(c.goodReviewCount != null ? c.goodReviewCount : 0) || 0;
    var goodText = plainEmptyMetric(goodCount);
    var favCount =
      Number(
        c.favorites != null
          ? c.favorites
          : c.favoriteCount != null
            ? c.favoriteCount
            : c.favorite_count != null
              ? c.favorite_count
              : (pop && (pop.favorites || (pop.total && pop.total.favorites) || (pop.weekly && pop.weekly.favorites))) || 0
      ) || 0;
    var favText = plainEmptyMetric(favCount);
    var bioRaw = String(c.desc || c.description || "").trim();
    var bioText = bioRaw || "该陪玩暂未填写个人介绍";
    var bioEmpty = !bioRaw;
    var weeklyRankText = rankText(weeklyRank);
    var monthlyRankText = rankText(monthlyRank);
    var popScoreText = plainEmptyMetric(popScore);
    var tagSeen = {};
    var profileTags = [];
    function addProfileTag(text) {
      var label = String(text || "").replace(/\s+/g, " ").trim();
      if (!label || /^(无|暂无|未设置|-|—|新人陪玩)$/.test(label)) return;
      var key = label.toLowerCase();
      if (tagSeen[key]) return;
      tagSeen[key] = 1;
      profileTags.push(label);
    }
    voiceLineRaw.split(/[、,，/|]+/).forEach(addProfileTag);
    (c.certTags || c.certificationTags || []).forEach(function (tag) {
      addProfileTag(typeof tag === "string" ? tag : (tag && (tag.name || tag.title)) || "");
    });
    (Array.isArray(c.tags) ? c.tags : []).forEach(function (tag) {
      addProfileTag(typeof tag === "string" ? tag : (tag && (tag.name || tag.title)) || "");
    });
    if (pop && pop.weekly) {
      var honorRank = Number(pop.weekly.rank || 0);
      if (honorRank === 1) addProfileTag("冠军");
      else if (honorRank === 2) addProfileTag("亚军");
      else if (honorRank === 3) addProfileTag("季军");
      else if (honorRank > 0 && honorRank <= 10) addProfileTag("TOP " + honorRank);
      if (honorRank > 0 && honorRank <= 20) addProfileTag("热门陪玩");
    }
    if (gameChipLabel) addProfileTag(gameChipLabel);
    (Array.isArray(c.gameRanks) ? c.gameRanks : []).forEach(function (rankRow) {
      if (!rankRow || !String(rankRow.rank || "").trim() || !String(rankRow.name || "").trim()) return;
      addProfileTag(String(rankRow.name).trim() + " " + String(rankRow.rank).trim());
    });
    if (levelChipLabel && !/^(未设置|-|—)$/.test(levelChipLabel)) addProfileTag(levelChipLabel);
    profileTags = profileTags.filter(function (label, index, list) {
      return !list.some(function (other, otherIndex) {
        return otherIndex !== index && other.indexOf(label) === 0 && other.length > label.length;
      });
    });
    var tagsHtml = profileTags.length
      ? '<div class="pd-tags">' +
        profileTags
          .map(function (label) {
            return '<span class="pd-tag">' + esc(label) + "</span>";
          })
          .join("") +
        "</div>"
      : "";
    var orderStat = completedOrders > 0 ? String(completedOrders) : "—";
    var rateStat = "—";
    if (reviewCount > 0) {
      var rate = Number(c.goodRate);
      if (!Number.isFinite(rate) && c.goodReviewCount != null && Number.isFinite(Number(c.goodReviewCount))) {
        rate = Math.round((Number(c.goodReviewCount) / reviewCount) * 1000) / 10;
      }
      if (Number.isFinite(rate)) {
        if (rate < 0) rate = 0;
        if (rate > 100) rate = 100;
        rateStat = String(Math.round(rate * 10) / 10).replace(/\.0$/, "") + "%";
      }
    }
    var scoreStat = hasRating ? Number(c.rating).toFixed(1) : "—";

    s.setAttribute("data-companion-level", c.levelId || "");
    var shareName = String(c.name || c.nickname || "陪玩").trim() || "陪玩";
    var shareUrl = exclusiveProfileUrl(publicId);
    var shareAttrs = shareUrl
      ? ' data-profile-share data-share-url="' +
        esc(shareUrl) +
        '" data-share-name="' +
        esc(shareName) +
        '" data-share-id="' +
        esc(String(publicId || "").toUpperCase()) +
        '"'
      : " disabled";
    var shareIcon =
      '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M12 16V4M12 4 8 8M12 4l4 4M6 20h12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    var backIcon =
      '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M14.5 6 8.5 12l6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    s.innerHTML =
      '<figure class="pd-cover">' +
      '<img src="' +
      esc(image) +
      '" alt="' +
      esc(c.name || "陪玩") +
      '" width="900" height="882" onerror="this.onerror=null;this.src=\'/default-avatar.png\'">' +
      '<div class="pd-nav"><button type="button" class="pd-icon-btn" data-profile-back aria-label="返回">' +
      backIcon +
      '</button><button type="button" class="pd-icon-btn" aria-label="分享陪玩专属链接"' +
      shareAttrs +
      ">" +
      shareIcon +
      "</button></div></figure>" +
      '<header class="pd-identity"><div class="pd-name-row"><h1>' +
      esc(c.name || c.nickname || "陪玩") +
      "</h1>" +
      voiceBody +
      "</div>" +
      tagsHtml +
      '<p class="pd-id">ID：' +
      esc(publicId || "待生成") +
      "</p></header>" +
      '<section class="pd-block"><h2>关于TA</h2><p class="pd-copy' +
      (bioEmpty ? " is-empty" : "") +
      '">' +
      esc(bioText) +
      "</p></section>" +
      albumSectionHtml +
      videoSectionHtml +
      '<section class="pd-block" id="pdOffers"><div class="pd-head"><h2>TA可以提供的服务</h2></div><div data-pd-offers><p class="pd-empty">正在读取服务…</p></div></section>' +
      achievementSectionHtml +
      '<section class="pd-block"><h2>数据表现</h2><div class="pd-stat-row">' +
      '<div><strong>' +
      esc(orderStat) +
      '</strong><span>完成订单</span></div>' +
      '<div><strong>' +
      esc(rateStat) +
      '</strong><span>好评率</span></div>' +
      '<div><strong>' +
      esc(scoreStat) +
      '</strong><span>综合评分</span></div>' +
      "</div></section>" +
      (function () {
        var wall = Array.isArray(c.giftWall) ? c.giftWall : Array.isArray(c.gift_wall) ? c.gift_wall : [];
        var chips = wall.length
          ? '<div class="pd-gift-row">' +
            wall
              .map(function (w) {
                var img = w.giftImage || w.gift_image_url || w.image || "";
                var name = w.giftName || w.gift_name || "礼物";
                var qtyRaw = w.totalQuantity != null ? w.totalQuantity : w.total_quantity;
                var qty = qtyRaw != null && Number.isFinite(Number(qtyRaw)) ? Number(qtyRaw) : null;
                return (
                  '<div class="pd-gift">' +
                  (img
                    ? '<img src="' + esc(img) + '" alt="" loading="lazy">'
                    : '<span class="pd-gift-fallback" aria-hidden="true">礼</span>') +
                  "<strong>" +
                  esc(name) +
                  "</strong>" +
                  (qty == null ? "" : "<em>×" + esc(qty) + "</em>") +
                  "</div>"
                );
              })
              .join("") +
            "</div>"
          : '<p class="pd-empty">还没有收到礼物</p>';
        return (
          '<section class="pd-block" id="pdGiftWall"><div class="pd-head"><h2>礼物墙</h2><span class="pd-head-actions">' +
          '<button type="button" class="pd-text-btn" data-open-gift>送TA礼物</button>' +
          (token() ? '<button type="button" class="pd-text-btn" data-open-tip>打赏</button>' : "") +
          "</span></div>" +
          chips +
          "</section>"
        );
      })() +
      '<section class="pd-block"><div class="pd-head"><h2>评价</h2>' +
      (reviewCount > 0 ? "<span>" + esc(reviewCount) + "</span>" : "") +
      '</div><div class="pd-reviews" id="realReviewList">' +
      reviewHtml +
      "</div></section>";

    bindReviewExpand(s.querySelector("#realReviewList"));
    ensureProfileSkin();
    loadProfileOffers(c);

    if (window.MCJCompanionIdentity && typeof window.MCJCompanionIdentity.bindAlbum === "function") {
      window.MCJCompanionIdentity.bindAlbum(s.querySelector("[data-profile-album]"), galleryUrls);
      var achieveUrls = achievementList.map(function (g) {
        return g.url;
      });
      window.MCJCompanionIdentity.bindAlbum(s.querySelector("[data-profile-achieve]"), achieveUrls);
    }

    var b = bottom();
    if (b) {
      b.hidden = false;
      b.className = "profile-bottom-bar pd-bottom-bar";
      b.innerHTML =
        '<a class="pd-bottom-secondary" href="support.html?start=1">咨询客服</a>' +
        '<button type="button" class="order-now mcj-primary pd-bottom-primary" data-open-order>立即下单</button>';
      // Team bar may have measured a hidden CTA bar earlier — resync after paint.
      if (window.MCJMultiCompanionTeam && typeof window.MCJMultiCompanionTeam.syncBottomStackOffset === "function") {
        requestAnimationFrame(function () {
          window.MCJMultiCompanionTeam.syncBottomStackOffset();
        });
      }
    }

    bindVoicePlayers(s);
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

  function stopProfileVoices() {
    document.querySelectorAll("[data-pd-voice] audio").forEach(function (audio) {
      try {
        audio.pause();
      } catch (err) {}
    });
  }
  function bindVoiceLeave() {
    if (bindVoiceLeave.done) return;
    bindVoiceLeave.done = true;
    window.addEventListener("pagehide", stopProfileVoices);
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) stopProfileVoices();
    });
  }
  function bindVoicePlayers(root) {
    if (!root) return;
    bindVoiceLeave();
    root.querySelectorAll("[data-pd-voice]").forEach(function (box) {
      var audio = box.querySelector("audio");
      var btn = box.querySelector("[data-voice-toggle]");
      var glyph = btn && btn.querySelector("[data-voice-glyph]");
      if (!audio || !btn || !glyph) return;
      function hideBroken() {
        if (box.parentNode) box.remove();
      }
      function paint() {
        var paused = audio.paused || audio.ended;
        glyph.textContent = paused ? "▶" : "⏸";
        btn.classList.toggle("is-paused", paused);
        btn.setAttribute("aria-label", paused ? "播放语音" : "暂停语音");
      }
      btn.addEventListener("click", function () {
        if (audio.paused || audio.ended) {
          document.querySelectorAll("[data-pd-voice] audio").forEach(function (other) {
            if (other !== audio) {
              try {
                other.pause();
              } catch (err) {}
            }
          });
          if (audio.ended) {
            try {
              audio.currentTime = 0;
            } catch (err) {}
          }
          audio.play().catch(function () {});
        } else audio.pause();
      });
      audio.addEventListener("play", paint);
      audio.addEventListener("pause", paint);
      audio.addEventListener("ended", function () {
        try {
          audio.currentTime = 0;
        } catch (err) {}
        paint();
      });
      audio.addEventListener("loadedmetadata", function () {
        var d = Number(audio.duration);
        if (!Number.isFinite(d) || d <= 0.05) hideBroken();
        else paint();
      });
      audio.addEventListener("error", hideBroken);
      paint();
    });
  }
  function ensureProfileSkin() {
    if (document.getElementById("pdSkin")) return;
    var style = document.createElement("style");
    style.id = "pdSkin";
    style.textContent = ".profile-detail-page{overflow-x:clip}.profile-detail-shell{max-width:100%;min-width:0}";
    document.head.appendChild(style);
  }
  function loadProfileOffers(c) {
    var host = document.querySelector("[data-pd-offers]");
    var userId = c && (c.userId || c.user_id || c.id || c.uid);
    if (!host || !userId) return;
    fetch("/api/companion-offers?userId=" + encodeURIComponent(userId), { cache: "no-store" })
      .then(function (res) { return res.json(); })
      .then(function (body) {
        var offers = (body && body.offers) || [];
        if (!offers.length) {
          host.innerHTML = '<p class="pd-empty">暂无可展示的服务</p>';
          return;
        }
        host.innerHTML = offers
          .map(function (item) {
            var price = Number(item.price);
            var priceHtml = Number.isFinite(price) && price > 0 ? '<span class="pd-offer-price">' + esc(money(price)) + "</span>" : "";
            return (
              '<button type="button" class="pd-offer" data-pd-offer data-kind="' +
              esc(item.kind) +
              '" data-id="' +
              esc(item.id) +
              '" data-name="' +
              esc(item.name) +
              '"><strong>' +
              esc(item.name) +
              "</strong>" +
              priceHtml +
              "</button>"
            );
          })
          .join("");
      })
      .catch(function () {
        host.innerHTML = '<p class="pd-empty">服务暂时读取失败</p>';
      });
  }
  function openOrderSheet(pref) {
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
          service: pref && pref.name ? pref.name : "",
          requireServicePick: !(pref && pref.name),
          unitPrice: Number(c.priceValue != null ? c.priceValue : c.price) || 0,
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
          // Do NOT force services[0] — that rewrites 三角洲@35 → 王者荣耀@30 on soft update.
          // Pass catalog services/prices; place-order modal keeps the current selection.
          var unitPrice = Number(catC.price || c.priceValue || c.price || 0);
          if (!(unitPrice > 0) && services[0] && Number(services[0].price) > 0) {
            unitPrice = Number(services[0].price);
          }
          if (!(unitPrice > 0)) return;
          window.MCJPlaceOrder.openFromCompanion(c, {
            companionId: c.id || c.uid,
            companionName: catC.name || c.name || c.nickname,
            unitPrice: unitPrice,
            // omit service so soft-update preserves the chip the user already picked
            services: services,
            serviceIds: c.serviceIds || c.service_ids || [],
            gamePrices: catC.gamePrices || c.gamePrices || c.game_prices || {},
            avatar: catC.avatar || c.avatar,
            publicId: catC.publicId || c.publicId || "",
            pricingUnit: catC.pricingUnit || c.pricingUnit || "小时",
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
        var targetName =
          (state.companion && (state.companion.nickname || state.companion.name || state.companion.displayName)) ||
          "当前陪玩";
        var targetId = state.companion && (state.companion.id || state.companion.uid);
        var busy = false;

        function giftIconHtml(g) {
          var url = g.iconUrl || g.icon_url || "";
          if (url) return '<img class="mcj-gift-icon" src="' + esc(url) + '" alt="" />';
          return '<div class="mcj-gift-emoji" aria-hidden="true">🎁</div>';
        }

        function requireBossLogin(thenFn) {
          if (token()) {
            thenFn();
            return;
          }
          if (window.MCJAuthContinue && typeof window.MCJAuthContinue.requireLogin === "function") {
            window.MCJAuthContinue.requireLogin(thenFn);
            return;
          }
          if (window.MCJModal && typeof window.MCJModal.openLogin === "function") {
            window.MCJModal.openLogin("login");
            return;
          }
          alert("请先登录老板账号");
        }

        function paint() {
          var gross = Number(selected.catFoodPrice || selected.cat_food_price || 0) * qty;
          var fee = Math.round(gross * (rate / 100) * 100) / 100;
          var income = Math.round((gross - fee) * 100) / 100;
          openSheet(
            "<h3>送礼物</h3>" +
              '<p class="mcj-gift-target">赠送对象：<strong>' +
              esc(targetName) +
              "</strong></p>" +
              '<div class="mcj-gift-grid">' +
              gifts
                .map(function (g) {
                  return (
                    '<button type="button" class="mcj-gift-card' +
                    (g.id === selected.id ? " active" : "") +
                    '" data-gift="' +
                    esc(g.id) +
                    '">' +
                    giftIconHtml(g) +
                    "<strong>" +
                    esc(g.name) +
                    "</strong><span>" +
                    esc(g.catFoodPrice != null ? g.catFoodPrice : g.cat_food_price) +
                    " 猫粮</span></button>"
                  );
                })
                .join("") +
              '</div><div class="mcj-qty" style="margin-top:12px">数量 <button type="button" data-gqty="-">-</button><strong data-gqty-val>' +
              qty +
              '</strong><button type="button" data-gqty="+">+</button></div>' +
              "<p>总计 <strong>" +
              gross +
              "</strong> 猫粮</p>" +
              '<div class="mcj-actions mcj-gift-pay-actions">' +
              '<button type="button" class="ghost" data-close-sheet>取消</button>' +
              '<button type="button" class="primary" data-pay-wallet ' +
              (busy ? "disabled" : "") +
              ">猫粮余额支付</button>" +
              '<button type="button" class="primary ghost-outline" data-pay-external ' +
              (busy ? "disabled" : "") +
              ">外部支付 / 上传截图</button>" +
              "</div>" +
              '<p class="mcj-gift-pay-hint">外部支付需上传付款截图，客服审核通过后礼物才会到账。</p>'
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
          sheet.querySelector("[data-pay-wallet]").onclick = function () {
            requireBossLogin(function () {
              if (busy) return;
              busy = true;
              paint();
              var payBtn = sheet.querySelector("[data-pay-wallet]");
              if (payBtn) {
                payBtn.disabled = true;
                payBtn.textContent = "处理中…";
              }
              fetch("/api/boss/marketplace", {
                method: "POST",
                headers: authHeaders(),
                body: JSON.stringify({
                  action: "send_gift",
                  companionId: targetId,
                  giftId: selected.id,
                  quantity: qty,
                  idempotencyKey: stableKey("gift|" + targetId + "|" + selected.id + "|" + qty),
                }),
              })
                .then(function (res) {
                  return res.json().then(function (body) {
                    if (!res.ok || body.ok === false)
                      throw Object.assign(new Error(body.message || "赠送失败"), body);
                    return body;
                  });
                })
                .then(function (body) {
                  clearKey("gift|" + targetId + "|" + selected.id + "|" + qty);
                  alert(body.message || "礼物已送出");
                  closeSheet();
                  load();
                })
                .catch(function (err) {
                  busy = false;
                  if (err.code === "INSUFFICIENT_BALANCE" || /余额不足/.test(err.message || "")) {
                    var avail = err.availableBalance != null ? err.availableBalance : 0;
                    var need = err.requiredAmount != null ? err.requiredAmount : gross;
                    var short =
                      err.shortfall != null ? err.shortfall : Math.max(0, Number(need) - Number(avail) || 0);
                    openSheet(
                      "<h3>猫粮余额不足</h3>" +
                        '<p class="mcj-gift-balance-line">当前余额：<strong>' +
                        esc(String(avail)) +
                        "</strong> 猫粮</p>" +
                        '<p class="mcj-gift-balance-line">需要支付：<strong>' +
                        esc(String(need)) +
                        "</strong> 猫粮</p>" +
                        '<p class="mcj-gift-balance-line">还差：<strong>' +
                        esc(String(short)) +
                        "</strong> 猫粮</p>" +
                        '<div class="mcj-actions">' +
                        '<button type="button" class="ghost" data-close-sheet>取消</button>' +
                        '<button type="button" class="primary" data-go-recharge>去充值</button>' +
                        "</div>"
                    );
                    var balSheet = document.querySelector(".mcj-sheet");
                    balSheet.querySelector("[data-close-sheet]").onclick = closeSheet;
                    balSheet.querySelector("[data-go-recharge]").onclick = function () {
                      location.href = err.rechargeUrl || "recharge.html";
                    };
                    return;
                  }
                  paint();
                  alert(err.message || "赠送失败");
                });
            });
          };
          sheet.querySelector("[data-pay-external]").onclick = function () {
            requireBossLogin(function () {
              if (busy) return;
              busy = true;
              paint();
              fetch("/api/boss/gift-orders", {
                method: "POST",
                headers: authHeaders(),
                body: JSON.stringify({
                  action: "create",
                  companionId: targetId,
                  giftId: selected.id,
                  quantity: qty,
                  idempotencyKey: stableKey("gift-order|" + targetId + "|" + selected.id + "|" + qty),
                }),
              })
                .then(function (res) {
                  return res.json().then(function (body) {
                    if (!res.ok || body.ok === false)
                      throw Object.assign(new Error(body.message || "创建礼物订单失败"), body);
                    return body;
                  });
                })
                .then(function (body) {
                  clearKey("gift-order|" + targetId + "|" + selected.id + "|" + qty);
                  closeSheet();
                  openProfileGiftPaySheet(body.order, body.payInfo, {
                    gift: selected,
                    companionName: targetName,
                    quantity: qty,
                  });
                })
                .catch(function (err) {
                  busy = false;
                  paint();
                  alert(err.message || "创建礼物订单失败");
                });
            });
          };
        }
        paint();
      })
      .catch(function (err) {
        alert(err.message || "礼物加载失败");
      });
  }

  function openProfileGiftPaySheet(order, payInfo, meta) {
    meta = meta || {};
    var proofDataUrl = "";
    var uploading = false;
    var orderId = order && (order.id || order.orderId);
    function paintPay() {
      var qr = (payInfo && payInfo.qrUrl) || (order && order.paymentQrUrl) || "";
      var instructions =
        (payInfo && payInfo.instructions) ||
        (order && order.paymentInstructions) ||
        "请按应付金额完成转账并上传付款截图。";
      var total =
        order && order.totalAmount != null
          ? order.totalAmount
          : Number((meta.gift && (meta.gift.catFoodPrice || meta.gift.cat_food_price)) || 0) *
            Number(meta.quantity || 1);
      openSheet(
        "<h3>上传付款截图</h3>" +
          "<p>赠送对象：<strong>" +
          esc(meta.companionName || "陪玩") +
          "</strong></p>" +
          "<p>礼物：<strong>" +
          esc((meta.gift && meta.gift.name) || (order && order.giftName) || "礼物") +
          "</strong> ×" +
          esc(String(meta.quantity || order.quantity || 1)) +
          "</p>" +
          "<p>应付：<strong>" +
          esc(String(total)) +
          "</strong> 猫粮</p>" +
          (qr ? '<img class="mcj-gift-pay-qr" src="' + esc(qr) + '" alt="付款二维码" />' : "") +
          '<p class="muted">' +
          esc(instructions) +
          "</p>" +
          (proofDataUrl
            ? '<img class="mcj-gift-proof-preview" src="' + esc(proofDataUrl) + '" alt="截图预览" />'
            : '<p class="muted">尚未选择截图</p>') +
          '<label class="mcj-gift-upload">选择付款截图<input type="file" accept="image/*" data-gift-proof /></label>' +
          '<div class="mcj-actions"><button type="button" class="ghost" data-close-sheet>取消</button>' +
          '<button type="button" class="primary" data-submit-gift-proof ' +
          (!proofDataUrl || uploading ? "disabled" : "") +
          ">" +
          (uploading ? "提交中…" : "提交付款凭证") +
          "</button></div>" +
          '<p class="mcj-gift-pay-hint">提交后进入客服审核；通过前不会增加礼物墙。</p>'
      );
      var sheet = document.querySelector(".mcj-sheet");
      sheet.querySelector("[data-close-sheet]").onclick = closeSheet;
      var file = sheet.querySelector("[data-gift-proof]");
      if (file) {
        file.onchange = function () {
          var f = file.files && file.files[0];
          if (!f) return;
          var reader = new FileReader();
          reader.onload = function () {
            proofDataUrl = String(reader.result || "");
            paintPay();
          };
          reader.readAsDataURL(f);
        };
      }
      var submit = sheet.querySelector("[data-submit-gift-proof]");
      if (submit) {
        submit.onclick = function () {
          if (!proofDataUrl || uploading || !orderId) return;
          uploading = true;
          paintPay();
          fetch("/api/boss/gift-orders", {
            method: "POST",
            headers: authHeaders(),
            body: JSON.stringify({
              action: "upload_proof",
              orderId: orderId,
              proofDataUrl: proofDataUrl,
            }),
          })
            .then(function (res) {
              return res.json().then(function (body) {
                if (!res.ok || body.ok === false) throw new Error(body.message || "提交失败");
                return body;
              });
            })
            .then(function (body) {
              alert(body.message || "已提交，等待客服审核");
              closeSheet();
            })
            .catch(function (err) {
              uploading = false;
              paintPay();
              alert(err.message || "提交失败");
            });
        };
      }
    }
    paintPay();
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
            idempotencyKey: stableKey("tip|" + (state.companion.id || state.companion.uid) + "|" + amount),
          }),
        })
          .then(function (res) {
            return res.json().then(function (body) {
              if (!res.ok || body.ok === false) throw Object.assign(new Error(body.message || "打赏失败"), body);
              return body;
            });
          })
          .then(function (body) {
            clearKey("tip|" + (state.companion.id || state.companion.uid) + "|" + amount);
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
    if (e.target.closest("[data-profile-back]")) {
      e.preventDefault();
      var ref = "";
      try {
        ref = document.referrer || "";
      } catch (eRef) {}
      var sameOrigin = false;
      try {
        sameOrigin = !!ref && new URL(ref).origin === location.origin;
      } catch (eUrl) {}
      if (sameOrigin && window.history.length > 1) {
        history.back();
        return;
      }
      location.href = "/companion-center.html";
      return;
    }
    var shareBtn = e.target.closest("[data-profile-share]");
    if (shareBtn) {
      e.preventDefault();
      shareProfileLink(shareBtn);
      return;
    }
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
    var offerCard = e.target.closest("[data-pd-offer]");
    if (offerCard) {
      e.preventDefault();
      var kind = offerCard.getAttribute("data-kind");
      var offerId = offerCard.getAttribute("data-id");
      var offerName = offerCard.getAttribute("data-name") || "";
      var companionId = (state.companion && (state.companion.id || state.companion.uid)) || "";
      if (kind === "product") {
        location.href = "gameplay-product.html?id=" + encodeURIComponent(offerId) + "&companion=" + encodeURIComponent(companionId);
        return;
      }
      openOrderSheet({ name: offerName, id: offerId });
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

  function fetchCompanionById(id) {
    return fetch("/api/public/companions?id=" + encodeURIComponent(id), {
      headers: { Accept: "application/json" },
      cache: "no-store",
    }).then(function (res) {
      return res.json().then(function (body) {
        if (!res.ok || body.ok === false) throw new Error(body.message || "陪玩资料读取失败");
        return body;
      });
    });
  }

  function load() {
    var candidates = lookupCandidates();
    if (!candidates.length) {
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

    function tryNext(index) {
      if (index >= candidates.length) {
        if (!settled) {
          settled = true;
          clearTimeout(failSafe);
          renderError("该陪玩资料不存在", { retry: false });
        }
        return;
      }
      var id = candidates[index];
      fetchCompanionById(id)
        .then(function (body) {
          var c = (body.companions || [])[0];
          if (!c) {
            tryNext(index + 1);
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
          if (index + 1 < candidates.length) {
            tryNext(index + 1);
            return;
          }
          if (settled) return;
          settled = true;
          clearTimeout(failSafe);
          renderError(err.message || "该陪玩资料不存在");
        });
    }

    tryNext(0);
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
