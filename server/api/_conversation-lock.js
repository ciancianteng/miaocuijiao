/**
 * Conversation lock scope: user + order_id + conversation_id (+ consult_type).
 * Never permanently lock a boss/companion account to a CS.
 */

export const BOSS_CONSULT_TYPES = {
  new_order: "新订单咨询",
  current_order: "当前订单问题",
  recharge: "充值问题",
  refund: "退款售后",
  other: "其他",
};

export const COMPANION_CONSULT_TYPES = {
  order_dock: "订单对接",
  grab_issue: "抢单问题",
  profile_audit: "资料审核",
  deposit_auth: "押金认证",
  withdraw: "提现问题",
  earnings: "收益问题",
  other: "其他",
};

export const TRANSFER_USER_TIP = "正在为你更换客服。";

const BOSS_KEYS = new Set(Object.keys(BOSS_CONSULT_TYPES));
const COMPANION_KEYS = new Set(Object.keys(COMPANION_CONSULT_TYPES));

export function normalizeBossConsultType(raw, { orderId = "" } = {}) {
  const key = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_");
  if (BOSS_KEYS.has(key)) return key;
  if (orderId) return "current_order";
  return "other";
}

export function normalizeCompanionConsultType(raw, { orderId = "" } = {}) {
  const key = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/-/g, "_");
  if (COMPANION_KEYS.has(key)) return key;
  if (orderId) return "order_dock";
  return "other";
}

export function consultTypeLabel(role, key) {
  if (role === "companion") return COMPANION_CONSULT_TYPES[key] || COMPANION_CONSULT_TYPES.other;
  return BOSS_CONSULT_TYPES[key] || BOSS_CONSULT_TYPES.other;
}

export function isClosedConversationStatus(status) {
  const s = String(status || "").toLowerCase();
  return s === "closed" || s === "ended";
}

export function isPendingTransferStatus(status) {
  return String(status || "").toLowerCase() === "pending_transfer";
}

/** Display status: 待接待 → 接待中 → 待转接 → 已结束 */
export function conversationStatusLabel(row = {}) {
  if (isClosedConversationStatus(row.status) || isClosedConversationStatus(row.rawStatus)) return "已结束";
  if (isPendingTransferStatus(row.status) || isPendingTransferStatus(row.rawStatus)) return "待转接";
  if (row.customer_service_id || row.currentServiceId) return "接待中";
  return "待接待";
}

/** Lock only when another CS owns a non-closed, non-transfer conversation. */
export function conversationLockedByOther(conversation, serviceProfileId) {
  const ownerId = String(conversation?.customer_service_id || conversation?.currentServiceId || "").trim();
  const viewerId = String(serviceProfileId || "").trim();
  if (isClosedConversationStatus(conversation?.status) || isClosedConversationStatus(conversation?.rawStatus)) {
    return false;
  }
  if (isPendingTransferStatus(conversation?.status) || isPendingTransferStatus(conversation?.rawStatus)) {
    return false;
  }
  return !!ownerId && !!viewerId && ownerId !== viewerId;
}

export function sameOrderId(a, b) {
  const left = String(a || "").trim();
  const right = String(b || "").trim();
  if (!left && !right) return true;
  return left === right;
}

export function companionProactiveTitle({ nickname, companionCode, companionId, orderNo, orderId }) {
  const name = String(nickname || "").trim() || "陪玩";
  const code = String(companionCode || companionId || "").trim() || "-";
  const order = String(orderNo || orderId || "").trim() || "-";
  return `${name} · ${code} · 订单 ${order}`;
}
