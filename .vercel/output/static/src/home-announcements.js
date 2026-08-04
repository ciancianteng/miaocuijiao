(function () {
  "use strict";

  if (window.MCJHomeAnnouncements) return;

  /** 滚动速度（px/s），取 40~60 中间值 */
  var SCROLL_SPEED_PX = 50;
  /** 公告之间 / 循环接缝间距（px） */
  var SEG_GAP_PX = 100;

  var state = {
    items: [],
    loaded: false,
    activeId: "",
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

  function isHomeAudience(item) {
    var aud = String(item.audience || "home").toLowerCase();
    var cat = String(item.category || "home").toLowerCase();
    if (aud === "system_internal" || aud === "internal") return false;
    if (cat === "companion" || cat === "customer_service") return false;
    if (aud === "companion" || aud === "customer_service") return false;
    return (
      !aud ||
      aud === "home" ||
      aud === "homepage" ||
      aud === "boss" ||
      aud === "老板" ||
      aud === "首页" ||
      aud === "all" ||
      aud.indexOf("home") >= 0 ||
      aud.indexOf("boss") >= 0
    );
  }

  function normalize(item) {
    item = item || {};
    return {
      id: String(item.id || ""),
      title: String(item.title || "").trim(),
      content: String(item.content || item.text || "").trim(),
      publishedAt: item.publishedAt || item.published_at || item.created_at || item.createdAt || "",
      pinned: item.pinned === true || item.is_pinned === true || item.isPinned === true,
      enabled: item.enabled !== false && item.is_active !== false && item.status !== "disabled" && item.status !== "unpublished",
      sort: Number(item.sort || item.sort_order || 100),
      category: (function () {
        var c = String(item.category || "home").toLowerCase();
        if (c === "companion") return "companion";
        if (c === "customer_service" || c === "cs") return "customer_service";
        return "home";
      })(),
      audience: String(item.audience || "home").toLowerCase(),
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

  /** 单条公告展示文案（标题：正文） */
  function itemLine(item) {
    if (!item) return "";
    var title = item.title || "官方公告";
    var body = item.content || "";
    var line = body && body !== title ? title + "：" + body : title;
    return String(line).replace(/\s+/g, " ").trim();
  }

  /** 全部公告文案列表（手机/电脑同一数据源） */
  function tickerLines(items) {
    return (items || [])
      .map(itemLine)
      .filter(Boolean);
  }

  function buildSegHtml(lines) {
    return lines
      .map(function (line) {
        return (
          '<span class="home-announcement-seg" style="padding-right:' +
          SEG_GAP_PX +
          'px">' +
          esc(line) +
          "</span>"
        );
      })
      .join("");
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

  function openDetail(item) {
    if (!item) return;
    var modal = ensureModal();
    state.activeId = item.id;
    modal.querySelector("#homeAnnouncementModalTitle").textContent = item.title || "官方公告";
    modal.querySelector(".home-announcement-time").textContent = "发布时间：" + formatTime(item.publishedAt);
    modal.querySelector(".home-announcement-body").textContent = item.content || item.title || "暂无公告";
    modal.hidden = false;
    document.body.style.overflow = "hidden";
  }

  function pickDetailItem() {
    if (!state.items.length) return null;
    return state.items[0];
  }

  function closeDetail() {
    var modal = document.getElementById("homeAnnouncementModal");
    if (!modal) return;
    modal.hidden = true;
    state.activeId = "";
    document.body.style.overflow = "";
  }

  function setPaused(track, paused) {
    if (!track) return;
    track.style.setProperty("animation-play-state", paused ? "paused" : "running", "important");
  }

  function bindPause(bar) {
    if (!bar || bar.dataset.pauseBound === "1") return;
    bar.dataset.pauseBound = "1";
    bar.addEventListener("mouseenter", function () {
      var t = bar.querySelector(".home-announcement-track[data-scroll='1']");
      setPaused(t, true);
    });
    bar.addEventListener("mouseleave", function () {
      var t = bar.querySelector(".home-announcement-track[data-scroll='1']");
      setPaused(t, false);
    });
  }

  function restartTrackAnimation(track) {
    if (!track || track.getAttribute("data-scroll") !== "1") return;
    track.style.animation = "none";
    void track.offsetWidth;
    track.style.animation = "";
    track.style.animationPlayState = "running";
  }

  /** 按半轨宽度设定 duration，保证约 SCROLL_SPEED_PX px/s */
  function applyMarqueeSpeed(track) {
    if (!track || track.getAttribute("data-scroll") !== "1") return;
    var half = track.scrollWidth / 2;
    if (!(half > 0)) return;
    var duration = Math.max(6, half / SCROLL_SPEED_PX);
    track.style.setProperty("--marquee-duration", duration.toFixed(2) + "s");
  }

  /**
   * 每组至少与视口同宽：短公告时第二份在屏外，避免「两条拼在一起」。
   * 长公告 / 多条：内容更宽，minWidth 不生效。
   */
  function ensureGroupMinWidth(wrap, track) {
    if (!wrap || !track) return;
    var wrapW = wrap.clientWidth;
    if (!(wrapW > 0)) return;
    var groups = track.querySelectorAll(".home-announcement-group");
    for (var i = 0; i < groups.length; i++) {
      groups[i].style.setProperty("min-width", wrapW + "px", "important");
    }
  }

  function applyScrollMode(bar) {
    if (!bar) return;
    var wrap = bar.querySelector(".home-announcement-track-wrap");
    var track = bar.querySelector(".home-announcement-track");
    if (!wrap) return;

    // 已是居中静态（单条短公告）：resize 走 render 重测
    if (!track) return;

    if (state.items.length === 1 && state.items[0].scroll === false) {
      track.setAttribute("data-scroll", "0");
      return;
    }

    var multi = state.items.length > 1;
    var firstGroup = track.querySelector(".home-announcement-group");
    var contentW = 0;
    if (firstGroup) {
      // 临时清掉 min-width，量真实内容宽
      firstGroup.style.removeProperty("min-width");
      contentW = firstGroup.scrollWidth;
    } else {
      contentW = track.scrollWidth / 2;
    }

    var needScroll = multi || contentW > wrap.clientWidth + 2;
    if (!needScroll) {
      var line = tickerLines(state.items)[0] || "";
      wrap.setAttribute("data-mode", "center");
      wrap.innerHTML = '<span class="home-announcement-static">' + esc(line) + "</span>";
      return;
    }

    // 多条或过长：无缝滚动；内容短于视口时撑满 group，避免双份同屏拼接
    ensureGroupMinWidth(wrap, track);
    track.setAttribute("data-scroll", "1");
    applyMarqueeSpeed(track);
    restartTrackAnimation(track);
  }

  function openFromBar() {
    var item = pickDetailItem();
    if (!item) return;
    openDetail(item);
  }

  function render() {
    var bar = strip();
    if (!bar) return;
    var items = state.items;
    var lines = tickerLines(items);
    var empty = !items.length;
    var forceStatic = !!(items[0] && items[0].scroll === false && items.length === 1);

    bar.hidden = false;
    bar.classList.add("home-announcement-bar", "announcement-strip");
    bar.setAttribute("aria-label", "官方公告");

    var wrapAttrs =
      ' class="home-announcement-track-wrap" data-announcement-open' +
      (empty ? ' data-empty="1"' : ' tabindex="0"') +
      ' role="button" aria-label="' +
      (empty ? "暂无公告" : "查看公告详情") +
      '"';

    var inner;
    if (empty) {
      inner =
        '<div' +
        wrapAttrs +
        ' data-mode="center"><span class="home-announcement-static">暂无公告</span></div>';
    } else if (forceStatic) {
      inner =
        '<div' +
        wrapAttrs +
        ' data-mode="center"><span class="home-announcement-static">' +
        esc(lines[0] || "") +
        "</span></div>";
    } else {
      // 双份 group 无缝循环；短文由 applyScrollMode 把 group minWidth 撑满视口
      var segs = buildSegHtml(lines);
      inner =
        "<div" +
        wrapAttrs +
        ">" +
        '<div class="home-announcement-track" data-scroll="1" style="--marquee-duration:20s">' +
        '<div class="home-announcement-group">' +
        segs +
        "</div>" +
        '<div class="home-announcement-group" aria-hidden="true">' +
        segs +
        "</div>" +
        "</div></div>";
    }

    bar.innerHTML =
      '<div class="home-announcement-label"><span aria-hidden="true">📢</span><strong>官方公告</strong></div>' +
      inner;

    var track = bar.querySelector(".home-announcement-track");
    bindPause(bar);

    requestAnimationFrame(function () {
      applyScrollMode(bar);
      requestAnimationFrame(function () {
        applyScrollMode(bar);
      });
    });

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
              return isHomeAudience(normalize(row));
            });
          });
      })
      .then(function (rows) {
        state.items = sortItems(
          (rows || []).map(normalize).filter(function (item) {
            return item.enabled !== false && (item.title || item.content) && inSchedule(item) && isHomeAudience(item);
          })
        );
        state.loaded = true;
        render();
      })
      .catch(function () {
        state.items = [];
        state.loaded = true;
        render();
      });
  }

  function boot() {
    render();
    load();
    setInterval(load, 30000);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState !== "visible") return;
      load();
      var bar = strip();
      var track = bar && bar.querySelector(".home-announcement-track");
      if (track) {
        applyMarqueeSpeed(track);
        restartTrackAnimation(track);
      }
    });
    window.addEventListener("pageshow", function () {
      var bar = strip();
      if (!bar) return;
      applyScrollMode(bar);
      var track = bar.querySelector(".home-announcement-track");
      if (track) {
        applyMarqueeSpeed(track);
        restartTrackAnimation(track);
      }
    });
    var resizeTimer = 0;
    window.addEventListener("resize", function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () {
        // 重渲后重新测溢出，避免「短→长 / 长→短」模式卡住
        if (state.loaded) render();
        else applyScrollMode(strip());
      }, 120);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  window.MCJHomeAnnouncements = {
    reload: load,
    items: function () {
      return state.items.slice();
    },
  };
})();
