/**
 * Boss · 我的直属陪玩（只读）
 * 仅返回当前登录老板的 active companions，用于 Profile 卡片计数与列表页。
 * 不包含绑定/换绑/分成写入逻辑。
 */
import { hasBossRole } from "../_account-roles.js";
import { envValue, isMissingRelation, serviceHeaders, supabaseJson } from "../_wallet.js";

const REL_TABLE = "boss_companion_relations";
const ACTIVE = "active";

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

async function loadProfilesByIds(ids) {
  const unique = [...new Set((ids || []).filter(Boolean))];
  const map = new Map();
  if (!unique.length) return map;
  const rows = await supabaseJson(
    rest("profiles", `?id=in.(${unique.map(encodeURIComponent).join(",")})&select=id,display_name,avatar_url,companion_code,boss_uid`),
    { headers: serviceHeaders() }
  );
  (Array.isArray(rows) ? rows : []).forEach((row) => {
    if (row && row.id) map.set(row.id, row);
  });
  return map;
}

function viewCompanion(row, profile) {
  return {
    id: row.id || null,
    status: row.status || ACTIVE,
    boundAt: row.bound_at || row.boundAt || null,
    companion: {
      id: profile?.id || row.companion_id || "",
      displayName: profile?.display_name || "陪玩",
      avatarUrl: profile?.avatar_url || "",
      companionCode: profile?.companion_code || profile?.id || "",
    },
  };
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
    const rows = await supabaseJson(
      rest(
        REL_TABLE,
        `?boss_id=eq.${encodeURIComponent(auth.profile.id)}&status=eq.${ACTIVE}&order=bound_at.desc&limit=500`
      ),
      { headers: serviceHeaders() }
    );
    const list = Array.isArray(rows) ? rows : [];
    const profiles = await loadProfilesByIds(list.map((r) => r.companion_id));
    const companions = list.map((row) => viewCompanion(row, profiles.get(row.companion_id) || null));
    return json(res, 200, {
      ok: true,
      tablesReady: true,
      bossId: auth.profile.id,
      bossUid: auth.profile.boss_uid || "",
      companions,
      message: "",
    });
  } catch (err) {
    if (isMissingRelation(err)) {
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
