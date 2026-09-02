/**
 * Admin · Boss 分成结算审计（只读）
 * 复用现有 /api/admin/orders，不改 API / 结算规则。
 * 挂在直属关系管理 section 内，不新增侧栏导航。
 */
(function () {
  "use strict";
  var Auth = window.MCJAdminAuthFetch;
  var TARGET = "bossCommissionAuditMount";
  var state = { loading: true, error: "", orders: [], busy: false };

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function money(v) {
    var n = Number(v);
    return Number.isFinite(n) ? n.toFixed(2) : "-";
  }

  function role() {
    try {
      return (
        JSON.parse(localStorage.getItem("adminUser") || sessionStorage.getItem("adminUser") || "{}")
          .adminRole || "admin"
      );
    } catch (e) {
      return "admin";
    }
  }

  function api(path) {
    return (Auth && Auth.fetch ? Auth.fetch(path, { headers: { Accept: "application/json", "x-mcj-admin-role": role() } }) : fetch(path, { headers: { Accept: "application/json", "x-mcj-admin-role": role() } })).then(function (res) {
      return res.json().then(function (body) {
        if (!res.ok || body.ok === false) throw new Error(body.message || "请求失败");
        return body;
      });
    });
  }

  function paint() {
    var box = document.getElementById(TARGET);
    if (!box) return;
    if (state.loading) {
      box.innerHTML = '<div class="admin-sync-note">正在读取分成结算审计…</div>';
      return;
    }
    var tip = state.error
      ? '<p class="admin-sync-note" style="color:#ff8aa0">' + esc(state.error) + "</p>"
      : "";
    var rows = state.orders || [];
    var totalBoss = rows.reduce(function (s, o) {
      return s + Number(o.bossCommissionAmount || 0);
    }, 0);
    var totalFee = rows.reduce(function (s, o) {
      return s + Number(o.platformFee || 0);
    }, 0);
    var table =
      rows
        .map(function (o) {
          return (
            "<tr>" +
            "<td><code>" +
            esc(String(o.id || "").slice(0, 8)) +
            "</code></td>" +
            "<td>" +
            esc(o.bossName || o.bossUid || "-") +
            "</td>" +
            "<td>" +
            esc(o.companionName || "-") +
            "</td>" +
            "<td>" +
            money(o.amount != null ? o.amount : o.totalAmount) +
            "</td>" +
            "<td>" +
            money(o.platformFee) +
            "</td>" +
            "<td>" +
            money(o.bossCommissionAmount) +
            " <span class='admin-sync-note'>(" +
            esc(o.bossCommissionRate != null ? o.bossCommissionRate + "%" : "-") +
            ")</span></td>" +
            "<td>" +
            money(o.companionIncome != null ? o.companionIncome : o.playerIncome) +
            "</td>" +
            "<td>" +
            esc(o.bossLevelCode || "-") +
            "</td>" +
            "<td>" +
            esc(o.settlementStatus || o.status || "-") +
            "</td>" +
            "</tr>"
          );
        })
        .join("") || '<tr><td colspan="9" class="empty">暂无带 Boss 分成快照的已结算订单</td></tr>';

    box.innerHTML =
      tip +
      '<div class="bcr-hero"><h3>分成结算审计</h3><p>只读快照。公式：Boss 分成 = 平台抽成 × 分成%。历史订单不因等级变更改写。</p></div>' +
      '<div class="bcr-money-split">' +
      '<div class="step"><span>审计笔数</span><strong>' +
      rows.length +
      "</strong></div>" +
      '<div class="step fee"><span>平台抽成合计</span><strong>' +
      money(totalFee) +
      "</strong></div>" +
      '<div class="step boss"><span>Boss 分成合计</span><strong>' +
      money(totalBoss) +
      "</strong></div>" +
      '<div class="step comp"><span>口径</span><strong style="font-size:13px">不扣陪玩</strong></div>' +
      "</div>" +
      '<div class="admin-toolbar" style="display:flex;gap:8px;margin-bottom:12px">' +
      '<button type="button" class="ghost-btn" data-bca-reload' +
      (state.busy ? " disabled" : "") +
      ">刷新审计</button>" +
      "</div>" +
      '<div class="table-wrap"><table class="data-table"><thead><tr><th>订单</th><th>老板</th><th>陪玩</th><th>金额</th><th>平台抽成</th><th>Boss 分成</th><th>陪玩收入</th><th>等级快照</th><th>结算</th></tr></thead><tbody>' +
      table +
      "</tbody></table></div>";
  }

  function load() {
    state.loading = true;
    state.error = "";
    paint();
    return api("/api/admin/orders?limit=80")
      .then(function (body) {
        var all = body.orders || body.items || [];
        state.orders = all
          .filter(function (o) {
            return Number(o.bossCommissionAmount || 0) > 0 || Number(o.platformFee || 0) > 0;
          })
          .slice(0, 40);
        state.loading = false;
        paint();
      })
      .catch(function (err) {
        state.loading = false;
        state.error = err.message || "读取失败";
        paint();
      });
  }

  document.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-bca-reload]");
    if (!btn) return;
    e.preventDefault();
    load();
  });

  function maybeLoad() {
    if (!document.getElementById(TARGET)) return;
    load();
  }

  document.addEventListener("click", function (e) {
    var nav = e.target.closest('[data-section="boss-companion-relations"]');
    if (nav) setTimeout(maybeLoad, 0);
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", maybeLoad);
  } else {
    maybeLoad();
  }
})();
