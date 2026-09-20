/**
 * Boss · invite links (open codes for companion recruitment).
 * Auth: authenticated + hasBossRole + profile.status=active.
 * boss_id is always the caller — never accept another boss_id from the client.
 */
import { hasBossRole } from "../_account-roles.js";
import {
  assertInviteLinksEnabled,
  createBossInviteLink,
  inviteLinksDisabledPayload,
  isInviteLinksMissing,
  listBossInviteLinks,
  resolveBossInviteLink,
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

async function requireBoss(req) {
  const token = tokenFrom(req);
  if (!token) throw Object.assign(new Error("请先登录老板账号"), { status: 401 });
  const user = await supabaseJson(`${url()}/auth/v1/user`, {
    headers: { ...anonHeaders(), Authorization: `Bearer ${token}` },
  });
  const profiles = await supabaseJson(
    rest("profiles", `?id=eq.${encodeURIComponent(user.id)}&select=*&limit=1`),
    { headers: serviceHeaders() }
  );
  const profile = Array.isArray(profiles) ? profiles[0] : null;
  if (!profile || !hasBossRole(profile, { authUser: user })) {
    throw Object.assign(new Error("请使用老板账号操作"), { status: 403, code: "BOSS_ROLE_REQUIRED" });
  }
  if (profile.status && String(profile.status).toLowerCase() !== "active") {
    throw Object.assign(new Error("账号已停用"), { status: 403, code: "BOSS_INACTIVE" });
  }
  return { user, profile, token };
}

function actionOf(req, body = {}) {
  const u = new URL(req.url || "/", "http://localhost");
  return String(body.action || req.query?.action || u.searchParams.get("action") || "")
    .trim()
    .toLowerCase();
}

export default async function handler(req, res) {
  try {
    const method = String(req.method || "GET").toUpperCase();
    const body = method === "GET" || method === "HEAD" ? {} : await parseBody(req);
    const action = actionOf(req, body);

    // Public resolve — no auth
    if (method === "GET" && (action === "resolve" || action === "preview")) {
      if (!isBossInviteLinksEnabled()) {
        return json(res, 503, inviteLinksDisabledPayload());
      }
      const code = String(body.code || req.query?.code || new URL(req.url || "/", "http://localhost").searchParams.get("code") || "").trim();
      if (!code) return json(res, 400, { ok: false, message: "缺少邀请码" });
      try {
        assertInviteLinksEnabled();
        const preview = await resolveBossInviteLink(code);
        return json(res, 200, preview);
      } catch (error) {
        if (isInviteLinksMissing(error) || error.code === "INVITE_TABLES_MISSING") {
          return json(res, 503, { ok: false, code: "INVITE_TABLES_MISSING", message: error.message || "邀请链接表尚未初始化" });
        }
        return json(res, error.status || 400, {
          ok: false,
          code: error.code || "INVITE_INVALID",
          message: error.message || "邀请链接无效",
          reason: error.reason || null,
        });
      }
    }

    if (!isBossInviteLinksEnabled()) {
      return json(res, 503, inviteLinksDisabledPayload());
    }

    let auth;
    try {
      auth = await requireBoss(req);
    } catch (err) {
      return json(res, err.status || 403, { ok: false, message: err.message || "无权限", code: err.code || null });
    }

    // Always bind to authenticated boss — ignore client boss_id.
    const bossId = auth.profile.id;

    if (method === "GET" && (!action || action === "list")) {
      const links = await listBossInviteLinks(bossId);
      return json(res, 200, { ok: true, links, bossId });
    }

    if (method === "POST" && (action === "create" || action === "generate" || !action)) {
      if (body.bossId || body.boss_id) {
        const requested = String(body.bossId || body.boss_id || "").trim();
        if (requested && requested !== bossId) {
          return json(res, 403, {
            ok: false,
            code: "FORBIDDEN_OTHER_BOSS",
            message: "不能为其他老板生成邀请链接",
          });
        }
      }
      const link = await createBossInviteLink({
        bossId,
        maxUses: body.maxUses ?? body.max_uses ?? null,
        expiresInDays: body.expiresInDays ?? body.expires_in_days ?? null,
        label: body.label || "",
      });
      return json(res, 200, { ok: true, link, message: "邀请链接已生成" });
    }

    if (method === "POST" && (action === "revoke" || action === "disable")) {
      const linkId = String(body.id || body.linkId || body.link_id || "").trim();
      if (!linkId) return json(res, 400, { ok: false, message: "缺少链接 id" });
      const link = await revokeBossInviteLink({ bossId, linkId });
      return json(res, 200, { ok: true, link, message: "邀请链接已撤销" });
    }

    return json(res, 400, { ok: false, message: "未知操作" });
  } catch (error) {
    if (isInviteLinksMissing(error) || error.code === "INVITE_TABLES_MISSING") {
      return json(res, 503, { ok: false, code: "INVITE_TABLES_MISSING", message: error.message || "邀请链接表尚未初始化" });
    }
    if (error.code === "BOSS_INVITE_LINKS_DISABLED") {
      return json(res, 503, inviteLinksDisabledPayload());
    }
    return json(res, error.status || 500, {
      ok: false,
      code: error.code || null,
      message: error.message || "接口异常",
    });
  }
}
