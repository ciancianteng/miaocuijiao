/**
 * Companion P0 smoke against Preview + Supabase.
 * Usage: node scripts/p0-companion-smoke.mjs [preview-base-url]
 */
import { readFileSync, existsSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import { assertSmokeTargetAllowed } from "./lib/prod-guard.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = (process.argv[2] || "").replace(/\/$/, "");
const findings = [];

function loadEnv(name) {
  const p = resolve(root, name);
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    const k = line.slice(0, i).trim();
    let v = line.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}
loadEnv(".env.local");
loadEnv(".env");

const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const anon = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
const BOSS = process.env.MCJ_TEST_BOSS_EMAIL || "boss@meow.test";
const COMP = process.env.MCJ_TEST_COMPANION_EMAIL || "companion@meow.test";
const PASS = process.env.MCJ_TEST_PASSWORD || "McjTest@12345678";

function note(ok, id, detail) {
  const line = `${ok ? "PASS" : "FAIL"} | ${id} | ${detail}`;
  findings.push({ ok, id, detail });
  console.log(line);
  return ok;
}
function fail(msg) {
  console.error("ABORT:", msg);
  process.exit(1);
}
if (!url || !key || !anon) fail("missing supabase env");
if (!BASE) fail("pass Preview base URL");
assertSmokeTargetAllowed({
  script: "p0-companion-smoke",
  base: BASE,
  supabaseUrl: url,
  requireStagingSupabase: true,
});

const svc = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=representation" };

async function sb(path, init = {}) {
  const res = await fetch(`${url}/rest/v1/${path}`, { ...init, headers: { ...svc, ...(init.headers || {}) } });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) throw new Error(`${path} ${res.status} ${typeof body === "string" ? body : JSON.stringify(body).slice(0, 200)}`);
  return body;
}

async function login(email) {
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anon, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: PASS }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`login ${email}: ${body?.error_description || body?.msg || res.status}`);
  return body;
}

async function api(path, token, init = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text.slice(0, 200) };
  }
  return { res, body };
}

const bossAuth = await login(BOSS);
const compAuth = await login(COMP);
note(true, "login-boss", bossAuth.user.id);
note(true, "login-companion", compAuth.user.id);

// 1) companion bootstrap
{
  const { res, body } = await api("/api/companion?action=bootstrap", compAuth.access_token);
  note(res.ok && body.ok !== false, "bootstrap", `HTTP ${res.status} msg=${body.message || ""} myOrders=${(body.data?.myOrders || []).length}`);
  if (!res.ok) console.log(JSON.stringify(body).slice(0, 400));
}

// 2) create claimed order for this companion (boss pay path via service role — boss UI frozen)
const orderId = randomUUID();
const orderNo = `P0CMP-${Date.now()}`;
const now = new Date().toISOString();
await sb("orders", {
  method: "POST",
  body: JSON.stringify({
    id: orderId,
    order_no: orderNo,
    boss_id: bossAuth.user.id,
    companion_id: compAuth.user.id,
    order_type: "direct_companion",
    game: "Valorant",
    title: "P0 陪玩确认验收",
    description: "companion P0\n游戏ID：CMP\n付款方式：猫粮余额",
    hours: 1,
    unit_price: 20,
    total_amount: 20,
    status: "claimed",
    created_at: now,
    accepted_at: now,
  }),
});
note(true, "seed-claimed", `${orderNo} claimed → companion ${compAuth.user.id}`);

// 3) bootstrap should list claimed
{
  const { res, body } = await api("/api/companion?action=bootstrap", compAuth.access_token);
  const mine = (body.data?.myOrders || []).filter((o) => o.id === orderId || o.orderNo === orderNo);
  const waiting = body.data?.summary?.waitingConfirm;
  note(res.ok && mine.length === 1 && mine[0].status === "claimed", "see-claimed-order", `found=${mine.length} waitingConfirm=${waiting} status=${mine[0]?.status}`);
}

// 4) accept_direct
{
  const { res, body } = await api("/api/companion", compAuth.access_token, {
    method: "POST",
    body: JSON.stringify({ action: "accept_direct_order", id: orderId }),
  });
  note(res.ok && body.ok !== false, "accept-direct", `HTTP ${res.status} msg=${body.message || ""} status=${body.order?.status || body.data?.order?.status}`);
  if (!res.ok) console.log(JSON.stringify(body).slice(0, 500));
}

