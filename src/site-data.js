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
    return '<article class="neon-card companion-card hot-card mcj-empty-card"><div class="hot-info"><h3>' + esc(text || "暂时还没有陪玩入驻。") + '</h3><p>欢迎符合条件的玩家提交申请。</p><a class="mini-order" href="companion-apply.html">申请成为陪玩</a></div></article>';
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
    if (!items.length) { track.innerHTML = emptyCard("暂时还没有陪玩入驻。"); return; }
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
  function renderHomepageButtons() {
    var grid = document.querySelector(".quick-entry-grid");
    if (!grid) return;
    Array.prototype.forEach.call(grid.querySelectorAll("[data-managed-home-button]"), function (node) { node.remove(); });
    return;
    var buttons = sorted(list("homepageButtons"));
    buttons.forEach(function (button) {
      var a = document.createElement("a");
      a.className = "neon-card quick-entry-card";
      a.href = button.href || "#";
      a.setAttribute("data-managed-home-button", button.id || button.name || "");
      a.innerHTML = "<i>" + esc(button.icon || "✦") + "</i><div><strong>" + esc(button.name || "未命名") + "</strong><span>" + esc(button.subtitle || "") + "</span></div>";
      grid.appendChild(a);
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
