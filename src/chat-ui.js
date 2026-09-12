(function () {
  var api = window.MCJChatAPI;
  if (!api) return;

  var instances = {};

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function roleLabel(role) {
    var map = { customer: "老板", boss: "老板", companion: "陪玩", customer_service: "客服", service: "客服", system: "系统" };
    return map[role] || role || "用户";
  }
  function defaultAvatar(role) {
    if (role === "customer_service" || role === "service") return "../assets/cat-neon-avatar.png";
    return "../assets/cat-neon-avatar.png";
  }
  function unreadText(n) {
    n = Number(n || 0);
    if (!n) return "";
    return n > 99 ? "99+" : String(n);
  }
  function isMine(inst, m) {
    return m.sender_role === inst.role || (inst.role === "customer_service" && m.sender_role === "service");
  }

  async function render(options) {
    var target = typeof options.target === "string" ? document.querySelector(options.target) : options.target;
    if (!target) return;
    var id = options.id || options.role || "chat";
    instances[id] = Object.assign({
      id: id,
      role: "customer",
      title: "消息",
      filter: "all",
      search: "",
      activeConversationId: "",
      target: target,
      refreshMs: 15000,
      sending: false
    }, instances[id] || {}, options || {});
    await loadConversations(id, { soft: false });
  }

  async function loadConversations(id, opts) {
    opts = opts || {};
    var inst = instances[id];
    var soft = !!opts.soft && !!inst.target.querySelector(".mcj-chat-system");
    if (!soft) {
      inst.target.innerHTML = '<div class="mcj-chat-state mcj-chat-card"><strong>加载中...</strong><span>正在读取会话数据</span></div>';
    }
    var res = await api.listConversations(inst.role, { filter: inst.filter, search: inst.search });
    inst.conversations = res.conversations || [];
    inst.error = res.error || "";
    if (!inst.activeConversationId && inst.conversations.length) inst.activeConversationId = inst.conversations[0].id;
    if (soft) {
      patchConversationList(id);
      if (inst.activeConversationId) await loadMessages(id, inst.activeConversationId, true);
    } else {
      drawShell(id);
      if (inst.activeConversationId) await loadMessages(id, inst.activeConversationId, true);
    }
    scheduleRefresh(id);
    bindRealtime(id);
  }

  async function loadMessages(id, conversationId, keepShell) {
    var inst = instances[id];
    inst.activeConversationId = conversationId;
    var body = inst.target.querySelector("[data-chat-detail]");
    if (body && !keepShell) body.innerHTML = '<div class="mcj-chat-state"><strong>加载中...</strong><span>正在读取聊天记录</span></div>';
    var res = await api.getConversation(inst.role, conversationId);
    var pendingLocals = (inst.messages || []).filter(function (m) { return m._pending || m._failed; });
    var remote = (res.messages || []).slice();
    pendingLocals.forEach(function (local) {
      var matched = remote.some(function (m) {
        return String(m.text_content || m.content || "") === String(local.text_content || local.content || "") &&
          isMine(inst, m);
      });
      if (!matched) remote.push(local);
    });
    inst.currentConversation = res.conversation;
    inst.messages = remote;
    inst.messageError = res.error || "";
    if (keepShell && inst.target.querySelector(".mcj-chat-system")) {
      patchDetail(id);
      patchConversationList(id);
    } else {
      drawShell(id);
    }
    if (!res.error) api.markRead(inst.role, conversationId, inst.messages.length ? inst.messages[inst.messages.length - 1].id : "");
    bindRealtime(id);
  }

  function patchConversationList(id) {
    var inst = instances[id];
    var list = inst.target.querySelector(".mcj-conversation-list");
    if (list) list.innerHTML = conversationList(inst);
  }

  function patchDetail(id) {
    var inst = instances[id];
    var detail = inst.target.querySelector("[data-chat-detail]");
    if (!detail) return false;
    var composer = detail.querySelector(".mcj-chat-send textarea");
    var draft = composer ? composer.value : "";
    detail.innerHTML = chatDetail(inst);
    var next = detail.querySelector(".mcj-chat-send textarea");
    if (next && draft) next.value = draft;
    var msgList = detail.querySelector(".mcj-message-list");
    if (msgList) msgList.scrollTop = msgList.scrollHeight;
    return true;
  }

  function patchMessagesOnly(id) {
    var inst = instances[id];
    var list = inst.target.querySelector(".mcj-message-list");
    if (!list) return false;
    list.innerHTML = messageList(inst);
    list.scrollTop = list.scrollHeight;
    return true;
  }

  function drawShell(id) {
    var inst = instances[id];
    var active = inst.activeConversationId ? " has-active" : "";
    inst.target.innerHTML = '<div class="mcj-chat-system' + active + '" data-chat-instance="' + esc(id) + '"><aside class="mcj-chat-card mcj-chat-sidebar"><div class="mcj-chat-tools"><h1>' + esc(inst.title) + '</h1><input class="mcj-chat-search" data-chat-search placeholder="搜索昵称、用户ID、订单号、消息关键词" value="' + esc(inst.search) + '"><div class="mcj-chat-filters"><button class="' + (inst.filter === "all" ? "active" : "") + '" data-chat-filter="all">全部</button><button class="' + (inst.filter === "unread" ? "active" : "") + '" data-chat-filter="unread">未读</button><button class="' + (inst.filter === "order" ? "active" : "") + '" data-chat-filter="order">订单会话</button><button class="' + (inst.filter === "service" ? "active" : "") + '" data-chat-filter="service">客服会话</button></div></div><div class="mcj-conversation-list">' + conversationList(inst) + '</div></aside><main class="mcj-chat-card mcj-chat-main" data-chat-detail>' + chatDetail(inst) + '</main></div>';
  }

  function conversationList(inst) {
    if (inst.error) return '<div class="mcj-chat-state"><strong>请求失败</strong><span>' + esc(inst.error) + '</span></div>';
    if (!inst.conversations.length) return '<div class="mcj-chat-state"><strong>暂无会话</strong><span>有真实会话后会显示在这里</span></div>';
    return inst.conversations.map(function (c) {
      var unread = unreadText(c.unread_count);
      return '<button class="mcj-conversation ' + (c.id === inst.activeConversationId ? "active" : "") + '" data-chat-conversation="' + esc(c.id) + '"><img src="' + esc(c.peer_avatar || defaultAvatar(c.peer_role)) + '" alt=""><div><strong>' + esc(c.peer_name) + '<span class="mcj-role-tag">' + esc(roleLabel(c.peer_role)) + '</span></strong><p>' + esc(c.last_message_text || "暂无消息") + '</p><small>' + esc(c.order_no || (c.order_id ? "订单会话" : "普通会话")) + ' · ' + esc(c.peer_status || "") + '</small></div><div><small>' + esc(c.last_message_at || "") + '</small>' + (unread ? '<span class="mcj-unread">' + unread + '</span>' : '') + '</div></button>';
    }).join("");
  }

  function chatDetail(inst) {
    if (inst.messageError) return '<div class="mcj-chat-state"><strong>请求失败</strong><span>' + esc(inst.messageError) + '</span></div>';
    var c = inst.currentConversation;
    if (!c) return '<div class="mcj-chat-state"><strong>请选择会话</strong><span>点击左侧会话进入聊天窗口</span></div>';
    return '<header class="mcj-chat-head"><div class="mcj-chat-peer"><button class="mcj-chat-icon-btn" data-chat-back type="button">返回</button><img src="' + esc(c.peer_avatar || defaultAvatar(c.peer_role)) + '" alt=""><div><h2>' + esc(c.peer_name) + '</h2><span>' + esc(roleLabel(c.peer_role)) + ' · ' + esc(c.peer_status || "离线") + (c.order_no ? ' · ' + esc(c.order_no) : '') + '</span></div></div><div class="mcj-chat-more"><button data-chat-more="profile">查看资料</button><button data-chat-more="order">查看订单</button><button data-chat-more="search">搜索记录</button><button data-chat-more="mute">' + (c.is_muted ? "取消免打扰" : "免打扰") + '</button><button data-chat-more="pin">' + (c.is_pinned ? "取消置顶" : "置顶") + '</button></div></header><section class="mcj-message-list">' + messageList(inst) + '</section><div class="mcj-chat-risk">请勿发送违规或敏感内容。</div><form class="mcj-chat-send" data-chat-send="' + esc(c.id) + '"><textarea name="message" rows="1" placeholder="输入消息，Enter 发送，Shift+Enter 换行"></textarea><button class="mcj-chat-icon-btn" type="button" data-chat-image>图片</button><button class="mcj-chat-icon-btn" type="button" data-chat-extra>更多</button><button class="primary" type="submit"' + (inst.sending ? " disabled" : "") + ">" + (inst.sending ? "发送中…" : "发送") + '</button><input type="file" accept="image/*" hidden data-chat-image-input></form>';
  }

  function messageList(inst) {
    if (!inst.messages.length) return '<div class="mcj-chat-state"><strong>暂无聊天记录</strong><span>发送第一条消息开始会话</span></div>';
    return inst.messages.map(function (m) {
      var me = isMine(inst, m);
      var content = bubbleContent(m);
      var status = m._pending ? "发送中…" : (m._failed ? "发送失败" : (m.send_status || ""));
      return '<div class="mcj-message-row ' + (me ? "me" : "") + '" data-msg-id="' + esc(m.id || m._localId || "") + '"><img class="mcj-bubble-avatar" src="' + esc(defaultAvatar(m.sender_role)) + '" alt=""><div class="mcj-bubble-wrap"><div class="mcj-bubble ' + (m.message_type === "system" ? "system" : "") + (m._failed ? " failed" : "") + '">' + content + '<small>' + esc(m.created_at || "") + (status ? " · " + esc(status) : "") + '</small></div></div></div>';
    }).join("");
  }

  function bubbleContent(m) {
    if (m.is_recalled) return "该消息已撤回";
    if (m.message_type === "image") return '<img src="' + esc(m.media_url || m.content || "") + '" alt="图片消息" style="max-width:220px;border-radius:12px">';
    if (m.message_type === "voice") return '语音消息 ' + esc(m.media_duration || "") + '″';
    if (m.message_type === "order_card") return '<div class="mcj-order-card-msg"><b>订单卡片</b><span>订单编号：' + esc(m.order_id || "-") + '</span><button class="mcj-chat-icon-btn" data-chat-order="' + esc(m.order_id || "") + '" type="button">查看订单</button></div>';
    if (m.message_type === "refund_card") return '<div class="mcj-order-card-msg"><b>退款状态</b><span>' + esc(m.text_content || "") + '</span><button class="mcj-chat-icon-btn" data-chat-refund="' + esc(m.refund_request_id || "") + '" type="button">查看退款详情</button></div>';
    return esc(m.text_content || m.content || "");
  }

  function authToken() {
    return localStorage.getItem("mcjAuthAccessToken") ||
      sessionStorage.getItem("mcjAuthAccessToken") ||
      localStorage.getItem("mcjServiceToken") ||
      sessionStorage.getItem("mcjServiceToken") ||
      "";
  }

  function bindRealtime(id) {
    var inst = instances[id];
    var RT = window.MCJChatRealtime;
    var cid = String(inst.activeConversationId || "").trim();
    if (!RT || !cid) return;
    if (inst._rtCid === cid) return;
    if (inst._rtCid && typeof RT.unsubscribe === "function") RT.unsubscribe(inst._rtCid);
    inst._rtCid = cid;
    RT.subscribeMessages(cid, authToken(), function (row) {
      if (!row || !row.id) return;
      if ((inst.messages || []).some(function (m) { return String(m.id) === String(row.id); })) return;
      var normalized = api.normalizeMessage ? api.normalizeMessage(row) : {
        id: row.id,
        sender_role: row.sender_role,
        message_type: row.message_type || "text",
        text_content: row.content || "",
        content: row.content || "",
        media_url: row.media_url || "",
        created_at: row.created_at || ""
      };
      inst.messages = (inst.messages || []).filter(function (m) {
        if (!(m._pending || m._failed)) return true;
        return String(m.text_content || m.content || "") !== String(normalized.text_content || normalized.content || "");
      });
      inst.messages = inst.messages.concat([normalized]);
      if (!patchMessagesOnly(id)) patchDetail(id);
    }).catch(function () {
      inst._rtCid = "";
    });
  }

  function scheduleRefresh(id) {
    var inst = instances[id];
    if (inst.timer) clearTimeout(inst.timer);
    inst.timer = setTimeout(function () {
      if (document.body.contains(inst.target) && !document.hidden && !inst.sending) {
        loadConversations(id, { soft: true });
      } else {
        scheduleRefresh(id);
      }
    }, inst.refreshMs || 15000);
  }

  document.addEventListener("click", function (e) {
    var root = e.target.closest("[data-chat-instance]");
    if (!root) return;
    var inst = instances[root.dataset.chatInstance];
    if (!inst) return;
    var conversation = e.target.closest("[data-chat-conversation]");
    if (conversation) { loadMessages(inst.id, conversation.dataset.chatConversation); return; }
    var filter = e.target.closest("[data-chat-filter]");
    if (filter) { inst.filter = filter.dataset.chatFilter; loadConversations(inst.id); return; }
    if (e.target.closest("[data-chat-back]")) { inst.activeConversationId = ""; drawShell(inst.id); return; }
    if (e.target.closest("[data-chat-image]")) {
      var input = root.querySelector("[data-chat-image-input]");
      if (input) input.click();
      return;
    }
    var more = e.target.closest("[data-chat-more]");
    if (more) {
      alert("该操作会调用真实会话设置接口：" + more.dataset.chatMore);
    }
  });

  document.addEventListener("input", function (e) {
    var root = e.target.closest("[data-chat-instance]");
    if (!root) return;
    var inst = instances[root.dataset.chatInstance];
    if (!inst) return;
    if (e.target.matches("[data-chat-search]")) {
      inst.search = e.target.value;
      clearTimeout(inst.searchTimer);
      inst.searchTimer = setTimeout(function () { loadConversations(inst.id); }, 300);
    }
    if (e.target.matches(".mcj-chat-send textarea")) {
      e.target.style.height = "auto";
      e.target.style.height = Math.min(e.target.scrollHeight, 112) + "px";
    }
  });

  document.addEventListener("keydown", function (e) {
    if (!e.target.matches(".mcj-chat-send textarea")) return;
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      e.target.closest("form").requestSubmit();
    }
  });

  document.addEventListener("change", async function (e) {
    var input = e.target.closest("[data-chat-image-input]");
    if (!input || !input.files || !input.files[0]) return;
    var root = e.target.closest("[data-chat-instance]");
    var inst = root && instances[root.dataset.chatInstance];
    if (!inst) return;
    var conversationId = input.closest("form").dataset.chatSend;
    var localId = "local-img-" + Date.now();
    var mediaUrl = "";
    try {
      mediaUrl = URL.createObjectURL(input.files[0]);
    } catch (err) {}
    var optimistic = {
      _localId: localId,
      _pending: true,
      id: localId,
      sender_role: inst.role === "customer_service" ? "service" : inst.role,
      message_type: "image",
      media_url: mediaUrl,
      text_content: "",
      created_at: new Date().toISOString()
    };
    inst.messages = (inst.messages || []).concat([optimistic]);
    if (!patchMessagesOnly(inst.id)) patchDetail(inst.id);
    var res = await api.uploadMedia(inst.role, conversationId, input.files[0], "image");
    if (!res.ok) {
      inst.messages = (inst.messages || []).map(function (m) {
        if (m._localId !== localId) return m;
        return Object.assign({}, m, { _pending: false, _failed: true });
      });
      if (!patchMessagesOnly(inst.id)) patchDetail(inst.id);
      alert(res.error || "图片上传失败");
      return;
    }
    await loadMessages(inst.id, conversationId, true);
  });

  document.addEventListener("submit", async function (e) {
    var form = e.target.closest("[data-chat-send]");
    if (!form) return;
    e.preventDefault();
    var root = form.closest("[data-chat-instance]");
    var inst = instances[root.dataset.chatInstance];
    if (!inst || inst.sending) return;
    var text = form.elements.message.value.trim();
    if (!text) return;
    var conversationId = form.dataset.chatSend;
    var localId = "local-" + Date.now() + "-" + Math.random().toString(16).slice(2, 6);
    var clientMessageId = "web-" + Date.now() + "-" + Math.random().toString(16).slice(2);
    var optimistic = {
      _localId: localId,
      _pending: true,
      id: localId,
      sender_role: inst.role === "customer_service" ? "service" : inst.role,
      message_type: "text",
      text_content: text,
      content: text,
      created_at: new Date().toISOString(),
      send_status: "sending"
    };
    form.elements.message.value = "";
    try { form.elements.message.style.height = "auto"; } catch (err) {}
    inst.sending = true;
    inst.messages = (inst.messages || []).concat([optimistic]);
    var submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = "发送中…"; }
    if (!patchMessagesOnly(inst.id)) patchDetail(inst.id);
    try {
      var res = await api.sendMessage(inst.role, conversationId, {
        message_type: "text",
        text_content: text,
        client_message_id: clientMessageId
      });
      if (!res.ok) {
        inst.messages = (inst.messages || []).map(function (m) {
          if (m._localId !== localId) return m;
          return Object.assign({}, m, { _pending: false, _failed: true, send_status: "failed" });
        });
        if (!patchMessagesOnly(inst.id)) patchDetail(inst.id);
        alert(res.error || "发送失败");
      } else {
        var serverMsg = (res.data && (res.data.message || res.data.row || res.data.appended)) || res.message || null;
        if (serverMsg && api.normalizeMessage) serverMsg = api.normalizeMessage(serverMsg);
        inst.messages = (inst.messages || []).filter(function (m) { return m._localId !== localId; });
        if (serverMsg && serverMsg.id && !(inst.messages || []).some(function (m) { return String(m.id) === String(serverMsg.id); })) {
          inst.messages = inst.messages.concat([serverMsg]);
        }
        if (!patchMessagesOnly(inst.id)) {
          await loadMessages(inst.id, conversationId, true);
        } else {
          // Soft-refresh conversation preview without remounting composer.
          api.listConversations(inst.role, { filter: inst.filter, search: inst.search }).then(function (listRes) {
            inst.conversations = listRes.conversations || inst.conversations;
            patchConversationList(inst.id);
          }).catch(function () {});
        }
      }
    } catch (err) {
      inst.messages = (inst.messages || []).map(function (m) {
        if (m._localId !== localId) return m;
        return Object.assign({}, m, { _pending: false, _failed: true, send_status: "failed" });
      });
      if (!patchMessagesOnly(inst.id)) patchDetail(inst.id);
      alert((err && err.message) || "发送失败");
    } finally {
      inst.sending = false;
      var btn = form.querySelector('button[type="submit"]');
      if (btn) { btn.disabled = false; btn.textContent = "发送"; }
      var ta = form.querySelector("textarea");
      if (ta) try { ta.focus(); } catch (e2) {}
    }
  });

  window.MCJChat = { render: render };
})();
