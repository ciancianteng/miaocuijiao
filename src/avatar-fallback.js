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

  function isBadUrl(src) {
    var s = String(src == null ? "" : src).trim();
    if (!s || s === "#" || s === "null" || s === "undefined" || s === "-") return true;
    if (/meow-cuijiao-brand\.(jpe?g|png|webp)$/i.test(s)) return true;
    if (/^assets\/meow-cuijiao-brand/i.test(s)) return true;
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

  function applyFallback(img) {
    if (!img || img.tagName !== "IMG") return;
    if (img.getAttribute("data-mcj-avatar-fb") === "1") return;
    var cur = img.currentSrc || img.getAttribute("src") || img.src || "";
    if (cur.indexOf("default-avatar.png") !== -1 || cur.indexOf("default-companion-avatar") !== -1) {
      img.setAttribute("data-mcj-avatar-fb", "1");
      return;
    }
    img.setAttribute("data-mcj-avatar-fb", "1");
    img.onerror = null;
    img.removeAttribute("srcset");
    img.src = DEFAULT;
  }

  // Capture phase: any broken <img> → default avatar (kills blue ?)
  document.addEventListener(
    "error",
    function (e) {
      var t = e.target;
      if (!t || t.tagName !== "IMG") return;
      applyFallback(t);
    },
    true
  );

  function scanBroken(root) {
    var list = (root || document).querySelectorAll ? (root || document).querySelectorAll("img") : [];
    for (var i = 0; i < list.length; i++) {
      var img = list[i];
      var src = img.getAttribute("src") || "";
      if (isBadUrl(src)) {
        applyFallback(img);
        continue;
      }
      if (img.complete && img.naturalWidth === 0 && src) {
        applyFallback(img);
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
