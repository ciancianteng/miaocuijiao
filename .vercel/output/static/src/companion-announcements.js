(function () {
  "use strict";

  if (window.MCJCompanionAnnouncements) return;

  var state = { items: [], loaded: false, timer: 0 };

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function normalize(item) {
    item = item || {};
    return {
      id: String(item.id || ""),
      title: String(item.title || "").trim(),
      content: String(item.content || item.text || "").trim(),
      pinned: item.pinned === true || item.is_pinned === true,
      enabled: item.enabled !== false,
      sort: Number(item.sort || item.sort_order || 100),
      scroll: item.scroll !== false && item.is_scrolling !== false,
      publishedAt: item.publishedAt || item.published_at || "",
    };
  }

  function sortItems(list) {
    return (list || []).slice().sort(function (a, b) {
      if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
      var sa = Number(a.sort || 100);
      var sb = Number(b.sort || 100);
      if (sa !== sb) return sa - sb;
      return (Date.parse(b.publishedAt || 0) || 0) - (Date.parse(a.publishedAt || 0) || 0);
    });
  }

  function lineText(item) {
    if (!item) return "";
    var title = item.title || "陪玩公告";
    var body = item.content || "";
    return String(body && body !== title ? title + "：" + body : title).replace(/\s+/g, " ").trim();
  }

  function tickerHtml(items) {
    if (!items.length) return "";
    var item = items[0];
    var text = lineText(item);
    var scroll = item.scroll !== false;
    return (
      '<div class="pw-announcement-bar" data-pw-announcement-bar role="region" aria-label="陪玩公告">' +
      '<span class="pw-announcement-label">陪玩公告</span>' +
      '<div class="pw-announcement-track-wrap">' +
      (scroll
        ? '<span class="pw-announcement-track"><span class="pw-announcement-seg">' +
          esc(text) +
          '</span><span class="pw-announcement-seg" aria-hidden="true">' +
          esc(text) +
          "</span></span>"
        : '<span class="pw-announcement-static">' + esc(text) + "</span>") +
      "</div></div>"
    );
  }

  function mount(html) {
    var host = document.querySelector("[data-pw-announcement-host]");
    if (!host) return;
    host.innerHTML = html || "";
    host.hidden = !html;
  }

  function load() {
    return fetch("/api/platform/content?types=announcements&audience=companion", {
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
        mount(tickerHtml(state.items));
        return state.items;
      })
      .catch(function () {
        state.items = [];
        state.loaded = true;
        mount("");
        return [];
      });
  }

  function start() {
    load();
    if (state.timer) clearInterval(state.timer);
    state.timer = setInterval(load, 30000);
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") load();
    });
  }

  window.MCJCompanionAnnouncements = {
    start: start,
    reload: load,
    renderHtml: function () {
      return tickerHtml(state.items);
    },
    hostHtml: function () {
      return '<div class="pw-announcement-host" data-pw-announcement-host' + (state.items.length ? "" : " hidden") + ">" + tickerHtml(state.items) + "</div>";
    },
    items: function () {
      return state.items.slice();
    },
  };
})();
