/**
 * Boss · 我的直属陪玩（只读）
 * 仅返回当前登录老板（profiles.id = auth.uid）的 active companions。
 * 忽略客户端传入的 bossId。
 */
import { hasBossRole } from "../_account-roles.js";
import {
  enrichRelations,
  isRelationsMissing,
  listActiveRelationsForBoss,
} from "../_boss-companion-relations.js";
import { envValue, serviceHeaders, supabaseJson } from "../_wallet.js";

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
  return envValue("SUPABASE_ANON_KEY") || process.env.VITE_SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
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
  // Resolve profiles.id from auth.uid() — same invariant as RLS (auth.uid() === profiles.id)
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
    // Ignore any client-supplied bossId — scope strictly to session profile.id
    const rows = await listActiveRelationsForBoss(auth.profile.id);
    const companions = await enrichRelations(rows);
    return json(res, 200, {
      ok: true,
      tablesReady: true,
      bossId: auth.profile.id,
      bossUid: auth.profile.boss_uid || "",
      companions,
      message: "",
    });
  } catch (err) {
    if (isRelationsMissing(err)) {
      return json(res, 200, {
        ok: true,
        tablesReady: false,
        bossId: auth.profile.id,
        companions: [],
        message: "直属关系尚未开通",
      });
    }
    return json(res, err.status || 500, { ok: false, message: err.message || "读取失败" });
  }
}
