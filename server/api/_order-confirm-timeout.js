/**
 * Designated companion confirm window (claimed status).
 *
 * 2026-08 round acceptance: companion confirm TIMEOUT is cancelled for regular orders.
 * Orders stay in `claimed` until companion accepts/rejects or CS reassigns.
 *
 * Exception — gameplay product orders (更多玩法商品) created with the no-taker rule line:
 *   claimed  (指定陪玩) 30 min unconfirmed → reopened in public grab hall
 *   pending  (抢单大厅) 30 min without grab → full refund to 猫粮余额 (any payment method)
 * Driven by the scheduled /api/cron/gameplay-no-taker tick (Supabase pg_cron, every minute)
 * plus the daily Vercel cron; never by page reads. Every transition is a CAS patch and only
 * the run that wins it writes logs / notifications, so overlapping ticks cannot move or
 * refund an order twice.
 */
import "./_load-env.js";

/** Retained for callers; regular-order timeout mechanism disabled (no auto-expire). */
export const COMPANION_CONFIRM_TIMEOUT_MS = 0;
export const COMPANION_CONFIRM_TIMEOUT_DISABLED = true;

export const GAMEPLAY_NO_TAKER_TIMEOUT_MS = 30 * 60 * 1000;
/** Substring of the rule line stamped into product order descriptions at create time. */
export const GAMEPLAY_NO_TAKER_RULE_TAG = "无人接单自动全额退回猫粮余额";
/** Stamped on the refund lock so a tick that died mid-refund is finished by the next tick. */
const NO_TAKER_REFUND_MARKER = "[[NO_TAKER_REFUND]]";
/** A lock younger than this may still be in flight in another tick; don't resume it yet. */
const NO_TAKER_RESUME_GRACE_MS = 2 * 60 * 1000;

function refundLockStale(order = {}, now = Date.now()) {
  const hit = String(order.note || "").match(/\[\[NO_TAKER_REFUND\]\]\s*([^\n|]+)/);
  if (!hit) return false;
  const at = Date.parse(hit[1].trim());
  return !Number.isFinite(at) || now - at >= NO_TAKER_RESUME_GRACE_MS;
}

function nowIso() {
  return new Date().toISOString();
}

