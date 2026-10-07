/**
 * CS-confirmed early finish (single order, one multi child, or a whole multi group).
 *
 * Money only moves through modules that are already idempotent:
 *   - settlement → finalizeOrderCompletion (CAS status=in_progress → completed, one companion_income row)
 *   - refund     → one tagged boss_refund_requests row per order → confirmBossCatFoodRefund
 *                  (wallet key `refund-meow:{refund_id}`, proportional companion / CS / boss clawbacks)
 * The order row is claimed first by a conditional PATCH (status=in_progress AND no EARLY_FINISH marker),
 * so repeated clicks / parallel CS sessions cannot settle, refund or end the same order twice.
 * Multi group: each child is finished on its own row; the parent is only re-aggregated, never refunded.
 */
import { restUrl, supabaseJson, serviceHeaders } from "./_wallet.js";
import { companionDb } from "./_companion-media-store.js";
import { resolveEffectiveCompanionCommission } from "./_commission-rates.js";
import { ensureOrderBadgeSnapshot, historicalSettlementLocked, readOrderBadgeSnapshot } from "./_cert-badge-ledger.js";
import { readLocalLevels } from "./_companion-levels-store.js";
import { writeOrderStatusLog } from "./_order-status.js";
import {
  createOrderCompleteHelpers,
  orderHasCompletionPending,
  parseCompletionRequestedAt,
} from "./_order-complete.js";
import { isMultiGroupParent, ORDER_TYPE_MULTI_GROUP } from "./_order-group.js";

const MARKER_RE = /\n?\[\[EARLY_FINISH:([^\]\n]*)\]\]/;
const REJECT_RE = /\n?\[\[EARLY_FINISH_REJECT:([^\]\n]*)\]\]/;
export const EARLY_FINISH_REFUND_PREFIX = "[提前结束退款]";
const STALE_PROCESSING_MS = 60 * 1000;
const INITIATOR_LABELS = { companion: "陪玩申请", boss: "老板要求", customer_service: "客服判定" };
const db = { restUrl, supabaseJson, serviceHeaders };
const LOCKS = new Set();

function money(v) {
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}
function nowIso() {
  return new Date().toISOString();
}
function fail(status, code, message, extra = {}) {
  return Object.assign(new Error(message), { status, code, ...extra });
}
function isMultiParent(order) {
  return isMultiGroupParent(order) || String(order?.order_type || "").toLowerCase() === ORDER_TYPE_MULTI_GROUP;
}

function readMarker(order, re) {
  const hit = String(order?.note || "").match(re);
  if (!hit) return null;
  try {
    return JSON.parse(decodeURIComponent(hit[1]));
  } catch {
    return null;
  }
}
export function readEarlyFinish(order) {
  return readMarker(order, MARKER_RE);
}
export function readEarlyFinishReject(order) {
  return readMarker(order, REJECT_RE);
}
function withMarker(note, re, tag, data) {
  const base = String(note || "").replace(new RegExp(re.source, "g"), "").trimEnd();
  return `${base}\n[[${tag}:${encodeURIComponent(JSON.stringify(data))}]]`.trim();
}
export function withEarlyFinishMarker(note, data) {
  return withMarker(note, MARKER_RE, "EARLY_FINISH", data);
}

/** Minutes actually served: started_at → companion's completion request (if any) → now. */
export function elapsedMinutes(order, now = Date.now()) {
  const start = Date.parse(order?.started_at || order?.accepted_at || "");
  if (!Number.isFinite(start)) return null;
  const requested = Date.parse(parseCompletionRequestedAt(order) || "");
  const end = Number.isFinite(requested) ? requested : now;
  return Math.max(0, Math.round((end - start) / 60000));
}

export function initiatorOf(order, chosen = "") {
  const role = INITIATOR_LABELS[chosen] ? chosen : orderHasCompletionPending(order) ? "companion" : "customer_service";
  const at = role === "companion" ? parseCompletionRequestedAt(order) || "" : "";
  return { role, label: INITIATOR_LABELS[role], at };
}

