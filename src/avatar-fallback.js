/**
 * Global companion/image avatar fallback — no blue broken-image icons.
 * Default: /default-avatar.png (public/)
 */
(function () {
  "use strict";
  if (window.__MCJAvatarFallback) return;
  window.__MCJAvatarFallback = true;

  var DEFAULT = "/default-avatar.png";
  window.MCJ_DEFAULT_AVATAR = DEFAULT;

  function isBrandLogo(img) {
    if (!img || img.tagName !== "IMG") return false;
    if (img.getAttribute("data-mcj-brand-logo") === "1") return true;
    if (img.classList && img.classList.contains("mcj-header-brand-logo")) return true;
    if (typeof img.closest === "function" && img.closest(".mcj-header-brand")) return true;
    return false;
  }

  function isProductCover(img) {
    if (!img || img.tagName !== "IMG") return false;
    if (img.getAttribute("data-mcj-product-cover") === "1") return true;
    if (img.classList && img.classList.contains("gameplay-product-cover-img")) return true;
    if (typeof img.closest === "function" && img.closest(".gameplay-product-cover")) return true;
    return false;
  }

  /** Payment / admin QR previews must never be replaced by default avatar. */
  function isPayQr(img) {
    if (!img || img.tagName !== "IMG") return false;
    if (img.getAttribute("data-mcj-pay-qr") === "1") return true;
    if (img.getAttribute("data-banner-crop-img") != null) return false;
    var alt = String(img.getAttribute("alt") || "");
    if (/收款二维码|平台收款|支付.*二维码|DuitNow|pay.?qr/i.test(alt)) return true;
    if (typeof img.closest === "function") {
      if (img.closest("[data-pay-qr], .pay-qr, .pay-qr-frame, .payment-qr-preview, [data-banner-live-preview]")) {
        return true;
      }
    }
    var src = String(img.getAttribute("src") || img.src || "");
    if (/\/platform-payment\/|\/storage\/v1\/object\/public\/.*qr\//i.test(src)) return true;
    return false;
  }

  /** Boss payment proof preview / CS lightbox — never swap to default avatar. */
  function isPaymentProof(img) {
    if (!img || img.tagName !== "IMG") return false;
    if (img.getAttribute("data-mcj-pay-proof") === "1") return true;
    var alt = String(img.getAttribute("alt") || "");
    if (/付款截图|付款凭证|payment.?proof/i.test(alt)) return true;
    if (typeof img.closest === "function" && img.closest(".pay-proof, .pay-proof-preview, [data-proof-panel], [data-proof-lightbox]")) {
      return true;
    }
    var src = String(img.getAttribute("src") || img.src || "");
    if (/companion-payment-proofs|payment-proofs/i.test(src)) return true;
    return false;
  }

  /** CS↔boss↔companion chat bubbles / lightbox — keep signed private Storage URLs. */
  function isChatImage(img) {
    if (!img || img.tagName !== "IMG") return false;
    if (img.getAttribute("data-mcj-chat-img") === "1") return true;
    if (img.getAttribute("data-mcj-img-resign") != null) return true;
    if (img.classList && img.classList.contains("mcj-chat-img")) return true;
    if (typeof img.closest === "function") {
      if (img.closest(".mcj-chat-img-wrap, [data-chat-image], .mcj-chat-lightbox, #mcjChatLightbox")) {
        return true;
      }
    }
    var src = String(img.getAttribute("src") || img.src || "");
    if (/\/storage\/v1\/object\/sign\/chat-images(?:-private)?\//i.test(src)) return true;
    if (/chat-images-private\//i.test(src)) return true;
    return false;
  }

  function shouldSkip(img) {
    return isBrandLogo(img) || isProductCover(img) || isPayQr(img) || isPaymentProof(img) || isChatImage(img);
  }

  function isBadUrl(src) {
    var s = String(src == null ? "" : src).trim();
    if (!s || s === "#" || s === "null" || s === "undefined" || s === "-") return true;
    if (/^(blob:|filesystem:|file:)/i.test(s)) return true;
    if (/^data:/i.test(s)) return true;
    if (/^(https?:\/\/)?(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?\b/i.test(s)) return true;
    // Brand mark is a real asset for header/logo — do NOT treat as bad placeholder here.
    // Companion cards that misuse brand as avatar are handled elsewhere.
    // NOTE: do NOT treat /storage/.../sign/ URLs as bad — private chat images use signed URLs.
    return false;
  }

  function resolve(src) {
    return isBadUrl(src) ? DEFAULT : String(src).trim();
  }

  window.MCJAvatar = {
    DEFAULT: DEFAULT,
    resolve: resolve,
    isBadUrl: isBadUrl,
  };

  function applyFallback(img, reason) {
    if (!img || img.tagName !== "IMG") return;
    if (shouldSkip(img)) return;
    if (img.getAttribute("data-mcj-avatar-fb") === "1") return;
    var cur = img.currentSrc || img.getAttribute("src") || img.src || "";
    if (cur.indexOf("default-avatar.png") !== -1 || cur.indexOf("default-companion-avatar") !== -1) {
      img.setAttribute("data-mcj-avatar-fb", "1");
      return;
    }
    img.setAttribute("data-mcj-avatar-fb", "1");
    img.onerror = null;
    img.removeAttribute("srcset");
    try {
      console.warn("[MCJAvatar] media fallback", reason || "error", cur);
    } catch (_) {}
    img.src = DEFAULT;
  }

  function isTinyDecoded(img) {
    if (!img || !img.complete) return false;
    var w = Number(img.naturalWidth || 0);
    var h = Number(img.naturalHeight || 0);
    // 1x1 / 2x2 e2e placeholders stretch into solid color blocks (often look red/pink).
    return w > 0 && h > 0 && w <= 2 && h <= 2;
  }

  // Capture phase: any broken <img> → default avatar (kills blue ?)
  document.addEventListener(
    "error",
    function (e) {
      var t = e.target;
      if (!t || t.tagName !== "IMG") return;
      if (shouldSkip(t)) return;
      applyFallback(t, "load-error");
    },
    true
  );

  document.addEventListener(
    "load",
    function (e) {
      var t = e.target;
      if (!t || t.tagName !== "IMG") return;
      if (shouldSkip(t)) return;
      if (isTinyDecoded(t)) applyFallback(t, "tiny-decoded-image");
    },
    true
  );

  function scanBroken(root) {
    var list = (root || document).querySelectorAll ? (root || document).querySelectorAll("img") : [];
    for (var i = 0; i < list.length; i++) {
      var img = list[i];
      if (shouldSkip(img)) continue;
      var src = img.getAttribute("src") || "";
      if (isBadUrl(src)) {
        applyFallback(img, "bad-url");
        continue;
      }
      if (img.complete && img.naturalWidth === 0 && src) {
        applyFallback(img, "zero-natural-width");
        continue;
      }
      if (isTinyDecoded(img)) {
        applyFallback(img, "tiny-decoded-image");
      }
    }
  }

  function boot() {
    scanBroken(document);
    if (window.MutationObserver) {
      var mo = new MutationObserver(function (mutations) {
        for (var i = 0; i < mutations.length; i++) {
          var nodes = mutations[i].addedNodes;
          for (var j = 0; j < nodes.length; j++) {
            var n = nodes[j];
            if (!n || n.nodeType !== 1) continue;
            if (n.tagName === "IMG") {
              if (shouldSkip(n)) continue;
              if (isBadUrl(n.getAttribute("src"))) applyFallback(n);
              else if (n.complete && n.naturalWidth === 0) applyFallback(n);
            } else if (n.querySelectorAll) {
              scanBroken(n);
            }
          }
        }
      });
      mo.observe(document.documentElement, { childList: true, subtree: true });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
  // Late paint (async card render)
  setTimeout(function () {
    scanBroken(document);
  }, 1500);
  setTimeout(function () {
    scanBroken(document);
  }, 4000);
})();
