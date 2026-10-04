/**
 * Scheduled tick for 更多玩法 product orders (no page visit required):
 *   指定陪玩 30 min unconfirmed → public grab hall; hall 30 min without taker → refund to 猫粮余额.
 * GET|POST /api/cron/gameplay-no-taker — called every 5 min by .github/workflows/gameplay-no-taker-sweep.yml.
 * Idempotent: transitions are CAS patches and wallet writes carry idempotency keys.
 */
import { sweepGameplayNoTakerOrders } from "../_order-confirm-timeout.js";

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
  return (bearer && bearer[1].trim() === secret) || header === secret;
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return json(res, 405, { ok: false, message: "Method Not Allowed" });
  }
  if (!authorized(req)) return json(res, 401, { ok: false, message: "Unauthorized cron" });
  const startedAt = new Date().toISOString();
  try {
    const out = await sweepGameplayNoTakerOrders({ limit: 100 });
    return json(res, 200, { ok: true, startedAt, finishedAt: new Date().toISOString(), ...out });
  } catch (error) {
    return json(res, 500, { ok: false, startedAt, message: String(error?.message || error).slice(0, 200) });
  }
}
