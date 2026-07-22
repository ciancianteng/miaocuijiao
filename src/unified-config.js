(function () {
  "use strict";

  if (window.MCJUnifiedConfig) return;

  var contract = window.MCJPlatformContract || {};
  var orderStatusConfig = contract.statusOptions ? contract.statusOptions() : [
    { value: "waiting_accept", label: "待接单", tone: "pink", terminal: false },
    { value: "waiting_customer_confirm", label: "待老板确认", tone: "gold", terminal: false },
    { value: "waiting_player_start", label: "待陪玩开始", tone: "blue", terminal: false },
    { value: "in_progress", label: "进行中", tone: "green", terminal: false },
    { value: "waiting_complete_confirm", label: "待完成确认", tone: "purple", terminal: false },
    { value: "completed", label: "已完成", tone: "green", terminal: true },
    { value: "cancelled", label: "已取消", tone: "muted", terminal: true },
    { value: "refund_requested", label: "退款申请中", tone: "orange", terminal: false },
    { value: "refunded", label: "已退款", tone: "muted", terminal: true },
    { value: "after_sale", label: "售后处理中", tone: "red", terminal: false },
    { value: "closed", label: "已关闭", tone: "muted", terminal: true }
  ];

  window.MCJUnifiedConfig = {
    apiBase: window.MCJ_API_BASE || "/api",
    useMockApi: window.MCJ_USE_MOCK_API === true,
    dataContractVersion: contract.version || "2026-07-23.four-end-unification",
    roles: {
      customer: "老板",
      companion: "陪玩",
      player: "陪玩",
      customer_service: "客服",
      super_admin: "管理员",
      admin: "管理员"
    },
    rolePermissions: {
      customer: ["home", "hall", "orders", "messages", "wallet", "settings", "refunds", "favorites"],
      companion: ["dashboard", "grab", "orders", "messages", "income", "profile", "withdrawals", "policies"],
      player: ["dashboard", "grab", "orders", "messages", "income", "profile", "withdrawals", "policies"],
      customer_service: ["dashboard", "pending", "messages", "dispatch", "tickets", "salary", "quick_replies"],
      super_admin: ["dashboard", "users", "orders", "finance", "content", "settings", "logs", "permissions"],
      admin: ["dashboard", "users", "orders", "finance", "content", "settings", "logs", "permissions"]
    },
    orderStatusConfig: orderStatusConfig,
    serviceTypeConfig: (contract.serviceTypes || [
      { value: "game", label: "游戏陪玩" },
      { value: "voice", label: "语音服务" },
      { value: "both", label: "游戏陪玩和语音服务" },
      { value: "custom", label: "自定义订单" },
      { value: "gameplay", label: "固定玩法" }
    ]),
    commissionConfig: {
      defaultPlatformCommissionRate: 20,
      defaultPlayerIncomeRate: 80,
      defaultInviterRebateRate: 0,
      defaultGiftPlatformCommissionRate: 20,
      defaultGiftPlayerIncomeRate: 80,
      priority: ["player", "club", "level", "platform"]
    },
    referralConfig: {
      defaultOrderRebateRate: 5,
      defaultGiftRebateRate: 5,
      defaultRebateSource: "PLATFORM_PROFIT",
      maxDepth: 1,
      allowDecimals: true
    },
    playerLevelConfig: [
      { level_number: 1, level_name: "Lv.1 萌新", sort_weight: 100, status: "enabled" },
      { level_number: 2, level_name: "Lv.2 奶猫", sort_weight: 200, status: "enabled" },
      { level_number: 3, level_name: "Lv.3 布偶猫", sort_weight: 300, status: "enabled" },
      { level_number: 4, level_name: "Lv.4 喵神", sort_weight: 400, status: "enabled" },
      { level_number: 5, level_name: "Lv.5 喵王", sort_weight: 500, status: "enabled" }
    ],
    withdrawalConfig: {
      minimumAmount: 10,
      monthlyLimit: 4,
      feeRate: 0
    },
    schemas: {
      users: ["id", "role", "nickname", "avatar", "phone", "email", "status", "created_at", "updated_at"],
      player_profiles: ["user_id", "display_name", "player_level_id", "club_id", "games", "service_types", "online_status", "verification_status", "available_balance", "frozen_balance"],
      player_levels: ["id", "level_name", "level_number", "minimum_price", "maximum_price", "default_platform_commission_rate", "default_player_income_rate", "card_style", "sort_weight", "status"],
      commission_rules: ["id", "rule_name", "applicable_scope", "applicable_player_id", "applicable_level_id", "service_type", "platform_commission_rate", "player_income_rate", "inviter_rebate_rate", "effective_from", "effective_to", "status"],
      referral_relations: ["id", "inviter_user_id", "invited_user_id", "inviter_role", "invited_role", "relation_type", "referral_code", "created_at", "status", "bound_by_admin", "bind_remark"],
      referral_commission_rules: ["id", "rule_name", "inviter_user_id", "invited_user_id", "applicable_player_id", "applicable_club_id", "order_rebate_rate", "gift_rebate_rate", "rebate_source", "settlement_cycle", "effective_from", "effective_to", "status", "created_by", "updated_by", "created_at", "updated_at"],
      referral_commission_records: ["id", "order_id", "inviter_user_id", "invited_player_id", "commission_type", "base_amount", "rebate_rate", "rebate_amount", "rebate_source", "status", "settled_at", "created_at"],
      referral_wallets: ["user_id", "pending_amount", "available_amount", "frozen_amount", "total_earned", "total_withdrawn", "updated_at"],
      orders: ["id", "order_number", "customer_id", "player_id", "customer_service_id", "order_source", "service_type", "game", "duration", "paid_amount", "platform_commission_rate", "platform_commission_amount", "player_income_rate", "player_income_amount", "order_status", "payment_status", "created_at", "updated_at"],
      conversations: ["id", "conversation_type", "customer_id", "player_id", "customer_service_id", "status", "last_message_text", "last_message_at", "created_at", "updated_at"],
      messages: ["id", "conversation_id", "sender_id", "sender_role", "message_type", "text_content", "media_url", "order_id", "is_read", "created_at"],
      wallets: ["user_id", "role", "available_balance", "frozen_balance", "total_recharged", "total_spent", "total_withdrawn", "updated_at"],
      platform_settings: ["key", "value", "scope", "updated_by", "updated_at"],
      audit_logs: ["id", "admin_id", "module", "action", "target_id", "before", "after", "ip", "device", "created_at"]
    }
  };
})();
