/**
 * Client-side companion media URL helpers — mirrors server/_companion-public-map.js
 */
(function (global) {
  "use strict";

  var DEFAULT_AVATAR = "/default-avatar.png";
  var DEFAULT_COVER = "/default-avatar.png";

  function isUnstableMediaUrl(value) {
    var s = String(value == null ? "" : value).trim();
    if (!s || s === "#" || s === "-" || s === "null" || s === "undefined") return true;
    if (/^(blob:|filesystem:|file:)/i.test(s)) return true;
    if (/^data:/i.test(s)) return true;
    if (/^(https?:\/\/)?(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?\b/i.test(s)) return true;
    if (/meow-cuijiao-brand\.(jpe?g|png|webp)$/i.test(s)) return true;
    if (/^assets\/meow-cuijiao-brand/i.test(s)) return true;
    if (/\/storage\/v1\/object\/sign\//i.test(s)) return true;
    if (/[?&]token=/i.test(s) && /\/storage\/v1\//i.test(s)) return true;
    if (/\/default-avatar\.png(?:$|\?)/i.test(s)) return true;
    if (/\/default-companion-avatar\./i.test(s)) return true;
    return false;
  }

  function pickStableMediaUrl() {
    for (var i = 0; i < arguments.length; i++) {
      var s = String(arguments[i] == null ? "" : arguments[i]).trim();
      if (!s || isUnstableMediaUrl(s)) continue;
      if (!/^https?:\/\//i.test(s) && s.charAt(0) !== "/") continue;
      return s;
    }
    return "";
  }

  function resolveAvatar(item) {
    item = item || {};
    return (
      pickStableMediaUrl(
        item.avatar,
        item.avatarUrl,
        item.avatar_url,
        item.cover,
        item.cardImageUrl,
        item.card_image_url,
        item.image
      ) || DEFAULT_AVATAR
    );
  }

  function resolveCover(item) {
    item = item || {};
    return (
      pickStableMediaUrl(
        item.cover,
        item.cardImageUrl,
        item.card_image_url,
        item.cardCover,
        item.avatar,
        item.avatarUrl,
        item.avatar_url,
        item.image
      ) || DEFAULT_COVER
    );
  }

  function normalizePublicCompanion(item) {
    item = item || {};
    var avatar = resolveAvatar(item);
    var cover = resolveCover(item);
    return Object.assign({}, item, {
      avatar: avatar,
      cover: cover,
      cardImageUrl: pickStableMediaUrl(item.cardImageUrl, item.card_image_url, cover) || "",
      image: cover || avatar,
    });
  }

  function bindImgFallback(img, fallback) {
    if (!img || img.tagName !== "IMG") return;
    var fb = fallback || DEFAULT_AVATAR;
    img.addEventListener(
      "error",
      function () {
        if (img.getAttribute("data-mcj-media-fb") === "1") return;
        img.setAttribute("data-mcj-media-fb", "1");
        console.warn("[MCJCompanionMedia] image load failed", img.currentSrc || img.src);
        img.src = fb;
      },
      { once: true }
    );
  }

  global.MCJCompanionMedia = {
    DEFAULT_AVATAR: DEFAULT_AVATAR,
    DEFAULT_COVER: DEFAULT_COVER,
    isUnstableMediaUrl: isUnstableMediaUrl,
    pickStableMediaUrl: pickStableMediaUrl,
    resolveAvatar: resolveAvatar,
    resolveCover: resolveCover,
    normalizePublicCompanion: normalizePublicCompanion,
    bindImgFallback: bindImgFallback,
  };
})(typeof window !== "undefined" ? window : globalThis);
