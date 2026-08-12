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

/** Boss / shared Chinese labels (tabs + cards). Unified CN vocabulary. */
export const ORDER_STATUS_LABELS = Object.freeze({
  awaiting_payment: "待付款",
  payment_review: "待人工审核", // view-layer only (awaiting_payment + proof submitted)
  pending: "待客服处理",
  waiting_boss_confirm: "等待老板选择",
  claimed: "等待陪玩确认",
  confirmed: "进行中", // legacy hop; new confirm path jumps to in_progress
  in_progress: "进行中",
  completed: "已完成",
  reviewed: "已评价",
  cancelled: "已取消",
  refund_requested: "售后",
  refunded: "已退款",
  expired: "已失效",
});

/** Companion portal labels (same keys, wording tuned for 陪玩). */
export const COMPANION_STATUS_LABELS = Object.freeze({
  ...ORDER_STATUS_LABELS,
  claimed: "等待陪玩确认",
  pending: "等待陪玩抢单",
  waiting_boss_confirm: "等待老板选择",
  confirmed: "进行中",
});

/**
 * Boss-facing status text with grab-count variants.
 * Never returns「待接单」/「老板待接单」.
 */
export function bossFacingStatusText(row = {}, grabCountOverride) {
  const status = normalizeOrderStatus(row.status);
  const note = String(row.note || row.description || "");
  const grabCount =
    grabCountOverride != null
      ? Number(grabCountOverride) || 0
      : Array.isArray(row.grabs)
        ? row.grabs.length
        : Number(row.grabCount != null ? row.grabCount : row.grab_count || 0) || 0;
  if (status === "awaiting_payment") {
    // Prefer explicit pending-receipt flag from API; fall back to legacy note markers only
    // when paymentReview/paymentReceipt is not provided (older clients).
    if (row.paymentReceipt || row.paymentReview === true) return "待人工审核";
    if (row.paymentReview === false || row.paymentRejectReason) return "待付款";
    if (
      row.payment_proof_url ||
      row.paymentProofUrl ||
      /\[\[PAYMENT_PROOF\]\]|\[\[PAYMENT_SUBMITTED\]\]|付款凭证|已上传付款/i.test(note)
    ) {
      return "待人工审核";
    }
    return "待付款";
  }
  if (status === "pending" || status === "waiting_boss_confirm") {
    if (grabCount > 0) return `已有 ${grabCount} 位陪玩抢单`;
    return status === "waiting_boss_confirm" ? "等待老板选择" : "待客服处理";
  }
  if (status === "claimed") return "等待陪玩确认";
  if (status === "confirmed" || status === "in_progress") {
    if (
      String(row.note || "").includes("[[COMPLETION_PENDING]]") ||
      String(row.description || "").includes("[[COMPLETION_PENDING]]")
    ) {
      if (
        /\[\[ORDER_FROZEN\]\]|\[\[ORDER_DISPUTE\]\]|\[\[COMPLETION_AUTO_PAUSED\]\]/i.test(
          String(row.note || "") + String(row.description || "")
        )
      ) {
        return "等待处理订单问题";
      }
      return "等待您确认完成";
    }
    return "进行中";
  }
  return ORDER_STATUS_LABELS[status] || status || "待付款";
}

/**
 * Forbidden / legacy aliases → canonical DB status.
 * Never store these aliases in orders.status.
 * Public flow names (draft/pending_grab/…) normalize to DB enum.
 */
