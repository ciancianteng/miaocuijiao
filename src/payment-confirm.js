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
  var proofDraft = {
    orderId: "",
    file: null,
    previewUrl: "",
    progress: 0,
    uploading: false,
    uploaded: false,
    successTip: "",
    error: "",
  };

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
  function isReviewing(order) {
    return !!(order && (order.paymentReview || /待审核/.test(String(order.paymentStatus || order.statusText || ""))));
  }
  function clearProofDraft(keepTip) {
    if (proofDraft.previewUrl && String(proofDraft.previewUrl).indexOf("blob:") === 0) {
      try {
        URL.revokeObjectURL(proofDraft.previewUrl);
      } catch (e) {}
    }
    proofDraft.file = null;
    proofDraft.previewUrl = "";
    proofDraft.progress = 0;
    proofDraft.uploading = false;
    proofDraft.uploaded = false;
    proofDraft.error = "";
    if (!keepTip) proofDraft.successTip = "";
  }
  function setProofFile(orderId, file) {
    clearProofDraft();
    proofDraft.orderId = orderId;
    proofDraft.file = file;
    try {
      proofDraft.previewUrl = URL.createObjectURL(file);
    } catch (e) {
      proofDraft.previewUrl = "";
    }
  }

  var STATUS_LABEL = (window.MCJOrderStatus && window.MCJOrderStatus.LABELS) || {
    awaiting_payment: "待付款",
    payment_review: "待审核",
    pending: "待客服处理",
    claimed: "等待陪玩确认",
    waiting_boss_confirm: "待我确认",
    confirmed: "进行中",
    in_progress: "进行中",
    completed: "已完成",
    reviewed: "已评价",
    cancelled: "已取消",
    refund_requested: "售后",
    refunded: "已退款",
  };

  function canShowTestPay() {
    if (allowTestPay === true) return true;
    if (allowTestPay === false) return false;
    return !!(window.MCJOrderStatus && window.MCJOrderStatus.isPreviewHost && window.MCJOrderStatus.isPreviewHost());
  }

  function statusGuide(status, order) {
    var s = String(status || "");
    var reviewing = isReviewing(order);
    if (s === "awaiting_payment" && reviewing) {
      return {
        title: "待审核",
        reason: "付款凭证已提交，正在等待审核。",
        next: "审核通过后订单进入待客服处理；驳回后可重新上传凭证。",
        primary: "orders",
        primaryLabel: "查看我的订单",
        disabledHint: "",
      };
    }
    if (s === "awaiting_payment") {
      return {
        title: "待付款",
        reason: "订单已创建，尚未完成支付。",
        next: isWalletMethod(order || {})
          ? "请使用猫粮余额完成支付，支付成功后订单才会发送给陪玩确认。"
          : "请上传付款截图并提交审核。",
        primary: "pay",
        primaryLabel: isWalletMethod(order || {}) ? "立即支付" : "前往支付",
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
        title: "待客服处理",
        reason: "付款已确认，正在等待客服处理派单",
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
        title: "进行中",
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

  function proofPanelHtml(order) {
    var reviewing = isReviewing(order);
    var preview = proofDraft.previewUrl || order.paymentProofUrl || "";
    var hasLocal = !!(proofDraft.file || proofDraft.previewUrl);
    var showUpload = String(order.status || "") === "awaiting_payment" && (!reviewing || hasLocal || !preview);
    if (String(order.status || "") !== "awaiting_payment") return "";
    if (isWalletMethod(order) && !reviewing && !hasLocal) return "";

    var html = '<div class="pay-proof" data-proof-panel>';
    html += "<h2>付款截图</h2>";
    if (reviewing && !hasLocal) {
      html += '<p class="pay-hint">当前状态：待审核。可删除后重新上传，或进入下一步查看订单。</p>';
    } else {
      html += '<p class="pay-hint">请上传付款截图：支持 JPG / PNG / WEBP，提交后进入待审核。</p>';
    }

    if (preview) {
      html +=
        '<div class="pay-proof-preview"><img src="' +
        esc(preview) +
        '" alt="付款截图预览"><div class="pay-proof-preview-actions">' +
        '<button type="button" class="pay-btn" data-proof-delete>删除</button>' +
        '<label class="pay-btn">重新上传<input type="file" accept="image/png,image/jpeg,image/webp" data-payment-proof="' +
        esc(order.id) +
        '" hidden></label></div></div>';
    } else {
      html +=
        '<label class="pay-btn primary pay-proof-pick">选择付款截图<input type="file" accept="image/png,image/jpeg,image/webp" data-payment-proof="' +
        esc(order.id) +
        '" hidden></label>';
    }

    if (proofDraft.uploading || proofDraft.progress > 0) {
      html +=
        '<div class="pay-progress" role="progressbar" aria-valuenow="' +
        esc(proofDraft.progress) +
        '" aria-valuemin="0" aria-valuemax="100"><div class="pay-progress-bar" style="width:' +
        esc(proofDraft.progress) +
        '%"></div><span>' +
        esc(proofDraft.progress) +
        "%</span></div>";
    }
    if (proofDraft.successTip || (reviewing && !proofDraft.error)) {
      html +=
        '<p class="pay-success" role="status">' +
        esc(proofDraft.successTip || "付款凭证已提交，当前状态：待审核") +
        "</p>";
    }
    if (proofDraft.error) {
      html += '<p class="pay-alert" role="alert">' + esc(proofDraft.error) + "</p>";
    }

    html += '<div class="pay-actions pay-proof-actions">';
    if (proofDraft.file && !proofDraft.uploaded) {
      html +=
        '<button type="button" class="pay-btn primary" data-proof-submit="' +
        esc(order.id) +
        '"' +
        (proofDraft.uploading ? " disabled" : "") +
        ">" +
        (proofDraft.uploading ? "上传中…" : "下一步：提交审核") +
        "</button>";
    } else if (reviewing || proofDraft.uploaded) {
      html +=
        '<a class="pay-btn primary" href="orders.html?filter=payment_review&id=' +
        encodeURIComponent(order.id) +
        '">下一步：查看待审核订单</a>';
      html +=
        '<label class="pay-btn">重新上传<input type="file" accept="image/png,image/jpeg,image/webp" data-payment-proof="' +
        esc(order.id) +
        '" hidden></label>';
    }
    html += "</div></div>";
    return html;
  }

  function renderOrder(order, opts) {
    opts = opts || {};
    var st = String(order.status || "");
    var guide = statusGuide(st, order);
    var reviewing = isReviewing(order);
    var label = reviewing && st === "awaiting_payment" ? "待审核" : STATUS_LABEL[st] || order.statusText || st;
    var csHref = "support.html?order=" + encodeURIComponent(order.id);
    var ordersHref = "orders.html?id=" + encodeURIComponent(order.id);
    var actions = '<div class="pay-actions">';
    var needsManualProof = st === "awaiting_payment" && !isWalletMethod(order);

    if (guide.primary === "pay" && st === "awaiting_payment" && !reviewing && isWalletMethod(order)) {
      actions +=
        '<button type="button" class="pay-btn primary" data-pay-order="' +
        esc(order.id) +
        '">' +
        esc(guide.primaryLabel + " " + money(order.totalAmount || order.amount)) +
        "</button>";
      if (canShowTestPay()) {
        actions +=
          '<button type="button" class="pay-btn primary" data-preview-pay="' +
          esc(order.id) +
          '">' +
          esc("测试支付成功（TEST）") +
          "</button>";
      }
      actions += '<a class="pay-btn" href="' + ordersHref + '">查看我的订单</a>';
    } else if (st === "awaiting_payment" && !needsManualProof && !reviewing) {
      if (canShowTestPay()) {
        actions +=
          '<button type="button" class="pay-btn primary" data-preview-pay="' +
          esc(order.id) +
          '">' +
          esc("测试支付成功（TEST）") +
          "</button>";
      } else if (isPreviewTestMethod(order)) {
        actions +=
          '<button type="button" class="pay-btn primary" data-preview-pay="' +
          esc(order.id) +
          '">' +
          esc("测试支付，仅用于 Preview 验收") +
          "</button>";
      }
      actions += '<a class="pay-btn" href="' + ordersHref + '">查看我的订单</a>';
    } else if (st !== "awaiting_payment") {
      var primaryHref = guide.primary === "contact_cs" ? csHref : guide.primary === "lobby" ? "companion-center.html" : ordersHref;
      actions += '<a class="pay-btn primary" href="' + primaryHref + '">' + esc(guide.primaryLabel) + "</a>";
      actions +=
        guide.primary !== "orders"
          ? '<a class="pay-btn" href="' + ordersHref + '">查看我的订单</a>'
          : '<a class="pay-btn" href="' + csHref + '">联系客服</a>';
    } else {
      actions += '<a class="pay-btn" href="' + ordersHref + '">查看我的订单</a>';
      actions += '<a class="pay-btn" href="' + csHref + '">联系客服</a>';
    }
    actions += '<a class="pay-btn" href="companion-center.html">继续浏览陪玩</a></div>';

    if (guide.disabledHint && st !== "awaiting_payment") {
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
              reviewing
                ? "付款凭证已提交，当前为待审核。审核通过后进入待客服处理。"
                : canShowTestPay()
                  ? "Preview / 测试环境：可点「测试支付成功（TEST）」真实写入订单状态；正式环境请上传付款截图。"
                  : isWalletMethod(order)
                    ? "支付成功后将进入“等待陪玩确认”。"
                    : "请上传付款截图，提交审核后进入待审核。"
            ) +
            "</p>"
          : "") +
        proofPanelHtml(order) +
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
          paymentMethod: readCache(orderId)?.paymentMethod || readCache(orderId)?.payment_method || "",
        }),
      });
      var body = await res.json().catch(function () {
        return {};
      });
      if (typeof body.allowTestPay === "boolean") allowTestPay = body.allowTestPay;
      if (!res.ok || body.ok === false) {
        if (body.code === "USE_TEST_PAY" && canShowTestPay()) {
          allowTestPay = true;
          var cached = readCache(orderId);
          if (cached) renderOrder(cached);
          failUi(body.message || "请使用测试支付成功（TEST）");
          return;
        }
        throw new Error(body.message || "支付失败");
      }
      if (body.order) writeCache(orderId, body.order);
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

  function tickProgress(target, done) {
    proofDraft.progress = Math.max(proofDraft.progress, target);
    if (typeof done === "function") done();
  }

  async function submitProof(orderId) {
    var file = proofDraft.file;
    if (!file || paying || proofDraft.uploading) return;
    if (!/^image\/(png|jpeg|webp)$/.test(file.type || "")) {
      proofDraft.error = "仅支持 JPG、PNG、WEBP 图片";
      renderOrder(readCache(orderId) || { id: orderId, status: "awaiting_payment" });
      return;
    }
    paying = true;
    proofDraft.uploading = true;
    proofDraft.progress = 8;
    proofDraft.error = "";
    proofDraft.successTip = "";
    var current = readCache(orderId) || { id: orderId, status: "awaiting_payment" };
    renderOrder(current);
    try {
      tickProgress(25);
      renderOrder(current);
      var dataUrl = await new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onprogress = function (ev) {
          if (ev.lengthComputable && ev.total) {
            proofDraft.progress = Math.min(70, 25 + Math.round((ev.loaded / ev.total) * 40));
            renderOrder(current);
          }
        };
        reader.onload = function () {
          resolve(reader.result);
        };
        reader.onerror = function () {
          reject(new Error("读取图片失败"));
        };
        reader.readAsDataURL(file);
      });
      tickProgress(78);
      renderOrder(current);
      var res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token() },
        body: JSON.stringify({ action: "submit_payment_proof", id: orderId, proofDataUrl: dataUrl }),
      });
      var body = await res.json().catch(function () {
        return {};
      });
      if (!res.ok || body.ok === false) throw new Error(body.message || "付款凭证提交失败");
      tickProgress(100);
      proofDraft.uploading = false;
      proofDraft.uploaded = true;
      proofDraft.file = null;
      proofDraft.successTip = "上传成功！付款凭证已提交，订单进入待审核。";
      var nextOrder = body.order || current;
      nextOrder.paymentReview = true;
      if (body.order && body.order.paymentProofUrl) {
        nextOrder.paymentProofUrl = body.order.paymentProofUrl;
      } else if (proofDraft.previewUrl) {
        nextOrder.paymentProofUrl = proofDraft.previewUrl;
      }
      writeCache(orderId, nextOrder);
      renderOrder(nextOrder);
    } catch (err) {
      proofDraft.uploading = false;
      proofDraft.progress = 0;
      proofDraft.error = err.message || "付款凭证提交失败";
      renderOrder(current);
    } finally {
      paying = false;
    }
  }

  function readCache(id) {
    try {
      var raw = localStorage.getItem(cacheKey + id);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      return null;
    }
  }

  function writeCache(id, order) {
    try {
      localStorage.setItem(cacheKey + id, JSON.stringify(order));
    } catch (e) {}
  }

  function pickOrder(list, id) {
    return (
      (list || []).find(function (o) {
        return String(o.id) === String(id) || String(o.orderNo || o.order_no || "") === String(id);
      }) ||
      (list && list[0]) ||
      null
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
      var order = pickOrder(body.orders, orderId);
      if (!order) {
        failUi("订单不存在，请到「我的订单」查看。");
        return;
      }
      writeCache(orderId, order);
      if (!(proofDraft.uploading || proofDraft.file)) renderOrder(order);
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
      if (document.hidden || proofDraft.uploading) return;
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
    var del = e.target.closest("[data-proof-delete]");
    if (del) {
      e.preventDefault();
      clearProofDraft();
      var oid = q("order") || q("id");
      var order = readCache(oid) || { id: oid, status: "awaiting_payment" };
      // Local delete: allow re-upload even if server still shows reviewing.
      order = Object.assign({}, order, { paymentProofUrl: "" });
      renderOrder(order);
      return;
    }
    var submitBtn = e.target.closest("[data-proof-submit]");
    if (submitBtn) {
      e.preventDefault();
      submitProof(submitBtn.getAttribute("data-proof-submit"));
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
  root.addEventListener("change", function (e) {
    var input = e.target.closest("[data-payment-proof]");
    if (!input || !input.files || !input.files[0]) return;
    var orderId = input.getAttribute("data-payment-proof");
    var file = input.files[0];
    if (!/^image\/(png|jpeg|webp)$/.test(file.type || "")) {
      proofDraft.error = "仅支持 JPG、PNG、WEBP 图片";
      renderOrder(readCache(orderId) || { id: orderId, status: "awaiting_payment" });
      return;
    }
    setProofFile(orderId, file);
    proofDraft.error = "";
    proofDraft.successTip = "";
    proofDraft.uploaded = false;
    renderOrder(readCache(orderId) || { id: orderId, status: "awaiting_payment" });
  });

  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) loadOrder({ silent: true });
  });

  window.addEventListener("pagehide", function () {
    if (abortCtrl) abortCtrl.abort();
    if (pollTimer) clearInterval(pollTimer);
    clearProofDraft();
  });

  loadOrder();
  startPoll();
})();
