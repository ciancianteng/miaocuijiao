/**
 * Homepage overlay safety net (P0).
 * Clears stuck full-screen dark masks / scroll locks that appear after async
 * init without a usable dialog (forced-ack, modal, mnav, place-order, etc.).
 */
(function () {
  "use strict";
  if (window.__MCJHomeOverlayGuard) return;
  window.__MCJHomeOverlayGuard = true;

  var SELECTORS = [
    "[data-pw-forced-mask]",
    ".pw-forced-mask",
    ".mcj-po-mask",
    "[data-mcj-po-mask]",
    "#modal.open",
    ".modal.open",
    ".home-announcement-modal:not([hidden])",
    ".home-club-levels-modal:not([hidden])",
    "#mcjCoopModal.show",
    ".mcj-modal.show",
    ".mcj-mnav-sheet.open",
    "[data-mcj-mnav-sheet].open",
  ];

  function viewportSize() {
    var vv = window.visualViewport;
    return {
      w: (vv && vv.width) || window.innerWidth || document.documentElement.clientWidth || 0,
      h: (vv && vv.height) || window.innerHeight || document.documentElement.clientHeight || 0,
    };
  }

  function hasUsableDialog(root) {
    if (!root) return false;
    var dialog = root.querySelector(
      '[role="dialog"], .dialog, .pw-forced-modal, .mcj-po-dialog, .home-announcement-dialog, .home-club-levels-dialog, .mcj-modal-box, .mcj-mnav-drawer, .boss-login-modal'
    );
    // A bare full-screen mask with no dialog child is stuck — not usable.
    if (!dialog) return false;
    var r = dialog.getBoundingClientRect();
    var vp = viewportSize();
    if (r.width < 80 || r.height < 40) return false;
    // Forced-ack / modals must be inside the *visual* viewport (Safari URL bar safe).
    if (r.bottom < 24 || r.top > vp.h - 24) return false;
    if (r.right < 24 || r.left > vp.w - 24) return false;
    var s = window.getComputedStyle(dialog);
    if (s.display === "none" || s.visibility === "hidden" || parseFloat(s.opacity || "1") < 0.05) return false;
    return true;
  }

  function isDarkCover(el) {
    if (!el || el === document.body || el === document.documentElement) return false;
    var s = window.getComputedStyle(el);
    if (s.position !== "fixed" && s.position !== "absolute") return false;
    if (s.display === "none" || s.visibility === "hidden" || parseFloat(s.opacity || "1") < 0.05) return false;
    if (s.pointerEvents === "none") return false;
    var r = el.getBoundingClientRect();
    if (r.width < window.innerWidth * 0.85 || r.height < window.innerHeight * 0.7) return false;
    var bg = s.backgroundColor || "";
    var m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([0-9.]+))?\)/.exec(bg);
    if (!m) return false;
    var a = m[4] === undefined ? 1 : parseFloat(m[4]);
    return Number(m[1]) < 50 && Number(m[2]) < 50 && Number(m[3]) < 50 && a > 0.2;
  }

  function unlockScroll() {
    try {
      if (window.MCJModal && typeof window.MCJModal.unlockBodyScroll === "function") {
        window.MCJModal.unlockBodyScroll();
      }
    } catch (e) {}
    document.documentElement.classList.remove(
      "mcj-modal-open",
      "mcj-mnav-open",
      "pw-forced-open",
      "mcj-floating-cs-lock",
      "action-modal-open"
    );
    document.body.classList.remove(
      "mcj-modal-open",
      "mcj-mnav-open",
      "pw-forced-open",
      "mcj-floating-cs-lock",
      "action-modal-open"
    );
    document.documentElement.style.overflow = "";
    document.body.style.overflow = "";
    document.body.style.position = "";
    document.body.style.top = "";
    document.body.style.left = "";
    document.body.style.right = "";
    document.body.style.width = "";
    delete document.documentElement.dataset.mcjPoScrollLocked;
    delete document.documentElement.dataset.mcjPoScrollY;
  }

  function clearStuck(el) {
    if (!el) return;
    if (el.id === "modal" || el.classList.contains("modal")) {
      el.classList.remove("open");
      el.setAttribute("aria-hidden", "true");
      return;
    }
    if (el.classList.contains("mcj-mnav-sheet") || el.hasAttribute("data-mcj-mnav-sheet")) {
      el.hidden = true;
      el.classList.remove("open");
      var wrap = document.querySelector(".mcj-mnav");
      if (wrap) wrap.classList.remove("open");
      return;
    }
    if (el.classList.contains("home-announcement-modal") || el.classList.contains("home-club-levels-modal")) {
      el.hidden = true;
      return;
    }
    if (el.id === "mcjCoopModal" || el.classList.contains("mcj-modal")) {
      el.classList.remove("show");
      el.setAttribute("aria-hidden", "true");
      return;
    }
    try {
      el.remove();
    } catch (e) {
      el.style.display = "none";
      el.style.pointerEvents = "none";
    }
  }

  function sweep() {
    if (!document.body) return;
    var cleaned = false;

    SELECTORS.forEach(function (sel) {
      document.querySelectorAll(sel).forEach(function (el) {
        if (hasUsableDialog(el)) return;
        // Allow intentional empty login dialog only if auth form is present.
        if ((el.id === "modal" || el.classList.contains("modal")) && el.querySelector(".boss-login-modal, [data-login-confirm]")) {
          if (hasUsableDialog(el.querySelector(".dialog") || el)) return;
        }
        clearStuck(el);
        cleaned = true;
      });
    });

    // Catch unknown full-screen dark covers without a dialog.
    [...document.querySelectorAll("body *")].forEach(function (el) {
      if (!isDarkCover(el)) return;
      if (hasUsableDialog(el)) return;
      // Ignore ambient / decorative layers.
      if (el.closest(".ambient-layer, .paw-float-layer, .mcj-home-hero, header, footer, nav")) return;
      clearStuck(el);
      cleaned = true;
    });

    var scrollLocked =
      document.body.classList.contains("mcj-modal-open") ||
      document.body.classList.contains("mcj-mnav-open") ||
      document.body.classList.contains("pw-forced-open") ||
      document.documentElement.classList.contains("mcj-modal-open") ||
      document.documentElement.classList.contains("mcj-mnav-open") ||
      document.documentElement.classList.contains("pw-forced-open") ||
      document.body.style.overflow === "hidden" ||
      document.documentElement.style.overflow === "hidden" ||
      document.body.style.position === "fixed";

    var anyOpen = SELECTORS.some(function (sel) {
      return !!document.querySelector(sel);
    });

    // Never unlock while a usable forced-ack / modal is still open.
    var forcedOpen = !!document.querySelector("[data-pw-forced-mask]");
    var forcedOk = forcedOpen && hasUsableDialog(document.querySelector("[data-pw-forced-mask]"));

    if (forcedOk) {
      return cleaned;
    }

    if (scrollLocked && !anyOpen) {
      unlockScroll();
      cleaned = true;
    } else if (cleaned) {
      unlockScroll();
    }

    return cleaned;
  }

  function boot() {
    sweep();
    var ticks = 0;
    var timer = setInterval(function () {
      ticks += 1;
      sweep();
      // Watch first ~90s of page life (covers late async overlays).
      if (ticks >= 90) clearInterval(timer);
    }, 1000);
    window.addEventListener("load", function () {
      setTimeout(sweep, 0);
      setTimeout(sweep, 400);
      setTimeout(sweep, 1200);
      setTimeout(sweep, 3000);
    });
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) sweep();
    });
  }

  window.MCJHomeOverlayGuard = { sweep: sweep };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