const ALIASES = Object.freeze({
  draft: "awaiting_payment",
  pending_grab: "pending",
  selecting: "waiting_boss_confirm",
  pending_companion_confirm: "claimed",
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
  expired: "cancelled",
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
  if (key === "payment_review") return false; // view-layer only
  return Object.prototype.hasOwnProperty.call(ORDER_STATUS_LABELS, key) || key === "reviewed";
}

/**
 * Strict CS / admin manual status graph.
 * Payment confirm + assign companion stay on dedicated actions; 改状态 only offers these edges.
 * Completed / refunded are never free jumps from early states.
 */
export const CS_STATUS_TRANSITIONS = Object.freeze({
  awaiting_payment: ["cancelled"],
  pending: ["cancelled", "refund_requested"],
  claimed: ["pending", "cancelled", "refund_requested"],
  waiting_boss_confirm: ["pending", "claimed", "cancelled"],
  confirmed: ["in_progress"],
  in_progress: ["completed", "refund_requested"],
  completed: [],
  cancelled: [],
  refund_requested: [], // approve/reject via refund_decision
  refunded: [],
  reviewed: [],
});

/** CS 改状态 dropdown labels (stricter wording). */
export const CS_STATUS_ACTION_LABELS = Object.freeze({
  awaiting_payment: "待付款",
  pending: "等待陪玩抢单",
  claimed: "等待陪玩确认",
  waiting_boss_confirm: "等待老板选择",
  confirmed: "进行中",
  in_progress: "进行中",
  completed: "已完成",
  cancelled: "已取消",
  refund_requested: "售后",
  refunded: "已退款",
});

export function allowedCsNextStatuses(fromStatus) {
  const from = normalizeOrderStatus(fromStatus);
  return (CS_STATUS_TRANSITIONS[from] || []).slice();
}

export function assertCsStatusTransition(fromStatus, toStatus) {
  const from = normalizeOrderStatus(fromStatus);
  const to = normalizeOrderStatus(toStatus);
  if (from === to) {
    throw Object.assign(new Error("订单已是该状态。"), { status: 400 });
  }
  if (!isCanonicalOrderStatus(to) || to === "reviewed") {
    throw Object.assign(new Error(`无效订单状态：${toStatus}`), { status: 400 });
  }
  const allowed = allowedCsNextStatuses(from);
  if (!allowed.includes(to)) {
    throw Object.assign(
      new Error(`不允许从「${CS_STATUS_ACTION_LABELS[from] || from}」改为「${CS_STATUS_ACTION_LABELS[to] || to}」。`),
      { status: 400 }
    );
  }
  return { from, to };
}

/**
 * TEST pay is OFF by default — even on Vercel Preview.
 * Enable only when MCJ_ALLOW_TEST_PAY=1, or when the client explicitly opts in
 * via ?allowTestPay=1 (forwarded as allowTestPay / allow_test_pay on non-production).
 * Never on Vercel Production.
 */
export function allowPreviewTestPay(opts = {}) {
  const vercelEnv = String(process.env.VERCEL_ENV || "").toLowerCase();
  if (vercelEnv === "production") return false;

  if (String(process.env.MCJ_ALLOW_TEST_PAY || "").trim() === "1") return true;

  const flag = opts.allowTestPay ?? opts.allow_test_pay ?? opts.queryAllowTestPay;
  const optedIn = flag === true || String(flag || "").trim() === "1";
  if (!optedIn) return false;

  // Explicit opt-in only outside Vercel Production (Preview / local).
  if (vercelEnv === "preview") return true;
  if (!vercelEnv && String(process.env.NODE_ENV || "").toLowerCase() !== "production") return true;
  // Vercel Preview sometimes ships NODE_ENV=production; vercelEnv===preview already covered.
  return vercelEnv !== "production" && vercelEnv !== "";
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
  const nowIso = new Date().toISOString();
  const body = { ...patch, status: next, updated_at: patch.updated_at || nowIso };
  let q = filterQuery || `?id=eq.${encodeURIComponent(orderId)}`;
  // Optimistic CAS: when fromStatus known and filter lacks status=, require current status match.
  const from = fromStatus ? normalizeOrderStatus(fromStatus) : "";
  if (from && !/status=eq\./i.test(q)) {
    q += (q.includes("?") ? "&" : "?") + `status=eq.${encodeURIComponent(from)}`;
  }
  async function patchOnce(payload) {
    const rows = await supabaseJson(restUrl("orders", q), {
      method: "PATCH",
      headers: serviceHeaders(),
      body: JSON.stringify(payload),
    });
    return Array.isArray(rows) ? rows[0] : null;
  }
  let saved = null;
  try {
    saved = await patchOnce(body);
  } catch (error) {
    const msg = String(error?.message || error || "");
    if (/updated_at|PGRST204|schema cache|column/i.test(msg) && body.updated_at) {
      const { updated_at: _drop, ...rest } = body;
      saved = await patchOnce(rest);
    } else {
      throw error;
    }
  }
  if (!saved) {
    throw Object.assign(new Error("订单状态已变更，请刷新后重试。"), { status: 409 });
  }
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

/** Prefer latest activity (updated/paid/reviewed) then created_at — newest operated/created first. */
export function orderActivityMs(row = {}) {
  const candidates = [
    row.updated_at,
    row.updatedAt,
    row.paid_at,
    row.paidAt,
    row.paymentReviewedAt,
    row.payment_reviewed_at,
    row.accepted_at,
    row.acceptedAt,
    row.created_at,
    row.createdAt,
  ];
  let best = 0;
  for (const value of candidates) {
    const n = Date.parse(String(value || ""));
    if (Number.isFinite(n) && n > best) best = n;
  }
  return best;
}

export function sortOrdersByActivityDesc(rows = []) {
  return (Array.isArray(rows) ? rows.slice() : []).sort((a, b) => {
    const tb = orderActivityMs(b);
    const ta = orderActivityMs(a);
    if (tb !== ta) return tb - ta;
    const cb = Date.parse(String(b.created_at || b.createdAt || "")) || 0;
    const ca = Date.parse(String(a.created_at || a.createdAt || "")) || 0;
    return cb - ca;
  });
}

/** Fetch orders with updated_at,created_at DESC; soft-fallback if updated_at missing. */
export async function fetchOrdersActivityDesc(deps, { limit = 500 } = {}) {
  const { restUrl, supabaseJson, serviceHeaders } = deps;
  const lim = Math.max(1, Math.min(Number(limit) || 500, 1000));
  try {
    const rows = await supabaseJson(
      restUrl("orders", `?order=updated_at.desc.nullslast,created_at.desc&limit=${lim}`),
      { headers: serviceHeaders() }
    );
    return sortOrdersByActivityDesc(Array.isArray(rows) ? rows : []);
  } catch (error) {
    const msg = String(error?.message || error || "");
    if (!/updated_at|PGRST204|schema cache|column/i.test(msg)) throw error;
    const rows = await supabaseJson(restUrl("orders", `?order=created_at.desc&limit=${lim}`), {
      headers: serviceHeaders(),
    }).catch(() => []);
    return sortOrdersByActivityDesc(Array.isArray(rows) ? rows : []);
  }
}
