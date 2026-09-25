/**
 * Canonical business-order stats SoT (homepage + admin dashboard).
 *
 * Completed business order = status completed|reviewed AND parent/standalone root
 * (parent_order_id IS NULL). Multi children never inflate completed count or GMV.
 *
 * Payment / review records alone NEVER count as completed orders.
 */
import { isMultiGroupChild } from "./_order-group.js";

export const COMPLETED_BUSINESS_STATUSES = new Set(["completed", "reviewed"]);

export function canonicalBusinessOrderId(order = {}) {
  const parent = String(order.parent_order_id || order.parentOrderId || "").trim();
  if (parent) return parent;
  return String(order.id || order.orderId || "").trim();
}

/** Parent / standalone business order — never a multi-group child allocation row. */
export function isBusinessOrderRoot(order = {}) {
  if (!order || typeof order !== "object") return false;
  if (isMultiGroupChild(order)) return false;
  if (order.parent_order_id || order.parentOrderId) return false;
  const t = String(order.order_type || order.orderType || "").toLowerCase();
  if (t === "multi_group_child" || t === "child") return false;
  return true;
}

export function isRealCompletedOrder(order = {}) {
  const st = String(order.status || order.orderStatus || "")
    .trim()
    .toLowerCase();
  return COMPLETED_BUSINESS_STATUSES.has(st);
}

/**
 * Homepage / Admin「完成订单」：真正完成的业务根单。
 * 不含 cancelled / pending / payment-only / child allocation。
 */
export function isRealCompletedBusinessOrder(order = {}) {
  return isBusinessOrderRoot(order) && isRealCompletedOrder(order);
}

export function listCompletedBusinessOrders(orders = []) {
  return (orders || []).filter((o) => isRealCompletedBusinessOrder(o));
}

export function countCompletedBusinessOrders(orders = []) {
  return listCompletedBusinessOrders(orders).length;
}

/**
 * Guard: orders payload must retain parent_order_id so children are skippable.
 * Returns { ok, missingParentField, childLikeWithoutParent }.
 */
export function assertOrdersCarryParentField(orders = []) {
  const list = Array.isArray(orders) ? orders : [];
  if (!list.length) return { ok: true, missingParentField: false, sampleSize: 0 };
  const missingParentField = !list.some((o) =>
    Object.prototype.hasOwnProperty.call(o, "parent_order_id") ||
    Object.prototype.hasOwnProperty.call(o, "parentOrderId")
  );
  return {
    ok: !missingParentField,
    missingParentField,
    sampleSize: list.length,
  };
}
