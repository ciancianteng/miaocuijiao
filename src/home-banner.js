(function () {
  "use strict";

  if (window.MCJHomeBanner) return;

  var timers = new WeakMap();
  var touchState = new WeakMap();
  var remoteStore = { contents: { banners: [], notices: [] } };
  var remoteLoaded = false;
  var FALLBACK_BANNER = "/default-home-banner.png";

  function resolveFallbackBanner() {
    return FALLBACK_BANNER;
  }

  function contentApiUrl() {
    return "/api/gateway?path=" + encodeURIComponent("platform/content") + "&types=banners&_=" + Date.now();
  }

  function applyLoadedContent(result, callback) {
    var byType = (result && result.byType) || {};
    var banners = Array.isArray(byType.banners) ? byType.banners : [];
    remoteStore = {
      contents: {
        banners: banners,
        notices: byType.announcements || [],
      },
    };
    remoteLoaded = true;
    if (callback) callback();
  }

  function readStore() {
    return remoteStore || { contents: { banners: [], notices: [] } };
  }

  function loadRemoteContent(callback) {
    fetch(contentApiUrl(), {
      headers: { Accept: "application/json" },
      cache: "no-store",
    })
      .then(function (response) {
        var type = response.headers.get("content-type") || "";
        if (type.indexOf("application/json") < 0) return { ok: true, byType: { banners: [] } };
        return response.json();
      })
      .then(function (result) {
        applyLoadedContent(result, callback);
      })
      .catch(function (error) {
        console.error("[首页 Banner] 远程内容读取失败", error);
        applyLoadedContent({ byType: { banners: [] } }, callback);
      });
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
      if (!item) return false;
      if (item.enabled === false) return false;
      if (item.published === false) return false;
      if (!inSchedule(item)) return false;
      return !!(item.image || item.desktopImage || item.mobileImage || item.image_url);
    });
    list.sort(function (a, b) {
      return Number(a.sort || 99) - Number(b.sort || 99);
    });
    return list;
  }

  function publishedBanner() {
    return activeBanners()[0] || null;
  }

  function esc(value) {
    return String(value || "")
      .replace(/[&<>"']/g, function (ch) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
      })
      .replace(/`/g, "&#96;");
  }

  function normalized(config) {
    config = config || {};
    var image =
      config.desktopImage ||
      config.image ||
      config.image_url ||
      "";
    return {
      id: config.id || "",
      name: config.name || config.title || "MEOW CUI JIAO Banner",
      title: String(config.title || "").trim(),
      subtitle: String(config.subtitle || "").trim(),
      buttonText: String(config.buttonText || config.button_text || "").trim(),
      desktopImage: image,
      mobileImage: config.mobileImage || config.mobile_image_url || image,
      alt: config.alt || config.title || "首页 Banner",
      fitMode: config.fitMode === "contain" ? "contain" : "cover",
      objectPosition: config.objectPosition || "50% 50%",
      desktopHeight: clamp(config.desktopHeight, 220, 300, 260),
      mobileHeight: clamp(config.mobileHeight, 170, 210, 190),
      maxWidth: clamp(config.maxWidth, 960, 1440, 1440),
      radius: clamp(config.radius, 18, 22, 20),
      marginTop: clamp(config.marginTop, 0, 32, 12),
      marginBottom: clamp(config.marginBottom, 8, 32, 18),
      link: config.link || config.href || config.button_link || "",
      linkTarget: config.linkTarget || "_self",
    };
  }

  function sourceFor(data, device) {
    return device === "mobile" && data.mobileImage ? data.mobileImage : data.desktopImage;
  }

  function applyVars(root, data, device) {
    /* Sizing is owned by home-banner.css; only pass fit/position/radius hints. */
    root.style.setProperty("--hero-radius", data.radius + "px");
    root.style.setProperty("--hero-fit", "cover");
    root.style.setProperty("--hero-position", data.objectPosition);
    root.style.removeProperty("max-width");
    root.style.removeProperty("height");
    root.style.marginTop = data.marginTop + "px";
    root.style.marginBottom = data.marginBottom + "px";
    root.dataset.bannerId = data.id || "";
    root.dataset.bannerDevice = device || "";
  }

  function overlayHtml(data) {
    if (!data.title && !data.subtitle && !data.buttonText) return "";
    var btn = "";
    if (data.buttonText) {
      var href = data.link || "#";
      btn =
        '<a class="mcj-hero-overlay-btn" href="' +
        esc(href) +
        '" target="' +
        esc(data.linkTarget) +
        '">' +
        esc(data.buttonText) +
        "</a>";
    }
    return (
      '<div class="mcj-hero-overlay">' +
      (data.title ? "<h2>" + esc(data.title) + "</h2>" : "") +
      (data.subtitle ? "<p>" + esc(data.subtitle) + "</p>" : "") +
      btn +
      "</div>"
    );
  }

  function resolveBannerSrc(source) {
    var fallback = resolveFallbackBanner();
    var src = String(source || "").trim();
    if (!src || /^mcj-local-banner:\/\//i.test(src)) return fallback;
    return src;
  }

  function heroHtml(data, source, index, total) {
    var tag = data.link && !data.buttonText ? "a" : "div";
    var attrs = data.link && !data.buttonText ? ' href="' + esc(data.link) + '" target="' + esc(data.linkTarget) + '"' : "";
    var dots = "";
    var fallback = resolveFallbackBanner();
    var safeSrc = resolveBannerSrc(source);
    for (var i = 0; i < total; i += 1) {
      dots +=
        '<button type="button" class="' +
        (i === index ? "active" : "") +
        '" data-hero-dot="' +
        i +
        '" aria-label="切换 Banner"></button>';
    }
    return (
      "<" +
      tag +
      ' class="mcj-hero-image-link"' +
      attrs +
      ' aria-label="' +
      esc(data.name) +
      '">' +
      '<img class="mcj-hero-image" src="' +
      esc(safeSrc) +
      '" alt="' +
      esc(data.alt) +
      '" decoding="async" data-banner-fallback="' +
      esc(fallback) +
      '">' +
      overlayHtml(data) +
      "</" +
      tag +
      ">" +
      (total > 1
        ? '<button class="mcj-hero-arrow prev" type="button" data-hero-prev aria-label="上一张"></button><button class="mcj-hero-arrow next" type="button" data-hero-next aria-label="下一张"></button><div class="mcj-hero-dots">' +
          dots +
          "</div>"
        : "")
    );
  }

  function emptyHeroHtml() {
    var fallback = resolveFallbackBanner();
    /* Prefer brand image over a giant welcome text box when DB has no banner. */
    return (
      '<div class="mcj-hero-image-link" aria-label="妙脆角默认 Banner">' +
      '<img class="mcj-hero-image" src="' +
      esc(fallback) +
      '" alt="妙脆角" decoding="async" data-banner-fallback="' +
      esc(fallback) +
      '">' +
      "</div>"
    );
  }

  function wireBannerImageFallback(root) {
    if (!root) return;
    root.querySelectorAll("img.mcj-hero-image").forEach(function (img) {
      img.addEventListener("error", function onBannerError() {
        img.removeEventListener("error", onBannerError);
        var fallback = img.getAttribute("data-banner-fallback") || resolveFallbackBanner();
        if (img.getAttribute("src") === fallback) {
          img.removeAttribute("src");
          img.alt = "妙脆角";
          img.style.background =
            "radial-gradient(circle at 30% 30%,rgba(243,168,203,.35),transparent 55%),linear-gradient(135deg,#1a0f18,#050406)";
          return;
        }
        img.setAttribute("src", fallback);
      });
    });
  }

  function clearGeneratedHeroExtras() {
    document.querySelectorAll(".mcj-hero-below-actions,.mcj-hero-notice").forEach(function (node) {
      node.remove();
    });
  }

  function renderEmpty(root, data, device) {
    root.hidden = false;
    root.classList.add("mcj-home-hero");
    root.classList.remove("is-empty");
    root.dataset.heroIndex = "0";
    applyVars(root, data || normalized({}), device || "desktop");
    root.innerHTML = emptyHeroHtml();
    wireBannerImageFallback(root);
    return null;
  }

  function render(target, config, options) {
    var root = typeof target === "string" ? document.querySelector(target) : target;
    if (!root) return null;
    clearGeneratedHeroExtras();
    var banners = Array.isArray(config) ? config : config ? [config] : activeBanners();
    if (!banners.length) return renderEmpty(root, normalized({}), "desktop");
    var device =
      (options && options.device) ||
      (window.matchMedia && window.matchMedia("(max-width: 640px)").matches ? "mobile" : "desktop");
    var current = Number(root.dataset.heroIndex || 0);
    if (options && Number.isFinite(Number(options.index))) current = Number(options.index);
    current = Math.max(0, Math.min(banners.length - 1, current));
    var data = normalized(banners[current]);
    var source = sourceFor(data, device);
    if (!source) return renderEmpty(root, data, device);
    root.hidden = false;
    root.dataset.heroIndex = String(current);
    root.classList.add("mcj-home-hero");
    root.classList.remove("is-empty");
    applyVars(root, data, device);
    root.innerHTML = heroHtml(data, source, current, banners.length);
    wireBannerImageFallback(root);
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
    root.onmouseleave = function () {
      start();
    };
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
    var root =
      document.querySelector("[data-mcj-home-hero]") ||
      document.querySelector(".mcj-home-hero") ||
      document.querySelector(".banner");
    if (root && remoteLoaded) render(root);
    loadRemoteContent(function () {
      var current =
        document.querySelector("[data-mcj-home-hero]") ||
        document.querySelector(".mcj-home-hero") ||
        document.querySelector(".banner");
      if (current) render(current);
    });
  }

  window.MCJHomeBanner = {
    readStore: readStore,
    publishedBanner: publishedBanner,
    activeBanners: activeBanners,
    defaults: normalized,
    render: render,
    applyHome: applyHome,
    reload: applyHome,
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", applyHome);
  else applyHome();
  window.addEventListener("mcj:platform-data-updated", applyHome);
  window.addEventListener("storage", function (event) {
    if (event.key === "mcj_banner_published_at") {
      remoteLoaded = false;
      applyHome();
    }
  });
  window.addEventListener("focus", function () {
    remoteLoaded = false;
    applyHome();
  });
  window.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") {
      remoteLoaded = false;
      applyHome();
    }
  });
  setInterval(function () {
    if (document.visibilityState === "hidden") return;
    remoteLoaded = false;
    applyHome();
  }, 20000);
})();
