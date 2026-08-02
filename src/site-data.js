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
    var detail = "profile.html?player=" + encodeURIComponent(item.id || item.name || "");
    var certBadges = item.certificationStatus === "approved"
      ? '<div class="hot-tags mcj-cert-tags"><span>✔ 已认证</span><span>🏅 官方认证</span>' + (item.isStreamer ? '<span>🎙 主播认证</span>' : '') + '</div>'
      : '';
    return '<article class="neon-card companion-card hot-card" data-companion-id="' + esc(item.id || "") + '">' +
      '<div class="hot-cover"><img src="' + esc(cover || avatar || "/default-avatar.png") + '" alt="' + esc(displayName) + '" onerror="this.onerror=null;this.src=\'/default-avatar.png\'"><span class="online-dot"></span></div>' +
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
    var items = sorted(companions || []).filter(function (c) {
      return c && c.id && !isGarbledName(c.name);
    }).slice(0, 3);
    track.dataset.ready = "";
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
    return {
      id: item.uid || item.id || item.companionProfileId || "",
      name: item.nameValid === false ? "" : (item.nickname || item.name || ""),
      // keep through for filters
      nameValid: item.nameValid !== false && !isGarbledName(item.nickname || item.name),
      game: item.game || item.mainGame || "",
      level: item.levelName || item.level || "Lv.1",
      rating: item.rating || item.score || "",
      price: priceLabel,
      servicePrice: priceLabel,
      cover: window.MCJCompanionMedia
        ? window.MCJCompanionMedia.resolveCover(item)
        : (window.MCJAvatar ? window.MCJAvatar.resolve(item.cover || item.cardImageUrl || item.avatar || "") : (item.cover || item.cardImageUrl || item.avatar || "/default-avatar.png")),
      avatar: window.MCJCompanionMedia
        ? window.MCJCompanionMedia.resolveAvatar(item)
        : (window.MCJAvatar ? window.MCJAvatar.resolve(item.avatar || item.cover || "") : (item.avatar || item.cover || "/default-avatar.png")),
      tags: item.tags || item.serviceTags || [],
      certificationStatus: item.verificationStatus || "",
      auditStatus: "approved",
      visible: true,
      status: item.availabilityStatus || item.onlineStatus || item.status || "online",
      sort: Number(item.sort || 0)
    };
  }
  function applyHomeCompanionTracks(comps) {
    var valid = (comps || []).filter(function (c) {
      return c && c.id && !isGarbledName(c.name) && c.name;
    });
    renderTopThreeTrack("hotCompanionTrack", valid);
    [["recentCompanionTrack", "orders.html", "查看订单"], ["gameCompanionTrack", "companion-center.html", "进入陪玩大厅"], ["reviewCompanionTrack", "companion-center.html", "进入陪玩大厅"]].forEach(function (cfg) {
      var track = document.getElementById(cfg[0]);
      var section = track && track.closest(".section");
      if (section) section.hidden = false;
      if (valid.length) renderTopThreeTrack(cfg[0], valid, { moreHref: cfg[1], moreDesc: cfg[2] });
      else if (track) track.innerHTML = emptyCard("暂无陪玩");
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
    applyHomeCompanionTracks([]);
    loadHomeCompanionsFromApi().then(function (apiComps) {
      applyHomeCompanionTracks(apiComps);
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
