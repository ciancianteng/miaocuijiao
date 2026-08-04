(function () {
  var KEY = "mcjCustomerServiceDesk.v1";

  function now() { return new Date().toLocaleString("zh-CN"); }
  function uid(prefix) { return prefix + "-" + Date.now().toString(36).toUpperCase() + Math.random().toString(16).slice(2, 6).toUpperCase(); }
  function clone(v) { return JSON.parse(JSON.stringify(v)); }

  function currentServiceUser() {
    var user = {};
    try { user = JSON.parse(localStorage.getItem("customerServiceUser") || "{}") || {}; } catch (e) {}
    return {
      id: user.user_id || user.id || "",
      name: user.nickname || user.name || "客服账号",
      role: user.roleName || user.role || "客服",
      shift: user.shift || "",
      contact: user.user_id || user.id || "",
      avatar: user.avatar_url || user.avatar || "../assets/meow-cuijiao-brand.jpg",
      clockedIn: !!user.clockedIn,
      clockInAt: user.clockInAt || "",
      workHours: user.workHours || "0小时",
      handledToday: Number(user.handledToday || 0),
      avgReply: user.avgReply || "-",
      afterSalesToday: Number(user.afterSalesToday || 0)
    };
  }

  function blankData() {
    return {
      serviceUser: currentServiceUser(),
      quickReplies: [],
      companions: [],
      orders: [],
      afterSalesTickets: [],
      salary: {
        base: 0,
        attendanceBonus: 0,
        performanceBonus: 0,
        orderBonus: 0,
        afterSalesBonus: 0,
        penalty: 0,
        expected: 0,
        settled: 0,
        attendanceDays: 0,
        fullAttendance: "-",
        lateMinutes: 0,
        earlyLeaveMinutes: 0
      },
      logs: []
    };
  }

  function read() {
    var data = blankData();
    try {
      var platform = JSON.parse(localStorage.getItem("mcjPlatformData.v1") || "{}") || {};
      data.quickReplies = Array.isArray(platform.quickReplies) ? platform.quickReplies : [];
      data.companions = Array.isArray(platform.players) ? platform.players : [];
      data.orders = Array.isArray(platform.orders) ? platform.orders : [];
      data.afterSalesTickets = Array.isArray(platform.afterSalesTickets) ? platform.afterSalesTickets : (Array.isArray(platform.refunds) ? platform.refunds : []);
      data.salary = Object.assign(data.salary, platform.customerServiceSalary || {});
      data.logs = Array.isArray(platform.customerServiceLogs) ? platform.customerServiceLogs : (Array.isArray(platform.logs) ? platform.logs : []);
      data.serviceUser = Object.assign(data.serviceUser, platform.currentCustomerServiceUser || {});
      return data;
    } catch (e) {
      return data;
    }
  }

  function write(data) {
    var platform = {};
    try { platform = JSON.parse(localStorage.getItem("mcjPlatformData.v1") || "{}") || {}; } catch (e) {}
    platform.orders = Array.isArray(data.orders) ? data.orders : [];
    platform.afterSalesTickets = Array.isArray(data.afterSalesTickets) ? data.afterSalesTickets : [];
    platform.customerServiceSalary = data.salary || {};
    platform.customerServiceLogs = Array.isArray(data.logs) ? data.logs : [];
    platform.currentCustomerServiceUser = data.serviceUser || {};
    localStorage.setItem("mcjPlatformData.v1", JSON.stringify(platform));
    window.dispatchEvent(new CustomEvent("mcj:service-data"));
    window.dispatchEvent(new CustomEvent("mcj:platform-data-updated"));
  }

  function log(data, text) {
    data.logs.unshift({ time: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }), text: text });
  }

  function findOrder(data, orderId) {
    return data.orders.find(function (order) { return order.id === orderId; });
  }

  function statusChange(data, order, status, reason) {
    var before = order.status;
    order.status = status;
    order.timeline = order.timeline || [];
    order.timeline.unshift({ time: now(), text: "状态从「" + before + "」改为「" + status + "」：" + reason });
    order.operations = order.operations || [];
    order.operations.unshift({ operator: data.serviceUser.name, before: before, after: status, reason: reason, time: now() });
    log(data, data.serviceUser.name + " 修改 " + order.id + " 状态为 " + status);
  }

  var api = {
    read: read,
    write: write,
    getDashboardStats: function () {
      var data = read();
      var orders = data.orders;
      return {
        todayNew: orders.length,
        waitingAssign: orders.filter(function (o) { return o.status === "已付款待安排"; }).length,
        dispatching: orders.filter(function (o) { return /派单中|等待陪玩接单/.test(o.status); }).length,
        running: orders.filter(function (o) { return o.status === "进行中"; }).length,
        afterSales: data.afterSalesTickets.filter(function (t) { return t.status !== "已关闭"; }).length,
        completed: orders.filter(function (o) { return o.status === "已完成"; }).length
      };
    },
    getPendingOrders: function () {
      return read().orders.filter(function (o) { return !/已完成|已取消|已退款/.test(o.status); });
    },
    getOrders: function () { return read().orders; },
    getOrderDetail: function (orderId) { return findOrder(read(), orderId); },
    createCustomQuote: function (orderId, quote) {
      var data = read();
      var order = findOrder(data, orderId);
      if (!order) return null;
      order.quoteAmount = Number(quote.amount || 0);
      order.expectedDuration = quote.duration || order.expectedDuration;
      order.quoteNote = quote.note || "";
      statusChange(data, order, "待老板确认报价", "客服已填写最终报价");
      write(data);
      return order;
    },
    sendQuoteToBoss: function (orderId) {
      var data = read();
      var order = findOrder(data, orderId);
      if (!order) return null;
      order.messages.unshift({ from: data.serviceUser.name, role: "service", text: "报价已发送，请确认后付款。", time: now(), read: false });
      log(data, data.serviceUser.name + " 向 " + order.bossName + " 发送报价");
      write(data);
      return order;
    },
    assignCompanions: function (orderId, companionIds, note) {
      var data = read();
      var order = findOrder(data, orderId);
      if (!order) return null;
      order.assignedCompanions = companionIds;
      order.assignmentNote = note || "";
      statusChange(data, order, "等待陪玩接单", "已发送派单给候选陪玩");
      write(data);
      return order;
    },
    rejectAssignment: function (orderId, companionId, reason) {
      var data = read();
      var order = findOrder(data, orderId);
      if (!order) return null;
      order.rejectLogs = order.rejectLogs || [];
      order.rejectLogs.unshift({ companionId: companionId, reason: reason, time: now() });
      statusChange(data, order, "已付款待安排", "陪玩拒单：" + reason);
      write(data);
      return order;
    },
    createOrderRoom: function (orderId) {
      var data = read();
      var order = findOrder(data, orderId);
      if (!order) return null;
      order.roomCreated = true;
      order.roomId = order.roomId || uid("ROOM");
      order.timeline.unshift({ time: now(), text: "已建立老板、陪玩、客服三方订单沟通房间" });
      log(data, data.serviceUser.name + " 建立订单房间 " + order.roomId);
      write(data);
      return order;
    },
    sendOrderMessage: function (orderId, message) {
      var data = read();
      var order = findOrder(data, orderId);
      if (!order) return null;
      order.messages = order.messages || [];
      order.messages.unshift({ from: data.serviceUser.name, role: "service", text: message, time: now(), read: false });
      log(data, data.serviceUser.name + " 回复老板 " + order.bossName);
      write(data);
      return order;
    },
    updateOrderStatus: function (orderId, status, reason) {
      var data = read();
      var order = findOrder(data, orderId);
      if (!order) return null;
      statusChange(data, order, status, reason || "客服手动调整");
      write(data);
      return order;
    },
    startOrder: function (orderId) {
      var data = read();
      var order = findOrder(data, orderId);
      if (!order) return null;
      order.timerStartedAt = Date.now();
      statusChange(data, order, "进行中", "陪玩开始订单，客服端同步计时");
      write(data);
      return order;
    },
    pauseOrder: function (orderId) { return api.updateOrderStatus(orderId, "异常冻结", "客服暂停计时"); },
    resumeOrder: function (orderId) { return api.updateOrderStatus(orderId, "进行中", "客服恢复计时"); },
    completeOrder: function (orderId) { return api.updateOrderStatus(orderId, "待双方确认完成", "客服标记服务已结束，等待双方确认"); },
    createAfterSalesTicket: function (orderId, dataInput) {
      var data = read();
      var order = findOrder(data, orderId);
      var ticket = { id: uid("AS"), orderId: orderId, creator: dataInput.creator || "客服", type: dataInput.type || "其他", description: dataInput.description || "", evidence: dataInput.evidence || "", owner: data.serviceUser.name, priority: dataInput.priority || "中", createdAt: now(), duration: "刚刚", status: "待处理", result: "" };
      data.afterSalesTickets.unshift(ticket);
      if (order) statusChange(data, order, "售后处理中", "创建售后工单 " + ticket.id);
      write(data);
      return ticket;
    },
    submitRefundRequest: function (orderId, amount, reason) {
      var data = read();
      var order = findOrder(data, orderId);
      if (!order) return null;
      order.refundRequest = { id: uid("RF"), amount: Number(amount || 0), reason: reason, status: "待运营审批", createdAt: now(), createdBy: data.serviceUser.name };
      statusChange(data, order, "售后处理中", "提交退款申请");
      write(data);
      return order;
    },
    getAttendance: function () { return read().serviceUser; },
    clockIn: function () {
      var data = read();
      data.serviceUser.clockedIn = true;
      data.serviceUser.clockInAt = now();
      log(data, data.serviceUser.name + " 上班打卡");
      write(data);
      return data.serviceUser;
    },
    clockOut: function () {
      var data = read();
      data.serviceUser.clockedIn = false;
      log(data, data.serviceUser.name + " 下班打卡");
      write(data);
      return data.serviceUser;
    },
    getSalaryDetail: function () { return clone(read().salary); },
    getCounts: function () {
      var data = read();
      return {
        pending: data.orders.filter(function (o) { return !/已完成|已取消|已退款/.test(o.status); }).length,
        messages: data.orders.reduce(function (sum, o) { return sum + (o.messages || []).filter(function (m) { return !m.read && m.role === "boss"; }).length; }, 0),
        tickets: data.afterSalesTickets.filter(function (t) { return t.status !== "已关闭"; }).length
      };
    }
  };

  window.MCJCustomerServiceAPI = api;
})();
