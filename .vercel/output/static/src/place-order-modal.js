(function () {
  "use strict";

  var DEFAULT_HOURS = [
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
  var toastTimer = null;
  var openGuard = false;
  var state = {
    open: false,
    companion: null,
    service: "",
    customService: "",
    hoursMode: "1",
    hours: 1,
    hourOptions: DEFAULT_HOURS.slice(),
    quantity: 1,
    couponCode: "",
    payment: "tng",
    submitting: false,
    submitStartedAt: 0,
    walletBalance: null,
    idempotencyKey: "",
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
  function positiveMoney(v) {
    var n = money(v);
    return n > 0 ? n : 0;
  }
  function priceFromGameMap(map) {
    if (!map || typeof map !== "object") return 0;
    var vals = Object.keys(map)
      .map(function (k) {
        return positiveMoney(map[k]);
      })
      .filter(function (v) {
        return v > 0;
      });
    return vals.length ? Math.min.apply(null, vals) : 0;
  }
  // Prefer real DB price fields / per-game map. Do NOT invent level-min prices for checkout —
  // that caused UI to show a price while server rejected with "单价无效".
  function resolveUnitPrice(candidates, gameMap) {
    for (var i = 0; i < (candidates || []).length; i++) {
      var v = positiveMoney(candidates[i]);
      if (v > 0) return v;
    }
    return priceFromGameMap(gameMap);
  }
  function moneyText(v) {
    if (window.MCJCurrency) return window.MCJCurrency.formatAmount(v);
    return "🐱 " + money(v).toFixed(2).replace(/\.00$/, "") + " 猫粮";
  }
  function priceHeroHtml(v) {
    return '<span class="mcj-po-price-hero" data-po-price-hero>' + esc(moneyText(v)) + "</span>";
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
  function ensureCss() {
    if (document.querySelector('link[data-mcj-place-order-css]')) return;
    var link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = "src/place-order-modal.css?v=20260730-viewport-fix2";
    link.setAttribute("data-mcj-place-order-css", "1");
    document.head.appendChild(link);
  }
  function toast(msg) {
    var text = String(msg || "").trim();
    if (!text) return;
    // Always use modal-layer toast (z-index above mask). Never rely on page toast
    // which may sit under the drawer (z-index ~200) and look like "no response".
    var el = document.querySelector("[data-mcj-po-toast]");
    if (!el) {
      el = document.createElement("div");
      el.className = "mcj-po-toast";
      el.setAttribute("data-mcj-po-toast", "1");
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.classList.add("show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.classList.remove("show");
      toastTimer = null;
    }, 3200);
  }
  function isWalletPayment(method) {
    return /cat.?food|wallet|猫粮|余额/.test(String(method || "").toLowerCase());
  }
  function activeMask() {
    return document.querySelector("[data-mcj-po-mask]");
  }
  function qs(sel) {
    var mask = activeMask();
    return mask ? mask.querySelector(sel) : document.querySelector(sel);
  }
  function failValidate(msg, focusSel) {
    var text = String(msg || "").trim() || "请完善下单信息";
    setError(text);
    toast(text);
    console.warn("[MCJPlaceOrder] validate", text);
    if (focusSel) {
      var el = qs(focusSel);
      if (el) {
        try {
          el.focus();
          if (typeof el.scrollIntoView === "function") el.scrollIntoView({ block: "center", behavior: "smooth" });
        } catch (e) {}
      }
    }
    return false;
  }
  function setSubmitLoading(on) {
    var btn = qs("[data-po-submit]");
    if (!btn) return;
    btn.disabled = !!on;
    btn.setAttribute("aria-busy", on ? "true" : "false");
    btn.textContent = on ? "提交中…" : "确认订单并付款";
  }
  function refreshWalletBalance() {
    if (!token()) {
      state.walletBalance = null;
      return Promise.resolve(null);
    }
    return fetch("/api/recharge", { method: "GET", headers: authHeaders() })
      .then(function (res) {
        return res.json().then(function (body) {
          if (!res.ok || body.ok === false) throw new Error(body.message || "余额读取失败");
          var bal =
            body.summary && body.summary.balance != null
              ? body.summary.balance
              : body.wallet && body.wallet.totalBalance != null
                ? body.wallet.totalBalance
                : null;
          state.walletBalance = bal == null ? null : money(bal);
          return state.walletBalance;
        });
      })
      .catch(function () {
        state.walletBalance = null;
        return null;
      });
  }
  function paintPayCards() {
    var mask = activeMask();
    if (!mask) return;
    var grid = mask.querySelector("[data-po-pay-grid]");
    if (!grid) return;
    var total = totalAmount();
    var bal = state.walletBalance;
    var catInsufficient = bal != null && !(bal + 1e-9 >= total);
    grid.innerHTML = PAYMENTS.map(function (p) {
      var insufficient = p.id === "catfood" && catInsufficient;
      if (insufficient) {
        return (
          '<button type="button" class="mcj-po-pay-card is-maintenance" disabled aria-disabled="true">' +
          '<span class="mcj-po-pay-title">' +
          esc(p.label) +
          '</span><span class="mcj-po-pay-check">余额不足</span></button>'
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
    if (state.payment === "catfood" && catInsufficient) state.payment = "tng";
    grid.querySelectorAll("[data-po-pay]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (btn.disabled) return;
        state.payment = btn.getAttribute("data-po-pay") || "tng";
        setExclusiveActive(grid.querySelectorAll("[data-po-pay]"), btn);
      });
    });
  }
  function lockScroll(lock) {
    if (lock) {
      if (document.documentElement.dataset.mcjPoScrollLocked) return;
      var y = window.scrollY || window.pageYOffset || 0;
      document.documentElement.dataset.mcjPoScrollLocked = "1";
      document.documentElement.dataset.mcjPoScrollY = String(y);
      // body 上若有 transform，会让 fixed 子元素相对 body 定位并随滚动飞出视口。
      try {
        var cs = window.getComputedStyle(document.body);
        if (cs && cs.transform && cs.transform !== "none") {
          document.documentElement.dataset.mcjPoBodyTransform = document.body.style.transform || "";
          document.body.style.transform = "none";
        }
      } catch (e) {}
      document.documentElement.style.overflow = "hidden";
      document.body.style.overflow = "hidden";
    } else if (document.documentElement.dataset.mcjPoScrollLocked) {
      var restore = Number(document.documentElement.dataset.mcjPoScrollY || 0);
      delete document.documentElement.dataset.mcjPoScrollLocked;
      delete document.documentElement.dataset.mcjPoScrollY;
      document.documentElement.style.overflow = "";
      document.body.style.overflow = "";
      if (Object.prototype.hasOwnProperty.call(document.documentElement.dataset, "mcjPoBodyTransform")) {
        document.body.style.transform = document.documentElement.dataset.mcjPoBodyTransform;
        delete document.documentElement.dataset.mcjPoBodyTransform;
      }
      document.body.style.position = "";
      document.body.style.top = "";
      document.body.style.left = "";
      document.body.style.right = "";
      document.body.style.width = "";
      window.scrollTo(0, restore);
    }
  }
  function hardCleanup() {
    document.querySelectorAll(".mcj-po-mask,[data-mcj-po-mask]").forEach(function (mask) {
      mask.remove();
    });
    state.open = false;
    state.submitting = false;
    state.idempotencyKey = "";
    openGuard = false;
    lockScroll(false);
  }
  function failOpen(msg) {
    hardCleanup();
    toast(msg || "下单窗口加载失败，请重新打开");
  }
  function dialogInlineStyle() {
    // Positioning is owned by CSS flex centering on the mask. Keep inline styles
    // to presentation only so body/scroll lock cannot push the dialog off-screen.
    return (
      "position:relative;display:flex;flex-direction:column;overflow:hidden;box-sizing:border-box;" +
      "margin:0;transform:none;left:auto;top:auto;right:auto;bottom:auto;" +
      "max-height:min(88dvh,calc(100dvh - 40px));min-height:0;"
    );
  }
  function avatarSrc(raw) {
    var s = String(raw == null ? "" : raw).trim();
    if (!s || /meow-cuijiao-brand\.(jpe?g|png|webp)$/i.test(s) || s === "assets/meow-cuijiao-brand.jpg") {
      return DEFAULT_AVATAR;
    }
    return s;
  }
  function availabilityCodeOf(raw) {
    if (!raw || typeof raw !== "object") return "offline";
    var code = String(
      raw.availabilityStatus || raw.availability_status || raw.onlineStatusCode || ""
    )
      .trim()
      .toLowerCase();
    if (/^(online|busy|paused|offline)$/.test(code)) return code;
    var text = String(
      raw.availabilityText || raw.onlineStatus || raw.status || raw.workStatus || ""
    ).trim();
    if (/在线可接单|^online$/i.test(text) || text === "在线") return "online";
    if (/忙碌|busy/i.test(text)) return "busy";
    if (/暂停|paused/i.test(text)) return "paused";
    if (/离线|offline/i.test(text)) return "offline";
    if (raw.online === true || raw.isOnline === true || raw.online === 1 || raw.isOnline === 1) return "online";
    if (raw.canOrderNow === true || raw.canAcceptOrders === true) return "online";
    return "offline";
  }
  function availabilityLabelOf(code) {
    return (
      { online: "在线可接单", busy: "忙碌中", paused: "暂停接单", offline: "离线" }[code] || "离线"
    );
  }
  function normalizeCertTags(raw) {
    var list = raw && (raw.certTags || raw.certificationTags || raw.certification_tags);
    if (!Array.isArray(list)) return [];
    return list
      .map(function (t) {
        if (!t) return null;
        if (typeof t === "string") return { id: t, name: t, icon: "", color: "" };
        var name = String(t.name || t.title || "").trim();
        if (!name) return null;
        return {
          id: String(t.id || name),
          name: name,
          icon: String(t.icon || "").trim(),
          color: String(t.color || "").trim(),
        };
      })
      .filter(Boolean);
  }
  function isUuidLike(v) {
    return /^[0-9a-f-]{36}$/i.test(String(v || "").trim());
  }
  function normalizeServiceList(list, fallbackUnit) {
    if (!Array.isArray(list)) return [];
    var unit = String(fallbackUnit || "小时");
    var out = [];
    var seen = {};
    list.forEach(function (raw, idx) {
      if (!raw) return;
      if (typeof raw === "string") {
        var label = String(raw).trim();
        if (!label || isUuidLike(label) || seen[label]) return;
        seen[label] = 1;
        out.push({
          id: label,
          serviceId: "",
          name: label,
          price: 0,
          pricingUnit: unit,
          specs: null,
        });
        return;
      }
      var name = String(raw.name || raw.serviceName || raw.service || raw.title || raw.game || "").trim();
      if (!name || isUuidLike(name)) return;
      var price = positiveMoney(raw.price != null ? raw.price : raw.unitPrice != null ? raw.unitPrice : raw.priceValue);
      if (!(price > 0)) return;
      if (seen[name]) return;
      seen[name] = 1;
      var sid = String(raw.serviceId || raw.service_id || raw.id || "").trim();
      out.push({
        id: sid || name || "svc-" + idx,
        serviceId: sid,
        name: name,
        price: price,
        pricingUnit: String(raw.pricingUnit || raw.pricing_unit || unit).trim() || unit,
        specs: Array.isArray(raw.specs) && raw.specs.length ? raw.specs : null,
      });
    });
    return out;
  }
  function servicesFromGameMap(raw) {
    var gp = raw && (raw.gamePrices || raw.game_prices);
    if (!gp || typeof gp !== "object") return [];
    var unit = String((raw && (raw.pricingUnit || raw.pricing_unit)) || "小时");
    var ids = [];
    if (Array.isArray(raw.serviceIds)) ids = raw.serviceIds.slice();
    else if (Array.isArray(raw.service_ids)) ids = raw.service_ids.slice();
    var out = [];
    var seen = {};
    function push(name, price, sid) {
      var n = String(name || "").trim();
      var p = positiveMoney(price);
      if (!n || isUuidLike(n) || !(p > 0) || seen[n]) return;
      seen[n] = 1;
      out.push({
        id: sid || n,
        serviceId: sid || "",
        name: n,
        price: p,
        pricingUnit: unit,
        specs: null,
      });
    }
    if (ids.length) {
      ids.forEach(function (id) {
        var key = String(id || "").trim();
        if (!key) return;
        var price = gp[key];
        var human = Object.keys(gp).find(function (k) {
          return (
            k !== key &&
            !isUuidLike(k) &&
            positiveMoney(gp[k]) > 0 &&
            (positiveMoney(gp[k]) === positiveMoney(price) || !(positiveMoney(price) > 0))
          );
        });
        var name = human || (!isUuidLike(key) ? key : "") || String(raw.game || raw.mainGame || "").split(/[,，、]/)[0];
        push(name, price > 0 ? price : gp[name] || gp[human] || 0, key);
      });
    }
    Object.keys(gp).forEach(function (k) {
      if (isUuidLike(k)) return;
      push(k, gp[k], "");
    });
    return out;
  }
  function resolveServices(raw) {
    var fromList = normalizeServiceList(raw && raw.services, raw && (raw.pricingUnit || raw.pricing_unit));
    if (fromList.length) return fromList;
    return servicesFromGameMap(raw || {});
  }
  function companionServices() {
    return (state.companion && Array.isArray(state.companion.services) && state.companion.services) || [];
  }
  function findService(nameOrId) {
    var key = String(nameOrId || "").trim();
    var list = companionServices();
    if (!key || !list.length) return null;
    return (
      list.find(function (s) {
        return s.name === key || String(s.id) === key || String(s.serviceId) === key;
      }) || null
    );
  }
  function hourOptionsFromService(svc) {
    if (svc && Array.isArray(svc.specs) && svc.specs.length) {
      return svc.specs.map(function (spec, idx) {
        var custom = !!(spec && spec.custom);
        var qty = money(spec && (spec.quantity != null ? spec.quantity : spec.value));
        return {
          id: String((spec && spec.id) || (custom ? "custom" : "h-" + idx)),
          label: String((spec && spec.label) || (custom ? "自定义" : qty + " 小时")),
          value: custom ? 0 : qty > 0 ? qty : 1,
          custom: custom,
        };
      });
    }
    return DEFAULT_HOURS.slice();
  }
  function applySelectedService(svc, opts) {
    opts = opts || {};
    if (!svc || !state.companion) return;
    state.service = svc.name;
    if (!/自定义/.test(svc.name)) state.customService = "";
    state.companion.unitPrice = money(svc.price);
    state.companion.pricingUnit = svc.pricingUnit || state.companion.pricingUnit || "小时";
    state.companion.serviceId = svc.serviceId || svc.id || "";
    state.hourOptions = hourOptionsFromService(svc);
    if (!opts.keepHours) {
      var first = state.hourOptions.find(function (h) {
        return !h.custom;
      }) || state.hourOptions[0];
      if (first) {
        state.hoursMode = first.id;
        state.hours = first.custom ? Math.max(0.5, money(state.hours) || 1) : first.value;
      }
    }
  }
  function normalizeCompanion(raw) {
    if (!raw || typeof raw !== "object") return null;
    var id = String(raw.companionId || raw.companion_id || raw.id || raw.uid || "").trim();
    if (!id) return null;
    var name =
      String(raw.companionName || raw.companion_name || raw.nickname || raw.name || "陪玩").trim() || "陪玩";
    var services = resolveServices(raw);
    var preferred =
      services.find(function (s) {
        return (
          s.name === String(raw.service || raw.serviceType || raw.serviceName || raw.game || raw.mainGame || "").trim()
        );
      }) || services[0] || null;
    var unitPrice = preferred
      ? money(preferred.price)
      : resolveUnitPrice(
          [raw.unitPrice, raw.priceValue, raw.price, raw.hourlyPrice],
          raw.gamePrices || raw.game_prices
        );
    var service = (preferred && preferred.name) ||
      String(raw.service || raw.serviceType || raw.serviceName || raw.game || raw.mainGame || "").trim() ||
      "";
    var level = String(raw.level || raw.levelName || raw.rank || raw.tier || "").trim() || "认证陪玩";
    var availCode = availabilityCodeOf(raw);
    var online = availCode === "online" || availCode === "busy";
    var publishReady = true;
    if (raw.publishReady === false || raw.canOrder === false || raw.hallVisible === false) {
      publishReady = false;
    }
    if (raw.publishReady === true || raw.hallVisible === true) publishReady = true;
    // 资料待完善仍可展示/下单；仅硬状态拦截
    if (String(raw.publishStatus || "").match(/待审核|禁止|驳回|未启用|封禁|归档/)) publishReady = false;
    return {
      companionId: id,
      companionName: name,
      unitPrice: unitPrice,
      service: service,
      services: services,
      serviceId: (preferred && (preferred.serviceId || preferred.id)) || String(raw.serviceId || raw.service_id || "").trim(),
      pricingUnit:
        (preferred && preferred.pricingUnit) ||
        String(raw.pricingUnit || raw.pricing_unit || "小时"),
      avatar: avatarSrc(raw.avatar || raw.cover || raw.cardImageUrl || ""),
      publicId: raw.publicId || "",
      level: level,
      online: online,
      availabilityStatus: availCode,
      availabilityText: availabilityLabelOf(availCode),
      canAcceptOrders: publishReady && availCode === "online",
      publishReady: publishReady,
      certTags: normalizeCertTags(raw),
    };
  }
  function matchService(service) {
    var list = companionServices();
    var s = String(service || "").trim();
    if (list.length) {
      var exact = list.find(function (x) {
        return x.name === s;
      });
      if (exact) return { service: exact.name, custom: /自定义/.test(exact.name) ? s : "" };
      var partial = list.find(function (x) {
        return s && (s.indexOf(x.name) !== -1 || x.name.indexOf(s) !== -1);
      });
      if (partial) return { service: partial.name, custom: "" };
      return { service: list[0].name, custom: "" };
    }
    if (!s) return { service: "", custom: "" };
    if (/自定义/.test(s)) return { service: s, custom: s };
    return { service: s, custom: "" };
  }
  function currentHours() {
    return Math.max(0.5, money(state.hours) || 1);
  }
  function currentServiceLabel() {
    if (/自定义/.test(String(state.service || "")) && String(state.customService || "").trim()) {
      return String(state.customService || "").trim();
    }
    return state.service;
  }
  function currentQuantity() {
    return Math.max(1, Math.floor(money(state.quantity) || 1));
  }
  function totalAmount() {
    var c = state.companion;
    if (!c) return 0;
    return Math.round(money(c.unitPrice) * currentHours() * currentQuantity() * 100) / 100;
  }
  function requireLogin(resumeFn) {
    if (token()) return true;
    var resume =
      typeof resumeFn === "function"
        ? resumeFn
        : function () {
            submitOrder();
          };
    if (window.MCJAuthContinue && typeof window.MCJAuthContinue.requireLogin === "function") {
      window.MCJAuthContinue.requireLogin(resume);
      return false;
    }
    if (typeof window.loginRequiredModal === "function") {
      if (window.MCJAuthContinue && typeof window.MCJAuthContinue.setPending === "function") {
        window.MCJAuthContinue.setPending(resume);
      }
      window.loginRequiredModal();
      return false;
    }
    if (window.MCJModal && typeof window.MCJModal.openLogin === "function") {
      if (window.MCJAuthContinue && typeof window.MCJAuthContinue.setPending === "function") {
        window.MCJAuthContinue.setPending(resume);
      }
      window.MCJModal.openLogin("login");
      return false;
    }
    if (window.MCJBossHeader && typeof window.MCJBossHeader.openLogin === "function") {
      if (window.MCJAuthContinue && typeof window.MCJAuthContinue.setPending === "function") {
        window.MCJAuthContinue.setPending(resume);
      }
      window.MCJBossHeader.openLogin();
      return false;
    }
    try {
      sessionStorage.setItem("mcjAfterLoginRedirect", location.href);
    } catch (e) {}
    location.href = "index.html#login";
    return false;
  }
  function close(opts) {
    opts = opts || {};
    document.querySelectorAll(".mcj-po-mask,[data-mcj-po-mask]").forEach(function (mask) {
      mask.remove();
    });
    state.open = false;
    state.submitting = false;
    state.submitStartedAt = 0;
    openGuard = false;
    lockScroll(false);
    // Never history.back() — that can leave the current Preview and strand a black mask.
    try {
      if (history.state && history.state.mcjPoModal) {
        history.replaceState(Object.assign({}, history.state, { mcjPoModal: 0 }), "");
      }
    } catch (e) {}
  }
  function setExclusiveActive(buttons, activeBtn) {
    (buttons || []).forEach(function (b) {
      var on = b === activeBtn;
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
      if (!on) {
        try {
          b.blur();
        } catch (e) {}
      }
    });
  }
  function setError(msg) {
    var text = String(msg || "");
    var els = [];
    var mask = activeMask();
    if (mask) {
      mask.querySelectorAll("[data-po-error]").forEach(function (el) {
        els.push(el);
      });
    } else {
      document.querySelectorAll("[data-po-error]").forEach(function (el) {
        els.push(el);
      });
    }
    els.forEach(function (el) {
      el.textContent = text;
      el.hidden = !text;
    });
  }
  function refreshTotals() {
    var c = state.companion;
    var hours = currentHours();
    var qty = currentQuantity();
    var total = moneyText(totalAmount());
    var unit = c ? moneyText(c.unitPrice) : moneyText(0);
    var map = {
      "[data-po-footer-total]": total,
      "[data-po-total]": total,
      "[data-po-footer-unit]": unit,
      "[data-po-footer-qty]": hours + " × " + qty,
      "[data-po-footer-discount]": moneyText(0),
      "[data-po-hours-label]": hours + " 小时 × " + qty,
    };
    Object.keys(map).forEach(function (sel) {
      var el = document.querySelector(sel);
      if (el) el.textContent = map[sel];
    });
    var priceHero = document.querySelector("[data-po-price-hero]");
    if (priceHero && c) priceHero.textContent = moneyText(c.unitPrice);
    var unitLabel = document.querySelector(".mcj-po-price-row small");
    if (unitLabel && c) unitLabel.textContent = "/ " + (c.pricingUnit || "小时");
    var preview = document.querySelector("[data-po-service-preview]");
    if (preview) preview.textContent = currentServiceLabel();
    if (activeMask()) paintPayCards();
  }

  function renderServiceChipsHtml() {
    var services = companionServices();
    if (!services.length) {
      return '<span class="mcj-po-empty-services" data-po-services-empty>该陪玩暂无可下单服务</span>';
    }
    return services
      .map(function (s) {
        return (
          '<button type="button" data-po-service="' +
          esc(s.name) +
          '" data-po-service-id="' +
          esc(s.serviceId || s.id || "") +
          '" class="mcj-po-chip' +
          (state.service === s.name ? " active" : "") +
          '" aria-pressed="' +
          (state.service === s.name ? "true" : "false") +
          '">' +
          esc(s.name) +
          "</button>"
        );
      })
      .join("");
  }
  function renderHourChipsHtml() {
    var hours = Array.isArray(state.hourOptions) && state.hourOptions.length ? state.hourOptions : DEFAULT_HOURS;
    return hours
      .map(function (h) {
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
      })
      .join("");
  }
  function bindServiceChips(mask) {
    if (!mask) return;
    mask.querySelectorAll("[data-po-service]").forEach(function (btn) {
      btn.addEventListener("click", function (ev) {
        ev.preventDefault();
        var name = btn.getAttribute("data-po-service") || "";
        var svc = findService(name) || findService(btn.getAttribute("data-po-service-id"));
        if (!svc) return;
        applySelectedService(svc);
        setExclusiveActive(mask.querySelectorAll("[data-po-service]"), btn);
        var wrap = mask.querySelector("[data-po-custom-service]");
        if (wrap) wrap.classList.toggle("show", /自定义/.test(state.service));
        var hourWrap = mask.querySelector("[data-po-hours-chips]");
        if (hourWrap) {
          hourWrap.innerHTML = renderHourChipsHtml();
          bindHourChips(mask);
        }
        refreshTotals();
      });
    });
  }
  function bindHourChips(mask) {
    if (!mask) return;
    mask.querySelectorAll("[data-po-hours]").forEach(function (btn) {
      btn.addEventListener("click", function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        var id = btn.getAttribute("data-po-hours");
        state.hoursMode = id;
        var meta = (state.hourOptions || DEFAULT_HOURS).find(function (h) {
          return h.id === id;
        });
        if (meta && !meta.custom) state.hours = meta.value;
        setExclusiveActive(mask.querySelectorAll("[data-po-hours]"), btn);
        var wrap = mask.querySelector("[data-po-custom-hours]");
        if (wrap) wrap.classList.toggle("show", !!(meta && meta.custom) || id === "custom");
        refreshTotals();
      });
    });
  }
  function syncOpenModalServicesUi() {
    var mask = activeMask();
    if (!mask || !state.open) return;
    var serviceWrap = mask.querySelector("[data-po-service-chips]");
    if (serviceWrap) {
      serviceWrap.innerHTML = renderServiceChipsHtml();
      bindServiceChips(mask);
    }
    var hourWrap = mask.querySelector("[data-po-hours-chips]");
    if (hourWrap) {
      hourWrap.innerHTML = renderHourChipsHtml();
      bindHourChips(mask);
    }
    var customWrap = mask.querySelector("[data-po-custom-service]");
    if (customWrap) customWrap.classList.toggle("show", /自定义/.test(String(state.service || "")));
    refreshTotals();
  }
  function hydrateFromCatalog(companionId) {
    var id = String(companionId || "").trim();
    if (!id) return;
    fetch("/api/boss/marketplace?action=catalog&companionId=" + encodeURIComponent(id), {
      headers: { Accept: "application/json" },
      cache: "no-store",
    })
      .then(function (res) {
        return res.json().then(function (body) {
          if (!res.ok || body.ok === false) throw new Error(body.message || "读取陪玩服务失败");
          return body;
        });
      })
      .then(function (body) {
        if (!state.open || !state.companion || String(state.companion.companionId) !== id) return;
        if (state.submitting) return;
        var catC = (body && body.companion) || {};
        var services = normalizeServiceList(body.services || [], catC.pricingUnit || state.companion.pricingUnit);
        if (!services.length) return;
        state.companion.services = services;
        if (catC.name) state.companion.companionName = catC.name;
        if (catC.avatar) state.companion.avatar = avatarSrc(catC.avatar);
        if (catC.publicId) state.companion.publicId = catC.publicId;
        if (catC.pricingUnit) state.companion.pricingUnit = catC.pricingUnit;
        var selected = findService(state.service) || services[0];
        if (selected) applySelectedService(selected, { keepHours: true });
        syncOpenModalServicesUi();
      })
      .catch(function () {});
  }

  function paint() {
    var c = state.companion;
    if (!c) {
      failOpen("下单窗口加载失败，请重新打开");
      return;
    }
    if (!document.body) {
      failOpen("下单窗口加载失败，请重新打开");
      return;
    }
    ensureCss();
    close({ fromPop: true });
    state.open = true;

    var serviceChips = renderServiceChipsHtml();
    var hourChips = renderHourChipsHtml();
    var payCards = PAYMENTS.map(function (p) {
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

    var mask = document.createElement("div");
    mask.className = "mcj-po-mask";
    mask.setAttribute("data-mcj-po-mask", "1");
    mask.setAttribute("role", "presentation");

    mask.innerHTML =
      '<div class="mcj-po-dialog" role="dialog" aria-modal="true" aria-label="立即下单" style="' +
      dialogInlineStyle() +
      '">' +
      '<div class="mcj-po-header">' +
      '<div class="mcj-po-header-row">' +
      '<div class="mcj-po-header-info">' +
      '<img src="' +
      esc(avatarSrc(c.avatar)) +
      '" alt="" onerror="this.onerror=null;this.src=\'' +
      DEFAULT_AVATAR +
      '\'">' +
      '<div class="mcj-po-header-copy">' +
      "<h3>立即下单</h3>" +
      '<div class="mcj-po-name">' +
      esc(c.companionName) +
      "</div>" +
      '<div class="mcj-po-meta">' +
      '<span class="mcj-po-pill">' +
      esc(c.level || "认证陪玩") +
      "</span>" +
      '<span class="mcj-po-pill' +
      (c.availabilityStatus === "online" ? " online" : "") +
      '">' +
      esc(c.availabilityText || (c.online ? "在线可接单" : "离线")) +
      "</span>" +
      (Array.isArray(c.certTags) && c.certTags.length
        ? c.certTags
            .slice(0, 4)
            .map(function (t) {
              var style = t.color ? ' style="border-color:' + esc(t.color) + ";color:" + esc(t.color) + '"' : "";
              return (
                '<span class="mcj-po-pill mcj-po-cert"' +
                style +
                ">" +
                esc((t.icon ? t.icon + " " : "") + t.name) +
                "</span>"
              );
            })
            .join("")
        : "") +
      "</div></div></div>" +
      '<button type="button" class="mcj-po-close" data-po-close aria-label="关闭">×</button>' +
      "</div></div>" +
      '<div class="mcj-po-scroll">' +
      '<div class="mcj-po-price-card">' +
      '<div class="mcj-po-price-row"><span>单价</span>' +
      priceHeroHtml(c.unitPrice) +
      "<small>/ " +
      esc(c.pricingUnit || "小时") +
      "</small></div>" +
      "<div>当前服务：<strong data-po-service-preview>" +
      esc(currentServiceLabel()) +
      "</strong></div></div>" +
      '<div class="mcj-po-field"><span class="mcj-po-label">游戏/服务项目</span><div class="mcj-po-chips" role="group" data-po-service-chips>' +
      serviceChips +
      "</div></div>" +
      '<div class="mcj-po-custom-service' +
      (/自定义/.test(String(state.service || "")) ? " show" : "") +
      '" data-po-custom-service><label>自定义服务内容<input data-po-custom-service-input value="' +
      esc(state.customService) +
      '" placeholder="例如：双排陪练"></label></div>' +
      '<div class="mcj-po-field"><span class="mcj-po-label">数量或时长</span><div class="mcj-po-chips" role="radiogroup" data-po-hours-chips>' +
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
      '<div class="mcj-po-pay-block"><div class="mcj-po-pay-label">支付方式</div><div class="mcj-po-pay-grid" data-po-pay-grid>' +
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
      "<div>优惠金额 <strong data-po-footer-discount>" +
      esc(moneyText(0)) +
      "</strong></div>" +
      "<div>合计 <strong data-po-footer-total>" +
      esc(moneyText(totalAmount())) +
      "</strong></div>" +
      "</div>" +
      '<div class="mcj-po-footer-total-row"><span>合计猫粮</span><strong data-po-total>' +
      esc(moneyText(totalAmount())) +
      "</strong></div>" +
      '<p class="mcj-po-error mcj-po-footer-error" data-po-error hidden></p>' +
      '<button type="button" class="primary mcj-po-submit" data-po-submit>确认订单并付款</button>' +
      "</div></div>";

    var dialog = mask.querySelector(".mcj-po-dialog");
    var scroll = mask.querySelector(".mcj-po-scroll");
    var footer = mask.querySelector(".mcj-po-footer");
    if (!dialog || !scroll || !footer) {
      failOpen("下单窗口加载失败，请重新打开");
      return;
    }

    try {
      // Mount on <html> — body may carry transform (containing block) which breaks viewport fixed.
      (document.documentElement || document.body).appendChild(mask);
    } catch (err) {
      console.error("[MCJPlaceOrder] append failed", err);
      failOpen("下单窗口加载失败，请重新打开");
      return;
    }

    lockScroll(true);
    openGuard = false;

    requestAnimationFrame(function () {
      if (!state.open) return;
      var live = document.querySelector("[data-mcj-po-mask] .mcj-po-dialog");
      if (!live) {
        failOpen("下单窗口加载失败，请重新打开");
        return;
      }
      live.setAttribute("style", dialogInlineStyle());
      var rect = live.getBoundingClientRect();
      var vh = window.innerHeight || document.documentElement.clientHeight || 0;
      if (rect.top < -2 || rect.bottom > vh + 2 || !(rect.height >= 80)) {
        console.warn("[MCJPlaceOrder] dialog rect repaired", rect);
        live.setAttribute("style", dialogInlineStyle());
      }
    });

    try {
      history.replaceState(Object.assign({}, history.state || {}, { mcjPoModal: 1 }), "");
    } catch (e) {}

    mask.addEventListener("click", function (e) {
      if (e.target === mask) close();
    });
    mask.querySelectorAll("[data-po-close]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        close();
      });
    });
    if (!window.__MCJPoEscBound) {
      window.__MCJPoEscBound = true;
      document.addEventListener("keydown", function (ev) {
        if (ev.key === "Escape" && state.open) {
          ev.preventDefault();
          close();
        }
      });
    }
    bindServiceChips(mask);
    var customServiceInput = mask.querySelector("[data-po-custom-service-input]");
    if (customServiceInput) {
      customServiceInput.addEventListener("input", function () {
        state.customService = customServiceInput.value;
        var preview = mask.querySelector("[data-po-service-preview]");
        if (preview) preview.textContent = currentServiceLabel();
      });
    }
    bindHourChips(mask);
    var customHoursInput = mask.querySelector("[data-po-custom-hours-input]");
    if (customHoursInput) {
      customHoursInput.addEventListener("input", function () {
        state.hours = Math.max(0.5, money(customHoursInput.value) || 1);
        refreshTotals();
      });
    }
    var qtyInput = mask.querySelector("[data-po-quantity]");
    if (qtyInput) {
      qtyInput.addEventListener("input", function () {
        state.quantity = Math.max(1, Math.floor(money(qtyInput.value) || 1));
        refreshTotals();
      });
    }
    var couponInput = mask.querySelector("[data-po-coupon]");
    if (couponInput) {
      couponInput.addEventListener("input", function () {
        state.couponCode = String(couponInput.value || "").trim();
      });
    }
    mask.querySelectorAll("[data-po-pay]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (btn.disabled) return;
        state.payment = btn.getAttribute("data-po-pay") || "tng";
        setExclusiveActive(mask.querySelectorAll("[data-po-pay]"), btn);
      });
    });
    var submit = mask.querySelector("[data-po-submit]");
    if (submit) {
      submit.addEventListener("click", function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        submitOrder();
      });
    }
    refreshWalletBalance().then(function () {
      if (!state.open || !activeMask()) return;
      paintPayCards();
    });
  }

  function parseApiJson(res) {
    return res.text().then(function (text) {
      var body = {};
      try {
        body = text ? JSON.parse(text) : {};
      } catch (e) {
        body = { ok: false, message: text ? "服务器返回异常" : "空响应" };
      }
      if (!res.ok || body.ok === false) {
        var err = new Error(body.message || "请求失败");
        err.code = body.code || "";
        err.body = body;
        err.status = res.status;
        throw err;
      }
      return body;
    });
  }

  function payCreatedOrder(orderId, paymentMethod) {
    return fetch("/api/orders", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        action: "pay_order",
        id: orderId,
        paymentMethod: paymentMethod,
        preview_test: isWalletPayment(paymentMethod) ? "" : "1",
      }),
    }).then(parseApiJson);
  }

  function goOrderSuccess(order) {
    var oid = order && order.id ? order.id : "";
    close();
    toast("下单成功");
    if (oid) {
      location.href = "orders.html?id=" + encodeURIComponent(oid);
      return;
    }
    location.href = "orders.html";
  }

  function goPaymentPage(order) {
    var oid = order && order.id ? order.id : "";
    close();
    if (oid) {
      var cachePayload = JSON.stringify({
        id: oid,
        orderNo: order.orderNo || order.order_no || "",
        paymentMethod: state.payment,
        totalAmount: order.totalAmount || order.total_amount || totalAmount(),
        status: order.status || "awaiting_payment",
      });
      try {
        sessionStorage.setItem("mcjOrderCache:" + oid, cachePayload);
      } catch (e) {}
      try {
        localStorage.setItem("mcjOrderCache:" + oid, cachePayload);
      } catch (e2) {}
      location.href = "payment-confirm.html?order=" + encodeURIComponent(oid) + "&allowTestPay=1";
      return;
    }
    location.href = "orders.html";
  }

  function submitOrder() {
    try {
      if (state.submitting) {
        var waited = Date.now() - (state.submitStartedAt || 0);
        if (waited < 25000) {
          toast("订单提交中，请稍候…");
          setSubmitLoading(true);
          return;
        }
        // Stuck lock recovery
        state.submitting = false;
        setSubmitLoading(false);
        toast("上次提交已超时，请重试");
      }
      if (!requireLogin(function () {
        submitOrder();
      })) return;
      var c = state.companion;
      if (!c || !c.companionId) {
        failValidate("缺少陪玩信息，无法下单");
        return;
      }
      if (!(money(c.unitPrice) > 0)) {
        failValidate("该陪玩尚未设置单价");
        return;
      }
      if (c.publishReady === false) {
        failValidate("该陪玩资料未完善或未通过审核，暂不可下单");
        return;
      }
      if (c.availabilityStatus === "paused" || c.availabilityStatus === "offline") {
        failValidate(
          c.availabilityStatus === "paused"
            ? "该陪玩已暂停接单，请稍后再试"
            : "该陪玩当前离线，暂不可下单"
        );
        return;
      }

      var gameIdEl = qs("[data-po-game-id]");
      var notesEl = qs("[data-po-notes]");
      var couponEl = qs("[data-po-coupon]");
      var qtyEl = qs("[data-po-quantity]");
      var contactEl = qs("[data-po-contact]");
      var regionEl = qs("[data-po-region]");
      var scheduleEl = qs("[data-po-schedule]");
      var gameId = gameIdEl ? String(gameIdEl.value || "").trim() : "";
      var contact = contactEl ? String(contactEl.value || "").trim() : "";
      var region = regionEl ? String(regionEl.value || "").trim() : "";
      var schedule = scheduleEl ? String(scheduleEl.value || "").trim() : "";
      var payment = String(state.payment || "").trim();

      if (!gameId) {
        failValidate("游戏ID不能为空", "[data-po-game-id]");
        return;
      }
      if (!schedule) {
        failValidate("服务时间不能为空", "[data-po-schedule]");
        return;
      }
      if (!payment) {
        failValidate("支付方式不能为空");
        return;
      }
      if (/自定义/.test(String(state.service || "")) && !String(state.customService || "").trim()) {
        failValidate("请填写自定义服务内容", "[data-po-custom-service-input]");
        return;
      }
      if (!companionServices().length) {
        failValidate("该陪玩暂无可下单服务");
        return;
      }
      if (!findService(state.service)) {
        failValidate("请选择该陪玩已启用的服务");
        return;
      }
      if (qtyEl) state.quantity = Math.max(1, Math.floor(money(qtyEl.value) || 1));
      if (couponEl) state.couponCode = String(couponEl.value || "").trim();
      var hours = currentHours();
      var quantity = currentQuantity();
      var total = totalAmount();
      if (!(total > 0)) {
        failValidate("订单金额无效");
        return;
      }
      if (isWalletPayment(payment)) {
        if (state.walletBalance != null && !(state.walletBalance + 1e-9 >= total)) {
          failValidate("猫粮余额不足，请改用 TNG / 银行卡 / 支付宝或先充值");
          return;
        }
      }

      state.submitting = true;
      state.submitStartedAt = Date.now();
      if (!state.idempotencyKey) {
        state.idempotencyKey =
          "po-" +
          String(c.companionId || "x") +
          "-" +
          Date.now() +
          "-" +
          Math.random().toString(36).slice(2, 8);
      }
      setError("");
      setSubmitLoading(true);

      // Re-read live price from companion/service data right before submit — no stale cache.
      fetch("/api/boss/marketplace?action=catalog&companionId=" + encodeURIComponent(c.companionId), {
        headers: { Accept: "application/json" },
        cache: "no-store",
      })
        .then(function (res) {
          return res.json().then(function (body) {
            if (!res.ok || body.ok === false) throw new Error(body.message || "读取陪玩单价失败");
            return body;
          });
        })
        .then(function (body) {
          var catC = (body && body.companion) || {};
          var services = (body && body.services) || [];
          var selected =
            services.find(function (s) {
              return String(s.name || "") === String(currentServiceLabel());
            }) ||
            services[0] ||
            null;
          var liveUnit = money((selected && selected.price) || catC.price || 0);
          if (!(liveUnit > 0)) {
            state.submitting = false;
            state.submitStartedAt = 0;
            setSubmitLoading(false);
            failValidate("该陪玩尚未设置单价");
            return null;
          }
          c.unitPrice = liveUnit;
          if (selected && (selected.serviceId || selected.id)) c.serviceId = selected.serviceId || selected.id;
          if (catC.id) c.companionId = catC.id;
          refreshTotals();
          return true;
        })
        .catch(function () {
          // Catalog unavailable: keep already-validated in-memory unitPrice.
          return true;
        })
        .then(function (ok) {
          if (!ok) return;
          var hoursLive = currentHours();
          var quantityLive = currentQuantity();
          var totalLive = Math.round(money(c.unitPrice) * hoursLive * quantityLive * 100) / 100;
          if (!(totalLive > 0)) {
            state.submitting = false;
            state.submitStartedAt = 0;
            setSubmitLoading(false);
            failValidate("该陪玩尚未设置单价");
            return;
          }
          console.info("[MCJPlaceOrder] submit start", {
            companionId: c.companionId,
            payment: payment,
            total: totalLive,
            unitPrice: money(c.unitPrice),
            gameId: gameId,
          });

          var noteParts = [];
          if (notesEl && String(notesEl.value || "").trim()) noteParts.push(String(notesEl.value || "").trim());
          if (region) noteParts.push("区服：" + region);
          if (schedule) noteParts.push("服务时间：" + schedule);
          if (contact) noteParts.push("联系方式：" + contact);

          var payload = {
            action: "place_order",
            companionId: c.companionId,
            companion_id: c.companionId,
            companionName: c.companionName,
            serviceType: currentServiceLabel(),
            service: currentServiceLabel(),
            serviceId: c.serviceId || "",
            service_id: c.serviceId || "",
            game: currentServiceLabel(),
            unitPrice: money(c.unitPrice),
            unit_price: money(c.unitPrice),
            hours: hoursLive,
            quantity: quantityLive,
            totalAmount: totalLive,
            total_amount: totalLive,
            gameId: gameId,
            region: region,
            schedule: schedule,
            couponCode: state.couponCode || "",
            contact: contact,
            notes: noteParts.join("；"),
            paymentMethod: payment,
            idempotencyKey: state.idempotencyKey,
            idempotency_key: state.idempotencyKey,
          };

          return fetch("/api/orders", {
            method: "POST",
            headers: authHeaders(),
            body: JSON.stringify(payload),
          })
            .then(parseApiJson)
            .then(function (body) {
              var order = body.order || {};
              var oid = order.id || "";
              if (!oid) throw new Error("订单创建失败");
              if (isWalletPayment(payment)) {
                setSubmitLoading(true);
                return payCreatedOrder(oid, payment).then(function (paid) {
                  goOrderSuccess(paid.order || order);
                });
              }
              goPaymentPage(order);
            });
        })
        .catch(function (err) {
          state.submitting = false;
          state.submitStartedAt = 0;
          setSubmitLoading(false);
          console.error("[MCJPlaceOrder] submit failed", err);
          var msg = String((err && err.message) || "");
          if (/单价无效|尚未设置单价/.test(msg)) {
            failValidate("该陪玩尚未设置单价");
            toast("该陪玩尚未设置单价");
            return;
          }
          if (err && (err.code === "INSUFFICIENT_BALANCE" || /余额不足|猫粮/.test(msg))) {
            failValidate(msg || "猫粮余额不足");
            toast((msg || "猫粮余额不足") + "，可前往充值页");
            return;
          }
          if (/登录|401|未登录|老板账号/.test(msg)) {
            requireLogin(function () {
              submitOrder();
            });
            return;
          }
          if (/支付/.test(msg)) {
            failValidate(msg || "支付失败");
            toast(msg || "支付失败");
            return;
          }
          failValidate(msg || "订单创建失败");
          toast(msg || "订单创建失败");
        });
    } catch (err) {
      state.submitting = false;
      state.submitStartedAt = 0;
      setSubmitLoading(false);
      console.error("[MCJPlaceOrder] submit crashed", err);
      failValidate((err && err.message) || "订单创建失败");
    }
  }

  function open(rawCompanion) {
    if (state.submitting) {
      toast("订单提交中，请稍候…");
      return;
    }
    if (openGuard) return;
    openGuard = true;
    setTimeout(function () {
      openGuard = false;
    }, 400);

    var companion = normalizeCompanion(rawCompanion);
    if (!companion) {
      failOpen("下单窗口加载失败，请重新打开");
      console.error("[MCJPlaceOrder] missing companion", rawCompanion);
      return;
    }
    if (!(companion.unitPrice > 0) && !(companion.services && companion.services.length)) {
      failOpen("该陪玩尚未设置单价");
      console.error("[MCJPlaceOrder] missing unitPrice", companion);
      return;
    }
    state.companion = companion;
    var selected = findService(companion.service) || (companion.services && companion.services[0]) || null;
    if (selected) {
      applySelectedService(selected);
    } else {
      var matched = matchService(companion.service);
      state.service = matched.service;
      state.customService = matched.custom;
      state.hourOptions = DEFAULT_HOURS.slice();
      state.hoursMode = "1";
      state.hours = 1;
    }
    state.quantity = 1;
    state.couponCode = "";
    state.payment = "tng";
    state.submitting = false;
    state.submitStartedAt = 0;
    state.idempotencyKey = "";
    if (!(money(state.companion.unitPrice) > 0)) {
      failOpen("该陪玩尚未设置单价");
      return;
    }
    try {
      paint();
      hydrateFromCatalog(companion.companionId);
    } catch (err) {
      console.error("[MCJPlaceOrder] paint crashed", err);
      failOpen("下单窗口加载失败，请重新打开");
    }
  }

  function openFromProfileCompanion(companion, extras) {
    extras = extras || {};
    var src = companion && typeof companion === "object" ? companion : {};
    var companionId = String(
      extras.companionId || src.companionId || src.companion_id || src.id || src.uid || ""
    ).trim();
    var companionName = String(
      extras.companionName || src.companionName || src.companion_name || src.nickname || src.name || "陪玩"
    ).trim();
    var unitPrice = resolveUnitPrice(
      [extras.unitPrice, src.unitPrice, src.priceValue, src.price, src.hourlyPrice],
      src.gamePrices || src.game_prices || extras.gamePrices
    );
    var services =
      normalizeServiceList(extras.services || src.services, extras.pricingUnit || src.pricingUnit) || [];
    if (!services.length) {
      services = resolveServices(Object.assign({}, src, extras));
    }

    var merged = Object.assign({}, src, extras, {
      companionId: companionId,
      id: companionId,
      uid: companionId,
      companionName: companionName,
      name: companionName,
      unitPrice: unitPrice,
      priceValue: unitPrice,
      price: unitPrice,
      services: services,
      service:
        extras.service ||
        src.service ||
        src.serviceType ||
        src.game ||
        src.mainGame ||
        (services[0] && services[0].name) ||
        "",
      game: extras.service || src.game || src.mainGame || (services[0] && services[0].name) || "",
      gamePrices: extras.gamePrices || src.gamePrices || src.game_prices || {},
      serviceIds: extras.serviceIds || src.serviceIds || src.service_ids || [],
      avatar: extras.avatar || src.avatar || src.cover || "",
      publicId: extras.publicId || src.publicId || "",
      pricingUnit: extras.pricingUnit || src.pricingUnit || "小时",
      level: extras.level || src.level || src.levelName || "",
      availabilityStatus:
        extras.availabilityStatus || src.availabilityStatus || src.availability_status || "",
      availabilityText: extras.availabilityText || src.availabilityText || src.status || src.onlineStatus || "",
      online:
        extras.online != null
          ? extras.online
          : src.online != null
            ? src.online
            : src.isOnline != null
              ? src.isOnline
              : undefined,
      certTags: extras.certTags || src.certTags || src.certificationTags || [],
      publishReady: extras.publishReady != null ? extras.publishReady : src.publishReady,
      canAcceptOrders: extras.canAcceptOrders != null ? extras.canAcceptOrders : src.canAcceptOrders,
      canOrderNow: extras.canOrderNow != null ? extras.canOrderNow : src.canOrderNow,
    });

    // Soft update: catalog refresh must NOT remount and wipe filled fields / kill submit.
    if (state.open && state.companion && String(state.companion.companionId) === companionId) {
      if (state.submitting) return;
      var next = normalizeCompanion(merged);
      if (!next) return;
      if (next.services && next.services.length) state.companion.services = next.services;
      if (companionName) state.companion.companionName = companionName;
      if (next.avatar) state.companion.avatar = next.avatar;
      if (next.publicId) state.companion.publicId = next.publicId;
      state.companion.availabilityStatus = next.availabilityStatus;
      state.companion.availabilityText = next.availabilityText;
      state.companion.online = next.online;
      state.companion.canAcceptOrders = next.canAcceptOrders;
      state.companion.publishReady = next.publishReady;
      if (next.certTags && next.certTags.length) state.companion.certTags = next.certTags;
      var selected =
        findService(extras.service || src.service || state.service) ||
        (state.companion.services && state.companion.services[0]) ||
        null;
      if (selected) applySelectedService(selected, { keepHours: true });
      else {
        var nextPrice = money(unitPrice);
        if (nextPrice > 0) state.companion.unitPrice = nextPrice;
        if (next.pricingUnit) state.companion.pricingUnit = next.pricingUnit;
      }
      syncOpenModalServicesUi();
      paintPayCards();
      var statusPill = qs(".mcj-po-pill.online, .mcj-po-meta .mcj-po-pill:nth-child(2)");
      if (statusPill && next.availabilityText) {
        statusPill.textContent = next.availabilityText;
        statusPill.classList.toggle("online", next.availabilityStatus === "online");
      }
      return;
    }

    open(merged);
  }

  window.MCJPlaceOrder = {
    open: open,
    openFromCompanion: openFromProfileCompanion,
    close: close,
    isSubmitting: function () {
      return !!state.submitting;
    },
    isOpen: function () {
      return !!state.open;
    },
    submit: submitOrder,
  };

  window.addEventListener("popstate", function () {
    if (state.open) close({ fromPop: true });
  });
})();
