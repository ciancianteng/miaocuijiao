/**
 * Boss loyalty points (积分) — Supabase-backed, no mock balances.
 * Rate: 1 paid 猫粮 (≈ RM1) → 10 points, from order paid amount only.
 */
import {
  envValue,
  isMissingRelation,
  money,
  nowIso,
  restUrl,
  rpcUrl,
  serviceHeaders,
  supabaseJson,
  writeAdminLog,
} from "./_wallet.js";

/** Points per 1 unit of paid order amount (猫粮 / ≈ RM). */
export const POINTS_PER_PAID_UNIT = 10;

export function hasPointsDb() {
  return ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"].every((key) => envValue(key));
}

export function emptyPoints(userId = "") {
  return {
    user_id: userId,
    total_points: 0,
    created_at: "",
    updated_at: "",
  };
}

export function viewPoints(row = {}, userId = "") {
  const r = row || emptyPoints(userId);
  return {
    userId: r.user_id || userId,
    totalPoints: money(r.total_points),
    createdAt: r.created_at || "",
    updatedAt: r.updated_at || "",
  };
}

export function pointsTypeText(type) {
  return (
    {
      earn: "订单完成获得",
      redeem: "积分兑换",
      admin_adjust: "后台调整",
    }[String(type || "").toLowerCase()] ||
    type ||
    "-"
  );
}

export function viewPointTx(row = {}) {
  const pts = money(row.points);
  return {
    id: row.id,
    userId: row.user_id,
    orderId: row.order_id || "",
    points: pts,
    signedPoints: pts,
    type: row.type || "",
    typeText: pointsTypeText(row.type),
    description: row.description || "",
    operatorId: row.operator_id || "",
    balanceAfter: money(row.balance_after),
    createdAt: row.created_at || "",
  };
}

/** Actual paid amount for points: paid_cat_food → total_amount (猫粮 ≈ RM). */
export function orderPaidAmountForPoints(order = {}) {
  const paid = money(order.paid_cat_food ?? order.paidCatFood);
  if (paid > 0) return paid;
  return money(order.total_amount ?? order.totalAmount ?? order.amount);
}

export function pointsFromPaidAmount(paidAmount) {
  const paid = money(paidAmount);
  if (paid <= 0) return 0;
  return Math.round(paid * POINTS_PER_PAID_UNIT * 100) / 100;
}

export async function getUserPoints(userId) {
  try {
    const rows = await supabaseJson(
      restUrl("user_points", `?user_id=eq.${encodeURIComponent(userId)}&limit=1`),
      { headers: serviceHeaders() }
    );
    if (Array.isArray(rows) && rows[0]) return rows[0];
    return emptyPoints(userId);
  } catch (error) {
    if (isMissingRelation(error)) return emptyPoints(userId);
    throw error;
  }
}

export async function ensureUserPoints(userId) {
  const existing = await getUserPoints(userId);
  if (existing && existing.user_id && Number(existing.total_points) >= 0 && existing.created_at) {
    return existing;
  }
  try {
    const rows = await supabaseJson(restUrl("user_points"), {
      method: "POST",
      headers: serviceHeaders({ Prefer: "resolution=merge-duplicates,return=representation" }),
      body: JSON.stringify({
        user_id: userId,
        total_points: 0,
        created_at: nowIso(),
        updated_at: nowIso(),
      }),
    });
    return (Array.isArray(rows) && rows[0]) || emptyPoints(userId);
  } catch (error) {
    if (isMissingRelation(error)) return emptyPoints(userId);
    // conflict → re-read
    return getUserPoints(userId);
  }
}

export async function listPointTransactions(userId, { limit = 100, type = "" } = {}) {
  try {
    let query = `?user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&limit=${Math.max(1, Math.min(500, Number(limit) || 100))}`;
    if (type) query = `?user_id=eq.${encodeURIComponent(userId)}&type=eq.${encodeURIComponent(type)}&order=created_at.desc&limit=${Math.max(1, Math.min(500, Number(limit) || 100))}`;
    const rows = await supabaseJson(restUrl("point_transactions", query), { headers: serviceHeaders() });
    return Array.isArray(rows) ? rows : [];
  } catch (error) {
    if (isMissingRelation(error)) return [];
    throw error;
  }
}

export async function findEarnByOrderId(orderId) {
  if (!orderId) return null;
  try {
    const rows = await supabaseJson(
      restUrl(
        "point_transactions",
        `?order_id=eq.${encodeURIComponent(orderId)}&type=eq.earn&limit=1`
      ),
      { headers: serviceHeaders() }
    );
    return Array.isArray(rows) && rows[0] ? rows[0] : null;
  } catch (error) {
    if (isMissingRelation(error)) return null;
    throw error;
  }
}

async function applyPointsRpc({ userId, points, type, orderId = null, description = "", operatorId = null }) {
  return supabaseJson(rpcUrl("mcj_apply_points"), {
    method: "POST",
    headers: serviceHeaders(),
    body: JSON.stringify({
      p_user_id: userId,
      p_points: money(points),
      p_type: type,
      p_order_id: orderId || null,
      p_description: description || "",
      p_operator_id: operatorId || null,
    }),
  });
}

