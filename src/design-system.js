/* mcj-design-system: visual-only icon normalization, ASCII-safe */
(function () {
  "use strict";

  var icons = {
    custom: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h4"/></svg>',
    more: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 5v14M5 12h14"/><path d="M7 3h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4z"/></svg>',
    hall: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 14h2m-1-1v2"/><path d="M15.5 14h.01M18 13h.01"/><path d="M6.5 9h11A4.5 4.5 0 0 1 22 13.5v1A4.5 4.5 0 0 1 17.5 19h-11A4.5 4.5 0 0 1 2 14.5v-1A4.5 4.5 0 0 1 6.5 9z"/></svg>',
    voice: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3a4 4 0 0 0-4 4v4a4 4 0 0 0 8 0V7a4 4 0 0 0-4-4z"/><path d="M5 10v1a7 7 0 0 0 14 0v-1"/><path d="M12 18v3M9 21h6"/></svg>',
    team: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M16 11a4 4 0 1 0-8 0"/><path d="M4 20a8 8 0 0 1 16 0"/><path d="M18 8a3 3 0 0 1 2.6 4.5M6 8a3 3 0 0 0-2.6 4.5"/></svg>',
    wallet: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M9.6 14.1c.9-1.7 1.5-2.4 2.4-2.4s1.5.7 2.4 2.4c.5.9.1 2-1 2-.7 0-1-.4-1.4-.4s-.7.4-1.4.4c-1.1 0-1.5-1.1-1-2z"/><circle cx="8.9" cy="10.9" r=".9" fill="currentColor" stroke="none"/><circle cx="11" cy="9.5" r=".9" fill="currentColor" stroke="none"/><circle cx="13" cy="9.5" r=".9" fill="currentColor" stroke="none"/><circle cx="15.1" cy="10.9" r=".9" fill="currentColor" stroke="none"/><path d="M17.4 5.6v2.4M16.2 6.8h2.4"/></svg>',
    activity: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20 12v8H4v-8"/><path d="M22 7H2v5h20z"/><path d="M12 7v13"/><path d="M12 7H8.5A2.5 2.5 0 1 1 11 4.5c0 1.5 1 2.5 1 2.5z"/><path d="M12 7h3.5A2.5 2.5 0 1 0 13 4.5c0 1.5-1 2.5-1 2.5z"/></svg>',
    user: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20 21a8 8 0 0 0-16 0"/><path d="M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10z"/></svg>',
    settings: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z"/><path d="M19.4 15a1.8 1.8 0 0 0 .36 1.98l.04.04a2.1 2.1 0 0 1-2.97 2.97l-.04-.04a1.8 1.8 0 0 0-1.98-.36 1.8 1.8 0 0 0-1.1 1.66V21a2.1 2.1 0 0 1-4.2 0v-.06a1.8 1.8 0 0 0-1.1-1.66 1.8 1.8 0 0 0-1.98.36l-.04.04a2.1 2.1 0 0 1-2.97-2.97l.04-.04A1.8 1.8 0 0 0 4.6 15a1.8 1.8 0 0 0-1.66-1.1H3a2.1 2.1 0 0 1 0-4.2h.06a1.8 1.8 0 0 0 1.66-1.1 1.8 1.8 0 0 0-.36-1.98l-.04-.04a2.1 2.1 0 0 1 2.97-2.97l.04.04A1.8 1.8 0 0 0 9 4.6a1.8 1.8 0 0 0 1.1-1.66V3a2.1 2.1 0 0 1 4.2 0v.06a1.8 1.8 0 0 0 1.1 1.66 1.8 1.8 0 0 0 1.98-.36l.04-.04a2.1 2.1 0 0 1 2.97 2.97l-.04.04A1.8 1.8 0 0 0 19.4 9c.3.66.95 1.1 1.66 1.1H21a2.1 2.1 0 0 1 0 4.2h-.06A1.8 1.8 0 0 0 19.4 15z"/></svg>',
    default: '<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3l2.4 5.1 5.6.7-4.1 3.8 1 5.5L12 15.4 7.1 18l1-5.5L4 8.8l5.6-.7z"/></svg>'
  };

  function pickIconKey(text) {
    if (/\u81ea\u5b9a\u4e49/.test(text)) return "custom";
    if (/\u66f4\u591a\u73a9\u6cd5|\u73a9\u6cd5/.test(text)) return "more";
    if (/\u966a\u73a9\u5927\u5385|\u966a\u73a9|\u62a2\u5355|\u6e38\u620f/.test(text)) return "hall";
    if (/\u8bed\u97f3|\u8bed\u804a|\u58f0\u97f3|\u6d88\u606f|\u804a\u5929|\u5ba2\u670d/.test(text)) return "voice";
    if (/\u7ec4\u961f|\u8f66\u961f|\u7528\u6237|\u8001\u677f|\u6211\u7684|\u8d44\u6599/.test(text)) return "team";
    if (/\u732b\u7cae|\u5145\u503c|\u94b1\u5305|\u55b5\u5e01|\u6536\u5165|\u63d0\u73b0|\u8d22\u52a1|\u652f\u4ed8/.test(text)) return "wallet";
    if (/\u6d3b\u52a8|\u516c\u544a|\u793c\u7269|\u5408\u4f5c/.test(text)) return "activity";
    if (/\u8bbe\u7f6e|\u7cfb\u7edf|\u7ba1\u7406/.test(text)) return "settings";
    if (/\u8ba2\u5355|\u5de5\u5355|\u7533\u8bf7|\u5ba1\u6838/.test(text)) return "custom";
    return "default";
  }

  function normalizeIconSlot(icon, key) {
    if (!icon || icon.dataset.mcjLineIcon === key) return;
    icon.classList.add("mcj-line-icon");
    icon.innerHTML = icons[key] || icons.default;
    icon.dataset.mcjLineIcon = key;
    icon.removeAttribute("style");
    icon.setAttribute("aria-hidden", "true");
  }

  function normalizeCards(root) {
    var scope = root || document;
    var cards = scope.querySelectorAll(".quick-entry-card, .feature-card, .entry-card, .metric-card, .stat-card, .service-card, .order-card, .mine-btn");
    cards.forEach(function (card) {
      var icon = card.querySelector("i, .feature-icon, .quick-icon, .stat-icon, .service-icon, .entry-icon");
      if (card.matches(".quick-entry-card")) return;
      if (!icon) return;
      normalizeIconSlot(icon, pickIconKey(card.textContent || ""));
    });
  }

  function normalizeEmojiButtons(root) {
    var scope = root || document;
    var targets = scope.querySelectorAll("button, a.btn, a.mcj-btn, .primary-btn, .ghost-btn, .mini-btn");
    targets.forEach(function (el) {
      // Never rewrite mobile menu toggle (☰) — design-system was injecting a star SVG into it.
      if (el.matches(".mcj-mnav-toggle, [data-mcj-mnav-toggle]") || el.closest(".mcj-mnav")) return;
      if (el.querySelector("svg, img, .mcj-line-icon")) return;
      var text = (el.textContent || "").trim();
      // Skip pure menu glyphs (☰ U+2630 is inside \u2600-\u27ff).
      if (/^[☰≡☰\u2630\u2261]+$/.test(text)) return;
      if (!/^[\u2600-\u27ff\ud83c-\udfff]/.test(text)) return;
      var key = pickIconKey(text);
      var clean = text.replace(/^[\u2600-\u27ff\ud83c-\udfff]\s*/u, "");
      el.textContent = clean || text;
      var slot = document.createElement("span");
      slot.className = "mcj-inline-icon mcj-line-icon";
      normalizeIconSlot(slot, key);
      el.insertBefore(slot, el.firstChild);
    });
  }

  function init() {
    try {
      var cores = Number(navigator.hardwareConcurrency || 8);
      var mem = Number(navigator.deviceMemory || 8);
      var saveData = !!(navigator.connection && navigator.connection.saveData);
      if (cores <= 4 || mem <= 4 || saveData || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        document.documentElement.classList.add("mcj-low-perf");
      }
    } catch (e) {}
    normalizeCards(document);
    normalizeEmojiButtons(document);
    window.setTimeout(function () { normalizeCards(document); normalizeEmojiButtons(document); }, 120);
    window.setTimeout(function () { normalizeCards(document); normalizeEmojiButtons(document); }, 500);

    (function loadBossHeader() {
      if (window.__MCJBossHeaderScript || window.__MCJBossHeaderLoaded || window.MCJBossHeader) return;
      var p = String(location.pathname || "").replace(/\\/g, "/");
      if (/\/admin(\/|\.html|$)/i.test(p) || /\/companion\//i.test(p) || /\/customer-service(\/|\.html|$)/i.test(p)) return;
      window.__MCJBossHeaderScript = true;
      var s = document.createElement("script");
      s.src = "/src/boss-header.js?v=20260803overlayP0";
      s.defer = true;
      document.head.appendChild(s);
    })();

    var root = document.body;
    if (root && "MutationObserver" in window) {
      new MutationObserver(function (mutations) {
        var shouldRun = mutations.some(function (mutation) {
          return mutation.addedNodes && mutation.addedNodes.length;
        });
        if (!shouldRun) return;
        normalizeCards(document);
        normalizeEmojiButtons(document);
      }).observe(root, { childList: true, subtree: true });
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();

