(function () {
  if (!window.MCJChatAPI || !window.MCJChat) return;

  var api = window.MCJChatAPI;
  var previousRender = window.MCJChat.render;
  var instances = {};

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function avatar(src) {
    return src || "assets/cat-neon-avatar.png";
  }

  function timeText(value) {
    return value || "";
  }

  async function render(options) {
    if (!options || options.role !== "customer") {
      return previousRender(options);
    }
    var target = typeof options.target === "string" ? document.querySelector(options.target) : options.target;
    if (!target) return;
    var queryConversation = new URLSearchParams(location.search).get("conversation") || "";
    var id = options.id || "customer-service-chat";
    instances[id] = Object.assign({
      id: id,
      target: target,
      activeConversationId: queryConversation,
      search: "",
      timer: null
    }, instances[id] || {}, options || {});
    await loadConversations(id);
  }

  async function loadConversations(id) {
    var inst = instances[id];
    inst.target.innerHTML = '<div class="mcj-chat-state mcj-chat-card"><strong>加载中...</strong><span>正在读取消息</span></div>';
    var res = await api.listConversations("customer", { search: inst.search, filter: "service" });
    inst.conversations = res.conversations || [];
    if (!inst.activeConversationId && inst.conversations.length) inst.activeConversationId = inst.conversations[0].id;
    draw(id);
    if (inst.activeConversationId) await loadMessages(id, inst.activeConversationId);
    schedule(id);
  }

  async function loadMessages(id, conversationId) {
    var inst = instances[id];
    inst.activeConversationId = conversationId;
    var res = await api.getConversation("customer", conversationId);
    inst.currentConversation = res.conversation;
    inst.messages = res.messages || [];
    draw(id);
    api.markRead("customer", conversationId, inst.messages.length ? inst.messages[inst.messages.length - 1].id : "");
  }

  function draw(id) {
    var inst = instances[id];
    var totalUnread = (inst.conversations || []).reduce(function (sum, c) {
      return sum + (Number(c.unread_count || c.unreadCount || 0) || 0);
    }, 0);
    var unreadBadge = totalUnread
      ? '<em class="mcj-unread mcj-msg-title-badge" aria-label="未读 ' + esc(totalUnread > 99 ? "99+" : totalUnread) + '">' +
        esc(totalUnread > 99 ? "99+" : totalUnread) +
        "</em>"
      : "";
    inst.target.innerHTML = [
      '<div class="mcj-customer-chat" data-customer-chat="' + esc(id) + '">',
      '<aside class="mcj-chat-card mcj-customer-chat-list">',
      '<div class="mcj-customer-chat-title"><h1>消息中心' + unreadBadge + '</h1><p>订单消息和客服会话</p></div>',
      '<input class="mcj-chat-search" data-customer-chat-search placeholder="搜索会话、订单号、客服">',
      '<div class="mcj-conversation-list">' + listHTML(inst) + '</div>',
      '</aside>',
      '<main class="mcj-chat-card mcj-customer-chat-main">' + detailHTML(inst) + '</main>',
      '</div>'
    ].join("");
  }

  function listHTML(inst) {
    if (!inst.conversations.length) {
      return '<div class="mcj-chat-state"><strong>暂无会话</strong><span>点击喵管家在线客服后，会话会显示在这里</span></div>';
    }
    return inst.conversations.map(function (c) {
      var active = c.id === inst.activeConversationId ? "active" : "";
      var assigned = c.assigned_service_id ? c.assigned_service_name : "待分配客服";
      var unread = Number(c.unread_count || 0);
      return [
        '<button class="mcj-conversation ' + active + '" data-customer-conversation="' + esc(c.id) + '">',
        '<img src="' + esc(avatar(c.assigned_service_avatar || c.peer_avatar)) + '" alt="">',
        '<div><strong>' + esc(assigned) + '</strong><p>' + esc(c.last_message_text || "暂无消息") + '</p><small>' + esc(c.status || "未接待") + ' · ' + esc(timeText(c.last_message_at)) + '</small></div>',
        '<div>' + (unread ? '<span class="mcj-unread">' + esc(unread > 99 ? "99+" : unread) + '</span>' : '') + '</div>',
        '</button>'
      ].join("");
    }).join("");
  }

  function serviceStatus(c) {
    if (!c || !c.assigned_service_id) return '<span class="mcj-service-waiting">正在为您分配客服，请稍候</span>';
    return [
      '<span class="mcj-service-serving">',
      '<img src="' + esc(avatar(c.assigned_service_avatar)) + '" alt="">',
      '<b>当前接待：客服 ' + esc(c.assigned_service_id) + ' ' + esc(c.assigned_service_name || "") + '</b>',
      '<small>' + esc(c.assigned_service_online || "在线") + '</small>',
      '</span>'
    ].join("");
  }

  function detailHTML(inst) {
    var c = inst.currentConversation;
    if (!c) return '<div class="mcj-chat-state"><strong>请选择会话</strong><span>左侧选择客服会话后开始聊天</span></div>';
    return [
      '<header class="mcj-chat-head mcj-customer-chat-head">',
      '<div class="mcj-chat-peer"><img src="' + esc(avatar(c.assigned_service_avatar || c.peer_avatar)) + '" alt=""><div><h2>在线客服</h2>' + serviceStatus(c) + '</div></div>',
      '</header>',
      '<section class="mcj-message-list">' + messageHTML(inst) + '</section>',
      '<div class="mcj-chat-risk">请勿发送违规或敏感内容。</div>',
      '<form class="mcj-chat-send" data-customer-send="' + esc(c.id) + '">',
      '<textarea name="message" rows="1" placeholder="输入消息"></textarea>',
      '<button class="mcj-chat-icon-btn" type="button" data-customer-image>图片</button>',
      '<button class="primary" type="submit">发送</button>',
      '<input type="file" accept="image/*" hidden data-customer-image-input>',
      '</form>'
    ].join("");
  }

  function messageHTML(inst) {
    if (!inst.messages.length) {
      return '<div class="mcj-chat-state"><strong>暂无聊天记录</strong><span>发送第一条消息开始沟通</span></div>';
    }
    return inst.messages.map(function (m) {
      var me = m.sender_role === "customer";
      var system = m.sender_role === "system" || m.message_type === "system";
      var text = m.message_type === "image"
        ? '<img src="' + esc(m.media_url) + '" alt="图片消息" style="max-width:220px;border-radius:12px">'
        : esc(m.text_content || "");
      return [
        '<div class="mcj-message-row ' + (me ? "me" : "") + (system ? " system-row" : "") + '">',
        system ? '' : '<img class="mcj-bubble-avatar" src="' + esc(avatar(m.sender_avatar)) + '" alt="">',
        '<div class="mcj-bubble-wrap">',
        system ? '' : '<span class="mcj-message-sender">' + esc(m.sender_name || (me ? "我" : "客服")) + '</span>',
        '<div class="mcj-bubble ' + (system ? "system" : "") + '">' + text + '<small>' + esc(m.created_at || "") + ' · ' + esc(m.read_state || m.send_status || "") + '</small></div>',
        '</div>',
        '</div>'
      ].join("");
    }).join("");
  }

  function schedule(id) {
    var inst = instances[id];
    if (inst.timer) clearTimeout(inst.timer);
    inst.timer = setTimeout(function () {
      if (document.body.contains(inst.target)) loadConversations(id);
    }, 5000);
  }

  document.addEventListener("click", function (event) {
    var root = event.target.closest("[data-customer-chat]");
    if (!root) return;
    var inst = instances[root.dataset.customerChat];
    if (!inst) return;
    var item = event.target.closest("[data-customer-conversation]");
    if (item) {
      loadMessages(inst.id, item.dataset.customerConversation);
      return;
    }
    var imageBtn = event.target.closest("[data-customer-image]");
    if (imageBtn) {
      var input = root.querySelector("[data-customer-image-input]");
      if (input) input.click();
    }
  });

  document.addEventListener("input", function (event) {
    var root = event.target.closest("[data-customer-chat]");
    if (!root) return;
    var inst = instances[root.dataset.customerChat];
    if (!inst) return;
    if (event.target.matches("[data-customer-chat-search]")) {
      inst.search = event.target.value;
      clearTimeout(inst.searchTimer);
      inst.searchTimer = setTimeout(function () { loadConversations(inst.id); }, 250);
    }
  });

  document.addEventListener("change", async function (event) {
    var input = event.target.closest("[data-customer-image-input]");
    if (!input || !input.files || !input.files[0]) return;
    var root = input.closest("[data-customer-chat]");
    var inst = root && instances[root.dataset.customerChat];
    var conversationId = input.closest("form").dataset.customerSend;
    await api.uploadMedia("customer", conversationId, input.files[0], "image");
    loadMessages(inst.id, conversationId);
  });

  document.addEventListener("submit", async function (event) {
    var form = event.target.closest("[data-customer-send]");
    if (!form) return;
    event.preventDefault();
    var root = form.closest("[data-customer-chat]");
    var inst = instances[root.dataset.customerChat];
    var text = form.elements.message.value.trim();
    if (!text) return;
    form.elements.message.value = "";
    var res = await api.sendMessage("customer", form.dataset.customerSend, {
      message_type: "text",
      text_content: text
    });
    if (!res.ok) alert(res.error || "发送失败");
    loadMessages(inst.id, form.dataset.customerSend);
  });

  window.addEventListener("mcj:service-conversation-updated", function () {
    Object.keys(instances).forEach(function (id) {
      var inst = instances[id];
      if (inst && document.body.contains(inst.target)) loadConversations(id);
    });
  });

  window.MCJChat.render = render;
})();
