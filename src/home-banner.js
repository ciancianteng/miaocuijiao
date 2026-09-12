(function () {
  "use strict";

  if (window.MCJHomeBanner) return;

  var timers = new WeakMap();
  var touchState = new WeakMap();
  var slideCache = new WeakMap();
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

  function normalizeCrop(raw, defaults) {
    defaults = defaults || { ratioW: 1920, ratioH: 700 };
    raw = raw && typeof raw === "object" ? raw : {};
    var zoom = clamp(raw.zoom != null ? raw.zoom : raw.scale, 1, 4, 1);
    var x = clamp(raw.x != null ? raw.x : raw.offsetX != null ? raw.offsetX : raw.nx, -1.5, 1.5, 0);
    var y = clamp(raw.y != null ? raw.y : raw.offsetY != null ? raw.offsetY : raw.ny, -1.5, 1.5, 0);
    if (Math.abs(x) > 2 || Math.abs(y) > 2) {
      x = clamp(x / 640, -1.5, 1.5, 0);
      y = clamp(y / 360, -1.5, 1.5, 0);
    }
    return {
      zoom: zoom,
      x: x,
      y: y,
      ratioW: clamp(raw.ratioW || raw.ratio_w || defaults.ratioW, 320, 4096, defaults.ratioW),
      ratioH: clamp(raw.ratioH || raw.ratio_h || defaults.ratioH, 120, 2160, defaults.ratioH),
    };
  }

  function currentDevice() {
    return window.matchMedia && window.matchMedia("(max-width: 640px)").matches ? "mobile" : "desktop";
  }

  function coverBaseSize(natW, natH, frameW, frameH) {
    var imgRatio = natW / Math.max(1, natH);
    var frameRatio = frameW / Math.max(1, frameH);
    if (imgRatio > frameRatio) return { w: frameH * imgRatio, h: frameH };
    return { w: frameW, h: frameW / Math.max(0.0001, imgRatio) };
  }

  function applyCropToImg(img, frame, crop) {
    if (!img || !frame) return;
    var natW = img.naturalWidth || 1920;
    var natH = img.naturalHeight || 700;
    if (!natW || !natH) return;
    var fw = Math.max(1, frame.clientWidth || frame.offsetWidth);
    var fh = Math.max(1, frame.clientHeight || frame.offsetHeight);
    var c = normalizeCrop(crop);
    /* zoom floor 1 = always cover; never shrink below cover baseline (no side gaps) */
    if (c.zoom < 1) c.zoom = 1;
    var base = coverBaseSize(natW, natH, fw, fh);
    var w = base.w * c.zoom;
    var h = base.h * c.zoom;
    /* !important so index.html / global img max-width rules cannot letterbox */
    img.style.setProperty("width", w + "px", "important");
    img.style.setProperty("height", h + "px", "important");
    img.style.setProperty("max-width", "none", "important");
    img.style.setProperty("max-height", "none", "important");
    img.style.setProperty("left", "50%", "important");
    img.style.setProperty("top", "50%", "important");
    img.style.setProperty("right", "auto", "important");
    img.style.setProperty("bottom", "auto", "important");
    img.style.setProperty("object-fit", "fill", "important");
    img.style.setProperty(
      "transform",
      "translate(calc(-50% + " + c.x * fw + "px), calc(-50% + " + c.y * fh + "px))",
      "important"
    );
    img.setAttribute("data-crop-ready", "1");
    if (Math.abs(c.x) < 0.01 && Math.abs(c.y) < 0.01 && Math.abs(c.zoom - 1) < 0.02) {
      img.setAttribute("data-crop-plain", "1");
    } else {
      img.removeAttribute("data-crop-plain");
    }
  }

  function applyAllCrops(root) {
    if (!root) return;
    var cache = slideCache.get(root);
    var list = (cache && cache.normalized) || [];
    var device = (cache && cache.device) || root.dataset.bannerDevice || currentDevice();
    root.querySelectorAll(".mcj-hero-slide").forEach(function (slide, index) {
      var img = slide.querySelector(".mcj-hero-image");
      var frame = slide.querySelector(".mcj-hero-image-link") || slide;
      var data = list[index] || normalized({});
      if (!img) return;
      function run() {
        applyCropToImg(img, frame, cropFor(data, device));
      }
      if (img.complete && img.naturalWidth) run();
      else img.addEventListener("load", run, { once: true });
    });
  }

  function inSchedule(item) {
    var now = Date.now();
    var start = item.startAt ? Date.parse(item.startAt) : 0;
    var end = item.endAt ? Date.parse(item.endAt) : 0;
    return (!start || now >= start) && (!end || now <= end);
  }

  function isMainBanner(item) {
    return !!(item && (item.isMain === true || item.is_main === true));
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
      var mainDiff = Number(isMainBanner(b)) - Number(isMainBanner(a));
      if (mainDiff) return mainDiff;
      return Number(a.sort ?? a.sort_order ?? 99) - Number(b.sort ?? b.sort_order ?? 99);
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

  function titleHtml(raw) {
    var text = String(raw || "");
    var out = "";
    var last = 0;
    var re = /\*\*([^*]+)\*\*/g;
    var match;
    while ((match = re.exec(text))) {
      out += esc(text.slice(last, match.index));
      out += '<span class="mcj-hero-accent">' + esc(match[1]) + "</span>";
      last = match.index + match[0].length;
    }
    out += esc(text.slice(last));
    return out;
  }

  function normalizeHref(link) {
    var s = String(link || "").trim();
    if (!s) return "";
    if (/^(https?:|mailto:|tel:|\/|#|javascript:)/i.test(s)) return s;
    if (/^(discord\.gg|discord\.com|wa\.me|api\.whatsapp\.com|chat\.whatsapp\.com|t\.me|telegram\.me|www\.)/i.test(s)) {
      return "https://" + s;
    }
    return s;
  }

  function resolveLinkTarget(href, preferred) {
    if (preferred && preferred !== "_self") return preferred;
    var s = String(href || "");
    if (/^https?:\/\//i.test(s)) {
      try {
        if (typeof location !== "undefined" && location.origin && s.indexOf(location.origin) === 0) return "_self";
      } catch (e) {}
      return "_blank";
    }
    return "_self";
  }

  function normalized(config) {
    config = config || {};
    var image =
      config.desktopImage ||
      config.image ||
      config.image_url ||
      "";
    var mobileDedicated = String(config.mobile_image_url || "").trim();
    if (!mobileDedicated && config.hasDedicatedMobile === true && config.mobileImage && config.mobileImage !== image) {
      mobileDedicated = String(config.mobileImage || "").trim();
    }
    if (!mobileDedicated && config.mobileImage && config.mobileImage !== image) {
      mobileDedicated = String(config.mobileImage || "").trim();
    }
    var link = normalizeHref(config.link || config.href || config.button_link || "");
    var crop = normalizeCrop(config.crop || config.crop_meta || {}, { ratioW: 1920, ratioH: 700 });
    var mobileCrop = normalizeCrop(
      config.mobileCrop || config.mobile_crop || config.mobile_crop_meta || (mobileDedicated ? {} : crop),
      { ratioW: 1080, ratioH: 1350 }
    );
    return {
      id: config.id || "",
      name: config.name || config.title || "MEOW CUI JIAO Banner",
      title: String(config.title || "").trim(),
      subtitle: String(config.subtitle || "").trim(),
      buttonText: String(config.buttonText || config.button_text || "").trim(),
      desktopImage: image,
      mobileImage: mobileDedicated || image,
      hasDedicatedMobile: !!mobileDedicated,
      alt: config.alt || config.title || "首页 Banner",
      fitMode: "cover",
      crop: crop,
      mobileCrop: mobileCrop,
      objectPosition: config.objectPosition || 50 + crop.x * 50 + "% " + (50 + crop.y * 50) + "%",
      desktopHeight: clamp(config.desktopHeight, 140, 320, 240),
      mobileHeight: clamp(config.mobileHeight, 120, 220, 160),
      maxWidth: clamp(config.maxWidth, 960, 1440, 1440),
      radius: clamp(config.radius, 18, 22, 20),
      marginTop: clamp(config.marginTop, 0, 32, 12),
      marginBottom: clamp(config.marginBottom, 8, 32, 14),
      link: link,
      linkTarget: resolveLinkTarget(link, config.linkTarget || config.link_target || ""),
      isMain: isMainBanner(config),
      sort: Number(config.sort ?? config.sort_order ?? 100),
    };
  }

  function sourceFor(data, device) {
    if (device === "mobile") return data.mobileImage || data.desktopImage;
    return data.desktopImage;
  }

  function cropFor(data, device) {
    if (device === "mobile") {
      if (data.hasDedicatedMobile) return data.mobileCrop || normalizeCrop({}, { ratioW: 1080, ratioH: 1350 });
      /* Fallback: auto-crop desktop landscape into mobile strip (prefer center / slight top bias) */
      var base = data.crop || normalizeCrop({});
      return {
        zoom: Math.max(1, Number(base.zoom) || 1),
        x: Number(base.x) || 0,
        y: Number.isFinite(Number(base.y)) ? Number(base.y) : -0.08,
        ratioW: 1080,
        ratioH: 1350,
      };
    }
    return data.crop || normalizeCrop({});
  }

  function applyVars(root, data, device) {
    /* Sizing is owned by home-banner.css; crop applied per-slide via applyAllCrops. */
    var crop = cropFor(data, device);
    root.style.setProperty("--hero-radius", data.radius + "px");
    root.style.setProperty("--hero-fit", "cover");
    root.style.setProperty("--hero-position", 50 + crop.x * 50 + "% " + (50 + crop.y * 50) + "%");
    root.style.setProperty("--hero-crop-zoom", String(crop.zoom || 1));
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
      (data.title ? "<h2>" + titleHtml(data.title) + "</h2>" : "") +
      (data.subtitle ? '<p class="mcj-hero-subtitle">' + esc(data.subtitle) + "</p>" : "") +
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

  function slideHtml(data, source, index, isActive) {
    var tag = data.link && !data.buttonText ? "a" : "div";
    var attrs = data.link && !data.buttonText ? ' href="' + esc(data.link) + '" target="' + esc(data.linkTarget) + '"' : "";
    var fallback = resolveFallbackBanner();
    var safeSrc = resolveBannerSrc(source);
    return (
      '<div class="mcj-hero-slide' +
      (isActive ? " is-active" : "") +
      '" data-hero-slide="' +
      index +
      '">' +
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
      "</div>"
    );
  }

  function controlsHtml(index, total) {
    if (total <= 1) return "";
    var dots = "";
    for (var i = 0; i < total; i += 1) {
      dots +=
        '<button type="button" class="mcj-hero-dot' +
        (i === index ? " active" : "") +
        '" data-hero-dot="' +
        i +
        '" aria-label="切换 Banner"></button>';
    }
    return (
      '<button class="mcj-hero-arrow prev" type="button" data-hero-prev aria-label="上一张"></button>' +
      '<button class="mcj-hero-arrow next" type="button" data-hero-next aria-label="下一张"></button>' +
      '<div class="mcj-hero-dots">' +
      dots +
      "</div>"
    );
  }

  function heroHtml(banners, device, index) {
    var slides = "";
    for (var i = 0; i < banners.length; i += 1) {
      var data = normalized(banners[i]);
      slides += slideHtml(data, sourceFor(data, device), i, i === index);
    }
    return '<div class="mcj-hero-slides">' + slides + "</div>" + controlsHtml(index, banners.length);
  }

  function emptyHeroHtml() {
    var fallback = resolveFallbackBanner();
    /* Prefer brand image over a giant welcome text box when DB has no banner. */
    return (
      '<div class="mcj-hero-slides">' +
      '<div class="mcj-hero-slide is-active" data-hero-slide="0">' +
      '<div class="mcj-hero-image-link" aria-label="妙脆角默认 Banner">' +
      '<img class="mcj-hero-image" src="' +
      esc(fallback) +
      '" alt="妙脆角" decoding="async" data-banner-fallback="' +
      esc(fallback) +
      '">' +
      "</div></div></div>"
    );
  }

  function wireBannerImageFallback(root) {
    if (!root) return;
    root.querySelectorAll("img.mcj-hero-image").forEach(function (img) {
      if (img.dataset.fallbackBound === "1") return;
      img.dataset.fallbackBound = "1";
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

  function bannersSignature(banners, device) {
    return (
      device +
      "|" +
      banners
        .map(function (item) {
          var data = normalized(item);
          var crop = cropFor(data, device);
          return [
            data.id,
            data.desktopImage,
            data.mobileImage,
            data.hasDedicatedMobile ? 1 : 0,
            data.title,
            data.subtitle,
            data.buttonText,
            data.link,
            data.isMain ? 1 : 0,
            data.sort,
            crop.zoom,
            crop.x,
            crop.y,
          ].join(":");
        })
        .join("||")
    );
  }

  function restartKenBurns(slide) {
    if (!slide) return;
    var img = slide.querySelector(".mcj-hero-image");
    if (!img || !img.getAttribute("data-crop-plain")) return;
    img.style.animation = "none";
    void img.offsetWidth;
    img.style.animation = "";
  }

  function setActiveSlide(root, index) {
    var slides = root.querySelectorAll(".mcj-hero-slide");
    var dots = root.querySelectorAll("[data-hero-dot]");
    var total = slides.length;
    if (!total) return;
    index = ((index % total) + total) % total;
    root.dataset.heroIndex = String(index);
    for (var i = 0; i < slides.length; i += 1) {
      var on = i === index;
      slides[i].classList.toggle("is-active", on);
      if (on) restartKenBurns(slides[i]);
    }
    for (var d = 0; d < dots.length; d += 1) {
      dots[d].classList.toggle("active", d === index);
    }
    var cache = slideCache.get(root);
    if (cache) {
      cache.index = index;
      var data = cache.normalized && cache.normalized[index];
      if (data) root.dataset.bannerId = data.id || "";
    }
  }

  function renderEmpty(root, data, device) {
    root.hidden = false;
    root.classList.add("mcj-home-hero");
    root.classList.remove("is-empty");
    root.dataset.heroIndex = "0";
    applyVars(root, data || normalized({}), device || "desktop");
    root.innerHTML = emptyHeroHtml();
    slideCache.set(root, {
      signature: "empty",
      banners: [],
      normalized: [data || normalized({})],
      device: device || "desktop",
      index: 0,
    });
    wireBannerImageFallback(root);
    applyAllCrops(root);
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
      currentDevice();
    var current = Number(root.dataset.heroIndex || 0);
    if (options && Number.isFinite(Number(options.index))) current = Number(options.index);
    current = Math.max(0, Math.min(banners.length - 1, current));

    var signature = bannersSignature(banners, device);
    var cache = slideCache.get(root);
    var normalizedList = banners.map(normalized);
    var data = normalizedList[current];
    var source = sourceFor(data, device);
    if (!source) return renderEmpty(root, data, device);

    root.hidden = false;
    root.classList.add("mcj-home-hero");
    root.classList.remove("is-empty");
    applyVars(root, data, device);

    if (cache && cache.signature === signature && root.querySelector(".mcj-hero-slides")) {
      setActiveSlide(root, current);
      applyAllCrops(root);
      bindHero(root, banners, device);
      return data;
    }

    root.innerHTML = heroHtml(banners, device, current);
    root.dataset.heroIndex = String(current);
    slideCache.set(root, {
      signature: signature,
      banners: banners,
      normalized: normalizedList,
      device: device,
      index: current,
    });
    wireBannerImageFallback(root);
    applyAllCrops(root);
    /* Re-apply after layout (aspect-ratio height) settles */
    requestAnimationFrame(function () {
      applyAllCrops(root);
    });
    restartKenBurns(root.querySelector(".mcj-hero-slide.is-active"));
    bindHero(root, banners, device);
    if (!root._mcjCropResizeBound) {
      root._mcjCropResizeBound = true;
      var onViewportChange = function () {
        var nextDevice = currentDevice();
        var cached = slideCache.get(root);
        if (cached && cached.device !== nextDevice) {
          render(root, cached.banners && cached.banners.length ? cached.banners : activeBanners(), {
            device: nextDevice,
            index: Number(root.dataset.heroIndex || 0),
          });
          return;
        }
        applyAllCrops(root);
      };
      window.addEventListener("resize", onViewportChange);
      window.addEventListener("orientationchange", onViewportChange);
      if (window.matchMedia) {
        try {
          window.matchMedia("(max-width: 640px)").addEventListener("change", onViewportChange);
        } catch (e) {
          /* older Safari */
          try {
            window.matchMedia("(max-width: 640px)").addListener(onViewportChange);
          } catch (e2) {}
        }
      }
    }
    return data;
  }

  function goTo(root, banners, device, index) {
    if (!banners.length) return;
    if (index < 0) index = banners.length - 1;
    if (index >= banners.length) index = 0;
    var cache = slideCache.get(root);
    if (cache && cache.signature === bannersSignature(banners, device) && root.querySelector(".mcj-hero-slides")) {
      setActiveSlide(root, index);
      return;
    }
    render(root, banners, { device: device, index: index });
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
      goTo(root, banners, device, index);
      start();
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
      goTo(root, banners, device, index);
      start();
    };

    function start() {
      var timer = timers.get(root);
      if (timer) clearInterval(timer);
      if (banners.length <= 1) return;
      timer = setInterval(function () {
        var index = Number(root.dataset.heroIndex || 0) + 1;
        goTo(root, banners, device, index);
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
