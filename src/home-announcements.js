(function () {
  "use strict";

  if (window.MCJHomeAnnouncements) return;

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

  function normalize(item) {
    item = item || {};
    return {
      id: String(item.id || ""),
      title: String(item.title || "").trim(),
      content: String(item.content || item.text || "").trim(),
      publishedAt: item.publishedAt || item.published_at || item.created_at || item.createdAt || "",
      pinned: item.pinned === true || item.is_pinned === true || item.isPinned === true,
      enabled: item.enabled !== false && item.is_active !== false,
      sort: Number(item.sort || item.sort_order || 100),
    };
  }

  function sortItems(list) {
    return (list || []).slice().sort(function (a, b) {
      if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
      var tb = Date.parse(b.publishedAt || 0) || 0;
      var ta = Date.parse(a.publishedAt || 0) || 0;
      if (tb !== ta) return tb - ta;
      return Number(a.sort || 100) - Number(b.sort || 100);
    });
  }

  function tickerText(items) {
    if (!items.length) return "暂无最新公告。";
    return items
      .map(function (item) {
        var title = item.title || "官方公告";
        var body = item.content || "";
        return body && body !== title ? title + "：" + body : title;
      })
      .join("　　·　　");
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
    modal.querySelector(".home-announcement-body").textContent = item.content || item.title || "暂无最新公告。";
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

  function render() {
    var bar = strip();
    if (!bar) return;
    var items = state.items;
    var text = tickerText(items);
    var empty = !items.length;
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
      (empty
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
    return fetch("/api/platform/content?types=announcements", {
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
        state.items = sortItems(
          rows.map(normalize).filter(function (item) {
            return item.enabled !== false && (item.title || item.content);
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
  };
})();