/** Pro-rata split of what the boss paid for this row. Served ≥ booked settles in full (no refund). */
export function computeEarlyFinish(order, { servedHours, companionShareRate = 0 } = {}) {
  const booked = money(order?.hours);
  const total = money(order?.paid_cat_food) || money(order?.total_amount);
  if (!(booked > 0)) throw fail(400, "NO_BOOKED_HOURS", "订单缺少预约时长，无法按实际时长结算。");
  const served = Number(servedHours);
  if (!Number.isFinite(served) || served < 0) throw fail(400, "BAD_SERVED_HOURS", "请填写正确的实际服务时长。");
  if (served > booked + 1e-9) throw fail(400, "SERVED_OVER_BOOKED", `实际时长不能超过预约时长 ${booked} 小时。`);
  const servedHoursRounded = Math.round(served * 100) / 100;
  const settleAmount = servedHoursRounded >= booked ? total : money((total * servedHoursRounded) / booked);
  const refundAmount = money(total - settleAmount);
  const share = Math.min(100, Math.max(0, Number(companionShareRate) || 0));
  const companionIncome = money((settleAmount * share) / 100);
  return {
    bookedHours: booked,
    servedHours: servedHoursRounded,
    totalAmount: total,
    settleAmount,
    refundAmount,
    companionShareRate: share,
    companionIncome,
    platformCommission: money(settleAmount - companionIncome),
  };
}

/** Same share resolution as settlement (settlement snapshot → gameplay fee snapshot → frozen badge → profile/level). */
export async function estimateCompanionShare(order) {
  if (order?.companion_commission_rate_snapshot != null && order.companion_commission_rate_snapshot !== "") {
    return money(order.companion_commission_rate_snapshot);
  }
  const isGameplay = String(order?.order_type || "").toLowerCase() === "gameplay_product";
  if (isGameplay && order?.platform_fee_rate != null && order.platform_fee_rate !== "") {
    return money(100 - Math.min(100, Math.max(0, money(order.platform_fee_rate))));
  }
  let badgeSnap = readOrderBadgeSnapshot(order);
  if (!badgeSnap && order?.id && !historicalSettlementLocked(order)) {
    badgeSnap = await ensureOrderBadgeSnapshot(order, { stage: "early_finish" }).catch(() => null);
  }
  const badgeShare = badgeSnap?.commission?.companionShareRate;
  if (badgeShare != null && badgeShare !== "") return money(badgeShare);
  if (!order?.companion_id) return 0;
  const cp =
    (
      await supabaseJson(restUrl("companion_profiles", `?user_id=eq.${encodeURIComponent(order.companion_id)}&limit=1`), {
        headers: serviceHeaders(),
      }).catch(() => [])
    )?.[0] || {};
  const levels = await readLocalLevels().catch(() => []);
  const levelMeta =
    (levels || []).find(
      (l) => String(l.id) === String(cp.level_id || "") || String(l.code) === String(cp.level_id || "") || String(l.name) === String(cp.level_name || "")
    ) || null;
  const eff = resolveEffectiveCompanionCommission({
    companionProfile: cp,
    levelPlatformRate: levelMeta?.commissionRate ?? 20,
    fallbackPlatform: 20,
  });
  return money(eff.companionShareRate);
}

async function loadOrder(id) {
  const rows = await supabaseJson(restUrl("orders", `?id=eq.${encodeURIComponent(id)}&limit=1`), { headers: serviceHeaders() });
  return rows?.[0] || null;
}
async function loadChildren(parentId) {
  return (
    (await supabaseJson(
      restUrl("orders", `?parent_order_id=eq.${encodeURIComponent(parentId)}&select=*&order=created_at.asc`),
      { headers: serviceHeaders() }
    ).catch(() => [])) || []
  );
}

function eligibility(row) {
  const st = String(row?.status || "").toLowerCase();
  const done = readEarlyFinish(row);
  if (done?.status === "done") return { eligible: false, reason: "已提前结束" };
  if (st === "in_progress") return { eligible: true, reason: "" };
  if (st === "completed" || st === "reviewed") return { eligible: false, reason: "订单已完成，不能提前结束" };
  if (st === "cancelled" || st === "refunded") return { eligible: false, reason: "订单已取消/退款" };
  return { eligible: false, reason: "仅服务中的订单可提前结束" };
}

