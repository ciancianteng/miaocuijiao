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
    if (el) return el;
    el = document.createElement("input");
    el.id = "mcjDurableProofInput";
    el.type = "file";
    el.accept = "image/png,image/jpeg,image/webp,image/jpg,.png,.jpg,.jpeg,.webp";
    el.setAttribute("data-payment-proof", "");
    el.setAttribute("data-mcj-durable-proof", "1");
    el.className = "pay-proof-file";
    el.setAttribute("aria-hidden", "true");
    el.tabIndex = -1;
    el.style.cssText =
      "position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;overflow:hidden;z-index:2147483000;pointer-events:none;";
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
    el.style.pointerEvents = "auto";
    try {
      if (typeof el.showPicker === "function") el.showPicker();
      else el.click();
    } catch (err) {
      try {
        el.click();
      } catch (e2) {}
    }
    setTimeout(function () {
      el.style.pointerEvents = "none";
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
  function bindPayQrFallback() {
    root.querySelectorAll("[data-mcj-pay-qr],[data-pay-qr-img]").forEach(function (img) {
      if (img.getAttribute("data-bound-pay-qr") === "1") return;
      img.setAttribute("data-bound-pay-qr", "1");
      img.setAttribute("data-pay-qr-load", "pending");
      img.addEventListener("load", function () {
        img.setAttribute("data-pay-qr-load", "ok");
        img.style.display = "";
        img.style.visibility = "";
        img.style.opacity = "";
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
          var p = document.createElement("p");
          p.className = "pay-alert";
          p.setAttribute("role", "status");
          p.setAttribute("data-pay-qr-load-error", "1");
          p.textContent = "二维码图片加载失败，请点击重试或联系客服（图片槽位仍保留，不会隐藏）。";
          frame.appendChild(p);
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
  function isReviewing(order) {
    return !!(
      order &&
      (order.paymentReview || /待审核|待人工审核/.test(String(order.paymentStatus || order.statusText || "")))
    );
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
        title: "待人工审核",
        reason: "付款凭证已提交，正在等待客服人工审核。",
        next: "客服确认收款后订单才会进入接单流程；驳回后可重新上传凭证。",
        primary: "orders",
        primaryLabel: "查看我的订单",
        disabledHint: "",
      };
    }
    if (s === "awaiting_payment") {
      var rejectReason = String((order && (order.paymentRejectReason || order.rejectReason)) || "").trim();
      return {
        title: "待付款",
        reason: rejectReason
          ? reviewerName
            ? "付款凭证未通过（审核客服：" + reviewerName + "）：" + rejectReason
            : "付款凭证已驳回：" + rejectReason
          : "订单已创建，状态为待付款。",
        next: isWalletMethod(order || {})
          ? "请使用猫粮余额完成支付，支付成功后订单才会发送给陪玩确认。"
          : rejectReason
            ? "请重新按所选支付方式付款并上传截图，点击「我已付款」。"
            : "请按本单所选支付方式完成付款，上传付款截图后点击「我已付款」。",
        primary: "pay",
        primaryLabel: isWalletMethod(order || {}) ? "立即支付" : "前往支付",
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
    var preview = proofDraft.previewUrl || proofDraft.serverProofUrl || order.paymentProofUrl || "";
    var localFile = activeProofFile();
    var hasLocal = !!(localFile || proofDraft.previewUrl);
    if (String(order.status || "") !== "awaiting_payment") return "";
    if (isWalletMethod(order) && !reviewing && !hasLocal) return "";

    var info = platformPayInfo || (order && order.platformPayInfo) || null;
    var channelClosed =
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
      html += '<p class="pay-hint">扫码付款后，请上传付款截图（JPG / PNG / WEBP），再点击「我已付款」。选择后将立即显示预览。</p>';
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
    var label = reviewing && st === "awaiting_payment" ? "待人工审核" : STATUS_LABEL[st] || order.statusText || st;
    var csHref = "support.html?order=" + encodeURIComponent(order.id);
    var ordersHref =
      reviewing && st === "awaiting_payment"
        ? "orders.html?filter=payment_review&id=" + encodeURIComponent(order.id)
        : "orders.html?id=" + encodeURIComponent(order.id);
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

    paint(
      '<section class="pay-card" data-order-id="' +
        esc(order.id) +
        '"><h1>支付确认</h1>' +
        '<div class="pay-status-box"><strong data-pay-status>' +
        esc(label) +
        "</strong><p>" +
        esc(guide.reason) +
        "</p><p>" +
        esc(guide.next) +
        "</p></div>" +
        '<div class="pay-grid">' +
        '<div class="pay-row"><span>订单号</span><strong>' +
        esc(order.orderNo || order.order_no || order.id) +
        "</strong></div>" +
        '<div class="pay-row"><span>陪玩</span><strong>' +
        esc(companionName(order)) +
        "</strong></div>" +
        '<div class="pay-row"><span>服务</span><strong>' +
        esc(order.game || order.serviceName || order.title || "-") +
        "</strong></div>" +
        '<div class="pay-row"><span>时长</span><strong>' +
        esc(order.hours ? order.hours + " 小时" : order.duration || "-") +
        "</strong></div>" +
        '<div class="pay-row"><span>游戏 ID</span><strong>' +
        esc(parseGameId(order)) +
        "</strong></div>" +
        '<div class="pay-row"><span>应付金额</span><strong>' +
        esc(money(order.totalAmount || order.amount)) +
        "</strong></div>" +
        '<div class="pay-row"><span>支付方式</span><strong>' +
        esc(order.paymentMethod || order.payment_method || "-") +
        "</strong></div>" +
        '<div class="pay-row"><span>当前状态</span><strong>' +
        esc(label) +
        "</strong></div></div>" +
        (reviewing
          ? '<p class="pay-hint">付款凭证已提交，当前为待人工审核。客服确认收款前不会进入接单流程。</p>'
          : needsManualProof
            ? '<p class="pay-hint">请先按本单支付方式完成付款，再上传截图并点击「我已付款」。</p>'
            : "") +
        qrPanelHtml(order) +
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
      nextOrder.statusText = "待人工审核";
      nextOrder.paymentStatus = "待人工审核";
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
      if (document.hidden || proofDraft.uploading || proofDraft.file) return;
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
