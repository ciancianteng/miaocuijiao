/**
 * CS RM commission settlement — order-bound, idempotent, config-snapshot for history isolation.
 * Reads live rates from getGlobalCommissionConfig at settle time; never rewrites settled rows when config changes.
 *
 * Hard gate (all required): linked formal order + real payment + amount>0 + actual CS + end reception + no refund/fail + not yet settled.
 * Chat-only / unpaid / draft → consultation RM0, no commission row (or consultation_zero ledger).
 */
import { normalizeOrderStatus } from "./_order-status.js";

async function loadCommissionConfig() {
  const work = await import("./_customer-service-work.js");
  return work.getGlobalCommissionConfig();
}

function nowIso() {
  return new Date().toISOString();
}
function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
function round(v) {
  return Math.round(num(v) * 100) / 100;
}
function headers() {
  return {
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
}
function rest(table, query = "") {
  return `${process.env.SUPABASE_URL}/rest/v1/${table}${query}`;
}
async function sb(path, init = {}) {
  const response = await fetch(path, { ...init, headers: { ...headers(), ...(init.headers || {}) } });
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    const msg = body?.message || body?.hint || (typeof body === "string" ? body : "") || `HTTP ${response.status}`;
    const err = new Error(msg);
    err.status = response.status;
    err.body = body;
    throw err;
  }
  return body;
}
function isMissingTable(err) {
  return /PGRST205|Could not find the table|schema cache|cs_commission_settlements/i.test(String(err?.message || err || ""));
}
function orderAmount(order = {}) {
  return num(order.total_amount ?? order.amount ?? order.paid_amount ?? order.total ?? order.price ?? 0);
}
function refundAmount(order = {}) {
  return num(order.refund_amount ?? order.refundAmount ?? order.refunded_amount ?? 0);
}
function isTestOrDraftOrder(order = {}) {
  const blob = `${order.order_no || ""} ${order.note || ""} ${order.description || ""} ${order.title || ""} ${order.order_type || ""}`;
  return /\[TEST\]|E2E-|acceptance|自动化测试|测试订单|draft|草稿/i.test(blob);
}

/** Payment source: orders.payment_status / paid_at / status (server truth; never trust client). */
export function resolveOrderPaymentProof(order = {}) {
  const paymentStatus = String(order.payment_status || order.paymentStatus || "").trim();
  const ps = paymentStatus.toLowerCase();
  const status = normalizeOrderStatus(order.status);
  const amount = orderAmount(order);
  const paidAt = order.paid_at || order.paidAt || "";
  const paidLabels = new Set(["paid", "succeeded", "success", "已支付", "支付成功"]);
  const failLabels = new Set(["failed", "fail", "支付失败", "未支付", "支付中", "pending_payment"]);
  const refundLabels = new Set(["已退款", "部分退款", "refunded", "partial_refund"]);
  const explicitPaid = paidLabels.has(ps) || paidLabels.has(paymentStatus);
  const explicitFail = failLabels.has(ps) || failLabels.has(paymentStatus);
  const explicitRefund = refundLabels.has(ps) || refundLabels.has(paymentStatus) || status === "refunded" || status === "refund_requested";
  const statusImpliesPaid =
    !!paidAt ||
    ["pending", "waiting_boss_confirm", "claimed", "confirmed", "in_progress", "completed", "reviewed", "paid"].includes(status);
  // Trust payment_status when present; else paid_at + post-payment order status (server rows only).
  const paid =
    amount > 0 &&
    !explicitFail &&
    !explicitRefund &&
    status !== "awaiting_payment" &&
    status !== "cancelled" &&
    status !== "canceled" &&
    (explicitPaid || (!!paidAt && statusImpliesPaid) || (!paymentStatus && statusImpliesPaid));
  return {
    paymentStatus: paymentStatus || (paid ? "paid" : status === "awaiting_payment" ? "unpaid" : ps || status || "unknown"),
    paidAt: paidAt || "",
    amount,
    refundAmount: refundAmount(order),
    paid: !!paid,
    failed: explicitFail || status === "cancelled" || status === "canceled",
    refunded: explicitRefund,
  };
}

/**
 * Strict eligibility for CS order commission (验收门禁 1–8).
 * @returns {{ ok:boolean, code:string, message:string, payment?:object, consultation?:boolean }}
 */