async function targetView(row) {
  const share = await estimateCompanionShare(row).catch(() => 0);
  const el = eligibility(row);
  return {
    id: row.id,
    orderNo: row.order_no || "",
    companionId: row.companion_id || "",
    status: row.status || "",
    eligible: el.eligible,
    blockedReason: el.reason,
    bookedHours: money(row.hours),
    totalAmount: money(row.paid_cat_food) || money(row.total_amount),
    elapsedMinutes: elapsedMinutes(row),
    companionShareRate: share,
    completionPending: orderHasCompletionPending(row),
    initiator: initiatorOf(row),
    earlyFinish: readEarlyFinish(row),
    earlyFinishReject: readEarlyFinishReject(row),
  };
}

export async function earlyFinishPreview(order) {
  if (!order?.id) throw fail(404, "ORDER_NOT_FOUND", "订单不存在。");
  if (isMultiParent(order)) {
    const kids = await loadChildren(order.id);
    return { orderId: order.id, orderNo: order.order_no || "", isMulti: true, targets: await Promise.all(kids.map(targetView)) };
  }
  return { orderId: order.id, orderNo: order.order_no || "", isMulti: false, targets: [await targetView(order)] };
}

async function claim(order, data) {
  const q =
    `?id=eq.${encodeURIComponent(order.id)}&status=eq.in_progress` +
    `&or=(note.is.null,note.not.like.${encodeURIComponent('"*EARLY_FINISH:*"')})`;
  const rows = await supabaseJson(restUrl("orders", q), {
    method: "PATCH",
    headers: serviceHeaders(),
    body: JSON.stringify({ note: withEarlyFinishMarker(order.note, data) }),
  });
  return rows?.[0] || null;
}

async function patchMarker(orderId, data) {
  const fresh = await loadOrder(orderId);
  if (!fresh) return null;
  const rows = await supabaseJson(restUrl("orders", `?id=eq.${encodeURIComponent(orderId)}`), {
    method: "PATCH",
    headers: serviceHeaders(),
    body: JSON.stringify({ note: withEarlyFinishMarker(fresh.note, data) }),
  });
  return rows?.[0] || { ...fresh };
}

async function refundEarlyFinish(order, amount, reason, operator, orderGross) {
  const refundApi = await import("./_boss-refund-payout.js");
  const tagged = await companionDb(
    "boss_refund_requests",
    `?order_id=eq.${encodeURIComponent(order.id)}&status=neq.rejected&status=neq.cancelled&order=created_at.desc&limit=20`
  ).catch(() => []);
  let refundId = (tagged || []).find((r) => String(r.reason || "").startsWith(EARLY_FINISH_REFUND_PREFIX))?.id || "";
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
      reason: `${EARLY_FINISH_REFUND_PREFIX}${reason}`,
    });
    if (!created.ok) return { ok: false, message: created.message };
    refundId = created.refund.id;
  }
  const confirmed = await refundApi.confirmBossCatFoodRefund(companionDb, {
    refundId,
    amount,
    adminId: operator?.id || null,
    adminName: operator?.name || "customer_service",
    reason: `${EARLY_FINISH_REFUND_PREFIX}${reason}`,
    orderGross,
  });
  if (!confirmed.ok) return { ok: false, message: confirmed.message, refundId };
  return { ok: true, duplicate: !!confirmed.duplicate, refundId };
}

