(function () {
  "use strict";

  var SERVICES = ["陪玩", "护航", "跑刀", "代肝", "自定义"];
  var HOURS = [
    { id: "1", label: "1 小时", value: 1 },
    { id: "2", label: "2 小时", value: 2 },
    { id: "3", label: "3 小时", value: 3 },
    { id: "custom", label: "自定义", value: 0, custom: true },
  ];
  var PAYMENTS = [
    { id: "tng", label: "TNG" },
    { id: "bank", label: "银行卡" },
    { id: "alipay", label: "支付宝" },
    { id: "catfood", label: "猫粮余额" },
  ];
  var DEFAULT_AVATAR = "/default-avatar.png";
  var root = document.getElementById("placeOrderPage");
  if (!root) return;

  var state = {
    companion: null,
    service: "陪玩",
    customService: "",
    hoursMode: "1",
    hours: 1,
    quantity: 1,
    couponCode: "",
    payment: "tng",
    submitting: false,
  };

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function money(v) {
    var n = Number(v || 0);
    return Number.isFinite(n) ? n : 0;
  }
  function moneyText(v) {
    if (window.MCJCurrency) return window.MCJCurrency.formatAmount(v);
    return "🐱 " + money(v).toFixed(2).replace(/\.00$/, "") + " 猫粮";
  }
  function token() {
    return (
      localStorage.getItem("mcjAuthAccessToken") ||
      sessionStorage.getItem("mcjAuthAccessToken") ||
      localStorage.getItem("customerAuthToken") ||
      sessionStorage.getItem("customerAuthToken") ||
      ""
    );
  }
  function authHeaders() {
    var t = token();
    var h = { Accept: "application/json", "Content-Type": "application/json" };
    if (t) {
      h.Authorization = "Bearer " + t;
      h["x-mcj-access-token"] = t;
    }
    return h;
  }
  function avatarSrc(raw) {
    var s = String(raw == null ? "" : raw).trim();
    if (!s || /meow-cuijiao-brand\.(jpe?g|png|webp)$/i.test(s)) return DEFAULT_AVATAR;
    return s;
  }
  function qs() {
    return new URLSearchParams(location.search || "");
  }
  function currentHours() {
    return Math.max(0.5, money(state.hours) || 1);
  }
  function currentQuantity() {
    return Math.max(1, Math.floor(money(state.quantity) || 1));
  }
  function currentServiceLabel() {
    if (state.service === "自定义") return String(state.customService || "").trim() || "自定义";
    return state.service;
  }
  function totalAmount() {
    var c = state.companion;
    if (!c) return 0;
    return Math.round(money(c.unitPrice) * currentHours() * currentQuantity() * 100) / 100;
  }
  function matchService(service) {
    var s = String(service || "").trim();
    if (!s) return { service: "陪玩", custom: "" };
    for (var i = 0; i < SERVICES.length; i++) {
      if (SERVICES[i] === "自定义") continue;
      if (s === SERVICES[i] || s.indexOf(SERVICES[i]) !== -1) return { service: SERVICES[i], custom: "" };
    }
    return { service: "自定义", custom: s };
  }
  function requireLogin() {
    if (token()) return true;
    try {
      sessionStorage.setItem("mcjAfterLoginRedirect", location.href);
    } catch (e) {}
    alert("请先登录老板账号后再下单");
    if (window.MCJBossHeader && typeof window.MCJBossHeader.openLogin === "function") {
      window.MCJBossHeader.openLogin();
      return false;
    }
    location.href = "index.html#login";
    return false;
  }
  function setError(msg) {
    var el = root.querySelector("[data-po-error]");
    if (el) el.textContent = msg || "";
    if (!msg) return;
    var t = document.querySelector("[data-mcj-po-toast]");
    if (!t) {
      t = document.createElement("div");
      t.className = "mcj-po-toast";
      t.setAttribute("data-mcj-po-toast", "1");
      document.body.appendChild(t);
    }
    t.textContent = msg;
    t.classList.add("show");
  }
  function refreshTotals() {
    var total = moneyText(totalAmount());
    var footerTotal = root.querySelector("[data-po-footer-total]");
    var hoursEl = root.querySelector("[data-po-hours-label]");
    if (footerTotal) footerTotal.textContent = total;
    if (hoursEl) hoursEl.textContent = currentHours() + " 小时 × " + currentQuantity();
  }
  function setExclusiveActive(buttons, activeBtn) {
    (buttons || []).forEach(function (b) {
      var on = b === activeBtn;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function fail(msg) {
    root.innerHTML =
      '<a class="po-back" href="index.html">← 返回首页</a>' +
      '<div class="po-alert"><strong>无法打开下单页</strong><p style="margin:8px 0 0">' +
      esc(msg || "缺少陪玩信息") +
      "</p></div>" +
      '<p><a class="po-back" href="companion-center.html">去陪玩大厅</a></p>';
  }

  function paint() {
    var c = state.companion;
    if (!c) return fail("缺少陪玩信息");
    var serviceChips = SERVICES.map(function (s) {
      return (
        '<button type="button" data-po-service="' +
        esc(s) +
        '" class="mcj-po-chip' +
        (state.service === s ? " active" : "") +
        '" aria-pressed="' +
        (state.service === s ? "true" : "false") +
        '">' +
        esc(s) +
        "</button>"
      );
    }).join("");
    var hourChips = HOURS.map(function (h) {
      return (
        '<button type="button" data-po-hours="' +
        esc(h.id) +
        '" class="mcj-po-chip' +
        (state.hoursMode === h.id ? " active" : "") +
        '" aria-pressed="' +
        (state.hoursMode === h.id ? "true" : "false") +
        '">' +
        esc(h.label) +
        "</button>"
      );
    }).join("");
    var payCards = PAYMENTS.map(function (p) {
      if (p.maintenance) {
        return (
          '<button type="button" class="mcj-po-pay-card is-maintenance" disabled aria-disabled="true">' +
          '<span class="mcj-po-pay-title">' +
          esc(p.label) +
          '</span><span class="mcj-po-pay-check">暂不可用</span></button>'
        );
      }
      return (
        '<button type="button" class="mcj-po-pay-card' +
        (state.payment === p.id ? " active" : "") +
        '" data-po-pay="' +
        esc(p.id) +
        '"><span class="mcj-po-pay-title">' +
        esc(p.label) +
        '</span><span class="mcj-po-pay-check" aria-hidden="true"></span></button>'
      );
    }).join("");

    root.innerHTML =
      '<a class="po-back" href="javascript:history.back()">← 返回</a>' +
      '<section class="po-page-card">' +
      '<div class="po-page-scroll">' +
      '<div class="mcj-po-head">' +
      '<img src="' +
      esc(avatarSrc(c.avatar)) +
      '" alt="" onerror="this.onerror=null;this.src=\'' +
      DEFAULT_AVATAR +
      '\'">' +
      "<div><h3>" +
      esc(c.companionName) +
      "</h3><p>确认订单资料后付款，不会直接创建待付款单。</p></div></div>" +
      '<div class="mcj-po-locked">' +
      "<div>陪玩：<strong>" +
      esc(c.companionName) +
      "</strong>" +
      (c.publicId ? " · " + esc(c.publicId) : "") +
      "</div>" +
      '<div class="mcj-po-price-row"><span>单价</span><span class="mcj-po-price-hero">' +
      esc(moneyText(c.unitPrice)) +
      "</span><small>/ " +
      esc(c.pricingUnit || "小时") +
      "</small></div>" +
      "<div>游戏/服务：<strong data-po-service-preview>" +
      esc(currentServiceLabel()) +
      "</strong></div></div>" +
      '<div class="mcj-po-field"><span class="mcj-po-label">游戏/服务项目</span><div class="mcj-po-chips">' +
      serviceChips +
      "</div></div>" +
      '<div class="mcj-po-custom-service' +
      (state.service === "自定义" ? " show" : "") +
      '" data-po-custom-service><label>自定义服务<input data-po-custom-service-input value="' +
      esc(state.customService) +
      '" placeholder="例如：双排陪练"></label></div>' +
      '<div class="mcj-po-field"><span class="mcj-po-label">数量或时长</span><div class="mcj-po-chips">' +
      hourChips +
      "</div>" +
      '<div class="mcj-po-custom-hours' +
      (state.hoursMode === "custom" ? " show" : "") +
      '" data-po-custom-hours><input type="number" min="0.5" step="0.5" data-po-custom-hours-input value="' +
      esc(state.hours) +
      '"></div></div>' +
      '<label>数量<input type="number" min="1" step="1" data-po-quantity value="' +
      esc(state.quantity) +
      '"></label>' +
      '<label>游戏 ID *<input data-po-game-id required placeholder="必填，用于开局" autocomplete="off"></label>' +
      '<label>联系方式<input data-po-contact placeholder="手机号 / WhatsApp / Discord" autocomplete="tel"></label>' +
      '<label>备注（可选）<textarea data-po-notes rows="2" placeholder="特殊要求、开局时间等"></textarea></label>' +
      '<label>优惠码<input data-po-coupon placeholder="可选" value="' +
      esc(state.couponCode) +
      '"></label>' +
      '<div class="mcj-po-pay-block"><div class="mcj-po-pay-label">支付方式</div><div class="mcj-po-pay-grid">' +
      payCards +
      "</div></div>" +
      '<p class="mcj-po-error" data-po-error></p>' +
      "</div>" +
      '<div class="po-page-footer">' +
      '<div class="mcj-po-footer-sum"><span>订单总额</span><strong data-po-footer-total>' +
      esc(moneyText(totalAmount())) +
      '</strong><small data-po-hours-label>' +
      esc(currentHours() + " 小时 × " + currentQuantity()) +
      "</small></div>" +
      '<button type="button" class="mcj-po-submit" data-po-submit>确认订单并付款</button>' +
      "</div></section>";

    bind();
  }

  function bind() {
    root.querySelectorAll("[data-po-service]").forEach(function (btn) {
      btn.addEventListener("click", function (ev) {
        ev.preventDefault();
        state.service = btn.getAttribute("data-po-service") || "陪玩";
        setExclusiveActive(root.querySelectorAll("[data-po-service]"), btn);
        var wrap = root.querySelector("[data-po-custom-service]");
        if (wrap) wrap.classList.toggle("show", state.service === "自定义");
        var preview = root.querySelector("[data-po-service-preview]");
        if (preview) preview.textContent = currentServiceLabel();
      });
    });
    var customServiceInput = root.querySelector("[data-po-custom-service-input]");
    if (customServiceInput) {
      customServiceInput.addEventListener("input", function () {
        state.customService = customServiceInput.value;
        var preview = root.querySelector("[data-po-service-preview]");
        if (preview) preview.textContent = currentServiceLabel();
      });
    }
    root.querySelectorAll("[data-po-hours]").forEach(function (btn) {
      btn.addEventListener("click", function (ev) {
        ev.preventDefault();
        var id = btn.getAttribute("data-po-hours");
        state.hoursMode = id;
        var meta = HOURS.find(function (h) {
          return h.id === id;
        });
        if (meta && !meta.custom) state.hours = meta.value;
        setExclusiveActive(root.querySelectorAll("[data-po-hours]"), btn);
        var wrap = root.querySelector("[data-po-custom-hours]");
        if (wrap) wrap.classList.toggle("show", id === "custom");
        refreshTotals();
      });
    });
    var customHoursInput = root.querySelector("[data-po-custom-hours-input]");
    if (customHoursInput) {
      customHoursInput.addEventListener("input", function () {
        state.hours = Math.max(0.5, money(customHoursInput.value) || 1);
        refreshTotals();
      });
    }
    var qtyInput = root.querySelector("[data-po-quantity]");
    if (qtyInput) {
      qtyInput.addEventListener("input", function () {
        state.quantity = Math.max(1, Math.floor(money(qtyInput.value) || 1));
        refreshTotals();
      });
    }
    var couponInput = root.querySelector("[data-po-coupon]");
    if (couponInput) {
      couponInput.addEventListener("input", function () {
        state.couponCode = String(couponInput.value || "").trim();
      });
    }
    root.querySelectorAll("[data-po-pay]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (btn.disabled) return;
        state.payment = btn.getAttribute("data-po-pay") || "tng";
        setExclusiveActive(root.querySelectorAll("[data-po-pay]"), btn);
      });
    });
    var submit = root.querySelector("[data-po-submit]");
    if (submit) submit.addEventListener("click", submitOrder);
  }

  function submitOrder() {
    if (state.submitting) {
      setError("订单提交中，请稍候…");
      return;
    }
    if (!requireLogin()) return;
    var c = state.companion;
    if (!c || !c.companionId) {
      setError("缺少陪玩信息，无法下单");
      return;
    }
    var gameIdEl = root.querySelector("[data-po-game-id]");
    var notesEl = root.querySelector("[data-po-notes]");
    var contactEl = root.querySelector("[data-po-contact]");
    var qtyEl = root.querySelector("[data-po-quantity]");
    var couponEl = root.querySelector("[data-po-coupon]");
    var gameId = gameIdEl ? String(gameIdEl.value || "").trim() : "";
    var contact = contactEl ? String(contactEl.value || "").trim() : "";
    if (!gameId) {
      setError("游戏ID不能为空");
      if (gameIdEl) gameIdEl.focus();
      return;
    }
    if (!String(state.payment || "").trim()) {
      setError("支付方式不能为空");
      return;
    }
    if (state.service === "自定义" && !String(state.customService || "").trim()) {
      setError("请填写自定义服务内容");
      return;
    }
    if (qtyEl) state.quantity = Math.max(1, Math.floor(money(qtyEl.value) || 1));
    if (couponEl) state.couponCode = String(couponEl.value || "").trim();
    var total = totalAmount();
    if (!(total > 0)) {
      setError("订单金额无效");
      return;
    }

    state.submitting = true;
    setError("");
    var btn = root.querySelector("[data-po-submit]");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "提交中…";
    }

    var noteParts = [];
    if (notesEl && String(notesEl.value || "").trim()) noteParts.push(String(notesEl.value || "").trim());
    if (contact) noteParts.push("联系方式：" + contact);

    fetch("/api/orders", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        action: "place_order",
        companionId: c.companionId,
        companionName: c.companionName,
        serviceType: currentServiceLabel(),
        service: currentServiceLabel(),
        game: currentServiceLabel(),
        unitPrice: money(c.unitPrice),
        hours: currentHours(),
        quantity: currentQuantity(),
        totalAmount: total,
        gameId: gameId,
        couponCode: state.couponCode || "",
        contact: contact,
        notes: noteParts.join("；"),
        paymentMethod: state.payment,
        idempotencyKey: "po-page-" + c.companionId + "-" + Date.now(),
      }),
    })
      .then(function (res) {
        return res.json().then(function (body) {
          if (!res.ok || body.ok === false) throw Object.assign(new Error(body.message || "订单创建失败"), body);
          return body;
        });
      })
      .then(function (body) {
        var order = body.order || {};
        var oid = order.id || "";
        if (!oid) throw new Error("订单创建失败");
        if (/cat.?food|wallet|猫粮|余额/.test(String(state.payment || ""))) {
          return fetch("/api/orders", {
            method: "POST",
            headers: authHeaders(),
            body: JSON.stringify({ action: "pay_order", id: oid, paymentMethod: state.payment }),
          })
            .then(function (res) {
              return res.json().then(function (paid) {
                if (!res.ok || paid.ok === false) throw Object.assign(new Error(paid.message || "支付失败"), paid);
                return paid;
              });
            })
            .then(function () {
              location.href = "orders.html?id=" + encodeURIComponent(oid);
            });
        }
        location.href = "payment-confirm.html?order=" + encodeURIComponent(oid);
      })
      .catch(function (err) {
        state.submitting = false;
        if (btn) {
          btn.disabled = false;
          btn.textContent = "确认订单并付款";
        }
        if (/登录|401|未登录|老板账号/.test(String(err.message || ""))) {
          requireLogin();
          return;
        }
        setError(err.message || "订单创建失败");
      });
  }

  function boot() {
    var q = qs();
    var companionId = String(q.get("companionId") || q.get("id") || "").trim();
    var unitPrice = money(q.get("price") || q.get("unitPrice"));
    var name = String(q.get("name") || q.get("companionName") || "陪玩").trim() || "陪玩";
    var service = String(q.get("service") || q.get("game") || "陪玩").trim() || "陪玩";
    var avatar = String(q.get("avatar") || "").trim();
    var publicId = String(q.get("publicId") || "").trim();

    if (!companionId) {
      fail("缺少陪玩 ID，请从首页或陪玩大厅重新点击「立即下单」");
      return;
    }
    if (!(unitPrice > 0)) {
      fail("该陪玩暂无有效单价，暂不可下单");
      return;
    }
    if (!token()) {
      try {
        sessionStorage.setItem("mcjAfterLoginRedirect", location.href);
      } catch (e) {}
    }

    state.companion = {
      companionId: companionId,
      companionName: name,
      unitPrice: unitPrice,
      service: service,
      pricingUnit: "小时",
      avatar: avatarSrc(avatar),
      publicId: publicId,
    };
    var matched = matchService(service);
    state.service = matched.service;
    state.customService = matched.custom;
    paint();
  }

  boot();
})();
