(function () {
  "use strict";
  var PAGE = 30;
  var state = {
    items: [],
    total: 0,
    offset: 0,
    hasMore: false,
    loading: true,
    loadingMore: false,
    error: "",
  };

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function formatUnits(v) {
    var n = Number(v || 0);
    if (!Number.isFinite(n) || n <= 0) return "0";
    if (Number.isInteger(n)) return String(n);
    return String(Math.round(n * 100) / 100);
  }
  function avatar(v) {
    var s = String(v || "").trim();
    if (!s) return "/default-avatar.png";
    return s;
  }
  function profileHref(item) {
    var id = String(item.companionId || "").trim();
    if (!id) return "companion-center.html";
    return "profile.html?id=" + encodeURIComponent(id);
  }
  function levelId(item) {
    return String(item.levelId || "").trim().toLowerCase();
  }
  function topClass(rank) {
    if (rank === 1) return " top-1";
    if (rank === 2) return " top-2";
    if (rank === 3) return " top-3";
    return "";
  }

  function rowHtml(item) {
    var r = Number(item.rank) || 0;
    var lid = levelId(item);
    return (
      '<a class="rank-hist-row' +
      topClass(r) +
      '"' +
      (lid ? ' data-level-id="' + esc(lid) + '" data-companion-level="' + esc(lid) + '"' : "") +
      ' href="' +
      esc(profileHref(item)) +
      '">' +
      '<span class="rank-border-flow" aria-hidden="true"></span>' +
      '<div class="rank-hist-no">' +
      esc(r) +
      "</div>" +
      '<img src="' +
      esc(avatar(item.avatar)) +
      '" alt="" loading="lazy" decoding="async" onerror="this.onerror=null;this.src=\'/default-avatar.png\'">' +
      '<div class="rank-hist-main"><strong>' +
      esc(item.nickname || "未命名陪玩") +
      "</strong>" +
      (item.level
        ? '<span class="companion-level-pill" data-level-id="' +
          esc(lid) +
          '">' +
          esc(item.level) +
          "</span>"
        : "") +
      "</div>" +
      '<div class="rank-hist-units"><b>累计 ' +
      esc(formatUnits(item.completedOrders)) +
      " <em>单</em></b></div>" +
      "</a>"
    );
  }

  function paint() {
    var box = document.getElementById("rankBoard");
    if (!box) return;
    if (state.loading && !state.items.length) {
      box.innerHTML = '<div class="pop-empty">正在读取俱乐部总接单榜...</div>';
      return;
    }
    if (state.error && !state.items.length) {
      box.innerHTML = '<div class="pop-empty">' + esc(state.error) + "</div>";
      return;
    }
    var items = (state.items || []).filter(function (it) {
      return it && Number(it.completedOrders || 0) > 0;
    });
    if (!items.length) {
      box.innerHTML = '<div class="pop-empty">暂无累计接单陪玩</div>';
      return;
    }
    var more = state.hasMore
      ? '<button type="button" class="rank-hist-more" id="rankLoadMore"' +
        (state.loadingMore ? " disabled" : "") +
        ">" +
        (state.loadingMore ? "加载中..." : "加载更多") +
        "</button>"
      : "";
    box.innerHTML = '<div class="rank-hist-list">' + items.map(rowHtml).join("") + "</div>" + more;
  }

  function fetchPage(append) {
    if (append) {
      if (state.loadingMore || !state.hasMore) return;
      state.loadingMore = true;
    } else {
      state.loading = true;
      state.error = "";
      state.items = [];
      state.offset = 0;
    }
    paint();
    var offset = append ? state.offset : 0;
    fetch(
      "/api/popularity?action=total_completed&limit=" + PAGE + "&offset=" + encodeURIComponent(offset),
      { headers: { Accept: "application/json" }, cache: "no-store" }
    )
      .then(function (res) {
        return res.json().then(function (body) {
          if (!res.ok || body.ok === false) throw new Error(body.message || "读取失败");
          return body;
        });
      })
      .then(function (body) {
        var chunk = body.items || [];
        state.items = append ? state.items.concat(chunk) : chunk;
        state.total = Number(body.total || state.items.length) || 0;
        state.offset = (Number(body.offset) || offset) + chunk.length;
        state.hasMore = body.hasMore === true;
        state.error = "";
      })
      .catch(function (err) {
        if (!append) {
          state.items = [];
          state.error = (err && err.message) || "榜单暂不可用";
        }
      })
      .finally(function () {
        state.loading = false;
        state.loadingMore = false;
        paint();
      });
  }

  document.addEventListener("click", function (e) {
    var btn = e.target && e.target.closest ? e.target.closest("#rankLoadMore") : null;
    if (!btn) return;
    fetchPage(true);
  });

  fetchPage(false);
})();