async function finishOne(row, { servedHours, reason, initiator, operator, addSystemMessage }) {
  let fresh = (await loadOrder(row.id)) || row;
  let data = readEarlyFinish(fresh);
  if (data?.status === "done") return { orderId: fresh.id, orderNo: fresh.order_no, duplicate: true, earlyFinish: data };

  if (data?.status === "processing") {
    const age = Date.now() - Date.parse(data.claimedAt || 0);
    if (age < STALE_PROCESSING_MS) {
      throw fail(409, "EARLY_FINISH_IN_PROGRESS", "该订单正在提前结束处理中，请稍后刷新。", { orderId: fresh.id });
    }
  } else {
    const el = eligibility(fresh);
    if (!el.eligible) throw fail(409, "NOT_EARLY_FINISHABLE", el.reason, { orderId: fresh.id });
    const share = await estimateCompanionShare(fresh);
    const calc = computeEarlyFinish(fresh, { servedHours, companionShareRate: share });
    data = {
      v: 1,
      status: "processing",
      ...calc,
      elapsedMinutes: elapsedMinutes(fresh),
      initiator: initiatorOf(fresh, initiator),
      reason,
      confirmedById: operator.id || "",
      confirmedByName: operator.name || "",
      claimedAt: nowIso(),
    };
    const claimed = await claim(fresh, data);
    if (!claimed) {
      const latest = await loadOrder(fresh.id);
      const other = readEarlyFinish(latest);
      if (other?.status === "done") return { orderId: fresh.id, orderNo: fresh.order_no, duplicate: true, earlyFinish: other };
      if (other) throw fail(409, "EARLY_FINISH_IN_PROGRESS", "该订单正在提前结束处理中，请稍后刷新。", { orderId: fresh.id });
      throw fail(409, "STATUS_CHANGED", "订单状态已变化，请刷新后重试。", { orderId: fresh.id });
    }
    fresh = claimed;
    await writeOrderStatusLog(db, {
      orderId: fresh.id,
      fromStatus: "in_progress",
      toStatus: "in_progress",
      operatorRole: "customer_service",
      operatorId: operator.id,
      note: `cs_early_finish_claim:${calc.servedHours}/${calc.bookedHours}h:refund=${calc.refundAmount}`,
    }).catch(() => {});
  }

  const helpers = createOrderCompleteHelpers({ restUrl, supabaseJson, serviceHeaders, addSystemMessage });
  if (String(fresh.status) === "in_progress") {
    await helpers.finalizeOrderCompletion(fresh, {
      method: "cs_force",
      actorId: operator.id,
      message: `客服已确认提前结束订单：实际服务 ${data.servedHours} 小时 / 预约 ${data.bookedHours} 小时。原因：${data.reason}`,
    });
  }

  let refund = { ok: true, refundId: data.refundId || "" };
  if (data.refundAmount > 0) {
    refund = await refundEarlyFinish(fresh, data.refundAmount, data.reason, operator, data.totalAmount);
    if (!refund.ok) {
      await patchMarker(fresh.id, { ...data, status: "processing", refundError: String(refund.message || "").slice(0, 160), claimedAt: new Date(0).toISOString() });
      throw fail(502, "EARLY_FINISH_REFUND_PENDING", `订单已结算，但退款 ${data.refundAmount} 猫粮未完成：${refund.message || "请稍后重试"}（重试不会重复退款）`, { orderId: fresh.id });
    }
  }

  const after = (await loadOrder(fresh.id)) || fresh;
  const fullIncome = money(after.companion_income);
  const companionIncome =
    fullIncome > 0 && data.totalAmount > 0 ? money(fullIncome - (fullIncome * data.refundAmount) / data.totalAmount) : data.companionIncome;
  const done = {
    ...data,
    status: "done",
    refundId: refund.refundId || "",
    companionIncome,
    platformCommission: money(data.settleAmount - companionIncome),
    completedAt: nowIso(),
  };
  delete done.refundError;
  if (done.refundAmount > 0 && fullIncome > 0) {
    // Partial clawback is a separate ledger row; keep the order's display split equal to the ledger net.
    await supabaseJson(restUrl("orders", `?id=eq.${encodeURIComponent(fresh.id)}`), {
      method: "PATCH",
      headers: serviceHeaders(),
      body: JSON.stringify({ companion_income: done.companionIncome, platform_fee: done.platformCommission }),
    }).catch(() => null);
  }
  await patchMarker(fresh.id, done);
  await writeOrderStatusLog(db, {
    orderId: fresh.id,
    fromStatus: "in_progress",
    toStatus: String(after.status || "completed"),
    operatorRole: "customer_service",
    operatorId: operator.id,
    note: `cs_early_finish_done:settle=${done.settleAmount}:refund=${done.refundAmount}:income=${done.companionIncome}`,
  }).catch(() => {});
  if (typeof addSystemMessage === "function" && done.refundAmount > 0) {
    await addSystemMessage(after, operator.id, `提前结束退款：已退回老板 ${done.refundAmount} 猫粮（结算 ${done.settleAmount} 猫粮）。`).catch(() => {});
  }
  return { orderId: fresh.id, orderNo: fresh.order_no, duplicate: false, earlyFinish: done, order: after };
}

