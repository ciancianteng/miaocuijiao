/**
 * GET /api/discord/oauth-callback?code=&state=
 * Discord OAuth2 callback — exchanges code, saves binding, redirects back to returnTo.
 */
import { completeOAuthCallback, recommendedRedirectUri } from "../_discord-voice-orders.js";

function html(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.end(body);
}

function readQuery(req) {
  try {
    const u = new URL(req.url || "", "http://localhost");
    return Object.fromEntries(u.searchParams.entries());
  } catch {
    return req.query || {};
  }
}

function safeReturnPath(raw) {
  const s = String(raw || "/orders.html").trim() || "/orders.html";
  if (!s.startsWith("/") || s.startsWith("//")) return "/orders.html";
  return s;
}

export default async function handler(req, res) {
  const q = readQuery(req);
  if (q.error) {
    return html(
      res,
      400,
      `<!doctype html><meta charset="utf-8"><title>Discord 连接失败</title>
      <p>Discord 授权失败：${String(q.error_description || q.error)}</p>
      <p><a href="/orders.html">返回订单</a></p>`
    );
  }
  try {
    const result = await completeOAuthCallback({ code: q.code, state: q.state });
    const dest = safeReturnPath(result.returnTo);
    const sep = dest.includes("?") ? "&" : "?";
    const loc = `${dest}${sep}discord=connected`;
    res.statusCode = 302;
    res.setHeader("Location", loc);
    res.end();
  } catch (err) {
    console.warn("[discord/oauth-callback]", String(err?.message || err).slice(0, 200));
    return html(
      res,
      err.status || 500,
      `<!doctype html><meta charset="utf-8"><title>Discord 连接失败</title>
      <p>无法完成 Discord 连接：${String(err.message || "未知错误")}</p>
      <p>请确认 Discord Developer Portal Redirects 已添加：<code>${recommendedRedirectUri()}</code></p>
      <p><a href="/orders.html">返回订单</a></p>`
    );
  }
}
