(function () {
  if (window.MCJCommissionEngine) return;

  function amount(value) {
    return Number(Number(value || 0).toFixed(2));
  }

  function rate(value, fallback) {
    var n = Number(value);
    return Number.isFinite(n) ? n : Number(fallback || 0);
  }

  function validateRates(rule) {
    var platform = rate(rule.platform_commission_rate, rule.platformCommissionRate);
    var player = rate(rule.player_income_rate, rule.playerIncomeRate);
    var inviter = rate(rule.inviter_rebate_rate, rule.inviterRebateRate);
    if (platform < 0 || player < 0 || inviter < 0) throw new Error("抽成比例不能小于 0");
    // Platform + companion share the order. Inviter/直属返点 is % of platform fee (PLATFORM_PROFIT), not a third slice of order.
    if (platform + player > 100) throw new Error("平台抽成与陪玩到手合计不能超过 100%");
    if (inviter > 100) throw new Error("直属返点比例不能超过 100%");
    return { platform: platform, player: player, inviter: inviter };
  }

  function calculateOrderSnapshot(order, rule) {
    order = order || {};
    rule = rule || {};
    var rates = validateRates(rule);
    var paid = amount(order.paid_amount != null ? order.paid_amount : order.paidAmount || order.amount || order.original_amount);
    var platformAmount = amount(paid * rates.platform / 100);
    var playerAmount = amount(
      rule.player_income_rate != null || rule.playerIncomeRate != null
        ? paid * rates.player / 100
        : Math.max(0, paid - platformAmount)
    );
    // Locked: 直属返点 = 平台服务费 × 返点比例（禁止订单金额 × 比例）
    var inviterAmount = amount(platformAmount * rates.inviter / 100);
    var clubAmount = amount(Math.max(0, paid - platformAmount - playerAmount));
    return {
      paid_amount: paid,
      platform_commission_rate: rates.platform,
      platform_commission_amount: platformAmount,
      player_income_rate: rates.player,
      player_income_amount: playerAmount,
      inviter_rebate_rate: rates.inviter,
      inviter_rebate_amount: inviterAmount,
      inviter_rebate_base: "platform_fee",
      inviter_rebate_source: "PLATFORM_PROFIT",
      club_income_amount: clubAmount,
      settlement_snapshot_at: new Date().toISOString()
    };
  }

  function calculateGiftSnapshot(gift, rule) {
    gift = gift || {};
    rule = rule || {};
    var platform = rate(rule.gift_platform_commission_rate, rule.giftPlatformCommissionRate || rule.platform_commission_rate);
    var player = rate(rule.gift_player_income_rate, rule.giftPlayerIncomeRate || (100 - platform));
    if (platform < 0 || player < 0 || platform + player > 100) throw new Error("礼物抽成比例无效");
    var total = amount(gift.total_value != null ? gift.total_value : gift.totalValue || Number(gift.unitValue || 0) * Number(gift.quantity || 1));
    var platformAmount = amount(total * platform / 100);
    var playerAmount = amount(total * player / 100);
    return {
      gift_total_value: total,
      gift_platform_commission_rate: platform,
      gift_platform_commission_amount: platformAmount,
      gift_player_income_rate: player,
      gift_player_income_amount: playerAmount,
      settlement_snapshot_at: new Date().toISOString()
    };
  }

  function calculateReferralSnapshot(input, rule) {
    input = input || {};
    rule = rule || {};
    var rebateRate = rate(rule.rebate_rate != null ? rule.rebate_rate : rule.order_rebate_rate, 5);
    if (rebateRate < 0 || rebateRate > 100) throw new Error("直属返点比例必须在 0% 至 100% 之间");
    var source = String(rule.rebate_source || input.rebate_source || "PLATFORM_PROFIT").toUpperCase();
    var base = amount(input.base_amount || input.baseAmount || 0);
    if (!(base > 0)) {
      var orderAmount = amount(input.paid_amount || input.paidAmount || input.order_amount || input.orderAmount || input.amount || 0);
      var platformFee = amount(input.platform_fee || input.platformFee || input.platform_commission_amount || 0);
      var platformRate = rate(input.platform_commission_rate || input.platformFeeRate || rule.platform_commission_rate, 20);
      if (source === "ORDER_AMOUNT") {
        base = orderAmount;
      } else if (source === "COMPANION_INCOME") {
        base = amount(input.companion_income || input.companionIncome || 0);
      } else {
        // PLATFORM_PROFIT — prefer explicit fee; else derive from order × platform rate
        base = platformFee > 0 ? platformFee : amount(orderAmount * platformRate / 100);
      }
    }
    return {
      base_amount: base,
      rebate_rate: rebateRate,
      rebate_amount: amount(base * rebateRate / 100),
      rebate_source: source || "PLATFORM_PROFIT",
      settlement_snapshot_at: new Date().toISOString()
    };
  }

  function calculateDirectCommissionFromPlatformFee(input) {
    input = input || {};
    var orderAmount = amount(input.order_amount != null ? input.order_amount : input.orderAmount || input.paid_amount || input.amount || 0);
    var platformRate = rate(
      input.platform_fee_rate != null
        ? input.platform_fee_rate
        : input.platformFeeRate != null
          ? input.platformFeeRate
          : input.platform_commission_rate,
      20
    );
    var rebateRate = rate(
      input.rebate_rate != null
        ? input.rebate_rate
        : input.rebateRate != null
          ? input.rebateRate
          : input.boss_commission_rate != null
            ? input.boss_commission_rate
            : input.bossCommissionRate,
      0
    );
    var platformFee = amount(
      input.platform_fee != null || input.platformFeeAmount != null || input.platformFee != null
        ? (input.platform_fee != null
            ? input.platform_fee
            : input.platformFeeAmount != null
              ? input.platformFeeAmount
              : input.platformFee)
        : orderAmount * platformRate / 100
    );
    var rebateAmount = amount(platformFee * rebateRate / 100);
    return {
      order_amount: orderAmount,
      platform_fee_rate: platformRate,
      platform_fee_amount: platformFee,
      rebate_rate: rebateRate,
      rebate_amount: rebateAmount,
      boss_commission_amount: rebateAmount,
      companion_income_amount: amount(Math.max(0, orderAmount - platformFee)),
      rebate_source: "PLATFORM_PROFIT",
      calculated_from: "platform_fee_only",
      settlement_snapshot_at: new Date().toISOString()
    };
  }

  window.MCJCommissionEngine = {
    amount: amount,
    validateRates: validateRates,
    calculateOrderSnapshot: calculateOrderSnapshot,
    calculateGiftSnapshot: calculateGiftSnapshot,
    calculateReferralSnapshot: calculateReferralSnapshot,
    calculateDirectCommissionFromPlatformFee: calculateDirectCommissionFromPlatformFee
  };
})();
