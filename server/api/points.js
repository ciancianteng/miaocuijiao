/**
 * Boss points API — GET balance + ledger from Supabase user_points / point_transactions.
 */
import {
  getUserPoints,
  hasPointsDb,
  listPointTransactions,
  viewPointTx,
  viewPoints,
} from "./_points.js";
import { isMissingRelation } from "./_wallet.js";

function json(res, status, data) {
  if (typeof res.setHeader === "function") {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate");
    res.setHeader("Pragma", "no-cache");
  }
  res.status(status).json(data);
}

function envValue(key) {
  if (key === "SUPABASE_URL") return process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
  if (key === "SUPABASE_ANON_KEY") return process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
  if (key === "SUPABASE_SERVICE_ROLE_KEY") return process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  return process.env[key] || "";
}

function authHeaders(extra = {}) {
  return { apikey: envValue("SUPABASE_ANON_KEY"), "Content-Type": "application/json", ...extra };
}

async function profileFromToken(req) {
  const auth = String(req.headers.authorization || req.headers.Authorization || "").trim();
  const headerTok = String(req.headers["x-mcj-access-token"] || "").trim();
  const token = (auth.match(/^Bearer\s+(.+)$/i) || [])[1] || headerTok;
  if (!token) throw Object.assign(new Error("未登录"), { status: 401 });
  const userRes = await fetch(`${envValue("SUPABASE_URL").replace(/\/$/, "")}/auth/v1/user`, {
    headers: authHeaders({ Authorization: `Bearer ${token}` }),
  });
  const userBody = await userRes.json().catch(() => ({}));
  if (!userRes.ok) throw Object.assign(new Error(userBody?.msg || userBody?.message || "登录已过期"), { status: 401 });
  const uid = userBody.id;
  if (!uid) throw Object.assign(new Error("登录已过期"), { status: 401 });
  const { restUrl, serviceHeaders, supabaseJson } = await import("./_wallet.js");
  const profiles = await supabaseJson(
    restUrl("profiles", `?id=eq.${encodeURIComponent(uid)}&select=id,role,status,display_name,email&limit=1`),
    { headers: serviceHeaders() }
  );
  const profile = Array.isArray(profiles) ? profiles[0] : null;
  if (!profile) throw Object.assign(new Error("未绑定平台资料"), { status: 403 });
  return profile;
}

export default async function handler(req, res) {
  if (req.method !== "GET") return json(res, 405, { ok: false, message: "Method not allowed" });
  if (!hasPointsDb()) return json(res, 503, { ok: false, message: "未配置数据库" });

  let profile;
  try {
    profile = await profileFromToken(req);
  } catch (err) {
    return json(res, err.status || 401, { ok: false, message: err.message || "未登录" });
  }

  const action = String(req.query?.action || "summary").trim().toLowerCase();
  const userId = profile.id;

  try {
    if (action === "transactions" || action === "ledger" || action === "history") {
      const limit = Number(req.query?.limit || 100);
      const type = String(req.query?.type || "").trim();
      const rows = await listPointTransactions(userId, { limit, type });
      const points = viewPoints(await getUserPoints(userId), userId);
      return json(res, 200, {
        ok: true,
        points,
        items: rows.map(viewPointTx),
      });
    }

    const row = await getUserPoints(userId);
    let level = null;
    try {
      level = await (await import("./_boss-level.js")).getBossLevelProgress(userId);
    } catch {
      level = null;
    }
    return json(res, 200, {
      ok: true,
      points: viewPoints(row, userId),
      level,
    });
  } catch (error) {
    if (isMissingRelation(error)) {
      return json(res, 200, {
        ok: true,
        points: viewPoints(null, userId),
        items: [],
        warning: "积分表尚未创建，请先执行 supabase/migrations/20260829_user_points_system.sql",
      });
    }
    return json(res, error.status || 500, { ok: false, message: error.message || "积分读取失败" });
  }
}
