(function () {
  "use strict";

  if (window.MCJPlatformContract) return;

  var ORDER_STATUS = {
    WAITING_ACCEPT: {
      value: "waiting_accept",
      label: "待接单",
      tone: "pink",
      terminal: false,
      aliases: ["available", "pending_accept", "待接单", "等待陪玩接单", "等待接单"]
    },
    WAITING_CUSTOMER_CONFIRM: {
      value: "waiting_customer_confirm",
      label: "待老板确认",
      tone: "gold",
      terminal: false,
      aliases: ["pending_confirm", "quote_pending", "待确认", "待老板确认", "待老板确认报价"]
    },
    WAITING_PLAYER_START: {
      value: "waiting_player_start",
      label: "待陪玩开始",
      tone: "blue",
      terminal: false,
      aliases: ["pending_start", "paid_waiting_start", "待开始", "待陪玩开始", "已付款待安排"]
    },
    IN_PROGRESS: {
      value: "in_progress",
      label: "进行中",
      tone: "green",
      terminal: false,
      aliases: ["running", "started", "进行中"]
    },
    WAITING_COMPLETE_CONFIRM: {
      value: "waiting_complete_confirm",
      label: "待完成确认",
      tone: "purple",
      terminal: false,
      aliases: ["pending_complete", "waiting_finish_confirm", "待完成确认", "待双方确认完成"]
    },
    COMPLETED: {
      value: "completed",
      label: "已完成",
      tone: "green",
      terminal: true,
      aliases: ["done", "finished", "已完成"]
    },
    CANCELLED: {
      value: "cancelled",
      label: "已取消",
      tone: "muted",
      terminal: true,
      aliases: ["canceled", "已取消"]
    },
    REFUND_REQUESTED: {
      value: "refund_requested",
      label: "退款申请中",
      tone: "orange",
      terminal: false,
      aliases: ["refunding", "refund_pending", "退款中", "退款申请中"]
    },
    REFUNDED: {
      value: "refunded",
      label: "已退款",
      tone: "muted",
      terminal: true,
      aliases: ["refund_done", "已退款"]
    },
    AFTER_SALE: {
      value: "after_sale",
      label: "售后处理中",
      tone: "red",
      terminal: false,
      aliases: ["after_sales", "after_sale_processing", "售后中", "售后处理中"]
    },
    CLOSED: {
      value: "closed",
      label: "已关闭",
      tone: "muted",
      terminal: true,
      aliases: ["archived", "已关闭"]
    }
  };

  var STATUS_LIST = Object.keys(ORDER_STATUS).map(function (key) {
    return ORDER_STATUS[key];
  });

  var aliasMap = {};
  STATUS_LIST.forEach(function (item) {
    aliasMap[item.value] = item.value;
    aliasMap[item.label] = item.value;
    (item.aliases || []).forEach(function (alias) {
      aliasMap[String(alias)] = item.value;
    });
  });

  function normalizeOrderStatus(status, fallback) {
    var raw = String(status || "").trim();
    if (!raw) return fallback || ORDER_STATUS.WAITING_ACCEPT.value;
    return aliasMap[raw] || fallback || raw;
  }

  function orderStatusMeta(status) {
    var normalized = normalizeOrderStatus(status);
    return STATUS_LIST.find(function (item) { return item.value === normalized; }) || {
      value: normalized,
      label: String(status || normalized),
      tone: "muted",
      terminal: false,
      aliases: []
    };
  }

  function normalizeOrder(order) {
    order = Object.assign({}, order || {});
    var normalized = normalizeOrderStatus(order.order_status || order.status);
    var meta = orderStatusMeta(normalized);
    order.order_status = normalized;
    order.status = normalized;
    order.status_label = meta.label;
    order.status_tone = meta.tone;
    order.status_terminal = meta.terminal;
    return order;
  }

  function statusOptions() {
    return STATUS_LIST.map(function (item) {
      return {
        value: item.value,
        label: item.label,
        tone: item.tone,
        terminal: item.terminal
      };
    });
  }

  function emitDataUpdated(reason, detail) {
    try {
      window.dispatchEvent(new CustomEvent("mcj:platform-data-updated", {
        detail: Object.assign({ reason: reason || "data_updated" }, detail || {})
      }));
    } catch (error) {}
  }

  window.MCJPlatformContract = {
    version: "2026-07-23.four-end-unification",
    storeKey: "mcjPlatformData.v1",
    orderStatuses: ORDER_STATUS,
    statusOptions: statusOptions,
    normalizeOrderStatus: normalizeOrderStatus,
    orderStatusMeta: orderStatusMeta,
    normalizeOrder: normalizeOrder,
    emitDataUpdated: emitDataUpdated,
    roles: {
      customer: "老板",
      companion: "陪玩",
      customer_service: "客服",
      super_admin: "管理员"
    },
    collections: {
      users: "users",
      companions: "players",
      customerServices: "supportAgents",
      orders: "orders",
      conversations: "serviceConversations",
      messages: "serviceMessages",
      wallets: "wallets",
      walletTransactions: "walletTransactions",
      rechargeRecords: "rechargeRecords",
      withdrawalRecords: "withdrawalRecords",
      refundRecords: "refunds",
      banners: "contents.banners",
      notices: "contents.notices",
      ads: "contents.ads",
      gameplays: "gameplays",
      games: "games",
      auditLogs: "auditLogs",
      systemMessages: "systemMessages"
    },
    serviceTypes: [
      { value: "game", label: "游戏陪玩" },
      { value: "voice", label: "语音服务" },
      { value: "both", label: "游戏陪玩和语音服务" },
      { value: "custom", label: "自定义订单" },
      { value: "gameplay", label: "固定玩法" }
    ]
  };
})();
