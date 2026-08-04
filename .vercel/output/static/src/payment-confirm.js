(function () {
  "use strict";

  var root = document.getElementById("paymentConfirmApp");
  if (!root) return;

  var LOAD_MS = 30000;
  var POLL_MS = 4000;
  var cacheKey = "mcjOrderCache:";
  var abortCtrl = null;
  var pollTimer = null;
  var loadGen = 0;
  var paying = false;
  var allowTestPay = null;

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function money(v) {
    if (window.MCJCurrency) return window.MCJCurrency.formatPlain(v);
    var n = Number(v || 0);
    return (Number.isFinite(n) ? n : 0).toFixed(2).replace(/\.00$/, "") + " 猫粮";
  }
  function methodCode(order) {
    return String(order.paymentMethod || order.payment_method || "").toLowerCase();
  }
  function isWalletMethod(order) {
    return /cat.?food|wallet|猫粮|余额/.test(methodCode(order));
  }
  function isPreviewTestMethod(order) {
    return /tng|bank|银行|card|银行卡|alipay|支付宝/.test(methodCode(order));
  }
  function token() {
    return localStorage.getItem("mcjAuthAccessToken") || sessionStorage.getItem("mcjAuthAccessToken") || "";
  }
  function q(name) {
    return new URLSearchParams(location.search).get(name) || "";
  }
  function paint(html) {
    root.innerHTML = html;
  }
  function parseGameId(order) {
    if (order.gameId || order.game_id) return order.gameId || order.game_id;
    var desc = String(order.description || "");
    var m = desc.match(/游戏ID[：:]\s*([^\n；;]+)/i);
    return m ? m[1].trim() : "-";
  }
  function companionName(order) {
    return (
      (order.companion && (order.companion.display_name || order.companion.email)) ||
      order.companionName ||
      order.companion_name ||
      "待安排"
    );
  }

  var STATUS_LABEL = (window.MCJOrderStatus && window.MCJOrderStatus.LABELS) || {
    awaiting_payment: "待付款",
    pending: "待客服安排",
    claimed: "等待陪玩确认",
    waiting_boss_confirm: "待我确认",
    confirmed: "已接单待开始",
    in_progress: "进行中",
    completed: "已完成",
    reviewed: "已评价",
    cancelled: "已取消",
    refund_requested: "售后",
    refunded: "已退款",
  };

  function queryAllowsTestPay() {
    return q("allowTestPay") === "1" || q("allow_test_pay") === "1";
  }
  function canShowTestPay() {
    // Default Preview path: hide TEST pay. Opt-in via ?allowTestPay=1 or server env MCJ_ALLOW_TEST_PAY=1.
    if (queryAllowsTestPay()) return true;
    if (allowTestPay === true) return true;
    return false;
  }

  function statusGuide(status, order) {
    var s = String(status || "");
    if (s === "awaiting_payment") {
      return {
        title: "待付款",
        reason: "订单已创建，尚未完成支付。",
        next: isWalletMethod(order || {}) ? "请使用猫粮余额完成支付，支付成功后订单才会发送给陪玩确认。" : "请完成支付，支付成功后订单才会发送给陪玩确认。",
        primary: "pay",
        primaryLabel: isWalletMethod(arguments[1] || {}) ? "立即支付" : "前往支付",
        disabledHint: "",
      };
    }
    if (s === "claimed") {
      return {
        title: "等待陪玩确认",
        reason: "订单已支付，正在等待陪玩确认接单",
        next: "陪玩确认前不会开始服务，也不会结算收益。",
        primary: "orders",
        primaryLabel: "查看我的订单",
        disabledHint: "付款已完成，等待陪玩确认",
      };
    }
    if (s === "pending") {
      return {
        title: "待客服安排",
        reason: "正在等待客服重新安排陪玩",
        next: "可联系客服催进度；订单不会自动消失。",
        primary: "contact_cs",
        primaryLabel: "联系客服催进度",
        disabledHint: "付款确认入口已关闭：客服处理中",
      };
    }
    if (s === "waiting_boss_confirm") {
      return {
        title: "待我确认",
        reason: "等待你确认陪玩人选",
        next: "请到「我的订单」确认或更换陪玩。",
        primary: "orders",
        primaryLabel: "查看我的订单",
        disabledHint: "当前无需再次付款确认",
      };
    }
    if (s === "confirmed") {
      return {
        title: "已接单待开始",
        reason: "陪玩已确认接单",
        next: "陪玩开始服务后订单将进入进行中。",
        primary: "orders",
        primaryLabel: "查看我的订单",
        disabledHint: "付款已确认，无需重复操作",
      };
    }
    if (s === "in_progress") {
      return {
        title: "进行中",
        reason: "服务进行中",
        next: "如有问题请联系客服协助。",
        primary: "contact_cs",
        primaryLabel: "联系客服",
        disabledHint: "服务进行中，付款确认已完成",
      };
    }
    if (s === "completed" || s === "reviewed") {
      return {
        title: s === "reviewed" ? "已评价" : "已完成",
        reason: "本单服务已结束",
        next: "可在「我的订单」查看详情或评价。",
        primary: "orders",
        primaryLabel: "查看我的订单",
        disabledHint: "订单已结束",
      };
    }
    if (s === "cancelled") {
      return {
        title: "已取消",
        reason: "订单已取消",
        next: "如需重新下单，请返回陪玩大厅。",
        primary: "lobby",
        primaryLabel: "返回陪玩大厅",
        disabledHint: "已取消订单无法付款确认",
      };
    }
    if (s === "refund_requested" || s === "refunded") {
      return {
        title: "售后",
        reason: s === "refunded" ? "售后已处理" : "售后处理中",
        next: "请联系客服了解进度。",
        primary: "contact_cs",
        primaryLabel: "联系客服",
        disabledHint: "售后中，付款确认不可用",
      };
    }
    return {
      title: STATUS_LABEL[s] || s || "订单状态",
      reason: "请根据当前状态联系客服或查看订单。",
      next: "下一步：查看我的订单或联系客服。",
      primary: "orders",
      primaryLabel: "查看我的订单",
      disabledHint: "",
    };
  }

  function failUi(msg) {
    paint(
      '<section class="pay-card"><h1>支付确认</h1>' +
        '<p class="pay-alert">' +
        esc(msg || "订单加载失败，请重试") +
        "</p>" +
        '<div class="pay-actions">' +
        '<button type="button" class="pay-btn primary" data-reload>重新加载</button>' +
        '<a class="pay-btn" href="orders.html">查看我的订单</a>' +
        "</div></section>"
    );
  }

  function empty(title, desc) {
    paint(
      '<section class="pay-card"><h1>' +
        esc(title) +
        "</h1><p>" +
        esc(desc) +
        '</p><div class="pay-actions"><a class="pay-btn primary" href="companion-center.html">返回陪玩大厅</a><a class="pay-btn" href="orders.html">我的订单</a></div></section>'
    );
  }

  function renderOrder(order, opts) {
    opts = opts || {};
    var st = String(order.status || "");
    var guide = statusGuide(st, order);
    var label = STATUS_LABEL[st] || order.statusText || st;
    var csHref = "support.html?order=" + encodeURIComponent(order.id);
    var ordersHref = "orders.html?id=" + encodeURIComponent(order.id);
    var actions = '<div class="pay-actions">';
    if (guide.primary === "pay" && st === "awaiting_payment") {
      if (isWalletMethod(order)) {
        actions += '<button type="button" class="pay-btn primary" data-pay-order="' + esc(order.id) + '">' + esc(guide.primaryLabel + " " + money(order.totalAmount || order.amount)) + "</button>";
      }
      if (canShowTestPay()) {
        actions += '<button type="button" class="pay-btn primary" data-preview-pay="' + esc(order.id) + '">' + esc("测试支付成功（TEST）") + "</button>";
      } else if (!isWalletMethod(order)) {
        actions += '<a class="pay-btn primary" href="' + csHref + '">联系客服确认付款</a>';
      }
      actions += '<a class="pay-btn" href="' + ordersHref + '">查看我的订单</a>';
    } else {
      var primaryHref = guide.primary === "contact_cs" ? csHref : guide.primary === "lobby" ? "companion-center.html" : ordersHref;
      actions += '<a class="pay-btn primary" href="' + primaryHref + '">' + esc(guide.primaryLabel) + "</a>";
      actions += guide.primary !== "orders" ? '<a class="pay-btn" href="' + ordersHref + '">查看我的订单</a>' : '<a class="pay-btn" href="' + csHref + '">联系客服</a>';
    }
    actions += '<a class="pay-btn" href="companion-center.html">继续浏览陪玩</a></div>';

    if (guide.disabledHint) {
      actions +=
        '<p class="pay-hint" role="status"><strong>当前不可用说明：</strong>' +
        esc(guide.disabledHint) +
        "</p>";
    }

    paint(
      '<section class="pay-card"><h1>支付确认</h1>' +
        (opts.fromCache ? '<p class="pay-sync">已显示缓存，正在同步最新状态…</p>' : "") +
        '<div class="pay-status-box" role="status">' +
        "<strong>" +
        esc(guide.title) +
        "</strong>" +
        "<p>" +
        esc(guide.reason) +
        "</p>" +
        "<p>" +
        esc(guide.next) +
        "</p>" +
        "</div>" +
        '<div class="pay-grid">' +
        '<div class="pay-row"><span>订单号</span><strong>' +
        esc(order.orderNo || order.order_no || order.id) +
        "</strong></div>" +
        '<div class="pay-row"><span>陪玩</span><strong>' +
        esc(companionName(order)) +
        "</strong></div>" +
        '<div class="pay-row"><span>服务</span><strong>' +
        esc(order.serviceType || order.serviceName || order.game || order.title || "-") +
        "</strong></div>" +
        '<div class="pay-row"><span>时长</span><strong>' +
        esc(order.hours != null ? order.hours + " 小时" : "-") +
        "</strong></div>" +
        '<div class="pay-row"><span>游戏 ID</span><strong>' +
        esc(parseGameId(order)) +
        "</strong></div>" +
        '<div class="pay-row"><span>应付金额</span><strong>' +
        esc(money(order.totalAmount || order.amount)) +
        "</strong></div>" +
        '<div class="pay-row"><span>支付方式</span><strong>' +
        esc(order.paymentMethod || order.payment_method || "线下确认") +
        "</strong></div>" +
        '<div class="pay-row"><span>当前状态</span><strong>' +
        esc(label) +
        "</strong></div>" +
        "</div>" +
        (st === "awaiting_payment"
          ? '<p class="pay-alert">' +
            esc(
              canShowTestPay()
                ? "Preview / 测试环境：可点「测试支付成功（TEST）」真实写入订单状态；正式环境无此入口。"
                : isWalletMethod(order)
                  ? "支付成功后将进入“等待陪玩确认”。"
                  : "该支付方式当前需联系客服确认到账。"
            ) +
            "</p>"
          : "") +
        actions +
        "</section>"
    );
  }
  async function submitPay(orderId, previewTest) {
    if (paying) return;
    paying = true;
    try {
      var res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token() },
        body: JSON.stringify({
          action: "pay_order",
          id: orderId,
          preview_test: previewTest ? "1" : "",
          allowTestPay: queryAllowsTestPay() ? "1" : "",
          paymentMethod: readCache(orderId)?.paymentMethod || readCache(orderId)?.payment_method || "",
        }),
      });
      var body = await res.json().catch(function () {
        return {};
      });
      if (typeof body.allowTestPay === "boolean") allowTestPay = body.allowTestPay;
      if (!res.ok || body.ok === false) {
        if (body.code === "USE_TEST_PAY" && canShowTestPay()) {
          var cached = readCache(orderId);
          if (cached) renderOrder(cached);
          failUi(body.message || "请使用测试支付成功（TEST）");
          return;
        }
        throw new Error(body.message || "支付失败");
      }
      if (body.order) writeCache(orderId, body.order);
      // Real DB status updated — jump to boss list on 等待陪玩确认 tab.
      var next =
        "orders.html?filter=waiting_companion&id=" +
        encodeURIComponent(orderId) +
        (body.testPay ? "&paid=test" : "&paid=1");
      location.replace(next);
    } catch (err) {
      failUi(err.message || "支付失败，请重试");
    } finally {
      paying = false;
    }
  }

  function readCache(id) {
    try {
      var raw = localStorage.getItem(cacheKey + id) || sessionStorage.getItem(cacheKey + id);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function writeCache(id, order) {
    var payload = JSON.stringify(order);
    try {
      localStorage.setItem(cacheKey + id, payload);
    } catch (e) {}
    try {
      sessionStorage.setItem(cacheKey + id, payload);
    } catch (e2) {}
  }

  function pickOrder(list, id) {
    return (
      (list || []).find(function (o) {
        return String(o.id) === String(id) || String(o.orderNo || o.order_no || "") === String(id);
      }) || (list && list[0]) || null
    );
  }

  async function loadOrder(opts) {
    opts = opts || {};
    var orderId = q("order") || q("id");
    var gen = ++loadGen;
    if (abortCtrl) abortCtrl.abort();
    abortCtrl = typeof AbortController !== "undefined" ? new AbortController() : null;

    if (!token()) {
      sessionStorage.setItem("mcjAfterLoginRedirect", location.pathname + location.search);
      location.replace("index.html#login");
      return;
    }
    if (!orderId) {
      empty("没有待确认订单", "请从陪玩详情重新下单。");
      return;
    }

    var cached = readCache(orderId);
    if (cached && !opts.silent) renderOrder(cached, { fromCache: true });
    else if (!opts.silent) {
      paint(
        '<section class="pay-card"><h1>支付确认</h1>' +
          '<div class="pay-skel" aria-busy="true"><div class="pay-skel-line"></div><div class="pay-skel-line"></div><div class="pay-skel-line short"></div></div>' +
          "<p>正在读取订单…</p></section>"
      );
    }

    var settled = false;
    try {
      var res = await fetch("/api/orders?id=" + encodeURIComponent(orderId), {
        headers: { Accept: "application/json", Authorization: "Bearer " + token() },
        cache: "no-store",
        signal: abortCtrl ? abortCtrl.signal : undefined,
      });
      var body = await res.json().catch(function () {
        return {};
      });
      if (gen !== loadGen) return;
      if (typeof body.allowTestPay === "boolean") allowTestPay = body.allowTestPay;
      if (!res.ok || body.ok === false) throw new Error(body.message || "订单读取失败");
      settled = true;
      var order = pickOrder(body.orders, orderId);
      if (!order) {
        failUi("订单不存在，请到「我的订单」查看。");
        return;
      }
      writeCache(orderId, order);
      renderOrder(order);
    } catch (err) {
      if (gen !== loadGen) return;
      if (err && err.name === "AbortError") return;
      if (cached) renderOrder(cached);
      else failUi(err.message || "订单加载失败，请重试");
    }
  }

  function startPoll() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(function () {
      if (document.hidden) return;
      loadOrder({ silent: true });
    }, POLL_MS);
  }

  root.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-reload]");
    if (btn) {
      e.preventDefault();
      loadOrder();
      return;
    }
    var payBtn = e.target.closest("[data-pay-order]");
    if (payBtn) {
      e.preventDefault();
      submitPay(payBtn.getAttribute("data-pay-order"), false);
      return;
    }
    var previewBtn = e.target.closest("[data-preview-pay]");
    if (previewBtn) {
      e.preventDefault();
      submitPay(previewBtn.getAttribute("data-preview-pay"), true);
    }
  });

  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) loadOrder({ silent: true });
  });

  window.addEventListener("pagehide", function () {
    if (abortCtrl) abortCtrl.abort();
    if (pollTimer) clearInterval(pollTimer);
  });

  loadOrder();
  startPoll();
})();
