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
  var BOSS_CONSULT_TYPES = [
    { key: "other", label: "普通咨询（无需下单）", needsOrder: false },
    { key: "new_order", label: "新订单咨询", needsOrder: false },
    { key: "current_order", label: "当前订单问题", needsOrder: true },
    { key: "recharge", label: "充值问题", needsOrder: false },
    { key: "refund", label: "退款售后", needsOrder: true },
  ];

  /** Modal picker — never use browser prompt / number entry. */
  function pickBossConsultType(defaultKey) {
    return new Promise(function (resolve) {
      var existing = document.querySelector("[data-support-consult-modal]");
      if (existing) existing.remove();
      var def = String(defaultKey || "other");
      var orders = state.orders || [];
      var modal = document.createElement("div");
      modal.className = "support-consult-modal";
      modal.setAttribute("data-support-consult-modal", "1");
      modal.innerHTML =
        '<div class="support-consult-dialog" role="dialog" aria-modal="true" aria-labelledby="supportConsultTitle">' +
        '<div class="support-consult-head"><h3 id="supportConsultTitle">新建人工客服咨询</h3>' +
        '<button type="button" class="support-btn" data-consult-cancel>取消</button></div>' +
        '<p class="support-consult-hint">不同问题会进入独立会话；普通咨询无需先下单。</p>' +
        '<div class="support-consult-types" role="listbox" aria-label="咨询类型">' +
        BOSS_CONSULT_TYPES.map(function (t) {
          return (
            '<button type="button" class="support-consult-type' +
            (t.key === def ? " is-active" : "") +
            '" data-consult-type="' +
            esc(t.key) +
            '" data-needs-order="' +
            (t.needsOrder ? "1" : "0") +
            '">' +
            esc(t.label) +
            "</button>"
          );
        }).join("") +
        "</div>" +
        '<label class="support-consult-order" data-consult-order-wrap hidden>关联订单（可选）' +
        '<select data-consult-order><option value="">不关联订单</option>' +
        orders
          .map(function (o) {
            return (
              '<option value="' +
              esc(o.id) +
              '">' +
              esc(o.orderNo || o.id) +
              " · " +
              esc(o.statusText || o.status || "") +
              "</option>"
            );
          })
          .join("") +
        "</select></label>" +
        '<button type="button" class="support-btn primary" data-consult-confirm>创建会话</button>' +
        "</div>";
      document.body.appendChild(modal);
      var selected = def;
      function syncOrderWrap() {
        var hit = BOSS_CONSULT_TYPES.find(function (t) {
          return t.key === selected;
        });
        var wrap = modal.querySelector("[data-consult-order-wrap]");
        if (wrap) wrap.hidden = !(hit && hit.needsOrder);
      }
      syncOrderWrap();
      function finish(result) {
        try {
          modal.remove();
        } catch (e) {}
        resolve(result);
      }
      modal.addEventListener("click", function (ev) {
        if (ev.target === modal || ev.target.closest("[data-consult-cancel]")) {
          finish(null);
          return;
        }
        var typeBtn = ev.target.closest("[data-consult-type]");
        if (typeBtn) {
          selected = typeBtn.getAttribute("data-consult-type") || "other";
          modal.querySelectorAll("[data-consult-type]").forEach(function (b) {
            b.classList.toggle("is-active", b.getAttribute("data-consult-type") === selected);
          });
          syncOrderWrap();
          return;
        }
        if (ev.target.closest("[data-consult-confirm]")) {
          var orderSel = modal.querySelector("[data-consult-order]");
          var orderId = "";
          var hit = BOSS_CONSULT_TYPES.find(function (t) {
            return t.key === selected;
          });
          if (hit && hit.needsOrder && orderSel) {
            orderId = String(orderSel.value || "").trim();
          }
          finish({ consultType: selected || "other", orderId: orderId });
        }
      });
    });
  }

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function Auth() {
    return window.MCJBossAuth || null;
  }
  function sharedRoleHint() {
    try {
      var u = JSON.parse(sessionStorage.getItem("customerUser") || "{}");
      if (u && u.role) return String(u.role).toLowerCase();
    } catch (e) {}
    return String(sessionStorage.getItem("mcjRole") || "").toLowerCase();
  }
  function hasBossGateSession() {
    try {
      localStorage.removeItem("mcjAuthAccessToken");
      localStorage.removeItem("mcjAuthRefreshToken");
      localStorage.removeItem("customerAuthToken");
      localStorage.removeItem("customerUser");
    } catch (e0) {}
    if (window.MCJBossAuth && typeof window.MCJBossAuth.hasValidAccessToken === "function") {
      if (!window.MCJBossAuth.hasValidAccessToken()) return false;
    } else {
      var jwt = sessionStorage.getItem("mcjAuthAccessToken") || "";
      if (!jwt || String(jwt).split(".").length !== 3) return false;
    }
    var role = sharedRoleHint();
    if (role && role !== "boss" && role !== "customer" && role !== "user") return false;
    if (window.MCJRoleGate && typeof window.MCJRoleGate.isLogged === "function") {
      return !!(window.MCJRoleGate.isLogged("customer") || window.MCJRoleGate.isLogged("boss"));
    }
    return true;
  }
  function promptBossLogin(resumeFn) {
    if (window.MCJAuthContinue && typeof window.MCJAuthContinue.requireLogin === 'function') {
      window.MCJAuthContinue.requireLogin(typeof resumeFn === 'function' ? resumeFn : function () {
        resolveIdentity().then(function () {
          softUpdate({ keepScroll: true });
          if (hasAuthSession()) bootstrap();
        });
      });
      return;
    }
    if (window.MCJModal && typeof window.MCJModal.openLogin === 'function') {
      window.MCJModal.openLogin('login');
      return;
    }
    location.href = 'index.html#login';
  }

  function hasAuthSession() {
    return hasBossGateSession();
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
      // Foreign-role JWT left in shared keys: ask for boss login, do not claim CS identity on boss UI.
      var foreign = sharedRoleHint();
      if (foreign && !isBossLikeRole(foreign) && (
        localStorage.getItem("mcjAuthAccessToken") ||
        sessionStorage.getItem("mcjAuthAccessToken")
      )) {
        state.authError = "请先登录后使用在线客服";
      }
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
          // Stale foreign JWT: drop shared mirrors so boss UI stops reading CS/companion identity.
          if (window.MCJRoleGate && typeof window.MCJRoleGate.clearSharedAuthMirrors === "function") {
            window.MCJRoleGate.clearSharedAuthMirrors();
          } else {
            ["mcjAuthAccessToken", "mcjAuthRefreshToken", "mcjAuthExpiresAt", "mcjRole"].forEach(function (k) {
              try {
                localStorage.removeItem(k);
                sessionStorage.removeItem(k);
              } catch (e) {}
            });
          }
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
  function isAftersale() {
    return q.get("aftersale") === "1";
  }
  function draftParam() {
    return q.get("draft") || "";
  }
  function applyDraftFromQuery() {
    var draft = draftParam();
    if (!draft) return;
    if (String(state.composerDraft || "").trim()) return;
    state.composerDraft = draft;
    state.composerFocused = true;
    state.mobileDetail = true;
    try {
      var u = new URL(location.href);
      u.searchParams.delete("draft");
      history.replaceState(null, "", u.pathname + u.search);
      q = new URLSearchParams(u.search);
    } catch (e) {}
    softUpdate({ keepScroll: true });
    if (isAftersale()) toast("请补充售后原因后发送，客服会尽快跟进处理。");
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
    if (s === "pending_transfer") return "正在为你更换客服。";
    if (s === "open" || s === "active" || s === "serving" || (c && (c.customerServiceId || c.customer_service_id))) return "客服已接入";
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
  function parseCompanionCard(raw) {
    try {
      var o = typeof raw === "string" ? JSON.parse(raw) : raw;
      if (!o || typeof o !== "object") return null;
      if (o.type && o.type !== "companion_card" && !o.companionId) return null;
      return o;
    } catch (e) {
      return null;
    }
  }
  function msgHtml(m) {
    var mt = m.message_type || m.messageType || "";
    var companionCard =
      mt === "companion_card"
        ? parseCompanionCard(m.content)
        : mt === "text"
          ? (function () {
              var t = String(m.content || "").trim();
              if (t.charAt(0) !== "{") return null;
              var c = parseCompanionCard(t);
              return c && (c.type === "companion_card" || c.companionId) ? c : null;
            })()
          : null;
    if (companionCard) {
      var avatar = companionCard.avatarUrl
        ? '<img src="' + esc(companionCard.avatarUrl) + '" alt="" style="width:56px;height:56px;border-radius:12px;object-fit:cover">'
        : '<div class="support-product-cover">' + esc(String(companionCard.nickname || "陪").slice(0, 1)) + "</div>";
      return (
        '<div class="support-msg" data-msg-id="' +
        esc(m.id || "") +
        '"><div class="support-product-card support-companion-card" style="display:flex;gap:10px;align-items:flex-start">' +
        avatar +
        "<div style=\"flex:1;min-width:0\"><strong>" +
        esc(companionCard.nickname || "陪玩") +
        "</strong><span>ID " +
        esc(companionCard.companionCode || companionCard.companionId || "-") +
        " · " +
        esc(companionCard.level || "-") +
        "</span><span>音色 " +
        esc(companionCard.voiceType || "-") +
        " · " +
        esc(companionCard.game || "-") +
        " · " +
        esc(String(companionCard.unitPrice != null ? companionCard.unitPrice : "-")) +
        "</span><span>标签 " +
        esc(companionCard.tags || "-") +
        '</span><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">' +
        '<a class="support-inline-link" href="' +
        esc(companionCard.detailUrl || ("profile.html?player=" + encodeURIComponent(companionCard.companionId || ""))) +
        '" target="_blank" rel="noopener">查看详情</a>' +
        '<button type="button" class="order-btn primary" data-want-him="' +
        esc(companionCard.orderId || "") +
        '" data-companion-id="' +
        esc(companionCard.companionId || "") +
        '">我要他</button>' +
        "</div><small>" +
        esc(shortTime(m.created_at || "")) +
        "</small></div></div></div>"
      );
    }
    var card = mt === "product_card" ? parseCard(m.content) : null;
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
    var system = m.sender_role === "system" || mt === "system";
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
    // Only drop this conversation channel — never wipe unrelated pool/message channels.
    if (typeof RT.unsubscribe === "function") RT.unsubscribe(cid);
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
    // Only fetch the active conversation's order — never dump the full order list into support UI.
    var c = state.conversation;
    var oid = (c && (c.orderId || c.order_id)) || orderId() || "";
    if (!oid) {
      state.orders = [];
      return Promise.resolve([]);
    }
    return fetchJson("/api/orders?id=" + encodeURIComponent(oid))
      .then(function (body) {
        var list = body.orders || [];
        if (body.order) list = [body.order];
        state.orders = Array.isArray(list) ? list : [];
        return state.orders;
      })
      .catch(function (err) {
        var msg = String((err && err.message) || "");
        var status = Number(err && err.status) || 0;
        if (status === 403 || /无权限/.test(msg)) {
          state.orders = [];
          state.error = "无权限查看该订单";
          return [];
        }
        if (status === 404 || /不存在/.test(msg)) {
          state.orders = [];
          if (orderId()) state.error = "订单不存在";
          return [];
        }
        state.orders = [];
        return [];
      });
  }
  function loadThread(conversationId, silent) {
    var cid = conversationId || (state.conversation && state.conversation.id) || conversationParam();
    if (!cid) return Promise.resolve(null);
    return fetchJson("/api/chat?conversation_id=" + encodeURIComponent(cid))
      .then(function (body) {
        applyPayload(body, { keepScroll: !!silent });
        return loadOrders().then(function () {
          softUpdate({ keepScroll: !!silent });
          return body;
        });
      })
      .catch(function (err) {
        var msg = String((err && err.message) || "");
        var status = Number(err && err.status) || 0;
        if (status === 403 || /无权限/.test(msg)) {
          state.conversation = null;
          state.messages = [];
          state.error = "无权限查看该会话";
          try {
            var u = new URL(location.href);
            u.searchParams.delete("conversation");
            u.searchParams.delete("order");
            history.replaceState({}, "", u.pathname + u.search);
          } catch (e) {}
          softUpdate({ keepScroll: true });
          return null;
        }
        if (status === 404 || /不存在/.test(msg)) {
          state.conversation = null;
          state.messages = [];
          state.error = "会话不存在";
          softUpdate({ keepScroll: true });
          return null;
        }
        if (!silent) throw err;
        return null;
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
    var grab = order.grabCount != null ? order.grabCount : order.claimCount != null ? order.claimCount : order.applicantCount;
    var grabText = grab != null && grab !== "" ? String(grab) : "-";
    return (
      '<section class="support-order-summary' +
      (state.orderCardOpen ? " is-open" : "") +
      '"><button class="support-order-summary-toggle" type="button" data-toggle-order-card>' +
      '<div class="support-order-summary-meta">' +
      "<strong>订单 " +
      esc(order.orderNo || order.id) +
      "</strong>" +
      "<span>" +
      esc(order.serviceType || order.game || "-") +
      "</span>" +
      "<span>" +
      esc(order.totalAmount != null ? order.totalAmount + " 猫粮" : "-") +
      "</span>" +
      "<span>" +
      esc(order.statusText || order.status || "-") +
      "</span></div><span>" +
      (state.orderCardOpen ? "收起" : "展开") +
      "</span></button>" +
      '<div class="support-order-summary-body">' +
      "<div><span>订单号</span><strong>" +
      esc(order.orderNo || order.id) +
      "</strong></div>" +
      "<div><span>游戏</span><strong>" +
      esc(order.serviceType || order.game || "-") +
      "</strong></div>" +
      "<div><span>金额</span><strong>" +
      esc(order.totalAmount != null ? order.totalAmount + " 猫粮" : "-") +
      "</strong></div>" +
      "<div><span>状态</span><strong>" +
      esc(order.statusText || order.status || "-") +
      "</strong></div>" +
      "<div><span>已有抢单人数</span><strong>" +
      esc(grabText) +
      "</strong></div>" +
      '<div class="support-order-summary-actions">' +
      '<a class="support-inline-link" href="orders.html?id=' +
      encodeURIComponent(order.id) +
      '">返回订单详情</a>' +
      '<a class="support-inline-link" href="orders.html?id=' +
      encodeURIComponent(order.id) +
      '&tab=claims">查看抢单陪玩</a>' +
      "</div></div></section>"
    );
  }
  function railHtml() {
    // WeChat-style: no third-column order dump. Current order card lives in chat panel.
    return "";
  }
  function listHtml() {
    var activeId = state.conversation && state.conversation.id;
    var list = state.conversations || [];
    var actions =
      '<div class="support-list-actions"><button class="support-btn primary" type="button" data-contact-service' +
      (state.creatingGeneral ? " disabled" : "") +
      ">" +
      (state.creatingGeneral ? "创建中…" : "新建客服咨询") +
      "</button></div>";
    if (!list.length) {
      return (
        actions +
        '<div class="support-empty-panel support-empty-list"><strong>暂无客服会话</strong><span>需要帮助时，点击上方按钮新建咨询。从订单详情进入时会自动关联当前订单。</span></div>'
      );
    }
    return (
      actions +
      '<section class="support-list-block"><div class="support-list-caption">我的会话</div>' +
      list
        .map(function (c) {
          var orderMode = isOrderConversation(c);
          var title = orderMode
            ? "订单咨询" + (c.orderNo || c.order_no ? " · " + (c.orderNo || c.order_no) : "")
            : "人工客服咨询";
          var unread = Number(c.unreadCount || 0)
            ? '<em class="support-unread">' + esc(Number(c.unreadCount || 0) > 99 ? "99+" : c.unreadCount) + "</em>"
            : "";
          return (
            '<button type="button" class="support-session' +
            (orderMode ? " support-session-order" : " support-session-general") +
            (activeId && c.id === activeId ? " active" : "") +
            '" data-select-conversation="' +
            esc(c.id) +
            '"><div class="support-session-main"><strong>' +
            esc(title) +
            "</strong><span>" +
            esc(isClosedConversation(c) ? "会话已结束 · 可重新发起" : c.lastMessage || "暂无消息") +
            "</span></div><small>" +
            esc(shortTime(c.lastMessageAt || c.updatedAt || "")) +
            "</small>" +
            unread +
            "</button>"
          );
        })
        .join("") +
      "</section>"
    );
  }
  function mainHtml() {
    if (state.authLoading || state.customerLoading) {
      return '<div class="support-empty-panel"><strong>正在加载账号资料</strong><span>请稍候，正在确认登录身份…</span></div>';
    }
    if (!hasAuthSession() || /请先登录/.test(String(state.authError || ""))) {
      return (
        '<div class="support-login-panel"><strong>请先登录后使用在线客服</strong><br>' +
        '<button class="support-btn primary" type="button" data-support-login>立即登录</button></div>'
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
      if (/等待客服接待|客服暂时离线|客服已接入|正在为您服务|会话已结束|正在为你更换客服/.test(String(state.serviceStatus))) {
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
      root.querySelector(".support-layout") &&
      root.querySelector(".support-aside") &&
      root.querySelector(".support-main")
    );
  }
  function patchSessionList() {
    var list = root.querySelector(".support-session-list");
    if (list) list.innerHTML = listHtml();
  }
  function patchMain() {
    var main = root.querySelector(".support-main");
    if (main) main.innerHTML = mainHtml();
  }
  function patchRail() {
    /* rail removed — WeChat 2-column layout */
  }
  function softUpdate(opts) {
    opts = opts || {};
    captureComposer();
    syncChatChrome();
    if (canSoftPatch()) {
      var box = root.querySelector("[data-messages]");
      var prevBottom = box ? box.scrollHeight - box.scrollTop : 0;
      var stickBottom = !opts.keepScroll || prevBottom < 96;
      var prevScroll = box ? box.scrollTop : 0;
      patchSessionList();
      patchMain();
      var next = root.querySelector("[data-messages]");
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
      (state.mobileDetail ? " mobile-detail" : "") +
      '" aria-label="我的客服会话">' +
      '<aside class="support-aside"><div class="support-aside-head"><div><h1>我的客服会话</h1><p>仅显示本人会话</p></div></div><div class="support-session-list">' +
      listHtml() +
      "</div></aside>" +
      '<div class="support-main">' +
      mainHtml() +
      "</div>" +
      "</section>";
    var next = root.querySelector("[data-messages]");
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
    var st = String((state.conversation && state.conversation.status) || body.serviceStatus || "");
    if (/pending_transfer|正在为你更换客服/.test(st)) {
      toast("正在为你更换客服。");
    }
    state.error = '';
    softUpdate(opts);
    var nextCid = state.conversation && state.conversation.id;
    if (nextCid && nextCid !== prevCid) bindBossRealtime(nextCid);
    else if (nextCid && !state.realtimeReady) bindBossRealtime(nextCid);
  }
  function bootstrap() {
    if (!hasAuthSession()) {
      state.loading = false;
      state.authLoading = false;
      state.customerLoading = false;
      state.authError = "请先登录后使用在线客服";
      state.conversations = [];
      state.orders = [];
      state.conversation = null;
      state.messages = [];
      paint();
      promptBossLogin();
      return Promise.resolve(null);
    }
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
        return Promise.all([loadList()]).then(function () {
          state.loading = false;
          softUpdate({ keepScroll: true });
          var oid = orderId();
          var cid = conversationParam();
          var picked = pickConversation(state.conversations);
          function openOwned() {
            if (oid && (!picked || String(picked.orderId || picked.order_id || "") !== String(oid))) {
              return openConversation({ order_id: oid }).catch(function (err) {
                var msg = String((err && err.message) || "");
                var status = Number(err && err.status) || 0;
                if (status === 403 || /无权限/.test(msg)) state.error = "无权限查看该订单";
                else if (status === 404 || /不存在/.test(msg)) state.error = "订单不存在";
                softUpdate({ keepScroll: true });
                return null;
              });
            }
            if (cid && !picked) {
              return loadThread(cid, false);
            }
            if (picked) {
              state.conversation = Object.assign({}, picked, {
                id: picked.id,
                order_id: picked.orderId || picked.order_id || "",
                customer_service_id: picked.customerServiceId || "",
              });
              state.mobileDetail = isMobile();
              syncUrl(state.conversation);
              return loadThread(picked.id, false);
            }
            if (wantsAutoOpen()) {
              return openConversation(oid ? { order_id: oid } : {}).catch(function () {
                return null;
              });
            }
            state.conversation = null;
            state.messages = [];
            state.mobileDetail = false;
            softUpdate({ keepScroll: true });
            return null;
          }
          return openOwned();
        }).then(function (result) {
          applyDraftFromQuery();
          return result;
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
    var loginBtn = e.target.closest('[data-support-login]');
    if (loginBtn) {
      e.preventDefault();
      promptBossLogin(function () {
        resolveIdentity().then(function () {
          softUpdate({ keepScroll: true });
          if (hasAuthSession()) bootstrap();
        });
      });
      return;
    }
    var contact = e.target.closest('[data-contact-service]');
    if (contact) {
      e.preventDefault();
      if (!hasAuthSession()) {
        promptBossLogin(function () {
          contact.click();
        });
        return;
      }
      if (state.opening || state.creatingGeneral) {
        toast('正在创建会话，请稍候…');
        return;
      }
      state.creatingGeneral = true;
      softUpdate({ keepScroll: true });
      // Different consult types MUST create independent conversations (no account lock reuse).
      pickBossConsultType("other").then(function (picked) {
        if (!picked) {
          state.creatingGeneral = false;
          softUpdate({ keepScroll: true });
          return;
        }
        var consultType = picked.consultType || "other";
        var linkedOrder = String(picked.orderId || "").trim();
        var needNew = isClosedConversation(state.conversation) ||
          (state.conversation && String(state.conversation.consultType || state.conversation.consult_type || "") !== consultType);
        var openPayload = needNew
          ? { action: "reopen", forceNew: true, consult_type: consultType }
          : { action: "open", consult_type: consultType };
        if (linkedOrder) openPayload.order_id = linkedOrder;
        return openConversation(openPayload).then(startPoll);
      })
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
        promptBossLogin(function () {
          reopen.click();
        });
        return;
      }
      if (state.opening || state.creatingGeneral) {
        toast('正在创建会话，请稍候…');
        return;
      }
      var cur = state.conversation || {};
      var oid = String(cur.orderId || cur.order_id || orderId() || '').trim();
      pickBossConsultType(oid ? "current_order" : "other").then(function (picked) {
        if (!picked) return;
        var consultType = picked.consultType || (oid ? "current_order" : "other");
        var linked = String(picked.orderId || oid || "").trim();
        var payload = linked
          ? { action: 'reopen', forceNew: true, order_id: linked, consult_type: consultType }
          : { action: 'reopen', forceNew: true, consult_type: consultType };
        return openConversation(payload).then(startPoll);
      }).catch(function () {});
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
        promptBossLogin(function () {
          imgBtn.click();
        });
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
    if (!patchMessages({ keepScroll: false })) softUpdate({ keepScroll: false });
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
        if (!patchMessages({ keepScroll: false })) softUpdate({ keepScroll: false });
      })
      .catch(function (err) {
        state.messages = state.messages.map(function (m) {
          if (m._localId !== localId) return m;
          return Object.assign({}, m, { _pending: false, _failed: true });
        });
        if (!patchMessages({ keepScroll: true })) softUpdate({ keepScroll: true });
        toast(err.message || '图片发送失败，可点击重试');
      });
  }

  document.addEventListener('submit', function (e) {
    if (!e.target.matches('[data-send]')) return;
    e.preventDefault();
    if (!hasAuthSession()) {
      promptBossLogin(function () {
        e.target.dispatchEvent(new Event('submit', { cancelable: true, bubbles: true }));
      });
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
    if (!patchMessages({ keepScroll: false })) softUpdate({ keepScroll: false });
    syncComposerChrome();
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
      if (!patchMessages({ keepScroll: false })) softUpdate({ keepScroll: false });
      else patchSessionList();
    }).catch(function (err) {
      state.messages = state.messages.map(function (m) {
        if (m._localId !== localId) return m;
        return Object.assign({}, m, { _pending: false, _failed: true });
      });
      if (!patchMessages({ keepScroll: true })) softUpdate({ keepScroll: true });
      toast(err.message || '发送失败，可点击重试');
    }).finally(function () {
      state.sending = false;
      state.composerFocused = true;
      syncComposerChrome();
      setTimeout(focusComposer, 0);
    });
  });

  document.addEventListener('click', function (e) {
    var want = e.target.closest('[data-want-him]');
    if (want && root.contains(want)) {
      e.preventDefault();
      var oid = want.getAttribute('data-want-him') || '';
      var cid = want.getAttribute('data-companion-id') || '';
      if (!oid || !cid) {
        alert('缺少订单或陪玩信息');
        return;
      }
      if (!confirm('确认选择该陪玩？订单将进入待陪玩确认。')) return;
      want.disabled = true;
      var prev = want.textContent;
      want.textContent = '处理中…';
      var token =
        localStorage.getItem('mcjAuthAccessToken') ||
        sessionStorage.getItem('mcjAuthAccessToken') ||
        '';
      fetch('/api/orders', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + token,
        },
        body: JSON.stringify({ action: 'want_him', id: oid, companion_id: cid, bind: true }),
      })
        .then(function (res) {
          return res.json().then(function (body) {
            return { res: res, body: body };
          });
        })
        .then(function (x) {
          if (!x.res.ok || x.body.ok === false) throw new Error(x.body.message || '选择失败');
          alert(x.body.message || '已选择陪玩，等待陪玩确认。');
          want.textContent = '已选择';
        })
        .catch(function (err) {
          want.disabled = false;
          want.textContent = prev || '我要他';
          alert(err.message || '选择失败');
        });
      return;
    }
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
