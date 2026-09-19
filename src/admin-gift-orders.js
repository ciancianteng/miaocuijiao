(function () {
  "use strict";
  var Auth = window.MCJAdminAuthFetch;
  var TARGET = "giftOrderManagement";
  var state = { loading: true, orders: [], error: "", filter: "all" };

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function role() {
    try {
      return JSON.parse(localStorage.getItem("adminUser") || sessionStorage.getItem("adminUser") || "{}").adminRole || "admin";
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
  function statusLabel(st) {
    return (
      {
        pending_payment: "待付款",
        payment_submitted: "已提交付款",
        under_review: "待审核",
        approved: "已通过",
        rejected: "已拒绝",
        cancelled: "已取消",
      }[st] || st || "-"
    );
  }
  function target() {
    return document.getElementById(TARGET);
  }
  function paint() {
    var box = target();
    if (!box) return;
    if (state.loading) {
      box.innerHTML = '<div class="admin-sync-note">正在读取礼物订单...</div>';
      return;
    }
    if (state.error) {
      box.innerHTML =
        '<div class="admin-sync-note">' +
        esc(state.error) +
        ' <button class="mini-btn" data-gift-order-reload>重试</button></div>';
      return;
    }
    var filters = [
      ["all", "全部"],
      ["under_review", "待审核"],
      ["approved", "已通过"],
      ["rejected", "已拒绝"],
    ];
    var tabs = filters
      .map(function (f) {
        return (
          '<button type="button" class="mini-btn' +
          (state.filter === f[0] ? " active" : "") +
          '" data-gift-order-filter="' +
          f[0] +
          '">' +
          f[1] +
          "</button>"
        );
      })
      .join(" ");
    var rows = (state.orders || [])
      .map(function (o) {
        return (
          "<tr><td>" +
          esc(o.orderNo || o.id) +
          "</td><td>" +
          esc(o.senderName || o.senderBossId || "-") +
          "</td><td>" +
          esc(o.receiverName || o.receiverCompanionId || "-") +
          "</td><td>" +
          esc(o.giftName || "-") +
          " ×" +
          esc(o.quantity) +
          "</td><td>" +
          esc(o.totalAmount) +
          '</td><td>' +
          esc(statusLabel(o.status)) +
          "</td><td>" +
          esc(o.reviewedByName || "-") +
          "</td><td>" +
          (o.paymentProofUrl
            ? '<a href="' + esc(o.paymentProofUrl) + '" target="_blank" rel="noopener">截图</a>'
            : "-") +
          "</td></tr>"
        );
      })
      .join("");
    box.innerHTML =
      '<div class="admin-section-head compact"><div><h3>礼物订单</h3><p>与客服审核同一套 gift_orders 数据。</p></div><div>' +
      tabs +
      ' <button class="mini-btn" data-gift-order-reload>刷新</button></div></div>' +
      (rows
        ? '<div class="table-wrap"><table class="admin-table"><thead><tr><th>订单号</th><th>老板</th><th>陪玩</th><th>礼物</th><th>金额</th><th>状态</th><th>审核人</th><th>凭证</th></tr></thead><tbody>' +
          rows +
          "</tbody></table></div>"
        : '<div class="empty">暂无礼物订单</div>');
  }
  function load() {
    state.loading = true;
    state.error = "";
    paint();
    api("/api/admin/gift-orders?status=" + encodeURIComponent(state.filter || "all"))
      .then(function (body) {
        state.orders = body.orders || [];
        state.loading = false;
        paint();
      })
      .catch(function (err) {
        state.loading = false;
        state.error = err.message || "加载失败";
        paint();
      });
  }
  document.addEventListener("click", function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    if (t.closest("[data-gift-order-reload]")) {
      load();
      return;
    }
    var f = t.closest("[data-gift-order-filter]");
    if (f) {
      state.filter = f.getAttribute("data-gift-order-filter") || "all";
      load();
    }
  });
  document.addEventListener("mcj:admin-section", function (ev) {
    if (ev && ev.detail && ev.detail.section === "gift-orders") load();
  });
  if (document.getElementById(TARGET)) load();
})();
