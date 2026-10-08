/**
 * CS cancel / refund of a single (non multi-group) order.
 *
 * Money moves only after the order row is locked by a CAS patch, and every money step reuses
 * the keys other paths already use, so CS cancel, CS refund, boss cancel and the
 * gameplay-no-taker sweep can never return the same order's cat-food twice:
 *   - cat-food HOLD   → mcj_wallet_release_hold, key `order-release:{order_no}`
 *   - debited / proof → one open boss_refund_requests row per order → confirmBossCatFoodRefund
 *                       (wallet key `refund-meow:{refund_id}`)
 */
import { normalizeOrderStatus, writeOrderStatusLog } from "./_order-status.js";
import { restUrl, supabaseJson, serviceHeaders, releaseWalletHold } from "./_wallet.js";
import { companionDb } from "./_companion-media-store.js";
import { loadOrderMoneyFacts } from "./_order-payment-facts.js";

export const CS_CANCEL_MARKER = "[[CS_CANCEL_REFUND]]";
const NO_TAKER_MARKER = "[[NO_TAKER_REFUND]]";
/** Statuses CS may cancel / refund from (matches CS_STATUS_TRANSITIONS → cancelled). */
export const CS_CANCELLABLE = ["awaiting_payment", "pending", "claimed", "waiting_boss_confirm"];
const BLOCKED_TEXT = {
  confirmed: "陪玩已确认接单，不能直接取消；请联系陪玩协商或走售后退款。",
  in_progress: "订单服务中，不能直接取消；请走提前结束或售后退款。",
  completed: "订单已完成，不能取消。",
  reviewed: "订单已完成，不能取消。",
};

function nowIso() {
  return new Date().toISOString();
}
function money(v) {
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}
function fail(status, code, message, extra = {}) {
  return { ok: false, status, code, message, ...extra };
}
const db = { restUrl, supabaseJson, serviceHeaders };

/** @deprecated Price and status are not payment. Use loadOrderMoneyFacts. */
export function isPaidOrder(order = {}) {
  return money(order.paid_cat_food) > 0 && !!order.paid_at;
}

export async function refundCapturedAmount(order, { reason, operator, amount } = {}) {
  const facts = await loadOrderMoneyFacts(order);
  if (!(facts.refundable > 0)) {
    return { ok: false, code: "NOTHING_TO_REFUND", message: "订单没有成功付款，不能退款。", facts, amount: 0 };
  }
  const requested = money(amount);
  const pay = requested > 0 ? Math.min(requested, facts.refundable) : facts.refundable;
  if (!(pay > 0)) {
    return { ok: false, code: "NOTHING_TO_REFUND", message: "订单没有可退金额。", facts, amount: 0 };
  }
  const moved = await refundToCatfood(order, pay, reason, operator);
  return { ...moved, amount: pay, facts };
}

async function loadOrder(id) {
  const rows = await supabaseJson(restUrl("orders", `?id=eq.${encodeURIComponent(id)}&limit=1`), {
    headers: serviceHeaders(),
  });
  return rows?.[0] || null;
}

/** CAS patch; drops optional columns the live schema may not have. */
async function casPatch(id, fromStatus, attempts) {
  const q = `?id=eq.${encodeURIComponent(id)}&status=eq.${encodeURIComponent(fromStatus)}`;
  let lastErr = null;
  for (const patch of attempts) {
    try {
      const rows = await supabaseJson(restUrl("orders", q), {
        method: "PATCH",
        headers: serviceHeaders(),
        body: JSON.stringify(patch),
      });
      return Array.isArray(rows) ? rows[0] || null : null;
    } catch (err) {
      lastErr = err;
      if (!/PGRST204|schema cache|column|Could not find/i.test(String(err?.message || err || ""))) throw err;
    }
  }
  if (lastErr) throw lastErr;
  return null;
}

async function tryReleaseHold(order, reason, operatorId) {
  try {
    const out = await releaseWalletHold({
      orderId: order.id,
      idempotencyKey: `order-release:${order.order_no || order.id}`,
      reason,
      operatorId: operatorId || null,
    });
    return !!(out && out.ok !== false && !out.skipped && (out.hold?.status === "released" || out.duplicate));
  } catch (err) {
    const msg = String(err?.message || "");
    if (!/mcj_wallet_release_hold|Could not find the function|schema cache|PGRST|no_hold/i.test(msg)) {
      console.warn("[order-cancel] release hold", msg.slice(0, 160));
    }
    return false;
  }
}

