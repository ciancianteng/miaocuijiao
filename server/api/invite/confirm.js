/**
 * Invite confirm / pending / reject APIs.
 * GET  ?action=pending — current user's pending attribution
 * POST action=confirm|reject
 */
import {
  confirmInviteAttribution,
  getPendingAttributionForInvitee,
  getConfirmedAttributionForInvitee,
  isAttributionMissing,
  rejectInviteAttribution,
  viewAttribution,
} from "../_invite-attribution.js";
import { isBossInviteLinksEnabled, bossInviteLinksDisabledReason } from "../_feature-flags.js";
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

async function requireUser(req) {
  const token = tokenFrom(req);
  if (!token) throw Object.assign(new Error("请先登录"), { status: 401 });
  const user = await supabaseJson(`${url()}/auth/v1/user`, {
    headers: {
      apikey: anonKey(),
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
  });
  if (!user?.id) throw Object.assign(new Error("请先登录"), { status: 401 });
  const profiles = await supabaseJson(
    `${url()}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=*&limit=1`,
    { headers: serviceHeaders() }
  );
  const profile = Array.isArray(profiles) ? profiles[0] : null;
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
    if (!isBossInviteLinksEnabled()) {
      return json(res, 503, {
        ok: false,
        code: "BOSS_INVITE_LINKS_DISABLED",
        message: "邀请功能尚未开通",
        reason: bossInviteLinksDisabledReason(),
      });
    }

    const method = String(req.method || "GET").toUpperCase();
    const body = method === "GET" || method === "HEAD" ? {} : await parseBody(req);
    const action = actionOf(req, body) || (method === "GET" ? "pending" : "");

    const { user, profile } = await requireUser(req);
    const userId = user.id;

    if (method === "GET" && (action === "pending" || action === "status" || !action)) {
      try {
        const pending = await getPendingAttributionForInvitee(userId);
        const confirmed = pending ? null : await getConfirmedAttributionForInvitee(userId);
        let inviter = null;
        const row = pending || confirmed;
        if (row?.inviter_user_id) {
          const rows = await supabaseJson(
            `${url()}/rest/v1/profiles?id=eq.${encodeURIComponent(row.inviter_user_id)}&select=id,display_name,nickname,boss_uid&limit=1`,
            { headers: serviceHeaders() }
          );
          const p = rows?.[0];
          if (p) {
            inviter = {
              id: p.id,
              nickname: p.display_name || p.nickname || "",
              publicCode: p.boss_uid || "",
              role: row.inviter_role,
            };
          }
        }
        return json(res, 200, {
          ok: true,
          pending: pending ? viewAttribution(pending, { inviter }) : null,
          confirmed: confirmed ? viewAttribution(confirmed, { inviter }) : null,
          message: pending
            ? `${inviter?.nickname || "邀请人"} 邀请你建立直属关系`
            : confirmed
              ? "直属关系已确认"
              : "暂无待确认邀请",
        });
      } catch (error) {
        if (isAttributionMissing(error)) {
          return json(res, 503, { ok: false, code: "TABLES_MISSING", message: "邀请确认表尚未初始化" });
        }
        throw error;
      }
    }

    if (method === "POST" && (action === "recognize" || action === "claim")) {
      const code = String(body.code || body.inviteCode || body.invite_code || "").trim();
      if (!code) return json(res, 400, { ok: false, message: "缺少邀请码" });
      const { recognizeInviteAttribution } = await import("../_invite-attribution.js");
      const recognized = await recognizeInviteAttribution({
        inviteCode: code,
        inviteeUserId: userId,
      });
      return json(res, 200, {
        ok: true,
        ...recognized,
        message:
          recognized.outcome === "pending_confirm"
            ? "已记录邀请，请确认绑定"
            : recognized.detail || recognized.outcome || "已处理",
      });
    }

    if (method === "POST" && (action === "confirm" || action === "accept")) {
      const result = await confirmInviteAttribution({
        inviteeUserId: userId,
        attributionId: body.attributionId || body.attribution_id || "",
      });
      return json(res, 200, {
        ok: true,
        ...result,
        message: result.alreadyConfirmed
          ? "直属关系已确认（幂等）"
          : "已确认直属关系",
      });
    }

    if (method === "POST" && (action === "reject" || action === "decline")) {
      const result = await rejectInviteAttribution({
        inviteeUserId: userId,
        attributionId: body.attributionId || body.attribution_id || "",
      });
      return json(res, 200, { ...result, message: "已拒绝此邀请" });
    }

    return json(res, 400, { ok: false, message: "未知操作", action });
  } catch (error) {
    const status = error.status || 500;
    return json(res, status, {
      ok: false,
      code: error.code || "",
      message: error.message || "邀请确认失败",
    });
  }
}