export function assessCommissionEligibility(order, opts = {}) {
  const serviceId = String(opts.serviceId || opts.forceServiceId || "").trim();
  const conversation = opts.conversation || null;
  const fromEndReception = opts.fromEndReception === true || opts.endReception === true;

  if (!fromEndReception) {
    return {
      ok: false,
      code: "NEED_END_RECEPTION",
      message: "须客服点击【结束接待】后才可结算提成。",
      consultation: false,
    };
  }

  const orderId = order?.id || conversation?.order_id || "";
  const orderNo = String(order?.order_no || order?.orderNo || "").trim();
  if (!orderId || !order) {
    return {
      ok: false,
      code: "CONSULTATION",
      message: "本次为普通咨询，无订单提成",
      consultation: true,
      commissionAmount: 0,
    };
  }
  if (!orderNo || isTestOrDraftOrder(order)) {
    return {
      ok: false,
      code: "CONSULTATION",
      message: "本次为普通咨询，无订单提成",
      consultation: true,
      commissionAmount: 0,
    };
  }

  const payment = resolveOrderPaymentProof(order);
  if (payment.failed) {
    return { ok: false, code: "PAYMENT_FAILED", message: "本次为普通咨询，无订单提成", consultation: true, payment, commissionAmount: 0 };
  }
  if (payment.refunded) {
    return { ok: false, code: "REFUNDED", message: "订单已退款/撤销，无提成。", consultation: false, payment, commissionAmount: 0 };
  }
  if (!payment.paid || payment.amount <= 0) {
    return {
      ok: false,
      code: "UNPAID",
      message: "本次为普通咨询，无订单提成",
      consultation: true,
      payment,
      commissionAmount: 0,
    };
  }

  const orderServiceId = String(order.customer_service_id || order.customerServiceId || "").trim();
  const convServiceId = String(conversation?.customer_service_id || "").trim();
  const actualService = serviceId && (serviceId === orderServiceId || serviceId === convServiceId);
  if (!serviceId || !actualService) {
    return {
      ok: false,
      code: "NOT_RECEPTION_CS",
      message: "当前客服不是该订单实际接待客服，无提成。",
      consultation: false,
      payment,
      commissionAmount: 0,
    };
  }

  return {
    ok: true,
    code: "ELIGIBLE",
    message: "满足已付款订单提成条件。",
    payment,
    consultation: false,
  };
}

function nodeReached(status, config) {
  const s = normalizeOrderStatus(status);
  if (["cancelled", "canceled", "refunded", "refund_requested", "awaiting_payment"].includes(s)) return false;
  // Payment must already be proven by assessCommissionEligibility; node is secondary.
  if (config.settleOnOrderComplete && (s === "completed" || s === "reviewed")) return true;
  if (config.settleOnPayment && ["pending", "waiting_boss_confirm", "claimed", "confirmed", "in_progress", "completed", "reviewed", "paid"].includes(s)) {
    return true;
  }
  if (!config.settleOnOrderComplete && !config.settleOnPayment) {
    return !["cancelled", "canceled"].includes(s);
  }
  return false;
}

export function computeCommissionBreakdown(order, config) {
  const amt = orderAmount(order);
  const fixed = round(num(config.orderCommission));
  const percent = round((amt * num(config.commissionPercent)) / 100);
  const night = 0;
  const attendance = 0;
  const finalAmount = round(fixed + percent + night + attendance);
  return {
    rewardType: "order_commission",
    fixedRewardRm: fixed,
    percentCommissionRm: percent,
    nightShiftRm: night,
    attendanceBonusRm: attendance,
    clawbackRm: 0,
    finalAmountRm: finalAmount,
    commissionPercent: num(config.commissionPercent),
    orderAmount: amt,
    configSnapshot: {
      baseSalary: num(config.baseSalary),
      attendanceBonus: num(config.attendanceBonus),
      receptionBonus: num(config.receptionBonus),
      orderCommission: num(config.orderCommission),
      commissionPercent: num(config.commissionPercent),
      nightShiftAllowance: num(config.nightShiftAllowance),
      settleOnOrderComplete: !!config.settleOnOrderComplete,
      settleOnPayment: !!config.settleOnPayment,
      clawbackOnRefund: config.clawbackOnRefund !== false,
      snapshottedAt: nowIso(),
    },
  };
}

