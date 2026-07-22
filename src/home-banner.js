(function () {
  "use strict";

  if (window.MCJHomeBanner) return;

  var STORE_KEY = "mcjPlatformData.v1";
  var timers = new WeakMap();
  var touchState = new WeakMap();

  function readStore() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || "{}") || {}; }
    catch (error) { return {}; }
  }

  function clamp(value, min, max, fallback) {
    var number = Number(value);
    if (!Number.isFinite(number)) number = fallback;
    return Math.max(min, Math.min(max, number));
  }

  function inSchedule(item) {
    var now = Date.now();
    var start = item.startAt ? Date.parse(item.startAt) : 0;
    var end = item.endAt ? Date.parse(item.endAt) : 0;
    return (!start || now >= start) && (!end || now <= end);
  }

  function activeBanners() {
    var db = readStore();
    var list = (((db.contents || {}).banners) || []).filter(function (item) {
      return item && item.enabled !== false && item.published === true && inSchedule(item) && (item.image || item.desktopImage || item.mobileImage);
    });
    list.sort(function (a, b) { return Number(a.sort || 99) - Number(b.sort || 99); });
    return list;
  }

  function publishedBanner() {
    return activeBanners()[0] || null;
  }

  function getAnnouncements() {
    var db = readStore();
    var list = (((db.contents || {}).notices) || []).filter(function (item) {
      return item && item.enabled !== false && inSchedule(item);
    });
    list.sort(function (a, b) {
      if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
      return Number(a.sort || 99) - Number(b.sort || 99);
    });
    return list.map(function (item) { return item.text || item.title || ""; }).filter(Boolean);
  }

  function esc(value) {
    return String(value || "").replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    }).replace(/`/g, "&#96;");
  }

  function normalized(config) {
    config = config || {};
    return {
      id: config.id || "",
      name: config.name || config.title || "MEOW CUI JIAO Banner",
      desktopImage: config.desktopImage || config.image || "",
      mobileImage: config.mobileImage || "",
      alt: config.alt || config.title || "MEOW CUI JIAO Banner",
      fitMode: config.fitMode === "cover" ? "cover" : "contain",
      objectPosition: config.objectPosition || "50% 50%",
      desktopHeight: clamp(config.desktopHeight, 300, 380, 340),
      mobileHeight: clamp(config.mobileHeight, 150, 260, 190),
      maxWidth: clamp(config.maxWidth, 960, 1200, 1200),
      radius: clamp(config.radius, 18, 24, 20),
      marginTop: clamp(config.marginTop, 0, 32, 12),
      marginBottom: clamp(config.marginBottom, 8, 32, 18),
      link: config.link || config.href || "",
      linkTarget: config.linkTarget || "_self"
    };
  }

  function sourceFor(data, device) {
    return device === "mobile" && data.mobileImage ? data.mobileImage : data.desktopImage;
  }

  function applyVars(root, data, device) {
    root.style.setProperty("--hero-h", data.desktopHeight + "px");
    root.style.setProperty("--hero-mobile-h", data.mobileHeight + "px");
    root.style.setProperty("--hero-radius", data.radius + "px");
    root.style.setProperty("--hero-fit", data.fitMode);
    root.style.setProperty("--hero-position", data.objectPosition);
    root.style.maxWidth = data.maxWidth + "px";
    root.style.marginTop = data.marginTop + "px";
    root.style.marginBottom = data.marginBottom + "px";
    root.dataset.bannerId = data.id || "";
    root.dataset.bannerDevice = device || "";
  }

  function heroHtml(data, source, index, total) {
    var tag = data.link ? "a" : "div";
    var attrs = data.link ? ' href="' + esc(data.link) + '" target="' + esc(data.linkTarget) + '"' : "";
    var dots = "";
    for (var i = 0; i < total; i += 1) {
      dots += '<button type="button" class="' + (i === index ? "active" : "") + '" data-hero-dot="' + i + '" aria-label="切换 Banner"></button>';
    }
    return '<' + tag + ' class="mcj-hero-image-link"' + attrs + ' aria-label="' + esc(data.name) + '">' +
      '<img class="mcj-hero-image" src="' + esc(source) + '" alt="' + esc(data.alt) + '">' +
      '</' + tag + '>' +
      (total > 1 ? '<button class="mcj-hero-arrow prev" type="button" data-hero-prev aria-label="上一张"></button><button class="mcj-hero-arrow next" type="button" data-hero-next aria-label="下一张"></button><div class="mcj-hero-dots">' + dots + '</div>' : "");
  }

  function renderNotice(announcements) {
    var notice = document.querySelector(".announcement-strip");
    var span = notice && notice.querySelector("span");
    if (!notice || !span) return;
    if (!announcements.length) {
      notice.hidden = true;
      span.textContent = "";
      return;
    }
    notice.hidden = false;
    span.textContent = announcements.join("　·　");
  }

  function clearGeneratedHeroExtras() {
    document.querySelectorAll(".mcj-hero-below-actions,.mcj-hero-notice").forEach(function (node) { node.remove(); });
  }

  function render(target, config, options) {
    var root = typeof target === "string" ? document.querySelector(target) : target;
    if (!root) return null;
    clearGeneratedHeroExtras();
    var banners = Array.isArray(config) ? config : (config ? [config] : activeBanners());
    var announcements = getAnnouncements();
    if (!banners.length) {
      root.hidden = true;
      root.innerHTML = "";
      renderNotice(announcements);
      return null;
    }
    var device = (options && options.device) || (window.matchMedia && window.matchMedia("(max-width: 640px)").matches ? "mobile" : "desktop");
    var current = Number(root.dataset.heroIndex || 0);
    if (options && Number.isFinite(Number(options.index))) current = Number(options.index);
    current = Math.max(0, Math.min(banners.length - 1, current));
    var data = normalized(banners[current]);
    var source = sourceFor(data, device);
    if (!source) {
      root.hidden = true;
      root.innerHTML = "";
      renderNotice(announcements);
      return null;
    }
    root.hidden = false;
    root.dataset.heroIndex = String(current);
    root.classList.add("mcj-home-hero");
    applyVars(root, data, device);
    root.innerHTML = heroHtml(data, source, current, banners.length);
    renderNotice(announcements);
    bindHero(root, banners, device);
    return data;
  }

  function bindHero(root, banners, device) {
    var oldTimer = timers.get(root);
    if (oldTimer) clearInterval(oldTimer);
    root.onmouseenter = function () {
      var timer = timers.get(root);
      if (timer) clearInterval(timer);
    };
    root.onmouseleave = function () { start(); };
    root.onclick = function (event) {
      var prev = event.target.closest("[data-hero-prev]");
      var next = event.target.closest("[data-hero-next]");
      var dot = event.target.closest("[data-hero-dot]");
      if (!prev && !next && !dot) return;
      event.preventDefault();
      var index = Number(root.dataset.heroIndex || 0);
      if (prev) index -= 1;
      if (next) index += 1;
      if (dot) index = Number(dot.dataset.heroDot);
      if (index < 0) index = banners.length - 1;
      if (index >= banners.length) index = 0;
      render(root, banners, { device: device, index: index });
    };
    root.ontouchstart = function (event) {
      var touch = event.touches && event.touches[0];
      if (touch) touchState.set(root, { x: touch.clientX, y: touch.clientY });
    };
    root.ontouchend = function (event) {
      var startPoint = touchState.get(root);
      var touch = event.changedTouches && event.changedTouches[0];
      if (!startPoint || !touch || banners.length <= 1) return;
      var dx = touch.clientX - startPoint.x;
      if (Math.abs(dx) < 42 || Math.abs(dx) < Math.abs(touch.clientY - startPoint.y)) return;
      var index = Number(root.dataset.heroIndex || 0) + (dx < 0 ? 1 : -1);
      if (index < 0) index = banners.length - 1;
      if (index >= banners.length) index = 0;
      render(root, banners, { device: device, index: index });
    };

    function start() {
      if (banners.length <= 1) return;
      var timer = setInterval(function () {
        var index = Number(root.dataset.heroIndex || 0) + 1;
        if (index >= banners.length) index = 0;
        render(root, banners, { device: device, index: index });
      }, 5000);
      timers.set(root, timer);
    }
    start();
  }

  function applyHome() {
    var root = document.querySelector("[data-mcj-home-hero]") || document.querySelector(".mcj-home-hero") || document.querySelector(".banner");
    if (root) render(root);
  }

  window.MCJHomeBanner = {
    readStore: readStore,
    publishedBanner: publishedBanner,
    activeBanners: activeBanners,
    defaults: normalized,
    render: render,
    applyHome: applyHome
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", applyHome);
  else applyHome();
  window.addEventListener("mcj:platform-data-updated", applyHome);
})();
