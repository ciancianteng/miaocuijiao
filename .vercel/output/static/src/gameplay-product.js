(function () {
  "use strict";

  var GAME_PLACEHOLDER = "/gameplay-cover-placeholder.jpg";

  var state = {
    product: null,
    reviews: [],
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
  };

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function productId() {
    return new URLSearchParams(location.search).get("id") || "";
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

  function parseSections(p) {
    var desc = String((p && p.description) || "").trim();
    var shortIntro = String((p && p.shortDescription) || "").trim();
    var rules = String((p && p.rules) || "").trim();
    var content = "";
    var notes = "";

    function take(label) {
      var re = new RegExp(label + "[：:]\\s*([\\s\\S]*?)(?=(?:服务内容|服务流程|注意事项|服务规则)[：:]|$)");
      var m = desc.match(re);
      return m ? String(m[1] || "").trim() : "";
    }

    content = take("服务内容");
    notes = take("注意事项") || take("服务规则");

    var intro = shortIntro;
    if (!intro) {
      if (content) intro = content.split(/\n+/)[0];
      else if (desc) intro = desc.split(/\n+/).slice(0, 2).join("\n");
      else intro = "专业玩法服务，客服派单后陪玩联系您开始服务。";
    }

    if (!content) content = desc || shortIntro || "以客服确认的服务内容为准。";
    if (!rules) rules = notes || "下单后由客服安排陪玩，请保持联系畅通。";

    return { intro: intro, content: content, rules: rules };
  }

  function textToBullets(text) {
    var lines = String(text || "")
      .split(/\r?\n/)
      .map(function (line) {
        return String(line || "")
          .replace(/^[\s•·\-\*●○▪▫]+/, "")
          .replace(/^\d+[\.\)、]\s*/, "")
          .trim();
      })
      .filter(Boolean);
    if (!lines.length) return '<p class="gp-muted">' + esc(text || "暂无说明") + "</p>";
    if (lines.length === 1 && lines[0].length > 80) return '<p class="gp-muted">' + esc(lines[0]) + "</p>";
    return '<ul class="gp-pd-bullets">' + lines.map(function (line) { return "<li>" + esc(line) + "</li>"; }).join("") + "</ul>";
  }

  function canDirectOrder() {
    var p = state.product;
    if (!p || p.fixedPrice === false) return false;
    if (!packagesOf(p).length) return false;
    return unitPrice() > 0 && payable() > 0;
  }

  function primaryCtaLabel() {
    if (state.busy) return "提交中…";
    return "立即下单";
  }

  function consultDraft() {
    var p = state.product;
    if (!p) return "";
    var pkg = currentPackage();
    return [
      "【玩法咨询】想了解以下商品详情与报价",
      "商品：" + (p.name || ""),
      "商品ID：" + (p.id || ""),
      pkg ? "意向套餐：" + pkg.name + "（参考 " + catFood(unitPrice()) + "）" : "",
      "游戏：" + (p.gamesText || p.category || ""),
      state.gameId ? "游戏ID：" + state.gameId : "",
      state.server ? "区服：" + state.server : "",
      state.remark ? "备注：" + state.remark : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  function orderDraft() {
    var p = state.product;
    var pkg = currentPackage();
    var quantity = qty();
    var unit = (pkg && pkg.unit) || (p && p.pricingUnit) || "每单";
    return [
      "【更多玩法下单】请客服创建订单并放进抢单大厅",
      "商品：" + (p.name || ""),
      "商品ID：" + (p.id || ""),
      "套餐：" + ((pkg && pkg.name) || "标准套餐"),
      "分类：" + (p.category || ""),
      "游戏：" + (p.gamesText || ""),
      "游戏ID：" + state.gameId,
      state.server ? "区服：" + state.server : "",
      "数量：" + quantity + " × " + unit,
      "参考单价：" + catFood(unitPrice()),
      "参考实付：" + catFood(payable()),
      "开始时间：" + state.startTime,
      state.couponCode ? "优惠码：" + state.couponCode : "",
      state.remark ? "备注：" + state.remark : "",
      "流程：客服创建订单 → 抢单大厅 → 陪玩抢单 → 客服指定 → 老板确认 → 开始",
    ]
      .filter(Boolean)
      .join("\n");
  }

  function supportUrl(draft) {
    var params = new URLSearchParams();
    params.set("start", "1");
    params.set("from", "gameplay");
    params.set("productId", String((state.product && state.product.id) || productId()));
    params.set("draft", draft);
    params.set("aftersale", "0");
    return "support.html?" + params.toString();
  }

  function renderTotals() {
    document.querySelectorAll("[data-gp-subtotal]").forEach(function (el) {
      el.textContent = catFood(subtotal());
    });
    document.querySelectorAll("[data-gp-discount]").forEach(function (el) {
      el.textContent = "-" + catFood(discount());
    });
    document.querySelectorAll("[data-gp-payable]").forEach(function (el) {
      el.textContent = catFood(payable());
    });
    document.querySelectorAll("[data-gp-unit-price]").forEach(function (el) {
      el.textContent = catFood(unitPrice());
    });
    document.querySelectorAll("[data-gp-qty-display]").forEach(function (el) {
      el.textContent = String(qty());
    });
    var submit = document.querySelector("[data-gp-submit]");
    if (submit) {
      submit.disabled = !!state.busy || !packagesOf(state.product).length;
      submit.textContent = primaryCtaLabel();
    }
  }

  function orderFormHtml(p, pkgs, showServer) {
    return (
      '<div class="gp-pd-order-head"><h2>填写游戏资料下单</h2><p class="gp-muted">' +
      (canDirectOrder() ? "确认套餐后填写资料并前往支付。" : "客服将为您匹配陪玩并创建订单。") +
      "</p></div>" +
      '<input type="hidden" name="packageId" value="' + esc(state.packageId) + '">' +
      '<div class="gp-pd-field gp-pd-field-inline"><span>数量</span><div class="gp-pd-qty">' +
      '<button type="button" data-gp-qty="-1" aria-label="减少">−</button>' +
      '<input name="quantity" type="number" min="1" max="99" value="' + esc(qty()) + '" inputmode="numeric">' +
      '<button type="button" data-gp-qty="1" aria-label="增加">+</button></div></div>' +
      '<div class="gp-pd-field"><span>预计开始时间</span>' +
      '<input name="startTime" type="datetime-local" value="' + esc(state.startTime || defaultStartTime()) + '" required></div>' +
      '<div class="gp-pd-field"><span>游戏 ID <i class="req">*</i></span>' +
      '<input id="gpGameId" name="gameId" type="text" maxlength="64" placeholder="请填写游戏 ID" value="' + esc(state.gameId) + '" required autocomplete="off"></div>' +
      (showServer
        ? '<div class="gp-pd-field"><span>区服</span><input name="server" type="text" maxlength="64" placeholder="例如：亚服 / 国服" value="' + esc(state.server) + '"></div>'
        : "") +
      '<div class="gp-pd-field"><span>老板备注</span>' +
      '<textarea name="remark" rows="2" placeholder="段位目标、联系方式偏好等">' + esc(state.remark) + "</textarea></div>" +
      '<div class="gp-pd-field"><span>优惠码</span><div class="gp-pd-coupon">' +
      '<input name="couponCode" type="text" maxlength="40" placeholder="可选" value="' + esc(state.couponCode) + '">' +
      '<button type="button" data-gp-apply-coupon>使用</button></div>' +
      (state.couponHint ? '<small class="gp-pd-hint">' + esc(state.couponHint) + "</small>" : "") +
      "</div>" +
      '<div class="gp-pd-totals">' +
      '<div><span>小计</span><strong data-gp-subtotal>' + esc(catFood(subtotal())) + "</strong></div>" +
      '<div><span>优惠</span><strong data-gp-discount>-' + esc(catFood(discount())) + "</strong></div>" +
      '<div class="gp-pd-payline"><span>实付</span><strong data-gp-payable>' + esc(catFood(payable())) + "</strong></div>" +
      "</div>" +
      (state.message ? '<div class="gp-pd-msg" role="alert">' + esc(state.message) + "</div>" : "") +
      '<div class="gp-pd-form-actions">' +
      '<a class="gp-btn" href="' + esc(supportUrl(consultDraft())) + '">咨询客服</a>' +
      '<button class="gp-btn primary" type="submit" data-gp-submit' + (state.busy || !pkgs.length ? " disabled" : "") + ">" +
      esc(primaryCtaLabel()) +
      "</button></div>" +
      '<p class="gp-muted gp-pd-footnote">' +
      (canDirectOrder()
        ? "提交后将创建待付款订单，完成支付后进入抢单大厅。"
        : "该商品需客服确认报价与派单，提交后进入客服会话。") +
      "</p>"
    );
  }

  function reviewsHtml(reviewList) {
    if (!reviewList.length) {
      return '<div class="gp-pd-review-empty"><p>暂无评价</p></div>';
    }
    return (
      '<div class="gp-pd-review-list">' +
      reviewList
        .slice(0, 12)
        .map(function (r) {
          return (
            '<article class="gp-pd-review-item"><div class="gp-pd-review-top"><strong>' +
            esc(r.rating || "-") +
            '★</strong><span>' +
            esc(r.createdAt ? String(r.createdAt).slice(0, 16).replace("T", " ") : "") +
            '</span></div><p>' +
            esc(r.content || "老板已完成真实订单评价") +
            "</p></article>"
          );
        })
        .join("") +
      "</div>"
    );
  }

  function render() {
    var box = document.getElementById("gpDetail");
    if (!box) return;

    if (state.loading) {
      box.innerHTML =
        '<div class="gp-pd-empty"><strong>正在读取商品详情…</strong><p>正在为你准备玩法详情页</p></div>';
      return;
    }

    if (state.error || !state.product) {
      box.innerHTML =
        '<div class="gp-pd-empty">' +
        "<strong>商品不存在或已下架</strong>" +
        "<p>" + esc(state.error || "请返回商城选择其他商品") + "</p>" +
        '<a class="gp-btn primary" href="more-gameplays.html">返回更多玩法</a>' +
        "</div>";
      return;
    }

    var p = state.product;
    var pkgs = packagesOf(p);
    if (!state.packageId && pkgs[0]) state.packageId = pkgs[0].id;
    var showServer = p.showServer !== false;
    var sections = parseSections(p);
    var coverUrl = safeCoverUrl(p);
    var soldCount = Number(p.soldCount || p.sold_count || 0);
    var soldChip = soldCount > 0 ? '<span class="gp-chip">' + esc(soldCount) + " 人已下单</span>" : "";
    var hasRating = p.rating != null && Number(p.rating) > 0;
    var ratingText = hasRating
      ? Number(p.rating).toFixed(1) + "（" + (p.reviewCount || state.reviews.length || 0) + " 条评价）"
      : "";
    var reviewList = state.reviews.length ? state.reviews : Array.isArray(p.reviews) ? p.reviews : [];
    var unitLabel = ((pkgs[0] && pkgs[0].unit) || p.pricingUnit || "每单");

    box.innerHTML =
      '<div class="gp-pd-page">' +
      '<div class="gp-pd-banner-wrap">' +
      '<img class="gp-pd-banner" data-mcj-product-cover="1" src="' + esc(coverUrl) + '" alt="' + esc(p.name || "商品封面") + '" ' +
      'onerror="this.onerror=null;this.src=\'' + GAME_PLACEHOLDER + '\';">' +
      '<div class="gp-pd-banner-shade"></div>' +
      "</div>" +
      '<div class="gp-pd-body">' +
      '<div class="gp-pd-layout">' +
      '<div class="gp-pd-main">' +
      '<div class="gp-pd-hero">' +
      '<div class="gp-pd-chips">' +
      '<span class="gp-chip">' + esc(p.category || "玩法") + "</span>" +
      '<span class="gp-chip">' + esc(p.gamesText || "综合游戏") + "</span>" +
      soldChip +
      "</div>" +
      "<h1>" + esc(p.name) + "</h1>" +
      (sections.intro ? '<p class="gp-pd-intro">' + esc(sections.intro) + "</p>" : "") +
      '<div class="gp-pd-price-row">' +
      '<span class="gp-detail-price" data-gp-unit-price>' + esc(catFood(unitPrice())) + "</span>" +
      '<span class="gp-pd-unit">/ ' + esc(unitLabel) + "</span>" +
      (hasRating ? '<span class="gp-pd-rating">★ ' + esc(ratingText) + "</span>" : '<span class="gp-pd-rating gp-muted">暂无评价</span>') +
      "</div>" +
      "</div>" +
      '<section class="gp-detail-block gp-pd-block gp-pd-pkg-block"><h2>选择套餐</h2>' +
      '<div class="gp-pd-packages gp-pd-packages-inline">' +
      (pkgs
        .map(function (item) {
          var on = String(item.id) === String(state.packageId);
          var unit = item.unit || p.pricingUnit || "每单";
          return (
            '<button type="button" class="gp-pd-package' + (on ? " is-active" : "") + '" data-gp-package="' + esc(item.id) + '">' +
            "<strong>" + esc(item.name) + "</strong>" +
            "<em>" + esc(catFood(item.price)) + " / " + esc(unit) + "</em>" +
            "</button>"
          );
        })
        .join("") || '<div class="gp-pd-msg">暂无可选套餐</div>') +
      "</div></section>" +
      '<section class="gp-detail-block gp-pd-block"><h2>服务内容</h2>' + textToBullets(sections.content) + "</section>" +
      '<section class="gp-detail-block gp-pd-block"><h2>服务规则</h2>' + textToBullets(sections.rules) + "</section>" +
      '<section class="gp-detail-block gp-pd-block gp-pd-reviews"><div class="gp-pd-block-head"><h2>玩家评价</h2>' +
      (reviewList.length ? "<span>" + esc(reviewList.length) + " 条</span>" : "") +
      "</div>" +
      reviewsHtml(reviewList) +
      "</section>" +
      "</div>" +
      '<aside class="gp-pd-sidebar">' +
      '<form class="gp-pd-order-card" id="gpOrderForm" data-gp-order-form aria-label="下单表单">' +
      orderFormHtml(p, pkgs, showServer) +
      "</form>" +
      '<a class="gp-pd-back" href="more-gameplays.html">← 返回更多玩法</a>' +
      "</aside>" +
      "</div></div></div>";
  }

  function loadReviews(id) {
    return fetch("/api/platform/gameplay-products?id=" + encodeURIComponent(id) + "&reviews=1", {
      headers: { Accept: "application/json" },
      cache: "no-store",
    })
      .then(function (res) {
        return res.json().then(function (body) {
          if (!res.ok || body.ok === false) return [];
          if (Array.isArray(body.reviews)) return body.reviews;
          if (body.product && Array.isArray(body.product.reviews)) return body.product.reviews;
          return [];
        });
      })
      .catch(function () {
        return [];
      });
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
    Promise.all([
      fetch("/api/platform/gameplay-products?id=" + encodeURIComponent(id), {
        headers: { Accept: "application/json" },
        cache: "no-store",
      }).then(function (res) {
        return res.json().then(function (body) {
          if (!res.ok || body.ok === false) throw new Error(body.message || "商品不存在或已下架");
          return body;
        });
      }),
      loadReviews(id),
    ])
      .then(function (results) {
        var body = results[0];
        var p = body.product || null;
        if (!p || /test|preview|demo|mock|验收/i.test(String(p.name || "") + String(p.id || ""))) {
          throw new Error("商品不存在或已下架");
        }
        state.product = p;
        state.reviews = results[1] || [];
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
      });
  }

  function requireLogin(resumeFn) {
    if (token()) return true;
    var resume =
      typeof resumeFn === "function"
        ? resumeFn
        : function () {
            var form = document.querySelector(".gp-pd-form, form");
            if (form) placeOrder(form);
          };
    if (window.MCJAuthContinue && typeof window.MCJAuthContinue.requireLogin === "function") {
      window.MCJAuthContinue.requireLogin(resume);
      return false;
    }
    if (window.MCJModal && typeof window.MCJModal.openLogin === "function") {
      if (window.MCJAuthContinue && typeof window.MCJAuthContinue.setPending === "function") {
        window.MCJAuthContinue.setPending(resume);
      }
      window.MCJModal.openLogin("login");
      return false;
    }
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
    var hint = document.querySelector(".gp-pd-hint");
    if (hint) hint.textContent = state.couponHint;
    else render();
    renderTotals();
  }

  function friendlyOrderError(err) {
    var msg = String((err && err.message) || "");
    if (/陪玩单价无效|单价无效/.test(msg)) return "该商品需客服确认报价，正在为您转接…";
    if (/登录|auth|token/i.test(msg)) return "请先登录后再下单";
    if (/价格已变化/.test(msg)) return "价格有更新，请刷新页面后重试";
    return "暂时无法直接下单，正在为您转接客服…";
  }

  function redirectToSupport() {
    location.href = supportUrl(orderDraft());
  }

  function createDirectOrder() {
    var p = state.product;
    var pkg = currentPackage();
    var quantity = qty();
    var unit = (pkg && pkg.unit) || p.pricingUnit || "每单";
    var description = [
      "更多玩法商品：" + (p.name || ""),
      "商品ID：" + (p.id || ""),
      "套餐：" + ((pkg && pkg.name) || "标准套餐"),
      "数量：" + quantity + " × " + unit,
      "开始时间：" + state.startTime,
      state.server ? "区服：" + state.server : "",
    ]
      .filter(Boolean)
      .join("\n");

    return fetch("/api/orders", {
      method: "POST",
      headers: authHeaders(),
      body: JSON.stringify({
        action: "create",
        order: {
          order_type: "gameplay_product",
          title: p.name,
          game: p.gamesText || p.category,
          serviceType: (pkg && pkg.name) || p.name,
          description: description,
          notes: state.remark,
          gameId: state.gameId,
          server: state.server,
          hours: quantity,
          quantity: quantity,
          unit_price: unitPrice(),
          total_amount: payable(),
          gameplay_product_id: p.id,
          productId: p.id,
          packageId: pkg && pkg.id,
          paymentMethod: "tng",
          startTime: state.startTime,
          pricingUnit: unit,
        },
      }),
    })
      .then(function (res) {
        return res.text().then(function (text) {
          var body = {};
          try {
            body = text ? JSON.parse(text) : {};
          } catch (e) {
            body = { ok: false, message: "服务器返回异常" };
          }
          if (!res.ok || body.ok === false) {
            var err = new Error(body.message || "下单失败");
            err.status = res.status;
            throw err;
          }
          return body;
        });
      })
      .then(function (body) {
        var order = body.order || {};
        var oid = order.id || "";
        if (oid) {
          try {
            sessionStorage.setItem(
              "mcjOrderCache:" + oid,
              JSON.stringify({
                id: oid,
                paymentMethod: "tng",
                totalAmount: order.totalAmount || payable(),
              })
            );
          } catch (e) {}
          location.href = "payment-confirm.html?order=" + encodeURIComponent(oid);
          return;
        }
        location.href = "orders.html";
      });
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
    if (!requireLogin(function () {
      placeOrder(form);
    })) return;

    if (!canDirectOrder()) {
      redirectToSupport();
      return;
    }

    state.busy = true;
    state.message = "";
    renderTotals();

    createDirectOrder()
      .catch(function (err) {
        state.busy = false;
        state.message = friendlyOrderError(err);
        renderTotals();
        if (/陪玩单价无效|单价无效|暂时无法直接下单|转接/.test(state.message)) {
          setTimeout(function () {
            redirectToSupport();
          }, 700);
          return;
        }
        render();
      });
  }

  document.addEventListener("click", function (e) {
    var pkgBtn = e.target.closest("[data-gp-package]");
    if (pkgBtn) {
      e.preventDefault();
      state.packageId = pkgBtn.getAttribute("data-gp-package") || "";
      state.couponDiscount = 0;
      state.couponHint = state.couponCode ? "套餐已变更，请重新确认优惠码" : "";
      document.querySelectorAll("[data-gp-package]").forEach(function (btn) {
        btn.classList.toggle("is-active", btn === pkgBtn);
      });
      var hidden = document.querySelector('input[name="packageId"]');
      if (hidden) hidden.value = state.packageId;
      renderTotals();
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