export async function getSettlementByOrderId(orderId) {
  if (!orderId) return null;
  try {
    const rows = await sb(rest("cs_commission_settlements", `?order_id=eq.${encodeURIComponent(orderId)}&limit=1`));
    return Array.isArray(rows) ? rows[0] : null;
  } catch (err) {
    if (isMissingTable(err)) return null;
    throw err;
  }
}

export async function listCommissionSettlements({ serviceId = "", status = "", limit = 200 } = {}) {
  let q = `?order=settled_at.desc.nullslast&limit=${Math.min(500, Math.max(1, Number(limit) || 200))}`;
  if (serviceId) q += `&service_id=eq.${encodeURIComponent(serviceId)}`;
  if (status) q += `&status=eq.${encodeURIComponent(status)}`;
  try {
    const rows = await sb(rest("cs_commission_settlements", q));
    return (Array.isArray(rows) ? rows : []).map(mapPublic).filter(Boolean);
  } catch (err) {
    if (isMissingTable(err)) return [];
    throw err;
  }
}

function mapPublic(row) {
  if (!row) return null;
  const snap = row.config_snapshot || {};
  const category =
    row.reward_type === "consultation_zero"
      ? "consultation_zero"
      : num(row.clawback_rm) > 0 && String(row.status) === "clawed_back"
        ? "refund_clawback"
        : num(row.percent_commission_rm) > 0
          ? "paid_commission"
          : num(row.fixed_reward_rm) > 0
            ? "fixed_reward"
            : num(row.night_shift_rm) > 0
              ? "night_overtime"
              : row.reward_type || "order_commission";
  return {
    id: row.id,
    serviceId: row.service_id,
    bossId: row.boss_id,
    conversationId: row.conversation_id,
    orderId: row.order_id,
    orderNo: row.order_no || "",
    orderAmount: round(row.order_amount),
    paidAmount: round(snap.paidAmount != null ? snap.paidAmount : row.order_amount),
    paymentStatus: snap.paymentStatus || "",
    rewardType: row.reward_type || "order_commission",
    category,
    categoryLabel:
      ({
        paid_commission: "已付款提成",
        fixed_reward: "固定奖",
        consultation_zero: "普通咨询 RM0",
        refund_clawback: "退款扣回",
        night_overtime: "夜班加班",
        order_commission: "订单提成",
      })[category] || category,
    fixedRewardRm: round(row.fixed_reward_rm),
    percentCommissionRm: round(row.percent_commission_rm),
    nightShiftRm: round(row.night_shift_rm),
    attendanceBonusRm: round(row.attendance_bonus_rm),
    clawbackRm: round(row.clawback_rm),
    finalAmountRm: round(row.final_amount_rm),
    commissionPercent: num(row.commission_percent),
    commissionRate: num(row.commission_percent),
    configSnapshot: snap,
    status: row.status,
    settlementStatus: row.status,
    settleNode: row.settle_node || "",
    settledAt: row.settled_at || "",
    clawbackAt: row.clawback_at || "",
    clawbackReason: row.clawback_reason || "",
    source: row.source || "auto",
    createdAt: row.created_at || "",
  };
}

/**
 * Settle RM commission for an order using CURRENT admin commission config (snapshot).
 * Idempotent on order_id (+ service_id unique). Requires fromEndReception + paid proof.
 */
