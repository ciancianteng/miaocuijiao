/**
 * Web Push Business Events Integration (P0 order lifecycle).
 *
 * Builds on #248 foundation (sendWebPushToUser / expired-endpoint cleanup).
 * Does NOT refactor VAPID, subscription upsert, or admin test sender.
 *
 * Guarantees:
 * - Push is always targeted by user_id (never broadcast)
 * - Multi-device: all active endpoints for that user
 * - Idempotent: same (event, order, targetUser) only sends once
 * - Payload includes title/body/event/orderId/targetUser/click URL
 */
import { sendWebPushToUser, isWebPushConfigured } from "./_web-push.js";

export const ORDER_PUSH_EVENTS = Object.freeze({
  ORDER_PAID: "ORDER_PAID",
  ORDER_ASSIGNED: "ORDER_ASSIGNED",
  ORDER_ACCEPTED: "ORDER_ACCEPTED",
  ORDER_STARTED: "ORDER_STARTED",
  ORDER_COMPLETED: "ORDER_COMPLETED",
  ORDER_CANCELLED: "ORDER_CANCELLED",
});

const ALLOWED_EVENTS = new Set(Object.values(ORDER_PUSH_EVENTS));
const LOG_TABLE = "web_push_delivery_log";

function env(name, fallback = "") {
  const raw = process.env[name];
  if (raw == null || raw === "") return String(fallback || "");
  return String(raw).trim().replace(/^["']|["']$/g, "");
}

function hasDb() {
  return !!(env("SUPABASE_URL") && env("SUPABASE_SERVICE_ROLE_KEY"));
}

function serviceHeaders(extra = {}) {
  const key = env("SUPABASE_SERVICE_ROLE_KEY");
  const base = {
    apikey: key,
    "Content-Type": "application/json",
    Prefer: "return=representation",
    ...extra,
  };
  if (key && !key.startsWith("sb_secret_")) base.Authorization = "Bearer " + key;
  return base;
}

function restUrl(table, query) {
  return env("SUPABASE_URL") + "/rest/v1/" + table + (query || "");
}

async function supabaseJson(url, init) {
  const response = await fetch(url, init || {});
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    const msg =
      (body && (body.message || body.hint || body.details || body.code)) ||
      (typeof body === "string" ? body : "") ||
      response.status + " " + response.statusText;
    const err = new Error(msg);
    err.status = response.status;
    err.body = body;
    throw err;
  }
  return body;
}

export function bossOrderClickUrl(orderId) {
  const id = String(orderId || "").trim();
  return id ? "/orders.html?id=" + encodeURIComponent(id) : "/orders.html";
}

export function companionOrderClickUrl(orderId, filter = "") {
  const id = String(orderId || "").trim();
  let url = id ? "/companion/orders?focus=" + encodeURIComponent(id) : "/companion/orders";
  if (filter) url += (url.includes("?") ? "&" : "?") + "filter=" + encodeURIComponent(filter);
  return url;
}

export function orderIdsOf(order) {
  const o = order && typeof order === "object" ? order : {};
  return {
    orderId: String(o.id || o.order_id || "").trim(),
    orderNo: String(o.order_no || o.orderNo || o.id || "").trim(),
    bossId: String(o.boss_id || o.bossId || "").trim(),
    companionId: String(o.companion_id || o.companionId || "").trim(),
  };
}

export function buildDedupeKey(eventType, orderId, targetUserId) {
  return [String(eventType || "").trim().toUpperCase(), String(orderId || "").trim(), String(targetUserId || "").trim()]
    .join(":")
    .slice(0, 240);
}

/** Claim a delivery slot. true = this caller owns the send. */
async function claimDelivery({ dedupeKey, eventType, orderId, targetUserId, title, body, clickUrl }) {
  if (!hasDb()) return true;
  try {
    await supabaseJson(restUrl(LOG_TABLE, ""), {
      method: "POST",
      headers: serviceHeaders({ Prefer: "return=minimal" }),
      body: JSON.stringify({
        dedupe_key: dedupeKey,
        event_type: eventType,
        order_id: String(orderId || ""),
        target_user_id: targetUserId,
        title: String(title || "").slice(0, 120),
        body: String(body || "").slice(0, 240),
        click_url: String(clickUrl || "").slice(0, 500),
        sent_count: 0,
        failed_count: 0,
        skipped: "",
      }),
    });
    return true;
  } catch (err) {
    const msg = String(err && err.message ? err.message : err);
    if (err.status === 409 || /duplicate|unique|23505/i.test(msg)) return false;
    if (/does not exist|schema cache|web_push_delivery_log|PGRST/i.test(msg)) {
      console.warn("[web-push-biz] delivery_log unavailable, sending without dedupe claim");
      return true;
    }
    console.warn("[web-push-biz] claim failed", msg.slice(0, 160));
    return true;
  }
}

async function finalizeDelivery(dedupeKey, { sent = 0, failed = 0, skipped = "" } = {}) {
  if (!hasDb() || !dedupeKey) return;
  try {
    await supabaseJson(restUrl(LOG_TABLE, "?dedupe_key=eq." + encodeURIComponent(dedupeKey)), {
      method: "PATCH",
      headers: serviceHeaders({ Prefer: "return=minimal" }),
      body: JSON.stringify({
        sent_count: Number(sent) || 0,
        failed_count: Number(failed) || 0,
        skipped: String(skipped || "").slice(0, 80),
      }),
    });
  } catch {
    /* ignore */
  }
}

/**
 * Targeted, idempotent Web Push for one user + one business event.
 */
export async function emitOrderWebPush({
  eventType,
  order = null,
  targetUserId,
  title,
  body,
  clickUrl,
  orderId: orderIdInput = "",
} = {}) {
  const type = String(eventType || "").trim().toUpperCase();
  const uid = String(targetUserId || "").trim();
  const ids = orderIdsOf(order);
  const orderId = String(orderIdInput || ids.orderId || "").trim();
  if (!type || !uid) return { ok: false, skipped: "missing_event_or_user", sent: 0, failed: 0 };
  if (!ALLOWED_EVENTS.has(type)) return { ok: false, skipped: "unknown_event", sent: 0, failed: 0 };

  const dedupeKey = buildDedupeKey(type, orderId || "none", uid);
  const claimed = await claimDelivery({
    dedupeKey,
    eventType: type,
    orderId,
    targetUserId: uid,
    title,
    body,
    clickUrl,
  });
  if (!claimed) return { ok: true, skipped: "duplicate", dedupeKey, sent: 0, failed: 0 };

  if (!isWebPushConfigured()) {
    await finalizeDelivery(dedupeKey, { skipped: "vapid_unconfigured" });
    return { ok: false, skipped: "vapid_unconfigured", dedupeKey, sent: 0, failed: 0 };
  }

  const payload = {
    title: String(title || "妙脆角订单通知").slice(0, 80),
    body: String(body || "").slice(0, 180),
    url: String(clickUrl || "/").slice(0, 500),
    notificationType: type,
    eventType: type,
    entityId: orderId,
    orderId,
    targetUserId: uid,
    tag: "biz-" + type + "-" + (orderId || "x").slice(0, 36),
  };

  try {
    const result = await sendWebPushToUser(uid, payload);
    await finalizeDelivery(dedupeKey, {
      sent: result.sent || 0,
      failed: result.failed || 0,
      skipped: result.skipped || "",
    });
    return Object.assign({ dedupeKey, eventType: type, orderId, targetUserId: uid }, result);
  } catch (err) {
    const msg = String(err && err.message ? err.message : err).slice(0, 160);
    await finalizeDelivery(dedupeKey, { failed: 1, skipped: msg });
    console.warn("[web-push-biz] emit failed", msg);
    return { ok: false, dedupeKey, eventType: type, orderId, targetUserId: uid, sent: 0, failed: 1, error: msg };
  }
}

/**
 * Resolve P0 recipients for an order event and emit (idempotent per recipient).
 * Never broadcasts — only boss_id / companion_id on the order.
 */
export async function emitOrderLifecyclePush(eventType, order, { title, body } = {}) {
  const type = String(eventType || "").trim().toUpperCase();
  const ids = orderIdsOf(order);
  const jobs = [];
  const no = ids.orderNo || ids.orderId || "";

  const pushBoss = (t, b) => {
    if (!ids.bossId) return;
    jobs.push(
      emitOrderWebPush({
        eventType: type,
        order,
        targetUserId: ids.bossId,
        title: t,
        body: b,
        clickUrl: bossOrderClickUrl(ids.orderId),
      })
    );
  };
  const pushCompanion = (t, b, filter) => {
    if (!ids.companionId) return;
    jobs.push(
      emitOrderWebPush({
        eventType: type,
        order,
        targetUserId: ids.companionId,
        title: t,
        body: b,
        clickUrl: companionOrderClickUrl(ids.orderId, filter || ""),
      })
    );
  };

  switch (type) {
    case ORDER_PUSH_EVENTS.ORDER_PAID:
      pushBoss(title || "付款成功", body || (no ? `订单 ${no} 已支付成功。` : "订单已支付成功。"));
      pushCompanion(
        title || "新订单待处理",
        body || (no ? `订单 ${no} 已支付，请及时确认接单。` : "有新订单已支付，请及时确认接单。"),
        "waiting_confirm"
      );
      break;
    case ORDER_PUSH_EVENTS.ORDER_ASSIGNED:
      pushCompanion(
        title || "你有新的指定订单",
        body || (no ? `订单 ${no} 已分配给你，请确认接单。` : "你有新的指定订单，请确认接单。"),
        "waiting_confirm"
      );
      break;
    case ORDER_PUSH_EVENTS.ORDER_ACCEPTED:
      pushBoss(title || "陪玩已接单", body || (no ? `订单 ${no} 陪玩已确认接单。` : "陪玩已确认接单。"));
      break;
    case ORDER_PUSH_EVENTS.ORDER_STARTED:
      pushBoss(title || "订单已开始", body || (no ? `订单 ${no} 已开始服务。` : "订单已开始服务。"));
      break;
    case ORDER_PUSH_EVENTS.ORDER_COMPLETED:
      pushBoss(title || "订单已完成", body || (no ? `订单 ${no} 已完成。` : "订单已完成。"));
      pushCompanion(title || "订单已完成", body || (no ? `订单 ${no} 已完成。` : "订单已完成。"));
      break;
    case ORDER_PUSH_EVENTS.ORDER_CANCELLED:
      pushBoss(title || "订单已取消", body || (no ? `订单 ${no} 已取消。` : "订单已取消。"));
      pushCompanion(title || "订单已取消", body || (no ? `订单 ${no} 已取消。` : "订单已取消。"));
      break;
    default:
      return { ok: false, skipped: "unknown_event", results: [] };
  }

  const results = await Promise.all(
    jobs.map((p) => p.catch((e) => ({ ok: false, error: String(e && e.message ? e.message : e) })))
  );
  return { ok: true, eventType: type, orderId: ids.orderId, results };
}

/** Fire-and-forget wrapper for order lifecycle hooks. */
export function fanoutOrderLifecyclePush(eventType, order, opts) {
  Promise.resolve()
    .then(function () {
      return emitOrderLifecyclePush(eventType, order, opts || {});
    })
    .catch(function (err) {
      console.warn("[web-push-biz] fanout error", String(err && err.message ? err.message : err).slice(0, 120));
    });
}

/** Map legacy inbox kind → P0 business event (or ""). */
export function mapInboxKindToOrderPushEvent(kind) {
  const k = String(kind || "").trim().toLowerCase();
  if (k === "order_paid" || k === "paid") return ORDER_PUSH_EVENTS.ORDER_PAID;
  if (k === "order_assigned" || k === "order_reassigned" || k === "assigned") return ORDER_PUSH_EVENTS.ORDER_ASSIGNED;
  if (k === "order_accepted" || k === "accepted") return ORDER_PUSH_EVENTS.ORDER_ACCEPTED;
  if (k === "order_started" || k === "started") return ORDER_PUSH_EVENTS.ORDER_STARTED;
  if (k === "order_completed" || k === "completed") return ORDER_PUSH_EVENTS.ORDER_COMPLETED;
  if (k === "order_cancelled" || k === "cancelled" || k === "canceled") return ORDER_PUSH_EVENTS.ORDER_CANCELLED;
  // Companion soft-exit on multi child — reuse cancelled push channel for inbox delivery.
  if (k === "order_companion_unavailable" || k === "companion_unavailable" || k === "order_rejected") {
    return ORDER_PUSH_EVENTS.ORDER_CANCELLED;
  }
  return "";
}
