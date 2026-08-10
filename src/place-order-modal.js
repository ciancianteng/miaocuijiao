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
  var toastTimer = null;
  var openGuard = false;
  var state = {
    open: false,
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
    submitStartedAt: 0,
    walletBalance: null,
    payMethods: [],
    payLoadError: "",
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
  function priceHeroHtml(v) {
    return '<span class="mcj-po-price-hero" data-po-price-hero>' + esc(moneyText(v)) + "</span>";
  }
  function looksLikeJwt(raw) {
    var t = String(raw || "").trim();
    if (!t || t.length < 20) return false;
    var parts = t.split(".");
    return parts.length === 3 && parts.every(function (p) {
      return p.length > 0;
    });
  }
  function token() {
    if (window.MCJBossAuth && typeof window.MCJBossAuth.getAccessToken === "function") {
      var fromBoss = window.MCJBossAuth.getAccessToken();
      if (looksLikeJwt(fromBoss)) return fromBoss;
    }
    var candidates = [
      localStorage.getItem("mcjAuthAccessToken"),
      sessionStorage.getItem("mcjAuthAccessToken"),
      localStorage.getItem("customerAuthToken"),
      sessionStorage.getItem("customerAuthToken"),
    ];
    for (var i = 0; i < candidates.length; i++) {
      if (looksLikeJwt(candidates[i])) return candidates[i];
    }
    return "";
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
  function applyOrderPayMethods(body) {
    // Sole SoT: GET /api/recharge → orderPayMethods (payment_channels + wallet gate).
    // Never reconstruct from body.methods / never hardcode fallback channels.
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
  function refreshWalletBalance(attempt) {
    var tryCount = attempt || 0;
    function runFetch() {
      if (!token()) {
        state.walletBalance = null;
        state.payMethods = [];
        state.payLoadError = "请先登录老板账号后再选择支付方式";
        return Promise.resolve(null);
      }
      return fetch("/api/recharge", { method: "GET", headers: authHeaders(), cache: "no-store" })
        .then(function (res) {
          return res.json().then(function (body) {
            if (!res.ok || body.ok === false) {
              var err = new Error(body.message || "支付方式读取失败");
              err.status = res.status;
              throw err;
            }
            var bal =
              body.summary && body.summary.balance != null
                ? body.summary.balance
                : body.wallet && body.wallet.totalBalance != null
                  ? body.wallet.totalBalance
                  : null;
            state.walletBalance = bal == null ? null : money(bal);
            applyOrderPayMethods(body);
            state.payLoadError = "";
            return state.walletBalance;
          });
        })
        .catch(function (err) {
          if (tryCount < 1) {
            return new Promise(function (resolve) {
              setTimeout(function () {
                resolve(refreshWalletBalance(tryCount + 1));
              }, 600);
            });
          }
          state.payLoadError =
            (err && err.status === 401) || /登录|token|jwt|过期/i.test(String((err && err.message) || ""))
              ? "登录已失效，请重新登录后再下单"
              : String((err && err.message) || "支付方式读取失败，请刷新重试");
          return state.walletBalance;
        });
    }
    if (window.MCJBossAuth && typeof window.MCJBossAuth.ensureSession === "function") {
      return window.MCJBossAuth.ensureSession()
        .then(runFetch)
        .catch(runFetch);
    }
    return runFetch();
  }
  function paintPayCards() {
    var mask = activeMask();
    if (!mask) return;
    var grid = mask.querySelector("[data-po-pay-grid]");
    if (!grid) return;
    var total = totalAmount();
    var bal = state.walletBalance;
    var catInsufficient = bal != null && !(bal + 1e-9 >= total);
    // Only SoT list from /api/recharge. PAYMENTS is intentionally empty (no hardcode fallback).
    var list = state.payMethods && state.payMethods.length ? state.payMethods : [];
    if (!list.length) {
      grid.innerHTML =
        '<p class="mcj-po-empty-services" style="color:#9ca3af;font-size:13px;margin:0">' +
        esc(state.payLoadError || "暂无可用支付方式，请联系管理员在后台启用") +
        "</p>";
      state.payment = "";
      return;
    }
    grid.innerHTML = list
      .map(function (p) {
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
      })
      .join("");
    if (state.payment === "catfood" && catInsufficient) {
      var alt = list.find(function (p) {
        return p.id !== "catfood";
      });
      state.payment = alt ? alt.id : "catfood";
    }
    if (!list.some(function (p) { return p.id === state.payment; })) {
      state.payment = list[0] ? list[0].id : "";
    }
    grid.querySelectorAll("[data-po-pay]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        if (btn.disabled) return;
        state.payment = btn.getAttribute("data-po-pay") || "";
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
  function normalizeCompanion(raw) {
    if (!raw || typeof raw !== "object") return null;
    var id = String(raw.companionId || raw.companion_id || raw.id || raw.uid || "").trim();
    if (!id) return null;
    var name =
      String(raw.companionName || raw.companion_name || raw.nickname || raw.name || "陪玩").trim() || "陪玩";
    var unitPrice = money(
      raw.unitPrice != null
        ? raw.unitPrice
        : raw.priceValue != null
          ? raw.priceValue
          : raw.price != null
            ? raw.price
            : raw.hourlyPrice
    );
    var service =
      String(raw.service || raw.serviceName || raw.game || raw.mainGame || "").trim();
    if (LEGACY_SERVICE_NAMES[service]) service = "";
    var levelId = String(raw.levelId || raw.level_id || "").trim();
    var level = String(raw.level || raw.levelName || raw.rank || raw.tier || "").trim();
    if (!level && levelId && window.MCJCompanionLevels && window.MCJCompanionLevels.label) {
      level = window.MCJCompanionLevels.label(levelId);
    }
    if (!level) level = "未设置等级";
    var onlineRaw =
      raw.availabilityStatus ||
      raw.availability_status ||
      raw.availabilityText ||
      raw.onlineStatus ||
      raw.online_status ||
      raw.status;
    var presence =
      window.MCJCompanionPresence && window.MCJCompanionPresence.fromCompanion
        ? window.MCJCompanionPresence.fromCompanion(raw)
        : null;
    var online = presence
      ? presence.code === "online" || presence.code === "busy"
      : onlineRaw === true ||
        onlineRaw === 1 ||
        /online|在线|busy|接单中|忙碌/i.test(String(onlineRaw || ""));
    var gamePrices = raw.gamePrices || raw.game_prices || {};
    if (typeof gamePrices !== "object" || !gamePrices) gamePrices = {};
    var serviceIds = raw.serviceIds || raw.service_ids || [];
    if (!Array.isArray(serviceIds)) serviceIds = [];
    var services = Array.isArray(raw.services) ? raw.services.slice() : [];
    var game = String(raw.game || raw.mainGame || raw.main_game || "").trim();
    return {
      companionId: id,
      companionName: name,
      unitPrice: unitPrice,
      service: service,
      game: game,
      mainGame: game,
      services: services,
      serviceIds: serviceIds,
      gamePrices: gamePrices,
      pricingUnit: String(raw.pricingUnit || raw.pricing_unit || "小时"),
      avatar: avatarSrc(raw.avatar || raw.cover || raw.cardImageUrl || ""),
      publicId: raw.publicId || "",
      level: level,
      levelId: levelId,
      online: online,
      availabilityStatus: presence ? presence.code : String(raw.availabilityStatus || "").toLowerCase() || "",
      availabilityText: presence ? presence.label : raw.availabilityText || (online ? "在线可接单" : "离线"),
    };
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
            return k === sid || (!/^[0-9a-f-]{36}$/i.test(k) && money(prices[k]) === money(prices[sid]) && money(prices[k]) > 0);
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
    if (!out.length && companion.service && !LEGACY_SERVICE_NAMES[companion.service]) {
      push({
        id: "name:" + companion.service,
        serviceId: "",
        name: companion.service,
        price: money(companion.unitPrice),
        pricingUnit: companion.pricingUnit || "小时",
        sort: 0,
      });
    }
    out.forEach(function (s) {
      if (!(s.price > 0)) {
        s.price = money(prices[s.name] || prices[s.serviceId] || prices[s.id] || companion.unitPrice || 0);
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
      if (money(svc.price) > 0) state.companion.unitPrice = money(svc.price);
      if (svc.pricingUnit) state.companion.pricingUnit = svc.pricingUnit;
      state.companion.service = svc.name;
    }
    var mask = activeMask();
    if (mask) {
      mask.querySelectorAll("[data-po-service]").forEach(function (btn) {
        var on = btn.getAttribute("data-po-service") === state.service;
        btn.classList.toggle("active", on);
        btn.setAttribute("aria-pressed", on ? "true" : "false");
      });
      var preview = mask.querySelector("[data-po-service-preview]");
      if (preview) preview.textContent = currentServiceLabel();
      var hero = mask.querySelector("[data-po-price-hero]");
      if (hero && state.companion) hero.textContent = moneyText(state.companion.unitPrice);
      var unitLabel = mask.querySelector(".mcj-po-price-row small");
      if (unitLabel && state.companion) unitLabel.textContent = "/ " + (state.companion.pricingUnit || "小时");
    }
    refreshTotals();
  }
  function remountServiceChips() {
    var mask = activeMask();
    if (!mask || !state.companion) return;
    var wrap = mask.querySelector(".mcj-po-chips[role='group']");
    if (!wrap) return;
    var services = resolveServices(state.companion);
    if (!services.length) {
      wrap.innerHTML = '<span class="mcj-po-empty-services" style="color:#9ca3af;font-size:13px">该陪玩暂无可下单服务项目</span>';
      return;
    }
    wrap.innerHTML = services
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
      .join("");
    wrap.querySelectorAll("[data-po-service]").forEach(function (btn) {
      btn.addEventListener("click", function (ev) {
        ev.preventDefault();
        var name = btn.getAttribute("data-po-service") || "";
        var list = resolveServices(state.companion);
        var svc = list.find(function (s) {
          return s.name === name;
        });
        if (svc) applySelectedService(svc);
      });
    });
    // hide legacy custom input if present
    var customWrap = mask.querySelector("[data-po-custom-service]");
    if (customWrap) customWrap.classList.remove("show");
  }
  function hydrateFromCatalog(companionId) {
    companionId = String(companionId || (state.companion && state.companion.companionId) || "").trim();
    if (!companionId) return Promise.resolve(null);
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
        if (!state.companion || String(state.companion.companionId) !== companionId) return body;
        var services = Array.isArray(body.services) ? body.services : [];
        var catC = body.companion || {};
        state.companion.services = services;
        if (catC.gamePrices || catC.game_prices) state.companion.gamePrices = catC.gamePrices || catC.game_prices;
        if (catC.serviceIds || catC.service_ids) state.companion.serviceIds = catC.serviceIds || catC.service_ids;
        var gameName = catC.game || catC.mainGame || "";
        if (gameName) {
          state.companion.game = gameName;
          state.companion.mainGame = gameName;
        }
        if (state.open) {
          remountServiceChips();
          var list = resolveServices(state.companion);
          var cur =
            list.find(function (s) {
              return s.name === state.service;
            }) || list[0];
          if (cur) applySelectedService(cur);
        }
        return body;
      })
      .catch(function () {
        return null;
      });
  }
  function matchService(service, companion) {
    var list = resolveServices(companion || state.companion || {});
    var s = String(service || "").trim();
    if (LEGACY_SERVICE_NAMES[s]) s = "";
    if (s) {
      for (var i = 0; i < list.length; i++) {
        if (list[i].name === s || s.indexOf(list[i].name) !== -1 || list[i].name.indexOf(s) !== -1) {
          return { service: list[i].name, custom: "", item: list[i] };
        }
      }
    }
    if (list[0]) return { service: list[0].name, custom: "", item: list[0] };
    return { service: "", custom: "", item: null };
  }
  function currentHours() {
    return Math.max(0.5, money(state.hours) || 1);
  }
  function currentServiceLabel() {
    return String(state.service || "").trim() || "未选择服务";
  }
  function currentQuantity() {
    return Math.max(1, Math.floor(money(state.quantity) || 1));
  }
  function totalAmount() {
    var c = state.companion;
    if (!c) return 0;
    return Math.round(money(c.unitPrice) * currentHours() * currentQuantity() * 100) / 100;
  }
  function requireLogin() {
    if (token()) return true;
    toast("请先登录老板账号后再下单");
    try {
      var cid = state.companion && state.companion.companionId;
      var back = cid
        ? "profile.html?id=" + encodeURIComponent(cid) + "&open_order=1"
        : location.href;
      sessionStorage.setItem("mcjAfterLoginRedirect", back);
    } catch (e) {}
    if (typeof window.loginRequiredModal === "function") {
      window.loginRequiredModal();
      return false;
    }
    if (window.MCJBossHeader && typeof window.MCJBossHeader.openLogin === "function") {
      window.MCJBossHeader.openLogin();
      return false;
    }
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
    if (activeMask()) paintPayCards();
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

    var companionServices = resolveServices(c);
    if (companionServices.length && !companionServices.some(function (s) { return s.name === state.service; })) {
      state.service = companionServices[0].name;
      state.selectedServiceId = companionServices[0].serviceId || companionServices[0].id || "";
      if (companionServices[0].price > 0) c.unitPrice = companionServices[0].price;
    }
    var serviceChips = companionServices.length
      ? companionServices.map(function (s) {
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
        }).join("")
      : '<span class="mcj-po-empty-services" data-po-services-loading style="color:#9ca3af;font-size:13px">正在读取该陪玩的服务项目…</span>';
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
      : '<p class="mcj-po-empty-services" style="color:#9ca3af;font-size:13px;margin:0">正在读取支付方式…</p>';

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
      '<span class="mcj-po-pill" data-level-id="' +
      esc(c.levelId || "") +
      '">' +
      esc(c.level || "未设置等级") +
      "</span>" +
      '<span class="mcj-po-pill' +
      (c.online ? " online" : "") +
      '">' +
      esc(c.availabilityText || (c.online ? "在线可接单" : "离线")) +
      "</span>" +
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
    mask.querySelectorAll("[data-po-service]").forEach(function (btn) {
      btn.addEventListener("click", function (ev) {
        ev.preventDefault();
        var name = btn.getAttribute("data-po-service") || "";
        var list = resolveServices(state.companion);
        var svc = list.find(function (s) {
          return s.name === name;
        }) || {
          name: name,
          serviceId: btn.getAttribute("data-po-service-id") || "",
          price: money(btn.getAttribute("data-po-service-price")),
          pricingUnit: (state.companion && state.companion.pricingUnit) || "小时",
        };
        applySelectedService(svc);
        setExclusiveActive(mask.querySelectorAll("[data-po-service]"), btn);
      });
    });
    mask.querySelectorAll("[data-po-hours]").forEach(function (btn) {
      btn.addEventListener("click", function (ev) {
        ev.preventDefault();
        ev.stopPropagation();
        var id = btn.getAttribute("data-po-hours");
        state.hoursMode = id;
        var meta = HOURS.find(function (h) {
          return h.id === id;
        });
        if (meta && !meta.custom) state.hours = meta.value;
        setExclusiveActive(mask.querySelectorAll("[data-po-hours]"), btn);
        var wrap = mask.querySelector("[data-po-custom-hours]");
        if (wrap) wrap.classList.toggle("show", id === "custom");
        refreshTotals();
      });
    });
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
        state.payment = btn.getAttribute("data-po-pay") || "";
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
      try {
        var list = [];
        try {
          list = JSON.parse(localStorage.getItem("mcjBossOrdersCache") || "[]");
          if (!Array.isArray(list)) list = [];
        } catch (eList) {
          list = [];
        }
        var row = Object.assign({}, order || {}, {
          id: oid,
          status: order && order.status ? order.status : "awaiting_payment",
          statusText: (order && order.statusText) || "待付款",
          createdAt: (order && (order.createdAt || order.created_at)) || new Date().toISOString(),
        });
        list = [row].concat(list.filter(function (x) { return String(x.id) !== String(oid); }));
        localStorage.setItem("mcjBossOrdersCache", JSON.stringify(list.slice(0, 80)));
      } catch (eCache) {}
      location.href = "orders.html?id=" + encodeURIComponent(oid);
      return;
    }
    location.href = "orders.html";
  }

  function goPaymentPage(order) {
    var oid = order && order.id ? order.id : "";
    close();
    if (oid) {
      try {
        var cachePayload = JSON.stringify({
          id: oid,
          status: "awaiting_payment",
          paymentMethod: state.payment,
          totalAmount: order.totalAmount || totalAmount(),
        });
        try {
          localStorage.setItem("mcjOrderCache:" + oid, cachePayload);
        } catch (e2) {}
        sessionStorage.setItem("mcjOrderCache:" + oid, cachePayload);
      } catch (e) {}
      location.href = "payment-confirm.html?order=" + encodeURIComponent(oid);
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
      if (!requireLogin()) return;
      var c = state.companion;
      if (!c || !c.companionId) {
        failValidate("缺少陪玩信息，无法下单");
        return;
      }
      var svcList = resolveServices(c);
      if (!svcList.length) {
        failValidate("该陪玩暂无可下单服务项目");
        return;
      }
      if (!state.service || !svcList.some(function (s) { return s.name === state.service; })) {
        failValidate("请选择游戏/服务项目");
        return;
      }
      if (!(money(c.unitPrice) > 0)) {
        failValidate("当前单价无效，请刷新页面后重试");
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
      if (state.service === "自定义" && !String(state.customService || "").trim()) {
        failValidate("请填写自定义服务内容", "[data-po-custom-service-input]");
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
          failValidate("猫粮余额不足，请改用其他支付方式或先充值");
          return;
        }
      }

      state.submitting = true;
      state.submitStartedAt = Date.now();
      setError("");
      setSubmitLoading(true);
      console.info("[MCJPlaceOrder] submit start", {
        companionId: c.companionId,
        payment: payment,
        total: total,
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
        companionName: c.companionName,
        serviceType: currentServiceLabel(),
        service: currentServiceLabel(),
        game: currentServiceLabel(),
        unitPrice: money(c.unitPrice),
        hours: hours,
        quantity: quantity,
        totalAmount: total,
        gameId: gameId,
        region: region,
        schedule: schedule,
        couponCode: state.couponCode || "",
        contact: contact,
        notes: noteParts.join("；"),
        paymentMethod: payment,
        idempotencyKey:
          "po-" + c.companionId + "-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
      };

      fetch("/api/orders", {
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
        })
        .catch(function (err) {
          state.submitting = false;
          state.submitStartedAt = 0;
          setSubmitLoading(false);
          console.error("[MCJPlaceOrder] submit failed", err);
          var msg = String((err && err.message) || "");
          if (err && (err.code === "INSUFFICIENT_BALANCE" || /余额不足|猫粮/.test(msg))) {
            failValidate(msg || "猫粮余额不足");
            toast((msg || "猫粮余额不足") + "，可前往充值页");
            return;
          }
          if (/登录|401|未登录|老板账号/.test(msg)) {
            requireLogin();
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
    var bootServices = resolveServices(companion);
    if (!(companion.unitPrice > 0) && bootServices[0] && bootServices[0].price > 0) {
      companion.unitPrice = bootServices[0].price;
    }
    if (!(companion.unitPrice > 0) && !bootServices.length) {
      // Allow open; hydrateFromCatalog may still bring prices.
      companion.unitPrice = companion.unitPrice || 0;
    } else if (!(companion.unitPrice > 0)) {
      failOpen("该陪玩暂无有效单价，暂不可下单");
      console.error("[MCJPlaceOrder] invalid unitPrice", companion);
      return;
    }
    state.companion = companion;
    var matched = matchService(companion.service, companion);
    state.service = matched.service;
    state.customService = "";
    state.selectedServiceId = (matched.item && (matched.item.serviceId || matched.item.id)) || "";
    if (matched.item && matched.item.price > 0) companion.unitPrice = matched.item.price;
    state.hoursMode = "1";
    state.hours = 1;
    state.quantity = 1;
    state.couponCode = "";
    state.payment = state.payMethods[0] ? state.payMethods[0].id : "";
    state.submitting = false;
    state.submitStartedAt = 0;
    try {
      paint();
      hydrateFromCatalog(companion.companionId);
    } catch (err) {
      console.error("[MCJPlaceOrder] paint crashed", err);
      failOpen("下单窗口加载失败，请重新打开");
    }
  }

  function openFromCanonicalCompanion(src, extras) {
    extras = extras || {};
    src = src && typeof src === "object" ? src : {};
    var companionId = String(
      extras.companionId || src.companionId || src.companion_id || src.id || src.uid || ""
    ).trim();
    var companionName = String(
      extras.companionName || src.companionName || src.companion_name || src.nickname || src.name || "陪玩"
    ).trim();
    var unitPrice =
      extras.unitPrice != null
        ? extras.unitPrice
        : src.unitPrice != null
          ? src.unitPrice
          : src.priceValue != null
            ? src.priceValue
            : src.price != null
              ? src.price
              : src.hourlyPrice;

    // Soft update: catalog refresh must NOT remount and wipe filled fields / kill submit.
    if (state.open && state.companion && String(state.companion.companionId) === companionId) {
      if (state.submitting) return;
      var nextPrice = money(unitPrice);
      if (nextPrice > 0) state.companion.unitPrice = nextPrice;
      if (companionName) state.companion.companionName = companionName;
      if (extras.avatar || src.avatar || src.cover) {
        state.companion.avatar = extras.avatar || src.avatar || src.cover || state.companion.avatar;
      }
      if (extras.publicId || src.publicId) state.companion.publicId = extras.publicId || src.publicId || state.companion.publicId;
      if (extras.pricingUnit || src.pricingUnit) {
        state.companion.pricingUnit = extras.pricingUnit || src.pricingUnit || state.companion.pricingUnit;
      }
      if (Array.isArray(extras.services) || Array.isArray(src.services)) {
        state.companion.services = extras.services || src.services || state.companion.services;
      }
      if (extras.serviceIds || extras.service_ids || src.serviceIds || src.service_ids) {
        state.companion.serviceIds = extras.serviceIds || extras.service_ids || src.serviceIds || src.service_ids;
      }
      if (extras.gamePrices || extras.game_prices || src.gamePrices || src.game_prices) {
        state.companion.gamePrices = extras.gamePrices || extras.game_prices || src.gamePrices || src.game_prices;
      }
      if (extras.levelId || extras.level_id || src.levelId || src.level_id) {
        state.companion.levelId = extras.levelId || extras.level_id || src.levelId || src.level_id;
      }
      if (extras.level || src.level || src.levelName) {
        state.companion.level = extras.level || src.level || src.levelName || state.companion.level;
      }
      var gameName = extras.game || src.game || src.mainGame || extras.service || "";
      if (gameName && !LEGACY_SERVICE_NAMES[gameName]) {
        state.companion.game = gameName;
        state.companion.mainGame = gameName;
      }
      remountServiceChips();
      // Soft update must refresh header level pill without remounting the whole dialog.
      try {
        var pill = document.querySelector('.mcj-po-mask .mcj-po-pill[data-level-id]');
        if (pill && state.companion) {
          pill.setAttribute("data-level-id", state.companion.levelId || "");
          pill.textContent = state.companion.level || "未设置等级";
        }
      } catch (e) {}
      var matched = matchService(extras.service || src.service || src.game || state.companion.service, state.companion);
      if (matched.item) applySelectedService(matched.item);
      else {
        refreshTotals();
        paintPayCards();
      }
      return;
    }

    open({
      companionId: companionId,
      id: companionId,
      uid: companionId,
      companionName: companionName,
      name: companionName,
      unitPrice: unitPrice,
      priceValue: unitPrice,
      price: unitPrice,
      service: extras.service || src.service || src.game || src.mainGame || "",
      game: extras.game || src.game || src.mainGame || extras.service || "",
      mainGame: extras.game || src.game || src.mainGame || "",
      services: extras.services || src.services || [],
      serviceIds: extras.serviceIds || extras.service_ids || src.serviceIds || src.service_ids || [],
      gamePrices: extras.gamePrices || extras.game_prices || src.gamePrices || src.game_prices || {},
      avatar: extras.avatar || src.avatar || src.cover || "",
      publicId: extras.publicId || src.publicId || "",
      pricingUnit: extras.pricingUnit || src.pricingUnit || "小时",
      levelId: extras.levelId || extras.level_id || src.levelId || src.level_id || "",
      level: extras.level || src.level || src.levelName || "",
      levelName: extras.levelName || src.levelName || extras.level || src.level || "",
      online: extras.online != null ? extras.online : src.online != null ? src.online : src.isOnline,
      availabilityStatus: extras.availabilityStatus || src.availabilityStatus || "",
      availabilityText: extras.availabilityText || src.availabilityText || "",
    });
  }

  function openFromProfileCompanion(companion, extras) {
    extras = extras || {};
    var src = companion && typeof companion === "object" ? companion : {};
    // Always open immediately with known payload — never leave 立即下单 looking dead.
    openFromCanonicalCompanion(src, extras);
    var companionId = String(
      extras.companionId || src.companionId || src.companion_id || src.id || src.uid || ""
    ).trim();
    if (!companionId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(companionId)) {
      return;
    }
    // Soft refresh from the same public companion record used by home / hall / detail.
    fetch("/api/public/companions?id=" + encodeURIComponent(companionId), {
      headers: { Accept: "application/json" },
      cache: "no-store",
    })
      .then(function (res) {
        return res.json().then(function (body) {
          if (!res.ok || !body || body.ok === false) throw new Error((body && body.message) || "陪玩资料读取失败");
          var list = Array.isArray(body.companions) ? body.companions : body.companion ? [body.companion] : [];
          var row = list[0] || null;
          if (!row) throw new Error("陪玩资料不存在");
          return row;
        });
      })
      .then(function (row) {
        var merged = Object.assign({}, extras, {
          services: extras.services || row.services || [],
          serviceIds: extras.serviceIds || row.serviceIds || row.service_ids || [],
          gamePrices: extras.gamePrices || row.gamePrices || row.game_prices || {},
          game: extras.game || row.game || row.mainGame || "",
          service: extras.service || (row.services && row.services[0] && row.services[0].name) || row.game || "",
        });
        openFromCanonicalCompanion(row, merged);
        hydrateFromCatalog(companionId);
      })
      .catch(function () {
        hydrateFromCatalog(companionId);
      });
  }

  window.MCJ_PAY_SOT_VERSION = '20260809paySotRoot1';
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
    resolveServices: resolveServices,
    applySelectedService: applySelectedService,
    hydrateFromCatalog: hydrateFromCatalog,
  };

  window.addEventListener("popstate", function () {
    if (state.open) close({ fromPop: true });
  });
})();
