(function () {
  var api = window.MCJCustomerServiceAPI;
  if (!api) return;

  function esc(v) {
    return String(v == null ? "" : v).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function money(v) { return "RM " + Number(v || 0).toFixed(2); }
  function panel(name) { return document.querySelector('[data-service-panel="' + name + '"]'); }
  function urgency(o) {
    var map = { red: "立即处理", orange: "即将超时", yellow: "等待处理中", green: "正常" };
    return '<span class="svc-tag urgent-' + esc(o.urgency || "green") + '">' + esc(map[o.urgency] || "正常") + '</span>';
  }
  function statusTag(status) {
    var key = /售后|异常|退款/.test(status) ? "danger" : /进行中|等待|派单/.test(status) ? "blue" : /已完成/.test(status) ? "green" : /待/.test(status) ? "pink" : "gray";
    return '<span class="svc-tag svc-' + key + '">' + esc(status) + '</span>';
  }
  function serviceBtn(text, action, id, extra) {
    return '<button class="svc-btn ' + esc(extra || "") + '" type="button" data-service-action="' + esc(action) + '" data-id="' + esc(id) + '">' + esc(text) + '</button>';
  }
  function table(headers, rows, empty) {
    return '<div class="svc-table-wrap"><table class="svc-table"><thead><tr>' + headers.map(function (h) { return '<th>' + esc(h) + '</th>'; }).join("") + '</tr></thead><tbody>' + (rows.length ? rows.join("") : '<tr><td colspan="' + headers.length + '" class="svc-empty">' + esc(empty || "暂无数据") + '</td></tr>') + '</tbody></table></div>';
  }
  function updateCounts() {
    var counts = api.getCounts();
    Object.keys(counts).forEach(function (key) {
      document.querySelectorAll('[data-service-count="' + key + '"]').forEach(function (el) {
        el.textContent = counts[key];
        el.hidden = !counts[key];
      });
    });
  }
  function renderDashboard() {
    var target = panel("home");
    if (!target) return;
    var data = api.read();
    var stats = api.getDashboardStats();
    var urgent = data.orders.filter(function (o) { return o.urgency !== "green" || /已付款待安排|待报价|异常|拒绝/.test(o.status); });
    target.innerHTML =
      '<div class="svc-page-head"><div><h1>工作台</h1><p>客服接单、派单、老板沟通与售后处理中心。</p></div></div>' +
      '<div class="svc-metrics">' +
      metric("今日新增订单", stats.todayNew) + metric("待安排陪玩", stats.waitingAssign) + metric("派单中", stats.dispatching) + metric("进行中订单", stats.running) + metric("待售后", stats.afterSales) + metric("今日完成订单", stats.completed) +
      '</div>' +
      '<section class="mcj-card"><div class="svc-section-head"><h2>紧急待处理</h2><span>超过 10 分钟、催单、拒单和异常订单优先处理</span></div>' +
      table(["订单号", "老板昵称", "订单类型", "游戏", "预约时间", "等待时间", "紧急原因", "操作"], urgent.map(function (o) {
        return '<tr><td>' + esc(o.id) + '</td><td>' + esc(o.bossName) + '</td><td>' + esc(o.kind) + '</td><td>' + esc(o.game) + '</td><td>' + esc(o.appointmentAt) + '</td><td>' + esc(o.waitMinutes) + ' 分钟</td><td>' + urgency(o) + ' ' + esc(o.urgentReason) + '</td><td>' + serviceBtn("立即处理", "detail", o.id, "primary") + '</td></tr>';
      }), "暂无紧急订单") + '</section>' +
      '<div class="svc-two-col"><section class="mcj-card"><h2>今日值班</h2>' +
      '<div class="svc-profile-row"><img src="' + esc(data.serviceUser.avatar) + '" alt=""><div><b>' + esc(data.serviceUser.name) + '</b><span>' + esc(data.serviceUser.role) + ' · ' + esc(data.serviceUser.shift) + '</span></div></div>' +
      '<div class="svc-info-list"><span>上班时间：' + esc(data.serviceUser.clockInAt || "未打卡") + '</span><span>已工作时长：' + esc(data.serviceUser.workHours) + '</span><span>今日处理订单：' + esc(data.serviceUser.handledToday) + '</span><span>平均回复：' + esc(data.serviceUser.avgReply) + '</span><span>售后数量：' + esc(data.serviceUser.afterSalesToday) + '</span><span>打卡状态：' + (data.serviceUser.clockedIn ? "上班中" : "未打卡") + '</span></div></section>' +
      '<section class="mcj-card"><h2>最近操作记录</h2><div class="svc-log-list">' + data.logs.slice(0, 6).map(function (l) { return '<p><b>' + esc(l.time) + '</b>' + esc(l.text) + '</p>'; }).join("") + '</div></section></div>';
  }
  function metric(label, value) { return '<div class="mcj-card svc-metric"><span>' + esc(label) + '</span><strong>' + esc(value) + '</strong></div>'; }

  function orderRow(o) {
    return '<tr><td>' + urgency(o) + '</td><td>' + esc(o.id) + '</td><td><b>' + esc(o.bossName) + '</b><small>' + esc(o.bossId) + '</small></td><td>' + esc(o.kind) + '</td><td>' + esc(o.game || o.service) + '</td><td>' + esc(o.appointmentAt) + '</td><td>' + esc(o.duration || o.expectedDuration || "-") + '</td><td>' + esc(o.paymentStatus) + '</td><td>' + statusTag(o.status) + '</td><td>' + esc(o.waitMinutes || 0) + ' 分钟</td><td>' + esc((o.assignedCompanions || []).join(", ") || "未安排") + '</td><td>' + esc(o.owner) + '</td><td class="svc-actions">' + serviceBtn("查看详情", "detail", o.id, "primary") + serviceBtn("联系老板", "message", o.id) + serviceBtn("安排陪玩", "dispatch", o.id) + serviceBtn("修改订单", "status", o.id) + serviceBtn("转交客服", "transfer", o.id) + serviceBtn("标记异常", "abnormal", o.id, "danger") + serviceBtn("取消订单", "cancel", o.id, "danger") + '</td></tr>';
  }
  function renderPending() {
    var target = panel("pending");
    var orders = api.getPendingOrders();
    target.innerHTML = pageHead("待处理", "新订单、待报价、待付款、已付款待安排、派单中和异常订单。") + filters(["全部", "新订单", "待报价", "待付款", "已付款待安排", "派单中", "陪玩拒绝", "老板催单", "即将超时", "异常订单"]) +
      '<section class="mcj-card">' + table(["紧急等级", "订单号", "老板信息", "订单类型", "游戏/服务", "预约时间", "订单时长", "付款状态", "当前状态", "等待时间", "已安排陪玩", "负责客服", "操作"], orders.map(orderRow), "暂无待处理订单") + '</section>';
  }
  function renderOrders() {
    var target = panel("orders");
    var orders = api.getOrders();
    target.innerHTML = pageHead("订单管理", "统一管理固定订单与自定义订单，支持详情、报价、状态、退款与时间线。") +
      '<section class="mcj-card"><div class="svc-toolbar"><input data-service-search placeholder="搜索订单号、老板、游戏、陪玩"><select data-order-status-filter><option>全部状态</option><option>待报价</option><option>待付款</option><option>已付款待安排</option><option>派单中</option><option>进行中</option><option>售后处理中</option></select></div>' +
      table(["订单号", "老板", "类型", "游戏", "服务内容", "金额", "陪玩", "状态", "创建时间", "操作"], orders.map(function (o) {
        return '<tr><td>' + esc(o.id) + '</td><td>' + esc(o.bossName) + '</td><td>' + esc(o.kind) + '</td><td>' + esc(o.game) + '</td><td>' + esc(o.service) + '</td><td>' + money(o.paidAmount || o.quoteAmount || o.amount) + '</td><td>' + esc((o.assignedCompanions || []).join(", ") || "未安排") + '</td><td>' + statusTag(o.status) + '</td><td>' + esc(o.createdAt) + '</td><td class="svc-actions">' + serviceBtn("详情", "detail", o.id, "primary") + serviceBtn("报价", "quote", o.id) + serviceBtn("状态", "status", o.id) + serviceBtn("退款", "refund", o.id, "danger") + '</td></tr>';
      }), "暂无订单") + '</section>';
  }
  function renderMessages() {
    var target = panel("messages");
    if (window.MCJServiceMessagePool) {
      window.MCJServiceMessagePool.render(target);
      return;
    }
    if (window.MCJChat) {
      window.MCJChat.render({
        id: "service-messages",
        target: target,
        role: "customer_service",
        title: "会话中心",
        refreshMs: 8000
      });
      return;
    }
    var data = api.read();
    var current = data.orders.find(function (o) { return (o.messages || []).length; }) || data.orders[0];
    target.innerHTML = pageHead("老板消息", "左侧切换老板会话，右侧回复并记录首次响应。") +
      '<div class="svc-chat-layout"><aside class="mcj-card svc-session-list">' + data.orders.map(function (o) {
        var msg = (o.messages || [])[0] || {};
        var unread = (o.messages || []).filter(function (m) { return !m.read && m.role === "boss"; }).length;
        return '<button class="' + (o.id === current.id ? "active" : "") + '" data-chat-order="' + esc(o.id) + '"><b>' + esc(o.bossName) + '</b><span>' + esc(msg.text || "暂无消息") + '</span><small>' + esc(o.id) + ' · 等待 ' + esc(o.waitMinutes || 0) + ' 分钟</small>' + (unread ? '<em>' + unread + '</em>' : '') + '</button>';
      }).join("") + '</aside><section class="mcj-card svc-chat-box" data-chat-box>' + chatBox(current, data.quickReplies) + '</section></div>';
  }
  function chatBox(order, replies) {
    return '<div class="svc-room-head"><div><h2>' + esc(order.bossName) + '</h2><p>' + esc(order.id) + ' · ' + esc(order.game) + ' · ' + esc(order.status) + '</p></div>' + serviceBtn("结束对话", "close-chat", order.id, "danger") + '</div><div class="svc-quick-replies">' + replies.map(function (r) { return '<button type="button" data-quick-reply="' + esc(r) + '" data-id="' + esc(order.id) + '">' + esc(r) + '</button>'; }).join("") + '</div><div class="svc-message-list">' + (order.messages || []).map(function (m) { return '<div class="svc-message ' + esc(m.role) + '"><b>' + esc(m.from) + ' · ' + esc(m.role) + '</b><p>' + esc(m.text) + '</p><small>' + esc(m.time) + ' · ' + (m.read ? "已读" : "未读") + '</small></div>'; }).join("") + '</div><form class="svc-send" data-send-message data-id="' + esc(order.id) + '"><input name="message" placeholder="输入回复老板的内容"><button class="svc-btn primary" type="submit">发送</button></form>';
  }
  function renderDispatch() {
    var target = panel("dispatch");
    var data = api.read();
    var orders = data.orders.filter(function (o) { return /已付款待安排|派单中|等待陪玩接单|待报价/.test(o.status); });
    target.innerHTML = pageHead("陪玩调度", "为老板筛选、推荐并派发合适陪玩。") +
      '<div class="svc-dispatch-layout"><aside class="mcj-card"><h2>待安排订单</h2>' + orders.map(function (o) { return '<button class="svc-order-pick" data-select-dispatch="' + esc(o.id) + '"><b>' + esc(o.id) + '</b><span>' + esc(o.bossName) + ' · ' + esc(o.game) + '</span>' + statusTag(o.status) + '</button>'; }).join("") + '</aside><section class="mcj-card"><div class="svc-section-head"><h2>可安排陪玩</h2><span>支持多候选抢单、主陪副陪和派单备注</span></div><div class="svc-toolbar"><input placeholder="搜索游戏、区服、标签、陪玩昵称"><select><option>全部等级</option><option>Lv5</option><option>Lv4</option></select><select><option>在线且空闲</option><option>全部在线</option></select></div><div class="svc-companion-grid">' + data.companions.map(companionCard).join("") + '</div><div class="svc-dispatch-footer"><input data-dispatch-note placeholder="派单备注，例如：老板要求声音温柔，会报点"><button class="svc-btn primary" data-send-dispatch>发送派单</button><button class="svc-btn danger" data-reject-demo>模拟陪玩拒单</button></div></section></div>';
  }
  function companionCard(c) {
    return '<label class="svc-companion-card"><input type="checkbox" value="' + esc(c.id) + '" data-dispatch-companion><img src="' + esc(c.avatar) + '" alt=""><div><b>' + esc(c.name) + '</b><span>' + esc(c.id) + ' · ' + esc(c.level) + '</span><p>' + esc(c.game) + ' · ' + esc(c.rank) + ' · ' + esc(c.tags) + '</p><small>' + (c.online ? "在线" : "离线") + ' · ' + (c.idle ? "空闲" : "忙碌") + ' · ' + esc(c.nextFree) + ' · ' + esc(c.price) + '</small><small>好评 ' + esc(c.rating) + ' · 成功率 ' + esc(c.successRate) + ' · 本月 ' + esc(c.monthOrders) + ' 单</small></div></label>';
  }
  function renderTickets() {
    var data = api.read();
    panel("tickets").innerHTML = pageHead("售后工单", "处理迟到、失联、态度、时长争议、退款和补时。") +
      '<section class="mcj-card"><div class="svc-toolbar">' + serviceBtn("新建售后工单", "new-ticket", "", "primary") + '<select><option>全部状态</option><option>待处理</option><option>处理中</option></select></div>' +
      table(["工单号", "订单号", "发起人", "问题类型", "问题说明", "证据", "负责人", "优先级", "创建时间", "处理时长", "状态", "操作"], data.afterSalesTickets.map(function (t) {
        return '<tr><td>' + esc(t.id) + '</td><td>' + esc(t.orderId) + '</td><td>' + esc(t.creator) + '</td><td>' + esc(t.type) + '</td><td>' + esc(t.description) + '</td><td>' + esc(t.evidence) + '</td><td>' + esc(t.owner) + '</td><td>' + esc(t.priority) + '</td><td>' + esc(t.createdAt) + '</td><td>' + esc(t.duration) + '</td><td>' + statusTag(t.status) + '</td><td class="svc-actions">' + serviceBtn("联系老板", "ticket-boss", t.id) + serviceBtn("联系陪玩", "ticket-player", t.id) + serviceBtn("补时", "ticket-time", t.id) + serviceBtn("提交退款", "ticket-refund", t.orderId, "danger") + serviceBtn("关闭", "ticket-close", t.id) + '</td></tr>';
      }), "暂无售后工单") + '</section>';
  }
  function renderSalary() {
    var data = api.read();
    var s = data.salary;
    panel("salary").innerHTML = pageHead("工资与考勤", "客服只能查看自己的工资和考勤，不能修改。") +
      '<div class="svc-metrics">' + metric("本月底薪", money(s.base)) + metric("全勤奖励", money(s.attendanceBonus)) + metric("绩效奖励", money(s.performanceBonus)) + metric("订单处理奖励", money(s.orderBonus)) + metric("售后处理奖励", money(s.afterSalesBonus)) + metric("预计工资", money(s.expected)) + '</div>' +
      '<section class="mcj-card"><h2>考勤</h2><div class="svc-info-list"><span>今日班次：' + esc(data.serviceUser.shift) + '</span><span>上班打卡：' + esc(data.serviceUser.clockInAt || "未打卡") + '</span><span>实际工作时长：' + esc(data.serviceUser.workHours) + '</span><span>迟到分钟：' + esc(s.lateMinutes) + '</span><span>提前下班：' + esc(s.earlyLeaveMinutes) + '</span><span>本月出勤：' + esc(s.attendanceDays) + ' 天</span><span>全勤状态：' + esc(s.fullAttendance) + '</span></div><div class="svc-actions">' + serviceBtn("上班打卡", "clock-in", "", "primary") + serviceBtn("下班打卡", "clock-out", "") + '</div></section>';
  }
  function renderMine() {
    var u = api.read().serviceUser;
    panel("mine").innerHTML = pageHead("我的", "客服资料、安全和登录信息。") +
      '<section class="mcj-card"><div class="svc-profile-row big"><img src="' + esc(u.avatar) + '" alt=""><div><h2>' + esc(u.name) + '</h2><p>' + esc(u.id) + ' · ' + esc(u.role) + '</p><p>当前班次：' + esc(u.shift) + '</p><p>联系方式：' + esc(u.contact) + '</p></div></div><div class="svc-actions">' + serviceBtn("修改密码", "change-password", "") + serviceBtn("登录设备", "devices", "") + serviceBtn("最近登录记录", "login-log", "") + serviceBtn("退出登录", "logout", "", "danger") + '</div></section>';
  }
  function pageHead(title, desc) { return '<div class="svc-page-head"><div><h1>' + esc(title) + '</h1><p>' + esc(desc) + '</p></div></div>'; }
  function filters(items) { return '<section class="mcj-card"><div class="svc-toolbar"><input data-service-search placeholder="搜索订单号、老板昵称、老板ID、游戏、陪玩、联系方式">' + items.map(function (x, i) { return '<button class="svc-filter ' + (i === 0 ? "active" : "") + '" type="button">' + esc(x) + '</button>'; }).join("") + '</div></section>'; }

  function openDetail(orderId) {
    var order = api.getOrderDetail(orderId);
    if (!order) return;
    var assigned = (order.assignedCompanions || []).join(", ") || "未安排";
    var actionButtons = "";
    if (order.status === "已付款待安排") actionButtons = serviceBtn("安排陪玩", "dispatch", order.id, "primary") + serviceBtn("联系老板", "message", order.id) + serviceBtn("修改预约时间", "reschedule", order.id) + serviceBtn("标记紧急", "urgent", order.id) + serviceBtn("申请取消", "cancel", order.id, "danger");
    else if (/派单中|等待陪玩接单/.test(order.status)) actionButtons = serviceBtn("查看已派发陪玩", "dispatch", order.id) + serviceBtn("增加候选陪玩", "dispatch", order.id, "primary") + serviceBtn("撤回派单", "withdraw-dispatch", order.id) + serviceBtn("更换陪玩", "dispatch", order.id) + serviceBtn("联系陪玩", "contact-player", order.id);
    else if (order.status === "进行中") actionButtons = serviceBtn("暂停计时", "pause", order.id) + serviceBtn("恢复计时", "resume", order.id) + serviceBtn("提前结束", "complete", order.id, "primary") + serviceBtn("更换陪玩", "dispatch", order.id) + serviceBtn("创建售后工单", "create-ticket", order.id, "danger");
    else actionButtons = serviceBtn("联系老板", "message", order.id) + serviceBtn("安排陪玩", "dispatch", order.id, "primary") + serviceBtn("开始订单", "start", order.id) + serviceBtn("建立对接", "room", order.id);
    document.body.insertAdjacentHTML("beforeend", '<div class="svc-drawer" data-service-drawer><div class="svc-drawer-card"><button class="svc-close" data-close-drawer>×</button><div class="svc-drawer-grid"><main><h2>' + esc(order.id) + '</h2><p>' + esc(order.kind) + ' · ' + statusTag(order.status) + '</p>' + detailBlock("订单基本资料", ["订单类型：" + order.kind, "游戏/服务：" + order.game + " / " + order.service, "预约时间：" + order.appointmentAt, "时长：" + (order.duration || order.expectedDuration || "-"), "负责客服：" + order.owner]) + detailBlock("老板资料", ["老板：" + order.bossName, "老板ID：" + order.bossId, "等级：" + order.bossVip, "联系方式：" + order.bossContact]) + detailBlock("服务需求", ["备注：" + (order.note || "-"), "性别偏好：" + (order.genderPreference || "-"), "指定陪玩要求：" + (order.companionRequirement || "-"), "技术要求：" + (order.skillRequirement || "-"), "语言要求：" + (order.languageRequirement || "-")]) + detailBlock("付款信息", ["付款状态：" + order.paymentStatus, "订单金额：" + money(order.amount || order.quoteAmount), "实付金额：" + money(order.paidAmount)]) + detailBlock("陪玩安排", ["已安排：" + assigned, "房间：" + (order.roomCreated ? order.roomId : "未建立")]) + detailList("沟通记录", order.messages || [], function (m) { return m.time + " " + m.from + "：" + m.text; }) + detailList("订单时间线", order.timeline || [], function (t) { return t.time + " " + t.text; }) + detailList("操作记录", order.operations || [], function (o) { return o.time + " " + o.operator + "：" + o.before + " → " + o.after + "，" + o.reason; }) + '</main><aside><h3>固定操作区</h3><div class="svc-actions vertical">' + actionButtons + '</div></aside></div></div></div>');
  }
  function detailBlock(title, rows) { return '<section class="svc-detail-block"><h3>' + esc(title) + '</h3>' + rows.map(function (r) { return '<p>' + esc(r) + '</p>'; }).join("") + '</section>'; }
  function detailList(title, rows, map) { return '<section class="svc-detail-block"><h3>' + esc(title) + '</h3>' + (rows.length ? rows.map(function (r) { return '<p>' + esc(map(r)) + '</p>'; }).join("") : '<p>暂无记录</p>') + '</section>'; }
  function closeDrawer() { document.querySelector("[data-service-drawer]")?.remove(); }
  function rerender() { renderAll(); updateCounts(); }

  function bindActions() {
    document.addEventListener("click", function (e) {
      var close = e.target.closest("[data-close-drawer]");
      if (close) { closeDrawer(); return; }
      var chat = e.target.closest("[data-chat-order]");
      if (chat) {
        var order = api.getOrderDetail(chat.dataset.chatOrder);
        var box = document.querySelector("[data-chat-box]");
        if (box) box.innerHTML = chatBox(order, api.read().quickReplies);
        document.querySelectorAll("[data-chat-order]").forEach(function (b) { b.classList.toggle("active", b === chat); });
        return;
      }
      var quick = e.target.closest("[data-quick-reply]");
      if (quick) { api.sendOrderMessage(quick.dataset.id, quick.dataset.quickReply); rerender(); return; }
      var action = e.target.closest("[data-service-action]");
      if (!action) return;
      var id = action.dataset.id;
      var type = action.dataset.serviceAction;
      if (type === "detail") openDetail(id);
      if (type === "message") { activate("messages"); var order = api.getOrderDetail(id); var box = document.querySelector("[data-chat-box]"); if (box && order) box.innerHTML = chatBox(order, api.read().quickReplies); }
      if (type === "dispatch") activate("dispatch");
      if (type === "quote") {
        var amount = prompt("填写最终报价 RM：", "180");
        if (amount) api.createCustomQuote(id, { amount: amount, duration: prompt("预计时长：", "3小时"), note: prompt("报价说明：", "客服已核算服务难度") || "" });
        api.sendQuoteToBoss(id);
        rerender();
      }
      if (type === "status") { var st = prompt("输入新订单状态：", "已付款待安排"); if (st) { api.updateOrderStatus(id, st, prompt("修改原因：", "客服处理") || "客服处理"); rerender(); } }
      if (type === "abnormal") { api.updateOrderStatus(id, "异常冻结", "客服标记异常"); rerender(); }
      if (type === "cancel") { api.updateOrderStatus(id, "已取消", prompt("取消原因：", "老板取消或客服协商取消") || "客服取消"); rerender(); }
      if (type === "refund" || type === "ticket-refund") { api.submitRefundRequest(id, prompt("退款金额 RM：", "20"), prompt("退款原因：", "售后退款申请") || "售后退款申请"); rerender(); }
      if (type === "start") { api.startOrder(id); closeDrawer(); rerender(); }
      if (type === "pause") { api.pauseOrder(id); closeDrawer(); rerender(); }
      if (type === "resume") { api.resumeOrder(id); closeDrawer(); rerender(); }
      if (type === "complete") { api.completeOrder(id); closeDrawer(); rerender(); }
      if (type === "room") { api.createOrderRoom(id); alert("已建立订单三方沟通房间"); closeDrawer(); rerender(); }
      if (type === "create-ticket" || type === "new-ticket") { var orderId = id || prompt("订单号：", "MCJ-20260712-00125"); api.createAfterSalesTicket(orderId, { type: prompt("工单类型：", "更换陪玩"), description: prompt("问题说明：", "老板要求客服介入处理"), priority: "高" }); closeDrawer(); rerender(); }
      if (type === "clock-in") { api.clockIn(); rerender(); }
      if (type === "clock-out") { api.clockOut(); rerender(); }
      if (type === "logout") { localStorage.removeItem("customerServiceAuthToken"); localStorage.removeItem("customerServiceUser"); location.reload(); }
      if (/transfer|reschedule|urgent|withdraw-dispatch|contact-player|close-chat|ticket-boss|ticket-player|ticket-time|ticket-close|change-password|devices|login-log/.test(type)) alert("已记录操作：" + action.textContent.trim());
    });
    document.addEventListener("click", function (e) {
      if (e.target.closest("[data-send-dispatch]")) {
        var order = document.querySelector(".svc-order-pick.active") || document.querySelector(".svc-order-pick");
        var ids = Array.prototype.slice.call(document.querySelectorAll("[data-dispatch-companion]:checked")).map(function (x) { return x.value; });
        if (!order || !ids.length) { alert("请先选择订单和至少一位陪玩"); return; }
        api.assignCompanions(order.dataset.selectDispatch, ids, document.querySelector("[data-dispatch-note]")?.value || "");
        alert("派单已发送，陪玩端会收到候选订单。");
        rerender();
      }
      if (e.target.closest("[data-reject-demo]")) {
        var orderBtn = document.querySelector(".svc-order-pick.active") || document.querySelector(".svc-order-pick");
        if (!orderBtn) return;
        api.rejectAssignment(orderBtn.dataset.selectDispatch, "PW-1001", prompt("拒单原因：", "时间冲突") || "时间冲突");
        rerender();
      }
      var pick = e.target.closest("[data-select-dispatch]");
      if (pick) { document.querySelectorAll(".svc-order-pick").forEach(function (b) { b.classList.toggle("active", b === pick); }); }
    });
    document.addEventListener("submit", function (e) {
      if (e.target.matches("[data-send-message]")) {
        e.preventDefault();
        var msg = e.target.elements.message.value.trim();
        if (!msg) return;
        api.sendOrderMessage(e.target.dataset.id, msg);
        rerender();
      }
    });
  }
  function activate(id) {
    document.querySelectorAll("[data-service-view]").forEach(function (btn) {
      btn.classList.toggle("active", btn.dataset.serviceView === id);
    });
    document.querySelectorAll(".service-view").forEach(function (view) {
      view.classList.toggle("active", view.id === "service-" + id);
    });
    renderAll();
  }
  function renderAll() {
    renderDashboard();
    renderPending();
    renderOrders();
    renderMessages();
    renderDispatch();
    renderTickets();
    renderSalary();
    renderMine();
    updateCounts();
  }
  function init() {
    if (!document.querySelector("[data-service-app]")) return;
    renderAll();
    bindActions();
    window.addEventListener("mcj:service-data", updateCounts);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