async function pendingReceipts(orderId) {
  const rows = await companionDb(
    "payment_receipts",
    `?order_id=eq.${encodeURIComponent(orderId)}&status=eq.pending&limit=5`
  ).catch(() => []);
  return Array.isArray(rows) ? rows : [];
}

function isWalletHoldReceipt(r = {}) {
  return /cat.?food|wallet|猫粮|WALLET_HOLD/i.test(
    String(r.payment_method || "") + String(r.review_remark || "") + String(r.storage_path || "")
  );
}

async function supersedeReceipts(rows) {
  for (const r of rows) {
    await companionDb("payment_receipts", `?id=eq.${encodeURIComponent(r.id)}&status=eq.pending`, {
      method: "PATCH",
      body: JSON.stringify({ status: "superseded", reviewed_at: nowIso() }),
    }).catch(() => null);
  }
}

async function refundToCatfood(order, amount, reason, operator) {
  const refundApi = await import("./_boss-refund-payout.js");
  const open = await companionDb(
    "boss_refund_requests",
    `?order_id=eq.${encodeURIComponent(order.id)}&status=neq.rejected&status=neq.cancelled&order=created_at.desc&limit=1`
  ).catch(() => []);
  let refundId = open?.[0]?.id || "";
  if (!refundId) {
    const bossRows = await supabaseJson(
      restUrl("profiles", `?id=eq.${encodeURIComponent(order.boss_id)}&select=id,display_name,email,boss_uid&limit=1`),
      { headers: serviceHeaders() }
    ).catch(() => []);
    const boss = bossRows?.[0] || { id: order.boss_id };
    const created = await refundApi.createBossRefundRequest(companionDb, {
      order,
      boss: { ...boss, public_uid: boss.boss_uid || "" },
      amount,
      reason,
    });
    if (!created.ok) return { ok: false, message: created.message };
    refundId = created.refund.id;
  }
  const confirmed = await refundApi.confirmBossCatFoodRefund(companionDb, {
    refundId,
    amount,
    adminId: operator?.id || null,
    adminName: operator?.name || "customer_service",
    reason,
  });
  if (!confirmed.ok) return { ok: false, message: confirmed.message };
  return { ok: true, duplicate: !!confirmed.duplicate, refund: confirmed.refund || null };
}

async function sideEffects(order, { finalStatus, reason, mode, amount, operator }) {
  const no = order.order_no || order.id;
  try {
    const { createGrabListingHelpers } = await import("./_order-grab-listings.js");
    await createGrabListingHelpers(db).closeListing(order.id, "cs_cancelled");
  } catch {
    /* best-effort */
  }
  const refundText =
    mode === "hold_release"
      ? `冻结的 ${amount} 猫粮已退回您的余额。`
      : mode === "catfood_credit"
        ? `已退款 ${amount} 猫粮至您的猫粮余额。`
        : "";
  const title = finalStatus === "refunded" ? "订单已退款" : "订单已取消";
  const body = `订单 ${no} ${finalStatus === "refunded" ? "已退款" : "已由客服取消"}。原因：${reason}。${refundText}`.trim();
  try {
    const { notifyBossOrderEvent } = await import("./_boss-order-notify.js");
    await notifyBossOrderEvent({ ...order, status: finalStatus }, {
      title,
      body,
      kind: finalStatus === "refunded" ? "order_refunded" : "order_cancelled",
    });
  } catch {
    /* best-effort */
  }
  if (order.companion_id) {
    try {
      const { notifyCompanionOrderStatusChange } = await import("./_companion-order-notify.js");
      await notifyCompanionOrderStatusChange({ ...order, status: finalStatus }, { status: finalStatus });
    } catch {
      /* best-effort */
    }
  }
  return { title, body, operator };
}

/**
 * @param {object} order       orders row (fresh)
 * @param {{ intent?: "cancel"|"refund", reason: string, operator: { id: string, name?: string, role?: string } }} opts
 * @returns {Promise<{ ok: boolean, status: number, code?: string, message: string, order?: object,
 *                     mode?: string, amount?: number, duplicate?: boolean, notice?: object }>}
 */
