/**
 * Shared boss/CS/multi order bill math.
 * Frontend place-order sends adjustable count in `hours` and seat multiplier in `quantity`
 * (quantity is usually 1). Never use `quantity || hours` — quantity=1 masks real hours.
 */
export function money(value) {
  const n = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

/** True only for per-game / 局 billing — not 小时/场/次. */
export function isPerGamePricingUnit(unit) {
  const u = String(unit || "").trim();
  if (!u) return false;
  if (/per_game/i.test(u)) return true;
  // Exact 局 / 每局 only — do not treat unrelated text containing 局 as per-game.
  return /^(每)?局$/.test(u);
}

/**
 * Prefer companion service row unit, then explicit policy/catalog unit, then client hint.
 * Empty policy must NOT default to 局 and override companion 小时.
 */
export function resolveBillingUnit({
  companionUnit = "",
  catalogUnit = "",
  policyUnit = "",
  clientUnit = "",
  fallback = "小时",
} = {}) {
  const picks = [companionUnit, policyUnit, catalogUnit, clientUnit, fallback];
  for (const raw of picks) {
    const u = String(raw || "").trim();
    if (u) return u;
  }
  return "小时";
}

/**
 * @returns {{
 *   billCount: number,
 *   seats: number,
 *   perGame: boolean,
 *   hours: number,
 *   quantity: number,
 *   totalAmount: number,
 * }}
 */
export function computeOrderBillAmount({
  unitPrice,
  hours: rawHours,
  duration,
  quantity: rawQuantity,
  pricingUnit = "小时",
} = {}) {
  const unit = money(unitPrice);
  const billCount = Math.max(0.5, money(rawHours != null && rawHours !== "" ? rawHours : duration != null && duration !== "" ? duration : 1) || 1);
  const seats = Math.max(1, Math.floor(money(rawQuantity != null && rawQuantity !== "" ? rawQuantity : 1) || 1));
  const perGame = isPerGamePricingUnit(pricingUnit);
  const totalAmount = Math.round(unit * billCount * seats * 100) / 100;
  if (perGame) {
    return {
      billCount,
      seats,
      perGame: true,
      hours: 0,
      quantity: Math.max(1, Math.round(billCount)),
      totalAmount,
    };
  }
  return {
    billCount,
    seats,
    perGame: false,
    hours: Math.round(billCount * seats * 100) / 100,
    quantity: seats,
    totalAmount,
  };
}
