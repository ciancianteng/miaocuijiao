(function () {
  var ORDER_KEY = "mcjOrders";
  var REVIEW_KEY = "mcjReviews";
  var USER_KEY = "mcjCurrentUser";

  function $(q, root) {
    return (root || document).querySelector(q);
  }

  function $$(q, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(q));
  }

  function esc(text) {
    return String(text || "").replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function read(key, fallback) {
    try {
      var saved = JSON.parse(localStorage.getItem(key) || "null");
      return saved || fallback;
    } catch (e) {
      return fallback;
    }
  }

  function write(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function currentUser() {
    var user = read(USER_KEY, null);
    if (!user) {
      user = { user_id: "user_demo_001", name: "Demo Boss" };
      write(USER_KEY, user);
    }
    return user;
  }

  function demoOrders() {
    return [
      {
        order_id: "MCJ-2401",
        user_id: "user_demo_001",
        player_id: "player_momo",
        player_name: "MOMO",
        player_avatar: "assets/meow-cuijiao-brand.jpg",
        game: "VALORANT",
        service_time: "2026-07-01 20:00",
        duration: "2 hours",
        amount: "RM24",
        status: "completed",
        tags: ["sweet voice", "shot call"]
      },
      {
        order_id: "MCJ-2402",
        user_id: "user_demo_001",
        player_id: "player_nana",
        player_name: "NANA",
        player_avatar: "assets/lianmiao-club-ad.png",
        game: "APEX",
        service_time: "2026-07-02 21:00",
        duration: "3 hours",
        amount: "RM45",
        status: "in_progress",
        tags: ["carry", "rank up"]
      },
      {
        order_id: "MCJ-2403",
        user_id: "user_demo_001",
        player_id: "player_cheese",
        player_name: "CHEESE",
        player_avatar: "assets/meow-cuijiao-brand.jpg",
        game: "LOL",
        service_time: "2026-06-29 22:00",
        duration: "1 hour",
        amount: "RM18",
        status: "completed",
        tags: ["chatty", "stable"]
      },
      {
        order_id: "MCJ-2404",
        user_id: "user_demo_001",
        player_id: "player_yuki",
        player_name: "YUKI",
        player_avatar: "assets/meow-cuijiao-brand.jpg",
        game: "CSGO",
        service_time: "2026-06-28 19:00",
        duration: "2 hours",
        amount: "RM20",
        status: "cancelled",
        tags: ["caller"]
      }
    ];
  }

  function seed() {
    if (!localStorage.getItem(ORDER_KEY)) write(ORDER_KEY, demoOrders());
    if (!localStorage.getItem(REVIEW_KEY)) write(REVIEW_KEY, []);
    currentUser();
  }

  function getOrders() {
    seed();
    return read(ORDER_KEY, []);
  }

  function getReviews() {
    seed();
    return read(REVIEW_KEY, []);
  }

  function setReviews(reviews) {
    write(REVIEW_KEY, reviews);
  }

  function statusText(status) {
    var map = {
      completed: "已完成",
      in_progress: "进行中",
      cancelled: "已取消",
      refunding: "退款中",
      pending: "待接单"
    };
    return map[status] || status || "未知";
  }

  function isCompleted(status) {
    return status === "completed" || status === "已完成";
  }

  function reviewByOrder(orderId) {
    return getReviews().find(function (review) {
      return review.order_id === orderId;
    });
  }

  function canReviewOrder(order, user) {
    if (!order) return { ok: false, reason: "订单不存在" };
    if (!user || order.user_id !== user.user_id) return { ok: false, reason: "只能评价自己的订单" };
    if (!isCompleted(order.status)) return { ok: false, reason: "订单完成后才可以评价" };
    if (reviewByOrder(order.order_id)) return { ok: false, reason: "这个订单已经评价过了" };
    return { ok: true };
  }

  function submitReview(payload) {
    var user = currentUser();
    var order = getOrders().find(function (item) {
      return item.order_id === payload.order_id;
    });
    var check = canReviewOrder(order, user);
    if (!check.ok) return check;
    if (payload.player_id !== order.player_id) return { ok: false, reason: "评价陪玩和订单陪玩不一致" };

    var rating = Number(payload.rating);
    if (!rating || rating < 1 || rating > 5) return { ok: false, reason: "请选择 1-5 星评分" };

    var reviews = getReviews();
    reviews.push({
      review_id: "RV-" + Date.now(),
      order_id: order.order_id,
      user_id: user.user_id,
      player_id: order.player_id,
      player_name: order.player_name,
      rating: rating,
      content: String(payload.content || "").trim(),
      tags: payload.tags || [],
      created_at: new Date().toISOString(),
      hidden: false
    });
    setReviews(reviews);
    return { ok: true };
  }

  function toast(text) {
    if (window.toast) return window.toast(text);
    alert(text);
  }

  function openReview(orderId) {
    var order = getOrders().find(function (item) {
      return item.order_id === orderId;
    });
    var check = canReviewOrder(order, currentUser());
    if (!check.ok) {
      toast(check.reason);
      return;
    }
    var tagList = ["声音好听", "技术强", "准时", "态度好", "很会聊天"];
    var html = '<div class="review-modal">' +
      '<h2>评价 ' + esc(order.player_name) + '</h2>' +
      '<p class="muted">订单 ' + esc(order.order_id) + ' · ' + esc(order.game) + '</p>' +
      '<label class="field"><span>星级评分</span><select id="reviewRating"><option value="5">★★★★★ 5</option><option value="4">★★★★ 4</option><option value="3">★★★ 3</option><option value="2">★★ 2</option><option value="1">★ 1</option></select></label>' +
      '<div class="review-tags">' + tagList.map(function (tag) {
        return '<label><input type="checkbox" value="' + esc(tag) + '"><span>' + esc(tag) + '</span></label>';
      }).join("") + '</div>' +
      '<label class="field"><span>文字评价</span><textarea id="reviewContent" placeholder="写下这次服务体验，例如声音、技术、守时、态度..."></textarea></label>' +
      '<button class="btn primary" data-submit-review data-order="' + esc(order.order_id) + '">提交评价</button>' +
      '</div>';
    if (window.openModal) window.openModal(html);
  }

  function orderActionHtml(order) {
    var reviewed = reviewByOrder(order.order_id);
    if (reviewed) return '<button class="btn" disabled>已评价</button>';
    if (isCompleted(order.status)) return '<button class="btn primary" data-review-order="' + esc(order.order_id) + '">去评价</button>';
    return '<button class="btn" disabled>完成后可评价</button>';
  }

  function renderOrdersPage() {
    var app = $("#ordersApp");
    if (!app) return;
    var orders = getOrders().filter(function (order) {
      return order.user_id === currentUser().user_id;
    });
    app.innerHTML = '<div class="order-tabs">' +
      '<button class="tag active" data-order-filter="all">全部</button>' +
      '<button class="tag" data-order-filter="in_progress">进行中</button>' +
      '<button class="tag" data-order-filter="completed">已完成</button>' +
      '<button class="tag" data-order-filter="cancelled">已取消</button>' +
      '<button class="tag" data-order-filter="reviewable">待评价</button>' +
      '</div><div class="grid grid-2" id="orderCards"></div>';
    renderOrderCards("all");
  }

  function renderOrderCards(filter) {
    var box = $("#orderCards");
    if (!box) return;
    var orders = getOrders().filter(function (order) {
      if (order.user_id !== currentUser().user_id) return false;
      if (filter === "all") return true;
      if (filter === "reviewable") return isCompleted(order.status) && !reviewByOrder(order.order_id);
      return order.status === filter;
    });
    box.innerHTML = orders.map(function (order) {
      return '<article class="card order-card" data-status="' + esc(order.status) + '">' +
        '<div class="row"><div class="row"><img src="' + esc(order.player_avatar || "/default-avatar.png") + '" style="width:56px;height:56px;border-radius:16px;object-fit:cover" onerror="this.onerror=null;this.src=\'/default-avatar.png\'"><div><h3>' + esc(order.player_name) + '</h3><p class="muted">' + esc(order.game) + ' · ' + esc(order.service_time) + '</p></div></div><span class="tag">' + esc(statusText(order.status)) + '</span></div>' +
        '<p class="muted">服务时长 ' + esc(order.duration) + ' · 金额 <b class="price">' + esc(order.amount) + '</b></p>' +
        '<div class="row"><button class="btn" data-detail-order="' + esc(order.order_id) + '">查看详情</button>' + orderActionHtml(order) + '<button class="btn primary" data-reorder="' + esc(order.player_name) + '">再次下单</button></div>' +
        '</article>';
    }).join("") || '<article class="card"><h3>喵～暂无订单</h3><p class="muted">完成订单后才可以评价陪玩。</p></article>';
  }

  function renderCompanionReviews(playerId, playerName) {
    var target = $("#realReviewList");
    if (!target) return;
    var reviews = getReviews().filter(function (review) {
      if (review.hidden) return false;
      if (playerId) return review.player_id === playerId;
      if (playerName) return review.player_name === playerName;
      return true;
    });
    target.innerHTML = reviews.map(function (review) {
      return '<article class="review-card">' +
        '<strong>' + "★★★★★".slice(0, review.rating) + '</strong>' +
        '<p>' + esc(review.content || "老板已完成真实订单评价") + '</p>' +
        '<small>' + esc((review.tags || []).join(" · ")) + ' · ' + esc(new Date(review.created_at).toLocaleString()) + '</small>' +
        '</article>';
    }).join("") || '<p class="muted">暂无真实订单评价。</p>';
  }

  function injectCompanionDetailReviews() {
    if (!document.body.classList.contains("profile-detail-page")) return;
    var wall = $(".gift-wall");
    if (!wall || $("#realReviewList")) return;
    wall.insertAdjacentHTML("afterend", '<section class="detail-card real-review-wall"><div class="section-head"><h2>真实订单评价</h2><span>仅显示完成订单后的评价</span></div><div class="review-list" id="realReviewList"></div></section>');
    renderCompanionReviews("player_momo", "MOMO");
  }

  function injectAdminReviewPanel() {
    if (!document.body.classList.contains("admin-page")) return;
    var menu = $(".admin-menu");
    var main = $(".admin-main");
    if (!menu || !main || $("#admin-reviews")) return;
    menu.insertAdjacentHTML("beforeend", '<button type="button" data-admin-tab="reviews">评价管理 <small>Reviews</small></button>');
    main.insertAdjacentHTML("beforeend", '<section class="admin-section" id="admin-reviews"><div class="admin-panel"><div class="admin-panel-head"><h2>评价管理</h2><span>只隐藏违规评价，保留记录</span></div><table class="admin-table"><thead><tr><th>订单</th><th>陪玩</th><th>评分</th><th>评价</th><th>状态</th><th>操作</th></tr></thead><tbody id="adminReviewRows"></tbody></table></div></section>');
    renderAdminReviews();
  }

  function renderAdminReviews() {
    var rows = $("#adminReviewRows");
    if (!rows) return;
    var reviews = getReviews();
    rows.innerHTML = reviews.map(function (review) {
      return '<tr><td>' + esc(review.order_id) + '</td><td>' + esc(review.player_name || review.player_id) + '</td><td>' + esc(review.rating) + '</td><td>' + esc(review.content) + '</td><td><span class="status-chip ' + (review.hidden ? "off" : "") + '">' + (review.hidden ? "已隐藏" : "展示中") + '</span></td><td><button class="admin-btn" data-toggle-review="' + esc(review.review_id) + '">' + (review.hidden ? "恢复显示" : "隐藏评价") + '</button></td></tr>';
    }).join("") || '<tr><td colspan="6">暂无评价记录</td></tr>';
  }

  document.addEventListener("click", function (event) {
    var filter = event.target.closest("[data-order-filter]");
    if (filter) {
      $$(".order-tabs .tag").forEach(function (btn) { btn.classList.remove("active"); });
      filter.classList.add("active");
      renderOrderCards(filter.dataset.orderFilter);
      return;
    }

    var reviewBtn = event.target.closest("[data-review-order]");
    if (reviewBtn) {
      openReview(reviewBtn.dataset.reviewOrder);
      return;
    }

    var submit = event.target.closest("[data-submit-review]");
    if (submit) {
      var tags = $$(".review-tags input:checked").map(function (input) { return input.value; });
      var order = getOrders().find(function (item) { return item.order_id === submit.dataset.order; });
      var result = submitReview({
        order_id: submit.dataset.order,
        player_id: order && order.player_id,
        rating: $("#reviewRating") && $("#reviewRating").value,
        content: $("#reviewContent") && $("#reviewContent").value,
        tags: tags
      });
      if (!result.ok) return toast(result.reason);
      if (window.closeModal) window.closeModal();
      toast("评价已提交");
      renderOrdersPage();
      renderAdminReviews();
      return;
    }

    var oldReview = event.target.closest("[data-review]:not([data-review-order])");
    if (oldReview) {
      event.preventDefault();
      toast("只有已完成订单才可以评价，请到我的订单里操作。");
      return;
    }

    var toggle = event.target.closest("[data-toggle-review]");
    if (toggle) {
      var reviews = getReviews();
      var item = reviews.find(function (review) { return review.review_id === toggle.dataset.toggleReview; });
      if (item) item.hidden = !item.hidden;
      setReviews(reviews);
      renderAdminReviews();
      toast(item && item.hidden ? "评价已隐藏，记录保留" : "评价已恢复显示");
    }
  });

  function init() {
    seed();
    renderOrdersPage();
    injectCompanionDetailReviews();
    injectAdminReviewPanel();
  }

  window.MCJReviews = {
    getOrders: getOrders,
    getReviews: getReviews,
    submitReview: submitReview,
    canReviewOrder: canReviewOrder,
    renderOrdersPage: renderOrdersPage,
    renderCompanionReviews: renderCompanionReviews
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
