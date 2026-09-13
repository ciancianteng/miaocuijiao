/**
 * Boss-facing order / CS event → boss_notifications inbox + Web Push.
 * Reuses notifyBoss (single fan-out path). Never throws into callers.
 */
import { notifyBoss } from "./_wallet.js";

function orderNo(order) {
  if (!order || typeof order !== "object") return "";
  return String(order.order_no || order.orderNo || order.id || "").trim();
}

function bossIdOf(order) {
  if (!order || typeof order !== "object") return "";
  return String(order.boss_id || order.bossId || "").trim();
}

export async function notifyBossOrderEvent(order, { title, body, kind = "order" } = {}) {
  try {
    const bossId = bossIdOf(order);
    if (!bossId) return false;
    const id = String(order.id || "").trim();
    const no = orderNo(order);
    const safeTitle = String(title || "订单通知").trim() || "订单通知";
    const safeBody =
      String(body || "").trim() ||
      (no ? `订单 ${no} 有新的状态更新。` : "您的订单有新的状态更新。");
    await notifyBoss(bossId, safeTitle, safeBody, kind || "order", id);
    return true;
  } catch (err) {
    console.warn("[boss-order-notify]", String(err && err.message ? err.message : err).slice(0, 160));
    return false;
  }
}

export async function notifyBossCsReply(conversation, { title, body, orderId = "" } = {}) {
  try {
    const bossId = String(
      (conversation && (conversation.boss_id || conversation.bossId || conversation.user_id)) || ""
    ).trim();
    if (!bossId) return false;
    const related = String(orderId || (conversation && (conversation.order_id || conversation.orderId)) || "").trim();
    await notifyBoss(
      bossId,
      String(title || "客服回复").trim() || "客服回复",
      String(body || "客服发来一条重要消息，请及时查看。").trim(),
      "cs_reply",
      related
    );
    return true;
  } catch (err) {
    console.warn("[boss-cs-notify]", String(err && err.message ? err.message : err).slice(0, 160));
    return false;
  }
}
