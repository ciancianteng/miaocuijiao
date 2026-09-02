/**
 * Boss · companion invitations (send / list / accept·reject companion-initiated)
 */
import { hasBossRole } from "../_account-roles.js";
import {
  createInvitation,
  listInvitationsForUser,
  respondInvitation,
} from "../_boss-companion-invitations.js";
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
  const rows = await supabaseJson(rest("profiles", `?id=eq.${encodeURIComponent(user.id)}&limit=1`), {
    headers: serviceHeaders(),
  });
  const profile = rows?.[0];
  if (!profile || !hasBossRole(profile, { authUser: user })) {
    throw Object.assign(new Error("需要老板身份"), { status: 403 });
  }
  return profile;
}

async function parseBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  } catch {
    return {};
  }
}

export default async function handler(req, res) {
  if (req.method === "OPTIONS") return json(res, 200, { ok: true });
  let profile;
  try {
    profile = await requireBoss(req);
  } catch (err) {
    return json(res, err.status || 401, { ok: false, message: err.message || "未登录" });
  }

  try {
    if (req.method === "GET") {
      const invitations = await listInvitationsForUser({ userId: profile.id, roleHint: "boss" });
      return json(res, 200, { ok: true, invitations });
    }
    if (req.method !== "POST") return json(res, 405, { ok: false, message: "Method Not Allowed" });
    const body = await parseBody(req);
    const action = String(body.action || "").trim().toLowerCase();
    if (action === "invite") {
      const invitation = await createInvitation({
        fromRole: "boss",
        bossId: profile.id,
        companionId: body.companionId || body.companion_id,
        message: body.message || "",
      });
      return json(res, 200, { ok: true, invitation, message: "邀请已发送" });
    }
    if (action === "accept" || action === "reject") {
      const result = await respondInvitation({
        invitationId: body.invitationId || body.id,
        actorId: profile.id,
        actorRole: "boss",
        accept: action === "accept",
      });
      return json(res, 200, { ok: true, ...result, message: action === "accept" ? "已接受" : "已拒绝" });
    }
    return json(res, 400, { ok: false, message: "未知操作" });
  } catch (err) {
    return json(res, err.status || 500, {
      ok: false,
      message: err.message || "失败",
      code: err.code || "",
    });
  }
}
