import fs from "node:fs";
import path from "node:path";

loadLocalEnv();

function loadLocalEnv() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const rawLine of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (key && value && !process.env[key]) process.env[key] = value;
  }
}

export function envValue(key) {
  if (key === "SUPABASE_URL") return process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  if (key === "SUPABASE_ANON_KEY") return process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
  return process.env[key] || "";
}

export function hasWalletDb() {
  return ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"].every((key) => envValue(key));
}

export function serviceHeaders(extra = {}) {
  const key = envValue("SUPABASE_SERVICE_ROLE_KEY");
  const base = { apikey: key, "Content-Type": "application/json", "User-Agent": "MCJ-Server/1.0", Prefer: "return=representation", ...extra };
  if (!key.startsWith("sb_secret_")) base.Authorization = `Bearer ${key}`;
  return base;
}

export function restUrl(table, query = "") {
  return `${envValue("SUPABASE_URL")}/rest/v1/${table}${query}`;
}

export function rpcUrl(fn) {
  return `${envValue("SUPABASE_URL")}/rest/v1/rpc/${fn}`;
}

export async function supabaseJson(url, init = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) {
    const message =
      body?.message || body?.hint || body?.details || body?.error_description || (typeof body === "string" ? body : "") || "Supabase 请求失败";
    const error = new Error(message);
    error.status = response.status;
    error.body = body;
    throw error;
  }
  return body;
}

