(function () {
  var ops = window.MCJOps;
  var state = null;
  var view = (location.hash || "#services").slice(1) || "services";
  var selectedService = "";
  var selectedOrder = "";

  function esc(value) { return ops.esc(value); }
  function id() { return localStorage.getItem("mcjOpsCompanionId") || ""; }
  function toast(kind, text) {
    var node = document.getElementById("opsToast");
    if (!node) {
      node = document.createElement("div");
      node.id = "opsToast";
      document.body.appendChild(node);
    }
    node.className = "ops-toast " + kind;
    node.textContent = text;
  }

  function setView(next) {
    view = next;
    history.replaceState(null, "", "#" + next);
    document.querySelectorAll("[data-view]").forEach(function (button) {
      button.classList.toggle("active", button.dataset.view === view);
    });
    render();
  }

  async function load() {
    if (!id()) return;
    state = await ops.companion("/companion/snapshot?companionId=" + encodeURIComponent(id()), {}, id());
    if (!selectedService && state.services[0]) selectedService = state.services[0].id;
    if (!selectedOrder && state.orders[0]) selectedOrder = state.orders[0].id;
    render();
  }

  function render() {
    var root = document.getElementById("studioMain");
    if (!id()) {
      root.innerHTML = profileForm(null);
      return;
    }
    if (!state) {
      root.innerHTML = '<div class="ops-card">正在读取我的服务…</div>';
      return;
    }
    var views = { services: servicesView, display: displayView, orders: ordersView, apply: applyView, status: statusView, examiner: examinerView, card: cardView };
    root.innerHTML = (views[view] || servicesView)();
    bindForms();
  }

  function profileForm(companion) {
    return '<form id="profileForm" class="ops-card ops-form"><div class="wide"><h2>' + (companion ? "编辑我的资料" : "建立陪玩资料") + '</h2><p class="ops-note">资料会写入数据库，后台可以审核和编辑。</p></div>' +
      input("名称", "name", companion && companion.name, true) +
      input("常驻游戏", "game", companion && companion.game, false) +
      input("头像地址", "avatar", companion && companion.avatar, false) +
      '<label class="ops-field wide"><span class="ops-label">简介</span><textarea name="bio">' + esc(companion && companion.bio) + '</textarea></label><div class="wide"><button class="ops-btn primary" type="submit">保存资料</button></div></form>';
  }

  function input(label, name, value, required) {
    return '<label class="ops-field"><span class="ops-label">' + label + '</span><input name="' + name + '" value="' + esc(value || "") + '"' + (required ? " required" : "") + "></label>";
  }

  function offering(service) {
    return (state.offerings || []).find(function (item) { return item.serviceId === service.id; }) || {
      quotePrice: "", intro: "", showOnCard: false, showPrice: false, showIntro: false, showBadge: false, acceptOrders: false
    };
  }

  function offerFields(service, offer) {
    var settings = state.settings || {};
    return '<label class="ops-field"><span class="ops-label">我的报价</span><input name="quotePrice" type="number" min="0" step="0.01" value="' + esc(offer.quotePrice === null || offer.quotePrice === undefined ? "" : offer.quotePrice) + '"></label>' +
      '<label class="ops-field wide"><span class="ops-label">服务介绍</span><textarea name="intro">' + esc(offer.intro || "") + "</textarea></label>" +
      toggle("showOnCard", "展示在我的个人卡片", offer.showOnCard, settings.allowShowOnCard) +
      toggle("showPrice", "展示服务价格", offer.showPrice, settings.allowShowPrice) +
      toggle("showIntro", "展示服务介绍", offer.showIntro, settings.allowShowIntro) +
      toggle("showBadge", "展示技术认证徽章", offer.showBadge, settings.allowShowBadge) +
      toggle("acceptOrders", "开启接单", offer.acceptOrders, settings.allowAcceptOrders);
  }

  function servicesView() {
    return profileForm(state.companion) + '<div class="service-stack">' + state.services.map(function (service) {
      var offer = offering(service);
      var range = ops.formatRange(service.priceMin, service.priceMax, service.unit);
      var paused = !offer.acceptOrders;
      return '<article class="ops-card"><div class="ops-split"><h3>' + esc(service.name) + "</h3>" + (service.enabled ? (paused ? chipText("已暂停", "wait") : chipText("接单中", "ok")) : chipText("已关闭", "bad")) + '</div><p>' + esc(service.category || "未分类") + " · " + esc(range || "未设置") + '</p><p>报价 <b class="ops-price">' + esc(ops.formatMoney(offer.quotePrice) || "未报价") + '</b></p><details><summary>展开设置</summary><form data-offer-form data-service="' + esc(service.id) + '">' + offerFields(service, offer) + '<button class="ops-btn primary" type="submit">保存</button></form></details></article>';
    }).join("") + "</div>";
  }

  function chipText(text, kind) {
    return '<span class="ops-chip ' + kind + '">' + esc(text) + "</span>";
  }

  function displayView() {
    var service = state.services.find(function (item) { return item.id === selectedService; }) || state.services[0];
    if (!service) return '<div class="ops-empty">后台还没有服务。</div>';
    var offer = offering(service);
    var settings = state.settings || {};
    return '<div class="ops-actions">' + state.services.map(function (item) {
      return '<button class="ops-btn' + (item.id === service.id ? " primary" : "") + '" type="button" data-open-service="' + esc(item.id) + '">' + esc(item.name) + "</button>";
    }).join("") + '</div><form id="offerForm" class="ops-card ops-form" data-offer-form data-service="' + esc(service.id) + '"><div class="wide"><h2>服务展示与接单</h2><p>' + esc(service.name) + " · 允许 " + esc(ops.formatRange(service.priceMin, service.priceMax, service.unit) || "价格未设置") + "</p></div>" +
      offerFields(service, offer) +
      '<div class="wide"><button class="ops-btn primary" type="submit">保存勾选</button></div></form>';
  }

  function toggle(name, label, checked, allowed) {
    return '<label class="ops-check wide"><span>' + label + (allowed ? "" : "（管理员已锁定）") + '</span><input name="' + name + '" type="checkbox"' + (checked ? " checked" : "") + (allowed ? "" : " disabled") + "></label>";
  }

  function ordersView() {
    if (!state.orders.length) return '<div class="ops-card ops-empty">还没有分配给你的订单。</div>';
    return state.orders.map(function (order) {
      var open = order.id === selectedOrder;
      var requirements = (order.requirements || []).map(function (item) {
        var value = Array.isArray(item.value) ? item.value.join("、") : item.value;
        return "<p><span class='ops-muted'>" + esc(item.label) + "</span><br><b>" + esc(value) + "</b></p>";
      }).join("") || "<p>这张订单没有对陪玩展示的要求。</p>";
      var actions = order.status === "pending_accept" ? '<div class="ops-actions"><button class="ops-btn primary" type="button" data-order-action="accept" data-id="' + esc(order.id) + '">接受</button><button class="ops-btn danger" type="button" data-order-action="reject" data-id="' + esc(order.id) + '">拒绝</button></div>' : "";
      return '<article class="ops-card"><button class="ops-btn" type="button" data-order="' + esc(order.id) + '">' + esc((order.serviceSnapshot || {}).name || "订单") + " · " + esc(order.id) + '</button><p>老板 ' + esc(order.bossName) + " · " + esc(ops.statusLabel(order.status)) + " · 快照单价 " + esc(ops.formatMoney(order.unitPrice)) + " / " + esc(order.unit) + " · 总价 " + esc(ops.formatMoney(order.totalPrice)) + "</p>" + actions + (open ? requirements : "") + "</article>";
    }).join("");
  }

  function applyView() {
    return '<form id="certForm" class="ops-card ops-form"><div class="wide"><h2>申请技术认证</h2><p class="ops-note">提交后只进入审核。通过审核才能看到考官，考核通过后才会获得徽章。</p></div>' +
      input("申请游戏", "game", "", true) + input("申请认证项目", "certItem", "", true) + input("技术等级", "techLevel", "", true) +
      '<label class="ops-field wide"><span class="ops-label">考核内容备注 *</span><textarea name="examNote" required></textarea></label>' +
      '<label class="ops-field wide"><span class="ops-label">申请说明</span><textarea name="description"></textarea></label>' +
      input("证明资料链接（可选）", "proof", "", false) +
      '<div class="wide"><button class="ops-btn primary" type="submit">提交申请</button></div></form>';
  }

  function statusView() {
    if (!state.applications.length) return '<div class="ops-card ops-empty">还没有认证申请。</div>';
    var labels = { pending: "待审核", approved: "申请已通过，等待考核", rejected: "已拒绝", need_more: "请补充资料", exam_passed: "考核通过，已发徽章", exam_failed: "考核未通过，不发徽章" };
    return state.applications.map(function (item) {
      var reviews = state.reviews.filter(function (review) { return review.applicationId === item.id; });
      var actionNames = { submit: "提交申请", approve: "审核通过", reject: "已拒绝", need_more: "要求补充资料", exam_pass: "考核通过", exam_fail: "考核不通过", revoke_badge: "撤销徽章" };
      return '<article class="ops-card"><h3>' + esc(item.game) + " · " + esc(item.certItem) + '</h3><p><span class="ops-chip info">' + esc(labels[item.status] || item.status) + "</span></p><p>" + esc(item.techLevel) + "</p><p>" + reviews.map(function (review) { return esc(actionNames[review.action] || review.action) + "：" + esc(review.reason || "已记录"); }).join("<br>") + "</p></article>";
    }).join("");
  }

  function examinerView() {
    var pending = state.applications.filter(function (item) { return ["pending", "rejected", "need_more"].indexOf(item.status) >= 0; });
    var visible = state.examiners || [];
    return '<div class="ops-page"><div class="ops-card"><h2>考官联系方式</h2><p>只有申请审核通过的游戏才会从接口返回联系方式。</p></div>' +
      (visible.length ? visible.map(function (item) {
        return '<article class="ops-card"><h3>' + esc(item.name) + " · " + esc(item.game) + "</h3><p>微信 " + esc(item.wechat || "-") + "</p><p>WhatsApp " + esc(item.whatsapp || "-") + "</p><p>QQ " + esc(item.qq || "-") + "</p><p>Telegram " + esc(item.telegram || "-") + "</p><p>" + esc(item.examNote || "") + "</p></article>";
      }).join("") : '<article class="ops-card">当前没有你可以查看的考官。</article>') +
      pending.map(function (item) {
        return '<article class="ops-card"><h3>' + esc(item.game) + ' 尚未开放</h3><p>这份申请还没通过审核，页面和接口都不会提供考官联系方式。</p></article>';
      }).join("") + "</div>";
  }

  function cardView() {
    return '<div id="liveCard" class="ops-card">正在读取公开卡片…</div>';
  }

  function bindForms() {
    var profile = document.getElementById("profileForm");
    if (profile) profile.addEventListener("submit", saveProfile);
    document.querySelectorAll("[data-offer-form]").forEach(function (offer) {
      offer.addEventListener("submit", saveOffer);
    });
    var cert = document.getElementById("certForm");
    if (cert) cert.addEventListener("submit", saveCert);
    if (view === "card") {
      ops.request("/public/cards/" + encodeURIComponent(id())).then(function (card) {
        var node = document.getElementById("liveCard");
        if (!node) return;
        node.innerHTML = '<h2>公开个人卡片预览</h2><p>' + esc(card.companion.name) + "</p><div class='ops-badges'>" + (card.badges || []).map(function (badge) { return '<span class="ops-badge">' + esc(badge.label) + "</span>"; }).join("") + "</div>" + (card.services || []).map(function (service) {
          return "<p><b>" + esc(service.name) + "</b><br>" + esc(service.priceText || "价格未展示") + "<br>" + esc(service.intro || "介绍未展示") + "</p>";
        }).join("") + '<a class="ops-btn" href="public-card.html?id=' + encodeURIComponent(id()) + '">打开公开页面</a>';
      }).catch(function () {
        var node = document.getElementById("liveCard");
        if (node) node.textContent = "公开卡片暂时没有可展示的服务。";
      });
    }
  }

  async function saveProfile(event) {
    event.preventDefault();
    var form = event.currentTarget;
    var button = form.querySelector("button");
    button.disabled = true;
    toast("loading", "正在保存资料…");
    var body = { name: form.elements.name.value, game: form.elements.game.value, avatar: form.elements.avatar.value, bio: form.elements.bio.value, status: "active" };
    try {
      var saved = id()
        ? await ops.companion("/companion/profile/" + encodeURIComponent(id()), { method: "PATCH", body: body }, id())
        : await ops.companion("/companion/profile", { method: "POST", body: body }, "new");
      localStorage.setItem("mcjOpsCompanionId", saved.id);
      toast("success", "资料已保存");
      await load();
    } catch (error) {
      toast("error", error.message || "保存失败");
      button.disabled = false;
    }
  }

  async function saveOffer(event) {
    event.preventDefault();
    var form = event.currentTarget;
    var button = form.querySelector("button[type=submit]");
    button.disabled = true;
    toast("loading", "正在保存展示设置…");
    try {
      await ops.companion("/companion/offering", {
        method: "PUT",
        body: {
          companionId: id(),
          serviceId: form.dataset.service,
          quotePrice: form.elements.quotePrice.value,
          intro: form.elements.intro.value,
          showOnCard: form.elements.showOnCard.checked,
          showPrice: form.elements.showPrice.checked,
          showIntro: form.elements.showIntro.checked,
          showBadge: form.elements.showBadge.checked,
          acceptOrders: form.elements.acceptOrders.checked
        }
      }, id());
      toast("success", "展示设置已同步到个人卡片");
      await load();
    } catch (error) {
      toast("error", error.message || "保存失败");
      button.disabled = false;
    }
  }

  async function saveCert(event) {
    event.preventDefault();
    var form = event.currentTarget;
    var button = form.querySelector("button");
    button.disabled = true;
    toast("loading", "正在提交申请…");
    try {
      await ops.companion("/companion/cert-applications", {
        method: "POST",
        body: {
          companionId: id(),
          game: form.elements.game.value,
          certItem: form.elements.certItem.value,
          techLevel: form.elements.techLevel.value,
          examNote: form.elements.examNote.value,
          description: form.elements.description.value,
          proof: form.elements.proof.value
        }
      }, id());
      toast("success", "申请已提交");
      view = "status";
      await load();
    } catch (error) {
      toast("error", error.message || "提交失败");
      button.disabled = false;
    }
  }

  document.addEventListener("click", function (event) {
    var nav = event.target.closest("[data-view]");
    if (nav) {
      setView(nav.dataset.view);
      return;
    }
    var serviceBtn = event.target.closest("[data-open-service]");
    if (serviceBtn) {
      selectedService = serviceBtn.dataset.openService;
      setView("display");
      return;
    }
    var orderBtn = event.target.closest("[data-order]");
    if (orderBtn) {
      selectedOrder = orderBtn.dataset.order;
      render();
      return;
    }
    var orderAction = event.target.closest("[data-order-action]");
    if (orderAction) {
      var reason = orderAction.dataset.orderAction === "reject" ? (window.prompt("拒单原因") || "") : "";
      if (orderAction.dataset.orderAction === "reject" && !reason.trim()) return;
      ops.companion("/orders/" + encodeURIComponent(orderAction.dataset.id) + "/" + orderAction.dataset.orderAction, { method: "POST", body: { reason: reason } }, id())
        .then(function () { toast("success", "已更新预约"); return load(); })
        .catch(function (error) { toast("error", error.message || "操作失败"); });
    }
  });

  window.addEventListener("hashchange", function () {
    view = (location.hash || "#services").slice(1) || "services";
    document.querySelectorAll("[data-view]").forEach(function (button) {
      button.classList.toggle("active", button.dataset.view === view);
    });
    render();
  });

  document.addEventListener("DOMContentLoaded", function () {
    var params = new URLSearchParams(location.search);
    if (params.get("companion")) localStorage.setItem("mcjOpsCompanionId", params.get("companion"));
    document.querySelectorAll("[data-view]").forEach(function (button) {
      button.classList.toggle("active", button.dataset.view === view);
    });
    if (!id()) render();
    else load().catch(function (error) {
      document.getElementById("studioMain").innerHTML = '<div class="ops-card"><h2>加载失败</h2><p>' + esc(error.message) + "</p></div>";
    });
  });
})();
