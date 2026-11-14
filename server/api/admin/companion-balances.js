/**
 * Read-only companion balance report for the admin console.
 * Totals use companionEarningsBalance — the same formula as 收益中心.
 * Does not write wallets, withdrawals, or orders.
 */
import { requireAdmin } from "../_admin-auth.js";
import { resolveCompanionPublicCode } from "../_account-codes.js";
import { indexProfilesForStats, isTestAccountRecord } from "../_test-accounts.js";
import {
  addBalanceTotals,
  balanceDatePolicy,
  companionEarningsBalance,
  emptyBalanceTotals,
} from "../_companion-earnings-balance.js";

export const FINANCE_VIEW_ROLES = new Set(["admin", "super_admin", "finance_admin"]);

const PAGE = 1000;
const ORDER_CHUNK = 60;

function json(res, status, data) {
  return res.status(status).json(data);
}

function envValue(key) {
  if (key === "SUPABASE_URL") return process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  return process.env[key] || "";
}

function hasDb() {
  return Boolean(envValue("SUPABASE_URL") && envValue("SUPABASE_SERVICE_ROLE_KEY"));
}

function restUrl(table, query = "") {
  return `${envValue("SUPABASE_URL")}/rest/v1/${table}${query}`;
}

function serviceHeaders(extra = {}) {
  const key = envValue("SUPABASE_SERVICE_ROLE_KEY");
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

function supabaseError(body, response) {
  const parts = [body?.message, body?.error, body?.hint, body?.details, typeof body === "string" ? body : ""].filter(Boolean);
  return `${parts[0] || "Supabase 请求失败"} (HTTP ${response.status})`;
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
  if (!response.ok) throw Object.assign(new Error(supabaseError(body, response)), { status: response.status });
  return body;
}

function isMissingColumn(error) {
  return /Could not find the '|schema cache|PGRST204|42703/i.test(String(error?.message || error || ""));
}

function isMissingRelation(error) {
  return /Could not find the table|does not exist|PGRST205|42P01/i.test(String(error?.message || error || ""));
}

async function fetchPages(table, query) {
  const rows = [];
  let prevFirst = "";
  const join = query.includes("?") ? "&" : "?";
  for (let offset = 0; offset < 50000; offset += PAGE) {
    const page = await supabaseJson(restUrl(table, `${query}${join}limit=${PAGE}&offset=${offset}`), {
      headers: serviceHeaders(),
    });
    const list = Array.isArray(page) ? page : [];
    const first = String(list[0]?.id || "");
    if (first && first === prevFirst) break;
    prevFirst = first;
    rows.push(...list);
    if (list.length < PAGE) break;
  }
  return rows;
}

async function fetchFirst(table, queries) {
  let lastError = null;
  for (const query of queries) {
    try {
      return await fetchPages(table, query);
    } catch (error) {
      lastError = error;
      if (isMissingRelation(error)) return [];
      if (!isMissingColumn(error)) throw error;
    }
  }
  if (lastError && !isMissingColumn(lastError)) throw lastError;
  return [];
}

function isApprovedCompanion(row = {}) {
  const ver = String(row.verification_status || "").toLowerCase();
  const app = String(row.application_status || "").toLowerCase();
  if (["approved", "verified", "passed"].includes(ver)) return true;
  if (["approved", "published"].includes(app)) return true;
  return false;
}

async function loadOrdersForIncome(orderIds) {
  const ids = [...new Set(orderIds.filter(Boolean))];
  const orders = [];
  for (let i = 0; i < ids.length; i += ORDER_CHUNK) {
    const chunk = ids.slice(i, i + ORDER_CHUNK);
    const query = `?id=in.(${chunk.map(encodeURIComponent).join(",")})&select=id,status,order_no,companion_id,completed_at,cancelled_at,completion_method,note,description`;
    try {
      const rows = await supabaseJson(restUrl("orders", query), { headers: serviceHeaders() });
      if (Array.isArray(rows)) orders.push(...rows);
    } catch (error) {
      if (isMissingColumn(error)) {
        const slim = `?id=in.(${chunk.map(encodeURIComponent).join(",")})&select=id,status,completed_at,note,description`;
        const rows = await supabaseJson(restUrl("orders", slim), { headers: serviceHeaders() }).catch(() => []);
        if (Array.isArray(rows)) orders.push(...rows);
      } else if (!isMissingRelation(error)) {
        throw error;
      }
    }
  }
  return orders;
}

function ledgerUserId(row) {
  return String(row?.user_id || row?.companion_id || row?.profile_id || "").trim();
}

export function buildCompanionBalanceRows({
  profiles = [],
  companionProfiles = [],
  transactions = [],
  withdrawals = [],
  orders = [],
  nowMs = Date.now(),
} = {}) {
  const { byId, testIds } = indexProfilesForStats(profiles);
  const companionsByUser = new Map();
  for (const cp of companionProfiles || []) {
    const userId = String(cp.user_id || cp.profile_id || "").trim();
    if (!userId) continue;
    const list = companionsByUser.get(userId) || [];
    list.push(cp);
    companionsByUser.set(userId, list);
  }

  const cpIdToUser = new Map();
  for (const cp of companionProfiles || []) {
    if (cp?.id && cp?.user_id) cpIdToUser.set(String(cp.id), String(cp.user_id));
  }
  const txByUser = new Map();
  for (const tx of transactions || []) {
    const userId = ledgerUserId(tx);
    if (!userId) continue;
    const list = txByUser.get(userId) || [];
    list.push(tx);
    txByUser.set(userId, list);
  }
  const wdByUser = new Map();
  for (const row of withdrawals || []) {
    const raw = ledgerUserId(row);
    const userId = companionsByUser.has(raw) ? raw : cpIdToUser.get(raw) || raw;
    if (!userId) continue;
    const list = wdByUser.get(userId) || [];
    list.push(row);
    wdByUser.set(userId, list);
  }

  const userIds = new Set([...companionsByUser.keys(), ...txByUser.keys(), ...wdByUser.keys()]);
  const rows = [];
  for (const userId of userIds) {
    const profile = byId.get(userId) || null;
    const cpList = companionsByUser.get(userId) || [];
    const cp = cpList.find((row) => isApprovedCompanion(row)) || cpList[0] || null;
    const txs = txByUser.get(userId) || [];
    const wds = wdByUser.get(userId) || [];
    if (profile && (testIds.has(userId) || isTestAccountRecord(profile))) continue;
    if (cp && isTestAccountRecord(cp, profile || {})) continue;
    const hasIncome = txs.some((tx) => String(tx.transaction_type || "") === "companion_income");
    if (!cp && !hasIncome && !wds.length) continue;
    const balance = companionEarningsBalance({
      transactions: txs,
      withdrawals: wds,
      orders,
      nowMs,
    });
    const name = String(cp?.nickname || profile?.display_name || profile?.name || "").trim() || "未命名陪玩";
    const publicId = cp ? resolveCompanionPublicCode(cp) : "";
    rows.push({
      userId,
      name,
      publicId: publicId || String(cp?.companion_uid || "").trim() || userId,
      withdrawable: balance.withdrawable,
      pendingSettlement: balance.pendingSettlement,
      withdrawing: balance.withdrawing,
      withdrawn: balance.withdrawn,
    });
  }

  rows.sort((a, b) => b.withdrawable - a.withdrawable || String(a.publicId).localeCompare(String(b.publicId)));
  const totals = rows.reduce((sum, row) => addBalanceTotals(sum, row), emptyBalanceTotals());
  return { rows, totals };
}

export async function loadCompanionBalanceReport({ nowMs = Date.now(), query = {} } = {}) {
  const policy = balanceDatePolicy(query);
  if (!hasDb()) {
    return {
      ok: true,
      configured: false,
      ...policy,
      totals: emptyBalanceTotals(),
      rows: [],
      message: "未配置 Supabase，余额显示 0，不返回假统计。",
    };
  }
  const [profiles, companionProfiles, transactions, withdrawals] = await Promise.all([
    fetchFirst("profiles", [
      "?select=id,role,email,display_name,status,is_test_account&order=id.asc",
      "?select=id,role,email,display_name,status&order=id.asc",
    ]),
    fetchFirst("companion_profiles", [
      "?select=id,user_id,nickname,verification_status,application_status,companion_code,companion_uid,is_test_account&order=id.asc",
      "?select=id,user_id,nickname,verification_status,application_status,companion_code,companion_uid&order=id.asc",
      "?select=id,user_id,nickname,verification_status,application_status&order=id.asc",
    ]),
    fetchFirst("transactions", [
      "?select=id,user_id,order_id,transaction_type,amount,status,note,created_at&transaction_type=in.(companion_income,refund)&order=id.asc",
      "?select=id,user_id,order_id,transaction_type,amount,status,note&transaction_type=in.(companion_income,refund)&order=id.asc",
    ]),
    fetchFirst("companion_withdrawals", [
      "?select=id,companion_id,status,cat_food_amount,amount&order=id.asc",
      "?select=id,companion_id,status,cat_food_amount&order=id.asc",
      "?select=id,companion_id,status,amount&order=id.asc",
    ]),
  ]);
  const orderIds = (transactions || [])
    .filter((tx) => String(tx.transaction_type || "") === "companion_income" && tx.order_id)
    .map((tx) => String(tx.order_id));
  const orders = await loadOrdersForIncome(orderIds);
  const { rows, totals } = buildCompanionBalanceRows({
    profiles,
    companionProfiles,
    transactions,
    withdrawals,
    orders,
    nowMs,
  });
  return {
    ok: true,
    configured: true,
    ...policy,
    totals,
    rows,
    definition: {
      withdrawable: "收益中心「当前可提现」。订单净收入、礼物净收入、邀请佣金，减去订单24h锁定、提现中和已完成打款。",
      pendingSettlement:
        "收益中心「订单24h锁定」。已写入收入流水、尚未解锁进可提现的订单收入。没有独立待结算字段，不用营业额减平台利润推算。",
      withdrawing: "收益中心「提现中」。冻结中的提现申请。已完成打款、已拒绝、已取消不计入。",
      withdrawn: "提现状态为 completed 的猫粮合计，与收益中心已打款扣减一致。",
      date: "当前实时余额。没有历史余额快照，日期筛选不改变这四个金额。",
    },
  };
}

export default async function handler(req, res) {
  if (req.method !== "GET") return json(res, 405, { ok: false, message: "余额统计只读。" });
  try {
    const admin = await requireAdmin(req, { allowRoles: FINANCE_VIEW_ROLES });
    if (!FINANCE_VIEW_ROLES.has(String(admin.role || ""))) {
      return json(res, 403, { ok: false, message: "没有财务查看权限。" });
    }
    const report = await loadCompanionBalanceReport({ query: req.query || {} });
    return json(res, 200, report);
  } catch (error) {
    const status = error.status || 500;
    const message =
      status === 403 && /没有后台管理权限/.test(String(error.message || ""))
        ? "没有财务查看权限。"
        : error.message || "陪玩余额读取失败";
    return json(res, status, { ok: false, message });
  }
}
