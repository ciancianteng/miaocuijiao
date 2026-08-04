(function () {
  var DB_KEY = "mcjRealDB.v1";
  var EMPTY_DB = {
    siteSettings: { bannerImage: "", noticeText: "", customerServiceUrl: "", discordInviteUrl: "" },
    ads: [],
    companions: [],
    serviceRanges: [],
    orders: [],
    dispatches: [],
    profileAudits: [],
    services: [],
    homepageButtons: [],
    levelFrames: [],
    supportAgents: [],
    bosses: [],
    withdrawals: [],
    reviews: [],
    sensitiveWords: [],
    admins: [],
    logs: [],
    customerTickets: [],
    cooperationInquiries: [],
    certifications: [],
    companionApplications: [],
    companionRules: [],
    companionApplicationPayments: [],
    depositSettings: {}
  };

  function clone(v) { return JSON.parse(JSON.stringify(v)); }
  function esc(text) { return String(text || "").replace(/[&<>"']/g, function (ch) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]; }); }
  function now() { return Date.now(); }
  function readDB() {
    try {
      var saved = JSON.parse(localStorage.getItem(DB_KEY) || "null");
      return Object.assign(clone(EMPTY_DB), saved || {});
    } catch (e) { return clone(EMPTY_DB); }
  }
  function writeDB(db) {
    localStorage.setItem(DB_KEY, JSON.stringify(Object.assign(clone(EMPTY_DB), db || {})));
    window.dispatchEvent(new CustomEvent("mcj:data-updated"));
  }
  function list(name) { var db = readDB(); return Array.isArray(db[name]) ? db[name] : []; }
  function enabled(item) {
    if (!item || item.enabled === false) return false;
    var t = now();
    var start = item.startAt ? new Date(item.startAt).getTime() : 0;
    var end = item.endAt ? new Date(item.endAt).getTime() : 0;
    if (start && t < start) return false;
    if (end && t > end) return false;
    return true;
  }
  function sorted(items) { return (items || []).filter(enabled).sort(function (a, b) { return (Number(a.sort) || 999) - (Number(b.sort) || 999); }); }
  function approvedCompanions() {
    return sorted(list("companions").filter(function (p) {
      return p.auditStatus === "approved" && p.visible !== false && p.visible !== "false" && p.status !== "offline";
    }));
  }
  function tagsHtml(tags) {
    if (!Array.isArray(tags)) tags = String(tags || "").split(/[，,]/).map(function (s) { return s.trim(); }).filter(Boolean);
    return tags.map(function (tag) { return "<span>" + esc(tag) + "</span>"; }).join("");
  }
  function isGarbledName(value) {
    var s = String(value == null ? "" : value).trim();
    if (!s) return true;
    var marks = (s.match(/[?\uFFFD？]/g) || []).length;
    if (marks >= 2 && marks >= Math.ceil(s.length * 0.4)) return true;
    if (/^(?:\?|？|\uFFFD){2,}/.test(s)) return true;
    return false;
  }
  function emptyCard(text) {
    return '<article class="neon-card companion-card hot-card mcj-empty-card"><div class="hot-info"><h3>' + esc(text || "暂无陪玩") + '</h3></div></article>';
  }
  /** Focal crop only — never change cover aspect / card size from JS. */
  var COVER_FOCUS_DEFAULTS = {
    PW00002: { x: 50, y: 22 }, // 1717 face
    PW00004: { x: 50, y: 40 }, // 凝梦 composition
  };
  function clampPct(n, fallback) {
    var v = Number(n);
    if (!Number.isFinite(v)) return fallback;
    return Math.max(0, Math.min(100, v));
  }
  function resolveCoverFocus(item) {
    var pub = String((item && (item.publicId || item.companionCode || item.id)) || "").toUpperCase();
    var preset = COVER_FOCUS_DEFAULTS[pub] || null;
    var x = item && (item.objectPositionX != null ? item.objectPositionX : item.object_position_x);
    var y = item && (item.objectPositionY != null ? item.objectPositionY : item.object_position_y);
    var focal = item && (item.focalPoint || item.focal_point);
    if (focal && typeof focal === "object") {
      if (x == null && focal.x != null) x = focal.x;
      if (y == null && focal.y != null) y = focal.y;
    } else if (typeof focal === "string" && focal.indexOf(",") >= 0) {
      var parts = focal.split(",");
      if (x == null) x = parts[0];
      if (y == null) y = parts[1];
    }
    if ((x == null || y == null) && preset) {
      x = x == null ? preset.x : x;
      y = y == null ? preset.y : y;
    }
    var fit = String((item && (item.coverFit || item.cover_fit)) || "cover").toLowerCase();
    if (fit !== "contain") fit = "cover";
    return {
      x: clampPct(x, 50),
      y: clampPct(y, 25),
      fit: fit,
      publicId: pub,
    };
  }
  function companionCardHtml(item, rank) {
    var cover = item.cover || item.cardCover || item.image || "";
    var avatar = item.avatar || cover || "/default-avatar.png";
    if (window.MCJAvatar && window.MCJAvatar.resolve) {
      avatar = window.MCJAvatar.resolve(avatar);
      cover = window.MCJAvatar.resolve(cover || avatar);
    } else {
      if (!String(avatar).trim() || /meow-cuijiao-brand\.(jpe?g|png|webp)$/i.test(String(avatar))) {
        avatar = "/default-avatar.png";
      }
      if (!String(cover).trim() || /meow-cuijiao-brand\.(jpe?g|png|webp)$/i.test(String(cover))) {
        cover = avatar;
      }
    }
    var displayName = String(item.name || "").trim();
    if (isGarbledName(displayName)) displayName = "未命名陪玩";
    var price = item.price || item.servicePrice || "";
    var detail = "profile.html?player=" + encodeURIComponent(item.publicId || item.id || item.name || "");
    var focus = resolveCoverFocus(item);
    var pos = focus.x + "% " + focus.y + "%";
    var certBadges = "";
    var certList = item.certTags || item.certificationTags || [];
    if (Array.isArray(certList) && certList.length) {
      certBadges =
        '<div class="hot-tags mcj-cert-tags">' +
        certList
          .slice(0, 4)
          .map(function (t) {
            var name = typeof t === "string" ? t : t.name || t.title || "";
            if (!name) return "";
            var icon = typeof t === "object" && t.icon ? t.icon + " " : "🏅 ";
            return "<span>" + esc(icon + name) + "</span>";
          })
          .filter(Boolean)
          .join("") +
        "</div>";
    } else if (item.certificationStatus === "approved") {
      certBadges =
        '<div class="hot-tags mcj-cert-tags"><span>✔ 已认证</span></div>';
    }
    return '<article class="neon-card companion-card hot-card" data-companion-id="' + esc(item.id || "") + '" data-public-id="' + esc(focus.publicId || item.publicId || "") + '">' +
      '<div class="hot-cover"><img src="' + esc(cover || avatar || "/default-avatar.png") + '" alt="' + esc(displayName) + '" data-cover-fit="' + esc(focus.fit) + '" style="object-fit:' + esc(focus.fit) + ';object-position:' + esc(pos) + ';--mcj-cover-pos:' + esc(pos) + '" onerror="this.onerror=null;this.src=\'/default-avatar.png\'"><span class="online-dot"></span></div>' +
      '<div class="hot-info">' +
      '<h3>' + esc(displayName) + '</h3>' +
      '<p>' + esc(item.game || item.mainGame || "") + '</p>' +
      '<div class="hot-meta"><span>' + esc(item.level || "Lv.1") + '</span><span>★ ' + esc(item.rating || "") + '</span></div>' +
      '<div class="hot-orders">' + esc(price || "") + '</div>' +
      certBadges +
      '<div class="hot-tags">' + tagsHtml(item.tags || item.serviceTags) + '</div>' +
      '<a class="mini-order" href="' + esc(detail) + '">查看详情</a>' +
      '</div>' +
      '</article>';
  }
  function renderTopThreeTrack(id, companions, options) {
    options = options || {};
    var track = document.getElementById(id);
    if (!track) return;
    // Only render real companions — never pad blank TOP slots.
    var source = (companions || []).filter(function (c) {
      return c && c.id && !isGarbledName(c.name) && c.name;
    });
    var items = source.slice(0, 3);
    var cols = Math.max(1, items.length + 1); // companions + MORE
    track.dataset.ready = "1";
    track.dataset.sourceCount = String(source.length);
    track.setAttribute("data-home-source-count", String(source.length));
    track.style.gridTemplateColumns = "repeat(" + cols + ", minmax(0, 1fr))";
    if (!items.length) { track.innerHTML = emptyCard("暂无陪玩"); return; }
    track.innerHTML = items.map(companionCardHtml).join("") +
      '<a class="neon-card companion-card hot-card hot-more-card" href="' + esc(options.moreHref || "companion-center.html") + '"><div class="hot-more-inner"><span>MORE</span><strong>更多</strong><p>' + esc(options.moreDesc || "进入陪玩大厅") + '</p></div></a>';
  }
  function renderOfficialAds() {
    var track = document.getElementById("officialAdTrack");
    var dots = document.getElementById("officialAdDots");
    if (!track) return;
    var ads = sorted(list("ads"));
    var section = track.closest(".official-ads");
    if (!ads.length) {
      if (section) section.hidden = true;
      track.innerHTML = "";
      if (dots) dots.innerHTML = "";
      return;
    }
    if (section) section.hidden = false;
    track.innerHTML = ads.map(function (ad, index) {
      return '<article class="official-ad-slide' + (index === 0 ? ' active' : '') + '" data-link="' + esc(ad.link || "#") + '">' +
        '<img src="' + esc(ad.image || "") + '" alt="' + esc(ad.title || "") + '">' +
        '<div class="official-ad-badge">' + esc(ad.tag || "OFFICIAL") + '</div>' +
        '<div class="official-ad-copy"><h3>' + esc(ad.title || "") + '</h3><p>' + esc(ad.description || ad.subtitle || "") + '</p><button type="button">' + esc(ad.button || "查看") + '</button></div>' +
        '</article>';
    }).join("");
    if (dots) dots.innerHTML = ads.map(function (_, i) { return '<button type="button" data-ad-dot="' + i + '"' + (i === 0 ? ' class="active"' : '') + '></button>'; }).join("");
    window.mcjOfficialAds = ads;
    window.mcjOfficialAdIndex = 0;
    if (typeof window.showOfficialAd === "function") window.showOfficialAd(0);
  }
  var homeEntryFetchStarted = false;
  function homeEntryDefaults() {
    // Grid only keeps functional entries; 我的订单 / 在线客服 live in top nav only.
    return [
      { slug: "companion-hall", name: "陪玩大厅", description: "浏览已上架陪玩，立即下单", href: "companion-center.html", sort: 1, enabled: true, inGrid: true },
      { slug: "more-gameplays", name: "更多玩法", description: "护航、跑刀、代肝、趣味单", href: "more-gameplays.html", sort: 2, enabled: true, inGrid: true },
      { slug: "custom-order", name: "自定义订单", description: "填写需求，客服匹配陪玩", href: "custom-order.html", sort: 3, enabled: true, inGrid: true },
      { slug: "team-lobby", name: "组队大厅", description: "进入组队社区找队友", href: "team-lobby.html", sort: 4, enabled: true, inGrid: true }
    ];
  }
  function normalizeHomeEntry(row) {
    var data = row && row.data ? row.data : (row && row.draft ? row.draft : row || {});
    var slug = String(data.slug || row.slug || "").trim();
    var base = homeEntryDefaults().find(function (item) { return item.slug === slug; }) || {};
    return Object.assign({}, base, data, {
      slug: slug || base.slug || "",
      name: data.name || row.title || base.name || "未命名入口",
      description: data.description || data.subtitle || base.description || "",
      href: data.href || data.link || base.href || "#",
      sort: Number(data.sort || row.sort || base.sort || 100),
      enabled: row ? row.enabled !== false && data.enabled !== false && data.visible !== false : base.enabled !== false,
      inGrid: data.inGrid != null ? data.inGrid !== false : base.inGrid !== false
    });
  }
  function mergeHomeEntries(rows) {
    var mapped = {};
    (rows || []).forEach(function (row) { var item = normalizeHomeEntry(row); if (item.slug) mapped[item.slug] = item; });
    return homeEntryDefaults().map(function (def) { return mapped[def.slug] || def; }).sort(function (a, b) { return Number(a.sort || 0) - Number(b.sort || 0); });
  }
  function ensureCompanionApplyCard() {
    /* Homepage grid: hall / gameplay / custom / team only. Orders & support are top-nav. */
  }
  function applyHomeEntries(entries) {
    ensureCompanionApplyCard();
    var applySection = document.querySelector("[data-companion-apply-section], .companion-apply-guide");
    var applyButton = document.querySelector("[data-companion-apply-guide]");
    var applyEntry = (entries || []).find(function (entry) { return entry && entry.slug === "companion-apply"; });
    if (applySection) applySection.hidden = false;
    if (applyButton) {
      applyButton.hidden = false;
      if (applyEntry && applyEntry.href) applyButton.href = applyEntry.href;
      else applyButton.href = "companion-apply.html";
    }
  }
  function renderHomepageButtons() {
    if (homeEntryFetchStarted) return;
    homeEntryFetchStarted = true;
    applyHomeEntries(homeEntryDefaults());
    fetch("/api/platform/content?types=homepage_entries", { headers: { Accept: "application/json" }, cache: "no-store" })
      .then(function (res) { return res.json().catch(function () { return { ok: false, byType: {} }; }); })
      .then(function (result) {
        var rows = result.byType && result.byType.homepage_entries ? result.byType.homepage_entries : [];
        applyHomeEntries(mergeHomeEntries(rows));
      })
      .catch(function (err) {
        console.error("[首页入口] 读取后台配置失败", err);
        applyHomeEntries(homeEntryDefaults());
      });
  }
  function mapPublicCompanion(item) {
    if (!item || typeof item !== "object") return null;
    var priceRaw = item.priceValue != null ? item.priceValue : (item.hourlyPrice != null ? item.hourlyPrice : item.price);
    var priceNum = Number(priceRaw);
    var priceLabel = Number.isFinite(priceNum)
      ? (window.MCJCurrency && window.MCJCurrency.formatRate
          ? window.MCJCurrency.formatRate(priceNum, item.pricingUnit || "小时")
          : (String(priceNum).replace(/\.0+$/, "") + " 猫粮/" + (item.pricingUnit || "小时")))
      : "";
    var coverRaw = window.MCJCompanionMedia
      ? window.MCJCompanionMedia.resolveCover(item)
      : (window.MCJAvatar ? window.MCJAvatar.resolve(item.cover || item.cardImageUrl || item.avatar || "") : (item.cover || item.cardImageUrl || item.avatar || "/default-avatar.png"));
    var avatarRaw = window.MCJCompanionMedia
      ? window.MCJCompanionMedia.resolveAvatar(item)
      : (window.MCJAvatar ? window.MCJAvatar.resolve(item.avatar || item.cover || "") : (item.avatar || item.cover || "/default-avatar.png"));
    return {
      id: item.uid || item.id || item.companionProfileId || "",
      publicId: item.publicId || "",
      name: item.nameValid === false ? "" : (item.nickname || item.name || ""),
      // keep through for filters
      nameValid: item.nameValid !== false && !isGarbledName(item.nickname || item.name),
      game: item.game || item.mainGame || "",
      level: item.levelName || item.level || "Lv.1",
      rating: item.rating || item.score || "",
      price: priceLabel,
      servicePrice: priceLabel,
      cover: coverRaw,
      avatar: avatarRaw,
      hasRealCover: !!(coverRaw && !/default-avatar/i.test(String(coverRaw))),
      objectPositionX: item.objectPositionX != null ? item.objectPositionX : item.object_position_x,
      objectPositionY: item.objectPositionY != null ? item.objectPositionY : item.object_position_y,
      focalPoint: item.focalPoint || item.focal_point || null,
      coverFit: item.coverFit || item.cover_fit || "",
      tags: item.tags || item.serviceTags || [],
      certTags: item.certTags || item.certificationTags || [],
      certificationStatus: item.verificationStatus || "",
      auditStatus: "approved",
      featured: item.featured === true || item.recommendationStatus === "featured",
      visible: true,
      status: item.availabilityStatus || item.onlineStatus || item.status || "offline",
      sort: Number(item.sort || 0)
    };
  }
  function pickHotRecommendPool(comps) {
    var valid = (comps || []).filter(function (c) {
      return c && c.id && !isGarbledName(c.name) && c.name;
    });
    // Stable order: never use updated_at churn. Prefer featured for homepage hot track.
    function stableSort(list) {
      return list.slice().sort(function (a, b) {
        var fa = a.featured ? 1 : 0;
        var fb = b.featured ? 1 : 0;
        if (fb !== fa) return fb - fa;
        var pa = String(a.publicId || a.id || "");
        var pb = String(b.publicId || b.id || "");
        if (pa < pb) return -1;
        if (pa > pb) return 1;
        return String(a.name || "").localeCompare(String(b.name || ""), "zh");
      });
    }
    var featured = valid.filter(function (c) { return c.featured; });
    // Admin has「是否推荐到首页」: when any featured exist, homepage uses only those.
    // When none marked yet, all hall-visible companions can enter recommend ranking (stable).
    return stableSort(featured.length ? featured : valid);
  }
  function applyHomeCompanionTracks(comps, opts) {
    opts = opts || {};
    var hallValid = (comps || []).filter(function (c) {
      return c && c.id && !isGarbledName(c.name) && c.name;
    });
    var hotPool = pickHotRecommendPool(hallValid);
    // Expose full recommendation source size for acceptance (display still top-3).
    try {
      window.__MCJ_HOME_COMPANION_SOURCE__ = {
        count: hotPool.length,
        hallCount: hallValid.length,
        featuredCount: hallValid.filter(function (c) { return c.featured; }).length,
        ids: hotPool.map(function (c) { return c.publicId || c.id; }),
        names: hotPool.map(function (c) { return c.name; }),
      };
    } catch (e) {}
    if (!opts.skipEmpty && !hallValid.length && !opts.fromApi) {
      // Keep previous cards while waiting for live API; avoid flash of「暂无陪玩」.
      return;
    }
    renderTopThreeTrack("hotCompanionTrack", hotPool);
    [["recentCompanionTrack", "orders.html", "查看订单"], ["gameCompanionTrack", "companion-center.html", "进入陪玩大厅"], ["reviewCompanionTrack", "companion-center.html", "进入陪玩大厅"]].forEach(function (cfg) {
      var track = document.getElementById(cfg[0]);
      var section = track && track.closest(".section");
      if (section) section.hidden = false;
      if (hotPool.length) renderTopThreeTrack(cfg[0], hotPool, { moreHref: cfg[1], moreDesc: cfg[2] });
      else if (track && opts.fromApi) track.innerHTML = emptyCard("暂无陪玩");
    });
  }
  function loadHomeCompanionsFromApi() {
    return fetch("/api/public/companions", { headers: { Accept: "application/json" }, cache: "no-store" })
      .then(function (res) { return res.json().catch(function () { return { ok: false, companions: [] }; }); })
      .then(function (body) {
        var rows = body && body.ok && Array.isArray(body.companions) ? body.companions : [];
        return rows.map(mapPublicCompanion).filter(function (c) {
          return c && c.id && c.nameValid !== false && !isGarbledName(c.name) && c.name;
        });
      })
      .catch(function (err) {
        console.error("[首页陪玩] 读取公开陪玩失败", err);
        return [];
      });
  }
  function renderHomeManagedData() {
    var db = readDB();
    var settings = db.siteSettings || {};
    var bannerImg = document.querySelector(".banner img, .hero-img");
    if (bannerImg) {
      if (settings.bannerImage) bannerImg.src = settings.bannerImage;
      else if (!bannerImg.getAttribute("src")) bannerImg.src = "assets/hero-banner-latest.png";
    }
    var noticeBox = document.querySelector(".announcement-strip");
    /* 公告栏由 home-announcements.js 负责，避免本地 siteSettings 覆盖后台公告。 */
    if (noticeBox && noticeBox.id !== "homeAnnouncementBar" && !window.MCJHomeAnnouncements) {
      var notice = noticeBox.querySelector("span");
      if (notice && settings.noticeText) {
        noticeBox.hidden = false;
        notice.textContent = settings.noticeText;
      }
    }
    renderOfficialAds();
    /* Prefer live public API only; never keep garbled local placeholder cards on home. */
    loadHomeCompanionsFromApi().then(function (apiComps) {
      applyHomeCompanionTracks(apiComps, { fromApi: true, skipEmpty: true });
    });
    renderHomepageButtons();
  }
  function validatePrice(service, price) {
    var ranges = list("serviceRanges");
    var found = ranges.find(function (r) { return r.service === service; });
    if (!found) return { ok: true };
    var value = Number(price);
    if (value < Number(found.min) || value > Number(found.max)) return { ok: false, message: "价格超出俱乐部允许范围" };
    return { ok: true };
  }
  window.MCJRealData = { key: DB_KEY, empty: EMPTY_DB, readDB: readDB, writeDB: writeDB, list: list, sorted: sorted, approvedCompanions: approvedCompanions, companionCardHtml: companionCardHtml, renderHomeManagedData: renderHomeManagedData, validatePrice: validatePrice };
  window.MCJData = { read: function (key) { return list(key); }, enabledSorted: sorted, renderHomeManagedData: renderHomeManagedData };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", renderHomeManagedData); else renderHomeManagedData();
  window.addEventListener("mcj:data-updated", renderHomeManagedData);
})();
