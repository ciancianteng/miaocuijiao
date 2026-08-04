(function () {
  "use strict";

  if (window.MCJServiceMessagePool) return;

  var STORE_KEY = "mcjPlatformData.v1";
  var STYLE_ID = "mcj-service-message-pool-style";
  var refreshTimer = null;
  var state = { activeId: "", filter: "all", search: "" };

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch];
    });
  }

  function readJson(key, fallback) {
    try { return JSON.parse(localStorage.getItem(key) || "") || fallback; }
    catch (error) { return fallback; }
  }

  function nowText() {
    return new Date().toLocaleString("zh-CN", { hour12: false });
  }

  function createId(prefix) {
    return prefix + "-" + Date.now().toString(36).toUpperCase() + "-" + Math.random().toString(16).slice(2, 7).toUpperCase();
  }

  function currentService() {
    var user = readJson("customerServiceUser", {});
    return {
      id: user.serviceId || user.user_id || user.id || user.uid || "service_unknown",
      name: user.name || user.nickname || "客服账号",
      avatar: user.avatar || user.avatar_url || "../assets/cat-neon-avatar.png",
      online: user.online !== false,
      role: "customer_service"
    };
  }

  function readDb() {
    var db = readJson(STORE_KEY, {});
    db.serviceConversations = Array.isArray(db.serviceConversations) ? db.serviceConversations : [];
    db.serviceMessages = Array.isArray(db.serviceMessages) ? db.serviceMessages : [];
    db.conversationAssignments = Array.isArray(db.conversationAssignments) ? db.conversationAssignments : [];
    db.customerServiceLogs = Array.isArray(db.customerServiceLogs) ? db.customerServiceLogs : [];
    db.supportAgents = Array.isArray(db.supportAgents) ? db.supportAgents : [];
    return db;
  }

  function writeDb(db) {
    localStorage.setItem(STORE_KEY, JSON.stringify(db || {}));
    window.dispatchEvent(new CustomEvent("mcj:platform-data-updated"));
    window.dispatchEvent(new CustomEvent("mcj:service-conversation-updated"));
  }

  function addLog(db, action, conversation, before, after) {
    var service = currentService();
    db.customerServiceLogs.unshift({
      id: createId("CSLOG"),
      conversation_id: conversation && conversation.id || "",
      boss_user_id: conversation && conversation.boss_user_id || "",
      service_id: service.id,
      service_name: service.name,
      action: action,
      before: before || "",
      after: after || "",
      created_at: nowText()
    });
  }

  function addSystemMessage(db, conversationId, text) {
    db.serviceMessages.push({
      id: createId("MSG"),
      conversation_id: conversationId,
      sender_role: "system",
      sender_account_id: "system",
      sender_name: "系统",
      message_type: "system",
      text_content: text,
      is_read: false,
      is_recalled: false,
      read_state: "",
      created_at: nowText()
    });
  }

  function messagesFor(db, conversationId) {
    return db.serviceMessages
      .filter(function (message) { return message.conversation_id === conversationId && !message.is_deleted; })
      .sort(function (a, b) { return Date.parse(a.created_at || 0) - Date.parse(b.created_at || 0); });
  }

  function lastMessage(db, conversation) {
    var list = messagesFor(db, conversation.id);
    return list[list.length - 1] || {};
  }

  function canReply(conversation) {
    var service = currentService();
    return conversation.assigned_service_id &&
      String(conversation.assigned_service_id) === String(service.id) &&
      conversation.status !== "已结束";
  }

  function assignmentText(conversation) {
    if (!conversation.assigned_service_id) return "正在为老板分配客服，请稍候";
    return "正在由 " + (conversation.assigned_service_name || "客服") + " / " + conversation.assigned_service_id + " 接待";
  }

  function filterConversations(db) {
    var keyword = String(state.search || "").toLowerCase();
    return db.serviceConversations.filter(function (conversation) {
      if (state.filter === "waiting" && conversation.status !== "未接待") return false;
      if (state.filter === "assigned" && conversation.status !== "已被客服接待") return false;
      if (state.filter === "customer_waiting" && conversation.status !== "等待老板回复") return false;
      if (state.filter === "after_sale" && conversation.status !== "售后处理中") return false;
      if (state.filter === "ended" && conversation.status !== "已结束") return false;
      if (state.filter === "abnormal" && conversation.status !== "黑名单或异常会话") return false;
      if (!keyword) return true;
      return [
        conversation.boss_name,
        conversation.boss_user_id,
        conversation.order_no,
        conversation.assigned_service_name,
        conversation.status,
        lastMessage(db, conversation).text_content
      ].join(" ").toLowerCase().indexOf(keyword) >= 0;
    }).sort(function (a, b) {
      return Date.parse(b.last_message_at || b.created_at || 0) - Date.parse(a.last_message_at || a.created_at || 0);
    });
  }

  function ensureActive(db) {
    var list = filterConversations(db);
    if (state.activeId && list.some(function (item) { return item.id === state.activeId; })) return;
    state.activeId = list.length ? list[0].id : "";
  }

  function statusClass(status) {
    if (status === "未接待") return "waiting";
    if (status === "已被客服接待") return "assigned";
    if (status === "等待老板回复") return "reply";
    if (status === "售后处理中") return "after-sale";
    if (status === "已结束") return "ended";
    return "abnormal";
  }

  function conversationListHtml(db) {
    var conversations = filterConversations(db);
    if (!conversations.length) {
      return '<div class="svc-pool-empty">暂无客服会话。老板点击在线客服后会进入这里。</div>';
    }
    return conversations.map(function (conversation) {
      var last = lastMessage(db, conversation);
      var active = conversation.id === state.activeId ? "active" : "";
      return [
        '<button class="svc-pool-conversation ' + active + '" data-svc-open="' + esc(conversation.id) + '">',
        '<img src="' + esc(conversation.boss_avatar || "../assets/cat-neon-avatar.png") + '" alt="">',
        '<div><strong>' + esc(conversation.boss_name || "老板") + '</strong>',
        '<p>' + esc(last.text_content || conversation.last_message_text || "暂无消息") + '</p>',
        '<small>' + esc(conversation.boss_user_id || "-") + ' · ' + esc(conversation.order_no || "在线客服") + '</small></div>',
        '<aside><span class="svc-status ' + statusClass(conversation.status) + '">' + esc(conversation.status || "未接待") + '</span><small>' + esc(last.created_at || conversation.last_message_at || "") + '</small></aside>',
        '</button>'
      ].join("");
    }).join("");
  }

  function filterTabsHtml() {
    var tabs = [
      ["all", "全部"],
      ["waiting", "待接待"],
      ["assigned", "接待中"],
      ["customer_waiting", "等待老板回复"],
      ["after_sale", "售后处理中"],
      ["ended", "已结束"],
      ["abnormal", "异常会话"]
    ];
    return tabs.map(function (tab) {
      return '<button class="' + (state.filter === tab[0] ? "active" : "") + '" data-svc-filter="' + tab[0] + '">' + tab[1] + '</button>';
    }).join("");
  }

  function detailHtml(db) {
    var conversation = db.serviceConversations.find(function (item) { return item.id === state.activeId; });
    if (!conversation) {
      return '<section class="svc-pool-detail-empty"><strong>请选择会话</strong><span>所有客服账号会看到同一个消息池。</span></section>';
    }
    var service = currentService();
    var owned = canReply(conversation);
    var assignedToOther = conversation.assigned_service_id && String(conversation.assigned_service_id) !== String(service.id);
    return [
      '<section class="svc-pool-detail">',
      detailHeader(conversation, owned, assignedToOther),
      '<div class="svc-pool-messages">' + messagesHtml(db, conversation) + '</div>',
      replyBox(conversation, owned, assignedToOther),
      '</section>'
    ].join("");
  }

  function detailHeader(conversation, owned, assignedToOther) {
    return [
      '<header class="svc-pool-chat-head">',
      '<div class="svc-boss-info"><img src="' + esc(conversation.boss_avatar || "../assets/cat-neon-avatar.png") + '" alt=""><div><h2>' + esc(conversation.boss_name || "老板") + '</h2><p>老板ID：' + esc(conversation.boss_user_id || "-") + ' · 订单：' + esc(conversation.order_no || "无关联订单") + '</p><p>' + esc(assignmentText(conversation)) + '</p></div></div>',
      '<div class="svc-chat-meta"><span class="svc-status ' + statusClass(conversation.status) + '">' + esc(conversation.status || "未接待") + '</span><small>接待开始：' + esc(conversation.assigned_at || "-") + '</small><small>当前客服：' + esc(conversation.assigned_service_name || "未接待") + '</small></div>',
      '<div class="svc-chat-actions">',
      !conversation.assigned_service_id ? '<button class="svc-action primary" data-svc-claim="' + esc(conversation.id) + '">接待</button>' : '',
      assignedToOther ? '<button class="svc-action" data-svc-takeover="' + esc(conversation.id) + '">申请接管</button>' : '',
      owned ? '<button class="svc-action" data-svc-transfer="' + esc(conversation.id) + '">转接客服</button><button class="svc-action" data-svc-release="' + esc(conversation.id) + '">转回公共池</button><button class="svc-action danger" data-svc-end="' + esc(conversation.id) + '">结束会话</button>' : '',
      conversation.status === "已结束" ? '<button class="svc-action" data-svc-reopen="' + esc(conversation.id) + '">重新打开</button>' : '',
      '</div></header>'
    ].join("");
  }

  function messagesHtml(db, conversation) {
    var messages = messagesFor(db, conversation.id);
    if (!messages.length) return '<div class="svc-pool-empty">暂无聊天记录。</div>';
    return messages.map(function (message) {
      var system = message.sender_role === "system" || message.message_type === "system";
      var fromService = message.sender_role === "customer_service";
      var content = message.message_type === "image"
        ? '<img class="svc-message-image" src="' + esc(message.media_url || "") + '" alt="图片消息">'
        : esc(message.text_content || "");
      return [
        '<article class="svc-message ' + (system ? "system" : (fromService ? "service" : "boss")) + '">',
        system ? '' : '<img src="' + esc(message.sender_avatar || (fromService ? "../assets/cat-neon-avatar.png" : "../assets/cat-neon-avatar.png")) + '" alt="">',
        '<div><small>' + esc(message.sender_name || (fromService ? "客服" : "老板")) + ' · ' + esc(message.created_at || "") + '</small><p>' + content + '</p></div>',
        '</article>'
      ].join("");
    }).join("");
  }

  function replyBox(conversation, owned, assignedToOther) {
    if (conversation.status === "已结束") {
      return '<div class="svc-reply-lock">该会话已结束，如需继续处理请先重新打开。</div>';
    }
    if (assignedToOther) {
      return '<div class="svc-reply-lock">该会话正在由客服 ' + esc(conversation.assigned_service_name || "-") + ' 接待</div>';
    }
    if (!owned) {
      return '<div class="svc-reply-lock">请先点击“接待”后再回复老板。</div>';
    }
    return [
      '<form class="svc-reply-box" data-svc-send="' + esc(conversation.id) + '">',
      '<textarea name="message" placeholder="输入回复内容"></textarea>',
      '<button type="button" data-svc-image>图片</button>',
      '<button type="submit">发送</button>',
      '<input type="file" accept="image/*" hidden data-svc-image-input>',
      '</form>'
    ].join("");
  }

  function render(target) {
    if (!target) return;
    addStyle();
    var db = readDb();
    ensureActive(db);
    target.innerHTML = [
      '<div class="svc-message-pool" data-svc-pool>',
      '<aside class="svc-pool-sidebar">',
      '<div class="svc-pool-title"><h2>统一客服消息池</h2><p>所有客服账号共用同一套老板咨询列表</p></div>',
      '<input class="svc-pool-search" data-svc-search placeholder="搜索老板、老板ID、订单号、客服">',
      '<div class="svc-pool-filters">' + filterTabsHtml() + '</div>',
      '<div class="svc-pool-list">' + conversationListHtml(db) + '</div>',
      '</aside>',
      '<main class="svc-pool-main">' + detailHtml(db) + '</main>',
      '</div>'
    ].join("");
    bind(target);
    schedule(target);
  }

  function bind(target) {
    if (target.dataset.svcPoolBound === "1") return;
    target.dataset.svcPoolBound = "1";
    target.addEventListener("click", function (event) {
      var open = event.target.closest("[data-svc-open]");
      if (open) { state.activeId = open.dataset.svcOpen; render(target); return; }
      var filter = event.target.closest("[data-svc-filter]");
      if (filter) { state.filter = filter.dataset.svcFilter; state.activeId = ""; render(target); return; }
      var claim = event.target.closest("[data-svc-claim]");
      if (claim) { claimConversation(claim.dataset.svcClaim, false); render(target); return; }
      var takeover = event.target.closest("[data-svc-takeover]");
      if (takeover) { claimConversation(takeover.dataset.svcTakeover, true); render(target); return; }
      var transfer = event.target.closest("[data-svc-transfer]");
      if (transfer) { transferConversation(transfer.dataset.svcTransfer); render(target); return; }
      var release = event.target.closest("[data-svc-release]");
      if (release) { releaseConversation(release.dataset.svcRelease); render(target); return; }
      var end = event.target.closest("[data-svc-end]");
      if (end) { endConversation(end.dataset.svcEnd); render(target); return; }
      var reopen = event.target.closest("[data-svc-reopen]");
      if (reopen) { reopenConversation(reopen.dataset.svcReopen); render(target); return; }
      var image = event.target.closest("[data-svc-image]");
      if (image) {
        var input = image.closest("form").querySelector("[data-svc-image-input]");
        if (input) input.click();
      }
    });
    target.addEventListener("input", function (event) {
      if (event.target.matches("[data-svc-search]")) {
        state.search = event.target.value;
        clearTimeout(target._svcSearchTimer);
        target._svcSearchTimer = setTimeout(function () { render(target); }, 220);
      }
    });
    target.addEventListener("submit", function (event) {
      var form = event.target.closest("[data-svc-send]");
      if (!form) return;
      event.preventDefault();
      sendMessage(form.dataset.svcSend, form.elements.message.value.trim(), "text", "");
      form.elements.message.value = "";
      render(target);
    });
    target.addEventListener("change", function (event) {
      var input = event.target.closest("[data-svc-image-input]");
      if (!input || !input.files || !input.files[0]) return;
      var conversationId = input.closest("form").dataset.svcSend;
      var reader = new FileReader();
      reader.onload = function () {
        sendMessage(conversationId, "", "image", String(reader.result || ""));
        render(target);
      };
      reader.readAsDataURL(input.files[0]);
    });
    window.addEventListener("storage", function (event) {
      if (event.key === STORE_KEY) render(target);
    });
    window.addEventListener("mcj:service-conversation-updated", function () { render(target); });
  }

  function findConversation(db, id) {
    return db.serviceConversations.find(function (conversation) { return conversation.id === id; });
  }

  function claimConversation(id, force) {
    var db = readDb();
    var conversation = findConversation(db, id);
    if (!conversation) return;
    var service = currentService();
    if (conversation.assigned_service_id && String(conversation.assigned_service_id) !== String(service.id) && !force) {
      alert("该会话已被客服 " + (conversation.assigned_service_name || "-") + " 接待");
      return;
    }
    var before = conversation.assigned_service_name || "未接待";
    conversation.assigned_service_id = service.id;
    conversation.assigned_service_name = service.name;
    conversation.assigned_service_avatar = service.avatar;
    conversation.assigned_service_online = service.online ? "在线" : "离线";
    conversation.assigned_at = conversation.assigned_at || nowText();
    conversation.status = "已被客服接待";
    conversation.updated_at = nowText();
    db.conversationAssignments.unshift({
      id: createId("CSA"),
      conversation_id: conversation.id,
      service_id: service.id,
      service_name: service.name,
      action: force ? "takeover" : "claim",
      created_at: nowText()
    });
    addSystemMessage(db, conversation.id, "客服 " + service.name + " 已接待该会话");
    addLog(db, force ? "强制接管会话" : "接待会话", conversation, before, service.name);
    writeDb(db);
  }

  function transferConversation(id) {
    var db = readDb();
    var conversation = findConversation(db, id);
    if (!conversation || !canReply(conversation)) return;
    var from = conversation.assigned_service_name || "";
    var input = prompt("请输入要转接的客服ID或姓名。留空则转回公共待接待池：", "");
    if (input == null) return;
    input = input.trim();
    if (!input) {
      releaseConversation(id);
      return;
    }
    var target = db.supportAgents.find(function (agent) {
      return String(agent.id || agent.user_id || agent.serviceId || "") === input || String(agent.name || agent.nickname || "") === input;
    }) || { id: input, name: input, avatar: "../assets/cat-neon-avatar.png", online: true };
    conversation.status = "已被客服接待";
    conversation.assigned_service_id = target.serviceId || target.user_id || target.id;
    conversation.assigned_service_name = target.name || target.nickname || input;
    conversation.assigned_service_avatar = target.avatar || target.avatar_url || "../assets/cat-neon-avatar.png";
    conversation.assigned_service_online = target.online === false ? "离线" : "在线";
    conversation.assigned_at = nowText();
    conversation.updated_at = nowText();
    db.conversationAssignments.unshift({
      id: createId("CSA"),
      conversation_id: conversation.id,
      service_id: conversation.assigned_service_id,
      service_name: conversation.assigned_service_name,
      action: "transfer",
      created_at: nowText()
    });
    addSystemMessage(db, conversation.id, "客服 " + from + " 已将会话转接给客服 " + conversation.assigned_service_name);
    addLog(db, "转接会话", conversation, from, conversation.assigned_service_name);
    writeDb(db);
  }

  function releaseConversation(id) {
    var db = readDb();
    var conversation = findConversation(db, id);
    if (!conversation) return;
    var before = conversation.assigned_service_name || "未接待";
    conversation.assigned_service_id = "";
    conversation.assigned_service_name = "";
    conversation.assigned_service_avatar = "";
    conversation.assigned_service_online = "";
    conversation.assigned_at = "";
    conversation.status = "未接待";
    conversation.updated_at = nowText();
    addSystemMessage(db, conversation.id, "该会话已重新进入待接待队列");
    addLog(db, "转回公共待接待池", conversation, before, "未接待");
    writeDb(db);
  }

  function endConversation(id) {
    var db = readDb();
    var conversation = findConversation(db, id);
    if (!conversation || !canReply(conversation)) return;
    conversation.status = "已结束";
    conversation.ended_at = nowText();
    conversation.updated_at = nowText();
    addSystemMessage(db, conversation.id, "客服已结束本次会话");
    addLog(db, "结束会话", conversation, "", "已结束");
    writeDb(db);
  }

  function reopenConversation(id) {
    var db = readDb();
    var conversation = findConversation(db, id);
    if (!conversation) return;
    conversation.status = conversation.assigned_service_id ? "已被客服接待" : "未接待";
    conversation.ended_at = "";
    conversation.updated_at = nowText();
    addSystemMessage(db, conversation.id, "会话已重新打开");
    addLog(db, "重新打开会话", conversation, "已结束", conversation.status);
    writeDb(db);
  }

  function sendMessage(id, text, type, mediaUrl) {
    if (!text && type !== "image") return;
    var db = readDb();
    var conversation = findConversation(db, id);
    if (!conversation) return;
    if (!canReply(conversation)) {
      alert("该会话正在由客服 " + (conversation.assigned_service_name || "-") + " 接待");
      return;
    }
    var service = currentService();
    var message = {
      id: createId("MSG"),
      conversation_id: conversation.id,
      sender_role: "customer_service",
      sender_account_id: service.id,
      sender_id: service.id,
      sender_name: service.name,
      sender_avatar: service.avatar,
      message_type: type || "text",
      text_content: text || "",
      media_url: mediaUrl || "",
      is_read: false,
      is_recalled: false,
      read_state: "老板未读",
      send_status: "sent",
      created_at: nowText()
    };
    db.serviceMessages.push(message);
    conversation.last_message_text = type === "image" ? "[图片]" : text;
    conversation.last_message_at = message.created_at;
    conversation.status = "等待老板回复";
    conversation.updated_at = nowText();
    addLog(db, "发送客服消息", conversation, "", type === "image" ? "[图片]" : text);
    writeDb(db);
  }

  function schedule(target) {
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = setTimeout(function () {
      if (document.body.contains(target)) render(target);
    }, 5000);
  }

  function addStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = [
      ".svc-message-pool{display:grid;grid-template-columns:minmax(280px,380px) minmax(0,1fr);gap:16px;min-height:calc(100vh - 172px)}",
      ".svc-pool-sidebar,.svc-pool-main{border:1px solid rgba(255,190,224,.18);border-radius:20px;background:linear-gradient(145deg,rgba(22,12,22,.88),rgba(8,7,12,.94));box-shadow:0 20px 46px rgba(0,0,0,.32);overflow:hidden}",
      ".svc-pool-sidebar{display:grid;grid-template-rows:auto auto auto 1fr;gap:12px;padding:14px}.svc-pool-title h2{margin:0;color:#fff;font-size:20px}.svc-pool-title p{margin:5px 0 0;color:rgba(255,230,243,.62);font-size:12px}",
      ".svc-pool-search{height:42px;border-radius:14px;border:1px solid rgba(255,190,224,.20);background:rgba(255,255,255,.055);color:#fff;padding:0 12px;outline:0}.svc-pool-search:focus{border-color:rgba(255,190,224,.62);box-shadow:0 0 0 3px rgba(255,120,190,.12)}",
      ".svc-pool-filters{display:flex;gap:8px;overflow:auto;padding-bottom:2px}.svc-pool-filters button{white-space:nowrap;border:1px solid rgba(255,190,224,.16);background:rgba(255,255,255,.045);color:#ffe3f0;border-radius:999px;padding:8px 12px;font-weight:800;cursor:pointer}.svc-pool-filters button.active{background:rgba(255,119,184,.18);border-color:rgba(255,190,224,.54);color:#fff}",
      ".svc-pool-list{display:grid;gap:9px;overflow:auto}.svc-pool-conversation{display:grid;grid-template-columns:42px 1fr auto;gap:10px;align-items:center;width:100%;border:1px solid rgba(255,190,224,.12);background:rgba(255,255,255,.035);border-radius:16px;padding:10px;color:#fff;text-align:left;cursor:pointer}.svc-pool-conversation.active,.svc-pool-conversation:hover{border-color:rgba(255,190,224,.45);background:rgba(255,119,184,.10)}.svc-pool-conversation img{width:42px;height:42px;border-radius:50%;object-fit:cover}.svc-pool-conversation strong{display:block;color:#fff}.svc-pool-conversation p{margin:4px 0;color:rgba(255,230,243,.70);font-size:12px;max-width:190px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.svc-pool-conversation small{display:block;color:rgba(255,230,243,.48);font-size:11px}.svc-pool-conversation aside{text-align:right;display:grid;gap:5px}",
      ".svc-status{display:inline-flex;align-items:center;justify-content:center;border-radius:999px;padding:5px 9px;font-size:11px;font-weight:900;border:1px solid rgba(255,190,224,.18);color:#ffe3f0}.svc-status.waiting{color:#ff7f9e;border-color:rgba(255,84,126,.45);background:rgba(255,84,126,.12)}.svc-status.assigned{color:#ffd75f;border-color:rgba(255,215,95,.45);background:rgba(255,215,95,.10)}.svc-status.reply{color:#82c8ff;border-color:rgba(130,200,255,.42);background:rgba(130,200,255,.10)}.svc-status.after-sale{color:#ffb46d;border-color:rgba(255,180,109,.42);background:rgba(255,180,109,.10)}.svc-status.ended{color:#98f0b5;border-color:rgba(98,220,122,.42);background:rgba(98,220,122,.10)}.svc-status.abnormal{color:#ccc;background:rgba(255,255,255,.05)}",
      ".svc-pool-detail,.svc-pool-detail-empty{height:100%;display:grid;grid-template-rows:auto 1fr auto}.svc-pool-detail-empty{place-items:center;color:rgba(255,230,243,.62);text-align:center;padding:28px}.svc-pool-detail-empty strong{color:#fff;font-size:20px}",
      ".svc-pool-chat-head{display:grid;grid-template-columns:1fr auto;gap:12px;padding:14px;border-bottom:1px solid rgba(255,190,224,.12)}.svc-boss-info{display:flex;gap:12px;align-items:center}.svc-boss-info img{width:52px;height:52px;border-radius:50%;object-fit:cover}.svc-boss-info h2{margin:0;color:#fff;font-size:19px}.svc-boss-info p{margin:4px 0 0;color:rgba(255,230,243,.66);font-size:12px}.svc-chat-meta{display:grid;justify-items:end;gap:4px;color:rgba(255,230,243,.58);font-size:12px}.svc-chat-actions{grid-column:1/-1;display:flex;gap:8px;flex-wrap:wrap}.svc-action{border:1px solid rgba(255,190,224,.22);background:rgba(255,255,255,.045);color:#ffe3f0;border-radius:999px;padding:8px 12px;font-weight:900;cursor:pointer}.svc-action.primary{background:linear-gradient(135deg,#ffd2e6,#ff7fbd);color:#17070f;border:0}.svc-action.danger{color:#ffd1dd;border-color:rgba(255,86,124,.38);background:rgba(255,86,124,.10)}",
      ".svc-pool-messages{overflow:auto;padding:18px;display:flex;flex-direction:column;gap:12px}.svc-message{display:grid;grid-template-columns:38px minmax(0,max-content);gap:9px;max-width:78%;align-self:flex-start}.svc-message.service{grid-template-columns:minmax(0,max-content) 38px;align-self:flex-end}.svc-message.service img{grid-column:2;grid-row:1}.svc-message.service div{grid-column:1;grid-row:1}.svc-message.system{display:flex;align-self:center;max-width:90%;text-align:center}.svc-message>img{width:38px;height:38px;border-radius:50%;object-fit:cover}.svc-message small{display:block;margin:0 0 4px;color:rgba(255,230,243,.46);font-size:11px}.svc-message p{margin:0;border:1px solid rgba(255,190,224,.14);border-radius:16px;background:rgba(255,255,255,.055);color:#fff;padding:10px 12px;white-space:pre-wrap;overflow-wrap:anywhere}.svc-message.service p{border-color:rgba(255,142,199,.34);background:rgba(255,142,199,.15)}.svc-message.system p{border-radius:999px;color:rgba(255,230,243,.64);font-size:12px}.svc-message-image{max-width:240px;border-radius:14px;border:1px solid rgba(255,190,224,.16)}",
      ".svc-reply-box{display:grid;grid-template-columns:1fr auto auto;gap:8px;padding:12px;border-top:1px solid rgba(255,190,224,.12)}.svc-reply-box textarea{width:100%;min-height:44px;max-height:120px;resize:vertical;border-radius:14px;border:1px solid rgba(255,190,224,.20);background:rgba(255,255,255,.055);color:#fff;padding:10px 12px;outline:0}.svc-reply-box button{border:1px solid rgba(255,190,224,.22);background:rgba(255,255,255,.045);color:#ffe3f0;border-radius:14px;padding:0 14px;font-weight:900;cursor:pointer}.svc-reply-box button[type=submit]{border:0;background:linear-gradient(135deg,#ffd2e6,#ff7fbd);color:#17070f}.svc-reply-lock{padding:14px;text-align:center;color:#ffd8e7;border-top:1px solid rgba(255,190,224,.12);background:rgba(255,255,255,.035)}.svc-pool-empty{border:1px dashed rgba(255,190,224,.24);border-radius:16px;padding:18px;text-align:center;color:rgba(255,230,243,.62)}",
      "@media(max-width:860px){.svc-message-pool{grid-template-columns:1fr}.svc-pool-chat-head{grid-template-columns:1fr}.svc-chat-meta{justify-items:start}.svc-message{max-width:94%}.svc-reply-box{grid-template-columns:1fr auto}.svc-reply-box button[type=button]{display:none}}"
    ].join("\n");
    document.head.appendChild(style);
  }

  window.MCJServiceMessagePool = {
    render: render,
    readDb: readDb,
    writeDb: writeDb,
    claimConversation: claimConversation,
    transferConversation: transferConversation
  };
})();
