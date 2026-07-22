(function () {
  var API_BASE = window.MCJ_CHAT_API_BASE || "/api/chat";
  var PLATFORM_KEY = "mcjPlatformData.v1";

  function authToken(role) {
    var keys = {
      customer: "customerAuthToken",
      companion: "companionAuthToken",
      customer_service: "customerServiceAuthToken",
      super_admin: "adminAuthToken"
    };
    return localStorage.getItem(keys[role] || "authToken") || "";
  }

  function readJSON(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key) || "") || fallback;
    } catch (error) {
      return fallback;
    }
  }

  function writePlatform(db) {
    localStorage.setItem(PLATFORM_KEY, JSON.stringify(db || {}));
    window.dispatchEvent(new CustomEvent("mcj:service-conversation-updated"));
    window.dispatchEvent(new CustomEvent("mcj:platform-data-updated"));
  }

  function readPlatform() {
    var db = readJSON(PLATFORM_KEY, {});
    db.serviceConversations = Array.isArray(db.serviceConversations) ? db.serviceConversations : [];
    db.serviceMessages = Array.isArray(db.serviceMessages) ? db.serviceMessages : [];
    db.conversationAssignments = Array.isArray(db.conversationAssignments) ? db.conversationAssignments : [];
    db.customerServiceLogs = Array.isArray(db.customerServiceLogs) ? db.customerServiceLogs : [];
    db.supportAgents = Array.isArray(db.supportAgents) ? db.supportAgents : [];
    return db;
  }

  function currentUser(role) {
    var keys = {
      customer: "customerUser",
      companion: "companionUser",
      customer_service: "customerServiceUser",
      super_admin: "adminUser"
    };
    return readJSON(keys[role] || "currentUser", {}) || {};
  }

  function createId(prefix) {
    return prefix + "-" + Date.now().toString(36).toUpperCase() + "-" + Math.random().toString(16).slice(2, 7).toUpperCase();
  }

  function nowText() {
    return new Date().toLocaleString("zh-CN");
  }

  async function request(path, options, role) {
    var config = Object.assign({
      method: "GET",
      headers: {
        "Accept": "application/json",
        "Content-Type": "application/json; charset=UTF-8",
        "Authorization": authToken(role) ? "Bearer " + authToken(role) : ""
      }
    }, options || {});
    if (config.body && typeof config.body !== "string" && !(config.body instanceof FormData)) {
      config.body = JSON.stringify(config.body);
    }
    try {
      var res = await fetch(API_BASE + path, config);
      var text = await res.text();
      var contentType = res.headers.get("content-type") || "";
      var data = text && contentType.indexOf("application/json") >= 0 ? JSON.parse(text) : null;
      if (!res.ok) throw new Error((data && data.message) || "聊天后端 API 尚未连接");
      if (text && contentType.indexOf("application/json") < 0) throw new Error("聊天后端 API 尚未连接");
      return { ok: true, data: data };
    } catch (error) {
      return { ok: false, error: error.message || "聊天后端 API 尚未连接" };
    }
  }

  function normalizeConversation(row) {
    row = row || {};
    return {
      id: row.id || row.conversation_id || "",
      conversation_type: row.conversation_type || row.type || "customer_service",
      peer_avatar: row.peer_avatar || row.avatar_url || row.boss_avatar || row.customer_avatar || "",
      peer_name: row.peer_name || row.name || row.boss_name || row.customer_name || "会话",
      peer_role: row.peer_role || row.role || "customer",
      peer_status: row.peer_status || row.online_status || "",
      order_id: row.order_id || "",
      order_no: row.order_no || "",
      last_message_text: row.last_message_text || row.lastMessage || "",
      last_message_at: row.last_message_at || row.updated_at || row.created_at || "",
      unread_count: Number(row.unread_count || 0),
      is_pinned: !!row.is_pinned,
      is_muted: !!row.is_muted,
      status: row.status || "",
      messages: Array.isArray(row.messages) ? row.messages : [],
      assigned_service_id: row.assigned_service_id || "",
      assigned_service_name: row.assigned_service_name || "",
      assigned_service_avatar: row.assigned_service_avatar || "",
      assigned_service_online: row.assigned_service_online || "",
      assigned_at: row.assigned_at || "",
      boss_user_id: row.boss_user_id || row.customer_id || "",
      boss_name: row.boss_name || row.customer_name || ""
    };
  }

  function normalizeMessage(row) {
    row = row || {};
    return {
      id: row.id || row.messageId || "",
      conversation_id: row.conversation_id || "",
      sender_id: row.sender_id || row.sender_account_id || "",
      sender_account_id: row.sender_account_id || row.sender_id || "",
      sender_role: row.sender_role || "",
      sender_name: row.sender_name || row.fromName || "",
      sender_avatar: row.sender_avatar || "",
      message_type: row.message_type || row.type || "text",
      text_content: row.text_content || row.text || "",
      media_url: row.media_url || "",
      media_duration: row.media_duration || "",
      order_id: row.order_id || "",
      refund_request_id: row.refund_request_id || "",
      send_status: row.send_status || "sent",
      is_read: !!row.is_read,
      is_recalled: !!row.is_recalled,
      read_state: row.read_state || "",
      created_at: row.created_at || row.time || ""
    };
  }

  function servicePeerFor(role, conversation) {
    if (role === "customer") {
      return {
        peer_avatar: conversation.assigned_service_avatar || "assets/cat-neon-avatar.png",
        peer_name: conversation.assigned_service_name || "正在分配客服",
        peer_role: "customer_service",
        peer_status: conversation.assigned_service_id ? (conversation.assigned_service_online || "在线") : "等待接待"
      };
    }
    return {
      peer_avatar: conversation.boss_avatar || "assets/cat-neon-avatar.png",
      peer_name: conversation.boss_name || conversation.customer_name || "老板",
      peer_role: "customer",
      peer_status: conversation.boss_online || ""
    };
  }

  function localListConversations(role, filters) {
    var db = readPlatform();
    var user = currentUser(role);
    var userId = user.user_id || user.customer_id || user.id || "";
    var list = db.serviceConversations.slice();
    if (role === "customer") {
      list = list.filter(function (item) {
        return String(item.boss_user_id || item.customer_id || "") === String(userId || item.boss_user_id || item.customer_id || "");
      });
    }
    var search = String((filters && filters.search) || "").trim().toLowerCase();
    var filter = String((filters && filters.filter) || "all");
    if (search) {
      list = list.filter(function (item) {
        return [item.boss_name, item.boss_user_id, item.order_no, item.last_message_text, item.assigned_service_name].join(" ").toLowerCase().indexOf(search) >= 0;
      });
    }
    if (filter === "unread") list = list.filter(function (item) { return Number(item.unread_count || 0) > 0; });
    if (filter === "service") list = list.filter(function (item) { return item.conversation_type === "customer_service"; });
    list.sort(function (a, b) {
      return new Date(b.last_message_at || b.created_at || 0).getTime() - new Date(a.last_message_at || a.created_at || 0).getTime();
    });
    return {
      conversations: list.map(function (item) {
        return normalizeConversation(Object.assign({}, item, servicePeerFor(role, item)));
      }),
      unread_total: list.reduce(function (sum, item) { return sum + Number(item.unread_count || 0); }, 0)
    };
  }

  function localGetConversation(role, conversationId) {
    var db = readPlatform();
    var conversation = db.serviceConversations.find(function (item) { return item.id === conversationId || item.conversation_id === conversationId; });
    if (!conversation) return { error: "会话不存在", conversation: null, messages: [] };
    var messages = db.serviceMessages
      .filter(function (item) { return item.conversation_id === conversation.id; })
      .sort(function (a, b) { return new Date(a.created_at || 0) - new Date(b.created_at || 0); })
      .map(normalizeMessage);
    return {
      conversation: normalizeConversation(Object.assign({}, conversation, servicePeerFor(role, conversation))),
      messages: messages
    };
  }

  function localCreateCustomerServiceConversation(data) {
    var db = readPlatform();
    var user = currentUser("customer");
    var bossId = data.customer_id || user.user_id || user.customer_id || user.id || "guest";
    var bossName = data.customer_name || user.nickname || user.name || "老板";
    var conversation = db.serviceConversations.find(function (item) {
      return String(item.boss_user_id || "") === String(bossId) && item.status !== "已结束";
    });
    if (!conversation) {
      conversation = {
        id: createId("SVC"),
        conversation_id: "",
        conversation_type: "customer_service",
        boss_user_id: bossId,
        boss_name: bossName,
        boss_avatar: user.avatar || user.avatar_url || "assets/cat-neon-avatar.png",
        assigned_service_id: "",
        assigned_service_name: "",
        assigned_service_avatar: "",
        assigned_service_online: "",
        status: "未接待",
        source: data.source || "customer",
        last_message_text: "",
        last_message_at: nowText(),
        unread_count: 0,
        created_at: nowText(),
        updated_at: nowText()
      };
      conversation.conversation_id = conversation.id;
      db.serviceConversations.unshift(conversation);
      db.customerServiceLogs.unshift({
        id: createId("CSL"),
        conversation_id: conversation.id,
        service_id: "",
        service_name: "",
        action: "create_conversation",
        detail: "老板进入在线客服",
        created_at: nowText()
      });
      writePlatform(db);
    }
    return { ok: true, data: { conversation_id: conversation.id, conversation: conversation } };
  }

  function localSendMessage(role, conversationId, payload) {
    var db = readPlatform();
    var conversation = db.serviceConversations.find(function (item) { return item.id === conversationId || item.conversation_id === conversationId; });
    if (!conversation) return { ok: false, error: "会话不存在" };
    var user = currentUser(role);
    if (role === "customer_service" && String(conversation.assigned_service_id || "") !== String(user.serviceId || user.user_id || user.id || "")) {
      return { ok: false, error: "该会话正在由客服 " + (conversation.assigned_service_name || "-") + " 接待" };
    }
    var senderId = user.serviceId || user.user_id || user.customer_id || user.id || "";
    var senderName = user.name || user.nickname || (role === "customer_service" ? "客服" : "老板");
    var message = {
      id: createId("MSG"),
      conversation_id: conversation.id,
      sender_role: role,
      sender_account_id: senderId,
      sender_id: senderId,
      sender_name: senderName,
      sender_avatar: user.avatar || user.avatar_url || "",
      message_type: payload.message_type || "text",
      text_content: payload.text_content || "",
      media_url: payload.media_url || "",
      send_status: "sent",
      is_read: false,
      is_recalled: false,
      read_state: role === "customer" ? "客服未读" : "老板未读",
      created_at: nowText()
    };
    db.serviceMessages.push(message);
    conversation.last_message_text = message.message_type === "image" ? "[图片]" : message.text_content;
    conversation.last_message_at = message.created_at;
    conversation.updated_at = message.created_at;
    if (role === "customer") conversation.status = conversation.assigned_service_id ? "等待老板回复" : "未接待";
    db.customerServiceLogs.unshift({
      id: createId("CSL"),
      conversation_id: conversation.id,
      service_id: role === "customer_service" ? senderId : "",
      service_name: role === "customer_service" ? senderName : "",
      action: "send_message",
      detail: message.text_content || message.message_type,
      created_at: nowText()
    });
    writePlatform(db);
    return { ok: true, data: { message: message } };
  }

  function localMarkRead(role, conversationId) {
    var db = readPlatform();
    db.serviceMessages.forEach(function (item) {
      if (item.conversation_id === conversationId && item.sender_role !== role) {
        item.is_read = true;
        item.read_state = "已读";
      }
    });
    var conversation = db.serviceConversations.find(function (item) { return item.id === conversationId || item.conversation_id === conversationId; });
    if (conversation && role === "customer") conversation.unread_count = 0;
    writePlatform(db);
    return { ok: true, data: {} };
  }

  function fileToDataUrl(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result || "")); };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  window.MCJChatAPI = {
    listConversations: async function (role, filters) {
      var query = new URLSearchParams(Object.assign({ role: role }, filters || {})).toString();
      var res = await request("/conversations" + (query ? "?" + query : ""), null, role);
      if (res.ok) {
        return {
          conversations: ((res.data && res.data.conversations) || []).map(normalizeConversation),
          unread_total: Number((res.data && res.data.unread_total) || 0)
        };
      }
      return localListConversations(role, filters);
    },
    getConversation: async function (role, conversationId) {
      var res = await request("/conversations/" + encodeURIComponent(conversationId), null, role);
      if (res.ok) {
        return {
          conversation: normalizeConversation((res.data && res.data.conversation) || res.data),
          messages: (((res.data && res.data.messages) || [])).map(normalizeMessage)
        };
      }
      return localGetConversation(role, conversationId);
    },
    sendMessage: async function (role, conversationId, payload) {
      var res = await request("/conversations/" + encodeURIComponent(conversationId) + "/messages", { method: "POST", body: payload }, role);
      if (res.ok) return res;
      return localSendMessage(role, conversationId, payload || {});
    },
    markRead: async function (role, conversationId, messageId) {
      var res = await request("/conversations/" + encodeURIComponent(conversationId) + "/read", { method: "POST", body: { message_id: messageId || "" } }, role);
      if (res.ok) return res;
      return localMarkRead(role, conversationId);
    },
    createCustomerServiceConversation: async function (role, data) {
      var res = await request("/customer-service-conversations", { method: "POST", body: data || {} }, role);
      if (res.ok) return res;
      return localCreateCustomerServiceConversation(data || {});
    },
    updateConversationSetting: async function (role, conversationId, data) {
      return request("/conversations/" + encodeURIComponent(conversationId) + "/settings", { method: "PUT", body: data }, role);
    },
    uploadMedia: async function (role, conversationId, file, messageType) {
      var form = new FormData();
      form.append("file", file);
      form.append("message_type", messageType || "image");
      var res = await request("/conversations/" + encodeURIComponent(conversationId) + "/media", {
        method: "POST",
        headers: {
          "Accept": "application/json",
          "Authorization": authToken(role) ? "Bearer " + authToken(role) : ""
        },
        body: form
      }, role);
      if (res.ok) return res;
      var mediaUrl = await fileToDataUrl(file);
      return localSendMessage(role, conversationId, {
        message_type: messageType || "image",
        media_url: mediaUrl,
        text_content: ""
      });
    },
    normalizeConversation: normalizeConversation,
    normalizeMessage: normalizeMessage
  };
})();
