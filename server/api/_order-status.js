/**
 * Canonical order status map — shared by boss / companion / CS / admin APIs.
 * DB enum (public.mcj_order_status) is the source of truth. Aliases normalize legacy names.
 */
export const ORDER_STATUSES = Object.freeze({
  AWAITING_PAYMENT: "awaiting_payment",
  CLAIMED: "claimed", // paid · waiting companion confirm
  PENDING: "pending", // waiting CS assign / open grab hall
  WAITING_BOSS_CONFIRM: "waiting_boss_confirm",
  CONFIRMED: "confirmed", // companion accepted · waiting start
  IN_PROGRESS: "in_progress",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
  REFUND_REQUESTED: "refund_requested", // after-sale
  REFUNDED: "refunded",
  REVIEWED: "reviewed", // view-layer only (completed + review)
});

/** Boss / shared Chinese labels (tabs + cards). */
export const ORDER_STATUS_LABELS = Object.freeze({
  awaiting_payment: "待付款",
  claimed: "等待陪玩确认",
  pending: "待客服安排",
  waiting_boss_confirm: "待我确认",
  confirmed: "已接单待开始",
  in_progress: "进行中",
  completed: "已完成",
  reviewed: "已评价",
  cancelled: "已取消",
  refund_requested: "售后",
  refunded: "已退款",
});

/** Companion portal labels (same keys, wording tuned for 陪玩). */
export const COMPANION_STATUS_LABELS = Object.freeze({
  ...ORDER_STATUS_LABELS,
  claimed: "已付款，等待陪玩确认",
  pending: "公开抢单中",
  waiting_boss_confirm: "等待老板选择",
  confirmed: "待开始",
});

/**
 * Forbidden / legacy aliases → canonical DB status.
 * Never store these aliases in orders.status.
 */
const ALIASES = Object.freeze({
  pending_payment: "awaiting_payment",
  unpaid: "awaiting_payment",
  waiting_payment: "awaiting_payment",
  waiting_pay: "awaiting_payment",
  unpaid_order: "awaiting_payment",
  paid: "claimed",
  waiting_companion_confirm: "claimed",
  waiting_companion: "claimed",
  companion_confirm: "claimed",
  companion_confirmed: "pending",
  waiting_cs_assign: "pending",
  arranging: "pending",
  after_sale: "refund_requested",
  aftersale: "refund_requested",
  refund: "refund_requested",
});

export function normalizeOrderStatus(raw) {
  const key = String(raw || "").trim().toLowerCase();
  if (!key) return ORDER_STATUSES.AWAITING_PAYMENT;
  if (ORDER_STATUS_LABELS[key] || key === "reviewed") return key;
  return ALIASES[key] || key;
}

export function orderStatusLabel(status, portal = "boss") {
  const key = normalizeOrderStatus(status);
  if (portal === "companion") return COMPANION_STATUS_LABELS[key] || key;
  return ORDER_STATUS_LABELS[key] || key;
}

export function isCanonicalOrderStatus(status) {
  const key = String(status || "");
  return Object.prototype.hasOwnProperty.call(ORDER_STATUS_LABELS, key) || key === "reviewed";
}

/** Runtime allows Preview TEST pay (never on Vercel Production). */
export function allowPreviewTestPay() {
  const vercelEnv = String(process.env.VERCEL_ENV || "").toLowerCase();
  if (vercelEnv === "production") return false;
  if (vercelEnv === "preview" || vercelEnv === "development") return true;
  // Local / unset: allow for acceptance scripts.
  return String(process.env.NODE_ENV || "").toLowerCase() !== "production" || !vercelEnv;
}

/**
 * Write order_status_logs. Soft-fails if table missing so pay path still works.
 */
export async function writeOrderStatusLog(
  { restUrl, supabaseJson, serviceHeaders },
  { orderId, fromStatus, toStatus, operatorRole, operatorId, note }
) {
  if (!orderId || !toStatus) return;
  const row = {
    order_id: orderId,
    from_status: fromStatus ? normalizeOrderStatus(fromStatus) : null,
    to_status: normalizeOrderStatus(toStatus),
    operator_role: String(operatorRole || "system"),
    operator_id: operatorId || null,
    note: String(note || "").slice(0, 500),
    created_at: new Date().toISOString(),
  };
  try {
    await supabaseJson(restUrl("order_status_logs"), {
      method: "POST",
      headers: serviceHeaders({ Prefer: "return=minimal" }),
      body: JSON.stringify(row),
    });
  } catch (error) {
    const msg = String(error?.message || "");
    if (!/order_status_logs|schema cache|does not exist|PGRST/i.test(msg)) {
      console.warn("[order_status_logs]", msg.slice(0, 180));
    }
  }
}

/**
 * PATCH orders.status + log. Uses service role helpers from caller.
 */
export async function transitionOrderStatus(
  deps,
  { orderId, filterQuery, fromStatus, toStatus, patch = {}, operatorRole, operatorId, note }
) {
  const { restUrl, supabaseJson, serviceHeaders } = deps;
  const next = normalizeOrderStatus(toStatus);
  if (!isCanonicalOrderStatus(next) || next === "reviewed") {
    throw Object.assign(new Error(`无效订单状态：${toStatus}`), { status: 400 });
  }
  const body = { ...patch, status: next };
  const q = filterQuery || `?id=eq.${encodeURIComponent(orderId)}`;
  const rows = await supabaseJson(restUrl("orders", q), {
    method: "PATCH",
    headers: serviceHeaders(),
    body: JSON.stringify(body),
  });
  const saved = Array.isArray(rows) ? rows[0] : null;
  await writeOrderStatusLog(deps, {
    orderId,
    fromStatus,
    toStatus: next,
    operatorRole,
    operatorId,
    note,
  });
  return saved;
}
