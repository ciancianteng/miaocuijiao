(function () {
  "use strict";
  var Auth = window.MCJAdminAuthFetch;
  var TARGET = "rechargeReviewMount";
  var ALT = "table-recharge_requests_alt";
  var state = { loading: true, error: "", message: "", pending: [], recent: [], tab: "pending" };

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function role() {
    try {
      var u = JSON.parse(localStorage.getItem("adminUser") || sessionStorage.getItem("adminUser") || "{}");
      return u.adminRole || u.role || "admin";
    } catch (e) {
      return "admin";
    }
  }
  function api(path, opts) {
    opts = opts || {};
    opts.headers = Object.assign({ Accept: "application/json", "x-mcj-admin-role": role() }, opts.headers || {});
    return (Auth && Auth.fetch ? Auth.fetch(path, opts) : fetch(path, opts)).then(function (res) {
      return res.json().then(function (body) {
        if (!res.ok || body.ok === false) throw new Error(body.message || "请求失败");
        return body;
      });
    });
  }
  function target() {
    return document.getElementById(TARGET) || document.getElementById("table-recharge_requests");
  }
  function statusLabel(s) {
    var m = {
      pending_payment: "待确认到账",
      pending_review: "待人工审核",
      pending: "待确认到账",
      paid: "已到账",
      credited: "已到账",
      failed: "失败",
      cancelled: "已取消",
    };
    return m[String(s || "").toLowerCase()] || s || "-";
  }
  function rowsHtml(list, withConfirm) {
    if (!(list || []).length) {
      return '<div class="admin-empty" style="padding:18px;color:#9ca3af">暂无' + (withConfirm ? "待确认" : "") + "充值单</div>";
    }
    return (
      '<div class="table-wrap"><table class="admin-table"><thead><tr>' +
      "<th>充值单号</th><th>老板</th><th>金额 RM</th><th>猫粮</th><th>支付方式</th><th>付款截图</th><th>状态</th><th>创建时间</th><th>操作</th>" +
      "</tr></thead><tbody>" +
      list
        .map(function (r) {
          var proofCell = r.proofUrl
            ? '<a href="' + esc(r.proofUrl) + '" target="_blank" rel="noopener">查看截图</a>'
            : r.hasProof
              ? "已上传"
              : "-";
          var actions = withConfirm
            ? '<button type="button" class="mini-btn primary-lite" data-confirm-recharge="' +
              esc(r.paymentNo) +
              '">确认到账</button>'
            : "-";
          return (
            "<tr>" +
            "<td><strong>" +
            esc(r.paymentNo) +
            "</strong></td>" +
            "<td>" +
            esc(r.bossName) +
            "</td>" +
            "<td>" +
            esc(r.amountRm) +
            "</td>" +
            "<td>" +
            esc(r.catFoodAmount) +
            (r.bonusCatFood ? " +" + esc(r.bonusCatFood) : "") +
            "</td>" +
            "<td>" +
            esc(r.paymentMethod) +
            "</td>" +
            "<td>" +
            proofCell +
            "</td>" +
            "<td>" +
            esc(statusLabel(r.status)) +
            "</td>" +
            "<td>" +
            esc(String(r.createdAt || "").replace("T", " ").slice(0, 19)) +
            "</td>" +
            "<td>" +
            actions +
            "</td>" +
            "</tr>"
          );
        })
        .join("") +
      "</tbody></table></div>"
    );
  }
  function paint() {
    var box = target();
    if (!box) return;
    if (state.loading) {
      box.innerHTML = '<div class="admin-empty" style="padding:18px">加载充值审核队列…</div>';
      return;
    }
    if (state.error) {
      box.innerHTML =
        '<div class="admin-empty" style="padding:18px;color:#ff6b7a">' +
        esc(state.error) +
        ' <button type="button" class="mini-btn" data-recharge-reload>重试</button></div>';
      return;
    }
    box.innerHTML =
      '<div class="admin-section-head compact" style="margin-bottom:10px">' +
      "<div><p class=\"muted\" style=\"margin:0\">线下 / 手动充值待确认到账；确认后猫粮立即入账。陪玩提现与客服工资请到「周结算」。</p></div>" +
      '<div style="display:flex;gap:8px;align-items:center">' +
      (state.message ? '<span class="muted">' + esc(state.message) + "</span>" : "") +
      '<button type="button" class="mini-btn" data-recharge-tab="pending">待确认 (' +
      (state.pending || []).length +
      ")</button>" +
      '<button type="button" class="mini-btn" data-recharge-tab="recent">最近已到账</button>' +
      '<button type="button" class="mini-btn" data-recharge-reload>刷新</button>' +
      "</div></div>" +
      (state.tab === "recent" ? rowsHtml(state.recent, false) : rowsHtml(state.pending, true));

    var alt = document.getElementById(ALT);
    if (alt && alt !== box) {
      alt.innerHTML =
        '<p class="muted" style="margin:0 0 8px">最近已到账充值（真实 payment_orders）</p>' + rowsHtml(state.recent, false);
    }
  }
  function load() {
    state.loading = true;
    state.error = "";
    paint();
    return Promise.all([
      api("/api/admin/wallet?action=pending_recharges&status=pending_payment"),
      api("/api/admin/wallet?action=pending_recharges&status=paid"),
    ])
      .then(function (results) {
        state.pending = (results[0] && results[0].items) || [];
        state.recent = ((results[1] && results[1].items) || []).slice(0, 50);
        state.loading = false;
        paint();
      })
      .catch(function (err) {
        state.loading = false;
        state.error = err.message || "加载失败";
        paint();
      });
  }
  function confirmPaid(paymentNo) {
    if (!paymentNo) return;
    if (!confirm("确认该充值已到账并给老板入账猫粮？\n单号：" + paymentNo)) return;
    api("/api/admin/wallet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "confirm_manual_recharge", paymentNo: paymentNo }),
    })
      .then(function (res) {
        state.message = res.message || "已确认到账";
        return load();
      })
      .catch(function (err) {
        alert(err.message || "确认失败");
      });
  }
  function bind() {
    document.addEventListener("click", function (e) {
      var reload = e.target.closest("[data-recharge-reload]");
      if (reload) {
        load();
        return;
      }
      var tab = e.target.closest("[data-recharge-tab]");
      if (tab) {
        state.tab = tab.getAttribute("data-recharge-tab") || "pending";
        paint();
        return;
      }
      var btn = e.target.closest("[data-confirm-recharge]");
      if (btn) confirmPaid(btn.getAttribute("data-confirm-recharge"));
    });
  }

  function boot() {
    if (!target() && !document.getElementById(ALT)) return;
    bind();
    load();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  window.MCJAdminRechargeReview = { reload: load };
})();
