/**
 * Companion invite links — same table as boss links (#185), owner_role=companion.
 */
import { hasCompanionRole, loadCompanionRowForUser } from "../_account-roles.js";
import {
  assertInviteLinksEnabled,
  createBossInviteLink,
  inviteLinksDisabledPayload,
  isInviteLinksMissing,
  listBossInviteLinks,
  revokeBossInviteLink,
} from "../_boss-invite-links.js";
import { isBossInviteLinksEnabled } from "../_feature-flags.js";
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
function tokenFrom(req) {
  return String(req.headers.authorization || req.headers["x-mcj-access-token"] || "")
    .replace(/^Bearer\s+/i, "")
    .trim();
}
async function parseBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    return {};
  }
}
async function requireCompanion(req) {
  const token = tokenFrom(req);
  if (!token) throw Object.assign(new Error("请先登录陪玩账号"), { status: 401 });
  const user = await supabaseJson(`${url()}/auth/v1/user`, {
    headers: { apikey: anonKey(), Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  const profiles = await supabaseJson(
    `${url()}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=*&limit=1`,
    { headers: serviceHeaders() }
  );
  const profile = Array.isArray(profiles) ? profiles[0] : null;
  const companion = await loadCompanionRowForUser(user.id);
  if (!profile || !hasCompanionRole(profile, { companion, authUser: user })) {
    throw Object.assign(new Error("请使用陪玩账号操作"), { status: 403, code: "COMPANION_ROLE_REQUIRED" });
  }
  return { user, profile };
}
function actionOf(req, body = {}) {
  const u = new URL(req.url || "/", "http://localhost");
  return String(body.action || req.query?.action || u.searchParams.get("action") || "")
    .trim()
    .toLowerCase();
}

export default async function handler(req, res) {
  try {
    if (!isBossInviteLinksEnabled()) return json(res, 503, inviteLinksDisabledPayload());
    const method = String(req.method || "GET").toUpperCase();
    const body = method === "GET" || method === "HEAD" ? {} : await parseBody(req);
    const action = actionOf(req, body);
    const auth = await requireCompanion(req);
    const ownerId = auth.profile.id;

    if (method === "GET" && (!action || action === "list")) {
      const links = await listBossInviteLinks(ownerId);
      return json(res, 200, { ok: true, links, ownerId, ownerRole: "companion" });
    }
    if (method === "POST" && (action === "create" || action === "generate" || !action)) {
      assertInviteLinksEnabled();
      const link = await createBossInviteLink({
        bossId: ownerId,
        ownerRole: "companion",
        maxUses: body.maxUses ?? body.max_uses ?? null,
        expiresInDays: body.expiresInDays ?? body.expires_in_days ?? null,
        label: body.label || "陪玩邀请",
      });
      return json(res, 200, { ok: true, link, message: "陪玩邀请链接已生成" });
    }
    if (method === "POST" && (action === "revoke" || action === "disable")) {
      const linkId = String(body.id || body.linkId || body.link_id || "").trim();
      if (!linkId) return json(res, 400, { ok: false, message: "缺少链接 id" });
      const link = await revokeBossInviteLink({ bossId: ownerId, linkId });
      return json(res, 200, { ok: true, link, message: "邀请链接已撤销" });
    }
    return json(res, 400, { ok: false, message: "未知操作" });
  } catch (error) {
    if (isInviteLinksMissing(error) || error.code === "INVITE_TABLES_MISSING") {
      return json(res, 503, { ok: false, code: "INVITE_TABLES_MISSING", message: error.message });
    }
    return json(res, error.status || 500, { ok: false, code: error.code || null, message: error.message || "接口异常" });
  }
}
