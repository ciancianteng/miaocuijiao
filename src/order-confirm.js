(function () {
  "use strict";
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
  function token() {
    return localStorage.getItem("mcjAuthAccessToken") || sessionStorage.getItem("mcjAuthAccessToken") || "";
  }
  function root() {
    return document.getElementById("orderConfirmRoot");
  }
  function draft() {
    try {
      return JSON.parse(sessionStorage.getItem("mcjOrderDraft") || "null");
    } catch (e) {
      return null;
    }
  }
  function idem() {
    return "pay-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10);
  }

  var d = draft();
  if (!d) {
    root().innerHTML =
      '<section class="detail-card"><h1>没有待确认订单</h1><p>请从陪玩详情页重新选择服务。</p><a class="order-now" href="companion-center.html">返回陪玩大厅</a></section>';
    return;
  }

  root().innerHTML =
    '<section class="detail-card"><h1>订单确认</h1><p>支付优先使用猫粮钱包。提交后由服务端扣款并创建订单。</p>' +
    '<div class="info-list" style="display:grid;gap:10px;margin-top:16px">' +
    '<div style="display:flex;gap:12px;align-items:center"><img src="' +
    esc(d.avatar || "assets/meow-cuijiao-brand.jpg") +
    '" alt="" style="width:64px;height:64px;border-radius:14px;object-fit:cover"><div><strong>' +
    esc(d.companionName) +
    "</strong><div>ID " +
    esc(d.companionPublicId || "-") +
    "</div><div>" +
    esc(d.availabilityText || "") +
    "</div></div></div>" +
    "<div><span>服务</span><b> " +
    esc(d.serviceName) +
    "</b></div>" +
    "<div><span>规格 / 数量</span><b> " +
    esc(d.quantity) +
    " " +
    esc(d.pricingUnit) +
    "</b></div>" +
    "<div><span>单价</span><b> " +
    money(d.unitPrice) +
    "</b></div>" +
    "<div><span>开始时间</span><b> " +
    esc(d.scheduledAt || (d.startNow ? "立即开始" : "待约定")) +
    "</b></div>" +
    "<div><span>老板游戏 ID</span><b> " +
    esc(d.gameIdValue || "无需") +
    "</b></div>" +
    "<div><span>区服 / 段位</span><b> " +
    esc([d.server, d.rank].filter(Boolean).join(" / ") || "-") +
    "</b></div>" +
    "<div><span>备注</span><b> " +
    esc(d.notes || "-") +
    "</b></div>" +
    "<div><span>商品小计</span><b> " +
    esc(d.totalAmount) +
    " 猫粮（约 " +
    money(d.totalAmount) +
    "）</b></div>" +
    "<div><span>优惠券</span><b> 暂无可用</b></div>" +
    "<div><span>应付猫粮</span><b> " +
    esc(d.totalAmount) +
    "</b></div>" +
    '</div><label style="display:flex;gap:8px;align-items:flex-start;margin:16px 0"><input type="checkbox" id="agreeBox"> 我已阅读并同意用户协议与下单规则</label>' +
    '<div class="mcj-actions"><a class="ghost" href="profile.html?player=' +
    encodeURIComponent(d.companionId) +
    '" style="display:flex;align-items:center;justify-content:center;text-decoration:none;background:rgba(255,255,255,.08);color:#fff;border-radius:12px">返回修改</a>' +
    '<button type="button" class="primary" id="payBtn">提交订单并支付</button></div></section>';

  document.getElementById("payBtn").onclick = function () {
    if (!document.getElementById("agreeBox").checked) {
      alert("请先勾选协议");
      return;
    }
    if (!token()) {
      if (window.MCJAuthContinue && typeof window.MCJAuthContinue.requireLogin === "function") {
        window.MCJAuthContinue.requireLogin(function () {
          document.getElementById("payBtn").click();
        });
        return;
      }
      if (window.MCJModal && typeof window.MCJModal.openLogin === "function") {
        window.MCJModal.openLogin("login");
        return;
      }
      alert("请先登录老板账号");
      return;
    }
    var btn = document.getElementById("payBtn");
    btn.disabled = true;
    btn.textContent = "支付中…";
    fetch("/api/boss/marketplace", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: "Bearer " + token(),
        "x-mcj-access-token": token(),
      },
      body: JSON.stringify({
        action: "create_and_pay",
        companionId: d.companionId,
        serviceId: d.serviceId,
        quantity: d.quantity,
        unitPrice: d.unitPrice,
        totalAmount: d.totalAmount,
        gameIdValue: d.gameIdValue,
        server: d.server,
        rank: d.rank,
        contact: d.contact,
        scheduledAt: d.scheduledAt || null,
        startNow: !!d.startNow,
        notes: d.notes,
        specialRequests: d.specialRequests,
        idempotencyKey: idem(),
      }),
    })
      .then(function (res) {
        return res.json().then(function (body) {
          if (!res.ok || body.ok === false) throw Object.assign(new Error(body.message || "支付失败"), body);
          return body;
        });
      })
      .then(function (body) {
        try {
          sessionStorage.removeItem("mcjOrderDraft");
        } catch (e) {}
        alert(body.message || "支付成功");
        location.href = "orders.html";
      })
      .catch(function (err) {
        btn.disabled = false;
        btn.textContent = "提交订单并支付";
        if (err.code === "INSUFFICIENT_BALANCE" || /余额不足/.test(err.message || "")) {
          if (confirm("猫粮余额不足，是否去充值中心？")) location.href = err.rechargeUrl || "recharge.html";
          return;
        }
        alert(err.message || "支付失败");
      });
  };
})();
