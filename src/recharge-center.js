/**
 * Boss recharge center — full loop:
 * pick campaign/method → pay step (QR + proof) → pending_review → admin credit.
 */
(function () {
  "use strict";
  var root = document.getElementById("rechargeApp");
  if (!root) return;

  var state = {
    loading: true,
    submitting: false,
    uploading: false,
    error: "",
    message: "",
    messageType: "warn",
    summary: { balance: 0, paidBalance: 0, bonusBalance: 0, totalRecharge: 0, totalSpent: 0 },
    campaigns: [],
    transactions: [],
    methods: [],
    records: [],
    campaignId: "",
    method: "",
    step: "select", // select | pay
    payOrder: null,
    payInfo: null,
    localProofDataUrl: "",
    localProofName: "",
  };

  function looksLikeJwt(raw) {
    var t = String(raw || "").trim();
    if (!t || t.length < 20) return false;
    var parts = t.split(".");
    return parts.length === 3 && parts.every(function (p) { return p.length > 0; });
  }
  function token() {
    if (window.MCJBossAuth && typeof window.MCJBossAuth.getAccessToken === "function") {
      var t = window.MCJBossAuth.getAccessToken();
      if (looksLikeJwt(t)) return t;
    }
    var candidates = [localStorage.getItem("mcjAuthAccessToken"), sessionStorage.getItem("mcjAuthAccessToken")];
    for (var i = 0; i < candidates.length; i++) if (looksLikeJwt(candidates[i])) return candidates[i];
    return "";
  }
  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function money(v) {
    var n = Number(v || 0);
    return "RM" + (Number.isFinite(n) ? n : 0).toFixed(2);
  }
  function date(v) {
    if (!v) return "-";
    try {
      return new Date(v).toLocaleString("zh-CN", { hour12: false });
    } catch (e) {
      return v;
    }
  }
  function methodName(code) {
    var m = state.methods.find(function (x) { return x.code === code; });
    return m ? m.name : code || "-";
  }
  function statusText(s) {
    return (
      {
        pending: "待支付",
        pending_payment: "待支付",
        pending_review: "待审核",
        unavailable: "暂未开放",
        failed: "失败",
        paid: "已到账",
        credited: "已到账",
        rejected: "已拒绝",
        cancelled: "已取消",
      }[String(s || "").toLowerCase()] ||
      s ||
      "-"
    );
  }
  function selectedCampaign() {
    return (state.campaigns || []).find(function (c) { return c.id === state.campaignId; }) || null;
  }
  function messageHtml() {
    if (!state.message) return "";
    return '<div class="message show ' + state.messageType + '">' + esc(state.message) + "</div>";
  }
  function qsPaymentNo() {
    try {
      return String(new URLSearchParams(location.search).get("paymentNo") || "").trim();
    } catch (e) {
      return "";
    }
  }

  function payStepHtml() {
    var o = state.payOrder || {};
    var info = state.payInfo || {};
    var preview = state.localProofDataUrl || o.proofUrl || "";
    // 「我已付款」仅在本地新选截图后可点（拒绝后也必须重新选图再提交）。
    var canSubmit = !!state.localProofDataUrl && !/paid|credited/i.test(String(o.status || ""));

    var qr =
      info && info.qrUrl
        ? '<p class="pay-qr-title">扫码付款</p>' +
          '<p class="pay-qr-sub">' +
          esc(methodName(o.paymentMethod) || info.title || "DuitNow") +
          "</p>" +
          '<div class="pay-qr-frame" data-pay-qr-zoom="1" role="button" tabindex="0" aria-label="点击放大收款二维码"><img src="' +
          esc(info.qrUrl) +
          '" alt="' +
          esc((info.title || methodName(o.paymentMethod)) + " 收款二维码") +
          '" data-mcj-pay-qr="1" referrerpolicy="no-referrer" crossorigin="anonymous"></div>' +
          '<div class="pay-qr-actions"><button type="button" class="pay-qr-save" data-pay-qr-save="' +
          esc(info.qrUrl) +
          '">保存收款码</button></div>'
        : '<p class="pay-hint">平台暂未配置该支付方式的收款二维码，请联系客服。</p>';

    return (
      '<section class="page-head"><div><h1>充值付款</h1><p>请按收款信息完成转账，上传付款截图后提交审核。未上传截图无法提交。</p></div>' +
      '<button class="ghost-btn" data-back-select type="button">返回充值档位</button></section>' +
      '<section class="panel pay-step-panel">' +
      "<h2>" +
      esc(methodName(o.paymentMethod) || info.title || "付款") +
      "</h2>" +
      '<div class="summary-line"><span>充值单号</span><strong>' +
      esc(o.paymentNo || "-") +
      "</strong></div>" +
      '<div class="summary-line"><span>应付金额</span><strong>' +
      money(o.amount) +
      "</strong></div>" +
      '<div class="summary-line"><span>基础猫粮</span><strong>' +
      esc(o.paidCatFood || 0) +
      " 猫粮</strong></div>" +
      '<div class="summary-line"><span>赠送猫粮</span><strong>' +
      esc(o.bonusCatFood || 0) +
      " 猫粮</strong></div>" +
      '<div class="summary-line"><span>最终到账</span><strong>' +
      esc(o.totalCatFood || o.catFoodAmount || 0) +
      " 猫粮</strong></div>" +
      '<div class="summary-line"><span>当前状态</span><strong>' +
      esc(o.statusText || statusText(o.status)) +
      "</strong></div>" +
      (o.rejectReason ? '<p class="pay-reject">拒绝原因：' + esc(o.rejectReason) + "</p>" : "") +
      '<div class="pay-qr-block">' +
      qr +
      '<div class="pay-qr-meta">' +
      '<div class="pay-row"><span>收款人</span><strong>' +
      esc(info.receiverName || "-") +
      "</strong></div>" +
      '<div class="pay-row"><span>银行</span><strong>' +
      esc(info.bankName || "-") +
      "</strong></div>" +
      '<div class="pay-row"><span>银行账号</span><strong>' +
      esc(info.bankAccount || info.phone || info.duitnowId || "-") +
      "</strong></div>" +
      "</div></div>" +
      '<div class="pay-proof-block">' +
      "<h3>上传付款截图</h3>" +
      '<label class="pay-proof-pick primary-btn" style="position:relative;overflow:hidden;cursor:pointer">' +
      (state.uploading ? "上传中…" : "选择付款截图 / 拍照") +
      '<input class="pay-proof-file" type="file" accept="image/jpeg,image/jpg,image/png,image/webp" data-proof-file ' +
      (state.uploading || /paid|credited/i.test(String(o.status || "")) ? "disabled" : "") +
      ">" +
      "</label>" +
      (preview
        ? '<div class="pay-proof-preview"><img src="' +
          esc(preview) +
          '" alt="付款截图预览"><p class="pay-proof-name">' +
          esc(state.localProofName || "已上传") +
          '</p><button type="button" class="ghost-btn" data-clear-proof>删除并重传</button></div>'
        : '<p class="hint">手机可从相册选择或拍照；未上传截图时「我已付款」不可点。</p>') +
      '<button class="primary-btn" data-i-paid type="button" ' +
      (!canSubmit || state.submitting || state.uploading ? "disabled" : "") +
      ">" +
      (state.submitting ? "提交中…" : /pending_review/i.test(String(o.status || "")) && !state.localProofDataUrl ? "已提交，等待审核" : "我已付款") +
      "</button>" +
      messageHtml() +
      "</div></section>"
    );
  }

  function paint() {
    if (!token()) {
      root.innerHTML =
        '<section class="page-head"><div><h1>充值中心</h1><p>请先登录老板账号后再进行充值。</p></div><a class="ghost-btn" href="index.html">返回首页登录</a></section>';
      return;
    }
    if (state.loading) {
      root.innerHTML = '<section class="page-head"><div><h1>充值中心</h1><p>正在读取充值数据...</p></div></section>';
      return;
    }
    if (state.error) {
      root.innerHTML =
        '<section class="page-head"><div><h1>充值中心</h1><p class="muted">' +
        esc(state.error) +
        '</p></div><button class="ghost-btn" data-refresh type="button">重试</button></section>';
      return;
    }
    if (state.step === "pay" && state.payOrder) {
      root.innerHTML =
        payStepHtml() +
        '<section class="panel"><h2>钱包流水</h2>' +
        ledgerHtml() +
        "</section>" +
        '<section class="panel"><h2>充值订单</h2>' +
        recordsHtml() +
        "</section>";
      return;
    }
    var c = selectedCampaign();
    root.innerHTML =
      '<section class="page-head"><div><h1>充值中心</h1><p>选择充值活动与支付方式，进入付款步骤上传截图后，由后台审核入账。</p></div><button class="ghost-btn" data-refresh type="button">刷新</button></section>' +
      '<section class="stats"><article class="stat"><span>猫粮余额</span><strong>' +
      esc(state.summary.balance || 0) +
      ' 猫粮</strong></article><article class="stat"><span>充值猫粮</span><strong>' +
      esc(state.summary.paidBalance || 0) +
      ' 猫粮</strong></article><article class="stat"><span>赠送猫粮</span><strong>' +
      esc(state.summary.bonusBalance || 0) +
      " 猫粮</strong></article></section>" +
      '<section class="layout"><div class="panel"><h2>充值活动档位</h2>' +
      (state.campaigns.length
        ? '<div class="campaigns">' +
          state.campaigns
            .map(function (item) {
              return (
                '<button class="campaign ' +
                (state.campaignId === item.id ? "active" : "") +
                '" data-campaign="' +
                esc(item.id) +
                '" type="button"><strong>' +
                esc(item.name) +
                "</strong><small>购买 " +
                esc(item.totalCatFood) +
                " 猫粮<br>需支付 " +
                money(item.payAmountRm) +
                "<br>基础 " +
                esc(item.baseCatFood) +
                " · 赠送 " +
                esc(item.bonusCatFood) +
                '</small><span class="tag">活动</span></button>'
              );
            })
            .join("") +
          "</div>"
        : '<div class="empty">暂无启用中的充值活动，请联系管理员在后台创建。</div>') +
      '<p class="hint">到账以后台审核通过为准；同一充值单不会重复入账。</p></div>' +
      '<aside class="panel"><h2>确认支付</h2><div class="methods">' +
      state.methods
        .map(function (m) {
          return (
            '<button class="method ' +
            (state.method === m.code ? "active " : "") +
            (m.configured ? "open" : "closed") +
            '" data-method="' +
            esc(m.code) +
            '" type="button"><span>' +
            esc(m.name) +
            "</span><small>" +
            esc(m.statusText || "暂未开放") +
            "</small></button>"
          );
        })
        .join("") +
      "</div>" +
      '<div class="summary-line"><span>购买猫粮</span><strong>' +
      esc(c ? c.totalCatFood : "-") +
      ' 猫粮</strong></div><div class="summary-line"><span>需支付</span><strong>' +
      (c ? money(c.payAmountRm) : "-") +
      '</strong></div><div class="summary-line"><span>基础猫粮</span><strong>' +
      esc(c ? c.baseCatFood : "-") +
      ' 猫粮</strong></div><div class="summary-line"><span>赠送猫粮</span><strong>' +
      esc(c ? c.bonusCatFood : "-") +
      ' 猫粮</strong></div><div class="summary-line"><span>支付方式</span><strong>' +
      esc(methodName(state.method)) +
      "</strong></div>" +
      '<button class="primary-btn" data-submit type="button" ' +
      (state.submitting || !c || !state.method ? "disabled" : "") +
      ">" +
      (state.submitting ? "正在进入付款…" : "立即充值") +
      "</button>" +
      messageHtml() +
      "</aside></section>" +
      '<section class="panel"><h2>钱包流水</h2>' +
      ledgerHtml() +
      "</section>" +
      '<section class="panel"><h2>充值订单</h2>' +
      recordsHtml() +
      "</section>";
  }

  function ledgerHtml() {
    if (!state.transactions.length) return '<div class="empty">暂无钱包流水</div>';
    return (
      '<div class="ledger">' +
      state.transactions
        .map(function (t) {
          return (
            '<div class="tx"><strong>' +
            esc(t.typeText) +
            "</strong><span>" +
            (t.signedAmount > 0 ? "+" : "") +
            esc(t.signedAmount) +
            " 猫粮 · " +
            esc(t.balanceTypeText) +
            "</span><span>" +
            esc(t.reason || "-") +
            "</span><span>" +
            esc(date(t.createdAt)) +
            "</span></div>"
          );
        })
        .join("") +
      "</div>"
    );
  }

  function recordsHtml() {
    if (!state.records.length) return '<div class="empty">暂无充值记录</div>';
    return (
      '<div class="records">' +
      state.records
        .map(function (r) {
          var openPay =
            /pending_payment|pending$|rejected|pending_review/i.test(String(r.status || "")) &&
            !/paid|credited/i.test(String(r.status || ""));
          return (
            '<div class="record record-rich" data-open-pay="' +
            esc(r.paymentNo) +
            '"><div><strong>' +
            esc(r.paymentNo) +
            "</strong><span>" +
            money(r.amount) +
            " · " +
            esc(r.totalCatFood || r.catFoodAmount || 0) +
            " 猫粮</span></div><span>" +
            esc(methodName(r.paymentMethod)) +
            "</span><span>" +
            esc(r.statusText || statusText(r.status)) +
            "</span><span>" +
            esc(date(r.submittedAt || r.createdAt)) +
            (r.rejectReason ? "<br><small>拒绝：" + esc(r.rejectReason) + "</small>" : "") +
            (r.proofUrl ? '<br><a href="' + esc(r.proofUrl) + '" target="_blank" rel="noopener">查看截图</a>' : "") +
            (openPay ? '<br><button type="button" class="ghost-btn" data-open-pay="' + esc(r.paymentNo) + '">继续付款</button>' : "") +
            "</span></div>"
          );
        })
        .join("") +
      "</div>"
    );
  }

  async function api(pathname, body, method) {
    var m = method || (body == null ? "GET" : "POST");
    var res = await fetch(pathname, {
      method: m,
      headers: {
        Accept: "application/json",
        Authorization: "Bearer " + token(),
        ...(body != null ? { "Content-Type": "application/json" } : {}),
      },
      body: body == null ? undefined : JSON.stringify(body),
      cache: "no-store",
    });
    var json = await res.json().catch(function () { return {}; });
    if (!res.ok || json.ok === false) throw new Error(json.message || "请求失败");
    return json;
  }

  function enterPayStep(order, payInfo, opts) {
    opts = opts || {};
    state.step = "pay";
    state.payOrder = order || null;
    state.payInfo = payInfo || null;
    if (!opts.keepLocalProof) {
      state.localProofDataUrl = "";
      state.localProofName = "";
    }
    if (order && order.paymentNo) {
      try {
        history.replaceState({}, "", "recharge.html?paymentNo=" + encodeURIComponent(order.paymentNo));
      } catch (e) {}
    }
    paint();
  }

  async function openExistingPayment(paymentNo) {
    if (!paymentNo) return;
    state.loading = true;
    paint();
    try {
      var body = await api("/api/recharge?paymentNo=" + encodeURIComponent(paymentNo), null, "GET");
      state.loading = false;
      enterPayStep(body.paymentOrder, body.payInfo);
    } catch (err) {
      state.loading = false;
      state.message = err.message || "无法打开充值付款";
      state.messageType = "bad";
      state.step = "select";
      paint();
    }
  }

  async function load() {
    if (!token()) {
      state.loading = false;
      paint();
      return;
    }
    state.loading = true;
    state.error = "";
    paint();
    try {
      var body = await api("/api/recharge", null, "GET");
      state.summary = body.summary || state.summary;
      state.campaigns = body.campaigns || [];
      state.transactions = Array.isArray(body.transactions) ? body.transactions : [];
      state.methods = (body.methods || []).filter(function (m) {
        return m && m.code && m.open === true && m.forRecharge !== false;
      });
      state.records = body.records || [];
      if (!state.campaigns.some(function (c) { return c.id === state.campaignId; })) {
        state.campaignId = state.campaigns[0] ? state.campaigns[0].id : "";
      }
      if (!state.methods.some(function (m) { return m.code === state.method; })) {
        state.method = state.methods[0] ? state.methods[0].code : "";
      }
      if (!state.methods.length) {
        state.message = body.message || "暂无可用支付方式，请联系管理员在后台启用";
        state.messageType = "warn";
      } else if (body.message) {
        state.message = body.message;
        state.messageType = "warn";
      } else if (!state.message || state.messageType === "warn") {
        state.message = "";
      }

      // Only clean named empty shells from the old fake flow (never wipe an in-progress pay step).
      var knownFake = {
        "PAY-1786296969555-6CS3": 1,
        "PAY-1786296959730-NBSH": 1,
      };
      var keepPn = qsPaymentNo();
      var shells = (state.records || []).filter(function (r) {
        if (!r || !r.paymentNo) return false;
        if (keepPn && r.paymentNo === keepPn) return false;
        if (!knownFake[r.paymentNo]) return false;
        return /pending_payment|^pending$|cancelled|failed/i.test(String(r.status || "")) && !r.hasProof && !r.proofUrl;
      });
      for (var i = 0; i < shells.length; i++) {
        try {
          await api("/api/recharge", { action: "cleanup_test_pending", paymentNo: shells[i].paymentNo });
        } catch (e) {}
      }
      if (shells.length) {
        var refreshed = await api("/api/recharge", null, "GET");
        state.records = refreshed.records || state.records;
        state.summary = refreshed.summary || state.summary;
        state.transactions = refreshed.transactions || state.transactions;
      }
    } catch (err) {
      state.error = err.message || "充值数据读取失败";
    } finally {
      state.loading = false;
      var pn = qsPaymentNo();
      if (pn && !state.error) {
        await openExistingPayment(pn);
      } else {
        paint();
      }
    }
  }

  async function submitCreate() {
    var c = selectedCampaign();
    if (!c) {
      state.message = "请选择充值活动档位。";
      state.messageType = "bad";
      paint();
      return;
    }
    if (!state.method) {
      state.message = "请选择支付方式。";
      state.messageType = "bad";
      paint();
      return;
    }
    state.submitting = true;
    state.message = "";
    paint();
    try {
      var body = await api("/api/recharge", { campaignId: c.id, paymentMethod: state.method });
      state.submitting = false;
      if (body.enterPaymentStep || body.manual || (body.paymentOrder && body.payInfo)) {
        enterPayStep(body.paymentOrder, body.payInfo);
        state.message = body.message || "请完成付款并上传截图";
        state.messageType = "ok";
        paint();
        return;
      }
      if (body.paymentUrl && !body.manual) {
        location.href = body.paymentUrl;
        return;
      }
      state.message = body.message || "该支付方式暂未开放";
      state.messageType = "warn";
      await load();
    } catch (err) {
      state.message = err.message || "充值提交失败";
      state.messageType = "bad";
      paint();
    } finally {
      state.submitting = false;
      paint();
    }
  }

  function readFileAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || "")); };
      reader.onerror = function () { reject(new Error("读取图片失败")); };
      reader.readAsDataURL(file);
    });
  }

  async function onPickProof(file) {
    if (!file) return;
    if (!/^image\/(jpeg|jpg|png|webp)$/i.test(file.type || "")) {
      state.message = "请上传 JPG / PNG / WEBP 图片";
      state.messageType = "bad";
      paint();
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      state.message = "付款截图不能超过 10MB";
      state.messageType = "bad";
      paint();
      return;
    }
    try {
      state.localProofDataUrl = await readFileAsDataUrl(file);
      state.localProofName = file.name || "付款截图";
      state.message = "截图已选择，可预览后点击「我已付款」提交";
      state.messageType = "ok";
      paint();
    } catch (err) {
      state.message = err.message || "读取截图失败";
      state.messageType = "bad";
      paint();
    }
  }

  async function submitPaid() {
    if (!state.payOrder || !state.payOrder.paymentNo) return;
    if (!state.localProofDataUrl && !(state.payOrder.hasProof || state.payOrder.proofUrl)) {
      state.message = "请先上传付款截图";
      state.messageType = "bad";
      paint();
      return;
    }
    if (!state.localProofDataUrl) {
      state.message = "请重新选择付款截图后再提交";
      state.messageType = "warn";
      paint();
      return;
    }
    state.submitting = true;
    paint();
    try {
      var body = await api("/api/recharge", {
        action: "submit_proof",
        paymentNo: state.payOrder.paymentNo,
        proofDataUrl: state.localProofDataUrl,
      });
      state.localProofDataUrl = "";
      state.localProofName = "";
      state.payOrder = body.paymentOrder || state.payOrder;
      state.message = body.message || "已提交，等待审核";
      state.messageType = "ok";
      // Refresh wallet/records in background
      var list = await api("/api/recharge", null, "GET");
      state.summary = list.summary || state.summary;
      state.transactions = list.transactions || state.transactions;
      state.records = list.records || state.records;
      state.step = "select";
      try {
        history.replaceState({}, "", "recharge.html");
      } catch (e) {}
      paint();
    } catch (err) {
      state.message = err.message || "提交失败";
      state.messageType = "bad";
      paint();
    } finally {
      state.submitting = false;
      paint();
    }
  }

  function ensurePayQrLightbox() {
    var box = document.getElementById("mcjPayQrLightbox");
    if (box) return box;
    box = document.createElement("div");
    box.id = "mcjPayQrLightbox";
    box.className = "pay-qr-lightbox";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.setAttribute("aria-label", "收款二维码大图");
    box.innerHTML =
      '<img alt="收款二维码大图" data-pay-qr-lightbox-img="1" referrerpolicy="no-referrer">' +
      '<div class="pay-qr-lightbox-hint">点击空白处关闭</div>';
    document.body.appendChild(box);
    box.addEventListener("click", function (e) {
      if (e.target && e.target.getAttribute("data-pay-qr-lightbox-img") === "1") return;
      closePayQrLightbox();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closePayQrLightbox();
    });
    return box;
  }
  function openPayQrLightbox(src, alt) {
    if (!src) return;
    var box = ensurePayQrLightbox();
    var img = box.querySelector("[data-pay-qr-lightbox-img]");
    if (img) {
      img.setAttribute("crossorigin", "anonymous");
      img.referrerPolicy = "no-referrer";
      img.src = src;
      img.alt = alt || "收款二维码大图";
    }
    box.classList.add("is-open");
    try {
      document.body.style.overflow = "hidden";
    } catch (e) {}
  }
  function closePayQrLightbox() {
    var box = document.getElementById("mcjPayQrLightbox");
    if (!box) return;
    box.classList.remove("is-open");
    try {
      document.body.style.overflow = "";
    } catch (e) {}
  }
  function savePayQrImage(src) {
    if (!src) return Promise.resolve();
    var filename = "mcj-收款码-" + Date.now() + ".png";
    return fetch(src, { mode: "cors", cache: "no-store" })
      .then(function (res) {
        if (!res.ok) throw new Error("fetch failed");
        return res.blob();
      })
      .then(function (blob) {
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.rel = "noopener";
        document.body.appendChild(a);
        a.click();
        setTimeout(function () {
          try {
            URL.revokeObjectURL(url);
            a.remove();
          } catch (e) {}
        }, 1500);
      })
      .catch(function () {
        window.open(src, "_blank", "noopener");
      });
  }

  document.addEventListener("click", function (e) {
    var zoom = e.target.closest("[data-pay-qr-zoom], [data-mcj-pay-qr]");
    if (zoom && root.contains(zoom)) {
      var img = zoom.tagName === "IMG" ? zoom : zoom.querySelector("img[data-mcj-pay-qr], img");
      if (img && img.getAttribute("src")) {
        e.preventDefault();
        openPayQrLightbox(img.getAttribute("src"), img.getAttribute("alt") || "收款二维码大图");
        return;
      }
    }
    var saveBtn = e.target.closest("[data-pay-qr-save]");
    if (saveBtn && root.contains(saveBtn)) {
      e.preventDefault();
      savePayQrImage(saveBtn.getAttribute("data-pay-qr-save") || "");
      return;
    }
    var camp = e.target.closest("[data-campaign]");
    if (camp) {
      state.campaignId = camp.dataset.campaign;
      paint();
      return;
    }
    var methodBtn = e.target.closest("[data-method]");
    if (methodBtn) {
      state.method = methodBtn.dataset.method;
      paint();
      return;
    }
    if (e.target.closest("[data-submit]")) {
      submitCreate();
      return;
    }
    if (e.target.closest("[data-refresh]")) {
      load();
      return;
    }
    if (e.target.closest("[data-back-select]")) {
      state.step = "select";
      state.payOrder = null;
      state.payInfo = null;
      state.localProofDataUrl = "";
      try {
        history.replaceState({}, "", "recharge.html");
      } catch (err) {}
      paint();
      return;
    }
    if (e.target.closest("[data-clear-proof]")) {
      state.localProofDataUrl = "";
      state.localProofName = "";
      paint();
      return;
    }
    if (e.target.closest("[data-i-paid]")) {
      submitPaid();
      return;
    }
    var openPay = e.target.closest("[data-open-pay]");
    if (openPay) {
      openExistingPayment(openPay.getAttribute("data-open-pay") || "");
      return;
    }
    if (e.target.closest("[data-logout]")) {
      if (window.MCJRoleGate) {
        window.MCJRoleGate.logout("boss");
        window.MCJRoleGate.logout("customer");
      }
      localStorage.removeItem("mcjAuthAccessToken");
      localStorage.removeItem("mcjAuthRefreshToken");
      sessionStorage.removeItem("mcjAuthAccessToken");
      sessionStorage.removeItem("mcjAuthRefreshToken");
      location.href = "index.html";
    }
  });

  document.addEventListener("keydown", function (e) {
    if (e.key !== "Enter" && e.key !== " ") return;
    var zoom = e.target.closest("[data-pay-qr-zoom]");
    if (!zoom || !root.contains(zoom)) return;
    var img = zoom.querySelector("img[data-mcj-pay-qr], img");
    if (!img || !img.getAttribute("src")) return;
    e.preventDefault();
    openPayQrLightbox(img.getAttribute("src"), img.getAttribute("alt") || "收款二维码大图");
  });

  document.addEventListener("change", function (e) {
    var input = e.target.closest("[data-proof-file]");
    if (!input || !input.files || !input.files[0]) return;
    onPickProof(input.files[0]);
    input.value = "";
  });

  load();
})();
