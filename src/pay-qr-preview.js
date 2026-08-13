/**
 * Shared QR Code Preview Lightbox for all payment QR images.
 * Usage:
 *   - Markup: McjPayQrPreview.frameHtml(src, alt)
 *   - Or mark any QR: <div class="pay-qr-frame" data-pay-qr-zoom="1">…<img data-mcj-pay-qr>…
 *   - Auto-installs click / keyboard / touch handlers once loaded.
 */
(function (global) {
  "use strict";

  var LIGHTBOX_ID = "payQrLightbox";
  var STYLE_ID = "mcj-pay-qr-preview-css";
  var installed = false;
  var scrollLockY = 0;

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    // Prefer linked stylesheet when pages already include it; otherwise inject a minimal fallback.
    var link = document.querySelector('link[href*="pay-qr-preview.css"]');
    if (link) return;
    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent =
      ".pay-qr-frame[data-pay-qr-zoom],.pay-qr-frame[data-pay-qr-zoom] img,img[data-mcj-pay-qr]{cursor:zoom-in;-webkit-tap-highlight-color:transparent;touch-action:manipulation}" +
      ".pay-qr-lightbox{position:fixed;inset:0;z-index:99999;display:none;align-items:center;justify-content:center;background:rgba(0,0,0,.88);padding:max(16px,env(safe-area-inset-top)) max(16px,env(safe-area-inset-right)) max(16px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left));box-sizing:border-box;overscroll-behavior:contain}" +
      ".pay-qr-lightbox.is-open{display:flex}" +
      ".pay-qr-lightbox[hidden]{display:none!important}" +
      ".pay-qr-lightbox.is-open[hidden]{display:flex!important}" +
      ".pay-qr-lightbox-panel{position:relative;width:min(92vw,560px);max-width:100%;max-height:min(92vh,92dvh);display:grid;gap:12px;justify-items:center;align-content:center;box-sizing:border-box}" +
      ".pay-qr-lightbox-panel img{width:min(86vw,520px);max-width:100%;height:auto;max-height:min(78vh,78dvh);object-fit:contain;background:#fff;border-radius:12px;padding:12px;box-sizing:border-box;pointer-events:none;user-select:none}" +
      ".pay-qr-lightbox-close{position:absolute;top:-10px;right:-10px;width:44px;height:44px;border:0;border-radius:999px;background:#fff;color:#1b0712;font-size:22px;font-weight:800;line-height:1;cursor:pointer;box-shadow:0 8px 24px rgba(0,0,0,.35);z-index:2;touch-action:manipulation}" +
      ".pay-qr-lightbox-hint{margin:0;color:#c4b5c0;font-size:13px;text-align:center}";
    document.head.appendChild(style);
  }

  function lockScroll() {
    try {
      scrollLockY = window.scrollY || window.pageYOffset || 0;
      document.documentElement.style.overflow = "hidden";
      document.body.style.overflow = "hidden";
      document.body.style.position = "fixed";
      document.body.style.top = "-" + scrollLockY + "px";
      document.body.style.left = "0";
      document.body.style.right = "0";
      document.body.style.width = "100%";
    } catch (e) {}
  }

  function unlockScroll() {
    try {
      document.documentElement.style.overflow = "";
      document.body.style.overflow = "";
      document.body.style.position = "";
      document.body.style.top = "";
      document.body.style.left = "";
      document.body.style.right = "";
      document.body.style.width = "";
      if (scrollLockY) window.scrollTo(0, scrollLockY);
      scrollLockY = 0;
    } catch (e) {}
  }

  function ensureLightbox() {
    ensureStyles();
    var box = document.getElementById(LIGHTBOX_ID);
    if (box) return box;
    box = document.createElement("div");
    box.id = LIGHTBOX_ID;
    box.className = "pay-qr-lightbox";
    box.setAttribute("hidden", "");
    box.setAttribute("aria-hidden", "true");
    box.innerHTML =
      '<div class="pay-qr-lightbox-panel" role="dialog" aria-modal="true" aria-label="收款二维码放大预览">' +
      '<button type="button" class="pay-qr-lightbox-close" data-pay-qr-close aria-label="关闭">×</button>' +
      '<img alt="收款二维码大图" data-pay-qr-lightbox-img="1" referrerpolicy="no-referrer" draggable="false">' +
      '<p class="pay-qr-lightbox-hint">点击遮罩或关闭按钮可关闭</p>' +
      "</div>";
    document.body.appendChild(box);
    box.addEventListener(
      "click",
      function (e) {
        if (e.target === box || (e.target && e.target.closest && e.target.closest("[data-pay-qr-close]"))) {
          e.preventDefault();
          e.stopPropagation();
          close();
        }
      },
      true
    );
    // Touch-friendly close on backdrop (some mobile browsers delay click).
    box.addEventListener(
      "touchend",
      function (e) {
        if (e.target === box || (e.target && e.target.closest && e.target.closest("[data-pay-qr-close]"))) {
          e.preventDefault();
          close();
        }
      },
      { passive: false }
    );
    return box;
  }

  function open(src) {
    var url = String(src || "").trim();
    if (!url) return false;
    var box = ensureLightbox();
    var img = box.querySelector("[data-pay-qr-lightbox-img]");
    if (img) {
      img.removeAttribute("src");
      img.src = url;
    }
    box.classList.add("is-open");
    box.removeAttribute("hidden");
    box.setAttribute("aria-hidden", "false");
    lockScroll();
    try {
      var closeBtn = box.querySelector("[data-pay-qr-close]");
      if (closeBtn) closeBtn.focus({ preventScroll: true });
    } catch (e) {}
    return true;
  }

  function close() {
    var box = document.getElementById(LIGHTBOX_ID);
    if (!box) return;
    box.classList.remove("is-open");
    box.setAttribute("hidden", "");
    box.setAttribute("aria-hidden", "true");
    unlockScroll();
  }

  function isOpen() {
    var box = document.getElementById(LIGHTBOX_ID);
    return !!(box && box.classList.contains("is-open"));
  }

  /**
   * Standard clickable QR frame HTML for any payment channel.
   */
  function frameHtml(src, alt) {
    var url = String(src || "").trim();
    if (!url) return "";
    return (
      '<div class="pay-qr-frame" data-pay-qr-zoom="1" role="button" tabindex="0" aria-label="点击放大收款二维码">' +
      '<img src="' +
      esc(url) +
      '" alt="' +
      esc(alt || "收款二维码") +
      '" data-mcj-pay-qr="1" data-pay-qr-img="1" referrerpolicy="no-referrer" draggable="false">' +
      "</div>"
    );
  }

  function resolveZoomTarget(el) {
    if (!el || !el.closest) return null;
    // Prefer explicit zoom frame; also allow bare pay QR images.
    var zoom = el.closest("[data-pay-qr-zoom], [data-mcj-pay-qr], [data-pay-qr-img]");
    if (!zoom) return null;
    // Ignore images already inside the lightbox.
    if (zoom.closest && zoom.closest("#" + LIGHTBOX_ID + ", .pay-qr-lightbox")) return null;
    // Admin proof thumbs sometimes reuse data-mcj-pay-qr — only zoom payment QR frames / pay blocks.
    if (zoom.tagName === "IMG" && zoom.getAttribute("data-mcj-pay-qr") === "1") {
      if (
        !zoom.closest(
          ".pay-qr-frame, [data-pay-qr], .pay-qr, .pay-qr-block, .pw-deposit-qr-block, .payment-qr-preview"
        )
      ) {
        return null;
      }
    }
    return zoom;
  }

  function srcFromZoom(zoom) {
    if (!zoom) return "";
    var img = zoom.tagName === "IMG" ? zoom : zoom.querySelector("img[data-mcj-pay-qr], img[data-pay-qr-img], img");
    return (img && (img.currentSrc || img.src)) || "";
  }

  function onActivate(e) {
    var zoom = resolveZoomTarget(e.target);
    if (!zoom) return;
    var src = srcFromZoom(zoom);
    if (!src) return;
    e.preventDefault();
    e.stopPropagation();
    open(src);
  }

  function install() {
    if (installed) return api;
    installed = true;
    ensureStyles();
    document.addEventListener("click", onActivate, false);
    document.addEventListener(
      "keydown",
      function (e) {
        if (e.key === "Escape" && isOpen()) {
          e.preventDefault();
          close();
          return;
        }
        if (e.key !== "Enter" && e.key !== " ") return;
        var zoom = resolveZoomTarget(e.target);
        if (!zoom || zoom.tagName === "IMG") return;
        if (!zoom.hasAttribute("data-pay-qr-zoom")) return;
        e.preventDefault();
        open(srcFromZoom(zoom));
      },
      false
    );
    return api;
  }

  var api = {
    open: open,
    close: close,
    isOpen: isOpen,
    frameHtml: frameHtml,
    install: install,
    ensureLightbox: ensureLightbox,
  };

  global.McjPayQrPreview = api;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", install);
  } else {
    install();
  }
})(typeof window !== "undefined" ? window : globalThis);