/**
 * Fallback when RPC missing: REST insert + update with unique-index idempotency.
 */
async function applyPointsRest({ userId, points, type, orderId = null, description = "", operatorId = null }) {
  const delta = money(points);
  if (!userId) throw Object.assign(new Error("user_id required"), { status: 400 });
  if (!delta) throw Object.assign(new Error("points delta must be non-zero"), { status: 400 });

  if (type === "earn" && orderId) {
    const existing = await findEarnByOrderId(orderId);
    if (existing) {
      const bal = await getUserPoints(userId);
      return {
        ok: true,
        duplicate: true,
        message: "该订单已发放过积分",
        total_points: money(bal.total_points),
        transaction_id: existing.id,
      };
    }
  }

  await ensureUserPoints(userId);
  const before = await getUserPoints(userId);
  const next = Math.round((money(before.total_points) + delta) * 100) / 100;
  if (next < 0) throw Object.assign(new Error("积分不足，无法扣减"), { status: 400 });

  let tx;
  try {
    const rows = await supabaseJson(restUrl("point_transactions"), {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify({
        user_id: userId,
        order_id: orderId || null,
        points: delta,
        type,
        description: description || "",
        operator_id: operatorId || null,
        balance_after: next,
        created_at: nowIso(),
      }),
    });
    tx = Array.isArray(rows) ? rows[0] : rows;
  } catch (error) {
    const msg = String(error?.message || error || "");
    if (/duplicate|unique|uniq_point/i.test(msg) && type === "earn") {
      const bal = await getUserPoints(userId);
      return { ok: true, duplicate: true, message: "该订单已发放过积分", total_points: money(bal.total_points) };
    }
    throw error;
  }

  await supabaseJson(restUrl("user_points", `?user_id=eq.${encodeURIComponent(userId)}`), {
    method: "PATCH",
    headers: serviceHeaders(),
    body: JSON.stringify({ total_points: next, updated_at: nowIso() }),
  });

  return {
    ok: true,
    duplicate: false,
    transaction_id: tx?.id,
    points: delta,
    type,
    total_points: next,
    order_id: orderId || null,
  };
}

export async function applyPoints(params) {
  try {
    const result = await applyPointsRpc(params);
    if (result && typeof result === "object") return result;
    return { ok: true, ...(result || {}) };
  } catch (error) {
    if (isMissingRelation(error) || /function .* does not exist|PGRST202|mcj_apply_points/i.test(String(error?.message || ""))) {
      return applyPointsRest(params);
    }
    throw error;
  }
}

/**
 * Credit points when an order reaches completed. Idempotent per order_id.
 */
export async function earnPointsForCompletedOrder(order = {}) {
  const userId = String(order.boss_id || order.bossId || order.user_id || order.userId || "").trim();
  const orderId = String(order.id || order.order_id || "").trim();
  if (!userId || !orderId) {
    return { ok: false, skipped: true, message: "缺少老板或订单 ID，跳过积分。" };
  }
  if (String(order.status || "") !== "completed") {
    return { ok: false, skipped: true, message: "订单未完成，不发放积分。" };
  }

  const paid = orderPaidAmountForPoints(order);
  const pts = pointsFromPaidAmount(paid);
  if (pts <= 0) {
    return { ok: true, skipped: true, message: "实付金额为 0，不发放积分。", paidAmount: paid, points: 0 };
  }

  const existing = await findEarnByOrderId(orderId);
  if (existing) {
    const bal = await getUserPoints(userId);
    return {
      ok: true,
      duplicate: true,
      message: "该订单已发放过积分",
      paidAmount: paid,
      points: money(existing.points),
      totalPoints: money(bal.total_points),
      transactionId: existing.id,
    };
  }

  const description = `订单完成奖励：实付 ${paid}（猫粮/≈RM）× ${POINTS_PER_PAID_UNIT} = ${pts} 积分`;
  const result = await applyPoints({
    userId,
    points: pts,
    type: "earn",
    orderId,
    description,
    operatorId: null,
  });

  return {
    ok: !!result?.ok,
    duplicate: !!result?.duplicate,
    message: result?.message || (result?.duplicate ? "该订单已发放过积分" : "积分已发放"),
    paidAmount: paid,
    points: money(result?.points ?? pts),
    totalPoints: money(result?.total_points),
    transactionId: result?.transaction_id || "",
    orderId,
    userId,
  };
}

export async function adminAdjustPoints({ userId, points, description = "", operatorId = null }) {
  const delta = money(points);
  if (!userId) throw Object.assign(new Error("请指定用户"), { status: 400 });
  if (!delta) throw Object.assign(new Error("调整积分不能为 0"), { status: 400 });

  const result = await applyPoints({
    userId,
    points: delta,
    type: "admin_adjust",
    orderId: null,
    description: description || (delta > 0 ? "后台增加积分" : "后台扣除积分"),
    operatorId,
  });

  try {
    await writeAdminLog({
      module: "points",
      action: delta > 0 ? "points_grant" : "points_deduct",
      targetType: "user",
      targetId: userId,
      operatorId,
      operatorRole: "admin",
      reason: description || "",
      before: null,
      after: result,
    });
  } catch {
    /* ignore */
  }

  return result;
}
