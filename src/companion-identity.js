(function () {
  "use strict";

  if (window.MCJCompanionIdentity) return;

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function asList(raw) {
    if (Array.isArray(raw)) {
      return raw
        .map(function (t) {
          if (t == null) return "";
          if (typeof t === "string") return t.trim();
          return String(t.name || t.title || t.label || "").trim();
        })
        .filter(Boolean);
    }
    return String(raw || "")
      .replace(/\[\[MCJ_[^\]]+\]\]/g, "")
      .split(/[,，、|/]+/)
      .map(function (t) {
        return String(t || "").trim();
      })
      .filter(Boolean);
  }

  function normalizeVoice(raw) {
    var s = String(raw == null ? "" : raw).trim();
    if (!s) return "";
    s = s.replace(/^声线\s*[:：]\s*/, "").trim();
    if (!s || /^(无|暂无|未设置|-|—)$/.test(s)) return "";
    return s;
  }

  /** Only from dedicated voice_type field — never infer from tags. */
  function pickVoice(opts) {
    opts = opts || {};
    return normalizeVoice(opts.voiceType || opts.voice_type || opts.voiceLine || opts.voice_line || "");
  }

  function formatVoiceLabel(voice) {
    var v = normalizeVoice(voice);
    return v ? "声线：" + v : "声线：未设置";
  }

  function filterServiceTags(tags, voice) {
    var voiceParts = normalizeVoice(voice)
      .split(/[,，、|/]+/)
      .map(function (t) {
        return t.trim().toLowerCase();
      })
      .filter(Boolean);
    var voiceSet = {};
    voiceParts.forEach(function (t) {
      voiceSet[t] = 1;
    });
    return asList(tags).filter(function (t) {
      if (/^声线\s*[:：]/.test(t)) return false;
      if (/^游戏ID:|^联系:|^地区:|^性别:|^年龄:|^游戏:/.test(t)) return false;
      if (/官方推荐|金牌陪玩|实力认证/.test(t)) return false;
      var plain = normalizeVoice(t).toLowerCase();
      if (plain && voiceSet[plain]) return false;
      return true;
    });
  }

  function isOfficialCert(name) {
    return /官方推荐/.test(String(name || ""));
  }

  function certHtml(list, limit) {
    var max = limit == null ? 4 : limit;
    return (Array.isArray(list) ? list : [])
      .slice(0, max)
      .map(function (t) {
        var name = typeof t === "string" ? t : t.name || t.title || "";
        if (!name) return "";
        var icon = typeof t === "object" && t.icon ? String(t.icon) : isOfficialCert(name) ? "🏅" : "🏷️";
        var official = isOfficialCert(name) ? " is-official" : "";
        return (
          '<span class="mcj-cert-badge' +
          official +
          '" title="' +
          esc(name) +
          '"><span class="mcj-cert-icon" aria-hidden="true">' +
          esc(icon) +
          "</span>" +
          esc(name) +
          "</span>"
        );
      })
      .filter(Boolean)
      .join("");
  }

  function renderTags(opts) {
    opts = opts || {};
    var levelId = opts.levelId || "";
    var levelText = opts.levelLabel || opts.level || opts.levelName || "";
    var gender = String(opts.gender || "").trim();
    if (/^(保密|不公开|未知|-|—)$/.test(gender)) gender = "";
    var voice = pickVoice(opts);
    var cert = certHtml(opts.certTags || opts.certificationTags || [], opts.certLimit);
    var services = filterServiceTags(opts.tags, voice).slice(0, opts.serviceLimit == null ? 6 : opts.serviceLimit);
    var parts = [];
    if (opts.includeLevel !== false && levelText) {
      parts.push(
        '<span class="companion-level-pill mcj-level-tag" data-level-id="' +
          esc(levelId) +
          '">' +
          esc(levelText) +
          "</span>"
      );
    }
    if (opts.includeGender !== false && gender) {
      parts.push('<span class="mcj-gender-tag">' + esc(gender) + "</span>");
    }
    if (cert) parts.push(cert);
    if (opts.includeVoice !== false) {
      var voiceText = formatVoiceLabel(voice);
      var unset = !normalizeVoice(voice);
      parts.push(
        '<span class="mcj-voice-tag' +
          (unset ? " is-unset" : "") +
          '"><span class="mcj-voice-label">声线：</span>' +
          esc(unset ? "未设置" : normalizeVoice(voice)) +
          "</span>"
      );
    }
    services.forEach(function (t) {
      parts.push('<span class="mcj-service-tag">' + esc(t) + "</span>");
    });
    if (!parts.length) return "";
    var cls = "mcj-id-tags" + (opts.className ? " " + opts.className : "");
    return '<div class="' + cls + '">' + parts.join("") + "</div>";
  }

  /* ---------- Album lightbox ---------- */
  var lbState = { urls: [], index: 0, root: null, touchX: 0, touchY: 0 };

  function ensureLightbox() {
    if (lbState.root) return lbState.root;
    var root = document.createElement("div");
    root.className = "mcj-album-lightbox";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "相册预览");
    root.innerHTML =
      '<button type="button" class="mcj-album-lightbox__close" data-lb-close aria-label="关闭">×</button>' +
      '<div class="mcj-album-lightbox__stage" data-lb-stage>' +
      '<button type="button" class="mcj-album-lightbox__btn mcj-album-lightbox__prev" data-lb-prev aria-label="上一张">‹</button>' +
      '<img class="mcj-album-lightbox__img" data-lb-img alt="相册">' +
      '<button type="button" class="mcj-album-lightbox__btn mcj-album-lightbox__next" data-lb-next aria-label="下一张">›</button>' +
      "</div>" +
      '<div class="mcj-album-lightbox__counter" data-lb-counter></div>';
    document.body.appendChild(root);
    lbState.root = root;

    function paint() {
      var img = root.querySelector("[data-lb-img]");
      var counter = root.querySelector("[data-lb-counter]");
      var url = lbState.urls[lbState.index] || "";
      if (img) {
        img.src = url;
        img.onerror = function () {
          this.onerror = null;
          this.src = "/default-avatar.png";
        };
      }
      if (counter) counter.textContent = lbState.urls.length ? lbState.index + 1 + " / " + lbState.urls.length : "";
      var multi = lbState.urls.length > 1;
      var prev = root.querySelector("[data-lb-prev]");
      var next = root.querySelector("[data-lb-next]");
      if (prev) prev.hidden = !multi;
      if (next) next.hidden = !multi;
    }

    function close() {
      root.classList.remove("is-open");
      document.body.style.removeProperty("overflow");
    }
    function step(delta) {
      if (lbState.urls.length < 2) return;
      lbState.index = (lbState.index + delta + lbState.urls.length) % lbState.urls.length;
      paint();
    }

    root.addEventListener("click", function (e) {
      if (e.target === root || e.target.closest("[data-lb-close]")) close();
      else if (e.target.closest("[data-lb-prev]")) step(-1);
      else if (e.target.closest("[data-lb-next]")) step(1);
    });
    document.addEventListener("keydown", function (e) {
      if (!root.classList.contains("is-open")) return;
      if (e.key === "Escape") close();
      if (e.key === "ArrowLeft") step(-1);
      if (e.key === "ArrowRight") step(1);
    });

    var stage = root.querySelector("[data-lb-stage]");
    if (stage) {
      stage.addEventListener(
        "touchstart",
        function (e) {
          var t = e.changedTouches && e.changedTouches[0];
          if (!t) return;
          lbState.touchX = t.clientX;
          lbState.touchY = t.clientY;
        },
        { passive: true }
      );
      stage.addEventListener(
        "touchend",
        function (e) {
          var t = e.changedTouches && e.changedTouches[0];
          if (!t) return;
          var dx = t.clientX - lbState.touchX;
          var dy = t.clientY - lbState.touchY;
          if (Math.abs(dx) < 48 || Math.abs(dx) < Math.abs(dy)) return;
          step(dx < 0 ? 1 : -1);
        },
        { passive: true }
      );
    }

    root._mcjPaint = paint;
    root._mcjClose = close;
    return root;
  }

  function openLightbox(urls, startIndex) {
    var list = (Array.isArray(urls) ? urls : [])
      .map(function (u) {
        return String(u || "").trim();
      })
      .filter(function (u) {
        return u && !/^(blob:|data:)/i.test(u);
      });
    if (!list.length) return;
    var root = ensureLightbox();
    lbState.urls = list;
    lbState.index = Math.max(0, Math.min(Number(startIndex) || 0, list.length - 1));
    root.classList.add("is-open");
    document.body.style.overflow = "hidden";
    if (root._mcjPaint) root._mcjPaint();
  }

  function bindAlbum(container, urls) {
    var root = typeof container === "string" ? document.querySelector(container) : container;
    if (!root) return;
    var list = (Array.isArray(urls) ? urls : [])
      .map(function (u) {
        return typeof u === "string" ? u : u && u.url ? u.url : "";
      })
      .map(function (u) {
        return String(u || "").trim();
      })
      .filter(Boolean);
    root.querySelectorAll("img").forEach(function (img, idx) {
      var src = img.getAttribute("src") || list[idx] || "";
      if (!src) return;
      if (!list[idx]) list[idx] = src;
      img.classList.add("mcj-album-thumb");
      img.setAttribute("data-album-index", String(idx));
      img.style.cursor = "zoom-in";
    });
    if (root._mcjAlbumBound) return;
    root._mcjAlbumBound = true;
    root.addEventListener("click", function (e) {
      var img = e.target.closest("img[data-album-index]");
      if (!img || !root.contains(img)) return;
      e.preventDefault();
      var idx = Number(img.getAttribute("data-album-index") || 0);
      var live = [];
      root.querySelectorAll("img[data-album-index]").forEach(function (node) {
        live.push(node.getAttribute("src") || "");
      });
      openLightbox(live.filter(Boolean).length ? live : list, idx);
    });
  }

  window.MCJCompanionIdentity = {
    esc: esc,
    asList: asList,
    pickVoice: pickVoice,
    formatVoiceLabel: formatVoiceLabel,
    filterServiceTags: filterServiceTags,
    renderTags: renderTags,
    certHtml: certHtml,
    openLightbox: openLightbox,
    bindAlbum: bindAlbum,
  };
})();