export async function trySettleCommission(order, opts = {}) {
  const { source = "auto", forceServiceId = "", conversation = null, fromEndReception = false } = opts;
  const config = await loadCommissionConfig();
  if (!order?.id) return { ok: false, code: "NO_ORDER", message: "缺少订单。", consultation: true, commissionAmount: 0 };

  const serviceId = String(forceServiceId || order.customer_service_id || conversation?.customer_service_id || "").trim();
  const gate = assessCommissionEligibility(order, {
    serviceId,
    conversation,
    fromEndReception: fromEndReception || source === "end_reception",
  });
  if (!gate.ok) {
    return {
      ok: false,
      code: gate.code,
      message: gate.message,
      consultation: !!gate.consultation,
      commissionAmount: 0,
      payment: gate.payment || null,
    };
  }

  const status = normalizeOrderStatus(order.status);
  if (!nodeReached(status, config)) {
    return {
      ok: false,
      code: "NODE_NOT_REACHED",
      message: "订单尚未达到佣金结算节点。",
      status,
      consultation: false,
      commissionAmount: 0,
    };
  }

  const existing = await getSettlementByOrderService(order.id, serviceId);
  if (existing) {
    if (existing.status === "settled") {
      return { ok: true, code: "ALREADY_SETTLED", message: "该订单佣金已结算。", settlement: mapPublic(existing), duplicate: true };
    }
    if (existing.status === "clawed_back" || existing.status === "cancelled") {
      return { ok: false, code: "CLOSED", message: "该订单佣金已取消或扣回。", settlement: mapPublic(existing) };
    }
  }

  if (!serviceId) {
    return { ok: false, code: "NO_SERVICE", message: "订单未绑定客服，不结算佣金。" };
  }

  const breakdown = computeCommissionBreakdown(order, config);
  const payment = gate.payment || resolveOrderPaymentProof(order);
  const settleNode = "end_reception_paid";
  const snap = {
    ...breakdown.configSnapshot,
    paidAmount: payment.amount,
    paymentStatus: payment.paymentStatus,
    paidAt: payment.paidAt,
    eligibility: "paid_end_reception",
  };
  const row = {
    service_id: serviceId,
    boss_id: order.boss_id || null,
    conversation_id: conversation?.id || order.conversation_id || null,
    order_id: order.id,
    order_no: order.order_no || "",
    order_amount: breakdown.orderAmount,
    reward_type: breakdown.rewardType,
    fixed_reward_rm: breakdown.fixedRewardRm,
    percent_commission_rm: breakdown.percentCommissionRm,
    night_shift_rm: breakdown.nightShiftRm,
    attendance_bonus_rm: breakdown.attendanceBonusRm,
    clawback_rm: 0,
    final_amount_rm: breakdown.finalAmountRm,
    commission_percent: breakdown.commissionPercent,
    config_snapshot: snap,
    status: "settled",
    settle_node: settleNode,
    settled_at: nowIso(),
    source: source || "end_reception",
    updated_at: nowIso(),
  };

  try {
    if (existing?.id && existing.status === "pending") {
      const patched = await sb(rest("cs_commission_settlements", `?id=eq.${encodeURIComponent(existing.id)}`), {
        method: "PATCH",
        body: JSON.stringify(row),
      });
      const saved = Array.isArray(patched) ? patched[0] : patched;
      return {
        ok: true,
        code: "SETTLED",
        message: `已付款订单提成已结算 RM ${breakdown.finalAmountRm}（固定 ${breakdown.fixedRewardRm} + 提成 ${breakdown.percentCommissionRm}）。`,
        settlement: mapPublic(saved),
        amount: breakdown.finalAmountRm,
        payment,
      };
    }
    const created = await sb(rest("cs_commission_settlements"), {
      method: "POST",
      body: JSON.stringify({ ...row, created_at: nowIso() }),
    });
    const saved = Array.isArray(created) ? created[0] : created;
    return {
      ok: true,
      code: "SETTLED",
      message: `已付款订单提成已结算 RM ${breakdown.finalAmountRm}（固定 ${breakdown.fixedRewardRm} + 提成 ${breakdown.percentCommissionRm}）。`,
      settlement: mapPublic(saved),
      amount: breakdown.finalAmountRm,
      payment,
    };
  } catch (err) {
    if (/duplicate|unique|23505/i.test(String(err.message || ""))) {
      const again = await getSettlementByOrderService(order.id, serviceId);
      return { ok: true, code: "ALREADY_SETTLED", message: "该订单佣金已结算。", settlement: mapPublic(again), duplicate: true };
    }
    if (isMissingTable(err)) {
      return { ok: false, code: "TABLE_MISSING", message: "佣金结算表未创建，请执行 cs_commission_settlements 迁移。" };
    }
    throw err;
  }
}

