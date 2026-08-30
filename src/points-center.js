/**
 * Boss points center — balance + ledger from GET /api/points (auth-scoped).
 * No fake data. Never sends user_id from the client.
 */
(function () {
  "use strict";
  var root = document.getElementById("pointsApp");
  if (!root) return;

  var state = {
    loading: true,
    error: "",
    message: "",
    account: { balance: 0, lifetimeEarned: 0, lifetimeSpent: 0 },
    ledger: [],
    tablesReady: true,
    orderCompletionPoints: 100,
  };

  function looksLikeJwt(raw) {
    var t = String(raw || "").trim();
    if (!t || t.length < 20) return false;
    var parts = t.split(".");
    return parts.length === 3 && parts.every(function (p) {
      return p.length > 0;
    });
  }

  function token() {
    if (window.MCJBossAuth && typeof window.MCJBossAuth.getAccessToken === "function") {
      var t = window.MCJBossAuth.getAccessToken();
      return looksLikeJwt(t) ? t : "";
    }
    try {
      var fallback =
        sessionStorage.getItem("mcjAuthAccessToken") || localStorage.getItem("mcjAuthAccessToken") || "";
      return looksLikeJwt(fallback) ? fallback : "";
    } catch (e) {
      return "";
    }
  }

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function date(v) {
    if (!v) return "-";
    try {
      return new Date(v).toLocaleString("zh-CN", { hour12: false });
    } catch (e) {
      return String(v);
    }
  }

  function shortOrder(id) {
    var s = String(id || "");
    if (!s) return "-";
    return s.length > 10 ? s.slice(0, 8) + "…" : s;
  }

  function paint() {
    if (!token()) {
      root.innerHTML =
        '<section class="panel"><h1>请先登录</h1><p style="color:#9ca3af">登录老板账号后可查看积分余额与记录。</p><p style="margin-top:14px"><a class="ghost-btn" href="index.html">返回首页登录</a></p></section>';
      return;
    }
    if (state.loading) {
      root.innerHTML = '<section class="panel">正在加载积分…</section>';
      return;
    }
    if (state.error) {
      root.innerHTML =
        '<section class="panel"><h1>积分读取失败</h1><p class="message show bad">' +
        esc(state.error) +
        '</p><p style="margin-top:14px"><button type="button" class="ghost-btn" data-points-refresh>重试</button> <a class="ghost-btn" href="mine.html">返回我的账号</a></p></section>';
      return;
    }

    var bal = Number(state.account.balance) || 0;
    var earned = Number(state.account.lifetimeEarned) || 0;
    var warn =
      state.message
        ? '<div class="message show warn">' + esc(state.message) + "</div>"
        : "";

    var rows = state.ledger || [];
    var awardPts = Number(state.orderCompletionPoints);
    if (!Number.isFinite(awardPts) || awardPts < 0) awardPts = 100;
    var ledgerHtml;
    if (!rows.length) {
      ledgerHtml =
        '<div class="empty">暂无积分记录<br>订单完成后将自动获得 +' +
        esc(awardPts) +
        " 积分。</div>";
    } else {
      ledgerHtml =
        '<div class="tx-head"><span>时间</span><span>变动</span><span>来源 / 原因</span><span>关联订单</span><span>状态</span></div><div class="ledger">' +
        rows
          .map(function (row) {
            var delta = Number(row.delta) || 0;
            var cls = delta >= 0 ? "plus" : "minus";
            var deltaText = row.deltaText || (delta > 0 ? "+" + delta : String(delta));
            var reason = row.reason || row.sourceLabel || "-";
            var oid = row.relatedOrderId || "";
            var orderCell = oid
              ? '<a href="orders.html?orderId=' +
                encodeURIComponent(oid) +
                '" title="' +
                esc(oid) +
                '">' +
                esc(shortOrder(oid)) +
                "</a>"
              : "<span>-</span>";
            return (
              '<div class="tx">' +
              "<span>" +
              esc(date(row.createdAt)) +
              "</span>" +
              '<strong class="' +
              cls +
              '">' +
              esc(deltaText) +
              "</strong>" +
              "<span>" +
              esc(reason) +
              (row.sourceLabel && row.reason && row.sourceLabel !== row.reason
                ? "<br><small style=\"color:#9ca3af\">" + esc(row.sourceLabel) + "</small>"
                : "") +
              "</span>" +
              orderCell +
              "<span>" +
              esc(row.statusText || "已入账") +
              "</span>" +
              "</div>"
            );
          })
          .join("") +
        "</div>";
    }

    root.innerHTML =
      '<section class="page-head"><div><h1>我的积分</h1><p>订单完成后自动到账。积分与猫粮钱包相互独立。</p></div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="ghost-btn" data-points-refresh>刷新</button><a class="ghost-btn" href="mine.html">返回我的账号</a><a class="ghost-btn" href="orders.html">我的订单</a></div></section>' +
      warn +
      '<section class="stats"><div class="stat"><span>当前积分余额</span><strong>' +
      esc(bal) +
      '</strong></div><div class="stat"><span>累计获得积分</span><strong>' +
      esc(earned) +
      "</strong></div></section>" +
      '<section class="panel"><h2>积分记录</h2>' +
      ledgerHtml +
      "</section>";
  }

  async function load() {
    if (!token()) {
      state.loading = false;
      state.error = "";
      paint();
      return;
    }
    state.loading = true;
    state.error = "";
    paint();
    try {
      var res = await fetch("/api/points?limit=50", {
        headers: {
          Accept: "application/json",
          Authorization: "Bearer " + token(),
        },
        cache: "no-store",
      });
      var body = await res.json().catch(function () {
        return {};
      });
      if (!res.ok || body.ok === false) {
        throw new Error(body.message || "积分读取失败");
      }
      state.account = body.account || { balance: 0, lifetimeEarned: 0, lifetimeSpent: 0 };
      state.ledger = Array.isArray(body.ledger) ? body.ledger : [];
      state.tablesReady = body.tablesReady !== false;
      state.message = body.message || "";
      var pts = Number(body.orderCompletionPoints);
      state.orderCompletionPoints = Number.isFinite(pts) && pts >= 0 ? pts : 100;
    } catch (err) {
      state.error = (err && err.message) || "积分读取失败";
      state.account = { balance: 0, lifetimeEarned: 0, lifetimeSpent: 0 };
      state.ledger = [];
    } finally {
      state.loading = false;
      paint();
    }
  }

  root.addEventListener("click", function (e) {
    if (e.target.closest("[data-points-refresh]")) {
      e.preventDefault();
      load();
    }
  });

  document.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-logout]");
    if (!btn) return;
    e.preventDefault();
    try {
      if (window.MCJBossAuth && typeof window.MCJBossAuth.clearSession === "function") {
        window.MCJBossAuth.clearSession();
      }
    } catch (err) {}
    location.href = "index.html";
  });

  load();
})();
