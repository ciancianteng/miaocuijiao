/**
 * Boss · 我的直属陪玩（只读列表）
 */
(function () {
  "use strict";
  var root = document.getElementById("directCompanionsApp");
  if (!root) return;

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function token() {
    if (window.MCJBossAuth && typeof window.MCJBossAuth.getAccessToken === "function") {
      return window.MCJBossAuth.getAccessToken() || "";
    }
    try {
      return (
        sessionStorage.getItem("mcjAuthAccessToken") ||
        localStorage.getItem("mcjAuthAccessToken") ||
        localStorage.getItem("access_token") ||
        sessionStorage.getItem("access_token") ||
        ""
      );
    } catch (e) {
      return "";
    }
  }

  function paint(html) {
    root.innerHTML = html;
  }

  function load() {
    if (!token()) {
      paint(
        '<section class="page-head"><h1>我的直属陪玩</h1><p>请先登录老板账号</p></section>' +
          '<p class="message bad">未登录</p><p><a class="ghost-btn" href="mine.html">去登录</a></p>'
      );
      return;
    }
    paint(
      '<section class="page-head"><h1>我的直属陪玩</h1><p>仅显示当前生效的直属陪玩（只读）</p></section><div class="empty">加载中…</div>'
    );
    var headers = { Accept: "application/json", Authorization: "Bearer " + token() };
    fetch("/api/boss/direct-companions", { headers: headers, cache: "no-store" })
      .then(function (res) {
        return res.json().then(function (body) {
          if (!res.ok || body.ok === false) throw new Error(body.message || "读取直属陪玩失败");
          return body;
        });
      })
      .then(function (body) {
        var list = body.companions || [];
        var rows =
          list
            .map(function (r) {
              var c = r.companion || {};
              return (
                '<div class="row">' +
                "<div><strong>" +
                esc(c.displayName || "陪玩") +
                '</strong><span style="display:block;margin-top:4px">' +
                esc(c.companionCode || c.id || "") +
                "</span></div>" +
                "<div><span>状态</span><strong style='display:block;margin-top:4px'>" +
                esc(r.status === "active" ? "生效中" : r.status || "-") +
                "</strong></div>" +
                "<div><span>绑定时间</span><strong style='display:block;margin-top:4px'>" +
                esc(r.boundAt ? String(r.boundAt).replace("T", " ").slice(0, 19) : "-") +
                "</strong></div>" +
                "</div>"
              );
            })
            .join("") || '<div class="empty">暂无直属陪玩<br>由后台管理员绑定后显示</div>';

        var note = "";
        if (body.tablesReady === false) {
          note = '<p class="message">直属关系功能尚未开通</p>';
        }

        paint(
          '<section class="page-head"><div><h1>我的直属陪玩</h1><p>仅显示当前生效的直属陪玩（只读）。</p></div>' +
            '<a class="ghost-btn" href="mine.html">返回我的账号</a></section>' +
            note +
            '<section class="panel"><h2>生效中（' +
            list.length +
            '）</h2><div class="list">' +
            rows +
            "</div></section>"
        );
      })
      .catch(function (err) {
        paint(
          '<section class="page-head"><h1>我的直属陪玩</h1></section>' +
            '<p class="message bad">' +
            esc(err.message || "读取失败") +
            "</p>"
        );
      });
  }

  document.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-logout]");
    if (!btn) return;
    if (window.MCJBossAuth && window.MCJBossAuth.clearSession) window.MCJBossAuth.clearSession();
    if (window.MCJRoleGate) {
      window.MCJRoleGate.logout("boss");
      window.MCJRoleGate.logout("customer");
    }
    location.href = "index.html";
  });

  load();
})();
