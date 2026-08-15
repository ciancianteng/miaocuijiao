(function () {
  "use strict";
  /**
   * Popularity admin panel — DISABLED for formal launch.
   * Plan A: keep nav entry; show notice only; never render rankings,
   * never call ranking write APIs, never use localStorage / defaultDb / mock lists.
   */
  var TARGET = "popularityManagement";
  var DISABLED = true;

  function noticeHtml() {
    return (
      '<div class="admin-sync-note" style="padding:18px;line-height:1.75" data-mcj-popularity-disabled-notice="1">' +
      "<strong>人气榜功能暂未开放</strong>" +
      '<p style="margin:10px 0 0">当前真实礼物 / 收藏 / 在线时长等数据链路尚未完整验收，暂不提供榜单重算。</p>' +
      '<p style="margin:8px 0 0" class="empty">已停用 · 不展示旧榜单 / mock 排名 · 不可保存规则 / 调分 / 手动加减分</p>' +
      "</div>"
    );
  }

  function paint() {
    var box = document.getElementById(TARGET);
    if (!box) return;
    box.setAttribute("data-mcj-popularity-disabled", "1");
    box.innerHTML = noticeHtml();
  }

  function isWriteAction(action) {
    var a = String(action || "").toLowerCase();
    return (
      a === "recompute" ||
      a === "save" ||
      a === "rules" ||
      a === "adjust" ||
      a === "reward" ||
      a === "approve" ||
      a.indexOf("write") >= 0
    );
  }

  /** Hard-block any residual ranking write UI / API from this page. */
  function blockWrites(e) {
    if (!DISABLED) return;
    var t = e.target;
    if (!t || !t.closest) return;
    var root = document.getElementById("section-popularity");
    if (!root || !root.contains(t)) return;

    var btn = t.closest("button, [type='submit'], a, [data-action], [data-pop-action]");
    if (!btn) return;
    var label = ((btn.textContent || "") + " " + (btn.getAttribute("aria-label") || "")).replace(/\s+/g, "");
    var action = btn.getAttribute("data-action") || btn.getAttribute("data-pop-action") || "";
    var looksWrite =
      isWriteAction(action) ||
      /重算|调分|保存规则|加减分|保存|发放|审核发放|启用榜单/.test(label);
    if (!looksWrite) return;
    e.preventDefault();
    e.stopPropagation();
    if (typeof e.stopImmediatePropagation === "function") e.stopImmediatePropagation();
    paint();
  }

  function blockFetch(url, opts) {
    if (!DISABLED) return false;
    var u = String(url || "");
    if (u.indexOf("/api/admin/popularity") < 0 && u.indexOf("/api/popularity") < 0) return false;
    var method = String((opts && opts.method) || "GET").toUpperCase();
    if (method === "GET" || method === "HEAD") return false;
    return true;
  }

  function installFetchGuard() {
    if (!DISABLED || window.__mcjPopularityWriteGuard) return;
    window.__mcjPopularityWriteGuard = true;
    var raw = window.fetch;
    if (typeof raw !== "function") return;
    window.fetch = function (input, init) {
      var url = typeof input === "string" ? input : input && input.url;
      if (blockFetch(url, init || (input && typeof input === "object" ? input : null))) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              ok: false,
              message: "人气榜功能暂未开放，已禁止榜单写入操作",
            }),
            { status: 503, headers: { "Content-Type": "application/json" } }
          )
        );
      }
      return raw.apply(this, arguments);
    };
  }

  function onSection(e) {
    var section = e && e.detail && e.detail.section;
    if (section === "popularity") paint();
  }

  installFetchGuard();
  document.addEventListener("click", blockWrites, true);
  document.addEventListener("submit", blockWrites, true);
  document.addEventListener("mcj:admin-section", onSection);
  document.addEventListener("DOMContentLoaded", paint);
  if (document.readyState !== "loading") paint();
})();
