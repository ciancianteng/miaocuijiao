/**
 * GET /api/discord/oauth-start?returnTo=/payment-confirm.html?...
 * Starts Discord OAuth2 Authorization Code Flow (identify + guilds.join).
 */
import { requireAuthProfile } from "../_discord-auth.js";
import { buildOAuthStart, discordConfigured, recommendedRedirectUri } from "../_discord-voice-orders.js";

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
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
  if (req.method !== "GET" && req.method !== "POST") {
    return json(res, 405, { ok: false, message: "Method not allowed" });
  }
  let profile;
  try {
    profile = await requireAuthProfile(req);
  } catch (err) {
    return json(res, err.status || 401, { ok: false, message: err.message || "请先登录" });
  }
  const q = readQuery(req);
  const returnTo = String(q.returnTo || q.return_to || q.next || "/orders.html").trim() || "/orders.html";
  // Prevent open redirect
  const safeReturn = returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/orders.html";

  if (!discordConfigured()) {
    return json(res, 503, {
      ok: false,
      code: "DISCORD_NOT_CONFIGURED",
      message: "Discord 尚未配置。请在 Hosting / Vercel Environment Variables 填写 Discord 相关变量。",
      redirectUriHint: recommendedRedirectUri(),
      envRequired: [
        "DISCORD_CLIENT_ID",
        "DISCORD_CLIENT_SECRET",
        "DISCORD_BOT_TOKEN",
        "DISCORD_GUILD_ID",
        "DISCORD_ORDER_CATEGORY_ID",
        "DISCORD_REDIRECT_URI",
      ],
    });
  }

  const started = buildOAuthStart({ userId: profile.id, returnTo: safeReturn });
  if (!started.ok) return json(res, 503, started);

  if (String(q.redirect || "") === "1" || req.method === "GET" && String(q.format || "") !== "json") {
    res.statusCode = 302;
    res.setHeader("Location", started.url);
    res.end();
    return;
  }
  return json(res, 200, {
    ok: true,
    authorizeUrl: started.url,
    redirectUri: started.redirectUri,
  });
}
