(function () {
  "use strict";

  var GAME_PLACEHOLDER = "/gameplay-cover-placeholder.jpg";

  var state = {
    product: null,
    loading: true,
    error: "",
    busy: false,
    message: "",
    packageId: "",
    quantity: 1,
    startTime: "",
    gameId: "",
    server: "",
    remark: "",
    couponCode: "",
    couponDiscount: 0,
    couponHint: "",
    payment: "",
    payMethods: [],
  };

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function productId() {
    return new URLSearchParams(location.search).get("id") || "";
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
      return looksLikeJwt(fromBoss) ? fromBoss : "";
    }
    var candidates = [
      sessionStorage.getItem("mcjAuthAccessToken"),
      localStorage.getItem("mcjAuthAccessToken"),
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

  function applyOrderPayMethods(body) {
    // Sole SoT: GET /api/recharge → orderPayMethods. No methods[] reconstruct / no hardcode.
    var list = Array.isArray(body && body.orderPayMethods) ? body.orderPayMethods : [];
    state.payMethods = list
      .filter(function (m) {
        return m && (m.id || m.code) && m.open !== false;
      })
      .map(function (m) {
        return { id: m.id || m.code, label: m.label || m.name || m.code || m.id };
      });
    if (!state.payMethods.some(function (p) { return p.id === state.payment; })) {
      state.payment = state.payMethods[0] ? state.payMethods[0].id : "";
    }
  }

  function refreshPayMethods(attempt) {
    var tryCount = attempt || 0;
    function runFetch() {
      if (!token()) {
        state.payMethods = [];
        return Promise.resolve([]);
      }
      return fetch("/api/recharge", { method: "GET", headers: authHeaders(), cache: "no-store" })
        .then(function (res) {
          return res.json().then(function (body) {
            if (!res.ok || body.ok === false) throw new Error(body.message || "支付方式读取失败");
            applyOrderPayMethods(body);
            return state.payMethods;
          });
        })
        .catch(function () {
          if (tryCount < 1) {
            return new Promise(function (resolve) {
              setTimeout(function () {
                resolve(refreshPayMethods(tryCount + 1));
              }, 600);
            });
          }
          return state.payMethods;
        });
    }
    if (window.MCJBossAuth && typeof window.MCJBossAuth.ensureSession === "function") {
      return window.MCJBossAuth.ensureSession().then(runFetch).catch(runFetch);
    }
    return runFetch();
  }

  function packagesOf(p) {
    var list = (p && Array.isArray(p.packages) ? p.packages : []).filter(function (x) {
      return x && Number(x.price) >= 0 && String(x.name || "").trim();
    });
    if (list.length) return list;
    if (p && Number(p.price) > 0) {
      return [{ id: "default", name: "标准套餐", price: Number(p.price), unit: p.pricingUnit || "每单" }];
    }
    return [];
  }

  function currentPackage() {
    var list = packagesOf(state.product);
    if (!list.length) return null;
    return list.find(function (x) { return String(x.id) === String(state.packageId); }) || list[0];
  }

  function unitPrice() {
    var pkg = currentPackage();
    return pkg ? Math.max(0, Number(pkg.price) || 0) : Math.max(0, Number(state.product && state.product.price) || 0);
  }

  function qty() {
    return Math.max(1, Math.min(99, Math.floor(Number(state.quantity) || 1)));
  }

  function subtotal() {
    return Math.round(unitPrice() * qty() * 100) / 100;
  }

  function discount() {
    return Math.max(0, Math.min(subtotal(), Math.round(Number(state.couponDiscount) || 0)));
  }

  function payable() {
    return Math.round((subtotal() - discount()) * 100) / 100;
  }

  function catFood(n) {
    var v = Number(n) || 0;
    if (window.MCJCurrency && window.MCJCurrency.formatPlain) return window.MCJCurrency.formatPlain(v);
    return (Number.isFinite(v) ? v : 0).toFixed(2).replace(/\.00$/, "") + " 猫粮";
  }

  function defaultStartTime() {
    var d = new Date(Date.now() + 60 * 60 * 1000);
    d.setMinutes(0, 0, 0);
    var pad = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  function safeCoverUrl(p) {
    var url = String((p && p.coverUrl) || "").trim();
    if (!url) return GAME_PLACEHOLDER;
    if (/default-avatar|dummy|sample.?avatar|test.?avatar|meow-cuijiao-brand/i.test(url)) return GAME_PLACEHOLDER;
    if (/placeholder/i.test(url) && !/gameplay-cover-placeholder/i.test(url)) return GAME_PLACEHOLDER;
    return url;
  }

  function coverHtml(p) {
    var url = safeCoverUrl(p);
    return (
      '<div class="gameplay-product-cover">' +
      '<img class="gameplay-product-cover-img" data-mcj-product-cover="1" src="' + esc(url) + '" alt="' + esc(p.name || "商品封面") + '" ' +
      'onerror="this.onerror=null;this.setAttribute(\'data-mcj-product-cover\',\'1\');this.src=\'' + GAME_PLACEHOLDER + '\';">' +
      "</div>"
    );
  }

  function parseSections(p) {
    var desc = String((p && p.description) || "").trim();
    var shortIntro = String((p && p.shortDescription) || "").trim();
    var rules = String((p && p.rules) || "").trim();
    var content = "";
    var flow = "";
    var notes = "";

    function take(label) {
      var re = new RegExp(label + "[：:]\\s*([\\s\\S]*?)(?=(?:服务内容|服务流程|注意事项|服务规则)[：:]|$)");
      var m = desc.match(re);
      return m ? String(m[1] || "").trim() : "";
    }

    content = take("服务内容");
    flow = take("服务流程");
    notes = take("注意事项") || take("服务规则");

    var intro = shortIntro;
    if (!intro) {
      if (content) intro = content;
      else if (desc) intro = desc.split(/\n+/).slice(0, 3).join("\n");
      else intro = "暂无商品简介";
    }

    if (!content) {
      content = desc || shortIntro || "以客服确认的服务内容为准。";
    }
    if (!flow) {
      flow = "确认需求与时间 → 客服派单 → 陪玩联系 → 开始服务。";
    }
    if (!rules) {
      rules = notes || "下单后由客服安排陪玩，请保持联系畅通。";
    }

    return { intro: intro, content: content, flow: flow, rules: rules };
  }

  function renderTotals() {
    var sub = document.querySelector("[data-gp-subtotal]");
    var disc = document.querySelector("[data-gp-discount]");
    var pay = document.querySelector("[data-gp-payable]");
    var unit = document.querySelector("[data-gp-unit-price]");
    if (sub) sub.textContent = catFood(subtotal());
    if (disc) disc.textContent = "-" + catFood(discount());
    if (pay) pay.textContent = catFood(payable());
    if (unit) unit.textContent = catFood(unitPrice());
  }

  function render() {
    var box = document.getElementById("gpDetail");
    if (!box) return;

    if (state.loading) {
      box.innerHTML = '<div class="gameplay-product-empty"><strong>正在读取商品详情…</strong></div>';
      return;
    }

    if (state.error || !state.product) {
      box.innerHTML =
        '<div class="gameplay-product-empty">' +
        "<strong>商品不存在或已下架</strong>" +
        "<p>" + esc(state.error || "请返回商城选择其他商品") + "</p>" +
        '<a href="more-gameplays.html">返回更多玩法</a>' +
        "</div>";
      return;
    }

    var p = state.product;
    var pkgs = packagesOf(p);
    if (!state.packageId && pkgs[0]) state.packageId = pkgs[0].id;
    var showServer = p.showServer !== false;
    var sections = parseSections(p);

    var pkgHtml = pkgs
      .map(function (item) {
        var on = String(item.id) === String(state.packageId);
        var unitLabel = item.unit || p.pricingUnit || "每单";
        return (
          '<button type="button" class="gameplay-package-btn' + (on ? " is-active" : "") + '" data-gp-package="' + esc(item.id) + '">' +
          "<strong>" + esc(item.name) + "</strong>" +
          "<em>" + esc(catFood(item.price)) + " / " + esc(unitLabel) + "</em>" +
          "</button>"
        );
      })
      .join("");

    box.innerHTML =
      '<section class="gameplay-product-info" aria-label="商品信息">' +
      coverHtml(p) +
      '<p class="gameplay-product-game">' + esc(p.gamesText || p.category || "妙脆角玩法") + "</p>" +
      "<h1>" + esc(p.name) + "</h1>" +
      '<p class="gameplay-product-intro">' + esc(sections.intro) + "</p>" +
      '<article class="gameplay-product-section"><h2>服务内容</h2><p>' + esc(sections.content) + "</p></article>" +
      '<article class="gameplay-product-section"><h2>服务流程</h2><p>' + esc(sections.flow) + "</p></article>" +
      '<article class="gameplay-product-section"><h2>服务规则</h2><p>' + esc(sections.rules) + "</p></article>" +
      "</section>" +
      '<form class="gameplay-order-card" data-gp-order-form aria-label="下单卡片">' +
      "<h2>确认下单</h2>" +
      '<div class="gameplay-order-meta">' +
      '<div class="gameplay-order-meta-row"><span>商品名称</span><strong>' + esc(p.name) + "</strong></div>" +
      '<div class="gameplay-order-meta-row"><span>当前单价</span><strong data-gp-unit-price>' + esc(catFood(unitPrice())) + "</strong></div>" +
      "</div>" +
      '<div class="gameplay-product-field"><span>套餐选择</span>' +
      '<div class="gameplay-package-list">' +
      (pkgHtml || '<div class="gameplay-product-msg">暂无可选套餐</div>') +
      "</div>" +
      '<input type="hidden" name="packageId" value="' + esc(state.packageId) + '">' +
      "</div>" +
      '<div class="gameplay-product-field"><span>数量</span><div class="gameplay-qty-row">' +
      '<button type="button" data-gp-qty="-1" aria-label="减少">−</button>' +
      '<input name="quantity" type="number" min="1" max="99" value="' + esc(qty()) + '">' +
      '<button type="button" data-gp-qty="1" aria-label="增加">+</button></div></div>' +
      '<div class="gameplay-product-field"><span>开始时间</span>' +
      '<input name="startTime" type="datetime-local" value="' + esc(state.startTime || defaultStartTime()) + '" required></div>' +
      '<div class="gameplay-product-field"><span>游戏ID <i class="req">*</i></span>' +
      '<input id="gpGameId" name="gameId" type="text" maxlength="64" placeholder="请填写游戏 ID" value="' + esc(state.gameId) + '" required autocomplete="off"></div>' +
      (showServer
        ? '<div class="gameplay-product-field"><span>区服</span><input name="server" type="text" maxlength="64" placeholder="例如：亚服 / 国服" value="' + esc(state.server) + '"></div>'
        : "") +
      '<div class="gameplay-product-field"><span>备注</span>' +
      '<textarea name="remark" rows="3" placeholder="段位目标、联系方式偏好等">' + esc(state.remark) + "</textarea></div>" +
      '<div class="gameplay-product-field"><span>优惠码</span>' +
      '<div class="gameplay-coupon-row"><input name="couponCode" type="text" maxlength="40" placeholder="可选" value="' + esc(state.couponCode) + '">' +
      '<button type="button" data-gp-apply-coupon>使用</button></div>' +
      (state.couponHint ? '<small class="gameplay-product-hint">' + esc(state.couponHint) + "</small>" : "") +
      "</div>" +
      '<div class="gameplay-product-field"><span>支付方式 <i class="req">*</i></span>' +
      '<div class="gameplay-pay-methods" data-gp-pay-grid role="group">' +
      (state.payMethods.length
        ? state.payMethods
            .map(function (m) {
              return (
                '<button type="button" class="gameplay-package-btn' +
                (state.payment === m.id ? " is-active" : "") +
                '" data-gp-pay="' +
                esc(m.id) +
                '"><strong>' +
                esc(m.label) +
                "</strong></button>"
              );
            })
            .join("")
        : '<small class="gameplay-product-hint">暂无可用支付方式，请联系管理员在后台启用</small>') +
      "</div></div>" +
      '<div class="gameplay-product-totals">' +
      '<div><span>小计</span><strong data-gp-subtotal>' + esc(catFood(subtotal())) + "</strong></div>" +
      '<div><span>优惠金额</span><strong data-gp-discount>-' + esc(catFood(discount())) + "</strong></div>" +
      '<div class="gameplay-pay"><span>实付金额</span><strong data-gp-payable>' + esc(catFood(payable())) + "</strong></div>" +
      "</div>" +
      (state.message ? '<div class="gameplay-product-msg" role="alert">' + esc(state.message) + "</div>" : "") +
      '<button class="gameplay-submit-btn" type="submit" data-gp-submit' + (state.busy || !pkgs.length ? " disabled" : "") + ">" +
      (state.busy ? "提交中…" : "立即下单") +
      "</button>" +
      '<a class="gameplay-back-link" href="more-gameplays.html">返回更多玩法</a>' +
      "</form>";
  }

  function load() {
    var id = productId();
    if (!id) {
      state.loading = false;
      state.error = "缺少商品 ID";
      render();
      return;
    }
    state.loading = true;
    render();
    fetch("/api/platform/gameplay-products?id=" + encodeURIComponent(id), {
      headers: { Accept: "application/json" },
      cache: "no-store",
    })
      .then(function (res) {
        return res.json().then(function (body) {
          if (!res.ok || body.ok === false) throw new Error(body.message || "商品不存在或已下架");
          return body;
        });
      })
      .then(function (body) {
        var p = body.product || null;
        if (!p || /test|preview|demo|mock|验收/i.test(String(p.name || "") + String(p.id || ""))) {
          throw new Error("商品不存在或已下架");
        }
        state.product = p;
        state.error = "";
        var pkgs = packagesOf(p);
        state.packageId = pkgs[0] ? pkgs[0].id : "";
        if (!state.startTime) state.startTime = defaultStartTime();
      })
      .catch(function (err) {
        state.product = null;
        state.error = err.message || "商品不存在或已下架";
      })
      .finally(function () {
        state.loading = false;
        render();
        refreshPayMethods().then(function () {
          if (!state.loading) render();
        });
      });
  }

  function requireLogin() {
    if (token()) return true;
    var redirect = location.pathname + location.search;
    location.href = "/index.html?login=1&redirect=" + encodeURIComponent(redirect);
    return false;
  }

  function collectForm(form) {
    var fd = new FormData(form);
    state.packageId = String(fd.get("packageId") || state.packageId || "");
    state.quantity = Math.max(1, Math.min(99, Math.floor(Number(fd.get("quantity") || 1))));
    state.startTime = String(fd.get("startTime") || "").trim();
    state.gameId = String(fd.get("gameId") || "").trim();
    state.server = String(fd.get("server") || "").trim();
    state.remark = String(fd.get("remark") || "").trim();
    state.couponCode = String(fd.get("couponCode") || "").trim();
  }

  function applyCoupon() {
    var code = String(state.couponCode || "").trim();
    if (!code) {
      state.couponDiscount = 0;
      state.couponHint = "";
      renderTotals();
      return;
    }
    state.couponDiscount = 0;
    state.couponHint = "优惠码无效或暂不适用于该商品";
    var hint = document.querySelector(".gameplay-product-hint");
    if (hint) hint.textContent = state.couponHint;
    else render();
    renderTotals();
  }

  function placeOrder(form) {
    if (!state.product || state.busy) return;
    collectForm(form);
    if (!packagesOf(state.product).length) {
      state.message = "该商品暂无可下单套餐";
      render();
      return;
    }
    if (!state.gameId) {
      state.message = "请填写游戏 ID";
      render();
      var el = document.getElementById("gpGameId");
      if (el) el.focus();
      return;
    }
    if (!state.startTime) {
      state.message = "请选择开始时间";
      render();
      return;
    }
    if (!state.payment) {
      state.message = "请选择支付方式";
      render();
      return;
    }
    if (!requireLogin()) return;

    var pkg = currentPackage();
    var p = state.product;
    var quantity = qty();
    var unitPriceValue = unitPrice();
    var totalAmount = payable();
    var unit = (pkg && pkg.unit) || p.pricingUnit || "每单";
    var hours = /小时|hr|hour/i.test(unit) ? quantity : Math.max(1, quantity);

    state.busy = true;
    state.message = "正在创建订单…";
    render();

    var description = [
      "更多玩法商品：" + (p.name || ""),
      "商品ID：" + (p.id || ""),
      "套餐：" + ((pkg && pkg.name) || "标准套餐"),
      "分类：" + (p.category || ""),
      "游戏：" + (p.gamesText || ""),
      "游戏ID：" + state.gameId,
      state.server ? "区服：" + state.server : "",
      "数量：" + quantity + " × " + unit,
      "开始时间：" + state.startTime,
      state.couponCode ? "优惠码：" + state.couponCode : "",
      discount() ? "优惠金额：" + discount() + " 猫粮" : "",
      state.remark ? "备注：" + state.remark : "",
    ]
      .filter(Boolean)
      .join("\n");

    fetch("/api/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: "Bearer " + token(),
        "x-mcj-access-token": token(),
      },
      body: JSON.stringify({
        action: "create",
        order: {
          order_type: "gameplay_product",
          title: p.name || "更多玩法订单",
          game: p.gamesText || p.category || "更多玩法",
          serviceType: (pkg && pkg.name) || p.name || p.category || "更多玩法",
          service_type: (pkg && pkg.name) || p.name || p.category || "更多玩法",
          description: description,
          notes: state.remark,
          gameId: state.gameId,
          game_id: state.gameId,
          server: state.server,
          hours: hours,
          quantity: quantity,
          unit_price: unitPriceValue,
          unitPrice: unitPriceValue,
          total_amount: totalAmount,
          totalAmount: totalAmount,
          pricingUnit: unit,
          gameplay_product_id: p.id,
          productId: p.id,
          packageId: pkg && pkg.id,
          packageName: pkg && pkg.name,
          couponCode: state.couponCode,
          discountAmount: discount(),
          paymentMethod: state.payment,
          startTime: state.startTime,
        },
      }),
    })
      .then(function (res) {
        return res.json().then(function (body) {
          if (!res.ok || body.ok === false) throw new Error(body.message || "订单创建失败");
          return body;
        });
      })
      .then(function (body) {
        var order = body.order || {};
        var oid = order.id || order.orderId || "";
        if (!oid) throw new Error("订单已创建，但缺少订单 ID");
        location.href = "payment-confirm.html?order=" + encodeURIComponent(oid);
      })
      .catch(function (err) {
        state.busy = false;
        state.message = err.message || "订单创建失败，请稍后重试";
        render();
      });
  }

  document.addEventListener("click", function (e) {
    var pkgBtn = e.target.closest("[data-gp-package]");
    if (pkgBtn) {
      e.preventDefault();
      var nextPkg = pkgBtn.getAttribute("data-gp-package") || "";
      state.couponDiscount = 0;
      state.couponHint = state.couponCode ? "套餐已变更，请重新确认优惠码" : "";
      var form = document.querySelector("[data-gp-order-form]");
      // collectForm 会读到旧的 hidden packageId；先同步其它字段，再强制套用点击的套餐。
      if (form) collectForm(form);
      state.packageId = nextPkg;
      var hiddenPkg = form && form.querySelector('input[name="packageId"]');
      if (hiddenPkg) hiddenPkg.value = nextPkg;
      render();
      return;
    }

    var payBtn = e.target.closest("[data-gp-pay]");
    if (payBtn) {
      e.preventDefault();
      state.payment = payBtn.getAttribute("data-gp-pay") || "";
      var grid = document.querySelector("[data-gp-pay-grid]");
      if (grid) {
        grid.querySelectorAll("[data-gp-pay]").forEach(function (btn) {
          btn.classList.toggle("is-active", btn === payBtn);
        });
      }
      return;
    }

    var qtyBtn = e.target.closest("[data-gp-qty]");
    if (qtyBtn) {
      e.preventDefault();
      var delta = Number(qtyBtn.getAttribute("data-gp-qty") || 0);
      state.quantity = Math.max(1, Math.min(99, qty() + delta));
      var input = document.querySelector('input[name="quantity"]');
      if (input) input.value = String(state.quantity);
      renderTotals();
      return;
    }

    if (e.target.closest("[data-gp-apply-coupon]")) {
      e.preventDefault();
      var couponForm = document.querySelector("[data-gp-order-form]");
      if (couponForm) collectForm(couponForm);
      applyCoupon();
    }
  });

  document.addEventListener("input", function (e) {
    if (!e.target || !e.target.closest || !e.target.closest("[data-gp-order-form]")) return;
    if (e.target.name === "quantity") {
      state.quantity = Math.max(1, Math.min(99, Math.floor(Number(e.target.value) || 1)));
      renderTotals();
    }
    if (e.target.name === "startTime") state.startTime = e.target.value || "";
    if (e.target.name === "gameId") state.gameId = e.target.value || "";
    if (e.target.name === "server") state.server = e.target.value || "";
    if (e.target.name === "remark") state.remark = e.target.value || "";
    if (e.target.name === "couponCode") state.couponCode = e.target.value || "";
  });

  document.addEventListener("submit", function (e) {
    if (!e.target || !e.target.matches || !e.target.matches("[data-gp-order-form]")) return;
    e.preventDefault();
    placeOrder(e.target);
  });

  load();
})();
