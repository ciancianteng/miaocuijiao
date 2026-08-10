(function () {
  "use strict";
  var Auth = window.MCJAdminAuthFetch;
  var TARGET = "rechargeReviewMount";
  var ALT = "table-recharge_requests_alt";
  var state = { loading: true, error: "", message: "", pending: [], recent: [], rejected: [], tab: "pending" };

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
    return (
      document.getElementById(TARGET) ||
      document.getElementById("table-recharge_requests") ||
      document.querySelector("#section-recharge-center .panel")
    );
  }
  function statusLabel(s) {
    var m = {
      pending_payment: "待支付",
      pending: "待支付",
      pending_review: "待审核",
      paid: "已到账",
      credited: "已到账",
      rejected: "已拒绝",
      failed: "失败",
      cancelled: "已取消",
    };
    return m[String(s || "").toLowerCase()] || s || "-";
  }
  function rowsHtml(list, mode) {
    if (!(list || []).length) {
      return '<div class="admin-empty" style="padding:18px;color:#9ca3af">暂无' + (mode === "pending" ? "待审核" : "") + "充值单</div>";
    }
    return (
      '<div class="table-wrap"><table class="admin-table"><thead><tr>' +
      "<th>充值单号</th><th>老板 / ID</th><th>应付 RM</th><th>猫粮(基础+赠送)</th><th>支付方式</th><th>付款截图</th><th>状态</th><th>时间</th><th>操作</th>" +
      "</tr></thead><tbody>" +
      list
        .map(function (r) {
          var proof = r.proofUrl
            ? '<a href="' +
              esc(r.proofUrl) +
              '" target="_blank" rel="noopener"><img src="' +
              esc(r.proofUrl) +
              '" alt="付款截图" style="width:64px;height:64px;object-fit:cover;border-radius:8px;border:1px solid rgba(255,255,255,.12);background:#111" data-mcj-pay-qr="1"></a>'
            : '<span class="muted">无截图</span>';
          var actions = "-";
          if (mode === "pending") {
            actions =
              '<div style="display:flex;flex-wrap:wrap;gap:6px">' +
              '<button type="button" class="mini-btn primary-lite" data-confirm-recharge="' +
              esc(r.paymentNo) +
              '">审核通过</button>' +
              '<button type="button" class="mini-btn" data-reject-recharge="' +
              esc(r.paymentNo) +
              '">拒绝</button></div>';
          }
          return (
            "<tr>" +
            "<td><strong>" +
            esc(r.paymentNo) +
            "</strong></td>" +
            "<td>" +
            esc(r.bossName) +
            "<br><small class=\"muted\">" +
            esc(r.bossId) +
            "</small></td>" +
            "<td>" +
            esc(r.amountRm) +
            "</td>" +
            "<td>" +
            esc(r.paidCatFood || r.catFoodAmount) +
            " +" +
            esc(r.bonusCatFood || 0) +
            " = " +
            esc(r.totalCatFood || r.catFoodAmount) +
            "</td>" +
            "<td>" +
            esc(r.paymentMethod) +
            "</td>" +
            "<td>" +
            proof +
            "</td>" +
            "<td>" +
            esc(statusLabel(r.status)) +
            (r.rejectReason ? "<br><small>" + esc(r.rejectReason) + "</small>" : "") +
            "</td>" +
            "<td>" +
            esc(String(r.submittedAt || r.createdAt || "").replace("T", " ").slice(0, 19)) +
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
    if (box.id !== TARGET && box.id !== "table-recharge_requests") {
      // Ensure mount node inside section panel
      var mount = document.getElementById("table-recharge_requests");
      if (!mount) {
        box.innerHTML = '<h2>猫粮充值审核</h2><div id="table-recharge_requests"></div>';
        box = document.getElementById("table-recharge_requests");
      } else box = mount;
    }
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
      '<div><h2 style="margin:0 0 6px;font-size:18px">猫粮充值审核</h2><p class="muted" style="margin:0">老板上传付款截图后进入待审核；审核通过后猫粮入账（幂等，不可重复加）。</p></div>' +
      '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
      (state.message ? '<span class="muted">' + esc(state.message) + "</span>" : "") +
      '<button type="button" class="mini-btn" data-recharge-tab="pending">待审核 (' +
      (state.pending || []).length +
      ")</button>" +
      '<button type="button" class="mini-btn" data-recharge-tab="recent">已到账</button>' +
      '<button type="button" class="mini-btn" data-recharge-tab="rejected">已拒绝</button>' +
      '<button type="button" class="mini-btn" data-recharge-reload>刷新</button>' +
      "</div></div>" +
      (state.tab === "recent"
        ? rowsHtml(state.recent, "recent")
        : state.tab === "rejected"
          ? rowsHtml(state.rejected, "rejected")
          : rowsHtml(state.pending, "pending"));

    var alt = document.getElementById(ALT);
    if (alt && alt !== box) {
      alt.innerHTML =
        '<p class="muted" style="margin:0 0 8px">最近已到账充值（真实 payment_orders）</p>' + rowsHtml(state.recent, "recent");
    }
  }
  function load() {
    state.loading = true;
    state.error = "";
    paint();
    return Promise.all([
      api("/api/admin/wallet?action=pending_recharges&status=pending_review"),
      api("/api/admin/wallet?action=pending_recharges&status=paid"),
      api("/api/admin/wallet?action=pending_recharges&status=rejected"),
    ])
      .then(function (results) {
        state.pending = ((results[0] && results[0].items) || []).filter(function (r) {
          return !!r.proofUrl || String(r.status) === "pending_review";
        });
        state.recent = ((results[1] && results[1].items) || []).slice(0, 50);
        state.rejected = ((results[2] && results[2].items) || []).slice(0, 50);
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
    if (!confirm("确认审核通过并给老板入账猫粮？\n单号：" + paymentNo + "\n（重复点击不会重复加猫粮）")) return;
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
  function rejectPaid(paymentNo) {
    if (!paymentNo) return;
    var reason = prompt("请填写拒绝原因（将展示给老板）：", "");
    if (reason == null) return;
    reason = String(reason || "").trim();
    if (!reason) {
      alert("必须填写拒绝原因");
      return;
    }
    api("/api/admin/wallet", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reject_manual_recharge", paymentNo: paymentNo, reason: reason }),
    })
      .then(function (res) {
        state.message = res.message || "已拒绝";
        return load();
      })
      .catch(function (err) {
        alert(err.message || "拒绝失败");
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
      if (btn) {
        confirmPaid(btn.getAttribute("data-confirm-recharge"));
        return;
      }
      var reject = e.target.closest("[data-reject-recharge]");
      if (reject) rejectPaid(reject.getAttribute("data-reject-recharge"));
    });
  }

  function boot() {
    if (!document.getElementById("section-recharge-center") && !document.getElementById("table-recharge_requests") && !document.getElementById(TARGET)) {
      return;
    }
    bind();
    load();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();

  window.MCJAdminRechargeReview = { reload: load };
})();
