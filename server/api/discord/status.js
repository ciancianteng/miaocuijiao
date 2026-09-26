/**
 * GET /api/discord/status
 * Returns current user's Discord bind status + optional order voice view.
 */
import { requireAuthProfile } from "../_discord-auth.js";
import {
  discordConfigured,
  getDiscordLink,
  normalizeVoiceMode,
  orderVoiceView,
  recommendedRedirectUri,
  resolveVoiceOwnerOrder,
} from "../_discord-voice-orders.js";

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function envUrl() {
  return String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
}
function envKey() {
  return String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
}
function serviceHeaders() {
  const key = envKey();
  return { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}
function restUrl(table, query = "") {
  return `${envUrl()}/rest/v1/${table}${query}`;
}
async function supabaseJson(endpoint, opts = {}) {
  const response = await fetch(endpoint, opts);
  const text = await response.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = { raw: text };
  }
  if (!response.ok) {
    throw Object.assign(new Error(body?.message || text || `HTTP ${response.status}`), { status: response.status, body });
  }
  return body;
}

function readQuery(req) {
  try {
    const u = new URL(req.url || "", "http://localhost");
    return Object.fromEntries(u.searchParams.entries());
  } catch {
    return req.query || {};
  }
}

export default async function handler(req, res) {
  if (req.method !== "GET") return json(res, 405, { ok: false, message: "Method not allowed" });
  let profile;
  try {
    profile = await requireAuthProfile(req);
  } catch (err) {
    return json(res, err.status || 401, { ok: false, message: err.message || "请先登录" });
  }
  const link = await getDiscordLink(profile.id);
  const q = readQuery(req);
  const orderId = String(q.orderId || q.order_id || "").trim();
  let voice = null;
  if (orderId) {
    try {
      const rows = await supabaseJson(restUrl("orders", `?id=eq.${encodeURIComponent(orderId)}&limit=1`), {
        headers: serviceHeaders(),
      });
      const order = rows?.[0];
      if (order) {
        const isBoss = String(order.boss_id || "") === String(profile.id || "");
        const isCompanion = String(order.companion_id || "") === String(profile.id || "");
        let isChildCompanion = false;
        if (!isBoss && !isCompanion && !order.parent_order_id) {
          try {
            const kids = await supabaseJson(
              restUrl(
                "orders",
                `?parent_order_id=eq.${encodeURIComponent(order.id)}&companion_id=eq.${encodeURIComponent(profile.id)}&select=id&limit=1`
              ),
              { headers: serviceHeaders() }
            );
            isChildCompanion = Array.isArray(kids) && kids.length > 0;
          } catch (_) {}
        }
        if (!isBoss && !isCompanion && !isChildCompanion) {
          return json(res, 403, { ok: false, message: "无权查看此订单的 Discord 语音房" });
        }
        const owner = await resolveVoiceOwnerOrder(order);
        voice = orderVoiceView(order, { discordLink: link, owner });
      }
    } catch (_) {}
  }
  return json(res, 200, {
    ok: true,
    configured: discordConfigured(),
    redirectUriHint: recommendedRedirectUri(),
    bound: !!(link && link.discord_user_id),
    discord: link
      ? {
          userId: link.discord_user_id,
          username: link.discord_username,
          avatar: link.discord_avatar,
          connectedAt: link.discord_connected_at,
        }
      : null,
    voice,
    defaultVoiceMode: normalizeVoiceMode("game_mic"),
  });
}