export async function getSettlementByOrderService(orderId, serviceId) {
  if (!orderId) return null;
  try {
    let q = `?order_id=eq.${encodeURIComponent(orderId)}&limit=1`;
    if (serviceId) q = `?order_id=eq.${encodeURIComponent(orderId)}&service_id=eq.${encodeURIComponent(serviceId)}&limit=1`;
    const rows = await sb(rest("cs_commission_settlements", q));
    return Array.isArray(rows) ? rows[0] : null;
  } catch (err) {
    if (isMissingTable(err)) return null;
    throw err;
  }
}

/** End-reception: server verifies paid order; consultation → RM0 message. */
export async function evaluateEndReceptionCommission({ serviceId, conversation }) {
  let order = null;
  if (conversation?.order_id) {
    try {
      const rows = await sb(rest("orders", `?id=eq.${encodeURIComponent(conversation.order_id)}&limit=1`));
      order = Array.isArray(rows) ? rows[0] : null;
    } catch {
      order = null;
    }
  }
  if (!order) {
    return {
      code: "CONSULTATION",
      message: "本次为普通咨询，无订单提成",
      settled: false,
      consultation: true,
      commissionAmount: 0,
      category: "consultation_zero",
    };
  }
  const result = await trySettleCommission(order, {
    source: "end_reception",
    forceServiceId: serviceId,
    conversation,
    fromEndReception: true,
  });
  if (result.ok && (result.code === "SETTLED" || result.code === "ALREADY_SETTLED")) {
    return {
      code: result.code,
      message: result.duplicate
        ? `该订单提成已结算过（RM ${result.amount ?? result.settlement?.finalAmountRm ?? 0}），不会重复发放。`
        : result.message,
      settled: true,
      duplicate: !!result.duplicate,
      commissionAmount: result.amount ?? result.settlement?.finalAmountRm ?? 0,
      settlement: result.settlement,
      orderId: order.id,
      orderNo: order.order_no,
      payment: result.payment || resolveOrderPaymentProof(order),
      category: "paid_commission",
    };
  }
  if (result.consultation || result.code === "CONSULTATION" || result.code === "UNPAID" || result.code === "PAYMENT_FAILED") {
    return {
      code: result.code || "CONSULTATION",
      message: "本次为普通咨询，无订单提成",
      settled: false,
      consultation: true,
      commissionAmount: 0,
      orderId: order.id,
      orderNo: order.order_no,
      payment: result.payment || resolveOrderPaymentProof(order),
      category: "consultation_zero",
    };
  }
  return {
    code: result.code || "SKIP",
    message: result.message || "订单提成暂未结算。",
    settled: false,
    commissionAmount: 0,
    orderId: order.id,
    orderNo: order.order_no,
    settlement: result.settlement || null,
    category: "pending",
  };
}

