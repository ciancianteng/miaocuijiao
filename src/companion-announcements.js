/**
 * Companion announcement ticker — same platform announcements as homepage/boss.
 * Data: /api/platform/content?types=announcements&audience=home
 * Style: home-announcements.css (.home-announcement-bar)
 * Rotates ALL published home announcements in admin sort order (not first-only).
 * Does NOT load companion-only / quote-style audience=companion rows.
 */
(function () {
  "use strict";

  if (window.MCJCompanionAnnouncements && window.MCJCompanionAnnouncements.__v === "20260805annUnify1") return;

  var state = {
    items: [],
    loaded: false,
    index: 0,
    currentId: "",
    itemsSig: "",
    rotateTimer: null,
    pollTimer: 0,
    started: false,
  };

  var PX_PER_SEC = 50;
  var MIN_SCROLL_SEC = 8;
  var STATIC_DWELL_MS = 5000;
  var GAP_PX = 100;

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function strip() {
    return (
      document.getElementById("companionAnnouncementBar") ||
      document.querySelector("[data-pw-announcement-host] .home-announcement-bar") ||
      document.querySelector("[data-pw-announcement-bar]")
    );
  }

  function host() {
    return document.querySelector("[data-pw-announcement-host]");
  }

  function inSchedule(item) {
    var now = Date.now();
    if (item.startAt) {
      var s = Date.parse(item.startAt);
      if (Number.isFinite(s) && now < s) return false;
    }
    if (item.endAt) {
      var e = Date.parse(item.endAt);
      if (Number.isFinite(e) && now > e) return false;
    }
    return true;
  }

  function normalize(item) {
    item = item || {};
    var kind = String(item.kind || "normal").toLowerCase() === "forced" ? "forced" : "normal";
    var requiresAck = kind === "forced" || item.requiresAck === true || item.requires_ack === true;
    return {
      id: String(item.id || ""),
      title: String(item.title || "").trim(),
      content: String(item.content || item.text || "").trim(),
      publishedAt: item.publishedAt || item.published_at || item.created_at || item.createdAt || "",
      pinned: item.pinned === true || item.is_pinned === true || item.isPinned === true,
      enabled: item.enabled !== false && item.is_active !== false,
      sort: Number(item.sort || item.sort_order || 100),
      kind: kind,
      requiresAck: requiresAck,
      startAt: item.startAt || item.start_at || "",
      endAt: item.endAt || item.end_at || "",
      scroll: item.scroll !== false && item.is_scrolling !== false,
      audience: String(item.audience || "home").toLowerCase(),
      category: String(item.category || "home").toLowerCase(),
    };
  }

  function isPlatformHomeAnn(item) {
    var aud = String(item.audience || "home").toLowerCase();
    var cat = String(item.category || "home").toLowerCase();
    // Platform / homepage announcements only — exclude companion quotes & CS-only.
    if (aud === "companion" || cat === "companion") return false;
    if (aud === "customer_service" || cat === "customer_service") return false;
    return true;
  }

  function sortItems(list) {
    return (list || []).slice().sort(function (a, b) {
      if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
      var sa = Number(a.sort || 100);
      var sb = Number(b.sort || 100);
      if (sa !== sb) return sa - sb;
      var ta = Date.parse(a.publishedAt || 0) || 0;
      var tb = Date.parse(b.publishedAt || 0) || 0;
      if (ta !== tb) return ta - tb;
      return String(a.id || "").localeCompare(String(b.id || ""));
    });
  }

  function itemLine(item) {
    if (!item) return "暂无最新公告。";
    var title = item.title || "官方公告";
    var body = item.content || "";
    var line = body && body !== title ? title + "：" + body : title;
    return String(line).replace(/\s+/g, " ").trim() || "暂无最新公告。";
  }

  function itemsSignature(items) {
    return (items || [])
      .map(function (it) {
        return [it.id, it.title, it.content, it.sort, it.scroll ? 1 : 0, it.pinned ? 1 : 0].join("\u0001");
      })
      .join("\u0002");
  }

  function clearRotateTimer() {
    if (state.rotateTimer) {
      clearTimeout(state.rotateTimer);
      state.rotateTimer = null;
    }
  }

  function currentItem() {
    if (!state.items.length) return null;
    var idx = state.index % state.items.length;
    if (idx < 0) idx = 0;
    return state.items[idx] || null;
  }

  function syncIndexToCurrentId() {
    if (!state.items.length) {
      state.index = 0;
      state.currentId = "";
      return;
    }
    var found = -1;
    if (state.currentId) {
      found = state.items.findIndex(function (it) {
        return String(it.id) === String(state.currentId);
      });
    }
    if (found < 0) {
      found = Math.min(Math.max(0, state.index), state.items.length - 1);
    }
    state.index = found;
    state.currentId = state.items[found].id;
  }

  function advanceToNext() {
    if (!state.items.length) return;
    if (state.items.length === 1) {
      state.currentId = state.items[0].id;
      state.index = 0;
      return;
    }
    state.index = (state.index + 1) % state.items.length;
    state.currentId = state.items[state.index].id;
    render(true);
  }

  function formatTime(value) {
    if (!value) return "-";
    try {
      return new Date(value).toLocaleString("zh-CN", { hour12: false });
    } catch (e) {
      return String(value);
    }
  }

  function ensureModal() {
    var modal = document.getElementById("companionAnnouncementModal");
    if (modal) return modal;
    modal = document.createElement("div");
    modal.id = "companionAnnouncementModal";
    modal.className = "home-announcement-modal";
    modal.hidden = true;
    modal.innerHTML =
      '<div class="home-announcement-dialog" role="dialog" aria-modal="true" aria-labelledby="companionAnnouncementModalTitle">' +
      '<button type="button" class="home-announcement-close" data-announcement-close aria-label="关闭">×</button>' +
      '<h3 id="companionAnnouncementModalTitle"></h3>' +
      '<time class="home-announcement-time"></time>' +
      '<div class="home-announcement-body"></div>' +
      '<button type="button" class="home-announcement-ok" data-announcement-close>关闭</button>' +
      "</div>";
    document.body.appendChild(modal);
    modal.addEventListener("click", function (e) {
      if (e.target === modal || e.target.closest("[data-announcement-close]")) {
        modal.hidden = true;
        document.body.style.overflow = "";
      }
    });
    return modal;
  }

  function openDetail(item) {
    if (!item) return;
    var modal = ensureModal();
    modal.querySelector("#companionAnnouncementModalTitle").textContent = item.title || "官方公告";
    modal.querySelector(".home-announcement-time").textContent = "发布时间：" + formatTime(item.publishedAt);
    modal.querySelector(".home-announcement-body").textContent = item.content || item.title || "暂无最新公告。";
    modal.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function preferEllipsis(item) {
    return !!(item && item.scroll === false);
  }

  function bindPause(bar) {
    if (!bar || bar.dataset.pauseBound === "1") return;
    bar.dataset.pauseBound = "1";
    function currentTrack() {
      return bar.querySelector(".home-announcement-track");
    }
    function pause() {
      var track = currentTrack();
      if (track) track.style.animationPlayState = "paused";
    }
    function resume() {
      var track = currentTrack();
      if (track) track.style.animationPlayState = "running";
    }
    bar.addEventListener("mouseenter", pause);
    bar.addEventListener("mouseleave", resume);
    bar.addEventListener("focusin", pause);
    bar.addEventListener("focusout", resume);
  }

  function applyMarqueeMetrics(bar, track) {
    if (!bar || !track) return;
    var wrap = bar.querySelector(".home-announcement-track-wrap");
    var seg = track.querySelector(".home-announcement-seg");
    if (!wrap || !seg) return;
    var segs = track.querySelectorAll(".home-announcement-seg");
    for (var i = 0; i < segs.length; i += 1) {
      segs[i].style.paddingRight = GAP_PX + "px";
    }
    var segW = seg.getBoundingClientRect().width || seg.offsetWidth || 0;
    var groupW = Math.max(1, segW);
    var duration = Math.max(MIN_SCROLL_SEC, groupW / PX_PER_SEC);
    track.style.setProperty("--marquee-duration", duration.toFixed(2) + "s");
    track.setAttribute("data-scroll", "1");
  }

  function bindCarousel(track) {
    if (!track || track.dataset.carouselBound === "1") return;
    track.dataset.carouselBound = "1";
    track.addEventListener("animationiteration", function () {
      if (document.visibilityState === "hidden") return;
      if (state.items.length <= 1) return;
      clearRotateTimer();
      advanceToNext();
    });
  }

  function scheduleStaticAdvance() {
    clearRotateTimer();
    if (state.items.length <= 1) return;
    if (document.visibilityState === "hidden") return;
    state.rotateTimer = setTimeout(function () {
      advanceToNext();
    }, STATIC_DWELL_MS);
  }

  function ensureBarInHost() {
    var h = host();
    if (!h) return null;
    var bar = strip();
    if (!bar || !h.contains(bar)) {
      bar = document.createElement("div");
      bar.id = "companionAnnouncementBar";
      bar.className = "home-announcement-bar announcement-strip";
      bar.setAttribute("data-pw-announcement-bar", "1");
      bar.hidden = true;
      h.innerHTML = "";
      h.appendChild(bar);
    }
    h.hidden = false;
    return bar;
  }

  function render(forceRotate) {
    var bar = ensureBarInHost() || strip();
    var h = host();
    if (!bar) return;
    clearRotateTimer();
    syncIndexToCurrentId();
    var items = state.items;
    var item = currentItem();
    var empty = !items.length;
    var text = empty ? "暂无最新公告。" : itemLine(item);
    var useEllipsis = !empty && preferEllipsis(item);

    if (h) h.hidden = false;
    bar.hidden = false;
    bar.classList.add("home-announcement-bar", "announcement-strip");
    bar.setAttribute("aria-label", "官方公告");
    bar.dataset.announcementCount = String(items.length);
    bar.dataset.announcementIndex = String(empty ? 0 : state.index);
    if (item && item.id) bar.dataset.announcementId = String(item.id);
    else delete bar.dataset.announcementId;

    // Reset bind flags when DOM is rebuilt.
    bar.dataset.pauseBound = "0";
    bar.dataset.clickBound = "0";

    bar.innerHTML =
      '<div class="home-announcement-label"><span aria-hidden="true">📢</span><strong>官方公告</strong></div>' +
      '<div class="home-announcement-track-wrap" data-announcement-open' +
      (empty ? ' data-empty="1"' : ' tabindex="0"') +
      ' role="button" aria-label="' +
      (empty ? "暂无最新公告" : "查看公告详情") +
      '">' +
      (empty || useEllipsis
        ? '<span class="home-announcement-static">' + esc(text) + "</span>"
        : '<span class="home-announcement-track" data-scroll="1">' +
          '<span class="home-announcement-seg">' +
          esc(text) +
          "</span>" +
          '<span class="home-announcement-seg" aria-hidden="true">' +
          esc(text) +
          "</span>" +
          "</span>") +
      "</div>";

    var track = bar.querySelector(".home-announcement-track");
    if (track) {
      applyMarqueeMetrics(bar, track);
      bindPause(bar);
      bindCarousel(track);
      if (forceRotate) {
        track.style.animation = "none";
        void track.offsetWidth;
        track.style.animation = "";
      }
    } else if (!empty) {
      scheduleStaticAdvance();
    }

    if (bar.dataset.clickBound !== "1") {
      bar.dataset.clickBound = "1";
      bar.addEventListener("click", function (e) {
        var openBtn = e.target.closest("[data-announcement-open]");
        if (!openBtn || openBtn.getAttribute("data-empty") === "1") return;
        openDetail(currentItem());
      });
      bar.addEventListener("keydown", function (e) {
        if (e.key !== "Enter" && e.key !== " ") return;
        var openBtn = e.target.closest("[data-announcement-open]");
        if (!openBtn || openBtn.getAttribute("data-empty") === "1") return;
        e.preventDefault();
        openDetail(currentItem());
      });
    }
  }

  function applyRows(rows) {
    var nextItems = sortItems(
      (rows || [])
        .map(normalize)
        .filter(function (item) {
          return (
            item.enabled !== false &&
            (item.title || item.content) &&
            inSchedule(item) &&
            isPlatformHomeAnn(item) &&
            item.kind !== "forced" &&
            !item.requiresAck
          );
        })
    );
    var sig = itemsSignature(nextItems);
    var changed = sig !== state.itemsSig;
    state.items = nextItems;
    state.itemsSig = sig;
    state.loaded = true;
    syncIndexToCurrentId();
    var bar = strip();
    if (changed || !bar || !bar.querySelector(".home-announcement-track, .home-announcement-static")) {
      render(false);
    } else {
      bar.dataset.announcementCount = String(state.items.length);
      bar.dataset.announcementIndex = String(state.items.length ? state.index : 0);
      if (state.currentId) bar.dataset.announcementId = String(state.currentId);
      // Host may have been recreated by paint — re-attach bar content if empty host.
      if (host() && (!strip() || !host().contains(strip()))) render(false);
    }
  }

  function load() {
    return fetch("/api/platform/content?types=announcements&audience=home", {
      headers: { Accept: "application/json" },
      cache: "no-store",
    })
      .then(function (res) {
        return res.json().catch(function () {
          return { byType: { announcements: [] } };
        });
      })
      .then(function (body) {
        var rows = (((body || {}).byType || {}).announcements) || [];
        if (rows.length) return rows;
        return fetch("/api/platform/content?types=announcements", {
          headers: { Accept: "application/json" },
          cache: "no-store",
        })
          .then(function (res2) {
            return res2.json().catch(function () {
              return { byType: { announcements: [] } };
            });
          })
          .then(function (body2) {
            return ((((body2 || {}).byType || {}).announcements) || []).filter(function (row) {
              var cat = String(row.category || "home").toLowerCase();
              var aud = String(row.audience || "home").toLowerCase();
              return cat !== "companion" && aud !== "companion" && aud !== "customer_service";
            });
          });
      })
      .then(function (rows) {
        applyRows(rows);
        return state.items;
      })
      .catch(function () {
        state.items = [];
        state.itemsSig = "";
        state.loaded = true;
        state.index = 0;
        state.currentId = "";
        render(false);
        return [];
      });
  }

  function onShellPaint() {
    // Shell HTML was rebuilt — ensure host + bar exist, keep rotation index.
    ensureBarInHost();
    if (state.loaded) render(false);
    else load();
  }

  function start() {
    if (state.started) {
      onShellPaint();
      return;
    }
    state.started = true;
    ensureBarInHost();
    load();
    if (state.pollTimer) clearInterval(state.pollTimer);
    state.pollTimer = setInterval(load, 30000);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") load();
      else clearRotateTimer();
    });
  }

  window.MCJCompanionAnnouncements = {
    __v: "20260805annUnify1",
    start: start,
    reload: load,
    onShellPaint: onShellPaint,
    renderHtml: function () {
      // Deprecated: bar is managed in-place; host placeholder only.
      return "";
    },
    hostHtml: function () {
      return (
        '<div class="pw-announcement-host" data-pw-announcement-host>' +
        '<div id="companionAnnouncementBar" class="home-announcement-bar announcement-strip" data-pw-announcement-bar hidden></div>' +
        "</div>"
      );
    },
    items: function () {
      return state.items.slice();
    },
    index: function () {
      return state.index;
    },
    current: function () {
      return currentItem();
    },
  };
})();
