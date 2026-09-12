import "../_load-env.js";
import { requireAdmin } from "../_admin-auth.js";

const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"];
const ADMIN_KEEP = new Set(["admin", "super_admin"]);
const CONFIRM_TEXT = "PURGE_TEST_DATA";

function json(res, status, data) {
  return res.status(status).json(data);
}
function hasDb() {
  return REQUIRED_ENV.every((key) => process.env[key]);
}
function restUrl(table, query = "") {
  return `${process.env.SUPABASE_URL}/rest/v1/${table}${query}`;
}
function authUrl(path) {
  return `${process.env.SUPABASE_URL}/auth/v1/${path}`;
}
function serviceHeaders(extra = {}) {
  return {
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
    ...extra,
  };
}
function isMissingTableError(error) {
  return /does not exist|schema cache|PGRST204|PGRST205|relation|Could not find/i.test(String(error?.message || error));
}
async function supabaseJson(url, init = {}) {
  const response = await fetch(url, init);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!response.ok) throw Object.assign(new Error(body?.message || body?.hint || body?.details || "Supabase 请求失败"), { status: response.status, body });
  return body;
}
async function parseBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    return {};
  }
}
function chunk(ids, size = 60) {
  const list = [...new Set((ids || []).filter(Boolean))];
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
function inQuery(column, ids) {
  const list = [...new Set((ids || []).filter(Boolean))];
  if (!list.length) return "";
  return `${column}=in.(${list.map(encodeURIComponent).join(",")})`;
}
async function softDelete(table, query, counts, key) {
  if (!query || !query.includes("=")) return;
  try {
    const rows = await supabaseJson(restUrl(table, query.startsWith("?") ? query : `?${query}`), {
      method: "DELETE",
      headers: serviceHeaders({ Prefer: "return=representation" }),
    });
    counts[key] = (counts[key] || 0) + (Array.isArray(rows) ? rows.length : 0);
  } catch (error) {
    if (isMissingTableError(error)) {
      counts[key] = counts[key] || 0;
      return;
    }
    // Soft-fail FK / constraint races; later retries or parent tables may clear deps
    if (/foreign key|violates|23503/i.test(String(error.message || ""))) {
      counts[`${key}_fk_skip`] = (counts[`${key}_fk_skip`] || 0) + 1;
      return;
    }
    throw error;
  }
}
async function softDeleteInBatches(table, column, ids, counts, key) {
  for (const part of chunk(ids)) {
    await softDelete(table, `?${inQuery(column, part)}`, counts, key);
  }
}
async function softSelect(table, query) {
  try {
    const rows = await supabaseJson(restUrl(table, query.startsWith("?") ? query : `?${query}`), { headers: serviceHeaders() });
    return Array.isArray(rows) ? rows : [];
  } catch (error) {
    if (isMissingTableError(error)) return [];
    throw error;
  }
}
async function collectIds(table, idColumn, filterQuery) {
  const rows = await softSelect(table, `${filterQuery}&select=${encodeURIComponent(idColumn)}&limit=5000`);
  return rows.map((row) => row[idColumn]).filter(Boolean);
}

async function purgeTestData() {
  const counts = {};
  const allProfiles = await softSelect("profiles", "?select=id,role&limit=5000");
  const purgeIds = allProfiles.filter((row) => !ADMIN_KEEP.has(String(row.role || ""))).map((row) => row.id);
  if (!purgeIds.length) {
    return { ok: true, counts, purgedUsers: 0, message: "没有需要清理的非管理员账号。" };
  }

  const companionRows = await softSelect("companion_profiles", `?${inQuery("user_id", purgeIds)}&select=id,user_id&limit=5000`);
  const companionProfileIds = companionRows.map((row) => row.id).filter(Boolean);

  const orderIdSets = await Promise.all([
    collectIds("orders", "id", `?${inQuery("boss_id", purgeIds)}`),
    collectIds("orders", "id", `?${inQuery("companion_id", purgeIds)}`),
  ]);
  const orderIds = [...new Set(orderIdSets.flat())];

  const convIdSets = await Promise.all([
    collectIds("conversations", "id", `?${inQuery("boss_id", purgeIds)}`),
    collectIds("conversations", "id", `?${inQuery("companion_id", purgeIds)}`),
    collectIds("conversations", "id", `?${inQuery("customer_service_id", purgeIds)}`),
    orderIds.length ? collectIds("conversations", "id", `?${inQuery("order_id", orderIds)}`) : Promise.resolve([]),
  ]);
  const conversationIds = [...new Set(convIdSets.flat())];

  await softDeleteInBatches("messages", "conversation_id", conversationIds, counts, "messages");
  await softDeleteInBatches("conversations", "id", conversationIds, counts, "conversations");
  await softDeleteInBatches("order_grabs", "order_id", orderIds, counts, "order_grabs");
  await softDeleteInBatches("order_grabs", "companion_id", purgeIds, counts, "order_grabs");
  await softDeleteInBatches("companion_reviews", "companion_id", purgeIds, counts, "companion_reviews");
  await softDeleteInBatches("companion_reviews", "boss_id", purgeIds, counts, "companion_reviews");
  await softDeleteInBatches("order_status_logs", "order_id", orderIds, counts, "order_status_logs");
  await softDeleteInBatches("cs_dock_rewards", "order_id", orderIds, counts, "cs_dock_rewards");
  await softDeleteInBatches("transactions", "order_id", orderIds, counts, "transactions");
  await softDeleteInBatches("transactions", "user_id", purgeIds, counts, "transactions_user");
  await softDeleteInBatches("popularity_events", "order_id", orderIds, counts, "popularity_events");
  await softDeleteInBatches("companion_earnings", "order_id", orderIds, counts, "companion_earnings");
  await softDeleteInBatches("companion_earnings", "companion_id", purgeIds, counts, "companion_earnings_user");
  await softDeleteInBatches("service_receptions", "order_id", orderIds, counts, "service_receptions_order");
  await softDeleteInBatches("orders", "id", orderIds, counts, "orders");
  await softDeleteInBatches("companion_media", "companion_profile_id", companionProfileIds, counts, "companion_media");
  await softDeleteInBatches("companion_deposits", "companion_profile_id", companionProfileIds, counts, "companion_deposits");
  await softDeleteInBatches("companion_withdrawals", "companion_id", purgeIds, counts, "companion_withdrawals");
  await softDeleteInBatches("companion_identity_verifications", "companion_profile_id", companionProfileIds, counts, "companion_identity_verifications");
  await softDeleteInBatches("companion_identity_verifications", "user_id", purgeIds, counts, "companion_identity_verifications");
  await softDeleteInBatches("companion_payment_accounts", "companion_profile_id", companionProfileIds, counts, "companion_payment_accounts");
  await softDeleteInBatches("companion_payment_accounts", "user_id", purgeIds, counts, "companion_payment_accounts");
  await softDeleteInBatches("companion_profiles", "user_id", purgeIds, counts, "companion_profiles");
  await softDeleteInBatches("wallets", "boss_id", purgeIds, counts, "wallets");
  await softDeleteInBatches("wallet_transactions", "boss_id", purgeIds, counts, "wallet_transactions");
  await softDeleteInBatches("service_receptions", "customer_service_id", purgeIds, counts, "service_receptions");
  // Keep global commission config row (customer_service_id = "global")
  await softDeleteInBatches("customer_service_reports", "customer_service_id", purgeIds, counts, "customer_service_reports");
  await softDeleteInBatches("boss_notifications", "boss_id", purgeIds, counts, "boss_notifications");
  await softDeleteInBatches("wallets", "user_id", purgeIds, counts, "wallets_user");
  await softDeleteInBatches("wallet_transactions", "user_id", purgeIds, counts, "wallet_tx_user");
  await softDeleteInBatches("compensation_requests", "boss_id", purgeIds, counts, "compensation_requests");
  await softDeleteInBatches("compensation_requests", "customer_service_id", purgeIds, counts, "compensation_requests_cs");
  await softDeleteInBatches("payment_orders", "boss_id", purgeIds, counts, "payment_orders");
  await softDeleteInBatches("payment_orders", "user_id", purgeIds, counts, "payment_orders_user");
  await softDeleteInBatches("recharge_orders", "boss_id", purgeIds, counts, "recharge_orders");
  await softDeleteInBatches("recharge_orders", "user_id", purgeIds, counts, "recharge_orders_user");
  await softDeleteInBatches("catfood_ledger", "user_id", purgeIds, counts, "catfood_ledger");
  await softDeleteInBatches("boss_wallets", "boss_id", purgeIds, counts, "boss_wallets");
  await softDeleteInBatches("favorites", "boss_id", purgeIds, counts, "favorites");
  await softDeleteInBatches("favorites", "user_id", purgeIds, counts, "favorites_user");

  // Second pass for tables that may have been blocked by FK on first pass
  await softDeleteInBatches("companion_withdrawals", "companion_id", purgeIds, counts, "companion_withdrawals_retry");
  await softDeleteInBatches("companion_payment_accounts", "companion_profile_id", companionProfileIds, counts, "companion_payment_accounts_retry");
  await softDeleteInBatches("companion_profiles", "user_id", purgeIds, counts, "companion_profiles_retry");
  await softDeleteInBatches("orders", "id", orderIds, counts, "orders_retry");
  await softDeleteInBatches("payment_orders", "boss_id", purgeIds, counts, "payment_orders_retry");

  counts.profiles = 0;
  for (const id of purgeIds) {
    try {
      const rows = await supabaseJson(restUrl("profiles", `?id=eq.${encodeURIComponent(id)}`), {
        method: "DELETE",
        headers: serviceHeaders({ Prefer: "return=representation" }),
      });
      if (Array.isArray(rows) && rows.length) counts.profiles += rows.length;
    } catch (error) {
      if (isMissingTableError(error) || /foreign key|violates|23503/i.test(String(error.message || ""))) {
        counts.profiles_fk_skip = (counts.profiles_fk_skip || 0) + 1;
        // Disable leftover profiles so they cannot login for acceptance noise
        try {
          await supabaseJson(restUrl("profiles", `?id=eq.${encodeURIComponent(id)}`), {
            method: "PATCH",
            headers: serviceHeaders({ Prefer: "return=representation" }),
            body: JSON.stringify({ status: "disabled", email: `purged.${Date.now()}.${id.slice(0, 8)}@invalid.local`, updated_at: new Date().toISOString() }),
          });
          counts.profiles_disabled = (counts.profiles_disabled || 0) + 1;
        } catch {
          /* ignore */
        }
        continue;
      }
      throw error;
    }
  }

  counts.authUsers = 0;
  for (const id of purgeIds) {
    try {
      await supabaseJson(authUrl(`admin/users/${encodeURIComponent(id)}`), {
        method: "DELETE",
        headers: serviceHeaders(),
      });
      counts.authUsers += 1;
    } catch {
      /* auth user may already be gone */
    }
  }

  return {
    ok: true,
    counts,
    purgedUsers: purgeIds.length,
    keptAdmins: allProfiles.filter((row) => ADMIN_KEEP.has(String(row.role || ""))).length,
    message: `已清理 ${purgeIds.length} 个非管理员测试账号及相关数据。`,
  };
}

export default async function handler(req, res) {
  if (!hasDb()) {
    return json(res, 503, { ok: false, message: "未配置 Supabase，无法执行数据清理。" });
  }
  try {
    await requireAdmin(req);
  } catch (error) {
    return json(res, error.status || 403, { ok: false, message: error.message || "没有管理员权限。" });
  }
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(res, 405, { ok: false, message: "Method Not Allowed" });
  }
  try {
    const body = await parseBody(req);
    const action = String(body.action || "").trim();
    if (action !== "purge_test_data") {
      return json(res, 400, { ok: false, message: "未知 action。" });
    }
    if (String(body.confirm || "") !== CONFIRM_TEXT) {
      return json(res, 400, { ok: false, message: `请在 confirm 字段填写 ${CONFIRM_TEXT} 以确认清理。` });
    }
    const result = await purgeTestData();
    return json(res, 200, result);
  } catch (error) {
    return json(res, error.status || 500, { ok: false, message: error.message || "清理测试数据失败。" });
  }
}
