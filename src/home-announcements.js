(function () {
  "use strict";

  if (window.MCJHomeAnnouncements) return;

  var state = {
    items: [],
    forced: [],
    loaded: false,
    activeId: "",
    forcedOpen: false,
  };

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function strip() {
    return document.getElementById("homeAnnouncementBar") || document.querySelector(".announcement-strip");
  }

  function formatTime(value) {
    if (!value) return "-";
    try {
      return new Date(value).toLocaleString("zh-CN", { hour12: false });
    } catch (e) {
      return String(value);
    }
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
      category: String(item.category || "home").toLowerCase() === "companion" ? "companion" : "home",
      audience: String(item.audience || "home").toLowerCase(),
      kind: kind,
      requiresAck: requiresAck,
      contentVersion: String(item.contentVersion || item.content_version || 1),
      startAt: item.startAt || item.start_at || "",
      endAt: item.endAt || item.end_at || "",
      scroll: item.scroll !== false && item.is_scrolling !== false,
    };
  }

  function sortItems(list) {
    return (list || []).slice().sort(function (a, b) {
      if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
      var sa = Number(a.sort || 100);
      var sb = Number(b.sort || 100);
      if (sa !== sb) return sa - sb;
      var tb = Date.parse(b.publishedAt || 0) || 0;
      var ta = Date.parse(a.publishedAt || 0) || 0;
      return tb - ta;
    });
  }

  function tickerText(items) {
    if (!items.length) return "暂无最新公告。";
    var item = items[0];
    var title = item.title || "官方公告";
    var body = item.content || "";
    var line = body && body !== title ? title + "：" + body : title;
    return String(line).replace(/\s+/g, " ").trim();
  }

  function ensureModal() {
    var modal = document.getElementById("homeAnnouncementModal");
    if (modal) return modal;
    modal = document.createElement("div");
    modal.id = "homeAnnouncementModal";
    modal.className = "home-announcement-modal";
    modal.hidden = true;
    modal.innerHTML =
      '<div class="home-announcement-dialog" role="dialog" aria-modal="true" aria-labelledby="homeAnnouncementModalTitle">' +
      '<button type="button" class="home-announcement-close" data-announcement-close aria-label="关闭">×</button>' +
      '<h3 id="homeAnnouncementModalTitle"></h3>' +
      '<time class="home-announcement-time"></time>' +
      '<div class="home-announcement-body"></div>' +
      '<button type="button" class="home-announcement-ok" data-announcement-close>关闭</button>' +
      "</div>";
    document.body.appendChild(modal);
    modal.addEventListener("click", function (e) {
      if (e.target === modal || e.target.closest("[data-announcement-close]")) closeDetail();
    });
    return modal;
  }

  function openDetail(item, opts) {
    if (!item) return;
    opts = opts || {};
    var modal = ensureModal();
    state.activeId = item.id;
    state.forcedOpen = !!opts.forced;
    modal.querySelector("#homeAnnouncementModalTitle").textContent = item.title || "官方公告";
    modal.querySelector(".home-announcement-time").textContent =
      (item.kind === "forced" ? "强制公告 · " : "") + "发布时间：" + formatTime(item.publishedAt);
    modal.querySelector(".home-announcement-body").textContent = item.content || item.title || "暂无最新公告。";
    var closeBtn = modal.querySelector(".home-announcement-close");
    var okBtn = modal.querySelector(".home-announcement-ok");
    if (item.kind === "forced" && opts.forced) {
      if (closeBtn) closeBtn.hidden = true;
      if (okBtn) okBtn.textContent = "我已阅读";
    } else {
      if (closeBtn) closeBtn.hidden = false;
      if (okBtn) okBtn.textContent = "关闭";
    }
    modal.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function pickDetailItem() {
    if (!state.items.length) return null;
    return state.items[0];
  }

  function guestForcedKey(item) {
    return "mcjHomeForcedSeen:" + String(item.id || "") + ":" + String(item.contentVersion || "1");
  }

  function markForcedSeen(item) {
    try {
      sessionStorage.setItem(guestForcedKey(item), "1");
    } catch (e) {}
  }

  function wasForcedSeen(item) {
    try {
      return sessionStorage.getItem(guestForcedKey(item)) === "1";
    } catch (e) {
      return false;
    }
  }

  function bossAccessToken() {
    try {
      return (
        sessionStorage.getItem("mcjAuthAccessToken") ||
        localStorage.getItem("mcjAuthAccessToken") ||
        ""
      );
    } catch (e) {
      return "";
    }
  }

  function acknowledgeForced(item) {
    var token = bossAccessToken();
    if (!token || !item || !item.id) {
      markForcedSeen(item);
      return Promise.resolve();
    }
    return fetch("/api/auth", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: "Bearer " + token,
      },
      body: JSON.stringify({
        action: "acknowledge_forced",
        content_id: item.id,
        content_version: item.contentVersion || "1",
        content_type: "announcement",
      }),
    })
      .then(function (r) {
        return r.json().catch(function () {
          return {};
        });
      })
      .then(function () {
        markForcedSeen(item);
      })
      .catch(function () {
        markForcedSeen(item);
      });
  }

  function closeDetail() {
    var modal = document.getElementById("homeAnnouncementModal");
    if (!modal) return;
    var closingForced = state.forcedOpen;
    var active = null;
    if (closingForced) {
      active = state.forced.find(function (it) {
        return String(it.id) === String(state.activeId);
      }) || state.forced[0];
    }
    modal.hidden = true;
    state.activeId = "";
    state.forcedOpen = false;
    document.body.style.overflow = "";
    if (closingForced && active) {
      acknowledgeForced(active).finally(function () {
        maybeOpenForced();
      });
    }
  }

  function bindPause(bar, track) {
    if (!bar || !track || bar.dataset.pauseBound === "1") return;
    bar.dataset.pauseBound = "1";
    function pause() {
      track.style.animationPlayState = "paused";
    }
    function resume() {
      track.style.animationPlayState = "running";
    }
    bar.addEventListener("mouseenter", pause);
    bar.addEventListener("mouseleave", resume);
    bar.addEventListener("focusin", pause);
    bar.addEventListener("focusout", resume);
  }

  function openFromBar() {
    var item = pickDetailItem();
    if (!item) return;
    openDetail(item);
  }

  function preferEllipsis(item) {
    // Only stop scrolling when admin explicitly disabled it.
    return !!(item && item.scroll === false);
  }

  function maybeOpenForced() {
    if (state.forcedOpen) return;
    var next = null;
    for (var i = 0; i < state.forced.length; i += 1) {
      if (!wasForcedSeen(state.forced[i])) {
        next = state.forced[i];
        break;
      }
    }
    if (!next) return;
    // Prefer dedicated ack modal for logged-in boss when available.
    if (bossAccessToken() && window.MCJBossForcedAck && typeof window.MCJBossForcedAck.refresh === "function") {
      window.MCJBossForcedAck.refresh();
    }
    openDetail(next, { forced: true });
  }

  function render() {
    var bar = strip();
    if (!bar) return;
    var items = state.items;
    var text = tickerText(items);
    var empty = !items.length;
    var useEllipsis = preferEllipsis(items[0]);
    bar.hidden = false;
    bar.classList.add("home-announcement-bar", "announcement-strip");
    bar.setAttribute("aria-label", "官方公告");
    bar.innerHTML =
      '<div class="home-announcement-label"><span aria-hidden="true">📢</span><strong>官方公告</strong></div>' +
      '<div class="home-announcement-track-wrap" data-announcement-open' +
      (empty ? ' data-empty="1"' : ' tabindex="0"') +
      ' role="button" aria-label="' +
      (empty ? "暂无最新公告" : "查看公告详情") +
      '">' +
      (empty || useEllipsis
        ? '<span class="home-announcement-static">' + esc(text) + "</span>"
        : '<span class="home-announcement-track">' +
          '<span class="home-announcement-seg">' +
          esc(text) +
          "</span>" +
          '<span class="home-announcement-seg" aria-hidden="true">' +
          esc(text) +
          "</span>" +
          "</span>") +
      "</div>";

    var track = bar.querySelector(".home-announcement-track");
    if (track) bindPause(bar, track);

    if (bar.dataset.clickBound !== "1") {
      bar.dataset.clickBound = "1";
      bar.addEventListener("click", function (e) {
        var openBtn = e.target.closest("[data-announcement-open]");
        if (!openBtn || openBtn.getAttribute("data-empty") === "1") return;
        openFromBar();
      });
      bar.addEventListener("keydown", function (e) {
        if (e.key !== "Enter" && e.key !== " ") return;
        var openBtn = e.target.closest("[data-announcement-open]");
        if (!openBtn || openBtn.getAttribute("data-empty") === "1") return;
        e.preventDefault();
        openFromBar();
      });
    }
  }

  function load() {
    // Launch-safe: prefer audience=home; if empty (schema/filter drift), fall back to unfiltered list
    // and keep only non-companion items client-side so homepage never goes blank silently.
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
        var all = sortItems(
          (rows || []).map(normalize).filter(function (item) {
            return item.enabled !== false && (item.title || item.content) && inSchedule(item);
          })
        );
        state.forced = all.filter(function (item) {
          return item.kind === "forced" || item.requiresAck;
        });
        state.items = all.filter(function (item) {
          return item.kind !== "forced" && !item.requiresAck;
        });
        state.loaded = true;
        render();
        maybeOpenForced();
      })
      .catch(function () {
        state.items = [];
        state.forced = [];
        state.loaded = true;
        render();
      });
  }

  function boot() {
    render();
    load();
    setInterval(load, 30000);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") load();
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  window.MCJHomeAnnouncements = {
    reload: load,
    items: function () {
      return state.items.slice();
    },
    forced: function () {
      return state.forced.slice();
    },
  };
})();
