/**
 * Boss · 直属分成收益（只读）
 * 分成来自平台抽成，不扣减陪玩收入。
 */
import { hasBossRole } from "../_account-roles.js";
import { listBossCommissionEarnings } from "../_boss-commission.js";
import { envValue, isMissingRelation, serviceHeaders, supabaseJson } from "../_wallet.js";

function json(res, status, data) {
  if (typeof res.setHeader === "function") {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
  }
  return res.status(status).json(data);
}

function url() {
  return envValue("SUPABASE_URL");
}
function anonKey() {
  return (
    envValue("SUPABASE_ANON_KEY") ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
    ""
  );
}
function anonHeaders(extra = {}) {
  return { apikey: anonKey(), "Content-Type": "application/json", ...extra };
}
function rest(table, query = "") {
  return `${url()}/rest/v1/${table}${query}`;
}
function tokenFrom(req) {
  return String(req.headers.authorization || req.headers["x-mcj-access-token"] || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
}

async function requireBoss(req) {
  const token = tokenFrom(req);
  if (!token) throw Object.assign(new Error("请先登录老板账号"), { status: 401 });
  const user = await supabaseJson(`${url()}/auth/v1/user`, {
    headers: anonHeaders({ Authorization: `Bearer ${token}` }),
  });
  const rows = await supabaseJson(rest("profiles", `?id=eq.${encodeURIComponent(user.id)}&limit=1`), {
    headers: serviceHeaders(),
  });
  const profile = rows?.[0];
  if (!profile || !hasBossRole(profile, { authUser: user })) {
    throw Object.assign(new Error("请使用老板账号操作"), { status: 403 });
  }
  if (profile.status && String(profile.status).toLowerCase() !== "active") {
    throw Object.assign(new Error("账号已停用"), { status: 403 });
  }
  return { profile, authUser: user };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return json(res, 405, { ok: false, message: "Method not allowed" });
  }
  let auth;
  try {
    auth = await requireBoss(req);
  } catch (err) {
    return json(res, err.status || 403, { ok: false, message: err.message || "无权限" });
  }

  try {
    const urlObj = new URL(req.url || "/", "http://localhost");
    const limit = Number(urlObj.searchParams.get("limit") || 50);
    const earnings = await listBossCommissionEarnings({
      bossId: auth.profile.id,
      limit,
    });
    const totalAmount = earnings.reduce(
      (sum, row) => sum + Number(row.bossCommissionAmount || 0),
      0
    );
    return json(res, 200, {
      ok: true,
      tablesReady: true,
      bossId: auth.profile.id,
      summary: {
        count: earnings.length,
        totalBossCommission: Math.round(totalAmount * 100) / 100,
        formula: "boss_commission = platform_fee * boss_commission_rate / 100",
        note: "直属分成从平台抽成支付，不扣减陪玩收入",
      },
      earnings,
      message: "",
    });
  } catch (err) {
    if (isMissingRelation(err)) {
      return json(res, 200, {
        ok: true,
        tablesReady: false,
        bossId: auth.profile.id,
        summary: { count: 0, totalBossCommission: 0 },
        earnings: [],
        message: "直属分成表尚未初始化",
      });
    }
    return json(res, err.status || 500, { ok: false, message: err.message || "读取失败" });
  }
}