/**
 * @param {object} order   single order, multi child, or multi parent (fresh row)
 * @param {{ servedHours:number, reason:string, initiator?:string, childIds?:string[],
 *           operator:{id:string,name?:string}, addSystemMessage?:Function }} opts
 */
export async function executeEarlyFinish(order, opts = {}) {
  if (!order?.id) throw fail(404, "ORDER_NOT_FOUND", "订单不存在。");
  const reason = String(opts.reason || "").trim().slice(0, 200);
  if (!reason) throw fail(400, "REASON_REQUIRED", "请填写提前结束原因。");
  const operator = opts.operator || {};
  let targets;
  if (isMultiParent(order)) {
    const kids = await loadChildren(order.id);
    const wanted = Array.isArray(opts.childIds) && opts.childIds.length ? new Set(opts.childIds.map(String)) : null;
    targets = kids.filter((k) => (wanted ? wanted.has(String(k.id)) : eligibility(k).eligible || readEarlyFinish(k)?.status === "processing"));
    if (!targets.length) throw fail(409, "NO_ELIGIBLE_CHILD", "没有可提前结束的子订单（需为服务中）。");
  } else {
    targets = [order];
  }
  const results = [];
  for (const t of targets) {
    if (LOCKS.has(t.id)) {
      results.push({ orderId: t.id, orderNo: t.order_no, ok: false, code: "EARLY_FINISH_IN_PROGRESS", message: "该订单正在提前结束处理中，请稍后刷新。" });
      continue;
    }
    LOCKS.add(t.id);
    try {
      const r = await finishOne(t, { ...opts, reason, operator });
      results.push({ ok: true, ...r });
    } catch (err) {
      results.push({ orderId: t.id, orderNo: t.order_no, ok: false, code: err.code || "", message: err.message || "提前结束失败" });
    } finally {
      LOCKS.delete(t.id);
    }
  }
  return { ok: results.every((r) => r.ok), results };
}

/** CS declines a companion's completion request; order keeps running, reason is recorded for all ends. */
export async function rejectEarlyFinish(order, { reason, operator = {}, childIds = [], addSystemMessage } = {}) {
  if (!order?.id) throw fail(404, "ORDER_NOT_FOUND", "订单不存在。");
  const why = String(reason || "").trim().slice(0, 200);
  if (!why) throw fail(400, "REASON_REQUIRED", "请填写拒绝原因。");
  const pool = isMultiParent(order) ? await loadChildren(order.id) : [order];
  const wanted = childIds.length ? new Set(childIds.map(String)) : null;
  const targets = pool.filter((r) => (!wanted || wanted.has(String(r.id))) && String(r.status) === "in_progress" && orderHasCompletionPending(r));
  if (!targets.length) throw fail(409, "NO_PENDING_REQUEST", "没有待处理的陪玩提前结束申请。");
  const helpers = createOrderCompleteHelpers({ restUrl, supabaseJson, serviceHeaders, addSystemMessage });
  const out = [];
  for (const t of targets) {
    const fresh = (await loadOrder(t.id)) || t;
    const cleared = await helpers.clearCompletionPending(fresh);
    const note = withMarker(cleared.note, REJECT_RE, "EARLY_FINISH_REJECT", {
      reason: why,
      rejectedById: operator.id || "",
      rejectedByName: operator.name || "",
      requestedAt: parseCompletionRequestedAt(fresh) || "",
      at: nowIso(),
    });
    await supabaseJson(restUrl("orders", `?id=eq.${encodeURIComponent(fresh.id)}&status=eq.in_progress`), {
      method: "PATCH",
      headers: serviceHeaders(),
      body: JSON.stringify({ note }),
    });
    if (typeof addSystemMessage === "function") {
      await addSystemMessage(fresh, operator.id, `客服未同意提前结束，订单继续服务。原因：${why}`).catch(() => {});
    }
    out.push({ orderId: fresh.id, orderNo: fresh.order_no });
  }
  return { ok: true, results: out };
}
