/**
 * Scheduled tick for 更多玩法 product orders (no page visit required):
 *   指定陪玩 30 min unconfirmed → public grab hall; hall 30 min without taker → refund to 猫粮余额.
 * GET|POST /api/cron/gameplay-no-taker — called every minute by Supabase pg_cron + pg_net
 * (functions: supabase/migrations/20261004_gameplay_no_taker_pg_cron.sql;
 *  Production job: supabase/pending-prod/22_gameplay_no_taker_cron_step2_activate.sql).
 * Idempotent: transitions are CAS patches and wallet writes carry idempotency keys.
 * Requires GAMEPLAY_CRON_SECRET (or CRON_SECRET); without one the endpoint refuses to run.
 */
import { timingSafeEqual } from "node:crypto";
import { sweepGameplayNoTakerOrders } from "../_order-confirm-timeout.js";

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

function cronSecret() {
  return String(process.env.GAMEPLAY_CRON_SECRET || process.env.CRON_SECRET || "").trim();
}

function sameSecret(given, secret) {
  const a = Buffer.from(String(given || ""));
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

function providedSecret(req) {
  const bearer = String(req.headers.authorization || "").match(/^Bearer\s+(.+)$/i);
  return String(req.headers["x-cron-secret"] || bearer?.[1] || "").trim();
}

export default async function handler(req, res) {
  if (req.method !== "GET" && req.method !== "POST") {
    return json(res, 405, { ok: false, message: "Method Not Allowed" });
  }
  const secret = cronSecret();
  if (!secret) return json(res, 503, { ok: false, message: "GAMEPLAY_CRON_SECRET not configured" });
  if (!sameSecret(providedSecret(req), secret)) return json(res, 401, { ok: false, message: "Unauthorized cron" });
  const startedAt = new Date().toISOString();
  try {
    const out = await sweepGameplayNoTakerOrders({ limit: 25, budgetMs: 7000 });
    return json(res, 200, { ok: true, startedAt, finishedAt: new Date().toISOString(), ...out });
  } catch (error) {
    return json(res, 500, { ok: false, startedAt, message: String(error?.message || error).slice(0, 200) });
  }
}
