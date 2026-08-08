(function () {
  "use strict";

  var LEGACY_SERVICE_NAMES = { "陪玩": 1, "护航": 1, "跑刀": 1, "代肝": 1, "自定义": 1, "陪玩服务": 1, "陪聊服务": 1 };
  var HOURS = [
    { id: "1", label: "1 小时", value: 1 },
    { id: "2", label: "2 小时", value: 2 },
    { id: "3", label: "3 小时", value: 3 },
    { id: "custom", label: "自定义", value: 0, custom: true },
  ];
  // Never hardcode channel list — filled live from /api/recharge (payment_channels SoT).
  var PAYMENTS = [];
  var DEFAULT_AVATAR = "/default-avatar.png";
  var root = document.getElementById("placeOrderPage");
  if (!root) return;

  var state = {
    companion: null,
    service: "",
    customService: "",
    selectedServiceId: "",
    hoursMode: "1",
    hours: 1,
    quantity: 1,
    couponCode: "",
    payment: "",
    submitting: false,
    payMethods: [],
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
  function applyOrderPayMethods(body) {
    // Sole SoT: GET /api/recharge → orderPayMethods. No methods[] reconstruct / no hardcode.
    var list = Array.isArray(body && body.orderPayMethods) ? body.orderPayMethods : [];
    state.payMethods = list
      .filter(function (m) {
        return m && (m.id || m.code) && m.open !== false;
      })
      .map(function (m) {
        return {
          id: m.id || m.code,
          label: m.label || m.name || m.code || m.id,
          open: true,
          statusText: m.statusText || "可用",
        };
      });
    if (!state.payMethods.some(function (p) { return p.id === state.payment; })) {
      state.payment = state.payMethods[0] ? state.payMethods[0].id : "";
    }
  }
  function refreshPayMethods() {
    if (!token()) {
      state.payMethods = [];
      return Promise.resolve([]);
    }
    return fetch("/api/recharge", { method: "GET", headers: authHeaders() })
      .then(function (res) {
        return res.json().then(function (body) {
          if (!res.ok || body.ok === false) throw new Error(body.message || "支付方式读取失败");
          applyOrderPayMethods(body);
          return state.payMethods;
        });
      })
      .catch(function () {
        return state.payMethods;
      });
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
    return String(state.service || "").trim() || "未选择服务";
  }
  function totalAmount() {
    var c = state.companion;
    if (!c) return 0;
    return Math.round(money(c.unitPrice) * currentHours() * currentQuantity() * 100) / 100;
  }
  function splitGameNames(value) {
    return String(value || "")
      .split(/[,，、\/|]+/)
      .map(function (s) {
        return String(s || "").trim();
      })
      .filter(function (s) {
        return s && !LEGACY_SERVICE_NAMES[s];
      });
  }
  function normalizeServiceItem(s, idx) {
    if (s == null) return null;
    if (typeof s === "string") {
      var n = String(s).trim();
      if (!n || LEGACY_SERVICE_NAMES[n]) return null;
      return { id: "name:" + n, serviceId: "", name: n, price: 0, pricingUnit: "小时", sort: idx || 0 };
    }
    if (typeof s !== "object") return null;
    var name = String(s.name || s.title || s.serviceName || s.game || "").trim();
    if (!name || LEGACY_SERVICE_NAMES[name]) return null;
    return {
      id: String(s.id || s.serviceId || s.service_id || "name:" + name),
      serviceId: String(s.serviceId || s.service_id || (/^[0-9a-f-]{36}$/i.test(String(s.id || "")) ? s.id : "") || ""),
      name: name,
      price: money(s.price != null ? s.price : s.unitPrice != null ? s.unitPrice : 0),
      pricingUnit: String(s.pricingUnit || s.pricing_unit || "小时"),
      sort: s.sort != null ? Number(s.sort) : idx || 0,
    };
  }
  function resolveServices(companion) {
    companion = companion || {};
    var out = [];
    var seen = Object.create(null);
    function push(item) {
      if (!item || !item.name || LEGACY_SERVICE_NAMES[item.name]) return;
      var key = String(item.serviceId || item.id || item.name).toLowerCase();
      if (seen[key] || seen["n:" + item.name]) return;
      seen[key] = 1;
      seen["n:" + item.name] = 1;
      out.push(item);
    }
    if (Array.isArray(companion.services)) {
      companion.services.forEach(function (s, i) {
        push(normalizeServiceItem(s, i));
      });
    }
    var prices = companion.gamePrices && typeof companion.gamePrices === "object" ? companion.gamePrices : {};
    var games = splitGameNames(companion.game || companion.mainGame || "");
    if (!out.length && Array.isArray(companion.serviceIds) && companion.serviceIds.length) {
      companion.serviceIds.forEach(function (id, i) {
        var sid = String(id || "").trim();
        if (!sid) return;
        var named =
          games[i] ||
          (!/^[0-9a-f-]{36}$/i.test(sid) ? sid : "") ||
          Object.keys(prices).find(function (k) {
            return !/^[0-9a-f-]{36}$/i.test(k) && money(prices[k]) > 0;
          }) ||
          "";
        if (!named || LEGACY_SERVICE_NAMES[named]) return;
        push({
          id: sid,
          serviceId: sid,
          name: named,
          price: money(prices[sid] != null ? prices[sid] : prices[named] != null ? prices[named] : companion.unitPrice),
          pricingUnit: companion.pricingUnit || "小时",
          sort: i,
        });
      });
    }
    if (!out.length && games.length) {
      games.forEach(function (g, i) {
        push({
          id: "name:" + g,
          serviceId: "",
          name: g,
          price: money(prices[g] != null ? prices[g] : companion.unitPrice),
          pricingUnit: companion.pricingUnit || "小时",
          sort: i,
        });
      });
    }
    out.forEach(function (s) {
      if (!(s.price > 0)) {
        s.price = money(prices[s.name] || prices[s.serviceId] || companion.unitPrice || 0);
      }
    });
    return out;
  }
  function applySelectedService(svc) {
    if (!svc || !svc.name) return;
    state.service = svc.name;
    state.customService = "";
    state.selectedServiceId = svc.serviceId || svc.id || "";
    if (state.companion) {
      var p = money(svc.price);
      if (p > 0) state.companion.unitPrice = p;
      if (svc.pricingUnit) state.companion.pricingUnit = svc.pricingUnit;
      state.companion.service = svc.name;
    }
    refreshTotals();
    paint();
  }
  function requireLogin() {
    if (token()) return true;
    try {
      sessionStorage.setItem("mcjAfterLoginRedirect", location.href);
    } catch (e) {}
    if (typeof window.loginRequiredModal === "function") {
      window.loginRequiredModal();
      return false;
    }
    location.href = "index.html#login";
    return false;
  }
  function setError(msg) {
    var el = root.querySelector("[data-po-error]");
    if (!el) return;
    if (!msg) {
      el.hidden = true;
      el.textContent = "";
      return;
    }
    el.hidden = false;
    el.textContent = msg;
  }
  function fail(msg) {
    root.innerHTML =
      '<a class="po-back" href="index.html">← 返回首页</a>' +
      '<div class="po-alert"><strong>无法打开下单页</strong><p style="margin:8px 0 0">' +
      esc(msg || "缺少陪玩信息") +
      "</p></div>" +
      '<p><a class="po-back" href="companion-center.html">去陪玩大厅</a></p>';
  }
  function refreshTotals() {
    var c = state.companion;
    if (!c) return;
    var unit = root.querySelector("[data-po-footer-unit]");
    var qty = root.querySelector("[data-po-footer-qty]");
    var total = root.querySelector("[data-po-footer-total]");
    var hero = root.querySelector("[data-po-price-hero]");
    if (unit) unit.textContent = moneyText(c.unitPrice);
    if (qty) qty.textContent = currentHours() + " × " + currentQuantity();
    if (total) total.textContent = moneyText(totalAmount());
    if (hero) hero.textContent = moneyText(c.unitPrice);
    var preview = root.querySelector("[data-po-service-preview]");
    if (preview) preview.textContent = currentServiceLabel();
  }

  function paint() {
    var c = state.companion;
    if (!c) return fail("缺少陪玩信息");
    var companionServices = resolveServices(c);
    if (companionServices.length && !companionServices.some(function (s) { return s.name === state.service; })) {
      state.service = companionServices[0].name;
      state.selectedServiceId = companionServices[0].serviceId || companionServices[0].id || "";
      if (companionServices[0].price > 0) c.unitPrice = companionServices[0].price;
    }
    var serviceChips = companionServices.length
      ? companionServices
          .map(function (s) {
            return (
              '<button type="button" data-po-service="' +
              esc(s.name) +
              '" data-po-service-id="' +
              esc(s.serviceId || s.id || "") +
              '" data-po-service-price="' +
              esc(s.price) +
              '" class="mcj-po-chip' +
              (state.service === s.name ? " active" : "") +
              '" aria-pressed="' +
              (state.service === s.name ? "true" : "false") +
              '">' +
              esc(s.name) +
              "</button>"
            );
          })
          .join("")
      : '<span style="color:#9ca3af;font-size:13px">该陪玩暂无可下单服务项目</span>';
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
    var payList = state.payMethods && state.payMethods.length ? state.payMethods : [];
    var payCards = payList.length
      ? payList
          .map(function (p) {
            return (
              '<button type="button" class="mcj-po-pay-card' +
              (state.payment === p.id ? " active" : "") +
              '" data-po-pay="' +
              esc(p.id) +
              '"><span class="mcj-po-pay-title">' +
              esc(p.label) +
              '</span><span class="mcj-po-pay-check" aria-hidden="true"></span></button>'
            );
          })
          .join("")
      : '<p style="color:#9ca3af;font-size:13px;margin:0">暂无可用支付方式，请联系管理员在后台启用</p>';

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
      '<div class="mcj-po-price-row"><span>单价</span><span class="mcj-po-price-hero" data-po-price-hero>' +
      esc(moneyText(c.unitPrice)) +
      "</span><small>/ " +
      esc(c.pricingUnit || "小时") +
      "</small></div>" +
      "<div>当前服务：<strong data-po-service-preview>" +
      esc(currentServiceLabel()) +
      "</strong></div></div>" +
      '<div class="mcj-po-field"><span class="mcj-po-label">游戏/服务项目</span><div class="mcj-po-chips" role="group">' +
      serviceChips +
      "</div></div>" +
      '<div class="mcj-po-field"><span class="mcj-po-label">数量或时长</span><div class="mcj-po-chips" role="radiogroup">' +
      hourChips +
      "</div>" +
      '<div class="mcj-po-custom-hours' +
      (state.hoursMode === "custom" ? " show" : "") +
      '" data-po-custom-hours><input type="number" min="0.5" step="0.5" data-po-custom-hours-input value="' +
      esc(state.hours) +
      '" placeholder="小时数"></div></div>' +
      '<label>数量<input type="number" min="1" step="1" data-po-quantity value="' +
      esc(state.quantity) +
      '"></label>' +
      '<label>游戏 ID *<input data-po-game-id required placeholder="必填，用于开局" autocomplete="off"></label>' +
      '<label>区服<input data-po-region placeholder="例如：亚服 / 国服 / 欧服"></label>' +
      '<label>联系方式<input data-po-contact placeholder="手机号 / WhatsApp / Discord"></label>' +
      '<label>服务时间<input data-po-schedule placeholder="例如：今晚 9 点后"></label>' +
      '<label>订单备注<textarea data-po-notes rows="3" placeholder="特殊要求、开局说明等"></textarea></label>' +
      '<label>优惠码<input data-po-coupon placeholder="可选" value="' +
      esc(state.couponCode) +
      '"></label>' +
      '<div class="mcj-po-pay-block"><div class="mcj-po-pay-label">支付方式</div><div class="mcj-po-pay-grid">' +
      payCards +
      "</div></div>" +
      '<p class="mcj-po-error" data-po-error hidden></p>' +
      "</div>" +
      '<div class="mcj-po-footer">' +
      '<div class="mcj-po-footer-breakdown">' +
      "<div>单价 <strong data-po-footer-unit>" +
      esc(moneyText(c.unitPrice)) +
      "</strong></div>" +
      "<div>数量 <strong data-po-footer-qty>" +
      esc(currentHours() + " × " + currentQuantity()) +
      "</strong></div>" +
      "<div>合计 <strong data-po-footer-total>" +
      esc(moneyText(totalAmount())) +
      "</strong></div></div>" +
      '<button type="button" class="mcj-po-submit" data-po-submit>确认订单并付款</button>' +
      "</div></section>";

    bind();
  }

  function setExclusiveActive(buttons, activeBtn) {
    (buttons || []).forEach(function (b) {
      var on = b === activeBtn;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function bind() {
    root.querySelectorAll("[data-po-service]").forEach(function (btn) {
      btn.addEventListener("click", function (ev) {
        ev.preventDefault();
        var name = btn.getAttribute("data-po-service") || "";
        var list = resolveServices(state.companion);
        var svc =
          list.find(function (s) {
            return s.name === name;
          }) || {
            name: name,
            serviceId: btn.getAttribute("data-po-service-id") || "",
            price: money(btn.getAttribute("data-po-service-price")),
            pricingUnit: (state.companion && state.companion.pricingUnit) || "小时",
          };
        applySelectedService(svc);
      });
    });
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
        state.couponCode = couponInput.value;
      });
    }
    root.querySelectorAll("[data-po-pay]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.payment = btn.getAttribute("data-po-pay") || "";
        root.querySelectorAll("[data-po-pay]").forEach(function (b) {
          b.classList.toggle("active", b === btn);
        });
      });
    });
    var submitBtn = root.querySelector("[data-po-submit]");
    if (submitBtn) submitBtn.addEventListener("click", submitOrder);
  }

  function hydrateFromCatalog(companionId) {
    return fetch("/api/boss/marketplace?action=catalog&companionId=" + encodeURIComponent(companionId), {
      headers: authHeaders(),
      cache: "no-store",
    })
      .then(function (res) {
        return res.json().then(function (body) {
          if (!res.ok || (body && body.ok === false)) throw new Error((body && body.message) || "服务目录读取失败");
          return body;
        });
      })
      .then(function (body) {
        if (!state.companion) return body;
        var services = Array.isArray(body.services) ? body.services : [];
        var catC = body.companion || {};
        state.companion.services = services;
        if (catC.gamePrices || catC.game_prices) state.companion.gamePrices = catC.gamePrices || catC.game_prices;
        if (catC.serviceIds || catC.service_ids) state.companion.serviceIds = catC.serviceIds || catC.service_ids;
        if (catC.game || catC.mainGame) {
          state.companion.game = catC.game || catC.mainGame;
          state.companion.mainGame = state.companion.game;
        }
        var list = resolveServices(state.companion);
        var cur =
          list.find(function (s) {
            return s.name === state.service;
          }) || list[0];
        if (cur) {
          state.service = cur.name;
          state.selectedServiceId = cur.serviceId || cur.id || "";
          if (cur.price > 0) state.companion.unitPrice = cur.price;
        }
        paint();
        return body;
      })
      .catch(function () {
        return null;
      });
  }

  function submitOrder() {
    if (state.submitting) return;
    if (!requireLogin()) return;
    var c = state.companion;
    if (!c || !c.companionId) {
      setError("缺少陪玩信息，无法下单");
      return;
    }
    var svcList = resolveServices(c);
    if (!svcList.length || !state.service || !svcList.some(function (s) { return s.name === state.service; })) {
      setError("请选择游戏/服务项目");
      return;
    }
    if (!(money(c.unitPrice) > 0)) {
      setError("当前单价无效，请刷新页面后重试");
      return;
    }
    var gameIdEl = root.querySelector("[data-po-game-id]");
    var gameId = gameIdEl ? String(gameIdEl.value || "").trim() : "";
    if (!gameId) {
      setError("请填写游戏 ID");
      return;
    }
    var notesEl = root.querySelector("[data-po-notes]");
    var regionEl = root.querySelector("[data-po-region]");
    var contactEl = root.querySelector("[data-po-contact]");
    var scheduleEl = root.querySelector("[data-po-schedule]");
    var btn = root.querySelector("[data-po-submit]");
    state.submitting = true;
    setError("");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "提交中…";
    }
    fetch("/api/orders", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        action: "create_order",
        companionId: c.companionId,
        serviceType: currentServiceLabel(),
        service: currentServiceLabel(),
        game: currentServiceLabel(),
        hours: currentHours(),
        quantity: currentQuantity(),
        unitPrice: c.unitPrice,
        totalAmount: totalAmount(),
        gameId: gameId,
        region: regionEl ? regionEl.value : "",
        contact: contactEl ? contactEl.value : "",
        schedule: scheduleEl ? scheduleEl.value : "",
        notes: notesEl ? notesEl.value : "",
        couponCode: state.couponCode,
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
    // Accept companionId|id|companion — all boss entry deep-links used in the wild.
    var companionId = String(q.get("companionId") || q.get("id") || q.get("companion") || "").trim();
    var unitPrice = money(q.get("price") || q.get("unitPrice"));
    var name = String(q.get("name") || q.get("companionName") || "陪玩").trim() || "陪玩";
    var service = String(q.get("service") || q.get("game") || "").trim();
    if (LEGACY_SERVICE_NAMES[service]) service = "";
    var avatar = String(q.get("avatar") || "").trim();
    var publicId = String(q.get("publicId") || "").trim();

    if (!companionId) {
      fail("缺少陪玩 ID，请从首页或陪玩大厅重新点击「立即下单」");
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
      game: service,
      mainGame: service,
      services: [],
      serviceIds: [],
      gamePrices: {},
      pricingUnit: "小时",
      avatar: avatarSrc(avatar),
      publicId: publicId,
    };
    state.service = service;
    paint();

    // Same public + catalog sources as home / detail / modal.
    Promise.all([
      fetch("/api/public/companions?id=" + encodeURIComponent(companionId), {
        headers: { Accept: "application/json" },
        cache: "no-store",
      }).then(function (res) {
        return res.json().then(function (body) {
          if (!res.ok || body.ok === false) throw new Error((body && body.message) || "陪玩资料读取失败");
          var list = Array.isArray(body.companions) ? body.companions : body.companion ? [body.companion] : [];
          return list[0] || null;
        });
      }),
      hydrateFromCatalog(companionId),
      refreshPayMethods(),
    ])
      .then(function (pair) {
        var row = pair[0];
        if (!row || !state.companion) return;
        state.companion.companionName = row.name || row.nickname || state.companion.companionName;
        state.companion.avatar = avatarSrc(row.avatar || row.cover || state.companion.avatar);
        state.companion.publicId = row.publicId || state.companion.publicId;
        state.companion.game = row.game || row.mainGame || state.companion.game;
        state.companion.mainGame = state.companion.game;
        state.companion.services = row.services || state.companion.services || [];
        state.companion.serviceIds = row.serviceIds || row.service_ids || state.companion.serviceIds || [];
        state.companion.gamePrices = row.gamePrices || row.game_prices || state.companion.gamePrices || {};
        if (!(state.companion.unitPrice > 0)) {
          state.companion.unitPrice = money(row.priceValue != null ? row.priceValue : row.price);
        }
        var list = resolveServices(state.companion);
        var cur =
          list.find(function (s) {
            return s.name === state.service;
          }) || list[0];
        if (cur) {
          state.service = cur.name;
          state.selectedServiceId = cur.serviceId || cur.id || "";
          if (cur.price > 0) state.companion.unitPrice = cur.price;
        }
        if (!(state.companion.unitPrice > 0) && !list.length) {
          fail("该陪玩暂无有效单价或服务项目，暂不可下单");
          return;
        }
        paint();
      })
      .catch(function () {});
  }

  boot();
})();
