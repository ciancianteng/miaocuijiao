/**
 * Cron: delete Discord voice channels for terminal orders after a grace period.
 * GET|POST /api/cron/discord-channel-cleanup
 */
import { cleanupExpiredDiscordChannels } from "../_discord-voice-orders.js";

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(body));
}

function authorized(req) {
  const secret = String(process.env.CRON_SECRET || process.env.MCJ_CRON_SECRET || "").trim();
  if (!secret) return true;
  const auth = String(req.headers.authorization || "");
  const bearer = auth.match(/^Bearer\s+(.+)$/i);
  const header = String(req.headers["x-cron-secret"] || "").trim();
  let q = "";
  try {
    q = String(new URL(req.url || "", "http://localhost").searchParams.get("secret") || "").trim();
  } catch {
    q = String((req.query && req.query.secret) || "").trim();
  }
  return (bearer && bearer[1].trim() === secret) || header === secret || q === secret;
}

export default async function handler(req, res) {
  if (!authorized(req)) return json(res, 401, { ok: false, message: "unauthorized" });
  try {
    const result = await cleanupExpiredDiscordChannels({ graceMinutes: 30, limit: 40 });
    return json(res, 200, { ok: true, ...result });
  } catch (err) {
    return json(res, 500, { ok: false, message: err?.message || "cleanup failed" });
  }
}
