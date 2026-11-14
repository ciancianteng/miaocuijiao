/**
 * Order billing mode. per_game and per_hour are snapshots on the order.
 * Callers must not infer the mode from the game name.
 */

function money(value) {
  const n = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

export function normalizeBillingUnit(raw) {
  const text = String(raw || "").trim();
  if (!text) return "";
  const lower = text.toLowerCase();
  if (lower === "per_game" || lower === "game" || /局/.test(text)) return "per_game";
  if (lower === "per_hour" || lower === "hour" || lower === "hourly" || /小时|钟头/.test(text)) return "per_hour";
  if (lower === "unknown" || /待核实/.test(text)) return "unknown";
  return "unknown";
}

/** First explicit per_game / per_hour wins. Empty values are skipped. */
export function resolveBillingUnit(...candidates) {
  for (const candidate of candidates) {
    const unit = normalizeBillingUnit(candidate);
    if (unit === "per_game" || unit === "per_hour") return unit;
  }
  return "per_hour";
}

/**
 * Quote a new order. Hourly keeps the existing hours × quantity collapse.
 * Per-game uses quantity as games and does not write that count into hours.
 */
export function quoteOrder({ unit, unitPrice, quantity, hours } = {}) {
  const price = money(unitPrice);
  if (unit === "per_game") {
    const games = Math.max(1, Math.floor(money(quantity) || 1));
    return {
      billingUnit: "per_game",
      quantity: games,
      hours: 0,
      unitPrice: price,
      totalAmount: Math.round(price * games * 100) / 100,
      unitLabel: "局",
    };
  }
  const count = Math.max(1, Math.floor(money(quantity) || 1));
  const baseHours = Math.max(0.5, money(hours || 1));
  const billedHours = Math.round(baseHours * count * 100) / 100;
  return {
    billingUnit: "per_hour",
    quantity: count,
    hours: billedHours,
    unitPrice: price,
    totalAmount: Math.round(price * billedHours * 100) / 100,
    unitLabel: "小时",
  };
}

function markedUnit(row = {}) {
  const blob = `${row.description || ""}\n${row.notes || ""}\n${row.title || ""}\n${row.note || ""}`;
  const marked = (blob.match(/计费单位[:：]\s*([^\s\n；;]+)/) || [])[1] || "";
  return normalizeBillingUnit(marked);
}

/** Read-only description of a stored order. Does not recompute the amount. */
export function describeOrderBilling(row = {}) {
  const stored = normalizeBillingUnit(row.pricing_unit || row.pricingUnit) || markedUnit(row);
  const unitPrice = money(row.unit_price ?? row.unitPrice);
  const amount = money(row.total_amount ?? row.totalAmount ?? row.amount);
  const quantity = money(row.quantity || 1);
  const hours = money(row.hours);
  if (stored === "unknown") {
    return {
      billingUnit: "unknown",
      billingStatus: "待核实",
      quantity,
      hours,
      quantityLabel: "待核实",
      unitLabel: "待核实",
      durationLabel: "待核实",
      endLabel: "待核实",
      unitPrice,
      amount,
    };
  }
  if (stored === "per_game") {
    const blob = `${row.description || ""}\n${row.notes || ""}\n${row.title || ""}`;
    const markedGames = Number((blob.match(/局数[:：]\s*(\d+(?:\.\d+)?)/) || blob.match(/(\d+(?:\.\d+)?)局/) || [])[1] || 0);
    const games = Math.max(1, Math.floor(markedGames || quantity || 1));
    return {
      billingUnit: "per_game",
      billingStatus: "per_game",
      quantity: games,
      hours: 0,
      quantityLabel: `${games}局`,
      unitLabel: "猫粮/局",
      durationLabel: `${games}局`,
      endLabel: "不限制，完成局数即可结束",
      unitPrice,
      amount,
    };
  }
  const billedHours = hours > 0 ? hours : quantity > 0 ? quantity : 0;
  return {
    billingUnit: "per_hour",
    billingStatus: "per_hour",
    quantity,
    hours: billedHours,
    quantityLabel: billedHours ? `${billedHours}小时` : "-",
    unitLabel: "猫粮/小时",
    durationLabel: billedHours ? `${billedHours}小时` : "-",
    endLabel: "",
    unitPrice,
    amount,
  };
}