export async function csCancelOrRefundOrder(order, { intent = "cancel", reason = "", operator = {} } = {}) {
  if (!order?.id) return fail(404, "ORDER_NOT_FOUND", "订单不存在。");
  const why = String(reason || "").trim().slice(0, 200);
  if (!why) return fail(400, "REASON_REQUIRED", intent === "refund" ? "请填写退款原因。" : "请填写取消原因。");
  const st = normalizeOrderStatus(order.status);
  const role = operator.role || "customer_service";
  const no = order.order_no || order.id;

  if (st === "cancelled" || st === "refunded") {
    // Heal a hold left frozen by an interrupted earlier cancel; the key makes this a no-op otherwise.
    await tryReleaseHold(order, `取消释放冻结 ${no}`, operator.id);
    return { ok: true, status: 200, duplicate: true, message: st === "refunded" ? "订单已退款。" : "订单已取消。", order };
  }
  if (BLOCKED_TEXT[st]) return fail(409, "NOT_CANCELLABLE", BLOCKED_TEXT[st], { order });
  const { isMultiGroupParent } = await import("./_order-group.js");
  if (isMultiGroupParent(order) || String(order.order_type || "").toLowerCase() === "multi_group" || order.parent_order_id) {
    return fail(409, "MULTI_ORDER_USE_GROUP_FLOW", "多人订单请在订单详情中按子订单处理（退出/替换/售后），不能整单直接取消。", { order });
  }
  const note = String(order.note || "").trim();
  const resuming = st === "refund_requested" && note.includes(CS_CANCEL_MARKER);
  if (st === "refund_requested" && !resuming) {
    const msg = note.includes(NO_TAKER_MARKER) ? "订单正在自动退款中，请稍后刷新。" : "订单已在售后流程中，请在「处理退款」中操作。";
    return fail(409, "IN_REFUND_FLOW", msg, { order });
  }
  if (!resuming && !CS_CANCELLABLE.includes(st)) return fail(409, "NOT_CANCELLABLE", `当前状态不可取消：${st}`, { order });

  const stamp = `${CS_CANCEL_MARKER}${nowIso()}|${role}:${operator.id || ""}|${why}`;
  const facts = await loadOrderMoneyFacts(order);
  const captured = facts.refundable > 0;

  // ---------- no successful payment: cancel, never credit the order price ----------
  if (!resuming && !captured && !facts.hasActiveHold) {
    if (intent === "refund") return fail(409, "NOTHING_TO_REFUND", "订单尚未付款，无需退款，请直接取消。", { order });
    const receipts = await pendingReceipts(order.id);
    if (receipts.some((r) => !isWalletHoldReceipt(r))) {
      return fail(409, "PAYMENT_PROOF_PENDING", "老板已上传付款截图待审核：请先「确认收款」后再取消（会自动退款），或先「驳回付款」再取消。", { order });
    }
    const at = nowIso();
    const cancelNote = `${note}\n[客服取消] ${why}`.trim();
    const saved = await casPatch(order.id, st, [
      { status: "cancelled", cancelled_at: at, cancel_reason: why, cancelled_by: operator.id || null, customer_service_id: operator.id || null, note: cancelNote },
      { status: "cancelled", cancelled_at: at, customer_service_id: operator.id || null, note: cancelNote },
      { status: "cancelled", note: cancelNote },
    ]);
    if (!saved) {
      const latest = await loadOrder(order.id);
      if (latest && ["cancelled", "refunded"].includes(normalizeOrderStatus(latest.status))) {
        return { ok: true, status: 200, duplicate: true, message: normalizeOrderStatus(latest.status) === "refunded" ? "订单已退款。" : "订单已取消。", order: latest };
      }
      return fail(409, "STATUS_CHANGED", "订单状态已变化，请刷新后重试。", { order: latest || order });
    }
    await tryReleaseHold(order, `客服取消释放冻结 ${no}`, operator.id);
    await supersedeReceipts(receipts);
    await writeOrderStatusLog(db, { orderId: order.id, fromStatus: st, toStatus: "cancelled", operatorRole: role, operatorId: operator.id, note: `cs_cancel:unpaid:${why}` });
    const notice = await sideEffects(saved, { finalStatus: "cancelled", reason: why, mode: "unpaid", amount: 0, operator });
    return { ok: true, status: 200, message: "订单已取消（未付款，无需退款）。", order: saved, mode: "unpaid", amount: 0, notice };
  }

  // ---------- captured payment or an active hold: lock → move only real money → finalize ----------
  let locked = order;
  if (!resuming) {
    locked = await casPatch(order.id, st, [{ status: "refund_requested", note: `${note}\n${stamp}`.trim() }, { status: "refund_requested" }]);
    if (!locked) {
      const latest = await loadOrder(order.id);
      const lst = normalizeOrderStatus(latest?.status);
      if (lst === "cancelled" || lst === "refunded") return { ok: true, status: 200, duplicate: true, message: lst === "refunded" ? "订单已退款。" : "订单已取消。", order: latest };
      return fail(409, "STATUS_CHANGED", "订单状态已变化，请刷新后重试。", { order: latest || order });
    }
    await writeOrderStatusLog(db, { orderId: order.id, fromStatus: st, toStatus: "refund_requested", operatorRole: role, operatorId: operator.id, note: `cs_${intent}_lock:${why}` });
  }
  const amount = facts.refundable;
  let mode = "";
  let duplicate = false;
  let finalStatus = captured ? "refunded" : "cancelled";
  if (await tryReleaseHold(order, `客服${intent === "refund" ? "退款" : "取消"}释放冻结 ${no}`, operator.id)) {
    mode = "hold_release";
    // A hold is not a completed payment. Credit only a real captured amount, and only once.
    finalStatus = "cancelled";
    if (captured) {
      const r = await refundToCatfood(locked, amount, `客服${intent === "refund" ? "退款" : "取消订单"}：${why}`, operator);
      if (r.ok) {
        mode = "catfood_credit";
        duplicate = r.duplicate;
        finalStatus = "refunded";
      } else {
        console.warn("[order-cancel] refund after hold", r.message);
      }
    }
    if (captured && finalStatus !== "refunded") {
      mode = "";
    } else if (mode === "hold_release" || finalStatus === "refunded") {
      const at = nowIso();
      const fin = await casPatch(order.id, "refund_requested", [
        { status: finalStatus, cancelled_at: at, cancel_reason: why, customer_service_id: operator.id || null },
        { status: finalStatus, cancelled_at: at },
        { status: finalStatus },
      ]).catch(() => null);
      if (mode === "hold_release") duplicate = !fin;
      if (captured && finalStatus === "refunded") {
        try {
          const settleApi = await import("./_cs-commission-settle.js");
          await settleApi.clawbackCsOrderIncome({ ...locked, status: finalStatus, refund_amount: amount, refundAmount: amount }, { mode: "refund", reason: `客服${intent === "refund" ? "退款" : "取消"}冲销提成` });
        } catch (err) {
          console.warn("[order-cancel] cs clawback", String(err?.message || err).slice(0, 160));
        }
      }
    }
  } else if (amount > 0) {
    const r = await refundToCatfood(locked, amount, `客服${intent === "refund" ? "退款" : "取消订单"}：${why}`, operator);
    if (r.ok) {
      mode = "catfood_credit";
      duplicate = r.duplicate;
      finalStatus = "refunded";
    } else {
      console.warn("[order-cancel] refund", r.message);
    }
  } else {
    mode = "unpaid";
    finalStatus = "cancelled";
    const at = nowIso();
    const fin = await casPatch(order.id, "refund_requested", [
      { status: "cancelled", cancelled_at: at, cancel_reason: why },
      { status: "cancelled" },
    ]).catch(() => null);
    duplicate = !fin;
  }
  if (!mode) {
    return {
      ok: false,
      status: 202,
      code: "REFUND_MANUAL_REVIEW",
      message: "订单已锁定为售后退款，但自动退回猫粮未完成，请到「处理退款」或后台财务继续处理（不会重复退款）。",
      order: { ...locked, status: "refund_requested" },
      amount,
    };
  }
  if (!duplicate) {
    await writeOrderStatusLog(db, { orderId: order.id, fromStatus: "refund_requested", toStatus: finalStatus, operatorRole: role, operatorId: operator.id, note: `cs_${intent}:${mode}:${amount}` });
  }
  const view = (await loadOrder(order.id).catch(() => null)) || { ...locked, status: finalStatus };
  const notice = duplicate ? null : await sideEffects(view, { finalStatus: normalizeOrderStatus(view.status) || finalStatus, reason: why, mode, amount, operator });
  return {
    ok: true,
    status: 200,
    duplicate,
    mode,
    amount,
    order: view,
    notice,
    message: duplicate
      ? (finalStatus === "cancelled" ? "订单已取消。" : "该订单已退款，未重复退回。")
      : finalStatus === "cancelled"
        ? (mode === "hold_release" ? "订单已取消，冻结的猫粮已退回。" : "订单已取消（未付款，无需退款）。")
        : `订单已退款，${amount} 猫粮已退回老板余额。`,
  };
}