export async function clawbackOrCancelCommission(order, { reason = "", mode = "auto" } = {}) {
  const config = await loadCommissionConfig();
  const status = normalizeOrderStatus(order?.status);
  const existing = await getSettlementByOrderId(order?.id);
  if (!existing) return { ok: true, code: "NONE", message: "无佣金结算记录。" };

  if (status === "cancelled" || mode === "cancel") {
    if (existing.status === "cancelled" || existing.status === "clawed_back") {
      return { ok: true, code: "DONE", settlement: mapPublic(existing) };
    }
    const isSettled = existing.status === "settled";
    const clawbackRm = isSettled ? round(num(existing.final_amount_rm) + num(existing.clawback_rm)) : 0;
    const patched = await sb(rest("cs_commission_settlements", `?id=eq.${encodeURIComponent(existing.id)}`), {
      method: "PATCH",
      body: JSON.stringify({
        status: isSettled ? "clawed_back" : "cancelled",
        clawback_rm: clawbackRm,
        final_amount_rm: isSettled ? 0 : round(num(existing.final_amount_rm)),
        clawback_at: isSettled ? nowIso() : null,
        clawback_reason: isSettled ? reason || "订单取消，扣回佣金" : null,
        updated_at: nowIso(),
      }),
    });
    return { ok: true, code: "CANCELLED", settlement: mapPublic(Array.isArray(patched) ? patched[0] : patched) };
  }

  if (status === "refunded" || status === "refund_requested" || mode === "refund" || mode === "partial_refund") {
    if (config.clawbackOnRefund === false && mode === "auto") {
      return { ok: true, code: "SKIP", message: "设置未开启退款扣回提成。" };
    }
    if (existing.status !== "settled" && existing.status !== "clawed_back") {
      const patched = await sb(rest("cs_commission_settlements", `?id=eq.${encodeURIComponent(existing.id)}`), {
        method: "PATCH",
        body: JSON.stringify({ status: "cancelled", updated_at: nowIso() }),
      });
      return { ok: true, code: "CANCELLED", settlement: mapPublic(Array.isArray(patched) ? patched[0] : patched) };
    }
    const payment = resolveOrderPaymentProof(order);
    const originalAmt = Math.max(payment.amount, num(existing.order_amount), 0.01);
    const refunded = Math.min(originalAmt, Math.max(0, payment.refundAmount));
    const originalFinal = round(num(existing.fixed_reward_rm) + num(existing.percent_commission_rm) + num(existing.night_shift_rm) + num(existing.attendance_bonus_rm));
    const alreadyClawed = round(num(existing.clawback_rm));
    // Full refund → claw back full original; partial → claw delta by net ratio (keep original row, adjust via clawback_rm).
    const isFull = refunded >= originalAmt - 0.001 || status === "refunded" || mode === "refund";
    const targetClawback = isFull
      ? originalFinal
      : round(originalFinal * (refunded / originalAmt));
    const clawbackRm = Math.max(alreadyClawed, targetClawback);
    const remaining = round(Math.max(0, originalFinal - clawbackRm));
    const patched = await sb(rest("cs_commission_settlements", `?id=eq.${encodeURIComponent(existing.id)}`), {
      method: "PATCH",
      body: JSON.stringify({
        status: remaining <= 0 ? "clawed_back" : "settled",
        clawback_rm: clawbackRm,
        final_amount_rm: remaining,
        clawback_at: nowIso(),
        clawback_reason:
          reason ||
          (isFull
            ? "订单全额退款，扣回提成"
            : `订单部分退款 RM ${refunded}，按净额差额扣回提成 RM ${clawbackRm}`),
        updated_at: nowIso(),
      }),
    });
    return {
      ok: true,
      code: remaining <= 0 ? "CLAWED" : "PARTIAL_CLAWED",
      settlement: mapPublic(Array.isArray(patched) ? patched[0] : patched),
      clawbackRm,
      remaining,
    };
  }

  return { ok: true, code: "NOOP", settlement: mapPublic(existing) };
}

/** Settle both cat-food dock reward and RM commission (best-effort). */
export async function settleCsOrderIncome(order, opts = {}) {
  let dock = null;
  let commission = null;
  try {
    dock = await (await import("./_cs-dock-rewards.js")).trySettleDockReward(order, opts);
  } catch (err) {
    dock = { ok: false, code: "ERROR", message: err?.message || "dock settle failed" };
  }
  try {
    // RM 提成硬门禁：仅 end_reception（真实已付款订单）才结算；付款确认/改状态路径不得提前入账。
    const fromEnd =
      opts.fromEndReception === true ||
      opts.endReception === true ||
      String(opts.source || "") === "end_reception";
    if (fromEnd) {
      commission = await trySettleCommission(order, { ...opts, fromEndReception: true });
    } else {
      commission = {
        ok: false,
        code: "NEED_END_RECEPTION",
        message: "须客服点击【结束接待】后才可结算提成。",
        commissionAmount: 0,
      };
    }
  } catch (err) {
    commission = { ok: false, code: "ERROR", message: err?.message || "commission settle failed" };
  }
  return { dock, commission, reward: dock, settlement: commission?.settlement || null };
}

/** Clawback/cancel both dock cat-food and RM commission. */
export async function clawbackCsOrderIncome(order, opts = {}) {
  let dock = null;
  let commission = null;
  try {
    dock = await (await import("./_cs-dock-rewards.js")).clawbackOrCancelReward(order, opts);
  } catch (err) {
    dock = { ok: false, code: "ERROR", message: err?.message || "dock clawback failed" };
  }
  try {
    commission = await clawbackOrCancelCommission(order, opts);
  } catch (err) {
    commission = { ok: false, code: "ERROR", message: err?.message || "commission clawback failed" };
  }
  return { dock, commission, reward: dock, settlement: commission?.settlement || null };
}

export { mapPublic as mapSettlementPublic };
