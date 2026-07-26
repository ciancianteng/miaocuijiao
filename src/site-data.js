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
  function emptyCard(text) {
    return '<article class="neon-card companion-card hot-card mcj-empty-card"><div class="hot-info"><h3>' + esc(text || "暂时还没有陪玩入驻，敬请期待。") + '</h3></div></article>';
  }
  function companionCardHtml(item, rank) {
    var cover = item.cover || item.cardCover || item.image || "";
    var avatar = item.avatar || cover || "assets/meow-cuijiao-brand.jpg";
    var price = item.price || item.servicePrice || "";
    var detail = "profile.html?player=" + encodeURIComponent(item.id || item.name || "");
    var certBadges = item.certificationStatus === "approved"
      ? '<div class="hot-tags mcj-cert-tags"><span>✔ 已认证</span><span>🏅 官方认证</span>' + (item.isStreamer ? '<span>🎙 主播认证</span>' : '') + '</div>'
      : '';
    return '<article class="neon-card companion-card hot-card" data-companion-id="' + esc(item.id || "") + '">' +
      '<div class="hot-cover"><img src="' + esc(cover || avatar) + '" alt="' + esc(item.name || "") + '"><span class="online-dot"></span></div>' +
      '<div class="hot-info">' +
      '<h3>' + esc(item.name || "未命名") + '</h3>' +
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
    var items = sorted(companions || []).slice(0, 3);
    track.dataset.ready = "";
    if (!items.length) { track.innerHTML = emptyCard("暂时还没有陪玩入驻，敬请期待。"); return; }
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
    return [
      { slug: "custom-order", name: "自定义订单", description: "填写需求，客服匹配陪玩", href: "custom-order.html", sort: 1, enabled: true, inGrid: true },
      { slug: "more-gameplays", name: "更多玩法", description: "护航、跑刀、代肝、趣味单", href: "more-gameplays.html", sort: 2, enabled: true, inGrid: true },
      { slug: "companion-hall", name: "陪玩大厅", description: "浏览已上架陪玩", href: "companion-center.html", sort: 3, enabled: true, inGrid: true },
      { slug: "team-lobby", name: "组队大厅", description: "进入组队社区", href: "team-lobby.html", sort: 4, enabled: true, inGrid: true },
      { slug: "miao-coin", name: "猫粮充值", description: "查看猫粮充值与猫粮余额", href: "miao-coin.html", sort: 5, enabled: true, inGrid: true },
      { slug: "companion-apply", name: "申请成为陪玩", description: "提交资料，成为认证陪玩", href: "companion-apply.html", sort: 6, enabled: true, inGrid: false }
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
      enabled: row ? row.enabled !== false && data.enabled !== false && data.visible !== false : base.enabled !== false
    });
  }
  function mergeHomeEntries(rows) {
    var mapped = {};
    (rows || []).forEach(function (row) { var item = normalizeHomeEntry(row); if (item.slug) mapped[item.slug] = item; });
    return homeEntryDefaults().map(function (def) { return mapped[def.slug] || def; }).sort(function (a, b) { return Number(a.sort || 0) - Number(b.sort || 0); });
  }
  function applyHomeEntries(entries) {
    var grid = document.querySelector(".quick-entry-grid");
    if (grid) {
      var html = entries.filter(function (entry) { return entry.enabled !== false && entry.inGrid !== false; }).map(function (entry) {
        return '<a class="neon-card quick-entry-card" href="' + esc(entry.href || "#") + '" data-home-entry="' + esc(entry.slug) + '"><div><strong>' + esc(entry.name || "未命名入口") + '</strong><span>' + esc(entry.description || "") + '</span></div></a>';
      }).join("");
      if (html) grid.innerHTML = html;
    }
    var applyButton = document.querySelector("[data-companion-apply-guide]");
    var applyEntry = entries.find(function (entry) { return entry.slug === "companion-apply"; });
    if (applyButton && applyEntry) {
      applyButton.hidden = applyEntry.enabled === false;
      applyButton.href = applyEntry.href || "companion-apply.html";
      applyButton.textContent = applyEntry.name || "申请成为陪玩";
    }
  }
  function renderHomepageButtons() {
    if (homeEntryFetchStarted) return;
    homeEntryFetchStarted = true;
    fetch("/api/platform/content?types=homepage_entries", { headers: { Accept: "application/json" }, cache: "no-store" })
      .then(function (res) { return res.json().catch(function () { return { ok: false, byType: {} }; }); })
      .then(function (result) {
        var rows = result.byType && result.byType.homepage_entries ? result.byType.homepage_entries : [];
        if (rows.length) applyHomeEntries(mergeHomeEntries(rows));
      })
      .catch(function (err) { console.error("[首页入口] 读取后台配置失败", err); });
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
    var notice = noticeBox && noticeBox.querySelector("span");
    if (notice && settings.noticeText) {
      noticeBox.hidden = false;
      notice.textContent = settings.noticeText;
    } else if (noticeBox && !window.MCJHomeBanner) {
      noticeBox.hidden = true;
      if (notice) notice.textContent = "";
    }
    var comps = approvedCompanions();
    renderOfficialAds();
    renderTopThreeTrack("hotCompanionTrack", comps);
    [["recentCompanionTrack", "orders.html", "查看订单"], ["gameCompanionTrack", "companion-center.html", "进入陪玩大厅"], ["reviewCompanionTrack", "companion-center.html", "进入陪玩大厅"]].forEach(function (cfg) {
      var track = document.getElementById(cfg[0]);
      var section = track && track.closest(".section");
      if (section) section.hidden = !comps.length;
      if (comps.length) renderTopThreeTrack(cfg[0], comps, { moreHref: cfg[1], moreDesc: cfg[2] });
      else if (track) track.innerHTML = "";
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
