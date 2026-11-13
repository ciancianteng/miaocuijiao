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
  function looksLikeUuid(v) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || "").trim());
  }
  function personLabel(name, id) {
    var n = String(name || "").trim();
    if (n && !looksLikeUuid(n)) return n;
    return id ? "已删除账号" : "未知用户";
  }
  function giftLabel(name) {
    var n = String(name || "").trim();
    if (n && !looksLikeUuid(n)) return n;
    return "未知礼物";
  }
  function orderNoLabel(o) {
    var n = String((o && (o.orderNo || o.order_no)) || "").trim();
    if (n && !looksLikeUuid(n)) return n;
    return "礼物订单";
  }
  function fmtTime(v) {
    if (!v) return "-";
    var d = new Date(v);
    if (isNaN(d.getTime())) return String(v);
    var p = function (n) {
      return n < 10 ? "0" + n : String(n);
    };
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }
  function ensureCss() {
    if (document.getElementById("admin-gift-order-css")) return;
    var style = document.createElement("style");
    style.id = "admin-gift-order-css";
    style.textContent =
      ".ago-filters{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 12px}" +
      ".ago-table-wrap{overflow:auto}" +
      ".ago-cards{display:none}" +
      ".ago-card{border:1px solid rgba(255,158,207,.22);border-radius:14px;background:#140c18;padding:12px;margin:0 0 10px}" +
      ".ago-card header{display:flex;justify-content:space-between;gap:8px;margin-bottom:8px}" +
      ".ago-card header strong{color:#fff}" +
      ".ago-card header em{font-style:normal;color:#ffb6d9;font-size:12px;font-weight:700}" +
      ".ago-card dl{margin:0;display:grid;gap:6px}" +
      ".ago-card dl div{display:flex;justify-content:space-between;gap:10px;font-size:13px;color:#f3d6e6}" +
      ".ago-card dt{color:rgba(255,214,231,.65)}" +
      ".ago-card dd{margin:0;text-align:right;overflow-wrap:anywhere;min-width:0}" +
      ".ago-card-actions{margin-top:10px}" +
      ".ago-detail{margin-top:8px;color:rgba(255,214,231,.7);font-size:12px;overflow-wrap:anywhere}" +
      "@media(max-width:900px){.ago-table-wrap{display:none}.ago-cards{display:block}#section-gift-orders .panel>h2{display:none}}";
    document.head.appendChild(style);
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
    ensureCss();
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
    var rowsHtml = (state.orders || [])
      .map(function (o) {
        var sender = personLabel(o.senderName, o.senderBossId);
        var receiver = personLabel(o.receiverName, o.receiverCompanionId);
        var gname = giftLabel(o.giftName);
        var no = orderNoLabel(o);
        var when = fmtTime(o.createdAt);
        var st = statusLabel(o.status);
        var detailBtn = '<button type="button" class="mini-btn" data-gift-order-detail="' + esc(o.id) + '">详情</button>';
        return {
          tr:
            "<tr><td>" +
            esc(no) +
            "</td><td>" +
            esc(sender) +
            "</td><td>" +
            esc(receiver) +
            "</td><td>" +
            esc(gname) +
            (o.quantity ? " ×" + esc(o.quantity) : "") +
            "</td><td>" +
            esc(o.totalAmount) +
            "</td><td>" +
            esc(st) +
            "</td><td>" +
            esc(when) +
            "</td><td>" +
            (o.paymentProofUrl ? '<a href="' + esc(o.paymentProofUrl) + '" target="_blank" rel="noopener">截图</a> ' : "") +
            detailBtn +
            "</td></tr>",
          card:
            '<article class="ago-card"><header><strong>' +
            esc(no) +
            "</strong><em>" +
            esc(st) +
            "</em></header><dl>" +
            "<div><dt>陪玩</dt><dd>" +
            esc(receiver) +
            "</dd></div>" +
            "<div><dt>送礼用户</dt><dd>" +
            esc(sender) +
            "</dd></div>" +
            "<div><dt>礼物</dt><dd>" +
            esc(gname) +
            (o.quantity ? " ×" + esc(o.quantity) : "") +
            "</dd></div>" +
            "<div><dt>金额</dt><dd>" +
            esc(o.totalAmount) +
            "</dd></div>" +
            "<div><dt>创建时间</dt><dd>" +
            esc(when) +
            "</dd></div></dl><div class='ago-card-actions'>" +
            (o.paymentProofUrl ? '<a class="mini-btn" href="' + esc(o.paymentProofUrl) + '" target="_blank" rel="noopener">截图</a> ' : "") +
            detailBtn +
            "</div></article>",
        };
      })
      .reduce(
        function (acc, row) {
          acc.tr += row.tr;
          acc.card += row.card;
          return acc;
        },
        { tr: "", card: "" }
      );
    box.innerHTML =
      '<div class="ago-filters">' +
      tabs +
      ' <button class="mini-btn" data-gift-order-reload>刷新</button></div>' +
      (rowsHtml.tr
        ? '<div class="table-wrap ago-table-wrap"><table class="admin-table"><thead><tr><th>订单编号</th><th>送礼用户</th><th>陪玩</th><th>礼物</th><th>金额</th><th>状态</th><th>创建时间</th><th></th></tr></thead><tbody>' +
          rowsHtml.tr +
          "</tbody></table></div><div class='ago-cards'>" +
          rowsHtml.card +
          "</div>"
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
    var detail = t.closest("[data-gift-order-detail]");
    if (detail) {
      var id = detail.getAttribute("data-gift-order-detail");
      var order = (state.orders || []).filter(function (o) {
        return String(o.id) === String(id);
      })[0];
      if (!order) return;
      var box = target();
      if (!box) return;
      var old = box.querySelector(".ago-detail");
      if (old) old.remove();
      var p = document.createElement("p");
      p.className = "ago-detail";
      p.textContent = "订单 ID：" + (order.id || "-");
      detail.closest("article, td, tr").appendChild(p);
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
