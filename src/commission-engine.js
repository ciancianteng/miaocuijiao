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
    if (platform + player + inviter > 100) throw new Error("平台抽成、陪玩到手和邀请返点合计不能超过 100%");
    return { platform: platform, player: player, inviter: inviter };
  }

  function calculateOrderSnapshot(order, rule) {
    order = order || {};
    rule = rule || {};
    var rates = validateRates(rule);
    var paid = amount(order.paid_amount != null ? order.paid_amount : order.paidAmount || order.amount || order.original_amount);
    var platformAmount = amount(paid * rates.platform / 100);
    var playerAmount = amount(paid * rates.player / 100);
    var inviterAmount = amount(paid * rates.inviter / 100);
    var clubAmount = amount(paid - platformAmount - playerAmount - inviterAmount);
    return {
      paid_amount: paid,
      platform_commission_rate: rates.platform,
      platform_commission_amount: platformAmount,
      player_income_rate: rates.player,
      player_income_amount: playerAmount,
      inviter_rebate_rate: rates.inviter,
      inviter_rebate_amount: inviterAmount,
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
    var base = amount(input.base_amount || input.baseAmount || 0);
    return {
      base_amount: base,
      rebate_rate: rebateRate,
      rebate_amount: amount(base * rebateRate / 100),
      rebate_source: rule.rebate_source || "PLATFORM_PROFIT",
      settlement_snapshot_at: new Date().toISOString()
    };
  }

  window.MCJCommissionEngine = {
    amount: amount,
    validateRates: validateRates,
    calculateOrderSnapshot: calculateOrderSnapshot,
    calculateGiftSnapshot: calculateGiftSnapshot,
    calculateReferralSnapshot: calculateReferralSnapshot
  };
})();
