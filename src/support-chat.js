(function () {
  var root = document.getElementById("supportApp");
  if (!root) return;

  document.documentElement.classList.add("support-page");
  document.body.classList.add("support-page");

  var q = new URLSearchParams(location.search);
  var state = {
    loading: true,
    authLoading: true,
    customerLoading: false,
    opening: false,
    sending: false,
    creatingGeneral: false,
    creatingOrder: "",
    error: "",
    authError: "",
    notice: "",
    identity: null,
    conversations: [],
    conversation: null,
    messages: [],
    orders: [],
    serviceStatus: "等待客服接待",
    serviceOnline: false,
    pollTimer: null,
    composerDraft: "",
    composerFocused: false,
    mobileDetail: false,
    orderCardOpen: false,
    emojiOpen: false,
    realtimeReady: false,
  };

  var COMPOSER_SEL = '[data-send] [name="content"]';
  var EMOJIS = ["😀", "😁", "😂", "😊", "😍", "😘", "👍", "🙏", "🎉", "🐱", "💖", "🔥"];
  var toastTimer = null;

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function Auth() {
    return window.MCJBossAuth || null;
  }
  function hasAuthSession() {
    var auth = Auth();
    if (auth && typeof auth.hasSession === "function") return !!auth.hasSession();
    // Only real JWT session counts — never treat legacy customerAuthToken as login.
    return !!(
      localStorage.getItem("mcjAuthAccessToken") ||
      sessionStorage.getItem("mcjAuthAccessToken") ||
      localStorage.getItem("mcjAuthRefreshToken") ||
      sessionStorage.getItem("mcjAuthRefreshToken")
    );
  }
  function isBossLikeRole(role) {
    role = String(role || "").trim().toLowerCase();
    return role === "boss" || role === "customer" || role === "owner" || role === "user";
  }
  function resolveIdentity() {
    state.authLoading = true;
    state.customerLoading = true;
    state.authError = "";
    softUpdate({ keepScroll: true });
    if (!hasAuthSession()) {
      state.authLoading = false;
      state.customerLoading = false;
      state.identity = null;
      return Promise.resolve(null);
    }
    var auth = Auth();
    var ready = auth && auth.ensureSession ? withTimeout(auth.ensureSession(), 4000, "登录校验").catch(function () { return null; }) : Promise.resolve();
    return ready
      .then(function () {
        if (!hasAuthSession()) return null;
        return fetchJson("/api/auth?action=me", { _mcjTimeoutMs: 6000 });
      })
      .then(function (body) {
        if (!body || !body.user) return null;
        var user = body.user;
        if (!isBossLikeRole(user.role)) {
          var role = String(user.role || "").toLowerCase();
          if (role === "companion" || role === "player") {
            state.authError = "当前登录的是陪玩账号，请使用老板账号打开在线客服。";
          } else if (role === "customer_service" || role === "service") {
            state.authError = "当前登录的是客服账号，请使用老板账号打开在线客服。";
          } else {
            state.authError = "当前账号不是老板客户身份，无法使用老板端在线客服。";
          }
          state.identity = null;
          return null;
        }
        state.identity = {
          authUserId: user.id || "",
          customerId: user.id || "",
          bossId: user.id || "",
          bossUid: user.bossUid || user.boss_uid || "",
          role: user.role || "boss",
          email: user.email || "",
          displayName: user.displayName || "",
        };
        try {
          console.info("[support-chat] identity", state.identity);
        } catch (e) {}
        return state.identity;
      })
      .catch(function (err) {
        var msg = (err && err.message) || "账号资料加载失败，请重试";
        if (/登录|过期|未登录|请先登录/i.test(msg)) {
          state.authError = "请先登录后使用在线客服";
        } else {
          state.authError = msg;
        }
        state.identity = null;
        return null;
      })
      .finally(function () {
        state.authLoading = false;
        state.customerLoading = false;
      });
  }
  function orderId() {
    return q.get("order") || q.get("order_id") || "";
  }
  function conversationParam() {
    return q.get("conversation") || q.get("conversation_id") || "";
  }
  function wantsAutoOpen() {
    return !!(orderId() || conversationParam() || q.get("start") === "1" || q.get("from") === "gameplay");
  }
  function isMobile() {
    return !!(window.matchMedia && window.matchMedia("(max-width: 820px)").matches);
  }
  function pad(n) {
    return String(n).padStart(2, "0");
  }
  function shortTime(value) {
    if (!value) return "";
    var d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    var now = new Date();
    var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    var day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    var diff = Math.round((today - day) / 86400000);
    var hhmm = pad(d.getHours()) + ":" + pad(d.getMinutes());
    if (diff === 0) return "今天 " + hhmm;
    if (diff === 1) return "昨天 " + hhmm;
    return d.getMonth() + 1 + "月" + d.getDate() + "日 " + hhmm;
  }
  function toast(msg) {
    var text = String(msg || "").trim();
    if (!text) return;
    var box = root.querySelector("[data-support-toast]");
    if (!box) {
      box = document.createElement("div");
      box.className = "support-toast";
      box.setAttribute("data-support-toast", "1");
      root.appendChild(box);
    }
    box.textContent = text;
    box.classList.add("show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      box.classList.remove("show");
      toastTimer = null;
    }, 2600);
  }
  function parseCard(content) {
    try {
      var d = JSON.parse(content || "");
      if (d && (d.kind === "gameplay_product" || d.productId)) return d;
    } catch (e) {}
    return null;
  }
  function titleFor(c) {
    if (!c) return "在线客服";
    if (c.conversationType === "order_support" || c.orderId || c.order_id || c.orderNo || c.order_no) return "订单咨询";
    return "人工客服咨询";
  }
  function topStatusText(c) {
    var s = String((c && c.status) || "");
    if (s === "closed" || s === "ended") return "会话已结束";
    if (s === "open" || (c && (c.customerServiceId || c.customer_service_id))) return "客服已接入";
    if (s === "offline" || (state.serviceOnline === false && s !== "waiting_service" && s !== "waiting")) return "客服暂时离线";
    if (s === "waiting_service" || s === "waiting" || !s) return "等待客服接待";
    return "可重新发起咨询";
  }
  function isClosedConversation(c) {
    var s = String((c && c.status) || "");
    return s === "closed" || s === "ended";
  }
  function isOrderConversation(c) {
    return !!(c && (c.conversationType === "order_support" || c.orderId || c.order_id || c.orderNo || c.order_no));
  }
  function findOrderConversation(orderIdValue) {
    var list = (state.conversations || []).filter(function (c) {
      return String(c.orderId || c.order_id || "") === String(orderIdValue || "");
    });
    if (!list.length) return null;
    return (
      list.find(function (c) {
        return !isClosedConversation(c);
      }) || list[0]
    );
  }
  function syncChatChrome() {
    var inChat = !!(state.conversation && state.conversation.id && (state.mobileDetail || !isMobile()));
    document.body.classList.toggle("support-chat-live", inChat);
  }
  function syncUrl(conversation) {
    try {
      var u = new URL(location.href);
      if (!conversation || !conversation.id) {
        u.searchParams.delete("conversation");
        history.replaceState(null, "", u.pathname + u.search);
        q = new URLSearchParams(u.search);
        return;
      }
      u.searchParams.set("conversation", conversation.id);
      if (conversation.order_id || conversation.orderId) u.searchParams.set("order", conversation.order_id || conversation.orderId);
      history.replaceState(null, "", u.pathname + u.search);
      q = new URLSearchParams(u.search);
    } catch (e) {}
  }
  function orderMap() {
    var map = {};
    (state.orders || []).forEach(function (o) {
      map[o.id] = o;
    });
    return map;
  }
  function conversationOrder(c) {
    if (!c) return null;
    var id = c.orderId || c.order_id || "";
    return orderMap()[id] || null;
  }
  function patchMessages(opts) {
    opts = opts || {};
    var box = root.querySelector("[data-messages]");
    if (!box) return false;
    var prevBottom = box.scrollHeight - box.scrollTop;
    var stickBottom = !opts.keepScroll || prevBottom < 96;
    box.innerHTML = state.messages.length
      ? state.messages.map(msgHtml).join("")
      : '<div class="support-list-empty">发送第一条消息开始沟通。</div>';
    if (stickBottom) box.scrollTop = box.scrollHeight;
    else box.scrollTop = Math.max(0, box.scrollHeight - prevBottom);
    return true;
  }
  function msgHtml(m) {
    var card = m.message_type === "product_card" ? parseCard(m.content) : null;
    if (card) {
      return (
        '<div class="support-msg ' +
        (m.sender_role === "boss" ? "mine" : "") +
        '"><div class="support-product-card">' +
        (card.coverUrl ? '<img src="' + esc(card.coverUrl) + '" alt="">' : '<div class="support-product-cover">MEOW</div>') +
        "<div><strong>" +
        esc(card.name || "玩法商品") +
        "</strong><span>" +
        esc(card.pricingUnit || "每单") +
        "</span><small>" +
        esc(shortTime(m.created_at || "")) +
        "</small></div></div></div>"
      );
    }
    var mine = m.sender_role === "boss";
    var system = m.sender_role === "system" || m.message_type === "system";
    var failed = !!m._failed;
    var pending = !!m._pending;
    var Media = window.MCJChatMedia;
    var isImg = Media && Media.isImageMessage(m);
    var bodyHtml = isImg
      ? Media.imageBubbleHtml(Media.imageUrlOf(m), esc)
      : "<p>" + esc(m.content || "") + "</p>";
    return (
      '<div class="support-msg ' +
      (mine ? "mine" : "") +
      (system ? " system" : "") +
      (failed ? " failed" : "") +
      '" data-msg-id="' +
      esc(m.id || m._localId || "") +
      '">' +
      (system ? "" : "<strong>" + esc(m.sender_name || (mine ? "我" : "在线客服")) + "</strong>") +
      bodyHtml +
      (system
        ? ""
        : "<small>" +
          esc(shortTime(m.created_at || "")) +
          (pending ? " · 上传中…" : "") +
          (failed ? ' · 发送失败 <button type="button" class="support-inline-link" data-retry-msg="' + esc(m._localId || m.id || "") + '">重试</button>' : "") +
          "</small>") +
      "</div>"
    );
  }
  function authAccessToken() {
    return (
      localStorage.getItem("mcjAuthAccessToken") ||
      sessionStorage.getItem("mcjAuthAccessToken") ||
      ""
    );
  }
  function bindBossRealtime(conversationId) {
    var RT = window.MCJChatRealtime;
    var cid = String(conversationId || (state.conversation && state.conversation.id) || "").trim();
    if (!RT || !cid) return;
    RT.unsubscribeAll();
    RT.subscribeMessages(cid, authAccessToken(), function (row) {
      if (!row || !row.id) return;
      if (state.messages.some(function (m) { return m.id === row.id; })) return;
      // Drop matching optimistic pending/failed of same content within 2 minutes.
      state.messages = state.messages.filter(function (m) {
        if (!(m._pending || m._failed)) return true;
        return !(m.content === row.content && m.sender_role === "boss");
      });
      state.messages = state.messages.concat([row]);
      if (root.querySelector("[data-messages]")) patchMessages({ keepScroll: false });
      else softUpdate({ keepScroll: false });
    }).then(function () {
      state.realtimeReady = true;
    }).catch(function () {
      state.realtimeReady = false;
    });
  }
  function captureComposer() {
    var input = root.querySelector(COMPOSER_SEL);
    if (!input) return;
    state.composerDraft = String(input.value || "");
    if (document.activeElement === input) state.composerFocused = true;
  }
  function focusComposer() {
    var input = root.querySelector(COMPOSER_SEL);
    if (!input || input.disabled) return;
    try { input.focus({ preventScroll: true }); } catch (e) { try { input.focus(); } catch (e2) {} }
    try {
      var len = String(input.value || "").length;
      input.setSelectionRange(len, len);
    } catch (e3) {}
  }
  function syncComposerChrome() {
    var input = root.querySelector(COMPOSER_SEL);
    var btn = root.querySelector("[data-send-btn]");
    if (btn) {
      var empty = !(input && String(input.value || state.composerDraft || "").trim());
      btn.disabled = !!state.sending || empty;
      btn.textContent = state.sending ? "发送中…" : "发送";
    }
    if (!input) return;
    input.readOnly = !!state.sending;
    if (document.activeElement !== input && String(input.value || "") !== String(state.composerDraft || "")) {
      input.value = state.composerDraft || "";
    }
    try {
      input.style.height = "44px";
      var nextH = Math.min(120, Math.max(44, input.scrollHeight));
      input.style.height = nextH + "px";
    } catch (e) {}
    if (state.composerFocused && document.activeElement !== input && !state.sending) focusComposer();
  }
  function withTimeout(promise, ms, label) {
    var settled = false;
    return new Promise(function (resolve, reject) {
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        reject(new Error((label || "请求") + "超时，请重试"));
      }, ms || 2500);
      Promise.resolve(promise).then(function (value) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      }, function (err) {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      });
    });
  }
  function fetchJson(url, init) {
    var auth = Auth();
    if (!auth || typeof auth.authFetch !== "function") return Promise.reject(new Error("鉴权模块未加载"));
    var ms = init && init._mcjTimeoutMs != null ? init._mcjTimeoutMs : 8000;
    var opts = Object.assign({}, init || {});
    delete opts._mcjTimeoutMs;
    return withTimeout(auth.authFetch(url, opts), ms, "客服接口");
  }
  function loadList() {
    return fetchJson("/api/chat?action=conversations").then(function (body) {
      state.conversations = (body.conversations || []).map(function (c) {
        c.conversationType = c.conversationType || (c.orderId || c.order_id ? "order_support" : "general_support");
        c.unreadCount = Number(c.unreadCount || c.unread_count || 0);
        return c;
      });
      if (body.identity) {
        state.identity = Object.assign({}, state.identity || {}, body.identity);
        try {
          console.info("[support-chat] chat identity", body.identity);
        } catch (e) {}
      }
      if (typeof body.serviceOnline === "boolean") state.serviceOnline = body.serviceOnline;
      if (body.serviceStatus) state.serviceStatus = body.serviceStatus;
      return body;
    });
  }
  function loadOrders() {
    return fetchJson("/api/orders").then(function (body) {
      state.orders = body.orders || [];
      if (body.identity) {
        try {
          console.info("[support-chat] orders identity", body.identity);
        } catch (e) {}
      }
      return state.orders;
    }).catch(function () {
      state.orders = [];
      return [];
    });
  }
  function loadThread(conversationId, silent) {
    var cid = conversationId || (state.conversation && state.conversation.id) || conversationParam();
    if (!cid) return Promise.resolve(null);
    return fetchJson("/api/chat?conversation_id=" + encodeURIComponent(cid)).then(function (body) {
      applyPayload(body, { keepScroll: !!silent });
      return body;
    });
  }
  function openConversation(payload) {
    if (state.opening) {
      return Promise.reject(new Error("正在创建会话，请稍候…"));
    }
    state.opening = true;
    state.error = "";
    softUpdate({ keepScroll: true });
    var bodyPayload = Object.assign({ action: "open" }, payload || {});
    // Never send empty IDs that confuse the API.
    if (!bodyPayload.order_id && !bodyPayload.orderId) {
      delete bodyPayload.order_id;
      delete bodyPayload.orderId;
    }
    if (!bodyPayload.conversation_id && !bodyPayload.conversationId) {
      delete bodyPayload.conversation_id;
      delete bodyPayload.conversationId;
    }
    return fetchJson("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodyPayload),
      _mcjTimeoutMs: 12000,
    }).then(function (body) {
      if (!body || !body.ok || !(body.conversation && body.conversation.id)) {
        throw new Error((body && body.message) || "创建客服会话失败，请稍后重试。");
      }
      state.composerDraft = "";
      state.mobileDetail = true;
      applyPayload(body, { keepScroll: false });
      toast(body.created ? "已创建新的客服会话" : "已进入客服会话");
      return body;
    }).catch(function (err) {
      var msg = String((err && err.message) || "创建客服会话失败，请稍后重试。");
      if (/正在创建会话/.test(msg)) {
        toast(msg);
        return Promise.reject(err);
      }
      state.error = msg;
      toast(msg);
      softUpdate({ keepScroll: true });
      throw err;
    }).finally(function () {
      state.opening = false;
      state.loading = false;
      softUpdate({ keepScroll: true });
    });
  }
  function pickConversation(list) {
    var oid = orderId();
    var cid = conversationParam();
    if (cid) return list.find(function (c) { return c.id === cid; }) || null;
    if (oid) {
      var orderList = list.filter(function (c) { return String(c.orderId || c.order_id || "") === String(oid); });
      return (
        orderList.find(function (c) { return !isClosedConversation(c); }) ||
        orderList[0] ||
        null
      );
    }
    return list.find(function (c) { return !isClosedConversation(c); }) || list[0] || null;
  }
  function orderSummaryHtml(order) {
    if (!order) return "";
    return (
      '<section class="support-order-summary' +
      (state.orderCardOpen ? " is-open" : "") +
      '"><button class="support-order-summary-toggle" type="button" data-toggle-order-card>' +
      '<div class="support-order-summary-meta">' +
      "<strong>订单 " +
      esc(order.orderNo || order.id) +
      "</strong>" +
      "<span>状态：" +
      esc(order.statusText || order.status || "-") +
      "</span>" +
      "<span>陪玩：" +
      esc(order.acceptStatus || order.companionName || "待安排") +
      "</span></div><span>" +
      (state.orderCardOpen ? "收起" : "展开") +
      "</span></button>" +
      '<div class="support-order-summary-body">' +
      "<div><span>陪玩昵称</span><strong>" +
      esc(order.companionName || "待安排") +
      "</strong></div>" +
      "<div><span>游戏/服务</span><strong>" +
      esc(order.serviceType || order.game || "-") +
      "</strong></div>" +
      "<div><span>支付状态</span><strong>" +
      esc(order.paymentStatus || "-") +
      "</strong></div></div></section>"
    );
  }
  function railHtml() {
    var order = state.conversation ? conversationOrder(state.conversation) : null;
    if (!hasAuthSession()) {
      return '<aside class="support-rail"><div class="support-rail-head"><div><h2>订单信息</h2><p>登录后可查看</p></div></div><div class="support-rail-empty">请先登录</div></aside>';
    }
    if (!order) {
      return (
        '<aside class="support-rail"><div class="support-rail-head"><div><h2>订单信息</h2><p>当前会话未绑定订单</p></div></div>' +
        '<div class="support-rail-empty">人工客服咨询无需订单卡片。<br>从订单咨询进入后会显示订单详情。</div></aside>'
      );
    }
    return (
      '<aside class="support-rail"><div class="support-rail-head"><div><h2>订单信息</h2><p>当前咨询关联订单</p></div></div>' +
      '<div class="support-rail-body">' +
      '<div class="support-rail-row"><span>订单号</span><strong>' +
      esc(order.orderNo || order.id) +
      "</strong></div>" +
      '<div class="support-rail-row"><span>订单状态</span><strong>' +
      esc(order.statusText || order.status || "-") +
      "</strong></div>" +
      '<div class="support-rail-row"><span>支付状态</span><strong>' +
      esc(order.paymentStatus || "-") +
      "</strong></div>" +
      '<div class="support-rail-row"><span>陪玩状态</span><strong>' +
      esc(order.acceptStatus || "-") +
      "</strong></div>" +
      '<div class="support-rail-row"><span>陪玩昵称</span><strong>' +
      esc(order.companionName || "待安排") +
      "</strong></div>" +
      '<div class="support-rail-row"><span>游戏/服务</span><strong>' +
      esc(order.serviceType || order.game || "-") +
      "</strong></div>" +
      '<div class="support-rail-row"><span>金额</span><strong>' +
      esc(order.totalAmount != null ? order.totalAmount + " 猫粮" : "-") +
      "</strong></div>" +
      '<a class="support-inline-link" href="orders.html?id=' +
      encodeURIComponent(order.id) +
      '">查看订单详情</a></div></aside>'
    );
  }
  function listHtml() {
    var activeId = state.conversation && state.conversation.id;
    var general = state.conversations.filter(function (c) {
      return !(c.conversationType === "order_support" || c.orderId || c.order_id || c.orderNo || c.order_no);
    });
    var orders = state.orders || [];
    if (!general.length && !orders.length) {
      return '<div class="support-empty-panel support-empty-list"><strong>暂无客服会话</strong><span>需要帮助时，可以联系人工客服，或从订单详情发起订单咨询。</span><button class="support-btn primary" type="button" data-contact-service>联系人工客服</button></div>';
    }
    var blocks = [];
    blocks.push('<section class="support-list-block"><div class="support-list-actions"><button class="support-btn primary" type="button" data-contact-service>' + (state.creatingGeneral ? '创建中…' : '新建人工客服咨询') + '</button></div><div class="support-list-caption">人工客服咨询</div>' + (general.length ? general.map(function (c) {
      return '<button type="button" class="support-session support-general' + (activeId && c.id === activeId ? ' active' : '') + '" data-select-conversation="' + esc(c.id) + '"><div class="support-session-main"><strong>人工客服咨询</strong><span>' + esc(c.lastMessage || '暂无消息') + '</span></div><small>' + esc(shortTime(c.lastMessageAt || c.updatedAt || '')) + '</small></button>';
    }).join('') : '<div class="support-list-empty">暂无人工客服会话</div>') + '</section>');
    blocks.push('<section class="support-list-block"><div class="support-list-caption">订单咨询</div>' + (orders.length ? orders.map(function (o) {
      var conv = findOrderConversation(o.id);
      var unread = conv && Number(conv.unreadCount || 0) ? '<em class="support-unread">' + esc(Number(conv.unreadCount || 0) > 99 ? '99+' : conv.unreadCount) + '</em>' : '';
      return '<button type="button" class="support-session support-order-card' + (activeId && conv && conv.id === activeId ? ' active' : '') + '" data-open-order-conversation="' + esc(o.id) + '"><div class="support-order-top"><strong title="' + esc(o.orderNo || o.id) + '">订单号：' + esc(o.orderNo || o.id) + '</strong><span class="support-status-pill">' + esc(o.statusText || o.status || '-') + '</span></div><div class="support-order-grid"><span>陪玩昵称</span><b>' + esc(o.companionName || '待安排') + '</b><span>游戏/服务</span><b>' + esc(o.serviceType || o.game || '-') + '</b></div><div class="support-order-last"><span>' + esc(conv ? (isClosedConversation(conv) ? '会话已结束 · 可重新发起' : (conv.lastMessage || '暂无消息')) : '点击发起订单咨询') + '</span><small>' + esc(shortTime((conv && (conv.lastMessageAt || conv.updatedAt)) || o.createdAt || '')) + '</small></div>' + unread + '</button>';
    }).join('') : '<div class="support-list-empty">暂无订单，可从我的订单发起订单咨询。</div>') + '</section>');
    return blocks.join('');
  }
  function mainHtml() {
    if (state.authLoading || state.customerLoading) {
      return '<div class="support-empty-panel"><strong>正在加载账号资料</strong><span>请稍候，正在确认登录身份…</span></div>';
    }
    if (!hasAuthSession() || /请先登录/.test(String(state.authError || ""))) {
      return (
        '<div class="support-login-panel"><strong>请先登录后使用在线客服</strong><br>' +
        '<a class="support-btn primary" href="index.html?login=1&redirect=' +
        encodeURIComponent(location.pathname + location.search) +
        '">立即登录</a></div>'
      );
    }
    if (state.authError) {
      return (
        '<div class="support-empty-panel"><strong>账号资料加载失败</strong><span>' +
        esc(state.authError) +
        '</span><button class="support-btn" type="button" data-refresh>重试</button></div>'
      );
    }
    if (!state.identity) {
      return '<div class="support-empty-panel"><strong>账号资料加载失败，请重试</strong><button class="support-btn" type="button" data-refresh>重试</button></div>';
    }
    if (state.loading && !state.conversation && !state.conversations.length && !state.error) {
      return '<div class="support-empty-panel"><strong>正在加载客服会话…</strong><span>请稍候</span></div>';
    }
    if (state.error && !state.conversation) {
      return (
        '<div class="support-empty-panel"><strong>加载失败</strong><span>' +
        esc(state.error) +
        '</span><button class="support-btn" type="button" data-refresh>重试</button></div>'
      );
    }
    if (!state.conversation) return '<div class="support-empty-panel"><strong>请选择一个会话</strong><span>先从会话列表进入聊天。</span></div>';
    var order = conversationOrder(state.conversation);
    var serviceName = state.conversation.customerServiceName || state.conversation.serviceName || '在线客服';
    var orderNo = state.conversation.orderNo || state.conversation.order_no || (order && order.orderNo) || '';
    var chatStatus = topStatusText(state.conversation);
    if (isClosedConversation(state.conversation)) chatStatus = '会话已结束 · 可重新发起咨询';
    else if (state.serviceStatus && !/重新安排/.test(String(state.serviceStatus || ''))) {
      if (/等待客服接待|客服暂时离线|客服已接入|正在为您服务|会话已结束/.test(String(state.serviceStatus))) {
        chatStatus = state.serviceStatus;
      }
    }
    return (
      '<header class="support-main-head"><div class="support-main-title"><button class="support-back-btn" type="button" data-back-list>返回</button><div class="support-main-copy"><h2>' +
      esc(state.conversation.customerServiceId || state.conversation.customer_service_id ? serviceName : '在线客服') +
      '</h2>' +
      (orderNo ? '<p class="support-order-no" title="' + esc(orderNo) + '">订单 ' + esc(orderNo) + '</p>' : '<p>人工客服咨询</p>') +
      '<p class="support-chat-status">' + esc(chatStatus) + '</p>' +
      '</div></div><button class="support-btn" type="button" data-refresh>刷新</button></header>' +
      (order ? orderSummaryHtml(order) : '') +
      '<div class="support-messages" data-messages>' +
      (state.messages.length ? state.messages.map(msgHtml).join('') : '<div class="support-list-empty">你可以先留言，客服上线后会尽快回复。</div>') +
      '</div>' +
      '<div class="support-footer" data-support-footer>' +
      composerHtml() +
      '</div>'
    );
  }
  function composerHtml() {
    if (isClosedConversation(state.conversation)) {
      var orderMode = isOrderConversation(state.conversation);
      return (
        '<div class="support-ended-panel" data-ended-panel>' +
        '<p>本次客服会话已结束。</p>' +
        '<p class="support-ended-hint">旧记录可继续查看；如需帮助请重新发起咨询。</p>' +
        '<div class="support-ended-actions">' +
        '<button type="button" class="support-btn primary" data-reopen-chat>' +
        (orderMode ? '重新发起订单咨询' : '重新联系人工客服') +
        '</button>' +
        '<button type="button" class="support-btn" data-back-list>返回会话列表</button>' +
        '</div></div>'
      );
    }
    var empty = !String(state.composerDraft || '').trim();
    return (
      (state.emojiOpen
        ? '<div class="support-emoji-panel" data-emoji-panel>' +
          EMOJIS.map(function (e) {
            return '<button type="button" data-emoji="' + esc(e) + '">' + e + '</button>';
          }).join('') +
          '</div>'
        : '') +
      '<form class="support-composer" data-send>' +
      '<div class="support-composer-tools mcj-composer-tools">' +
      '<button class="support-tool-btn mcj-composer-tool" type="button" data-toggle-emoji aria-label="表情">😊</button>' +
      '<button class="support-tool-btn mcj-composer-tool" type="button" data-chat-image-btn aria-label="图片">🖼</button>' +
      '</div>' +
      '<textarea name="content" rows="1" enterkeyhint="send" placeholder="输入消息，Enter 发送，Shift+Enter 换行" autocomplete="off" maxlength="2000">' +
      esc(state.composerDraft || '') +
      '</textarea>' +
      '<button class="support-send-btn" type="submit" data-send-btn' +
      (state.sending || empty ? ' disabled' : '') +
      '>' +
      (state.sending ? '发送中…' : '发送') +
      '</button></form>' +
      '<div class="mcj-upload-status" data-upload-status></div>'
    );
  }
  function canSoftPatch() {
    return !!(
      root.querySelector('.support-layout') &&
      root.querySelector('.support-aside') &&
      root.querySelector('.support-main') &&
      root.querySelector('.support-rail')
    );
  }
  function patchSessionList() {
    var list = root.querySelector('.support-session-list');
    if (list) list.innerHTML = listHtml();
  }
  function patchMain() {
    var main = root.querySelector('.support-main');
    if (main) main.innerHTML = mainHtml();
  }
  function patchRail() {
    var rail = root.querySelector('.support-rail');
    if (!rail) return;
    var wrap = document.createElement('div');
    wrap.innerHTML = railHtml();
    var next = wrap.firstElementChild;
    if (next) rail.replaceWith(next);
  }
  function softUpdate(opts) {
    opts = opts || {};
    captureComposer();
    syncChatChrome();
    if (canSoftPatch()) {
      var box = root.querySelector('[data-messages]');
      var prevBottom = box ? box.scrollHeight - box.scrollTop : 0;
      var stickBottom = !opts.keepScroll || prevBottom < 96;
      var prevScroll = box ? box.scrollTop : 0;
      patchSessionList();
      patchMain();
      patchRail();
      var next = root.querySelector('[data-messages]');
      if (next) {
        if (stickBottom) next.scrollTop = next.scrollHeight;
        else next.scrollTop = Math.max(0, prevScroll);
      }
      syncComposerChrome();
      return;
    }
    paint(opts);
  }
  function paint(opts) {
    opts = opts || {};
    captureComposer();
    syncChatChrome();
    var keepFocus = !!state.composerFocused;
    root.innerHTML =
      '<section class="support-layout' +
      (state.mobileDetail ? ' mobile-detail' : '') +
      '" aria-label="在线客服">' +
      '<aside class="support-aside"><div class="support-aside-head"><div><h1>在线客服</h1><p>会话列表</p></div></div><div class="support-session-list">' +
      listHtml() +
      '</div></aside>' +
      '<div class="support-main">' +
      mainHtml() +
      '</div>' +
      railHtml() +
      '</section>';
    var next = root.querySelector('[data-messages]');
    if (next) next.scrollTop = next.scrollHeight;
    syncComposerChrome();
    if (keepFocus) {
      state.composerFocused = true;
      setTimeout(focusComposer, 0);
    }
  }
  function applyPayload(body, opts) {
    opts = opts || {};
    if (Array.isArray(body.conversations)) state.conversations = body.conversations;
    var prevCid = state.conversation && state.conversation.id;
    if (body.conversation) {
      state.conversation = body.conversation;
      state.mobileDetail = true;
      syncUrl(body.conversation);
    }
    if (Array.isArray(body.messages)) {
      // Preserve failed local drafts across silent polls.
      var failedLocals = (state.messages || []).filter(function (m) { return m._failed || m._pending; });
      var remote = body.messages.slice();
      failedLocals.forEach(function (local) {
        if (!remote.some(function (m) { return m.content === local.content && m.sender_role === "boss"; })) {
          remote.push(local);
        }
      });
      state.messages = remote;
    } else if (body.appended || body.row) {
      var added = body.appended || body.row;
      if (added && added.content) {
        var exists = state.messages.some(function (m) {
          return (added.id && m.id && String(m.id) === String(added.id)) || (m.sender_role === added.sender_role && m.content === added.content && Math.abs(new Date(m.created_at || 0) - new Date(added.created_at || 0)) < 5000);
        });
        if (!exists) state.messages = state.messages.concat([added]);
      }
    }
    if (typeof body.serviceOnline === 'boolean') state.serviceOnline = body.serviceOnline;
    if (body.serviceStatus) state.serviceStatus = body.serviceStatus;
    state.error = '';
    softUpdate(opts);
    var nextCid = state.conversation && state.conversation.id;
    if (nextCid && nextCid !== prevCid) bindBossRealtime(nextCid);
    else if (nextCid && !state.realtimeReady) bindBossRealtime(nextCid);
  }
  function bootstrap() {
    paint();
    state.loading = true;
    state.error = "";
    state.authError = "";
    return resolveIdentity()
      .then(function (identity) {
        softUpdate({ keepScroll: true });
        if (!identity) {
          state.loading = false;
          softUpdate({ keepScroll: true });
          return null;
        }
        return Promise.all([loadList(), loadOrders()]).then(function () {
          state.loading = false;
          softUpdate({ keepScroll: true });
          var oid = orderId();
          var cid = conversationParam();
          var picked = pickConversation(state.conversations);
          if (oid && (!picked || String(picked.orderId || "") !== String(oid))) return openConversation({ order_id: oid });
          if (cid && !picked) return loadThread(cid, false);
          if (picked) {
            state.conversation = Object.assign({}, picked, {
              id: picked.id,
              order_id: picked.orderId || "",
              customer_service_id: picked.customerServiceId || "",
            });
            state.mobileDetail = isMobile();
            syncUrl(state.conversation);
            return loadThread(picked.id, false);
          }
          if (wantsAutoOpen()) return openConversation(oid ? { order_id: oid } : {});
          state.conversation = null;
          state.messages = [];
          state.mobileDetail = false;
          softUpdate({ keepScroll: true });
          return null;
        });
      })
      .catch(function (err) {
        var msg = err.message || "消息读取失败";
        // Never surface the old misleading boss-only copy as a generic load failure without context.
        if (/只有老板账号/.test(msg)) {
          state.authError = "当前账号不是老板客户身份，无法使用老板端在线客服。";
          state.error = "";
        } else if (/请先登录|登录已过期|未登录/i.test(msg)) {
          state.authError = "请先登录后使用在线客服";
          state.error = "";
        } else {
          state.error = msg;
        }
        softUpdate({ keepScroll: true });
      })
      .finally(function () {
        state.loading = false;
        state.opening = false;
        state.authLoading = false;
        state.customerLoading = false;
        softUpdate({ keepScroll: true });
      });
  }
  function startPoll() {
    if (state.pollTimer) clearInterval(state.pollTimer);
    state.pollTimer = setInterval(function () {
      if (!hasAuthSession() || state.sending || state.opening || document.hidden) return;
      if (!state.conversation || !state.conversation.id) {
        loadList().then(function () { softUpdate({ keepScroll: true }); }).catch(function () {});
        return;
      }
      // Realtime is primary; poll only active thread + conversation list (orders load on demand).
      Promise.all([loadList(), loadThread(state.conversation.id, true)]).catch(function () {});
    }, 10000);
  }

  root.addEventListener('input', function (e) {
    if (!e.target || !e.target.matches || !e.target.matches(COMPOSER_SEL)) return;
    state.composerDraft = String(e.target.value || '');
    state.composerFocused = true;
    syncComposerChrome();
  }, true);
  root.addEventListener('focusin', function (e) {
    if (!e.target || !e.target.matches || !e.target.matches(COMPOSER_SEL)) return;
    state.composerFocused = true;
  }, true);
  root.addEventListener('focusout', function (e) {
    if (!e.target || !e.target.matches || !e.target.matches(COMPOSER_SEL)) return;
    state.composerDraft = String(e.target.value || '');
    setTimeout(function () {
      var ae = document.activeElement;
      if (!(ae && ae.matches && ae.matches(COMPOSER_SEL))) state.composerFocused = false;
    }, 0);
  }, true);
  root.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing || e.keyCode === 229) return;
    if (!e.target || !e.target.matches || !e.target.matches(COMPOSER_SEL)) return;
    e.preventDefault();
    var form = e.target.closest('[data-send]');
    if (form) form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  }, true);

  document.addEventListener('click', function (e) {
    var contact = e.target.closest('[data-contact-service]');
    if (contact) {
      e.preventDefault();
      if (!hasAuthSession()) {
        location.href = 'index.html?login=1';
        return;
      }
      if (state.opening || state.creatingGeneral) {
        toast('正在创建会话，请稍候…');
        return;
      }
      state.creatingGeneral = true;
      softUpdate({ keepScroll: true });
      // Prefer reuse of an active general thread; forceNew when current thread is closed.
      var needNew = isClosedConversation(state.conversation);
      openConversation(needNew ? { action: 'reopen', forceNew: true } : { action: 'open' })
        .then(startPoll)
        .catch(function () {})
        .finally(function () {
          state.creatingGeneral = false;
          softUpdate({ keepScroll: true });
        });
      return;
    }
    var reopen = e.target.closest('[data-reopen-chat]');
    if (reopen) {
      e.preventDefault();
      if (!hasAuthSession()) {
        location.href = 'index.html?login=1';
        return;
      }
      if (state.opening || state.creatingGeneral) {
        toast('正在创建会话，请稍候…');
        return;
      }
      var cur = state.conversation || {};
      var oid = String(cur.orderId || cur.order_id || orderId() || '').trim();
      var payload = oid
        ? { action: 'reopen', forceNew: true, order_id: oid }
        : { action: 'reopen', forceNew: true };
      openConversation(payload)
        .then(startPoll)
        .catch(function () {});
      return;
    }
    var emojiToggle = e.target.closest('[data-toggle-emoji]');
    if (emojiToggle) {
      state.emojiOpen = !state.emojiOpen;
      softUpdate({ keepScroll: true });
      return;
    }
    var imgBtn = e.target.closest('[data-chat-image-btn]');
    if (imgBtn && root.contains(imgBtn)) {
      e.preventDefault();
      if (!hasAuthSession()) {
        location.href = 'index.html?login=1';
        return;
      }
      if (isClosedConversation(state.conversation)) {
        toast('本次客服会话已结束，请重新发起咨询。');
        return;
      }
      if (!state.conversation || !state.conversation.id) {
        openConversation(orderId() ? { order_id: orderId() } : {}).then(function () {
          imgBtn.click();
        }).catch(function () {});
        return;
      }
      var Media = window.MCJChatMedia;
      if (!Media) {
        toast('图片组件未加载');
        return;
      }
      var statusEl = root.querySelector('[data-upload-status]');
      var token = authAccessToken();
      Media.pickAndSendImages({
        token: token,
        multiple: true,
        onStatus: function (t) {
          if (statusEl) statusEl.textContent = t || '';
        },
        onError: function (err) {
          toast((err && err.message) || '发送失败');
        },
        onUploaded: function (url) {
          return sendImageMessage(url);
        },
      }).then(function () {
        if (statusEl) setTimeout(function () { statusEl.textContent = ''; }, 1500);
      });
      return;
    }
    var emojiBtn = e.target.closest('[data-emoji]');
    if (emojiBtn) {
      var emoji = emojiBtn.getAttribute('data-emoji') || '';
      state.composerDraft = String(state.composerDraft || '') + emoji;
      state.composerFocused = true;
      softUpdate({ keepScroll: true });
      setTimeout(focusComposer, 0);
      return;
    }
    var refresh = e.target.closest('[data-refresh]');
    if (refresh) {
      bootstrap();
      return;
    }
    var select = e.target.closest('[data-select-conversation]');
    if (select) {
      var id = select.getAttribute('data-select-conversation');
      if (!id) return;
      captureComposer();
      state.conversation = { id: id };
      state.mobileDetail = true;
      state.emojiOpen = false;
      state.loading = true;
      paint();
      loadThread(id, false).catch(function (err) {
        state.error = err.message || '读取会话失败';
        toast(state.error);
      }).finally(function () {
        state.loading = false;
        softUpdate();
      });
      return;
    }
    var orderSelect = e.target.closest('[data-open-order-conversation]');
    if (orderSelect) {
      var oid2 = orderSelect.getAttribute('data-open-order-conversation');
      if (!oid2) return;
      var existingOrderConv = findOrderConversation(oid2);
      state.creatingOrder = oid2;
      state.emojiOpen = false;
      if (existingOrderConv && isClosedConversation(existingOrderConv)) {
        openConversation({ action: 'reopen', forceNew: true, order_id: oid2 }).catch(function () {}).finally(function () {
          state.creatingOrder = '';
          softUpdate({ keepScroll: true });
        });
        return;
      }
      openConversation({ order_id: oid2 }).catch(function () {}).finally(function () {
        state.creatingOrder = '';
        softUpdate({ keepScroll: true });
      });
      return;
    }
    if (e.target.closest('[data-back-list]')) {
      state.mobileDetail = false;
      state.emojiOpen = false;
      state.conversation = null;
      state.messages = [];
      syncUrl(null);
      syncChatChrome();
      paint({ keepScroll: true });
      loadList().then(function () { softUpdate({ keepScroll: true }); }).catch(function () {});
      return;
    }
    if (e.target.closest('[data-toggle-order-card]')) {
      state.orderCardOpen = !state.orderCardOpen;
      paint({ keepScroll: true });
    }
  });

  function sendImageMessage(url) {
    if (!url || !state.conversation || !state.conversation.id) return Promise.resolve();
    var localId = 'local-img-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    var optimistic = {
      _localId: localId,
      _pending: true,
      id: localId,
      sender_role: 'boss',
      message_type: 'image',
      content: url,
      created_at: new Date().toISOString(),
      sender_name: '我',
    };
    state.messages = state.messages.concat([optimistic]);
    softUpdate({ keepScroll: false });
    var payload = {
      action: 'send',
      content: url,
      message_type: 'image',
      conversation_id: state.conversation.id,
    };
    var oid = orderId() || state.conversation.order_id || state.conversation.orderId || '';
    if (oid) payload.order_id = oid;
    return fetchJson('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      _mcjTimeoutMs: 12000,
    })
      .then(function (body) {
        var serverMsg = body.appended || body.row || null;
        state.messages = state.messages.filter(function (m) {
          return m._localId !== localId;
        });
        if (serverMsg && !state.messages.some(function (m) { return m.id === serverMsg.id; })) {
          state.messages = state.messages.concat([serverMsg]);
        }
        softUpdate({ keepScroll: false });
      })
      .catch(function (err) {
        state.messages = state.messages.map(function (m) {
          if (m._localId !== localId) return m;
          return Object.assign({}, m, { _pending: false, _failed: true });
        });
        softUpdate({ keepScroll: true });
        toast(err.message || '图片发送失败，可点击重试');
      });
  }

  document.addEventListener('submit', function (e) {
    if (!e.target.matches('[data-send]')) return;
    e.preventDefault();
    if (!hasAuthSession()) {
      location.href = 'index.html?login=1';
      return;
    }
    captureComposer();
    var content = String(state.composerDraft || '').trim();
    if (!content || state.sending) return;
    if (isClosedConversation(state.conversation)) {
      toast('本次客服会话已结束，请重新发起咨询。');
      softUpdate({ keepScroll: true });
      return;
    }
    if (!state.conversation || !state.conversation.id) {
      openConversation(orderId() ? { order_id: orderId() } : {}).then(function () {
        e.target.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
      }).catch(function () {});
      return;
    }
    state.sending = true;
    state.composerFocused = true;
    var localId = 'local-' + Date.now();
    var optimistic = { _localId: localId, _pending: true, id: localId, sender_role: 'boss', message_type: 'text', content: content, created_at: new Date().toISOString(), sender_name: '我' };
    state.messages = state.messages.concat([optimistic]);
    state.composerDraft = '';
    var inputClear = root.querySelector(COMPOSER_SEL);
    if (inputClear) inputClear.value = '';
    softUpdate({ keepScroll: false });
    var payload = { action: 'send', content: content, conversation_id: state.conversation.id };
    var oid = orderId() || state.conversation.order_id || state.conversation.orderId || '';
    if (oid) payload.order_id = oid;
    fetchJson('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), _mcjTimeoutMs: 6000 }).then(function (body) {
      var serverMsg = body.appended || body.row || null;
      state.messages = state.messages.filter(function (m) { return m._localId !== localId; });
      if (serverMsg) {
        if (!state.messages.some(function (m) { return m.id === serverMsg.id; })) {
          state.messages = state.messages.concat([serverMsg]);
        }
      }
      if (body.conversation) state.conversation = body.conversation;
      if (typeof body.serviceOnline === 'boolean') state.serviceOnline = body.serviceOnline;
      if (body.serviceStatus) state.serviceStatus = body.serviceStatus;
      softUpdate({ keepScroll: false });
    }).catch(function (err) {
      state.messages = state.messages.map(function (m) {
        if (m._localId !== localId) return m;
        return Object.assign({}, m, { _pending: false, _failed: true });
      });
      softUpdate({ keepScroll: true });
      toast(err.message || '发送失败，可点击重试');
    }).finally(function () {
      state.sending = false;
      state.composerFocused = true;
      syncComposerChrome();
      setTimeout(focusComposer, 0);
    });
  });

  document.addEventListener('click', function (e) {
    var retry = e.target.closest('[data-retry-msg]');
    if (!retry || !root.contains(retry)) return;
    e.preventDefault();
    var lid = retry.getAttribute('data-retry-msg');
    var failed = (state.messages || []).find(function (m) { return String(m._localId || m.id) === String(lid); });
    if (!failed || !failed.content || state.sending) return;
    state.messages = state.messages.filter(function (m) { return String(m._localId || m.id) !== String(lid); });
    var Media = window.MCJChatMedia;
    if (failed.message_type === 'image' || (Media && Media.isImageMessage(failed))) {
      softUpdate({ keepScroll: true });
      sendImageMessage(Media ? Media.imageUrlOf(failed) : failed.content);
      return;
    }
    state.composerDraft = failed.content;
    var form = root.querySelector('[data-send]');
    if (form) form.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
  });

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && hasAuthSession()) bootstrap();
  });

  function syncKeyboardInset() {
    try {
      var vv = window.visualViewport;
      if (!vv) {
        document.documentElement.style.setProperty("--support-keyboard-inset", "0px");
        return;
      }
      var inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      document.documentElement.style.setProperty("--support-keyboard-inset", inset + "px");
      if (inset > 40 && state.composerFocused) {
        var messages = root.querySelector("[data-messages]");
        if (messages) messages.scrollTop = messages.scrollHeight;
      }
    } catch (e) {}
  }
  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", syncKeyboardInset);
    window.visualViewport.addEventListener("scroll", syncKeyboardInset);
  }
  window.addEventListener("resize", syncKeyboardInset);
  syncKeyboardInset();

  if (window.MCJChatMedia) window.MCJChatMedia.bindLightboxClicks(root);
  paint();
  bootstrap().then(startPoll);
})();
