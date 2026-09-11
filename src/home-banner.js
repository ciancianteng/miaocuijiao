(function () {
  "use strict";

  if (window.MCJHomeBanner) return;

  var timers = new WeakMap();
  var touchState = new WeakMap();
  var slideCache = new WeakMap();
  var remoteStore = { contents: { banners: [], notices: [] } };
  var remoteLoaded = false;
  // No hardcoded /default-home-banner.png — homepage SoT is admin `banners` table only.

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
    if (window.MCJBannerCrop && typeof window.MCJBannerCrop.applyCropToImg === "function") {
      return window.MCJBannerCrop.applyCropToImg(img, frame, crop);
    }
    if (!img || !frame) return;
    var natW = img.naturalWidth || 1920;
    var natH = img.naturalHeight || 700;
    if (!natW || !natH) return;
    var fw = Math.max(1, frame.clientWidth || frame.offsetWidth);
    var fh = Math.max(1, frame.clientHeight || frame.offsetHeight);
    var c = normalizeCrop(crop);
    if (c.zoom < 1) c.zoom = 1;
    var base = coverBaseSize(natW, natH, fw, fh);
    var w = base.w * c.zoom;
    var h = base.h * c.zoom;
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
        if (!isUsableBannerImage(img)) {
          useBrandBannerAsset(img, img.naturalWidth ? "tiny-stub" : "empty");
          return;
        }
        // Packaged preview-carousel slides: keep CSS object-fit cover (no crop transform).
        if (data.previewSlide || /\/preview-carousel\//.test(String(img.getAttribute("src") || ""))) {
          img.style.removeProperty("width");
          img.style.removeProperty("height");
          img.style.removeProperty("max-width");
          img.style.removeProperty("max-height");
          img.style.removeProperty("left");
          img.style.removeProperty("top");
          img.style.removeProperty("right");
          img.style.removeProperty("bottom");
          img.style.removeProperty("transform");
          img.style.removeProperty("object-fit");
          img.setAttribute("data-crop-ready", "1");
          img.setAttribute("data-crop-plain", "1");
          return;
        }
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
    // Formal rule: smaller sort_order first. Do not let is_main override public order.
    list.sort(function (a, b) {
      var sortDiff = Number(a.sort ?? a.sort_order ?? 100) - Number(b.sort ?? b.sort_order ?? 100);
      if (sortDiff) return sortDiff;
      var createdDiff = String(a.created_at || a.createdAt || "").localeCompare(
        String(b.created_at || b.createdAt || "")
      );
      if (createdDiff) return createdDiff;
      return String(a.id || "").localeCompare(String(b.id || ""));
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
      previewVerify: !!(config.previewVerify || config.preview_verify),
      previewSlide: Number(config.previewSlide || config.preview_slide || 0) || 0,
    };
  }

  function sourceFor(data, device) {
    if (device === "mobile") return data.mobileImage || data.desktopImage;
    return data.desktopImage;
  }

  function isCustomCrop(crop) {
    var c = normalizeCrop(crop || {});
    return Math.abs(c.zoom - 1) > 0.02 || Math.abs(c.x) > 0.01 || Math.abs(c.y) > 0.01;
  }

  function cropFor(data, device) {
    var desktop = data.crop || normalizeCrop({});
    if (device === "mobile") {
      var mobile = data.mobileCrop || normalizeCrop({}, { ratioW: 1080, ratioH: 1350 });
      // Dedicated mobile image may exist, but unless mobileCrop was explicitly customized,
      // reuse the same admin framing (zoom/x/y) with responsive container sizing.
      var useMobile = data.hasDedicatedMobile && isCustomCrop(mobile);
      var src = useMobile ? mobile : desktop;
      return {
        zoom: Math.max(1, Number(src.zoom) || 1),
        x: Number(src.x) || 0,
        y: Number.isFinite(Number(src.y)) ? Number(src.y) : 0,
        ratioW: 1080,
        ratioH: 1350,
      };
    }
    return desktop;
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
    var src = String(source || "").trim();
    // Never substitute a packaged default image — missing URL means skip / empty frame.
    if (!src || /^mcj-local-banner:\/\//i.test(src)) return "";
    return src;
  }

  function slideHtml(data, source, index, isActive) {
    var tag = data.link && !data.buttonText ? "a" : "div";
    var attrs = data.link && !data.buttonText ? ' href="' + esc(data.link) + '" target="' + esc(data.linkTarget) + '"' : "";
    var safeSrc = resolveBannerSrc(source);
    var imgHtml = safeSrc
      ? '<img class="mcj-hero-image" src="' +
        esc(safeSrc) +
        '" alt="' +
        esc(data.alt) +
        '" decoding="async">'
      : '<div class="mcj-hero-image mcj-hero-image-missing" role="img" aria-label="' + esc(data.alt || "Banner") + '"></div>';
    var previewMark =
      data.previewVerify || data.previewSlide > 1
        ? '<div class="mcj-hero-preview-badge" data-preview-badge="1">Preview 验证 · Slide ' +
          esc(String(data.previewSlide || index + 1)) +
          "</div>"
        : data.previewSlide === 1
          ? '<div class="mcj-hero-preview-badge mcj-hero-preview-badge--brand" data-preview-badge="1">Slide 1 · 妙脆角电竞</div>'
          : "";
    return (
      '<div class="mcj-hero-slide' +
      (isActive ? " is-active" : "") +
      '" data-hero-slide="' +
      index +
      '"' +
      (data.previewSlide ? ' data-preview-slide="' + esc(String(data.previewSlide)) + '"' : "") +
      (data.previewVerify ? ' data-preview-verify="1"' : "") +
      ">" +
      "<" +
      tag +
      ' class="mcj-hero-image-link"' +
      attrs +
      ' aria-label="' +
      esc(data.name) +
      '">' +
      imgHtml +
      previewMark +
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
      '<div class="mcj-hero-dots" role="tablist" aria-label="Banner 轮播状态">' +
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
    // Viewport owns aspect-ratio; dots sit BELOW (Linglu pagination).
    // No floating prev/next arrows — autoplay + swipe + dots only.
    return (
      '<div class="mcj-hero-viewport" data-hero-viewport="1">' +
      '<div class="mcj-hero-slides">' +
      slides +
      "</div>" +
      "</div>" +
      (banners.length >= 1
        ? '<div class="mcj-hero-dots" role="tablist" aria-label="Banner 轮播状态">' +
          Array.from({ length: banners.length })
            .map(function (_, i) {
              return (
                '<button type="button" class="mcj-hero-dot' +
                (i === index ? " active" : "") +
                '" data-hero-dot="' +
                i +
                '" aria-label="切换到 Banner ' +
                (i + 1) +
                '"></button>'
              );
            })
            .join("") +
          "</div>"
        : "")
    );
  }

  function emptyHeroHtml() {
    /* No packaged default banner — empty frame only when DB has zero active banners. */
    return (
      '<div class="mcj-hero-viewport">' +
      '<div class="mcj-hero-slides" data-banner-empty="1">' +
      '<div class="mcj-hero-slide is-active" data-hero-slide="0">' +
      '<div class="mcj-hero-image-link" aria-label="暂无 Banner">' +
      '<div class="mcj-hero-image mcj-hero-image-missing" role="img" aria-label="暂无 Banner"></div>' +
      "</div></div></div></div>"
    );
  }

  var BRAND_BANNER_ASSET = "/default-home-banner.png";
  var AUTOPLAY_MS = 4500;
  var PREVIEW_SLIDE_ASSETS = [
    "/preview-carousel/slide-1-miaocuijiao.png",
    "/preview-carousel/slide-2-preview-verify.png",
    "/preview-carousel/slide-3-preview-verify.png",
  ];

  function isProductionHost() {
    try {
      var h = String((typeof location !== "undefined" && location.hostname) || "");
      return /(^|\.)meowcuijiao\.com$/i.test(h);
    } catch (e) {
      return false;
    }
  }

  function buildPreviewVerifySlides() {
    // Temporary multi-slide pack for Preview/Staging when admin has <2 usable banners.
    // Assets are copies of the brand banner — labeled Preview 验证, not campaign art.
    return PREVIEW_SLIDE_ASSETS.map(function (src, i) {
      var n = i + 1;
      return {
        id: "mcj-preview-carousel-" + n,
        name: n === 1 ? "妙脆角电竞" : "Preview 验证 · Slide " + n,
        title: "",
        subtitle: "",
        image: src,
        desktopImage: src,
        mobileImage: src,
        alt: n === 1 ? "妙脆角电竞" : "Preview 验证 Banner Slide " + n,
        enabled: true,
        published: true,
        sort: n,
        previewVerify: n > 1,
        previewSlide: n,
      };
    });
  }

  function resolveHomeBanners() {
    var remote = activeBanners();
    // CRITICAL: admin SoT wins whenever any published banner exists.
    // Never replace real A/B/C with the preview pack (that made every slide look identical).
    if (remote.length > 0) return remote;
    // Empty admin list only: local/preview may show labeled demo pack; production stays empty.
    if (!isProductionHost()) return buildPreviewVerifySlides();
    return remote;
  }

  function isUsableBannerImage(img) {
    if (!img || !img.naturalWidth || !img.naturalHeight) return false;
    // Staging sometimes publishes a 48×48 pink stub (≈100 bytes) that still HTTP 200s.
    return img.naturalWidth >= 200 && img.naturalHeight >= 80;
  }

  function useBrandBannerAsset(img, reason) {
    if (!img || img.dataset.brandFallback === "1") return;
    img.dataset.brandFallback = "1";
    img.classList.remove("mcj-hero-image-missing");
    img.style.background = "";
    img.alt = "妙脆角电竞";
    img.src = BRAND_BANNER_ASSET;
    if (reason) img.dataset.bannerFallbackReason = reason;
  }

  function wireBannerImageFallback(root) {
    if (!root) return;
    root.querySelectorAll("img.mcj-hero-image").forEach(function (img) {
      if (img.dataset.fallbackBound === "1") return;
      img.dataset.fallbackBound = "1";
      function ensureRealArt() {
        if (isUsableBannerImage(img)) return;
        useBrandBannerAsset(img, img.naturalWidth ? "tiny-stub" : "empty");
      }
      img.addEventListener("error", function onBannerError() {
        img.removeEventListener("error", onBannerError);
        useBrandBannerAsset(img, "load-error");
      });
      if (img.complete) ensureRealArt();
      else img.addEventListener("load", ensureRealArt, { once: true });
      // Late decode / cached stub: re-check shortly after bind.
      setTimeout(ensureRealArt, 0);
      setTimeout(ensureRealArt, 300);
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
    root.style.setProperty("--hero-index", String(index));
    root.style.setProperty("--hero-count", String(total));
    var track = root.querySelector(".mcj-hero-slides");
    if (track && (root.classList.contains("mcj-home-hero--promo") || root.querySelector(".mcj-hero-viewport"))) {
      // Full-width slides (Linglu); peek optional via CSS var default 0.
      track.style.transform =
        "translate3d(calc(-1 * var(--hero-index, 0) * (100% - var(--hero-peek, 0px))), 0, 0)";
    }
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
    root.classList.add("is-empty");
    root.dataset.heroIndex = "0";
    root.removeAttribute("data-banner-id");
    applyVars(root, data || normalized({}), device || "desktop");
    root.innerHTML = emptyHeroHtml();
    slideCache.set(root, {
      signature: "empty",
      banners: [],
      normalized: [],
      device: device || "desktop",
      index: 0,
    });
    return null;
  }

  function render(target, config, options) {
    var root = typeof target === "string" ? document.querySelector(target) : target;
    if (!root) return null;
    clearGeneratedHeroExtras();
    var banners = Array.isArray(config) ? config : config ? [config] : resolveHomeBanners();
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
    root.dataset.autoplayMs = String(AUTOPLAY_MS);
    root.dataset.slideCount = String(banners.length);
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
    setActiveSlide(root, current);
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
          render(root, cached.banners && cached.banners.length ? cached.banners : resolveHomeBanners(), {
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

    function start() {
      var timer = timers.get(root);
      if (timer) clearInterval(timer);
      if (banners.length <= 1) return;
      timer = setInterval(function () {
        var index = Number(root.dataset.heroIndex || 0) + 1;
        goTo(root, banners, device, index);
      }, AUTOPLAY_MS);
      timers.set(root, timer);
    }

    function pause() {
      var timer = timers.get(root);
      if (timer) clearInterval(timer);
    }

    root.onmouseenter = function () {
      pause();
    };
    root.onmouseleave = function () {
      start();
    };
    root.onclick = function (event) {
      var dot = event.target.closest("[data-hero-dot]");
      if (!dot) return;
      event.preventDefault();
      goTo(root, banners, device, Number(dot.dataset.heroDot));
      start();
    };

    var viewport = root.querySelector("[data-hero-viewport], .mcj-hero-viewport");
    if (viewport && banners.length > 1) {
      var track = root.querySelector(".mcj-hero-slides");
      var drag = touchState.get(root) || {};
      touchState.set(root, drag);

      function point(event) {
        if (event.touches && event.touches[0]) return event.touches[0];
        if (event.changedTouches && event.changedTouches[0]) return event.changedTouches[0];
        return event;
      }

      function frameWidth() {
        return Math.max(1, (viewport && viewport.clientWidth) || root.clientWidth || 1);
      }

      function onDown(event) {
        if (event.pointerType === "mouse" && event.button != null && event.button !== 0) return;
        var pt = point(event);
        drag.active = true;
        drag.startX = pt.clientX;
        drag.startY = pt.clientY;
        drag.baseIndex = Number(root.dataset.heroIndex || 0);
        drag.axis = null;
        drag.moved = false;
        pause();
        if (track) {
          track.classList.add("is-dragging");
          track.style.transition = "none";
        }
        if (viewport.setPointerCapture && event.pointerId != null) {
          try {
            viewport.setPointerCapture(event.pointerId);
          } catch (e) {}
        }
      }

      function onMove(event) {
        if (!drag.active || !track) return;
        var pt = point(event);
        var dx = pt.clientX - drag.startX;
        var dy = pt.clientY - drag.startY;
        if (drag.axis == null) {
          if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
          drag.axis = Math.abs(dx) > Math.abs(dy) ? "h" : "v";
          if (drag.axis === "v") return;
        }
        if (drag.axis !== "h") return;
        drag.moved = true;
        if (event.cancelable) event.preventDefault();
        var offset = -drag.baseIndex * frameWidth() + dx;
        track.style.transform = "translate3d(" + offset + "px, 0, 0)";
      }

      function onUp(event) {
        if (!drag.active) return;
        drag.active = false;
        var pt = point(event);
        var dx = pt.clientX - drag.startX;
        if (track) {
          track.classList.remove("is-dragging");
          track.style.transition = "";
        }
        var index = drag.baseIndex;
        if (drag.axis === "h" && Math.abs(dx) >= Math.min(42, frameWidth() * 0.16)) {
          index = dx < 0 ? drag.baseIndex + 1 : drag.baseIndex - 1;
        }
        goTo(root, banners, device, index);
        start();
        drag.axis = null;
        drag.moved = false;
      }

      // Prefer pointer events (Safari iOS + desktop Playwright drag).
      viewport.onpointerdown = onDown;
      viewport.onpointermove = onMove;
      viewport.onpointerup = onUp;
      viewport.onpointercancel = onUp;
      // Fallback touch path for older WebKit without PointerEvent.
      if (!window.PointerEvent) {
        viewport.ontouchstart = onDown;
        viewport.ontouchmove = onMove;
        viewport.ontouchend = onUp;
      } else {
        viewport.ontouchstart = null;
        viewport.ontouchmove = null;
        viewport.ontouchend = null;
      }
    }

    root.ontouchstart = null;
    root.ontouchend = null;
    start();
  }

  function applyHome() {
    var root =
      document.querySelector("[data-mcj-home-hero]") ||
      document.querySelector(".mcj-home-hero") ||
      document.querySelector(".banner");
    if (root && remoteLoaded) render(root, resolveHomeBanners());
    loadRemoteContent(function () {
      var current =
        document.querySelector("[data-mcj-home-hero]") ||
        document.querySelector(".mcj-home-hero") ||
        document.querySelector(".banner");
      if (current) render(current, resolveHomeBanners());
    });
  }

  window.MCJHomeBanner = {
    readStore: readStore,
    publishedBanner: publishedBanner,
    activeBanners: activeBanners,
    resolveHomeBanners: resolveHomeBanners,
    defaults: normalized,
    render: render,
    applyHome: applyHome,
    reload: applyHome,
    AUTOPLAY_MS: AUTOPLAY_MS,
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
