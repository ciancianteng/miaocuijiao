/**
 * Companion · 我的直属负责人（只读）
 * 仅返回当前登录陪玩的 active Boss 卡片字段。
 * 不放在公开 profile。
 */
import { hasCompanionRole, loadCompanionRowForUser } from "../_account-roles.js";
import {
  enrichRelations,
  getActiveRelationForCompanion,
  isRelationsMissing,
} from "../_boss-companion-relations.js";
import { resolveBossPublicCode } from "../_account-codes.js";
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
  return String(req.headers.authorization || req.headers["x-mcj-access-token"] || req.headers["x-mcj-companion-token"] || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
}

async function requireCompanion(req) {
  const token = tokenFrom(req);
  if (!token) throw Object.assign(new Error("请先登录陪玩账号"), { status: 401 });
  const user = await supabaseJson(`${url()}/auth/v1/user`, {
    headers: anonHeaders({ Authorization: `Bearer ${token}` }),
  });
  const rows = await supabaseJson(rest("profiles", `?id=eq.${encodeURIComponent(user.id)}&limit=1`), {
    headers: serviceHeaders(),
  });
  const profile = rows?.[0];
  const companion = await loadCompanionRowForUser(user.id);
  if (!profile || !hasCompanionRole(profile, { companion, authUser: user })) {
    throw Object.assign(new Error("请使用陪玩账号操作"), { status: 403 });
  }
  if (profile.status && String(profile.status).toLowerCase() !== "active") {
    throw Object.assign(new Error("账号已停用"), { status: 403 });
  }
  return { profile, companion, authUser: user };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return json(res, 405, { ok: false, message: "Method not allowed" });
  }
  let auth;
  try {
    auth = await requireCompanion(req);
  } catch (err) {
    return json(res, err.status || 403, { ok: false, message: err.message || "无权限" });
  }

  try {
    const row = await getActiveRelationForCompanion(auth.profile.id);
    if (!row) {
      return json(res, 200, {
        ok: true,
        tablesReady: true,
        relation: null,
        boss: null,
        message: "暂无直属负责人",
      });
    }
    const [enriched] = await enrichRelations([row]);
    const boss = enriched?.boss || null;
    return json(res, 200, {
      ok: true,
      tablesReady: true,
      relation: {
        id: enriched.id,
        status: enriched.status,
        boundAt: enriched.boundAt,
      },
      boss: boss
        ? {
            displayName: boss.displayName || "",
            bossUid: boss.bossUid || resolveBossPublicCode({ boss_uid: boss.bossUid }),
            status: enriched.status,
            boundAt: enriched.boundAt,
          }
        : null,
      message: "",
    });
  } catch (err) {
    if (isRelationsMissing(err)) {
      return json(res, 200, {
        ok: true,
        tablesReady: false,
        relation: null,
        boss: null,
        message: "直属关系尚未开通",
      });
    }
    return json(res, err.status || 500, { ok: false, message: err.message || "读取失败" });
  }
}
