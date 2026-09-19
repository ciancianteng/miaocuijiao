/**
 * Boss · current VIP snapshot (CS-confirmed spend).
 */
import { hasBossRole } from "../_account-roles.js";
import { getBossVipView } from "../_boss-vip.js";
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
  return { profile, authUser: user };
}

export default async function handler(req, res) {
  if (req.method !== "GET") return json(res, 405, { ok: false, message: "Method not allowed" });
  try {
    const { profile } = await requireBoss(req);
    const out = await getBossVipView(profile.id);
    return json(res, 200, { ok: true, ...out });
  } catch (err) {
    return json(res, err.status || 500, { ok: false, message: err.message || "读取 VIP 失败" });
  }
}
