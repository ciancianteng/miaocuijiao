/**
 * Boss loyalty points (phase 1).
 * Independent from wallets (猫粮) and companion popularity points.
 *
 * awardPoints is idempotent via idempotency_key (UNIQUE on user_points_ledger).
 */
import {
  hasWalletDb,
  isMissingRelation,
  rpcUrl,
  serviceHeaders,
  supabaseJson,
  restUrl,
} from "./_wallet.js";

/** Fixed phase-1 rule: +100 on order completion. */
export const ORDER_COMPLETION_POINTS = 100;

export function orderPointsIdempotencyKey(orderId) {
  return `order_points:${String(orderId || "").trim()}`;
}

export function hasPointsDb() {
  return hasWalletDb();
}

function asInt(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

/**
 * Award points to a user once per idempotency_key.
 *
 * @param {object} params
 * @param {string} params.user_id
 * @param {number} params.points
 * @param {string} [params.reason]
 * @param {string} [params.source]
 * @param {string|null} [params.related_order_id]
 * @param {string} params.idempotency_key
 * @param {string|null} [params.operator_id]
 */
export async function awardPoints(params = {}) {
  const userId = String(params.user_id || params.userId || "").trim();
  const points = asInt(params.points, 0);
  const reason = String(params.reason || "");
  const source = String(params.source || "");
  const relatedOrderId = params.related_order_id || params.relatedOrderId || null;
  const idempotencyKey = String(params.idempotency_key || params.idempotencyKey || "").trim();
  const operatorId = params.operator_id || params.operatorId || null;

  if (!userId) {
    return { ok: false, error: "user_id_required" };
  }
  if (points <= 0) {
    return { ok: false, error: "invalid_points" };
  }
  if (!idempotencyKey) {
    return { ok: false, error: "idempotency_key_required" };
  }
  if (!hasPointsDb()) {
    return { ok: false, skipped: true, error: "points_db_unavailable" };
  }

  // 1) Fast path: idempotency_key already exists → do not credit again.
  try {
    const existing = await supabaseJson(
      restUrl(
        "user_points_ledger",
        `?idempotency_key=eq.${encodeURIComponent(idempotencyKey)}&limit=1`
      ),
      { headers: serviceHeaders() }
    );
    if (Array.isArray(existing) && existing[0]) {
      return {
        ok: true,
        duplicate: true,
        ledger_id: existing[0].id,
        user_id: existing[0].user_id,
        delta: asInt(existing[0].delta),
        balance_after: asInt(existing[0].balance_after),
        idempotency_key: existing[0].idempotency_key,
      };
    }
  } catch (error) {
    if (isMissingRelation(error)) {
      return { ok: false, skipped: true, error: "points_tables_missing" };
    }
    // Continue to RPC / write path for transient read issues.
  }

  // 2) Atomic credit via RPC (account lock + ledger insert).
  try {
    const result = await supabaseJson(rpcUrl("mcj_award_user_points"), {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify({
        p_user_id: userId,
        p_points: points,
        p_reason: reason,
        p_source: source,
        p_related_order_id: relatedOrderId || null,
        p_idempotency_key: idempotencyKey,
        p_operator_id: operatorId || null,
      }),
    });
    if (result && typeof result === "object") {
      return {
        ok: result.ok !== false,
        duplicate: !!result.duplicate,
        ledger_id: result.ledger_id || null,
        user_id: result.user_id || userId,
        delta: asInt(result.delta, points),
        balance_after: asInt(result.balance_after),
        idempotency_key: result.idempotency_key || idempotencyKey,
        error: result.error || undefined,
      };
    }
    return { ok: false, error: "empty_rpc_result" };
  } catch (error) {
    if (isMissingRelation(error)) {
      return { ok: false, skipped: true, error: "points_rpc_missing" };
    }
    // 3) Fallback REST path when RPC is unavailable but tables exist.
    return awardPointsRestFallback({
      userId,
      points,
      reason,
      source,
      relatedOrderId,
      idempotencyKey,
      operatorId,
      error,
    });
  }
}

async function awardPointsRestFallback({
  userId,
  points,
  reason,
  source,
  relatedOrderId,
  idempotencyKey,
  operatorId,
  error: rpcError,
}) {
  try {
    const again = await supabaseJson(
      restUrl(
        "user_points_ledger",
        `?idempotency_key=eq.${encodeURIComponent(idempotencyKey)}&limit=1`
      ),
      { headers: serviceHeaders() }
    );
    if (Array.isArray(again) && again[0]) {
      return {
        ok: true,
        duplicate: true,
        ledger_id: again[0].id,
        user_id: again[0].user_id,
        delta: asInt(again[0].delta),
        balance_after: asInt(again[0].balance_after),
        idempotency_key: again[0].idempotency_key,
      };
    }

    let account = (
      await supabaseJson(
        restUrl("user_points_accounts", `?user_id=eq.${encodeURIComponent(userId)}&limit=1`),
        { headers: serviceHeaders() }
      )
    )?.[0];

    if (!account) {
      const created = await supabaseJson(restUrl("user_points_accounts"), {
        method: "POST",
        headers: serviceHeaders({ Prefer: "resolution=merge-duplicates,return=representation" }),
        body: JSON.stringify({
          user_id: userId,
          balance: 0,
          lifetime_earned: 0,
          lifetime_spent: 0,
        }),
      });
      account = Array.isArray(created) ? created[0] : created;
      if (!account) {
        account = (
          await supabaseJson(
            restUrl("user_points_accounts", `?user_id=eq.${encodeURIComponent(userId)}&limit=1`),
            { headers: serviceHeaders() }
          )
        )?.[0];
      }
    }

    const prevBalance = asInt(account?.balance, 0);
    const prevEarned = asInt(account?.lifetime_earned, 0);
    const balanceAfter = prevBalance + points;

    await supabaseJson(
      restUrl("user_points_accounts", `?user_id=eq.${encodeURIComponent(userId)}`),
      {
        method: "PATCH",
        headers: serviceHeaders(),
        body: JSON.stringify({
          balance: balanceAfter,
          lifetime_earned: prevEarned + points,
          updated_at: new Date().toISOString(),
        }),
      }
    );

    try {
      const ledgerRows = await supabaseJson(restUrl("user_points_ledger"), {
        method: "POST",
        headers: serviceHeaders(),
        body: JSON.stringify({
          user_id: userId,
          delta: points,
          balance_after: balanceAfter,
          reason,
          source,
          related_order_id: relatedOrderId || null,
          idempotency_key: idempotencyKey,
          operator_id: operatorId || null,
        }),
      });
      const row = Array.isArray(ledgerRows) ? ledgerRows[0] : ledgerRows;
      return {
        ok: true,
        duplicate: false,
        ledger_id: row?.id || null,
        user_id: userId,
        delta: points,
        balance_after: balanceAfter,
        idempotency_key: idempotencyKey,
      };
    } catch (insertErr) {
      // Unique violation → concurrent award already committed; do not double-count further.
      const dup = await supabaseJson(
        restUrl(
          "user_points_ledger",
          `?idempotency_key=eq.${encodeURIComponent(idempotencyKey)}&limit=1`
        ),
        { headers: serviceHeaders() }
      ).catch(() => []);
      if (Array.isArray(dup) && dup[0]) {
        return {
          ok: true,
          duplicate: true,
          ledger_id: dup[0].id,
          user_id: dup[0].user_id,
          delta: asInt(dup[0].delta),
          balance_after: asInt(dup[0].balance_after),
          idempotency_key: dup[0].idempotency_key,
        };
      }
      throw insertErr;
    }
  } catch (fallbackErr) {
    if (isMissingRelation(fallbackErr)) {
      return { ok: false, skipped: true, error: "points_tables_missing" };
    }
    return {
      ok: false,
      error: fallbackErr?.message || rpcError?.message || "award_points_failed",
    };
  }
}

/**
 * Phase-1 helper: +100 Boss points when an order reaches completed.
 * Idempotency key: order_points:{order_id}
 */
export async function awardBossPointsForCompletedOrder(order, { method = "boss_manual", operatorId = null } = {}) {
  const orderId = order?.id;
  const bossId = order?.boss_id;
  if (!orderId || !bossId) {
    return { ok: false, skipped: true, error: "missing_order_or_boss" };
  }

  const source =
    method === "system_auto_24h"
      ? "order_complete_auto"
      : method === "admin_force"
        ? "order_complete_admin"
        : "order_complete_boss";

  return awardPoints({
    user_id: bossId,
    points: ORDER_COMPLETION_POINTS,
    reason: "订单完成奖励",
    source,
    related_order_id: orderId,
    idempotency_key: orderPointsIdempotencyKey(orderId),
    operator_id: operatorId || null,
  });
}

/** Read helpers for Boss portal / tests. Always scope by authenticated user_id server-side. */
export async function getUserPointsAccount(userId) {
  if (!userId || !hasPointsDb()) return null;
  try {
    const rows = await supabaseJson(
      restUrl("user_points_accounts", `?user_id=eq.${encodeURIComponent(userId)}&limit=1`),
      { headers: serviceHeaders() }
    );
    return Array.isArray(rows) ? rows[0] || null : null;
  } catch (error) {
    if (isMissingRelation(error)) return null;
    throw error;
  }
}

/**
 * Ensure a points account row exists for any Boss (existing or newly registered).
 * Safe no-op if already present. Never awards points — only creates balance=0.
 */
export async function ensureUserPointsAccount(userId) {
  if (!userId || !hasPointsDb()) return null;
  try {
    const existing = await getUserPointsAccount(userId);
    if (existing) return existing;
    const created = await supabaseJson(restUrl("user_points_accounts"), {
      method: "POST",
      headers: serviceHeaders({ Prefer: "resolution=merge-duplicates,return=representation" }),
      body: JSON.stringify({
        user_id: userId,
        balance: 0,
        lifetime_earned: 0,
        lifetime_spent: 0,
      }),
    });
    const row = Array.isArray(created) ? created[0] : created;
    if (row?.user_id) return row;
    return getUserPointsAccount(userId);
  } catch (error) {
    if (isMissingRelation(error)) return null;
    // Concurrent first-visit create: re-read.
    try {
      return await getUserPointsAccount(userId);
    } catch {
      throw error;
    }
  }
}

/** Empty account shape when Boss has never earned points (tables may be empty). */
export function emptyPointsAccountView(userId = "") {
  return {
    userId: userId || "",
    balance: 0,
    lifetimeEarned: 0,
    lifetimeSpent: 0,
    updatedAt: "",
  };
}

export function viewPointsAccount(row, userId = "") {
  if (!row) return emptyPointsAccountView(userId);
  return {
    userId: row.user_id || userId || "",
    balance: asInt(row.balance, 0),
    lifetimeEarned: asInt(row.lifetime_earned, 0),
    lifetimeSpent: asInt(row.lifetime_spent, 0),
    updatedAt: row.updated_at || "",
  };
}

export async function listUserPointsLedger(userId, { limit = 50 } = {}) {
  if (!userId || !hasPointsDb()) return [];
  const lim = Math.min(200, Math.max(1, asInt(limit, 50)));
  try {
    const rows = await supabaseJson(
      restUrl(
        "user_points_ledger",
        `?user_id=eq.${encodeURIComponent(userId)}&order=created_at.desc&limit=${lim}`
      ),
      { headers: serviceHeaders() }
    );
    return Array.isArray(rows) ? rows : [];
  } catch (error) {
    if (isMissingRelation(error)) return [];
    throw error;
  }
}

function sourceLabel(source) {
  const s = String(source || "");
  if (s === "order_complete_boss") return "订单完成（老板确认）";
  if (s === "order_complete_auto") return "订单完成（系统自动）";
  if (s === "order_complete_admin") return "订单完成（后台）";
  if (/order_complete/i.test(s)) return "订单完成奖励";
  return s || "积分变动";
}

export function viewPointsLedgerRow(row) {
  const delta = asInt(row?.delta, 0);
  return {
    id: row?.id || "",
    createdAt: row?.created_at || "",
    delta,
    deltaText: delta > 0 ? `+${delta}` : String(delta),
    balanceAfter: asInt(row?.balance_after, 0),
    reason: row?.reason || sourceLabel(row?.source),
    source: row?.source || "",
    sourceLabel: sourceLabel(row?.source),
    relatedOrderId: row?.related_order_id || "",
    idempotencyKey: row?.idempotency_key || "",
    // Ledger rows are append-only credits already committed.
    status: "posted",
    statusText: "已入账",
  };
}

export async function getPointsLedgerByIdempotencyKey(key) {
  if (!key || !hasPointsDb()) return null;
  try {
    const rows = await supabaseJson(
      restUrl("user_points_ledger", `?idempotency_key=eq.${encodeURIComponent(key)}&limit=1`),
      { headers: serviceHeaders() }
    );
    return Array.isArray(rows) ? rows[0] || null : null;
  } catch (error) {
    if (isMissingRelation(error)) return null;
    throw error;
  }
}
