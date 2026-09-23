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
  var walletBalance = null;
  var walletBalanceLoaded = false;
  var redirectTimer = null;
  var pickingProof = false;
  var pickWatchTimer = null;
  var heldProofFile = null; // durable File ref — survives paint() destroying <input>
  var proofDraft = {
    orderId: "",
    file: null,
    fileName: "",
    previewUrl: "",
    progress: 0,
    uploading: false,
    uploaded: false,
    successTip: "",
    error: "",
    serverProofUrl: "",
  };

  function activeProofFile() {
    return proofDraft.file || heldProofFile || null;
  }

  function beginProofPick() {
    pickingProof = true;
    if (pickWatchTimer) clearTimeout(pickWatchTimer);
    // Mobile Safari: photo sheet can take long; keep poll/paint frozen until change or timeout.
    pickWatchTimer = setTimeout(function () {
      pickingProof = false;
      pickWatchTimer = null;
    }, 120000);
  }

  function endProofPick() {
    pickingProof = false;
    if (pickWatchTimer) {
      clearTimeout(pickWatchTimer);
      pickWatchTimer = null;
    }
  }

  function shouldFreezeOrderPaint() {
    return !!(pickingProof || proofDraft.uploading || activeProofFile());
  }

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
  function methodLabel(order) {
    var raw = String(order.paymentMethod || order.payment_method || "").trim();
    if (!raw) return "该支付方式";
    var key = raw.toLowerCase();
    if (/duitnow/.test(key)) return "DuitNow";
    if (/tng/.test(key)) return "TNG";
    if (/bank|银行/.test(key)) return "银行卡";
    if (/alipay|支付宝/.test(key)) return "支付宝";
    if (/stripe/.test(key)) return "Stripe";
    if (/hitpay/.test(key)) return "HitPay";
    return raw;
  }
  function isWalletMethod(order) {
    return /cat.?food|wallet|猫粮|余额/.test(methodCode(order));
  }
  function isPreviewTestMethod(order) {
    return /tng|duitnow|bank|银行|card|银行卡|alipay|支付宝/.test(methodCode(order));
  }
  function token() {
    return localStorage.getItem("mcjAuthAccessToken") || sessionStorage.getItem("mcjAuthAccessToken") || "";
  }
  function q(name) {
    return new URLSearchParams(location.search).get(name) || "";
  }
  function paint(html) {
    // Never wipe the page while the OS photo picker is open — destroying in-panel
    // controls mid-pick races with mobile Safari and drops the selection.
    if (pickingProof) return;
    root.innerHTML = html;
    bindPayQrFallback();
    bindProofPickTriggers();
    syncDurableProofInput();
  }

  /** Persistent <input type=file> lives outside #paymentConfirmApp so poll/paint never kills it. */
  function ensureDurableProofInput() {
    var el = document.getElementById("mcjDurableProofInput");
    if (el) {
      // Heal older sessions that used .pay-proof-file (full-viewport click steal).
      el.className = "pay-proof-file-durable";
      el.style.cssText =
        "position:fixed!important;left:0!important;top:0!important;width:1px!important;height:1px!important;opacity:0!important;overflow:hidden!important;z-index:2147483000!important;pointer-events:none!important;border:0!important;margin:0!important;padding:0!important;";
      return el;
    }
    el = document.createElement("input");
    el.id = "mcjDurableProofInput";
    el.type = "file";
    el.accept = "image/png,image/jpeg,image/webp,image/jpg,.png,.jpg,.jpeg,.webp";
    el.setAttribute("data-payment-proof", "");
    el.setAttribute("data-mcj-durable-proof", "1");
    // Do not use .pay-proof-file here: that class is an absolute inset:0 overlay for
    // in-button picks and would cover the whole page (blocking QR zoom clicks).
    el.className = "pay-proof-file-durable";
    el.setAttribute("aria-hidden", "true");
    el.tabIndex = -1;
    el.style.cssText =
      "position:fixed!important;left:0!important;top:0!important;width:1px!important;height:1px!important;opacity:0!important;overflow:hidden!important;z-index:2147483000!important;pointer-events:none!important;border:0!important;margin:0!important;padding:0!important;";
    document.body.appendChild(el);
    ["pointerdown", "touchstart", "mousedown", "click", "focus"].forEach(function (evName) {
      el.addEventListener(
        evName,
        function () {
          beginProofPick();
        },
        { passive: true }
      );
    });
    el.addEventListener("change", function () {
      onProofFileChosen(el);
    });
    return el;
  }

  function syncDurableProofInput() {
    var el = ensureDurableProofInput();
    var oid = proofDraft.orderId || q("order") || q("id") || "";
    if (oid) el.setAttribute("data-payment-proof", oid);
  }

  function openDurableProofPicker(orderId) {
    beginProofPick();
    var el = ensureDurableProofInput();
    if (orderId) {
      proofDraft.orderId = orderId;
      el.setAttribute("data-payment-proof", orderId);
    }
    try {
      el.value = "";
    } catch (err) {}
    // Re-enable pointer events only for the native picker gesture.
    el.style.setProperty("pointer-events", "auto", "important");
    try {
      if (typeof el.showPicker === "function") el.showPicker();
      else el.click();
    } catch (err) {
      try {
        el.click();
      } catch (e2) {}
    }
    setTimeout(function () {
      el.style.setProperty("pointer-events", "none", "important");
    }, 0);
  }

  function bindProofPickTriggers() {
    root.querySelectorAll("[data-proof-pick]").forEach(function (btn) {
      if (btn.getAttribute("data-proof-guard") === "1") return;
      btn.setAttribute("data-proof-guard", "1");
      ["pointerdown", "touchstart", "mousedown"].forEach(function (evName) {
        btn.addEventListener(
          evName,
          function () {
            beginProofPick();
          },
          { passive: true }
        );
      });
      btn.addEventListener("click", function (e) {
        e.preventDefault();
        openDurableProofPicker(btn.getAttribute("data-proof-pick") || q("order") || q("id"));
      });
    });
  }

  function onProofFileChosen(input) {
    endProofPick();
    if (!input || !input.files || !input.files[0]) return;
    var file = input.files[0];
    // Dedupe: input listener + capture listener can both fire once.
    if (
      heldProofFile === file &&
      proofDraft.file === file &&
      proofDraft.previewUrl &&
      !proofDraft.uploaded
    ) {
      return;
    }
    var orderId = input.getAttribute("data-payment-proof") || proofDraft.orderId || q("order") || q("id");
    if (!isAllowedProofFile(file)) {
      proofDraft.error =
        /heic|heif/i.test(String(file.type || file.name || ""))
          ? "当前是 HEIC 原图。请在系统相册设置中关闭「保留原格式」，或导出为 JPG/PNG 后再上传。"
          : "仅支持 JPG、PNG、WEBP 图片";
      proofDraft.successTip = "";
      try {
        input.value = "";
      } catch (err) {}
      renderOrder(readCache(orderId) || { id: orderId, status: "awaiting_payment" });
      return;
    }
    setProofFile(orderId, file);
    proofDraft.error = "";
    proofDraft.uploaded = false;
    proofDraft.successTip =
      "已选择：" + (proofDraft.fileName || file.name || "付款截图") + "，请确认预览后点击「我已付款」";
    renderOrder(readCache(orderId) || { id: orderId, status: "awaiting_payment" });
  }
  function retryPayQrImage(img) {
    if (!img) return;
    var raw = String(img.getAttribute("data-pay-qr-src") || img.currentSrc || img.src || "").trim();
    if (!raw) return;
    var base = raw.replace(/([?&])mcjQrRetry=\d+/g, "").replace(/[?&]$/, "");
    var join = base.indexOf("?") >= 0 ? "&" : "?";
    img.setAttribute("data-pay-qr-load", "pending");
    img.style.outline = "";
    var frame = img.parentNode;
    if (frame) {
      var oldErr = frame.querySelector("[data-pay-qr-load-error]");
      if (oldErr) oldErr.remove();
      var oldRetry = frame.querySelector("[data-pay-qr-retry]");
      if (oldRetry) oldRetry.remove();
    }
    var panel = img.closest("[data-pay-qr]");
    if (panel) panel.setAttribute("data-pay-qr-img-status", "pending");
    // Bust cache so a previously-failed URL can reload.
    img.src = base + join + "mcjQrRetry=" + Date.now();
  }

  function bindPayQrFallback() {
    root.querySelectorAll("[data-mcj-pay-qr],[data-pay-qr-img]").forEach(function (img) {
      if (img.getAttribute("data-bound-pay-qr") === "1") return;
      img.setAttribute("data-bound-pay-qr", "1");
      if (!img.getAttribute("data-pay-qr-src")) {
        img.setAttribute("data-pay-qr-src", img.currentSrc || img.src || "");
      }
      img.setAttribute("data-pay-qr-load", "pending");
      img.addEventListener("load", function () {
        img.setAttribute("data-pay-qr-load", "ok");
        img.style.display = "";
        img.style.visibility = "";
        img.style.opacity = "";
        img.style.outline = "";
        var frame = img.parentNode;
        if (frame) {
          var oldErr = frame.querySelector("[data-pay-qr-load-error]");
          if (oldErr) oldErr.remove();
          var oldRetry = frame.querySelector("[data-pay-qr-retry]");
          if (oldRetry) oldRetry.remove();
        }
        var panel = img.closest("[data-pay-qr]");
        if (panel) panel.setAttribute("data-pay-qr-img-status", "ok");
      });
      img.addEventListener("error", function () {
        // Never silently hide the QR on mobile/PC — keep the image slot visible for diagnosis + retry.
        img.setAttribute("data-pay-qr-load", "error");
        img.style.display = "block";
        img.style.visibility = "visible";
        img.style.opacity = "1";
        img.style.minWidth = "180px";
        img.style.minHeight = "180px";
        img.style.outline = "1px dashed rgba(255,143,197,.55)";
        var frame = img.parentNode;
        var panel = img.closest("[data-pay-qr]");
        if (panel) panel.setAttribute("data-pay-qr-img-status", "error");
        if (frame && !frame.querySelector("[data-pay-qr-load-error]")) {
          var wrap = document.createElement("div");
          wrap.className = "pay-qr-load-fail";
          wrap.setAttribute("data-pay-qr-load-error", "1");
          wrap.setAttribute("role", "status");
          var p = document.createElement("p");
          p.className = "pay-alert";
          p.style.margin = "10px 0 8px";
          p.textContent = "二维码图片加载失败。图片区域已保留，不会隐藏。请点击重试，或联系客服。";
          var btn = document.createElement("button");
          btn.type = "button";
          btn.className = "pay-btn";
          btn.setAttribute("data-pay-qr-retry", "1");
          btn.textContent = "重新加载二维码";
          wrap.appendChild(p);
          wrap.appendChild(btn);
          frame.appendChild(wrap);
        }
      });
    });
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
  function isMultiParent(order) {
    if (!order) return false;
    if (order.parentOrderId || order.parent_order_id) return false;
    if (order.isMultiGroupParent) return true;
    var typeKey = String(order.orderTypeKey || order.order_type || "").toLowerCase();
    if (typeKey === "multi_group") return true;
    if (Array.isArray(order.children) && order.children.length >= 2) return true;
    var blob =
      String(order.description || "") +
      "\n" +
      String(order.note || "") +
      "\n" +
      String(order.title || "") +
      "\n" +
      String(order.orderType || "");
    if (/子单数[:：]\s*[2-9]|多人订单|多人陪玩/.test(blob)) return true;
    try {
      var pending = JSON.parse(sessionStorage.getItem("mcjMultiPendingPay") || "null");
      if (pending && String(pending.orderId || "") === String(order.id || "")) return true;
    } catch (ePend) {
      /* ignore */
    }
    try {
      var list = JSON.parse(localStorage.getItem("mcjBossOrdersCache") || "[]");
      if (!Array.isArray(list)) list = [];
      var kids = list.filter(function (o) {
        return String(o.parentOrderId || o.parent_order_id || "") === String(order.id || "");
      });
      if (kids.length >= 2) return true;
    } catch (eKids) {
      /* ignore */
    }
    return false;
  }
  function isMultiChild(order) {
    return !!(order && (order.isMultiGroupChild || order.parentOrderId || order.parent_order_id));
  }
  function multiChildren(order) {
    if (Array.isArray(order.children) && order.children.length) return order.children;
    try {
      var list = JSON.parse(localStorage.getItem("mcjBossOrdersCache") || "[]");
      if (!Array.isArray(list)) list = [];
      var pid = String(order.id || "");
      var fromCache = list.filter(function (o) {
        return String(o.parentOrderId || o.parent_order_id || "") === pid;
      });
      if (fromCache.length) return fromCache;
    } catch (e) {
      /* ignore */
    }
    // Description SoT from place_multi: "子单数：N"
    var blob = String(order.description || "") + "\n" + String(order.note || "");
    var m = blob.match(/子单数[:：]\s*(\d+)/);
    if (m) {
      var n = Number(m[1]);
      if (n > 0) return Array.from({ length: n }, function (_, i) {
        return { id: "placeholder-" + i, parentOrderId: order.id };
      });
    }
    return [];
  }
  function childField(ch, keys, fallback) {
    for (var i = 0; i < keys.length; i++) {
      var v = ch && ch[keys[i]];
      if (v != null && String(v).trim() !== "") return v;
    }
    return fallback;
  }
  function parseDescSnapshot(ch, label) {
    var blob = String((ch && (ch.description || ch.notes || ch.note)) || "");
    var re = new RegExp(label + "[：:]\\s*([^\\n；;]+)", "i");
    var m = blob.match(re);
    return m ? String(m[1]).trim() : "";
  }
  function childAvatarUrl(ch) {
    return (
      (ch && ch.companion && (ch.companion.avatar_url || ch.companion.avatarUrl)) ||
      childField(ch, ["avatarUrl", "avatar_url"], "") ||
      ""
    );
  }
  function childLineMeta(ch) {
    var hoursRaw = childField(ch, ["hours", "duration"], "") || parseDescSnapshot(ch, "时长") || "1";
    var hours = Number(String(hoursRaw).replace(/[^\d.-]/g, ""));
    if (!(hours > 0)) hours = 1;
    var unit =
      Number(childField(ch, ["unitPrice", "unit_price"], 0)) ||
      Number(String(parseDescSnapshot(ch, "单价快照") || parseDescSnapshot(ch, "单价") || "").replace(/[^\d.-]/g, "")) ||
      0;
    var sub =
      Number(childField(ch, ["totalAmount", "total_amount", "amount"], 0)) ||
      Number(String(parseDescSnapshot(ch, "小计快照") || "").replace(/[^\d.-]/g, "")) ||
      (unit > 0 ? Math.round(unit * hours * 100) / 100 : 0);
    var service =
      childField(ch, ["serviceType", "service_type", "serviceName", "service_name", "title"], "") ||
      parseDescSnapshot(ch, "服务") ||
      "-";
    var game = childField(ch, ["game", "mainGame", "main_game"], "") || "-";
    return {
      name: companionName(ch),
      avatar: childAvatarUrl(ch),
      game: game,
      service: service,
      hours: hours,
      unitPrice: unit,
      subtotal: sub,
    };
  }
  function multiCompanionCardsHtml(kids) {
    if (!kids || !kids.length) return "";
    return (
      '<div class="pay-multi-lines">' +
      kids
        .map(function (ch) {
          var meta = childLineMeta(ch);
          var avatar = meta.avatar
            ? '<img class="pay-multi-avatar" src="' +
              esc(meta.avatar) +
              '" alt="" width="44" height="44" loading="lazy" decoding="async">'
            : '<span class="pay-multi-avatar" aria-hidden="true">' + esc((meta.name || "?").slice(0, 1)) + "</span>";
          return (
            '<article class="pay-multi-line">' +
            avatar +
            '<div class="pay-multi-line-body">' +
            "<strong>" +
            esc(meta.name) +
            "</strong>" +
            '<p><span>游戏</span> ' +
            esc(meta.game) +
            "</p>" +
            "<p><span>服务</span> " +
            esc(meta.service) +
            "</p>" +
            "<p><span>时长</span> " +
            esc(meta.hours) +
            " 小时</p>" +
            "<p><span>单价</span> " +
            esc(money(meta.unitPrice)) +
            "/小时</p>" +
            "<p><span>小计</span> " +
            esc(money(meta.subtotal)) +
            "</p>" +
            "</div></article>"
          );
        })
        .join("") +
      "</div>"
    );
  }
  function loadWalletBalance() {
    return fetch("/api/recharge", {
      method: "GET",
      headers: { Accept: "application/json", Authorization: "Bearer " + token() },
      cache: "no-store",
    })
      .then(function (res) {
        return res.json().catch(function () {
          return {};
        });
      })
      .then(function (body) {
        var bal =
          body && body.summary && body.summary.balance != null
            ? body.summary.balance
            : body && body.wallet && body.wallet.totalBalance != null
              ? body.wallet.totalBalance
              : null;
        walletBalance = bal == null ? null : money(bal);
        walletBalanceLoaded = true;
        return walletBalance;
      })
      .catch(function () {
        walletBalanceLoaded = true;
        return walletBalance;
      });
  }
  function isReviewing(order) {
    return !!(
      order &&
      (order.paymentReview || /待审核|待人工审核|待客服审核/.test(String(order.paymentStatus || order.statusText || "")))
    );
  }
  /** Multi orders always require payment-proof upload before CS review — never wallet pay_order shortcut. */
  function requiresProofUpload(order) {
    if (isMultiParent(order)) return true;
    try {
      var pending = JSON.parse(sessionStorage.getItem("mcjMultiPendingPay") || "null");
      if (pending && order && String(pending.orderId || "") === String(order.id || "")) return true;
    } catch (ePend) {
      /* ignore */
    }
    return !isWalletMethod(order);
  }

  function forceMultiProofOrder(order, orderId) {
    var base = order && typeof order === "object" ? Object.assign({}, order) : {};
    base.id = base.id || orderId;
    base.status = base.status || "awaiting_payment";
    base.isMultiGroupParent = true;
    base.orderTypeKey = base.orderTypeKey || base.order_type || "multi_group";
    base.order_type = base.order_type || base.orderTypeKey || "multi_group";
    if (!base.paymentMethod && !base.payment_method) {
      base.paymentMethod = "catfood";
      base.payment_method = "catfood";
    }
    return base;
  }

  /** Always-visible payment info for multi (wallet or manual) — never hide behind empty failUi. */
  function multiPayInfoHtml(order) {
    if (!isMultiParent(order) || !isPrePay(order)) return "";
    var method = methodLabel(order);
    var raw = String(order.paymentMethod || order.payment_method || "catfood");
    var html = '<div class="pay-channel" data-multi-pay-info="1">';
    html += "<h2>支付信息</h2>";
    html +=
      '<div class="pay-row"><span>支付渠道</span><strong>' +
      esc(method === "该支付方式" ? raw : method) +
      "</strong></div>";
    html +=
      '<p class="pay-hint">多人订单须先完成付款并上传付款凭证。提交后进入「待客服审核」；客服审核通过前不会进入等待陪玩确认，也不会通知陪玩接单。</p>';
    if (isWalletMethod(order)) {
      html +=
        '<p class="pay-hint">本单支付方式为猫粮：请确认余额足够后，上传付款截图（或余额支付凭证）并点击「我已付款」提交客服审核。页面不会一键扣款跳过凭证。</p>';
    } else {
      html +=
        '<p class="pay-hint">请先按下方收款信息完成转账，再上传付款截图并提交。</p>';
    }
    html += "</div>";
    return html;
  }

  function fileInputHtml(orderId, labelText, primary) {
    // Button (not <label>+nested input): the real file input is durable outside paint().
    return (
      '<button type="button" class="pay-btn' +
      (primary ? " primary" : "") +
      ' pay-proof-pick" data-proof-pick="' +
      esc(orderId) +
      '">' +
      esc(labelText) +
      "</button>"
    );
  }

  function qrPanelHtml(order) {
    var st = String(order.status || "");
    if (st !== "awaiting_payment") return "";
    if (isWalletMethod(order)) return "";
    if (isReviewing(order) && !(activeProofFile() || proofDraft.previewUrl || proofDraft.serverProofUrl)) return "";
    var info = platformPayInfo || null;
    if (order && order.platformPayInfo && order.platformPayInfo.__live === true) {
      info = order.platformPayInfo;
    }
    var payLabel = methodLabel(order);
    var channelId = String((info && info.channelId) || "").toLowerCase();
    var qrUrlRaw = String((info && info.qrUrl) || "").trim();
    var hasQr = !!(info && qrUrlRaw && info.enabled !== false && info.unavailable !== true);
    var mismatch = false;
    if (hasQr && channelId && /tng|duitnow|alipay|bank|stripe|hitpay/.test(methodCode(order))) {
      var methodKey = methodCode(order);
      mismatch =
        (/tng/.test(methodKey) && channelId !== "tng") ||
        (/duitnow/.test(methodKey) && channelId !== "duitnow") ||
        (/alipay|支付宝/.test(methodKey) && channelId !== "alipay") ||
        (/stripe/.test(methodKey) && channelId !== "stripe") ||
        (/hitpay/.test(methodKey) && channelId !== "hitpay") ||
        (/bank|银行/.test(methodKey) && channelId !== "bank-transfer" && channelId !== "bank-my" && channelId !== "bank");
      if (mismatch) hasQr = false;
    }
    var html =
      '<div class="pay-qr" data-pay-qr data-pay-channel="' +
      esc(channelId || methodCode(order)) +
      '" data-pay-has-qr="' +
      (hasQr ? "1" : "0") +
      '" data-pay-qr-mismatch="' +
      (mismatch ? "1" : "0") +
      '" data-pay-qr-url-len="' +
      esc(String(qrUrlRaw.length)) +
      '">';
    html += "<h2>" + esc((info && info.title) || payLabel || "平台收款") + "</h2>";
    // Lightweight debug strip (no secrets): helps confirm mobile render path without guessing.
    html +=
      '<p class="pay-qr-debug" data-pay-qr-debug hidden>' +
      "hasQr=" +
      (hasQr ? "1" : "0") +
      " mismatch=" +
      (mismatch ? "1" : "0") +
      " urlLen=" +
      esc(String(qrUrlRaw.length)) +
      " live=" +
      (info && info.__live ? "1" : "0") +
      "</p>";
    if (hasQr) {
      html +=
        '<p class="pay-hint">' +
        esc((info && info.instructions) || "请扫描下方收款二维码完成付款。仅本支付页显示，首页不公开收款码。") +
        "</p>";
      if (window.McjPayQrPreview && typeof window.McjPayQrPreview.frameHtml === "function") {
        html += window.McjPayQrPreview.frameHtml(qrUrlRaw, payLabel + " 收款二维码");
      } else {
        html +=
          '<div class="pay-qr-frame" data-pay-qr-zoom="1" role="button" tabindex="0" aria-label="点击放大收款二维码"><img src="' +
          esc(qrUrlRaw) +
          '" alt="' +
          esc(payLabel + " 收款二维码") +
          '" data-mcj-pay-qr="1" referrerpolicy="no-referrer" data-pay-qr-img="1" draggable="false"></div>';
      }
    } else {
      var closedMsg = (info && info.instructions) || payLabel + " 暂未开放，请选择其他支付方式";
      html += '<p class="pay-alert" role="status" data-pay-unavailable="1">' + esc(closedMsg) + "</p>";
      html +=
        '<p class="pay-hint">不会自动切换到其他支付通道的二维码。请返回重新选择已开放的支付方式，或联系客服。</p>';
    }
    html += '<div class="pay-qr-meta">';
    if (hasQr && info && info.receiverName) {
      html += '<div class="pay-row"><span>收款人</span><strong>' + esc(info.receiverName) + "</strong></div>";
    }
    if (hasQr && info && info.bankName) {
      html += '<div class="pay-row"><span>银行</span><strong>' + esc(info.bankName) + "</strong></div>";
    }
    if (hasQr && info && info.bankAccount) {
      html += '<div class="pay-row"><span>银行账号</span><strong>' + esc(info.bankAccount) + "</strong></div>";
    }
    if (hasQr && info && info.phone && channelId === "tng") {
      html += '<div class="pay-row"><span>TNG 手机号</span><strong>' + esc(info.phone) + "</strong></div>";
    }
    if (hasQr && info && info.duitnowId && channelId === "duitnow") {
      html += '<div class="pay-row"><span>DuitNow ID</span><strong>' + esc(info.duitnowId) + "</strong></div>";
    }
    html +=
      '<div class="pay-row"><span>应付金额</span><strong>' +
      esc(money(order.totalAmount || order.amount)) +
      "</strong></div>";
    html += "</div></div>";
    return html;
  }
  function clearProofDraft(keepTip) {
    if (proofDraft.previewUrl && String(proofDraft.previewUrl).indexOf("blob:") === 0) {
      try {
        URL.revokeObjectURL(proofDraft.previewUrl);
      } catch (e) {}
    }
    heldProofFile = null;
    proofDraft.file = null;
    proofDraft.fileName = "";
    proofDraft.previewUrl = "";
    proofDraft.progress = 0;
    proofDraft.uploading = false;
    proofDraft.uploaded = false;
    proofDraft.error = "";
    proofDraft.serverProofUrl = "";
    if (!keepTip) proofDraft.successTip = "";
  }
  function isAllowedProofFile(file) {
    if (!file) return false;
    var type = String(file.type || "").toLowerCase();
    if (/^image\/(png|jpeg|jpg|webp)$/.test(type)) return true;
    if (/heic|heif|image\/heic|image\/heif/.test(type)) return false;
    var name = String(file.name || "").toLowerCase();
    if (/\.(heic|heif)$/.test(name)) return false;
    // Some Android WebViews omit MIME — allow by extension.
    return /\.(png|jpe?g|webp)$/.test(name) || /^image\//.test(type);
  }
  function setProofFile(orderId, file) {
    if (proofDraft.previewUrl && String(proofDraft.previewUrl).indexOf("blob:") === 0) {
      try {
        URL.revokeObjectURL(proofDraft.previewUrl);
      } catch (e) {}
    }
    heldProofFile = file || null;
    proofDraft.orderId = orderId;
    proofDraft.file = file;
    proofDraft.fileName = String((file && file.name) || "付款截图").trim() || "付款截图";
    proofDraft.progress = 0;
    proofDraft.uploading = false;
    proofDraft.uploaded = false;
    proofDraft.error = "";
    proofDraft.serverProofUrl = "";
    try {
      proofDraft.previewUrl = URL.createObjectURL(file);
    } catch (e) {
      proofDraft.previewUrl = "";
    }
  }

  /** Compress large phone photos so JSON body stays under platform limits; still a real image upload. */
  function prepareProofDataUrl(file, onProgress) {
    return new Promise(function (resolve, reject) {
      if (!file) return reject(new Error("请先选择付款截图"));
      var reader = new FileReader();
      reader.onerror = function () {
        reject(new Error("读取图片失败，请重选 JPG/PNG 后重试"));
      };
      reader.onprogress = function (ev) {
        if (ev.lengthComputable && ev.total && typeof onProgress === "function") {
          onProgress(Math.min(40, 10 + Math.round((ev.loaded / ev.total) * 30)));
        }
      };
      reader.onload = function () {
        var raw = String(reader.result || "");
        if (!/^data:image\//i.test(raw)) return reject(new Error("无法读取图片内容"));
        // Small enough already — upload as-is.
        if (file.size <= 900 * 1024 && raw.length < 1200 * 1024) {
          if (typeof onProgress === "function") onProgress(55);
          return resolve(raw);
        }
        var img = new Image();
        img.onload = function () {
          try {
            var maxEdge = 1600;
            var w = img.naturalWidth || img.width || 0;
            var h = img.naturalHeight || img.height || 0;
            if (!w || !h) return reject(new Error("图片尺寸无效"));
            var scale = Math.min(1, maxEdge / Math.max(w, h));
            var cw = Math.max(1, Math.round(w * scale));
            var ch = Math.max(1, Math.round(h * scale));
            var canvas = document.createElement("canvas");
            canvas.width = cw;
            canvas.height = ch;
            var ctx = canvas.getContext("2d");
            if (!ctx) return reject(new Error("浏览器无法压缩图片，请换一张较小的 JPG/PNG"));
            ctx.drawImage(img, 0, 0, cw, ch);
            var quality = 0.82;
            var out = canvas.toDataURL("image/jpeg", quality);
            while (out.length > 1.6 * 1024 * 1024 && quality > 0.5) {
              quality -= 0.08;
              out = canvas.toDataURL("image/jpeg", quality);
            }
            if (out.length > 2.8 * 1024 * 1024) {
              return reject(new Error("图片过大，请换一张更清晰且小于 8MB 的截图后重试"));
            }
            if (typeof onProgress === "function") onProgress(60);
            resolve(out);
          } catch (err) {
            reject(new Error(err.message || "图片压缩失败"));
          }
        };
        img.onerror = function () {
          reject(new Error("图片预览失败，请改用 JPG 或 PNG 重新选择"));
        };
        img.src = raw;
      };
      reader.readAsDataURL(file);
    });
  }

  var STATUS_LABEL = (window.MCJOrderStatus && window.MCJOrderStatus.LABELS) || {
    awaiting_payment: "待付款",
    payment_review: "待人工审核",
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

  var platformPayInfo = null;
  var discordStatus = { loaded: false, bound: false, username: "", configured: true };

  function orderVoiceMode(order) {
    return String((order && (order.voiceMode || order.voice_mode)) || "game_mic")
      .trim()
      .toLowerCase() || "game_mic";
  }
  function voiceModeLabel(mode) {
    var m = String(mode || "game_mic").toLowerCase();
    if (m === "discord") return "Discord语音房";
    if (m === "none") return "仅平台文字聊天"; // legacy orders only
    return "游戏麦";
  }
  function isPrePay(order) {
    var st = String((order && order.status) || "");
    return st === "awaiting_payment" && !isReviewing(order);
  }
  function isPostPay(order) {
    return !isPrePay(order);
  }
  function scheduleText(order) {
    var raw =
      (order &&
        (order.serviceSchedule ||
          order.schedule ||
          order.service_schedule ||
          order.scheduleLabel ||
          order.schedule_label)) ||
      "";
    raw = String(raw || "").trim();
    if (raw) return raw;
    // Fallback: parse from notes ("服务时间：…")
    var notes = String((order && (order.notes || order.note || order.description)) || "");
    var m = notes.match(/服务时间[：:]\s*([^\n]+)/);
    if (m) return String(m[1] || "").trim();
    return "-";
  }
  function paymentReturnPath(orderId) {
    var oid = orderId || q("order") || q("id") || "";
    return "/payment-confirm.html?order=" + encodeURIComponent(oid) + "&discord=connected";
  }
  function startDiscordOAuth(orderId) {
    var returnTo = paymentReturnPath(orderId);
    return fetch("/api/discord/oauth-start?format=json&returnTo=" + encodeURIComponent(returnTo), {
      headers: { Accept: "application/json", Authorization: "Bearer " + token() },
    })
      .then(function (r) {
        return r.json().then(function (j) {
          if (!r.ok || j.ok === false) throw new Error((j && j.message) || "无法开始 Discord 连接");
          return j;
        });
      })
      .then(function (j) {
        if (j.authorizeUrl) {
          location.href = j.authorizeUrl;
          return;
        }
        throw new Error("Discord 授权地址缺失");
      });
  }
  /** Pre-pay: tiny hint only. Post-pay: connect CTA if unbound. Never block payment. */
  function discordPanelHtml(order) {
    var mode = orderVoiceMode(order);
    if (mode !== "discord") return "";
    var bound = !!(discordStatus.bound || order.discordBound);
    var name = discordStatus.username || order.discordUsername || "";

    if (isPrePay(order)) {
      return (
        '<p class="pay-voice-hint">支付成功后可连接 Discord，陪玩接单后将开启私人语音房。</p>'
      );
    }

    if (bound) {
      return (
        '<div class="pay-discord is-bound" data-discord-panel="1">' +
        '<p class="pay-discord-title">Discord 已连接' +
        (name ? "：" + esc(name) : "") +
        "</p>" +
        '<p class="pay-discord-desc">陪玩确认接单后将开启私人语音房。</p></div>'
      );
    }

    return (
      '<div class="pay-discord" data-discord-panel="1">' +
      '<p class="pay-discord-title">连接 Discord</p>' +
      '<p class="pay-discord-desc">你已选择 Discord语音房，请先连接 Discord，以便后续进入私人语音房。</p>' +
      '<div class="pay-actions pay-discord-actions">' +
      '<button type="button" class="pay-btn primary" data-discord-connect="' +
      esc(order.id) +
      '">连接 Discord</button>' +
      '<a class="pay-btn" href="orders.html?id=' +
      encodeURIComponent(order.id) +
      '">稍后再说</a></div></div>'
    );
  }
  async function refreshDiscordStatus(order) {
    var mode = orderVoiceMode(order);
    if (mode !== "discord") {
      discordStatus = { loaded: true, bound: false, username: "", configured: true };
      return discordStatus;
    }
    try {
      var res = await fetch(
        "/api/discord/status?orderId=" + encodeURIComponent(order.id || ""),
        { headers: { Accept: "application/json", Authorization: "Bearer " + token() }, cache: "no-store" }
      );
      var body = await res.json().catch(function () {
        return {};
      });
      if (res.ok && body.ok !== false) {
        discordStatus = {
          loaded: true,
          bound: !!body.bound,
          username: (body.discord && body.discord.username) || "",
          configured: body.configured !== false,
        };
      } else {
        discordStatus = { loaded: true, bound: false, username: "", configured: true };
      }
    } catch (e) {
      discordStatus = { loaded: true, bound: false, username: "", configured: true };
    }
    return discordStatus;
  }

  function canShowTestPay() {
    if (allowTestPay === true) return true;
    if (allowTestPay === false) return false;
    return !!(window.MCJOrderStatus && window.MCJOrderStatus.isPreviewHost && window.MCJOrderStatus.isPreviewHost());
  }

  function statusGuide(status, order) {
    var s = String(status || "");
    var reviewing = isReviewing(order);
    var reviewerName = String((order && (order.paymentReviewedByName || order.reviewedByStaffName)) || "").trim();
    var bossHint = String((order && order.bossHint) || "").trim();
    if (s === "awaiting_payment" && reviewing) {
      return {
        title: "待客服审核",
        reason: "付款信息已提交，正在等待客服人工审核。审核通过前不会通知陪玩。",
        next: "客服确认收款后订单才会进入接单流程；驳回后可重新上传凭证。",
        primary: "orders",
        primaryLabel: "查看我的订单",
        disabledHint: "",
      };
    }
    if (s === "awaiting_payment") {
      var rejectReason = String((order && (order.paymentRejectReason || order.rejectReason)) || "").trim();
      var needProof = requiresProofUpload(order || {});
      return {
        title: "待付款",
        reason: rejectReason
          ? reviewerName
            ? "付款凭证未通过（审核客服：" + reviewerName + "）：" + rejectReason
            : "付款凭证已驳回：" + rejectReason
          : isMultiParent(order || {})
            ? "多人订单已创建。请先查看支付信息并上传付款凭证，提交后进入客服审核。"
            : "订单已创建，状态为待付款。",
        next: needProof
          ? rejectReason
            ? "请重新按所选支付方式付款并上传截图，点击「我已付款」。"
            : "请按本单支付信息完成付款，上传付款截图后点击「我已付款」。提交后进入「待客服审核」。"
          : "请使用猫粮余额完成支付，支付成功后订单才会发送给陪玩确认。",
        primary: "pay",
        primaryLabel: needProof ? "上传付款凭证" : "确认支付",
        disabledHint: "",
      };
    }
    if (s === "claimed") {
      return {
        title: "等待陪玩确认",
        reason: reviewerName
          ? "已由客服 " + reviewerName + " 审核通过，正在等待陪玩确认接单"
          : bossHint || "订单已支付，正在等待陪玩确认接单",
        next: "陪玩确认前不会开始服务，也不会结算收益。",
        primary: "orders",
        primaryLabel: "查看我的订单",
        disabledHint: "付款已完成，等待陪玩确认",
      };
    }
    if (s === "pending") {
      return {
        title: "待客服处理",
        reason: reviewerName
          ? "已由客服 " + reviewerName + " 审核通过，待派单/抢单。"
          : bossHint || "付款已确认，正在等待客服处理派单",
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
    if (s === "confirmed" || s === "in_progress") {
      return {
        title: "进行中",
        reason: s === "in_progress" ? "服务进行中" : "陪玩已确认接单",
        next: "如有问题请联系客服协助。",
        primary: s === "in_progress" ? "contact_cs" : "orders",
        primaryLabel: s === "in_progress" ? "联系客服" : "查看我的订单",
        disabledHint: "付款已确认，无需重复操作",
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

  function failUi(msg, opts) {
    opts = opts || {};
    var oid = String(opts.orderId || q("order") || q("id") || "").trim();
    // Multi pending pay: never strand boss on empty reload-only page.
    if (oid) {
      try {
        var pending = JSON.parse(sessionStorage.getItem("mcjMultiPendingPay") || "null");
        var cached = readCache(oid);
        if ((pending && String(pending.orderId) === oid) || isMultiParent(cached || {})) {
          var forced = forceMultiProofOrder(cached || { id: oid, status: "awaiting_payment", totalAmount: pending && pending.totalAmount }, oid);
          proofDraft.error = String(msg || "").trim() || "订单状态同步失败，请上传付款凭证或点击下方重新加载。";
          renderOrder(forced);
          return;
        }
      } catch (eFail) {
        /* fall through */
      }
    }
    paint(
      '<section class="pay-card"><h1>支付确认</h1>' +
        '<p class="pay-alert" role="alert">' +
        esc(msg || "订单加载失败，请重试") +
        "</p>" +
        (oid
          ? '<p class="pay-hint">订单号参考：' + esc(oid) + "。若刚完成多人下单，请点「重新加载」；仍失败请从「我的订单」进入该单「立即去支付」。</p>"
          : "") +
        '<div class="pay-actions">' +
        '<button type="button" class="pay-btn primary" data-reload>重新加载</button>' +
        '<a class="pay-btn" href="orders.html">查看我的订单</a>' +
        "</div></section>"
    );
  }

  function insufficientBalanceUi(orderId, msg, rechargeUrl) {
    var oid = String(orderId || "").trim();
    var payHref = oid ? "payment-confirm.html?order=" + encodeURIComponent(oid) : "orders.html";
    var rechargeHref = String(rechargeUrl || "/recharge.html").replace(/^\//, "");
    try {
      sessionStorage.setItem("mcjPayReturn", payHref);
    } catch (e) {}
    paint(
      '<section class="pay-card" data-order-id="' +
        esc(oid) +
        '"><h1>支付确认</h1>' +
        '<p class="pay-alert" role="alert">' +
        esc(msg || "猫粮余额不足") +
        "</p>" +
        '<p class="pay-hint">充值成功后请返回本页继续支付；订单资料与金额不会丢失。</p>' +
        '<div class="pay-actions">' +
        '<a class="pay-btn primary" href="' +
        esc(rechargeHref) +
        '">去充值</a>' +
        '<button type="button" class="pay-btn" data-pay-order="' +
        esc(oid) +
        '">余额已到账，重试支付</button>' +
        '<a class="pay-btn" href="' +
        esc(payHref) +
        '">返回支付页</a>' +
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
    var preview = proofDraft.previewUrl || proofDraft.serverProofUrl || order.paymentProofUrl || "";
    var localFile = activeProofFile();
    var hasLocal = !!(localFile || proofDraft.previewUrl);
    if (String(order.status || "") !== "awaiting_payment") return "";
    // Multi always shows proof panel; wallet-only singles hide until reviewing/local file.
    if (!requiresProofUpload(order) && isWalletMethod(order) && !reviewing && !hasLocal) return "";

    // Manual channels with closed QR: still show proof panel for multi; singles may hide QR-only dead end.
    var info = platformPayInfo || (order && order.platformPayInfo) || null;
    var channelClosed =
      !isMultiParent(order) &&
      !isWalletMethod(order) &&
      !reviewing &&
      !hasLocal &&
      info &&
      info.__live === true &&
      (!info.qrUrl || info.enabled === false || info.unavailable === true);
    if (channelClosed) return "";

    var html = '<div class="pay-proof" data-proof-panel>';
    html += "<h2>付款截图</h2>";
    if (reviewing && !hasLocal) {
      html += '<p class="pay-hint">当前状态：待人工审核。可删除后重新上传，或进入「我的订单」查看。</p>';
    } else {
      html += '<p class="pay-hint">请上传付款截图（JPG / PNG / WEBP），确认预览无误后点击「我已付款」提交客服审核。</p>';
    }

    if (preview) {
      html +=
        '<div class="pay-proof-preview"><img src="' +
        esc(preview) +
        '" alt="付款截图预览" data-mcj-pay-proof="1">' +
        (proofDraft.fileName
          ? '<p class="pay-proof-name" data-proof-filename>已选择：' + esc(proofDraft.fileName) + "</p>"
          : reviewing || proofDraft.uploaded
            ? '<p class="pay-proof-name" data-proof-uploaded>付款凭证已上传</p>'
            : "") +
        '<div class="pay-proof-preview-actions">' +
        '<button type="button" class="pay-btn" data-proof-delete>删除</button>' +
        fileInputHtml(order.id, "重新上传", false) +
        "</div></div>";
    } else {
      html += fileInputHtml(order.id, "选择付款截图", true);
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
    if (proofDraft.successTip || (reviewing && !proofDraft.error && !localFile)) {
      html +=
        '<p class="pay-success" role="status" data-proof-success>' +
        esc(proofDraft.successTip || "付款凭证已上传，当前状态：待人工审核") +
        "</p>";
    }
    if (proofDraft.error) {
      html += '<p class="pay-alert" role="alert" data-proof-error>' + esc(proofDraft.error) + "</p>";
    }

    html += '<div class="pay-actions pay-proof-actions">';
    if (localFile && !proofDraft.uploaded) {
      html +=
        '<button type="button" class="pay-btn primary" data-proof-submit="' +
        esc(order.id) +
        '"' +
        (proofDraft.uploading ? " disabled aria-busy=\"true\"" : "") +
        ">" +
        (proofDraft.uploading ? "上传中…" : "我已付款") +
        "</button>";
    } else if (!reviewing && !proofDraft.uploaded) {
      html +=
        '<button type="button" class="pay-btn primary is-disabled" data-proof-submit="' +
        esc(order.id) +
        '" disabled aria-disabled="true">我已付款</button>';
      html += '<p class="pay-hint" data-proof-need-file>请先选择付款截图，上传成功后才能提交。</p>';
    } else if (reviewing || proofDraft.uploaded) {
      html +=
        '<a class="pay-btn primary" href="orders.html?filter=payment_review&id=' +
        encodeURIComponent(order.id) +
        '">查看我的订单（待审核）</a>';
      html += fileInputHtml(order.id, "重新上传", false);
    }
    html += "</div></div>";
    return html;
  }

  function renderOrder(order, opts) {
    opts = opts || {};
    var st = String(order.status || "");
    var guide = statusGuide(st, order);
    var reviewing = isReviewing(order);
    var label = reviewing && st === "awaiting_payment" ? "待客服审核" : STATUS_LABEL[st] || order.statusText || st;
    var csHref = "support.html?order=" + encodeURIComponent(order.id);
    var ordersHref =
      reviewing && st === "awaiting_payment"
        ? "orders.html?filter=payment_review&id=" + encodeURIComponent(order.id)
        : "orders.html?id=" + encodeURIComponent(order.id);
    var actions = '<div class="pay-actions">';
    var needsManualProof = st === "awaiting_payment" && requiresProofUpload(order);

    if (st === "cancelled") {
      paint(
        '<section class="pay-card"><h1>支付确认</h1>' +
          '<p class="pay-alert"><strong>该订单已取消，无法继续付款。</strong></p>' +
          "<p>" +
          esc(guide.next || "如需重新下单，请返回陪玩大厅。") +
          "</p>" +
          '<div class="pay-actions">' +
          '<a class="pay-btn primary" href="orders.html">查看我的订单</a>' +
          '<a class="pay-btn" href="companion-center.html">返回陪玩大厅</a>' +
          "</div></section>"
      );
      return;
    }

    if (guide.primary === "pay" && st === "awaiting_payment" && !reviewing && isWalletMethod(order) && !requiresProofUpload(order)) {
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
      actions += '<a class="pay-btn" href="recharge.html">余额不足？去充值</a>';
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

    var multi = isMultiParent(order);
    var kids = multi ? multiChildren(order) : [];
    var realKids = kids.filter(function (ch) {
      return ch && !/^placeholder-/.test(String(ch.id || ""));
    });
    var companionCell = multi
      ? realKids.length
        ? realKids
            .map(function (ch) {
              return companionName(ch);
            })
            .join(" · ")
        : "多人陪玩订单"
      : companionName(order);
    var serviceCell = multi
      ? "多人陪玩 · 共" + (realKids.length || kids.length || "?") + "位陪玩"
      : order.game || order.serviceName || order.title || "-";
    var title = multi ? "多人陪玩订单 · 支付确认" : isPrePay(order) ? "支付确认" : "支付成功";
    var multiHint = multi
      ? '<p class="pay-hint">本订单一次付款 ' +
        esc(money(order.totalAmount || order.amount)) +
        "；请先上传付款凭证并提交。提交后进入「待客服审核」，客服通过后才会通知陪玩接单。</p>"
      : "";
    if (isMultiChild(order)) {
      multiHint =
        '<p class="pay-hint">这是多人订单的子订单，请回到联合订单父单完成一次付款。</p>';
      actions =
        '<div class="pay-actions"><a class="pay-btn primary" href="orders.html?id=' +
        encodeURIComponent(order.parentOrderId || order.parent_order_id || order.id) +
        '">查看联合订单</a><a class="pay-btn" href="orders.html">我的订单</a></div>';
    }

    var statusLead = isPrePay(order)
      ? '<p class="pay-lead">请确认以下订单与金额后完成支付。未确认支付前订单保持待付款。</p>'
      : '<p class="pay-lead">' +
        esc(reviewing ? "付款凭证已提交，等待客服审核。" : "订单已付款成功。") +
        "</p>";

    var walletRows = "";
    if (isPrePay(order) && isWalletMethod(order) && !requiresProofUpload(order)) {
      walletRows =
        '<div class="pay-row"><span>当前猫粮余额</span><strong>' +
        esc(walletBalanceLoaded ? (walletBalance == null ? "—" : money(walletBalance)) : "加载中…") +
        "</strong></div>" +
        '<div class="pay-row"><span>支付金额</span><strong>' +
        esc(money(order.totalAmount || order.amount)) +
        "</strong></div>";
    }

    paint(
      '<section class="pay-card" data-order-id="' +
        esc(order.id) +
        '"' +
        (multi ? ' data-multi-parent="1"' : "") +
        '><header class="pay-head"><h1>' +
        esc(title) +
        "</h1>" +
        statusLead +
        "</header>" +
        '<div class="pay-info-card">' +
        '<div class="pay-row"><span>订单号</span><strong>' +
        esc(order.orderNo || order.order_no || order.id) +
        "</strong></div>" +
        (multi
          ? '<div class="pay-row"><span>订单类型</span><strong>多人陪玩</strong></div>' +
            '<div class="pay-row"><span>人数</span><strong>' +
            esc(String(realKids.length || kids.length || 0)) +
            " 位陪玩</strong></div>"
          : "") +
        '<div class="pay-row"><span>陪玩</span><strong>' +
        esc(companionCell) +
        "</strong></div>" +
        '<div class="pay-row"><span>服务</span><strong>' +
        esc(serviceCell) +
        "</strong></div>" +
        '<div class="pay-row"><span>服务时间</span><strong>' +
        esc(scheduleText(order)) +
        "</strong></div>" +
        '<div class="pay-row"><span>语音方式</span><strong>' +
        esc(voiceModeLabel(orderVoiceMode(order))) +
        "</strong></div>" +
        walletRows +
        '<div class="pay-row pay-row-amount"><span>' +
        (multi ? "订单总额" : "应付金额") +
        "</span><strong>" +
        esc(money(order.totalAmount || order.amount)) +
        "</strong></div>" +
        (isPrePay(order)
          ? '<div class="pay-row"><span>支付方式</span><strong>' +
            esc(order.paymentMethod || order.payment_method || "-") +
            "</strong></div>"
          : "") +
        "</div>" +
        (multi ? multiCompanionCardsHtml(realKids.length ? realKids : kids) : "") +
        multiHint +
        multiPayInfoHtml(order) +
        discordPanelHtml(order) +
        // Mobile-first: QR after order summary for pre-pay (non-wallet / or when QR present)
        (isPrePay(order) ? qrPanelHtml(order) : "") +
        (reviewing
          ? '<p class="pay-hint">付款凭证已提交，客服确认收款前不会进入接单流程。</p>'
          : needsManualProof
            ? '<p class="pay-hint">请先按本单支付方式完成付款，再上传截图并点击「我已付款」。</p>'
            : "") +
        proofPanelHtml(order) +
        actions +
        (opts.fromCache ? '<p class="pay-sync">正在同步最新订单状态…</p>' : "") +
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
          paymentMethod: (readCache(orderId) && (readCache(orderId).paymentMethod || readCache(orderId).payment_method)) || "",
        }),
      });
      var body = await res.json().catch(function () {
        return {};
      });
      if (typeof body.allowTestPay === "boolean") allowTestPay = body.allowTestPay;
      if (!res.ok || body.ok === false) {
        if (body.code === "MANUAL_PAYMENT_REQUIRES_PROOF") {
          // Never fall into empty failUi — force proof uploader for multi / manual path.
          var forced = forceMultiProofOrder(
            body.order || readCache(orderId) || { id: orderId, status: "awaiting_payment" },
            orderId
          );
          writeCache(orderId, forced);
          proofDraft.error =
            body.message ||
            "多人订单须先上传付款凭证并提交。提交后进入「待客服审核」。";
          proofDraft.successTip = "";
          renderOrder(forced);
          return;
        }
        if (body.code === "USE_TEST_PAY" && canShowTestPay()) {
          allowTestPay = true;
          var cached = readCache(orderId);
          if (cached) renderOrder(cached);
          failUi(body.message || "请使用测试支付成功（TEST）");
          return;
        }
        if (body.code === "INSUFFICIENT_BALANCE" || /余额不足/.test(String(body.message || ""))) {
          insufficientBalanceUi(orderId, body.message || "猫粮余额不足", body.rechargeUrl || "/recharge.html");
          return;
        }
        throw new Error(body.message || "支付失败");
      }
      if (body.order) writeCache(orderId, body.order);
      var paidOrder = body.order || readCache(orderId) || { id: orderId, status: "claimed" };
      // Multi / CS-review path: boss submitted payment info — stay awaiting CS, never jump to waiting_companion.
      if (
        body.paymentReview ||
        paidOrder.paymentReview ||
        String(paidOrder.status || "") === "awaiting_payment" ||
        /待客服审核|待人工审核/.test(String(paidOrder.statusText || paidOrder.paymentStatus || ""))
      ) {
        writeCache(orderId, Object.assign({}, paidOrder, { paymentReview: true, status: "awaiting_payment" }));
        goMyOrdersReview(orderId);
        return;
      }
      // Post-pay Discord: if Discord voice + unbound, stay on page with connect CTA.
      if (orderVoiceMode(paidOrder) === "discord") {
        await refreshDiscordStatus(paidOrder);
        if (!discordStatus.bound) {
          renderOrder(paidOrder);
          return;
        }
      }
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

  function tickProgress(target) {
    proofDraft.progress = Math.max(Number(proofDraft.progress) || 0, target);
  }

  function goMyOrdersReview(orderId) {
    var href = "orders.html?filter=payment_review&id=" + encodeURIComponent(orderId);
    if (redirectTimer) clearTimeout(redirectTimer);
    redirectTimer = setTimeout(function () {
      location.replace(href);
    }, 650);
  }

  async function submitProof(orderId) {
    var file = activeProofFile();
    var current = readCache(orderId) || { id: orderId, status: "awaiting_payment", paymentMethod: "duitnow" };
    if (paying || proofDraft.uploading) {
      proofDraft.error = "正在上传中，请稍候…";
      renderOrder(current);
      return;
    }
    if (!file) {
      proofDraft.error = "请先选择付款截图，再点击「我已付款」";
      proofDraft.successTip = "";
      renderOrder(current);
      return;
    }
    if (!isAllowedProofFile(file)) {
      proofDraft.error = "仅支持 JPG、PNG、WEBP。iPhone 请用「照片」导出为 JPG，或关闭「保留原格式」后再选。";
      renderOrder(current);
      return;
    }
    paying = true;
    proofDraft.uploading = true;
    proofDraft.progress = 8;
    proofDraft.error = "";
    proofDraft.successTip = "正在上传付款截图…";
    renderOrder(current);
    try {
      tickProgress(12);
      renderOrder(current);
      var dataUrl = await prepareProofDataUrl(file, function (p) {
        tickProgress(p);
        renderOrder(current);
      });
      tickProgress(72);
      proofDraft.successTip = "付款截图处理完成，正在提交审核…";
      renderOrder(current);
      var res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + token() },
        body: JSON.stringify({
          action: "submit_payment_proof",
          id: orderId,
          proofDataUrl: dataUrl,
          paymentMethod: current.paymentMethod || current.payment_method || "",
        }),
      });
      var body = await res.json().catch(function () {
        return {};
      });
      if (!res.ok || body.ok === false) throw new Error(body.message || "付款凭证提交失败（" + res.status + "）");
      if (!body.order || !(body.order.paymentProofUrl || body.order.payment_proof_url)) {
        throw new Error("上传未返回图片地址，请重试（禁止本地假预览代替真实上传）");
      }
      tickProgress(100);
      proofDraft.uploading = false;
      proofDraft.uploaded = true;
      heldProofFile = null;
      proofDraft.file = null;
      proofDraft.successTip = "付款凭证已上传。订单进入待审核，正在跳转「我的订单」…";
      var nextOrder = body.order || current;
      nextOrder.paymentReview = true;
      nextOrder.status = nextOrder.status || "awaiting_payment";
      nextOrder.statusText = "待客服审核";
      nextOrder.paymentStatus = "待客服审核";
      nextOrder.paymentProofUrl = body.order.paymentProofUrl || body.order.payment_proof_url || "";
      proofDraft.serverProofUrl = nextOrder.paymentProofUrl;
      proofDraft.previewUrl = nextOrder.paymentProofUrl;
      proofDraft.fileName = "";
      try {
        var durable = document.getElementById("mcjDurableProofInput");
        if (durable) durable.value = "";
      } catch (e) {}
      writeCache(orderId, nextOrder);
      renderOrder(nextOrder);
      goMyOrdersReview(orderId);
    } catch (err) {
      proofDraft.uploading = false;
      proofDraft.progress = 0;
      proofDraft.uploaded = false;
      proofDraft.error = err.message || "付款凭证提交失败";
      proofDraft.successTip = "";
      renderOrder(current);
    } finally {
      paying = false;
    }
  }

  function readCache(id) {
    try {
      var raw = localStorage.getItem(cacheKey + id) || sessionStorage.getItem(cacheKey + id);
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (parsed && !parsed.status) parsed.status = "awaiting_payment";
      if (parsed && parsed.platformPayInfo) delete parsed.platformPayInfo;
      return parsed;
    } catch (e) {
      return null;
    }
  }

  function writeCache(id, order) {
    try {
      var safe = order && typeof order === "object" ? Object.assign({}, order) : order;
      if (safe && safe.platformPayInfo) delete safe.platformPayInfo;
      var payload = JSON.stringify(safe);
      localStorage.setItem(cacheKey + id, payload);
      sessionStorage.setItem(cacheKey + id, payload);
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
      if (body.platformPayInfo && typeof body.platformPayInfo === "object") {
        platformPayInfo = Object.assign({}, body.platformPayInfo, { __live: true });
      } else {
        platformPayInfo = {
          qrUrl: "",
          enabled: false,
          instructions: "支付通道暂不可用",
          title: "平台收款",
          __live: true,
        };
      }
      if (!res.ok || body.ok === false) throw new Error(body.message || "订单读取失败");
      var order = pickOrder(body.orders, orderId);
      if (!order) {
        failUi("订单不存在，请到「我的订单」查看。");
        return;
      }
      if (isMultiParent(order)) {
        try {
          var listRes = await fetch("/api/orders", {
            headers: { Accept: "application/json", Authorization: "Bearer " + token() },
            cache: "no-store",
            signal: abortCtrl ? abortCtrl.signal : undefined,
          });
          var listBody = await listRes.json().catch(function () {
            return {};
          });
          if (listRes.ok && listBody.ok !== false && Array.isArray(listBody.orders)) {
            try {
              localStorage.setItem("mcjBossOrdersCache", JSON.stringify(listBody.orders));
            } catch (eCache) {}
            var kids = listBody.orders.filter(function (o) {
              return String(o.parentOrderId || o.parent_order_id || "") === String(order.id);
            });
            if (kids.length) order.children = kids;
          }
        } catch (eList) {
          /* keep description fallback */
        }
      }
      order.platformPayInfo = platformPayInfo;
      writeCache(orderId, order);
      // Never wipe a local file selection / in-flight upload / open picker with a poll refresh.
      if (shouldFreezeOrderPaint() && !proofDraft.uploaded) {
        return;
      }
      if (order.paymentProofUrl && !proofDraft.previewUrl) {
        proofDraft.serverProofUrl = order.paymentProofUrl;
        proofDraft.previewUrl = order.paymentProofUrl;
        if (isReviewing(order)) {
          proofDraft.uploaded = true;
          proofDraft.successTip = proofDraft.successTip || "付款凭证已上传，当前状态：待人工审核";
        }
      }
      if (isWalletMethod(order) && isPrePay(order) && !requiresProofUpload(order)) {
        await loadWalletBalance();
      }
      await refreshDiscordStatus(order);
      if (gen !== loadGen) return;
      if (q("discord") === "connected") {
        discordStatus.bound = true;
      }
      renderOrder(order);
    } catch (err) {
      if (gen !== loadGen) return;
      if (err && err.name === "AbortError") return;
      if (cached) {
        if (isMultiParent(cached) || requiresProofUpload(cached)) {
          renderOrder(forceMultiProofOrder(cached, orderId));
        } else {
          renderOrder(cached);
        }
      } else {
        failUi(err.message || "订单加载失败，请重试", { orderId: orderId });
      }
    }
  }

  function startPoll() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(function () {
      if (document.hidden || proofDraft.uploading || proofDraft.file) return;
      loadOrder({ silent: true });
    }, POLL_MS);
  }

  root.addEventListener("click", function (e) {
    var qrRetry = e.target.closest("[data-pay-qr-retry]");
    if (qrRetry) {
      e.preventDefault();
      e.stopPropagation();
      var frame = qrRetry.closest(".pay-qr-frame") || qrRetry.parentNode;
      var img = frame && frame.querySelector("[data-mcj-pay-qr], [data-pay-qr-img], img");
      retryPayQrImage(img);
      return;
    }
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
      order = Object.assign({}, order, { paymentProofUrl: "", paymentReview: false });
      renderOrder(order);
      return;
    }
    var submitBtn = e.target.closest("[data-proof-submit]");
    if (submitBtn) {
      e.preventDefault();
      if (submitBtn.disabled || submitBtn.getAttribute("aria-disabled") === "true") {
        proofDraft.error = "请先选择付款截图，再点击「我已付款」";
        renderOrder(readCache(q("order") || q("id")) || { id: q("order") || q("id"), status: "awaiting_payment" });
        return;
      }
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
      return;
    }
    var discordBtn = e.target.closest("[data-discord-connect]");
    if (discordBtn) {
      e.preventDefault();
      startDiscordOAuth(discordBtn.getAttribute("data-discord-connect") || q("order") || q("id")).catch(function (err) {
        failUi(err.message || "连接 Discord 失败");
      });
    }
  });
  root.addEventListener("change", function (e) {
    var input = e.target.closest("[data-payment-proof], [data-mcj-durable-proof]");
    if (!input) return;
    onProofFileChosen(input);
  });

  // Capture-phase: catch file change even if bubbling is interrupted.
  document.addEventListener(
    "change",
    function (e) {
      var t = e.target;
      if (!t || t.id !== "mcjDurableProofInput") return;
      onProofFileChosen(t);
    },
    true
  );

  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) {
      // Returning from photo picker: keep local File/preview; only sync when idle.
      if (!shouldFreezeOrderPaint() || proofDraft.uploaded) loadOrder({ silent: true });
    }
  });

  window.addEventListener("pagehide", function () {
    if (abortCtrl) abortCtrl.abort();
    if (pollTimer) clearInterval(pollTimer);
    // Do NOT clearProofDraft here — mobile Safari may fire pagehide when opening the photo picker.
  });

  ensureDurableProofInput();
  loadOrder();
  startPoll();
})();
