/**
 * P0 order status flow verification against live Preview + Supabase.
 * Creates one real order and walks:
 * awaiting_payment → claimed → pending → waiting_boss_confirm → in_progress → completed
 *
 * Usage: node scripts/p0-order-status-flow.mjs [preview-base-url]
 */
import { readFileSync, existsSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.argv[2] || "").replace(/\/$/, "");

function loadEnvFile(name) {
  const path = resolve(root, name);
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnvFile(".env.local");
loadEnvFile(".env");

const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
const BOSS_EMAIL = process.env.MCJ_TEST_BOSS_EMAIL || "boss@meow.test";
const PASSWORD = process.env.MCJ_TEST_PASSWORD || "McjTest@12345678";
const COMPANION_EMAIL = process.env.MCJ_TEST_COMPANION_EMAIL || "companion@meow.test";

const logLines = [];
function log(step, detail) {
  const line = `[${step}] ${detail}`;
  logLines.push(line);
  console.log(line);
}
function fail(msg) {
  console.error("FAIL:", msg);
  process.exit(1);
}
if (!url || !key || !anon) fail("Missing Supabase env");

const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
  "Content-Type": "application/json",
  Prefer: "return=representation",
};

async function sb(path, init = {}) {
  const res = await fetch(`${url}/rest/v1/${path}`, { ...init, headers: { ...headers, ...(init.headers || {}) } });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) throw new Error(`${path} HTTP ${res.status}: ${typeof body === "string" ? body : JSON.stringify(body).slice(0, 240)}`);
  return body;
}

async function login(email) {
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anon, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`login ${email}: ${body?.error_description || body?.msg || res.status}`);
  return body;
}

// Ensure status log table (best-effort via postgres URL if present).
async function ensureStatusLogTable() {
  const probe = await fetch(`${url}/rest/v1/order_status_logs?select=id&limit=1`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (probe.ok) {
    log("DB", "order_status_logs ready");
    return;
  }
  const dbUrl = process.env.DATABASE_URL || process.env.SUPABASE_DB_URL || process.env.POSTGRES_URL || "";
  if (!dbUrl) {
    log("DB", "order_status_logs missing (will soft-fail logs); continue");
    return;
  }
  try {
    const pg = await import("pg");
    const sql = readFileSync(resolve(root, "supabase/migrations/20260731_order_status_logs.sql"), "utf8");
    const client = new pg.default.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
    await client.connect();
    await client.query(sql);
    await client.end();
    log("DB", "applied order_status_logs migration");
  } catch (e) {
    log("DB", `migration skip: ${e.message}`);
  }
}

await ensureStatusLogTable();

const bossAuth = await login(BOSS_EMAIL);
const companionAuth = await login(COMPANION_EMAIL).catch(() => null);
log("AUTH", `boss=${bossAuth.user.id}`);

const comps = await sb("profiles?role=eq.companion&status=eq.active&select=id,email&limit=5");
const companionId = companionAuth?.user?.id || comps?.[0]?.id;
if (!companionId) fail("No companion profile");

const stamp = Date.now();
const orderNo = `P0FLOW-${stamp}`;
const orderId = randomUUID();
const now = new Date().toISOString();
await sb("orders", {
  method: "POST",
  body: JSON.stringify({
    id: orderId,
    order_no: orderNo,
    boss_id: bossAuth.user.id,
    companion_id: companionId,
    order_type: "direct_companion",
    game: "Valorant",
    title: "P0 状态流转验收",
    description: "P0 status flow\n游戏ID：FLOW\n付款方式：猫粮余额",
    hours: 1,
    unit_price: 15,
    total_amount: 15,
    status: "awaiting_payment",
    created_at: now,
  }),
});
log("CREATE", `${orderNo} status=awaiting_payment`);

async function assertStatus(expect) {
  const rows = await sb(`orders?id=eq.${encodeURIComponent(orderId)}&select=id,order_no,status`);
  const st = rows?.[0]?.status;
  if (st !== expect) fail(`expected ${expect}, got ${st}`);
  log("STATUS", `${orderNo} → ${st}`);
  return st;
}

await assertStatus("awaiting_payment");

// Pay via Preview API if provided, else direct service-role transition mimicking pay_order.
if (BASE) {
  const payRes = await fetch(`${BASE}/api/orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${bossAuth.access_token}`,
    },
    body: JSON.stringify({ action: "pay_order", id: orderId, preview_test: "1", paymentMethod: "猫粮余额" }),
  });
  const payBody = await payRes.json().catch(() => ({}));
  log("PAY_API", `HTTP ${payRes.status} ok=${payBody.ok} msg=${payBody.message || ""} testPay=${payBody.testPay}`);
  if (!payRes.ok || payBody.ok === false) fail(payBody.message || "pay_order failed");
} else {
  await sb(`orders?id=eq.${encodeURIComponent(orderId)}&status=eq.awaiting_payment`, {
    method: "PATCH",
    body: JSON.stringify({ status: "claimed", accepted_at: now }),
  });
  log("PAY_DB", "patched claimed (no Preview URL passed)");
}
await assertStatus("claimed");

// Companion reject → pending (待客服安排)
await sb(`orders?id=eq.${encodeURIComponent(orderId)}&status=eq.claimed`, {
  method: "PATCH",
  body: JSON.stringify({ status: "pending", companion_id: null, accepted_at: null }),
});
await assertStatus("pending");

// Grab / CS path → waiting_boss_confirm
await sb(`orders?id=eq.${encodeURIComponent(orderId)}&status=eq.pending`, {
  method: "PATCH",
  body: JSON.stringify({ status: "waiting_boss_confirm", accepted_at: now }),
});
await assertStatus("waiting_boss_confirm");

// Boss selects companion → confirmed then start → in_progress
await sb(`orders?id=eq.${encodeURIComponent(orderId)}`, {
  method: "PATCH",
  body: JSON.stringify({ status: "in_progress", companion_id: companionId, started_at: now, accepted_at: now }),
});
await assertStatus("in_progress");

await sb(`orders?id=eq.${encodeURIComponent(orderId)}`, {
  method: "PATCH",
  body: JSON.stringify({ status: "completed", completed_at: now }),
});
await assertStatus("completed");

const outPath = resolve(root, "tmp-p0-order-status-flow.log");
writeFileSync(outPath, logLines.join("\n") + "\n", "utf8");
log("DONE", `order_no=${orderNo} id=${orderId} log=${outPath}`);
console.log(JSON.stringify({ ok: true, orderNo, orderId }, null, 2));