function money(v) {
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

export function confirmDeadlineIso(fromIso) {
  // No deadline when timeout is cancelled.
  return "";
}

/** Stamp claim time into note (audit only; not used for expiry). */
export function stampClaimedAtNote(note, atIso = nowIso()) {
  const cleaned = String(note || "")
    .replace(/\n?\[\[CLAIMED_AT\]\][^\n]*/g, "")
    .trim();
  return `${cleaned}\n[[CLAIMED_AT]]${atIso}`.trim();
}

export function claimedAtFromOrder(order = {}) {
  const note = String(order.note || order.description || "");
  const hit = note.match(/\[\[CLAIMED_AT\]\]\s*([^\n|]+)/i);
  if (hit?.[1] && !Number.isNaN(Date.parse(hit[1].trim()))) return hit[1].trim();
  if (order.paid_at && !Number.isNaN(Date.parse(order.paid_at))) return order.paid_at;
  return "";
}

/** Stamp when an order (re)entered the public grab hall. */
export function stampHallOpenNote(note, atIso = nowIso()) {
  const cleaned = String(note || "")
    .replace(/\n?\[\[HALL_OPEN_AT\]\][^\n]*/g, "")
    .trim();
  return `${cleaned}\n[[HALL_OPEN_AT]]${atIso}`.trim();
}

function hallOpenAtFromOrder(order = {}) {
  const hit = String(order.note || "").match(/\[\[HALL_OPEN_AT\]\]\s*([^\n|]+)/i);
  return hit?.[1] && !Number.isNaN(Date.parse(hit[1].trim())) ? hit[1].trim() : "";
}

export function gameplayProductIdFromOrder(order = {}) {
  const hit = String(order.description || "").match(/^商品ID[：:]\s*(\S+)\s*$/m);
  return hit ? hit[1].trim() : "";
}

/** Product orders that opted into the 30-min no-taker rule (rule line stamped at create). */
export function isGameplayNoTakerOrder(order = {}) {
  if (!order || order.parent_order_id) return false;
  const desc = String(order.description || "");
  return !!gameplayProductIdFromOrder(order) && desc.includes(GAMEPLAY_NO_TAKER_RULE_TAG);
}

export function gameplayNoTakerRuleLine(hasDesignatedCompanion) {
  return hasDesignatedCompanion
    ? `接单规则：指定陪玩30分钟内未确认或拒单，订单转入抢单大厅；抢单大厅30分钟${GAMEPLAY_NO_TAKER_RULE_TAG}`
    : `接单规则：抢单大厅30分钟${GAMEPLAY_NO_TAKER_RULE_TAG}`;
}

export function isCompanionConfirmTimedOut() {
  return false;
}

async function loadDb() {
  const wallet = await import("./_wallet.js");
  const status = await import("./_order-status.js");
  return {
    wallet,
    restUrl: wallet.restUrl,
    supabaseJson: wallet.supabaseJson,
    serviceHeaders: wallet.serviceHeaders,
    writeOrderStatusLog: status.writeOrderStatusLog,
  };
}

async function loadEnteredAtLookup(db, orders) {
  const latest = {};
  const ids = orders.map((o) => o.id).filter(Boolean);
  if (ids.length) {
    try {
      const logs = await db.supabaseJson(
        db.restUrl(
          "order_status_logs",
          `?order_id=in.(${ids.map(encodeURIComponent).join(",")})&select=order_id,to_status,created_at&order=created_at.desc&limit=1000`
        ),
        { headers: db.serviceHeaders() }
      );
      for (const log of Array.isArray(logs) ? logs : []) {
        const key = `${log.order_id}:${log.to_status}`;
        if (!latest[key]) latest[key] = log.created_at;
      }
    } catch {
      /* table optional — fall back to stamps on the row */
    }
  }
  return (order) => {
    const candidates = [latest[`${order.id}:${order.status}`], order.paid_at];
    if (order.status === "claimed") candidates.push(claimedAtFromOrder(order));
    if (order.status === "pending") candidates.push(hallOpenAtFromOrder(order));
    const best = candidates
      .map((v) => Date.parse(String(v || "")))
      .filter(Number.isFinite)
      .reduce((a, b) => Math.max(a, b), 0);
    return best || Date.parse(String(order.updated_at || order.created_at || "")) || 0;
  };
}

async function orderChatNotice(db, order, content) {
  try {
    const rows = await db.supabaseJson(
      db.restUrl(
        "conversations",
        `?order_id=eq.${encodeURIComponent(order.id)}&conversation_type=eq.order_support&order=updated_at.desc&limit=1`
      ),
      { headers: db.serviceHeaders() }
    );
    const conversation = rows?.[0];
    if (!conversation || !order.boss_id) return;
    await db.supabaseJson(db.restUrl("messages"), {
      method: "POST",
      headers: db.serviceHeaders(),
      body: JSON.stringify({
        conversation_id: conversation.id,
        sender_id: order.boss_id,
        sender_role: "boss",
        message_type: "system",
        content,
        order_id: order.id,
        created_at: nowIso(),
      }),
    });
  } catch {
    /* chat is best-effort */
  }
}

async function patchFirstAccepted(db, query, attempts) {
  let lastErr = null;
  for (const patch of attempts) {
    try {
      const rows = await db.supabaseJson(db.restUrl("orders", query), {
        method: "PATCH",
        headers: db.serviceHeaders(),
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

/** Designated companion never confirmed → reopen in public hall (same as reject). */
async function reopenDesignatedInHall(db, order) {
  const at = nowIso();
  const companionId = String(order.companion_id || "");
  const note = stampHallOpenNote(
    `${String(order.note || "").trim()}\n指定陪玩30分钟未确认|原陪玩:${companionId}|${at}`.trim(),
    at
  );
  const query = `?id=eq.${encodeURIComponent(order.id)}&status=eq.claimed&companion_id=eq.${encodeURIComponent(companionId)}`;
  const saved = await patchFirstAccepted(db, query, [
    { companion_id: null, status: "pending", accepted_at: null, assignment_type: "public", order_type: "open_grab", note },
    { companion_id: null, status: "pending", accepted_at: null, note },
  ]);
  if (!saved) return null;
  await db.writeOrderStatusLog(db, {
    orderId: order.id,
    fromStatus: "claimed",
    toStatus: "pending",
    operatorRole: "system",
    operatorId: null,
    note: `gameplay_confirm_timeout: 原陪玩 ${companionId}`,
  });
  try {
    const { createGrabListingHelpers } = await import("./_order-grab-listings.js");
    await createGrabListingHelpers(db).upsertListing(saved, {
      publishedByCsId: null,
      reason: "gameplay_confirm_timeout",
    });
  } catch (err) {
    console.warn("[gameplay-timeout] listing", String(err?.message || err).slice(0, 160));
  }
  const no = order.order_no || order.id;
  try {
    const { notifyBossOrderEvent } = await import("./_boss-order-notify.js");
    await notifyBossOrderEvent(saved, {
      title: "指定陪玩未及时确认",
      body: `订单 ${no} 指定陪玩30分钟内未确认，已转入抢单大厅；30分钟内仍无人接单将自动全额退回猫粮余额。`,
      kind: "order_companion_unavailable",
    });
  } catch {
    /* best-effort */
  }
  try {
    const { insertCompanionNotification } = await import("./_companion-inbox.js");
    await insertCompanionNotification({
      companionUserId: companionId,
      category: "order",
      title: "订单确认已超时",
      body: `订单 ${no} 30分钟内未确认接单，已转入抢单大厅。`,
      href: "/companion/orders",
      noticeKey: `gameplay-confirm-timeout-${order.id}`,
      notificationType: "order_status",
    });
  } catch {
    /* best-effort */
  }
  await orderChatNotice(
    db,
    saved,
    `指定陪玩30分钟内未确认接单，订单 ${no} 已转入抢单大厅。30分钟内仍无人接单将自动全额退回猫粮余额。`
  );
  return saved;
}

function holdWasReleased(result) {
  return !!(
    result &&
    result.ok !== false &&
    !result.skipped &&
    (result.hold?.status === "released" || result.duplicate)
  );
}

/**
 * Hall had no taker → lock order (pending → refund_requested), then refund to 猫粮:
 * cat-food HOLD is released; any other rail (manual proof / legacy debit) is credited
 * through boss_refund_requests so admin finance sees the same refund record.
 */
export async function refundGameplayNoTaker(db, order, { reason = "抢单大厅30分钟无人接单，自动全额退款" } = {}) {
  let locked = null;
  if (order.status === "refund_requested") {
    if (!refundLockStale(order)) return null;
    locked = order;
  } else {
    const lockNote = `${String(order.note || "").trim()}\n${NO_TAKER_REFUND_MARKER}${nowIso()}`.trim();
    locked = await patchFirstAccepted(
      db,
      `?id=eq.${encodeURIComponent(order.id)}&status=eq.pending&companion_id=is.null`,
      [{ status: "refund_requested", note: lockNote }, { status: "refund_requested" }]
    );
    if (!locked) return null;
    await db.writeOrderStatusLog(db, {
      orderId: order.id,
      fromStatus: "pending",
      toStatus: "refund_requested",
      operatorRole: "system",
      operatorId: null,
      note: "gameplay_no_taker_timeout",
    });
  }
  const no = order.order_no || order.id;
  const { loadOrderMoneyFacts } = await import("./_order-payment-facts.js");
  const facts = await loadOrderMoneyFacts(order);
  const amount = facts.refundable;
  let mode = "";
  let refund = null;
  // Only the run that actually moved the money / status announces it.
  let won = false;

  try {
    const released = await db.wallet.releaseWalletHold({
      orderId: order.id,
      idempotencyKey: `order-release:${no}`,
      reason: `无人接单自动退款释放冻结 ${no}`,
      operatorId: null,
    });
    if (holdWasReleased(released)) mode = "hold_release";
  } catch (err) {
    const msg = String(err?.message || "");
    if (!/mcj_wallet_release_hold|Could not find the function|schema cache|PGRST|no_hold/i.test(msg)) {
      console.warn("[gameplay-timeout] release hold", msg.slice(0, 160));
    }
  }

  if (mode === "hold_release") {
    const holdStatus = facts.hasSuccessfulPayment ? "refunded" : "cancelled";
    won = !!(await patchFirstAccepted(db, `?id=eq.${encodeURIComponent(order.id)}&status=eq.refund_requested`, [
      { status: holdStatus },
    ]).catch(() => null));
    // CS order commission is booked at pay time; reverse it like the refund-request path does.
    try {
      const settleApi = await import("./_cs-commission-settle.js");
      await settleApi.clawbackCsOrderIncome(
        { ...locked, status: "refunded", refund_amount: amount, refundAmount: amount },
        { mode: "refund", reason: "无人接单自动退款冲销客服/平台提成" }
      );
    } catch (err) {
      console.warn("[gameplay-timeout] cs clawback", String(err?.message || err).slice(0, 160));
    }
  } else if (amount > 0 && facts.hasSuccessfulPayment) {
    try {
      const { companionDb } = await import("./_companion-media-store.js");
      const refundApi = await import("./_boss-refund-payout.js");
      const open = await companionDb(
        "boss_refund_requests",
        `?order_id=eq.${encodeURIComponent(order.id)}&status=neq.rejected&status=neq.cancelled&order=created_at.desc&limit=1`
      ).catch(() => []);
      let refundId = open?.[0]?.id || "";
      if (!refundId) {
        const bossRows = await db
          .supabaseJson(
            db.restUrl("profiles", `?id=eq.${encodeURIComponent(order.boss_id)}&select=id,display_name,email,boss_uid&limit=1`),
            { headers: db.serviceHeaders() }
          )
          .catch(() => []);
        const boss = bossRows?.[0] || { id: order.boss_id };
        const created = await refundApi.createBossRefundRequest(companionDb, {
          order: locked,
          boss: { ...boss, public_uid: boss.boss_uid || "" },
          amount,
          reason,
        });
        if (created.ok) refundId = created.refund.id;
        else console.warn("[gameplay-timeout] refund request", created.message);
      }
      if (refundId) {
        const confirmed = await refundApi.confirmBossCatFoodRefund(companionDb, {
          refundId,
          amount,
          adminId: null,
          adminName: "system",
          reason,
        });
        if (confirmed.ok) {
          mode = "catfood_credit";
          refund = confirmed.refund || null;
          won = !confirmed.duplicate;
        } else {
          console.warn("[gameplay-timeout] refund confirm", confirmed.message);
        }
      }
    } catch (err) {
      console.warn("[gameplay-timeout] refund", String(err?.message || err).slice(0, 160));
    }
  }

  if (!mode && !facts.hasSuccessfulPayment) {
    won = !!(await patchFirstAccepted(db, `?id=eq.${encodeURIComponent(order.id)}&status=eq.refund_requested`, [
      { status: "cancelled" },
    ]).catch(() => null));
    if (won) mode = "unpaid_cancel";
  }

  const resumed = order.status === "refund_requested";
  const finalStatus = mode === "unpaid_cancel" || (mode === "hold_release" && !facts.hasSuccessfulPayment)
    ? "cancelled"
    : mode
      ? "refunded"
      : "refund_requested";
  if (!mode && resumed) return { order: locked, mode: "manual_review", amount, refund };
  if (mode && !won) return { order: { ...locked, status: finalStatus }, mode, amount, refund, duplicate: true };
  if (mode) {
    await db.writeOrderStatusLog(db, {
      orderId: order.id,
      fromStatus: "refund_requested",
      toStatus: finalStatus,
      operatorRole: "system",
      operatorId: null,
      note: `gameplay_no_taker_refund:${mode}:${amount}`,
    });
  }
  try {
    const { createGrabListingHelpers } = await import("./_order-grab-listings.js");
    await createGrabListingHelpers(db).closeListing(order.id, "no_taker_refund");
  } catch {
    /* best-effort */
  }
  const view = { ...locked, status: finalStatus };
  const bossBody = finalStatus === "cancelled"
    ? `订单 ${no} 30分钟内无人接单，订单已取消。未付款，不会退款。`
    : mode
      ? `订单 ${no} 30分钟内无人接单，已退回实际支付的 ${amount} 猫粮。`
      : `订单 ${no} 30分钟内无人接单，已转为售后退款，客服将尽快为您退回猫粮余额。`;
  try {
    const { notifyBossOrderEvent } = await import("./_boss-order-notify.js");
    await notifyBossOrderEvent(view, {
      title: finalStatus === "cancelled" ? "无人接单，订单已取消" : mode ? "无人接单，已自动退款" : "无人接单，退款处理中",
      body: bossBody,
      kind: finalStatus === "cancelled" ? "order_cancelled" : "order_refunded",
    });
  } catch {
    /* best-effort */
  }
  await orderChatNotice(db, view, bossBody);
  return { order: view, mode: mode || "manual_review", amount, refund };
}

async function hasSelectableGrabs(db, orderIds, orders) {
  const out = {};
  try {
    const { createOrderGrabHelpers, isSelectableGrabStatus } = await import("./_order-grabs.js");
    const notes = Object.fromEntries(orders.map((o) => [o.id, `${o.note || ""}\n${o.description || ""}`]));
    const byOrder = await createOrderGrabHelpers(db).listGrabsBatch(orderIds, notes);
    for (const id of orderIds) {
      out[id] = (byOrder[id] || []).some((g) => isSelectableGrabStatus(g.status));
    }
  } catch {
    for (const id of orderIds) out[id] = true; // unknown → never refund blindly
  }
  return out;
}

/**
 * One sweep over product orders past the 30-min window. Safe to run concurrently (CAS patches).
 * @returns {{ reopened: number, refunded: number, actions: Array<{ id: string, orderNo: string, action: string, mode?: string }> }}
 */
export async function sweepGameplayNoTakerOrders({ limit = 60, now = Date.now(), budgetMs = 0 } = {}) {
  const startedAt = Date.now();
  const db = await loadDb();
  const result = { reopened: 0, refunded: 0, actions: [] };
  if (!db.wallet.hasWalletDb()) return result;
  const lim = Math.max(1, Math.min(Number(limit) || 60, 200));
  const cutoffIso = new Date(now - GAMEPLAY_NO_TAKER_TIMEOUT_MS).toISOString();
  const tag = encodeURIComponent(`*${GAMEPLAY_NO_TAKER_RULE_TAG}*`);
  const base = `?status=in.(claimed,pending,refund_requested)&description=like.${tag}&order=created_at.asc&limit=${lim}`;
  let rows = [];
  try {
    rows = await db.supabaseJson(db.restUrl("orders", `${base}&paid_at=lt.${encodeURIComponent(cutoffIso)}`), {
      headers: db.serviceHeaders(),
    });
  } catch (err) {
    if (!/paid_at|column|schema cache|PGRST/i.test(String(err?.message || ""))) throw err;
    rows = await db.supabaseJson(db.restUrl("orders", base), { headers: db.serviceHeaders() });
  }
  const candidates = (Array.isArray(rows) ? rows : []).filter(isGameplayNoTakerOrder);
  if (!candidates.length) return result;
  const enteredAt = await loadEnteredAtLookup(db, candidates);
  const due = candidates.filter(
    (o) =>
      (o.status === "refund_requested" && refundLockStale(o, now)) ||
      (o.status !== "refund_requested" && now - enteredAt(o) >= GAMEPLAY_NO_TAKER_TIMEOUT_MS)
  );
  const hallDue = due.filter((o) => o.status === "pending" && !o.companion_id);
  const grabbed = hallDue.length ? await hasSelectableGrabs(db, hallDue.map((o) => o.id), hallDue) : {};
  for (const order of due) {
    const ref = { id: order.id, orderNo: order.order_no || "" };
    if (budgetMs > 0 && Date.now() - startedAt > budgetMs) {
      result.deferred = (result.deferred || 0) + 1;
      continue;
    }
    try {
      if (order.status === "claimed" && order.companion_id) {
        if (await reopenDesignatedInHall(db, order)) {
          result.reopened += 1;
          result.actions.push({ ...ref, action: "reopened_in_hall" });
        }
      } else if (
        (order.status === "pending" && !order.companion_id && !grabbed[order.id]) ||
        order.status === "refund_requested"
      ) {
        const out = await refundGameplayNoTaker(db, order);
        if (out?.duplicate) {
          result.actions.push({ ...ref, action: "already_refunded" });
        } else if (out && out.mode !== "manual_review") {
          result.refunded += 1;
          result.actions.push({ ...ref, action: "refunded", mode: out.mode });
        } else if (out) {
          result.actions.push({ ...ref, action: "refund_pending_retry" });
        }
      }
    } catch (err) {
      console.warn("[gameplay-timeout]", order.id, String(err?.message || err).slice(0, 160));
      result.actions.push({ ...ref, action: "error", mode: String(err?.message || err).slice(0, 120) });
    }
  }
  return result;
}

/** Regular-order confirm timeout is cancelled; called from order list reads. */
export async function expireCompanionConfirmTimeouts() {
  return 0;
}
