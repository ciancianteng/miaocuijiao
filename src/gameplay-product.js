(function () {
  "use strict";

  var state = {
    product: null,
    loading: true,
    error: "",
    busy: false,
    message: "",
    quantity: 1,
    startTime: "",
    remark: "",
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
    return localStorage.getItem("mcjAuthAccessToken") || sessionStorage.getItem("mcjAuthAccessToken") || "";
  }

  function isConsultOnly(item) {
    return !item || item.fixedPrice === false || !(Number(item.price) > 0);
  }

  function priceText(item) {
    if (!item) return "-";
    if (isConsultOnly(item)) return "咨询客服报价";
    if (window.MCJCurrency) return window.MCJCurrency.formatRate(item.price || 0, item.pricingUnit || "每单");
    return Number(item.price || 0) + " 猫粮 / " + (item.pricingUnit || "每单");
  }

  function totalText() {
    var p = state.product;
    if (!p || isConsultOnly(p)) return "-";
    var qty = Math.max(1, Math.floor(Number(state.quantity) || 1));
    var total = Math.round(Number(p.price || 0) * qty * 100) / 100;
    if (window.MCJCurrency) return window.MCJCurrency.formatPlain(total);
    return total + " 猫粮";
  }

  function defaultStartTime() {
    var d = new Date(Date.now() + 60 * 60 * 1000);
    d.setMinutes(0, 0, 0);
    var pad = function (n) {
      return String(n).padStart(2, "0");
    };
    return (
      d.getFullYear() +
      "-" +
      pad(d.getMonth() + 1) +
      "-" +
      pad(d.getDate()) +
      "T" +
      pad(d.getHours()) +
      ":" +
      pad(d.getMinutes())
    );
  }

  function render() {
    var box = document.getElementById("gpDetail");
    var actions = document.getElementById("gpActions");
    if (!box) return;
    if (state.loading) {
      box.innerHTML = '<div class="gp-empty">正在读取商品详情...</div>';
      if (actions) actions.hidden = true;
      return;
    }
    if (state.error || !state.product) {
      box.innerHTML =
        '<div class="gp-empty">' +
        esc(state.error || "商品不存在或已下架") +
        '<br><br><a class="gp-btn" href="more-gameplays.html">返回商城</a></div>';
      if (actions) actions.hidden = true;
      return;
    }
    var p = state.product;
    var cover = p.coverUrl
      ? '<img src="' + esc(p.coverUrl) + '" alt="' + esc(p.name) + '">'
      : '<div class="gp-card-cover-empty">MEOW</div>';
    var consult = isConsultOnly(p);
    var formHtml = consult
      ? '<article class="gp-detail-block"><h2>下单说明</h2><p class="gp-muted">该商品需客服报价。点击下方「咨询客服下单」，客服会根据需求创建正式订单。</p></article>'
      : '<article class="gp-detail-block"><h2>确认下单</h2>' +
        '<form class="gp-order-form" data-gp-order-form>' +
        "<label>服务<strong>" +
        esc(p.name) +
        "</strong></label>" +
        '<label>数量<input name="quantity" type="number" min="1" max="99" step="1" value="' +
        esc(state.quantity) +
        '" required></label>' +
        '<label>开始时间<input name="startTime" type="datetime-local" value="' +
        esc(state.startTime || defaultStartTime()) +
        '" required></label>' +
        '<label class="wide">备注<textarea name="remark" rows="3" placeholder="游戏ID、区服、段位目标、注意事项等">' +
        esc(state.remark) +
        "</textarea></label>" +
        '<div class="gp-order-total"><span>应付金额</span><strong data-gp-total>' +
        esc(totalText()) +
        "</strong></div>" +
        (state.message ? '<div class="gp-msg">' + esc(state.message) + "</div>" : "") +
        '<div class="gp-order-actions">' +
        '<button class="gp-btn primary" type="submit" data-gp-submit' +
        (state.busy ? " disabled" : "") +
        ">" +
        (state.busy ? "提交中…" : "立即下单") +
        "</button>" +
        '<button class="gp-btn" type="button" data-gp-consult>咨询客服</button>' +
        "</div></form></article>";

    box.innerHTML =
      '<div class="gp-detail-layout">' +
      '<section class="gp-detail-media">' +
      cover +
      "</section>" +
      '<section class="gp-detail-info">' +
      "<h1>" +
      esc(p.name) +
      "</h1>" +
      '<div class="gp-detail-chips">' +
      '<span class="gp-chip">' +
      esc(p.category || "其他") +
      "</span>" +
      '<span class="gp-chip">' +
      esc(p.gamesText || "无特定游戏") +
      "</span>" +
      '<span class="gp-chip">已售 ' +
      esc(p.soldCount || 0) +
      "</span>" +
      (p.featured ? '<span class="gp-chip">推荐</span>' : "") +
      "</div>" +
      '<div class="gp-detail-price">' +
      esc(priceText(p)) +
      "</div>" +
      "<p>" +
      esc(p.shortDescription || "") +
      "</p>" +
      (consult && state.message ? '<div class="gp-msg">' + esc(state.message) + "</div>" : "") +
      "</section>" +
      "</div>" +
      '<section class="gp-detail-blocks">' +
      '<article class="gp-detail-block"><h2>服务详情</h2><pre>' +
      esc(p.description || "暂无详情") +
      "</pre></article>" +
      formHtml +
      "</section>";

    if (actions) {
      if (consult) {
        actions.hidden = false;
        actions.innerHTML =
          '<a class="gp-btn" href="more-gameplays.html">返回商城</a>' +
          '<button class="gp-btn primary" type="button" data-gp-consult' +
          (state.busy ? " disabled" : "") +
          ">" +
          (state.busy ? "创建中…" : "咨询客服下单") +
          "</button>";
      } else {
        actions.hidden = true;
      }
    }
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
    fetch("/api/platform/gameplay-products?id=" + encodeURIComponent(id), { headers: { Accept: "application/json" } })
      .then(function (res) {
        return res.json().then(function (body) {
          if (!res.ok || body.ok === false) throw new Error(body.message || "商品读取失败");
          return body;
        });
      })
      .then(function (body) {
        state.product = body.product || null;
        state.error = "";
        if (!state.startTime) state.startTime = defaultStartTime();
      })
      .catch(function (err) {
        state.product = null;
        state.error = err.message || "商品读取失败";
      })
      .finally(function () {
        state.loading = false;
        render();
      });
  }

  function requireLogin() {
    if (token()) return true;
    location.href = "/index.html?login=1&redirect=" + encodeURIComponent(location.pathname + location.search);
    return false;
  }

  function consultNow() {
    if (!state.product || state.busy) return;
    if (!requireLogin()) return;
    state.busy = true;
    state.message = "正在创建客服咨询...";
    render();
    fetch("/api/chat", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        Authorization: "Bearer " + token(),
        "x-mcj-access-token": token(),
      },
      body: JSON.stringify({ action: "consult_gameplay", productId: state.product.id }),
    })
      .then(function (res) {
        return res.json().then(function (body) {
          if (!res.ok || body.ok === false) throw new Error(body.message || "创建咨询失败");
          return body;
        });
      })
      .then(function (body) {
        var href =
          body.redirect ||
          "/support.html?from=gameplay&conversation=" +
            encodeURIComponent((body.conversation && body.conversation.id) || "");
        location.href = href;
      })
      .catch(function (err) {
        state.busy = false;
        state.message = err.message || "创建咨询失败，请稍后重试";
        render();
      });
  }

  function placeOrder(form) {
    if (!state.product || state.busy || isConsultOnly(state.product)) return;
    if (!requireLogin()) return;
    var fd = new FormData(form);
    var quantity = Math.max(1, Math.floor(Number(fd.get("quantity") || 1)));
    var startTime = String(fd.get("startTime") || "").trim();
    var remark = String(fd.get("remark") || "").trim();
    if (!startTime) {
      state.message = "请选择开始时间";
      render();
      return;
    }
    state.quantity = quantity;
    state.startTime = startTime;
    state.remark = remark;
    state.busy = true;
    state.message = "正在创建订单...";
    render();

    var p = state.product;
    var unitPrice = Number(p.price || 0);
    var totalAmount = Math.round(unitPrice * quantity * 100) / 100;
    var unit = p.pricingUnit || "每单";
    var hours = /小时|hr|hour/i.test(unit) ? quantity : Math.max(1, quantity);
    var description = [
      "更多玩法商品：" + (p.name || ""),
      "商品ID：" + (p.id || ""),
      "分类：" + (p.category || ""),
      "游戏：" + (p.gamesText || ""),
      "数量：" + quantity + " × " + unit,
      "开始时间：" + startTime,
      remark ? "备注：" + remark : "",
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
          serviceType: p.name || p.category || "更多玩法",
          service_type: p.name || p.category || "更多玩法",
          description: description,
          notes: remark,
          hours: hours,
          quantity: quantity,
          unit_price: unitPrice,
          unitPrice: unitPrice,
          total_amount: totalAmount,
          totalAmount: totalAmount,
          pricingUnit: unit,
          gameplay_product_id: p.id,
          productId: p.id,
          paymentMethod: "tng",
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

  document.addEventListener("input", function (e) {
    if (!e.target || !e.target.closest || !e.target.closest("[data-gp-order-form]")) return;
    if (e.target.name === "quantity") {
      state.quantity = Math.max(1, Math.floor(Number(e.target.value) || 1));
      var total = document.querySelector("[data-gp-total]");
      if (total) total.textContent = totalText();
    }
    if (e.target.name === "startTime") state.startTime = e.target.value || "";
    if (e.target.name === "remark") state.remark = e.target.value || "";
  });

  document.addEventListener("submit", function (e) {
    if (!e.target || !e.target.matches || !e.target.matches("[data-gp-order-form]")) return;
    e.preventDefault();
    placeOrder(e.target);
  });

  document.addEventListener("click", function (e) {
    if (e.target.closest("[data-gp-consult]")) {
      e.preventDefault();
      consultNow();
    }
  });

  load();
})();