export function isMissingRelation(error) {
  // Do NOT treat application 404 (e.g. "账号不存在") as missing DDL —
  // that masked real BCR bind errors as "表未初始化".
  const text = `${error?.message || ""} ${JSON.stringify(error?.body || "")} ${error?.code || ""}`;
  if (error?.code === "PGRST205" || /PGRST205/i.test(text)) return true;
  if (/Could not find the table|relation ["'].+["'] does not exist|schema cache/i.test(text)) return true;
  // Column-missing is NOT table-missing (migration partial) — leave to callers.
  return false;
}

export function money(value) {
  const n = Number(String(value ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function nowIso() {
  return new Date().toISOString();
}

export function emptyWallet(bossId = "") {
  return {
    boss_id: bossId,
    paid_balance: 0,
    bonus_balance: 0,
    total_balance: 0,
    frozen: false,
    total_paid_in: 0,
    total_bonus_in: 0,
    total_spent: 0,
    total_compensation: 0,
    total_recharge_rm: 0,
  };
}

export function viewWallet(row = {}, bossId = "") {
  const w = row || emptyWallet(bossId);
  return {
    bossId: w.boss_id || bossId,
    paidBalance: money(w.paid_balance),
    bonusBalance: money(w.bonus_balance),
    totalBalance: money(w.total_balance),
    frozen: !!w.frozen,
    totalPaidIn: money(w.total_paid_in),
    totalBonusIn: money(w.total_bonus_in),
    totalSpent: money(w.total_spent),
    totalCompensation: money(w.total_compensation),
    totalRechargeRm: money(w.total_recharge_rm),
    updatedAt: w.updated_at || "",
  };
}

export function viewTx(row = {}) {
  return {
    id: row.id,
    bossId: row.boss_id,
    type: row.transaction_type,
    typeText: txTypeText(row.transaction_type),
    amount: money(row.amount),
    balanceType: row.balance_type,
    balanceTypeText: row.balance_type === "paid" ? "充值猫粮" : "赠送猫粮",
    direction: row.direction,
    signedAmount: row.direction === "debit" ? -money(row.amount) : money(row.amount),
    relatedOrderId: row.related_order_id || "",
    relatedRechargeId: row.related_recharge_id || "",
    campaignId: row.campaign_id || "",
    compensationId: row.compensation_id || "",
    reason: row.reason || "",
    internalNote: row.internal_note || "",
    operatorId: row.operator_id || "",
    paidAfter: money(row.paid_balance_after),
    bonusAfter: money(row.bonus_balance_after),
    totalAfter: money(row.total_balance_after),
    expiresAt: row.expires_at || "",
    createdAt: row.created_at || "",
  };
}

export function txTypeText(type) {
  return (
    {
      recharge: "充值到账",
      recharge_bonus: "充值活动赠送",
      platform_compensation: "平台售后补偿",
      activity_reward: "活动奖励",
      invite_reward: "邀请奖励",
      order_payment: "订单消费",
      refund: "订单退款",
      admin_adjustment: "人工调整",
      admin_deduct: "人工扣减",
      bonus_expired: "赠送过期",
    }[type] || type || "-"
  );
}

export async function getWallet(bossId) {
  try {
    const rows = await supabaseJson(restUrl("wallets", `?boss_id=eq.${encodeURIComponent(bossId)}&limit=1`), {
      headers: serviceHeaders(),
    });
    if (Array.isArray(rows) && rows[0]) return rows[0];
    await supabaseJson(rpcUrl("mcj_ensure_wallet"), {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify({ p_boss_id: bossId }),
    });
    const again = await supabaseJson(restUrl("wallets", `?boss_id=eq.${encodeURIComponent(bossId)}&limit=1`), {
      headers: serviceHeaders(),
    });
    return Array.isArray(again) ? again[0] : emptyWallet(bossId);
  } catch (error) {
    if (isMissingRelation(error)) return emptyWallet(bossId);
    throw error;
  }
}

export async function listWalletTx(bossId, limit = 100) {
  try {
    const rows = await supabaseJson(
      restUrl("wallet_transactions", `?boss_id=eq.${encodeURIComponent(bossId)}&order=created_at.desc&limit=${limit}`),
      { headers: serviceHeaders() }
    );
    return Array.isArray(rows) ? rows : [];
  } catch (error) {
    if (isMissingRelation(error)) return [];
    throw error;
  }
}

export async function creditWallet(params) {
  const body = {
    p_boss_id: params.bossId,
    p_transaction_type: params.transactionType,
    p_amount: money(params.amount),
    p_balance_type: params.balanceType || "bonus",
    p_idempotency_key: params.idempotencyKey,
    p_reason: params.reason || "",
    p_internal_note: params.internalNote || "",
    p_operator_id: params.operatorId || null,
    p_related_order_id: params.relatedOrderId || null,
    p_related_recharge_id: params.relatedRechargeId || null,
    p_campaign_id: params.campaignId || null,
    p_compensation_id: params.compensationId || null,
    p_expires_at: params.expiresAt || null,
    p_recharge_rm: money(params.rechargeRm || 0),
  };
  return supabaseJson(rpcUrl("mcj_wallet_credit"), {
    method: "POST",
    headers: serviceHeaders(),
    body: JSON.stringify(body),
  });
}

export async function debitWallet(params) {
  const body = {
    p_boss_id: params.bossId,
    p_transaction_type: params.transactionType || "order_payment",
    p_amount: money(params.amount),
    p_idempotency_key: params.idempotencyKey,
    p_reason: params.reason || "",
    p_internal_note: params.internalNote || "",
    p_operator_id: params.operatorId || null,
    p_related_order_id: params.relatedOrderId || null,
    p_prefer_balance_type: params.preferBalanceType || null,
  };
  return supabaseJson(rpcUrl("mcj_wallet_debit"), {
    method: "POST",
    headers: serviceHeaders(),
    body: JSON.stringify(body),
  });
}

export async function creditRechargePayment(paymentNo, providerTradeNo = "", idempotencyKey = null) {
  return supabaseJson(rpcUrl("mcj_wallet_credit_recharge"), {
    method: "POST",
    headers: serviceHeaders(),
    body: JSON.stringify({
      p_payment_no: paymentNo,
      p_provider_trade_no: providerTradeNo || "",
      p_idempotency_key: idempotencyKey,
    }),
  });
}

export async function writeAdminLog({ module, action, targetType, targetId, operatorId, operatorRole, reason, before, after }) {
  try {
    await supabaseJson(restUrl("admin_operation_logs"), {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify({
        module: module || "wallet",
        action: action || "",
        target_type: targetType || "",
        target_id: String(targetId || ""),
        operator_id: operatorId || null,
        operator_role: operatorRole || "admin",
        reason: reason || "",
        before_value: before ? JSON.stringify(before) : "",
        after_value: after ? JSON.stringify(after) : "",
        created_at: nowIso(),
      }),
    });
  } catch {
    /* log table may be missing */
  }
}

export async function notifyBoss(bossId, title, body, kind = "wallet", relatedId = "") {
  try {
    await supabaseJson(restUrl("boss_notifications"), {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify({
        boss_id: bossId,
        title,
        body,
        kind,
        related_id: String(relatedId || ""),
        created_at: nowIso(),
      }),
    });
  } catch {
    /* optional */
  }
}

export function viewCampaign(row = {}) {
  const base = money(row.base_cat_food);
  const bonus = money(row.bonus_cat_food);
  return {
    id: row.id,
    name: row.name || "",
    payAmountRm: money(row.pay_amount_rm),
    baseCatFood: base,
    bonusCatFood: bonus,
    totalCatFood: money(row.total_cat_food) || base + bonus,
    startsAt: row.starts_at || "",
    endsAt: row.ends_at || "",
    perBossLimit: Number(row.per_boss_limit || 0),
    firstRechargeOnly: !!row.first_recharge_only,
    enabled: row.enabled !== false,
    sortOrder: Number(row.sort_order || 100),
    description: row.description || "",
    createdAt: row.created_at || "",
    updatedAt: row.updated_at || "",
  };
}

export async function listCampaigns({ enabledOnly = false } = {}) {
  try {
    let query = "?order=sort_order.asc,pay_amount_rm.asc&limit=200";
    if (enabledOnly) query = `?enabled=eq.true&order=sort_order.asc,pay_amount_rm.asc&limit=200`;
    const rows = await supabaseJson(restUrl("recharge_campaigns", query), { headers: serviceHeaders() });
    return Array.isArray(rows) ? rows.map(viewCampaign) : [];
  } catch (error) {
    if (isMissingRelation(error)) return [];
    throw error;
  }
}

export async function getWalletSettings() {
  try {
    const rows = await supabaseJson(restUrl("wallet_settings", "?id=eq.1&limit=1"), { headers: serviceHeaders() });
    return (
      (Array.isArray(rows) && rows[0]) || {
        debit_order: "expiring_bonus,bonus,paid",
        bonus_can_withdraw: false,
        cs_max_per_request: 100,
        cs_max_per_day: 300,
        allow_cs_apply: true,
      }
    );
  } catch (error) {
    if (isMissingRelation(error)) {
      return {
        debit_order: "expiring_bonus,bonus,paid",
        bonus_can_withdraw: false,
        cs_max_per_request: 100,
        cs_max_per_day: 300,
        allow_cs_apply: true,
      };
    }
    throw error;
  }
}
