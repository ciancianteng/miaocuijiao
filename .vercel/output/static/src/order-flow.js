(function () {
  if (window.__MCJ_ORDER_FLOW__) return;
  window.__MCJ_ORDER_FLOW__ = true;

  var T = {
    loginTitle: "\u8bf7\u5148\u767b\u5f55",
    loginDesc: "\u767b\u5f55\u540e\u624d\u53ef\u4ee5\u521b\u5efa\u8ba2\u5355\uff0c\u8ba2\u5355\u4f1a\u4fdd\u5b58\u5230\u300c\u6211\u7684\u8ba2\u5355\u300d\u3002",
    loginBtn: "\u767b\u5f55 / \u6ce8\u518c",
    mineBtn: "\u53bb\u6211\u7684\u9875\u9762",
    online: "\u5728\u7ebf",
    pending: "\u5f85\u4ed8\u6b3e",
    confirmTitle: "\u786e\u8ba4\u4e0b\u5355",
    createOrder: "\u786e\u8ba4\u521b\u5efa\u8ba2\u5355",
    recent24: "\u8fd124\u5c0f\u65f6",
    serviceTime: "\u53ef\u670d\u52a1\u65f6\u95f4",
    serviceMode: "\u670d\u52a1\u65b9\u5f0f",
    status: "\u5728\u7ebf\u72b6\u6001",
    voiceText: "\u8bed\u97f3 / \u6587\u5b57",
    available: "24H \u53ef\u9884\u7ea6",
    hours: "\u9009\u62e9\u65f6\u957f",
    total: "\u603b\u4ef7",
    remark: "\u5907\u6ce8",
    remarkPh: "\u4f8b\u5982\uff1a\u60f3\u73a9\u6392\u4f4d\u3001\u8bed\u97f3\u804a\u5929\u3001\u4e0d\u8981\u538b\u529b\u961f\u53cb...",
    desc: "\u662f\u5999\u8106\u89d2\u7535\u7ade\u8ba4\u8bc1\u966a\u73a9\uff0c\u6c9f\u901a\u8212\u670d\u3001\u670d\u52a1\u7a33\u5b9a\uff0c\u4f1a\u6839\u636e\u8001\u677f\u9700\u6c42\u5b89\u6392\u6e38\u620f\u6216\u966a\u4f34\u670d\u52a1\u3002",
    sweet: "\u751c\u59b9\u97f3",
    chat: "\u4f1a\u804a\u5929",
    noPressure: "\u4e0d\u538b\u529b",
    oneHour: "1 \u5c0f\u65f6",
    twoHour: "2 \u5c0f\u65f6",
    threeHour: "3 \u5c0f\u65f6",
    fourHour: "4 \u5c0f\u65f6",
    night: "\u5305\u591c 8 \u5c0f\u65f6"
  };

  function esc(text) {
    return String(text || "").replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function ensureStyle() {
    if (document.getElementById("mcjOrderFlowStyle")) return;
    var style = document.createElement("style");
    style.id = "mcjOrderFlowStyle";
    style.textContent = [
      ".mcj-order-card{display:grid;grid-template-columns:220px 1fr;gap:20px;clear:both}",
      ".mcj-order-cover{position:relative;min-height:278px;border-radius:20px;overflow:hidden;border:1px solid rgba(243,168,203,.34);background:#120d15}",
      ".mcj-order-cover img{width:100%;height:100%;object-fit:cover;display:block}",
      ".mcj-order-status{position:absolute;right:12px;top:12px;border-radius:999px;background:rgba(5,4,6,.72);border:1px solid rgba(255,255,255,.18);padding:7px 10px;font-size:12px;font-weight:1000;color:#fff}",
      ".mcj-order-status:before{content:'';display:inline-block;width:8px;height:8px;margin-right:6px;border-radius:50%;background:#72efb4;box-shadow:0 0 10px #72efb4}",
      ".mcj-order-body h2{margin:2px 0 6px;font-size:30px;color:#fff5fa;text-shadow:0 0 16px rgba(243,168,203,.28)}",
      ".mcj-order-meta{color:#ffdceb;font-weight:950;line-height:1.7}",
      ".mcj-order-desc{color:#d8c6d0;line-height:1.7;font-weight:800}",
      ".mcj-order-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin:14px 0}",
      ".mcj-order-chip,.mcj-order-field{border:1px solid rgba(243,168,203,.20);border-radius:16px;background:rgba(255,255,255,.04);padding:10px}",
      ".mcj-order-chip span,.mcj-order-field span{display:block;color:#bfaebb;font-size:12px;font-weight:900;margin-bottom:5px}",
      ".mcj-order-chip strong{display:block;color:#fff5fa}",
      ".mcj-order-tags{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0 18px}",
      ".mcj-order-tags span{border-radius:999px;border:1px solid rgba(243,168,203,.24);background:rgba(243,168,203,.10);padding:6px 10px;color:#ffe1ef;font-size:12px;font-weight:900}",
      ".mcj-order-field select,.mcj-order-field textarea{width:100%;border:0;outline:0;background:transparent;color:#fff5fa;font:inherit;font-weight:850}",
      ".mcj-order-field textarea{min-height:82px;resize:vertical}",
      ".mcj-confirm-btn{width:100%;height:46px;border:0;border-radius:999px;background:linear-gradient(180deg,#ffe2ef,#e7a0c4);color:#1b0712;font-weight:1000;cursor:pointer;box-shadow:0 0 22px rgba(243,168,203,.22)}",
      ".mcj-confirm-btn:hover{filter:brightness(1.05);box-shadow:0 0 30px rgba(243,168,203,.34)}",
      ".mcj-login-actions{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:16px}",
      "@media(max-width:640px){.modal{align-items:end;padding:0}.dialog{width:100%;max-height:88vh;border-radius:26px 26px 0 0}.mcj-order-card{grid-template-columns:1fr}.mcj-order-cover{min-height:240px}.mcj-order-body h2{font-size:26px}.mcj-order-grid{grid-template-columns:1fr}.mcj-login-actions{grid-template-columns:1fr}}"
    ].join("");
    document.head.appendChild(style);
  }

  function getModal() {
    var modal = document.getElementById("modal");
    var body = document.getElementById("modalBody");
    if (!modal) {
      modal = document.createElement("div");
      modal.id = "modal";
      modal.className = "modal";
      modal.innerHTML = '<div class="dialog"><button class="close" data-close type="button">&times;</button><div id="modalBody"></div></div>';
      document.body.appendChild(modal);
      body = document.getElementById("modalBody");
    }
    return { modal: modal, body: body };
  }

  function openModal(html) {
    ensureStyle();
    var m = getModal();
    m.body.innerHTML = html;
    m.modal.classList.add("open");
    document.body.style.overflow = "hidden";
  }

  function closeModal() {
    var m = getModal();
    m.modal.classList.remove("open");
    document.body.style.overflow = "";
  }

  function text(card, selector, fallback) {
    var node = selector ? card.querySelector(selector) : card;
    return ((node && node.textContent) || fallback || "").trim();
  }

  function collect(button) {
    var card = button.closest(".companion-card,.hot-card,[data-player],article") || document;
    var img = card.querySelector(".avatar img,.hot-cover img,img");
    var name = text(card, "h3", "MOMO");
    var game = text(card, ".game-line,.hot-info p,[data-game]", "VALORANT");
    var price = text(card, ".price,.hot-meta span:last-child", "20 猫粮/小时");
    var rating = text(card, ".rating,.hot-meta span:first-child", "Star 5.0").replace(/^Star/i, "Star");
    var orders = text(card, ".order-line,.hot-orders", "24h orders: 24");
    var tags = [].slice.call(card.querySelectorAll(".tag-row span,.hot-tags span,.mini-tags span")).map(function (x) {
      return text(x);
    }).filter(Boolean);
    var id = card.dataset.playerId || card.dataset.player || button.dataset.playerId || ("player_" + name.toLowerCase().replace(/[^a-z0-9]+/g, "_"));
    return {
      playerId: id,
      name: name,
      game: game,
      price: price,
      rating: rating,
      orders: orders,
      status: T.online,
      img: img ? img.getAttribute("src") : "assets/meow-cuijiao-brand.jpg",
      tags: tags.length ? tags : [T.sweet, T.chat, T.noPressure],
      desc: name + " " + T.desc
    };
  }

  function isLoggedIn() {
    return localStorage.getItem("mcjLoggedIn") === "1";
  }

  function numericPrice(price) {
    var m = String(price || "").match(/[\d.]+/);
    return m ? Number(m[0]) : 20;
  }

  function loginPrompt(data) {
    window.__MCJ_PENDING_ORDER__ = data;
    openModal('<h2>' + T.loginTitle + '</h2><p class="mcj-order-desc">' + T.loginDesc + '</p><div class="mcj-login-actions"><button class="mcj-confirm-btn" data-mcj-login type="button">' + T.loginBtn + '</button><a class="mcj-confirm-btn" href="mine.html" style="text-decoration:none;display:flex;align-items:center;justify-content:center">' + T.mineBtn + '</a></div>');
  }

  function detailHtml(data) {
    var tags = data.tags.map(function (tag) { return "<span>" + esc(tag) + "</span>"; }).join("");
    return '<div class="mcj-order-card"><div class="mcj-order-cover"><img src="' + esc(data.img) + '" alt="' + esc(data.name) + '"><span class="mcj-order-status">' + esc(data.status) + '</span></div><div class="mcj-order-body"><h2>' + esc(data.name) + '</h2><p class="mcj-order-meta">' + esc(data.game) + ' | ' + esc(data.rating) + ' | ' + esc(data.price) + '</p><p class="mcj-order-desc">' + esc(data.desc) + '</p><div class="mcj-order-grid"><div class="mcj-order-chip"><span>' + T.recent24 + '</span><strong>' + esc(data.orders.replace("24h orders:", "").replace("\u8fd124\u5c0f\u65f6\u4e0b\u5355\uff1a", "")) + '</strong></div><div class="mcj-order-chip"><span>' + T.serviceTime + '</span><strong>' + T.available + '</strong></div><div class="mcj-order-chip"><span>' + T.serviceMode + '</span><strong>' + T.voiceText + '</strong></div><div class="mcj-order-chip"><span>' + T.status + '</span><strong>' + esc(data.status) + '</strong></div></div><div class="mcj-order-tags">' + tags + '</div><button class="mcj-confirm-btn" data-mcj-open-order type="button">' + T.confirmTitle + '</button></div></div>';
  }

  function confirmHtml(data) {
    var unit = numericPrice(data.price);
    return '<div class="mcj-order-card"><div class="mcj-order-cover"><img src="' + esc(data.img) + '" alt="' + esc(data.name) + '"><span class="mcj-order-status">' + T.pending + '</span></div><div class="mcj-order-body"><h2>' + T.confirmTitle + '</h2><p class="mcj-order-meta">' + esc(data.name) + ' | ' + esc(data.game) + ' | ' + unit + ' 猫粮/小时</p><div class="mcj-order-grid"><label class="mcj-order-field"><span>' + T.hours + '</span><select id="mcjOrderHours"><option value="1">' + T.oneHour + '</option><option value="2">' + T.twoHour + '</option><option value="3">' + T.threeHour + '</option><option value="4">' + T.fourHour + '</option><option value="8">' + T.night + '</option></select></label><div class="mcj-order-chip"><span>' + T.total + '</span><strong id="mcjOrderTotal">' + unit + ' 猫粮</strong></div></div><label class="mcj-order-field"><span>' + T.remark + '</span><textarea id="mcjOrderRemark" placeholder="' + T.remarkPh + '"></textarea></label><button class="mcj-confirm-btn" data-mcj-create-order type="button">' + T.createOrder + '</button></div></div>';
  }

  function openDetail(data) {
    window.__MCJ_ACTIVE_ORDER__ = data;
    openModal(detailHtml(data));
  }

  function openConfirm(data) {
    window.__MCJ_ACTIVE_ORDER__ = data;
    openModal(confirmHtml(data));
  }

  function currentUser() {
    var user = null;
    try { user = JSON.parse(localStorage.getItem("mcjCurrentUser") || "null"); } catch (e) {}
    if (!user) {
      user = { user_id: "user_demo_001", name: "Demo Boss" };
      localStorage.setItem("mcjCurrentUser", JSON.stringify(user));
    }
    return user;
  }

  function createOrder() {
    var data = window.__MCJ_ACTIVE_ORDER__ || {};
    var hours = Number((document.getElementById("mcjOrderHours") || {}).value || 1);
    var unit = numericPrice(data.price);
    var remark = (document.getElementById("mcjOrderRemark") || {}).value || "";
    var user = currentUser();
    var order = {
      order_id: "MCJ-" + Date.now(),
      user_id: user.user_id,
      player_id: data.playerId,
      player_name: data.name,
      player_avatar: data.img,
      game: data.game,
      service_time: new Date().toLocaleString(),
      duration: hours + " hours",
      hours: hours,
      unit_price: unit,
      amount: (unit * hours) + " 猫粮",
      remark: remark,
      status: "pending_payment",
      created_at: new Date().toISOString()
    };
    var orders = [];
    try { orders = JSON.parse(localStorage.getItem("mcjOrders") || "[]"); } catch (e) {}
    orders.unshift(order);
    localStorage.setItem("mcjOrders", JSON.stringify(orders));
    closeModal();
    location.href = "orders.html?created=" + encodeURIComponent(order.order_id);
  }

  document.addEventListener("click", function (e) {
    var close = e.target.closest("[data-close]");
    if (close || e.target.id === "modal") {
      closeModal();
      return;
    }

    var book = e.target.closest("[data-book],[data-detail-order]");
    if (book) {
      e.preventDefault();
      e.stopPropagation();
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      var data = collect(book);
      if (!isLoggedIn()) {
        loginPrompt(data);
        return;
      }
      openDetail(data);
      return;
    }

    if (e.target.closest("[data-mcj-login]")) {
      localStorage.setItem("mcjLoggedIn", "1");
      document.body.classList.add("is-logged-in");
      var pending = window.__MCJ_PENDING_ORDER__;
      if (pending) openDetail(pending);
      else closeModal();
      return;
    }

    if (e.target.closest("[data-mcj-open-order]")) {
      if (!isLoggedIn()) {
        loginPrompt(window.__MCJ_ACTIVE_ORDER__ || {});
        return;
      }
      openConfirm(window.__MCJ_ACTIVE_ORDER__ || {});
      return;
    }

    if (e.target.closest("[data-mcj-create-order]")) {
      if (!isLoggedIn()) {
        loginPrompt(window.__MCJ_ACTIVE_ORDER__ || {});
        return;
      }
      createOrder();
    }
  }, true);

  document.addEventListener("change", function (e) {
    if (e.target && e.target.id === "mcjOrderHours") {
      var data = window.__MCJ_ACTIVE_ORDER__ || {};
      var total = document.getElementById("mcjOrderTotal");
      if (total) total.textContent = (numericPrice(data.price) * Number(e.target.value || 1)) + " 猫粮";
    }
  }, true);

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeModal();
  });
})();
