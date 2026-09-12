(function () {
  if (window.MCJUnifiedAPI) return;

  function config() {
    return window.MCJUnifiedConfig || { apiBase: "/api", useMockApi: false };
  }

  function localStore() {
    return window.MCJStore && window.MCJStore.read ? window.MCJStore : null;
  }

  function request(path, options) {
    var base = config().apiBase || "/api";
    return fetch(base + path, Object.assign({
      headers: { "Content-Type": "application/json; charset=UTF-8" }
    }, options || {})).then(function (res) {
      if (!res.ok) throw new Error("API 请求失败：" + res.status);
      return res.json();
    });
  }

  function useMockAdapter() {
    return config().useMockApi === true && !!localStore();
  }

  function readLocal() {
    var store = localStore();
    return store ? store.read() : {};
  }

  function list(collection) {
    if (useMockAdapter()) return Promise.resolve(readLocal()[collection] || []);
    return request("/" + collection);
  }

  function dashboardStats() {
    if (!useMockAdapter()) return request("/admin/dashboard");
    var db = readLocal();
    return Promise.resolve({
      customers: (db.bosses || []).length,
      players: (db.players || []).length,
      supportAgents: (db.supportAgents || []).length,
      pendingPlayers: (db.players || []).filter(function (p) { return p.audit === "待审核" || p.verification_status === "pending"; }).length,
      todayOrders: (db.orders || []).length,
      inProgressOrders: (db.orders || []).filter(function (o) { return o.status === "进行中" || o.order_status === "in_progress"; }).length,
      todayRechargeAmount: (db.finance || []).filter(function (f) { return f.type === "老板充值"; }).reduce(function (n, f) { return n + Number(f.amount || 0); }, 0),
      pendingWithdrawalAmount: (db.withdrawals || []).filter(function (w) { return w.status === "待审核"; }).reduce(function (n, w) { return n + Number(w.amount || 0); }, 0),
      totalFlow: (db.finance || []).reduce(function (n, f) { return n + Number(f.amount || 0); }, 0)
    });
  }

  function updatePlayerCommission(playerId, payload) {
    payload = payload || {};
    if (!useMockAdapter()) {
      return request("/admin/players/" + encodeURIComponent(playerId) + "/commission-rules", {
        method: "POST",
        body: JSON.stringify(payload)
      });
    }
    var store = localStore();
    return Promise.resolve(store.transaction("统一抽成规则修改", function (db) {
      var player = (db.players || []).find(function (p) { return p.id === playerId; });
      if (!player) throw new Error("陪玩不存在");
      var before = {
        orderCommissionRate: player.orderCommissionRate,
        giftCommissionRate: player.giftCommissionRate,
        playerIncomeRate: player.playerIncomeRate
      };
      player.orderCommissionOverride = true;
      player.giftCommissionOverride = true;
      player.orderCommissionRate = Number(payload.platform_commission_rate || payload.orderCommissionRate || 0);
      player.playerIncomeRate = Number(payload.player_income_rate || (100 - player.orderCommissionRate));
      player.giftCommissionRate = Number(payload.gift_platform_commission_rate || payload.giftCommissionRate || 0);
      db.commissionLogs = db.commissionLogs || [];
      db.commissionLogs.unshift({
        id: store.uid("COM"),
        playerId: player.id,
        playerName: player.nickname,
        before: JSON.stringify(before),
        after: JSON.stringify({
          orderCommissionRate: player.orderCommissionRate,
          playerIncomeRate: player.playerIncomeRate,
          giftCommissionRate: player.giftCommissionRate
        }),
        reason: payload.reason || "未填写原因",
        admin: payload.admin || "super_admin",
        createdAt: new Date().toLocaleString("zh-CN")
      });
      return player;
    }));
  }

  function snapshotOrderSettlement(order, rule) {
    if (!window.MCJCommissionEngine) throw new Error("结算引擎未加载");
    return window.MCJCommissionEngine.calculateOrderSnapshot(order, rule);
  }

  function syncStatus() {
    var modules = [
      ["用户资料", "/users", "统一用户模型"],
      ["陪玩资料", "/player-profiles", "陪玩管理 / 大厅 / 陪玩端"],
      ["陪玩等级", "/player-levels", "等级、曝光、卡面"],
      ["玩法", "/platform-settings/service-types", "首页 / 客服派单 / 抢单大厅"],
      ["价格", "/price-services", "俱乐部价格表"],
      ["订单", "/orders", "老板端 / 陪玩端 / 客服端 / 后台"],
      ["聊天", "/chat", "站内消息系统"],
      ["猫粮充值", "/payments/recharges", "老板猫粮充值"],
      ["提现", "/withdrawals", "陪玩提现 / 后台审核"],
      ["退款", "/refunds", "订单售后"],
      ["抽成", "/commission-rules", "结算快照"],
      ["直属关系", "/referral-relations", "邀请老板 / 直属陪玩"],
      ["返点规则", "/referral-commission-rules", "订单返点 / 礼物返点"],
      ["返点流水", "/referral-commission-records", "结算快照"],
      ["返点钱包", "/referral-wallets", "可提现返点"],
      ["Banner", "/contents/banners", "首页广告"],
      ["公告", "/contents/notices", "首页与端内公告"],
      ["制度", "/contents/policies", "制度管理"],
      ["组队大厅链接", "/platform-settings/team-hall", "首页入口"]
    ];
    return Promise.resolve(modules.map(function (m) {
      return {
        name: m[0],
        endpoint: m[1],
        owner: m[2],
        status: useMockAdapter() ? "本地统一适配" : "等待真实 API",
        lastCheckedAt: new Date().toLocaleString("zh-CN"),
        ok: useMockAdapter()
      };
    }));
  }

  window.MCJUnifiedAPI = {
    request: request,
    list: list,
    listUsers: function () { return list("users"); },
    listPlayers: function () { return list("players"); },
    listOrders: function () { return list("orders"); },
    listFinance: function () { return list("finance"); },
    listReferralRelations: function () { return list("referralRelations"); },
    listReferralCommissionRules: function () { return list("referralCommissionRules"); },
    listReferralCommissionRecords: function () { return list("referralCommissionRecords"); },
    listReferralWallets: function () { return list("referralWallets"); },
    dashboardStats: dashboardStats,
    updatePlayerCommission: updatePlayerCommission,
    snapshotOrderSettlement: snapshotOrderSettlement,
    syncStatus: syncStatus,
    dataMode: function () { return useMockAdapter() ? "mock-adapter" : "api"; }
  };
})();
