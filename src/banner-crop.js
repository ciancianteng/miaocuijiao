/**
 * Shared Banner crop math — admin editor and homepage MUST use the same model:
 *   zoom >= 1  (cover multiplier; 1 = exact cover)
 *   x, y in [-1.5, 1.5]  (pan as fraction of frame width / height)
 * Render: size = coverBase * zoom; transform translate(calc(-50% + x*fw), calc(-50% + y*fh))
 */
(function (root) {
  "use strict";

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
    // Legacy admin saved raw pixel pans (±400). Convert once into frame fractions.
    if (Math.abs(x) > 2 || Math.abs(y) > 2) {
      x = clamp(x / 640, -1.5, 1.5, 0);
      y = clamp(y / 360, -1.5, 1.5, 0);
    }
    return {
      zoom: zoom,
      scale: zoom,
      x: x,
      y: y,
      offsetX: x,
      offsetY: y,
      ratioW: clamp(raw.ratioW || raw.ratio_w || defaults.ratioW, 320, 4096, defaults.ratioW),
      ratioH: clamp(raw.ratioH || raw.ratio_h || defaults.ratioH, 120, 2160, defaults.ratioH),
      ratio:
        String(raw.ratio || "") ||
        Math.round(clamp(raw.ratioW || raw.ratio_w || defaults.ratioW, 320, 4096, defaults.ratioW)) +
          ":" +
          Math.round(clamp(raw.ratioH || raw.ratio_h || defaults.ratioH, 120, 2160, defaults.ratioH)),
    };
  }

  function coverBaseSize(natW, natH, frameW, frameH) {
    var imgRatio = natW / Math.max(1, natH);
    var frameRatio = frameW / Math.max(1, frameH);
    if (imgRatio > frameRatio) return { w: frameH * imgRatio, h: frameH };
    return { w: frameW, h: frameW / Math.max(0.0001, imgRatio) };
  }

  function applyCropToImg(img, frame, crop) {
    if (!img || !frame) return null;
    var natW = img.naturalWidth || 0;
    var natH = img.naturalHeight || 0;
    if (!natW || !natH) return null;
    var fw = Math.max(1, frame.clientWidth || frame.offsetWidth || 1);
    var fh = Math.max(1, frame.clientHeight || frame.offsetHeight || 1);
    var c = normalizeCrop(crop);
    if (c.zoom < 1) c.zoom = 1;
    var base = coverBaseSize(natW, natH, fw, fh);
    var w = base.w * c.zoom;
    var h = base.h * c.zoom;
    img.style.setProperty("position", "absolute", "important");
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
    img.style.setProperty("transform-origin", "center center", "important");
    img.setAttribute("data-crop-ready", "1");
    if (Math.abs(c.x) < 0.01 && Math.abs(c.y) < 0.01 && Math.abs(c.zoom - 1) < 0.02) {
      img.setAttribute("data-crop-plain", "1");
    } else {
      img.removeAttribute("data-crop-plain");
    }
    return c;
  }

  function objectPositionFromCrop(crop) {
    var c = normalizeCrop(crop);
    return 50 + c.x * 50 + "% " + (50 + c.y * 50) + "%";
  }

  root.MCJBannerCrop = {
    clamp: clamp,
    normalizeCrop: normalizeCrop,
    coverBaseSize: coverBaseSize,
    applyCropToImg: applyCropToImg,
    objectPositionFromCrop: objectPositionFromCrop,
  };
})(typeof window !== "undefined" ? window : globalThis);
