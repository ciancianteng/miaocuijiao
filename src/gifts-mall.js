/**
 * Boss gift mall — gift → real companion (#235) → gift ORDER → pay + proof → CS review.
 * Instant send_gift success is removed from the mall path.
 */
(function () {
  "use strict";

  var state = {
    gifts: [],
    companions: [],
    selectedGift: null,
    selectedCompanion: null,
    companionsLoaded: false,
    quantity: 1,
    order: null,
    payInfo: null,
    proofDataUrl: "",
    proofName: "",
    uploading: false,
    creating: false,
  };

  function $(id) {
    return document.getElementById(id);
  }

  function toast(msg) {
    if (typeof window.toast === "function") {
      window.toast(String(msg || ""));
      return;
    }
    var el = $("gmToast");
    if (!el) {
      el = document.createElement("div");
      el.id = "gmToast";
      el.className = "gm-toast";
      el.hidden = true;
      document.body.appendChild(el);
    }
    el.textContent = String(msg || "");
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () {
      el.hidden = true;
    }, 2600);
  }

  function accessToken() {
    try {
      return (
        localStorage.getItem("mcjAuthAccessToken") ||
        sessionStorage.getItem("mcjAuthAccessToken") ||
        localStorage.getItem("customerAuthToken") ||
        ""
      );
    } catch (_) {
      return "";
    }
  }

  function authHeaders() {
    var h = { "Content-Type": "application/json", Accept: "application/json" };
    var t = accessToken();
    if (t) h.Authorization = "Bearer " + t;
    return h;
  }

  function requireBoss() {
    if (accessToken()) return true;
    if (window.MCJAuthContinue && typeof window.MCJAuthContinue.requireLogin === "function") {
      window.MCJAuthContinue.requireLogin(function () {});
      return null;
    }
    toast("请先以老板身份登录");
    try {
      sessionStorage.setItem("mcjReturnTo", location.pathname + location.search);
    } catch (_) {}
    setTimeout(function () {
      location.href = "/login.html";
    }, 400);
    return null;
  }

  function idem() {
    try {
      if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    } catch (_) {}
    return "gm_" + Date.now() + "_" + Math.random().toString(16).slice(2);
  }

  function escapeHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function giftEmoji(name) {
    var n = String(name || "");
    if (/鱼|小鱼/.test(n)) return "🐟";
    if (/罐头|猫罐头/.test(n)) return "🥫";
    if (/玫瑰|花/.test(n)) return "🌹";
    if (/钻石|钻/.test(n)) return "💎";
    if (/皇冠|冠/.test(n)) return "👑";
    if (/麦克|话筒/.test(n)) return "🎤";
    if (/火箭/.test(n)) return "🚀";
    return "🎁";
  }

  function giftPrice(g) {
    return Number(
      g && g.catFoodPrice != null
        ? g.catFoodPrice
        : g && g.cat_food_price != null
          ? g.cat_food_price
          : g && g.price_catfood != null
            ? g.price_catfood
            : 0
    );
  }

  function companionMeta(c) {
    var bits = [];
    if (c.game) bits.push(String(c.game));
    if (c.level || c.levelName) bits.push(String(c.level || c.levelName));
    if (!bits.length && c.specialty) bits.push(String(c.specialty));
    return bits.join(" · ") || "在线陪玩";
  }

  function setConfirmEnabled() {
    var btn = $("gmConfirmBtn");
    if (!btn) return;
    btn.disabled = !(state.selectedGift && state.selectedCompanion) || state.creating;
  }

  function updateSummary() {
    var line = $("gmConfirmLine");
    var hint = $("gmConfirmHint");
    if (!line) return;
    if (!state.selectedCompanion || !state.selectedGift) {
      line.innerHTML = "请选择一位陪玩";
      if (hint) hint.hidden = false;
      setConfirmEnabled();
      return;
    }
    var qty = Math.max(1, Number(state.quantity || 1));
    var total = giftPrice(state.selectedGift) * qty;
    line.innerHTML =
      "赠送给：<strong>" +
      escapeHtml(state.selectedCompanion.nickname || "陪玩") +
      "</strong><br>" +
      escapeHtml(state.selectedGift.name || "礼物") +
      " ×" +
      qty +
      " · " +
      total +
      " 猫粮";
    if (hint) hint.hidden = true;
    setConfirmEnabled();
  }

  function showStatus(title, detail) {
    var box = $("gmSuccess");
    if (!box) return;
    box.hidden = false;
    box.innerHTML =
      "<strong>" + escapeHtml(title) + "</strong><span>" + escapeHtml(detail || "") + "</span>";
  }

  function closeSheet(opts) {
    opts = opts || {};
    var sheet = $("gmSheet");
    var backdrop = $("gmSheetBackdrop");
    if (sheet) sheet.hidden = true;
    if (backdrop) backdrop.hidden = true;
    document.body.classList.remove("gm-sheet-open");
    if (!opts.keepSelection) {
      state.selectedGift = null;
      state.selectedCompanion = null;
      state.quantity = 1;
      updateSummary();
    }
  }

  function openSheet(gift) {
    if (!requireBoss()) return;
    state.selectedGift = gift;
    state.selectedCompanion = null;
    state.quantity = 1;
    var title = $("gmSheetTitle");
    if (title) title.textContent = "选择赠送对象";
    var sub = $("gmSheetGift");
    if (sub) sub.textContent = (gift.name || "礼物") + " · " + giftPrice(gift) + " 猫粮 / 份";
    var qty = $("gmQty");
    if (qty) qty.value = "1";
    var sheet = $("gmSheet");
    var backdrop = $("gmSheetBackdrop");
    if (sheet) sheet.hidden = false;
    if (backdrop) backdrop.hidden = false;
    document.body.classList.add("gm-sheet-open");
    updateSummary();
    renderCompanions();
    if (!state.companionsLoaded) loadCompanions();
  }

  function closePay() {
    var pay = $("gmPay");
    var backdrop = $("gmPayBackdrop");
    if (pay) pay.hidden = true;
    if (backdrop) backdrop.hidden = true;
    document.body.classList.remove("gm-pay-open");
  }

  function openPay(order, payInfo) {
    state.order = order || null;
    state.payInfo = payInfo || null;
    state.proofDataUrl = "";
    state.proofName = "";
    closeSheet({ keepSelection: true });
    var pay = $("gmPay");
    var backdrop = $("gmPayBackdrop");
    if (pay) pay.hidden = false;
    if (backdrop) backdrop.hidden = false;
    document.body.classList.add("gm-pay-open");
    renderPay();
  }

  function renderPay() {
    var root = $("gmPayBody");
    if (!root) return;
    var order = state.order || {};
    var companion = state.selectedCompanion || {};
    var gift = state.selectedGift || {};
    var pay = state.payInfo || {};
    var qr = pay.qrUrl || order.paymentQrUrl || "";
    var instructions =
      pay.instructions || order.paymentInstructions || "请按应付金额完成转账并上传付款截图。";
    var total =
      order.totalAmount != null ? order.totalAmount : giftPrice(gift) * Number(order.quantity || state.quantity || 1);
    var preview = state.proofDataUrl
      ? '<img class="gm-proof-preview" src="' + escapeHtml(state.proofDataUrl) + '" alt="付款截图预览" />'
      : '<p class="gm-empty soft">尚未选择截图</p>';
    var uploadLabel = state.uploading ? "上传中…" : state.proofDataUrl ? "重新选择截图" : "从相册选择付款截图";
    root.innerHTML =
      '<section class="gm-pay-card"><h3>赠送给</h3><div class="gm-pay-row">' +
      (companion.avatar_url
        ? '<img class="gm-avatar" src="' + escapeHtml(companion.avatar_url) + '" alt="" />'
        : '<span class="gm-avatar" aria-hidden="true">' +
          escapeHtml(String(companion.nickname || "?").slice(0, 1)) +
          "</span>") +
      "<div><strong>" +
      escapeHtml(companion.nickname || order.receiverName || "陪玩") +
      "</strong><em>UID：" +
      escapeHtml(companion.publicId || companion.id || order.receiverCompanionId || "") +
      "</em></div></div></section>" +
      '<section class="gm-pay-card"><h3>礼物</h3><div class="gm-pay-row">' +
      (gift.iconUrl || order.giftImage
        ? '<img class="gm-gift-icon" src="' + escapeHtml(gift.iconUrl || order.giftImage) + '" alt="" />'
        : '<span class="gm-gift-emoji">' + giftEmoji(gift.name || order.giftName) + "</span>") +
      "<div><strong>" +
      escapeHtml(gift.name || order.giftName || "礼物") +
      "</strong><em>×" +
      escapeHtml(String(order.quantity || state.quantity || 1)) +
      " · 应付 <b>" +
      escapeHtml(String(total)) +
      "</b> 猫粮</em></div></div></section>" +
      '<section class="gm-pay-card"><h3>支付</h3><p class="gm-pay-channel">' +
      escapeHtml(pay.channelName || order.paymentChannel || "平台收款") +
      "</p>" +
      (qr
        ? '<img class="gm-pay-qr" src="' + escapeHtml(qr) + '" alt="付款二维码" />'
        : '<p class="gm-empty soft">暂无二维码，请按下方说明转账</p>') +
      '<p class="gm-pay-ins">' +
      escapeHtml(instructions) +
      '</p><p class="gm-pay-amount">应付总额：<strong>' +
      escapeHtml(String(total)) +
      "</strong> 猫粮</p></section>" +
      '<section class="gm-pay-card"><h3>上传付款截图</h3>' +
      preview +
      '<label class="gm-upload-btn">' +
      uploadLabel +
      '<input id="gmProofInput" type="file" accept="image/jpeg,image/png,image/webp,image/*" capture="environment" ' +
      (state.uploading ? "disabled" : "") +
      " /></label>" +
      (state.proofName ? '<p class="gm-confirm-hint">已选：' + escapeHtml(state.proofName) + "</p>" : "") +
      '<button type="button" id="gmSubmitProof" class="gm-btn primary" ' +
      (!state.proofDataUrl || state.uploading ? "disabled" : "") +
      ">" +
      (state.uploading ? "提交中…" : "提交付款凭证") +
      '</button><p class="gm-confirm-hint">提交后进入客服审核，通过后才算真正赠送成功。</p></section>';
  }

  function renderGifts() {
    var grid = $("gmGiftGrid");
    if (!grid) return;
    if (!state.gifts.length) {
      grid.innerHTML = '<p class="gm-empty">暂无可赠送礼物</p>';
      return;
    }
    grid.innerHTML = state.gifts
      .map(function (g) {
        var id = encodeURIComponent(String(g.id || ""));
        var name = escapeHtml(g.name || "礼物");
        var price = giftPrice(g);
        var icon = g.iconUrl
          ? '<img class="gm-gift-icon" src="' + escapeHtml(g.iconUrl) + '" alt="" loading="lazy" />'
          : '<span class="gm-gift-emoji" aria-hidden="true">' + giftEmoji(g.name) + "</span>";
        return (
          '<article class="gm-gift-card"><div class="gm-gift-visual">' +
          icon +
          "</div><h3>" +
          name +
          '</h3><p class="gm-gift-price"><strong>' +
          price +
          '</strong><span>猫粮</span></p><button type="button" class="gm-btn primary" data-mall-gift-id="' +
          id +
          '">赠送</button></article>'
        );
      })
      .join("");
  }

  function renderCompanions() {
    var list = $("gmCompanionList");
    if (!list) return;
    if (!state.companionsLoaded) {
      list.innerHTML = '<p class="gm-empty soft">加载陪玩名单…</p>';
      return;
    }
    if (!state.companions.length) {
      list.innerHTML = '<p class="gm-empty soft">暂无可选陪玩</p>';
      return;
    }
    var selId = state.selectedCompanion ? String(state.selectedCompanion.id) : "";
    list.innerHTML = state.companions
      .map(function (c) {
        var id = String(c.id || "");
        var nick = escapeHtml(c.nickname || "陪玩");
        var meta = escapeHtml(companionMeta(c));
        var av = escapeHtml(c.avatar_url || "");
        var selected = id === selId ? " is-selected" : "";
        var mark = id === selId ? "✓" : "";
        var avatar = av
          ? '<img class="gm-avatar" src="' + av + '" alt="" loading="lazy" />'
          : '<span class="gm-avatar" aria-hidden="true" style="display:grid;place-items:center;font-weight:800">' +
            nick.slice(0, 1) +
            "</span>";
        return (
          '<button type="button" class="gm-companion-row' +
          selected +
          '" data-pick-companion="' +
          encodeURIComponent(id) +
          '" aria-pressed="' +
          (id === selId ? "true" : "false") +
          '">' +
          avatar +
          '<span class="gm-companion-meta"><strong>' +
          nick +
          "</strong><em>" +
          meta +
          '</em></span><span class="gm-pick-mark" aria-hidden="true">' +
          mark +
          "</span></button>"
        );
      })
      .join("");
  }

  async function loadGifts() {
    var grid = $("gmGiftGrid");
    if (grid) grid.innerHTML = '<p class="gm-empty">加载礼物…</p>';
    try {
      var res = await fetch("/api/boss/marketplace?action=gift_catalog", {
        headers: authHeaders(),
        credentials: "same-origin",
      });
      var data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok || !data.ok) throw new Error((data && data.message) || "load_failed");
      state.gifts = Array.isArray(data.gifts) ? data.gifts : [];
      renderGifts();
    } catch (e) {
      if (grid) grid.innerHTML = '<p class="gm-empty"><strong>礼物加载失败</strong>请刷新重试</p>';
      toast("礼物加载失败");
    }
  }

  async function loadCompanions() {
    var list = $("gmCompanionList");
    if (list) list.innerHTML = '<p class="gm-empty soft">加载陪玩名单…</p>';
    try {
      var res = await fetch("/api/public/companions", {
        headers: { Accept: "application/json" },
        credentials: "same-origin",
        cache: "no-store",
      });
      var data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok || !data.ok) throw new Error((data && data.message) || "load_failed");
      state.companions = (Array.isArray(data.companions) ? data.companions : [])
        .filter(function (c) {
          return c && (c.id || c.uid) && (c.nickname || c.name);
        })
        .map(function (c) {
          return {
            id: String(c.id || c.uid),
            nickname: String(c.nickname || c.name || ""),
            avatar_url: c.avatar || c.avatar_url || "",
            game: c.game || c.mainGame || "",
            level: c.level || c.levelName || "",
            specialty: c.specialty || "",
            publicId: c.publicId || c.public_id || c.uid || "",
          };
        });
      state.companionsLoaded = true;
      renderCompanions();
    } catch (e) {
      state.companionsLoaded = true;
      state.companions = [];
      if (list) {
        list.innerHTML = '<p class="gm-empty soft"><strong>陪玩名单加载失败</strong>请关闭后重试</p>';
      }
      toast("陪玩名单加载失败");
    }
  }

  async function confirmCreateOrder() {
    if (!state.selectedGift || !state.selectedCompanion) return;
    if (!requireBoss()) return;
    if (state.creating) return;
    var btn = $("gmConfirmBtn");
    state.creating = true;
    if (btn) {
      btn.disabled = true;
      btn.textContent = "创建订单…";
    }
    var gift = state.selectedGift;
    var companion = state.selectedCompanion;
    var qtyEl = $("gmQty");
    state.quantity = Math.max(1, Math.floor(Number((qtyEl && qtyEl.value) || state.quantity || 1)));
    try {
      var res = await fetch("/api/boss/gift-orders", {
        method: "POST",
        headers: authHeaders(),
        credentials: "same-origin",
        body: JSON.stringify({
          action: "create",
          companionId: companion.id,
          giftId: gift.id,
          quantity: state.quantity,
          idempotencyKey: idem(),
        }),
      });
      var data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok || !data.ok) {
        toast(String((data && data.message) || "创建订单失败"));
        return;
      }
      openPay(data.order, data.payInfo);
      showStatus("订单已创建", "请完成付款并上传截图，客服审核通过后才会到账");
    } catch (e) {
      toast("网络错误，请重试");
    } finally {
      state.creating = false;
      if (btn) {
        btn.textContent = "确认赠送";
        setConfirmEnabled();
      }
    }
  }

  function readFileAsDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () {
        resolve(String(reader.result || ""));
      };
      reader.onerror = function () {
        reject(new Error("read_failed"));
      };
      reader.readAsDataURL(file);
    });
  }

  async function onProofSelected(file) {
    if (!file) return;
    if (!/^image\/(jpeg|jpg|png|webp)$/i.test(file.type) && !/\.(jpe?g|png|webp)$/i.test(file.name || "")) {
      toast("请上传 JPG / PNG / WEBP 图片");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast("图片不能超过 10MB");
      return;
    }
    try {
      state.proofDataUrl = await readFileAsDataUrl(file);
      state.proofName = file.name || "payment-proof.jpg";
      renderPay();
    } catch (e) {
      toast("读取图片失败，请重试");
    }
  }

  async function submitProof() {
    if (!state.order || !state.order.id) {
      toast("订单无效");
      return;
    }
    if (!state.proofDataUrl) {
      toast("请先选择付款截图");
      return;
    }
    if (state.uploading) return;
    state.uploading = true;
    renderPay();
    try {
      var res = await fetch("/api/boss/gift-orders", {
        method: "POST",
        headers: authHeaders(),
        credentials: "same-origin",
        body: JSON.stringify({
          action: "upload_proof",
          orderId: state.order.id,
          proofDataUrl: state.proofDataUrl,
        }),
      });
      var data = await res.json().catch(function () {
        return {};
      });
      if (!res.ok || !data.ok) {
        toast(String((data && data.message) || "上传失败，请重试"));
        state.uploading = false;
        renderPay();
        return;
      }
      state.order = data.order || state.order;
      closePay();
      showStatus(
        "付款凭证已提交，等待客服审核",
        "订单 " + (state.order.orderNo || state.order.id) + " · 审核通过前不算真正到账"
      );
      toast("付款凭证已提交，等待客服审核");
    } catch (e) {
      toast("网络错误，请重试");
    } finally {
      state.uploading = false;
    }
  }

  function onClick(e) {
    var t = e.target;
    if (!t || !t.closest) return;

    var sendBtn = t.closest("[data-mall-gift-id]");
    if (sendBtn) {
      e.preventDefault();
      e.stopPropagation();
      var gid = decodeURIComponent(sendBtn.getAttribute("data-mall-gift-id") || "");
      var gift = state.gifts.find(function (g) {
        return String(g.id) === String(gid);
      });
      if (gift) openSheet(gift);
      return;
    }

    var pick = t.closest("[data-pick-companion]");
    if (pick) {
      e.preventDefault();
      var cid = decodeURIComponent(pick.getAttribute("data-pick-companion") || "");
      state.selectedCompanion =
        state.companions.find(function (c) {
          return String(c.id) === String(cid);
        }) || null;
      renderCompanions();
      updateSummary();
      return;
    }

    if (t.closest("[data-gm-close]")) {
      e.preventDefault();
      closeSheet();
      return;
    }

    if (t.closest("[data-gm-pay-close]")) {
      e.preventDefault();
      closePay();
      return;
    }

    if (t.closest("#gmConfirmBtn")) {
      e.preventDefault();
      confirmCreateOrder();
      return;
    }

    if (t.closest("#gmSubmitProof")) {
      e.preventDefault();
      submitProof();
    }
  }

  function onChange(e) {
    var t = e.target;
    if (!t) return;
    if (t.id === "gmQty") {
      state.quantity = Math.max(1, Math.floor(Number(t.value || 1)));
      updateSummary();
      return;
    }
    if (t.id === "gmProofInput" && t.files && t.files[0]) {
      onProofSelected(t.files[0]);
    }
  }

  function boot() {
    if (document.documentElement.getAttribute("data-gifts-mall") !== "1") {
      var root = document.querySelector('[data-gifts-mall="1"]');
      if (!root) return;
    }
    document.addEventListener("click", onClick, true);
    document.addEventListener("change", onChange, true);
    updateSummary();
    loadGifts();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
