(function () {
  if (window.MCJUnifiedConfig) return;

  var orderStatuses = [
    ["pending_payment", "待付款"],
    ["available", "待接单"],
    ["pending_confirm", "待确认"],
    ["pending_start", "待开始"],
    ["in_progress", "进行中"],
    ["completed", "已完成"],
    ["refunding", "退款中"],
    ["refunded", "已退款"],
    ["after_sale", "售后中"],
    ["cancelled", "已取消"]
  ];

  var serviceTypes = [
    ["standard", "普通陪玩"],
    ["voice", "语聊"],
    ["fun", "趣味单"],
    ["escort", "护航单"],
    ["loot_run", "跑刀"],
    ["boost", "代肝 / 代打"],
    ["custom", "自定义订单"],
    ["gameplay", "更多玩法"]
  ];

  window.MCJUnifiedConfig = {
    apiBase: window.MCJ_API_BASE || "/api",
    useMockApi: window.MCJ_USE_MOCK_API === true,
    roles: {
      customer: "老板",
      player: "陪玩",
      customer_service: "客服",
      super_admin: "超级管理员"
    },
    rolePermissions: {
      customer: ["home", "hall", "orders", "messages", "wallet", "settings"],
      player: ["dashboard", "grab", "orders", "messages", "income", "profile"],
      customer_service: ["dashboard", "pending", "messages", "dispatch", "tickets", "salary"],
      super_admin: ["dashboard", "users", "orders", "finance", "content", "settings", "logs"]
    },
    orderStatusConfig: orderStatuses.map(function (x) { return { value: x[0], label: x[1] }; }),
    serviceTypeConfig: serviceTypes.map(function (x) { return { value: x[0], label: x[1] }; }),
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
      { level_number: 1, level_name: "Lv.1 萌喵", sort_weight: 100, status: "enabled" },
      { level_number: 2, level_name: "Lv.2 奶猫", sort_weight: 200, status: "enabled" },
      { level_number: 3, level_name: "Lv.3 布偶猫", sort_weight: 300, status: "enabled" },
      { level_number: 4, level_name: "Lv.4 喵神", sort_weight: 400, status: "enabled" },
      { level_number: 5, level_name: "Lv.5 喵皇", sort_weight: 500, status: "enabled" }
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
      platform_settings: ["key", "value", "scope", "updated_by", "updated_at"],
      audit_logs: ["id", "admin_id", "module", "action", "target_id", "before", "after", "ip", "device", "created_at"]
    }
  };
})();