// 5) DB status after accept
{
  const rows = await sb(`orders?id=eq.${encodeURIComponent(orderId)}&select=id,status`);
  note(rows?.[0]?.status === "confirmed", "db-after-accept", `status=${rows?.[0]?.status}`);
}

// 6) boss orders API sees confirmed
{
  const { res, body } = await api(`/api/orders?id=${encodeURIComponent(orderId)}`, bossAuth.access_token);
  const o = (body.orders || [])[0];
  note(res.ok && o && o.status === "confirmed", "boss-sync", `HTTP ${res.status} status=${o?.status}`);
}

// 7) CS orders list (service account)
{
  let csOk = false;
  let detail = "skip";
  try {
    const csAuth = await login(process.env.MCJ_TEST_CS_EMAIL || "service@meow.test");
    const { res, body } = await api("/api/customer-service?action=bootstrap", csAuth.access_token);
    const orders = body.data?.orders || body.orders || [];
    const hit = orders.find((o) => o.id === orderId || o.orderNo === orderNo);
    csOk = res.ok && !!hit;
    detail = `HTTP ${res.status} hit=${!!hit} status=${hit?.status || "-"} orders=${orders.length}`;
  } catch (e) {
    detail = e.message;
  }
  note(csOk, "cs-sync", detail);
}

// 8) profile update probes (full required fields — matches UI form)
{
  const boot = await api("/api/companion?action=bootstrap", compAuth.access_token);
  const p = boot.body.data?.player || {};
  const raw = p.raw || {};
  const level = boot.body.data?.levelInfo || {};
  const minP = Number(level.minPrice ?? 20);
  const maxP = Number(level.maxPrice ?? 30);
  const maxPlus = !!level.maxPlus;
  let price = Number(level.price ?? p.rawPrice ?? p.price ?? 25);
  if (!Number.isFinite(price) || price < minP || (!maxPlus && price > maxP)) price = minP;
  const { res, body } = await api("/api/companion", compAuth.access_token, {
    method: "POST",
    body: JSON.stringify({
      action: "update_profile",
      nickname: String(p.name || "TEST陪玩验收"),
      age: String(raw.age || 23),
      gender: String(raw.gender || "女"),
      region: String(raw.region || "马来西亚·吉隆坡"),
      contact_phone: String(raw.contact_phone || "012-3456789"),
      main_game: String(p.mainGame || raw.game || "Valorant"),
      game_id: String(p.gameId || raw.game_id || "CMP001"),
      rank: String(raw.game_rank || raw.rank || ""),
      position: String(raw.position || ""),
      bio: String(p.bio || "P0验收"),
      price: String(price),
    }),
  });
  note(res.ok && body.ok !== false, "update-profile", `HTTP ${res.status} msg=${body.message || JSON.stringify(body).slice(0, 180)}`);
}

// 9) wallet / earnings
{
  const { res, body } = await api("/api/companion?action=bootstrap", compAuth.access_token);
  const earn = body.data?.earnings || body.data?.earningDetails;
  const summary = body.data?.summary || {};
  note(res.ok && summary && typeof summary.withdrawable !== "undefined", "wallet-summary", `withdrawable=${summary.withdrawable} monthIncome=${summary.monthIncome} earnings=${!!earn}`);
}

// 10) withdraw attempt (correct action name; expect validation lock, not 500)
{
  const { res, body } = await api("/api/companion", compAuth.access_token, {
    method: "POST",
    body: JSON.stringify({ action: "request_withdrawal", amount: 50 }),
  });
  note(res.status !== 500, "withdraw-no-500", `HTTP ${res.status} msg=${body.message || ""}`);
}

// 11) history orders
{
  const { res, body } = await api("/api/companion?action=bootstrap", compAuth.access_token);
  const hist = (body.data?.myOrders || []).filter((o) => ["completed", "cancelled", "confirmed", "in_progress", "claimed"].includes(o.status));
  note(res.ok && hist.length >= 1, "history-orders", `count=${hist.length}`);
}

const failed = findings.filter((f) => !f.ok);
writeFileSync(resolve(root, "tmp-p0-companion-smoke.json"), JSON.stringify({ BASE, orderNo, orderId, findings }, null, 2));
console.log(`\nSUMMARY fail=${failed.length}/${findings.length} order=${orderNo}`);
process.exit(failed.length ? 1 : 0);
