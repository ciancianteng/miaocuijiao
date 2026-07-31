/**
 * Seed 4 real boss orders for P0 orders.html verification.
 * Statuses: awaiting_payment, in_progress, completed, refund_requested.
 *
 * Usage: node scripts/seed-boss-orders-p0.mjs
 * Loads .env.local. Never prints secrets.
 */
import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

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
const BOSS_EMAIL = process.env.MCJ_TEST_BOSS_EMAIL || "boss@meow.test";

function fail(msg) {
  console.error("FAIL:", msg);
  process.exit(1);
}

if (!url || !key) fail("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");

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

async function authListUsers() {
  const res = await fetch(`${url}/auth/v1/admin/users?page=1&per_page=200`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.msg || body?.message || `auth users HTTP ${res.status}`);
  return body.users || body || [];
}

const users = await authListUsers();
const authUser = (Array.isArray(users) ? users : []).find((u) => String(u.email || "").toLowerCase() === BOSS_EMAIL.toLowerCase());
if (!authUser?.id) fail(`Boss auth user not found: ${BOSS_EMAIL}`);

const profiles = await sb(`profiles?id=eq.${encodeURIComponent(authUser.id)}&select=id,role,email,display_name,status&limit=1`);
const boss = Array.isArray(profiles) ? profiles[0] : null;
if (!boss?.id) fail("Boss profile missing");

let companionId = null;
try {
  const comps = await sb("profiles?role=eq.companion&status=eq.active&select=id&limit=1");
  companionId = comps?.[0]?.id || null;
} catch {
  companionId = null;
}

const now = new Date().toISOString();
const stamp = Date.now();
const statuses = [
  { status: "awaiting_payment", title: "P0-待付款" },
  { status: "in_progress", title: "P0-进行中", started_at: now },
  { status: "completed", title: "P0-已完成", started_at: now, completed_at: now },
  { status: "refund_requested", title: "P0-售后", started_at: now },
];

const rows = statuses.map((item, i) => ({
  id: randomUUID(),
  order_no: `P0-${stamp}-${i + 1}`,
  boss_id: boss.id,
  companion_id: companionId,
  customer_service_id: null,
  order_type: "direct_companion",
  game: "Valorant",
  title: item.title,
  description: `${item.title}\n游戏ID：P0-TEST\n付款方式：猫粮余额\n[[P0_SEED]]`,
  hours: 1,
  unit_price: 20,
  total_amount: 20,
  status: item.status,
  created_at: now,
  accepted_at: item.status === "awaiting_payment" ? null : now,
  started_at: item.started_at || null,
  completed_at: item.completed_at || null,
  cancelled_at: null,
}));

const inserted = await sb("orders", { method: "POST", body: JSON.stringify(rows) });
const list = Array.isArray(inserted) ? inserted : rows;
console.log(`PASS: seeded ${list.length} orders for ${BOSS_EMAIL} (${boss.id})`);
for (const row of list) {
  console.log(` - ${row.order_no || row.id} :: ${row.status}`);
}
