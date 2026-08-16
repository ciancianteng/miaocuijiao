/**
 * Strict whitelist cleanup of confirmed test companions on the shared Prod/Staging DB.
 *
 * ONLY deletes these user_ids (explicitly confirmed by ops request):
 *   - companion@meow.test / P0 Companion
 *   - companion.idcard...@meow.test / Companion IdCard
 *
 * Does NOT delete:
 *   - Companion Final (audit-only until explicit confirmation)
 *   - boss@ / service@ / admin@ meow.test accounts
 *   - any non-@meow.test profile
 *
 * Usage (emergency on shared prod ref — requires override):
 *   ALLOW_PROD_SUPABASE_WRITE=1 CONFIRM_PROD_WRITE=I_UNDERSTAND_PROD_RISK \
 *   CONFIRM_DELETE_WHITELIST=DELETE_P0_AND_IDCARD \
 *   node scripts/prod-whitelist-test-companion-cleanup.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertNonProductionSupabase, supabaseProjectRef } from "./lib/prod-guard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = Object.fromEntries(
  fs
    .readFileSync(path.join(root, ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i), l.slice(i + 1).replace(/^['"]|['"]$/g, "")];
    })
);
for (const [k, v] of Object.entries(env)) {
  if (!process.env[k]) process.env[k] = v;
}

const URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

/** Strict whitelist — do not expand without human confirmation */
const WHITELIST = Object.freeze([
  {
    email: "companion@meow.test",
    nickname: "P0 Companion",
    user_id: "e6816c32-21bc-4898-8953-6f4e1d9b33f2",
    companion_profile_id: "e7d22b40-e2a0-4f4b-882d-6dcff251e8b0",
  },
  {
    email: "companion.idcard.1785715257525@meow.test",
    nickname: "Companion IdCard",
    user_id: "d1cf259d-e102-42fb-9a6e-c9444ddb4bc9",
    companion_profile_id: "3c97870f-77a3-4a23-9248-0b325cfa8b3f",
  },
]);

const RETAIN = Object.freeze([
  {
    email: "companion.final.1785714993009@meow.test",
    nickname: "Companion Final",
    user_id: "db27b7be-f0e2-4af1-9c1b-d1ddd18c6c81",
    note: "audit_only — not deleted",
  },
]);

function headers(extra = {}) {
  return {
    apikey: SERVICE,
    Authorization: `Bearer ${SERVICE}`,
    "Content-Type": "application/json",
    Prefer: "return=representation",
    ...extra,
  };
}

async function rest(table, qs, { method = "GET", body } = {}) {
  const r = await fetch(`${URL}/rest/v1/${table}${qs || ""}`, {
    method,
    headers: headers(),
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!r.ok) {
    const err = new Error(`${method} ${table} ${r.status}: ${String(text).slice(0, 240)}`);
    err.status = r.status;
    err.body = data;
    throw err;
  }
  return data;
}

async function del(table, qs) {
  try {
    const rows = await rest(table, qs, { method: "DELETE" });
    return Array.isArray(rows) ? rows.length : 0;
  } catch (e) {
    if (/PGRST205|does not exist|schema cache|PGRST204/i.test(String(e.message || ""))) return 0;
    if (/foreign key|23503/i.test(String(e.message || ""))) {
      console.warn(`[fk-skip] ${table}${qs}: ${e.message}`);
      return 0;
    }
    throw e;
  }
}

async function verifyWhitelistIdentity(entry) {
  const prof = (await rest("profiles", `?id=eq.${encodeURIComponent(entry.user_id)}&select=id,email,role,display_name&limit=1`))?.[0];
  if (!prof) throw new Error(`whitelist user missing in profiles: ${entry.email}`);
  if (String(prof.email || "").toLowerCase() !== entry.email.toLowerCase()) {
    throw new Error(`email mismatch for ${entry.user_id}: db=${prof.email} expected=${entry.email}`);
  }
  const cp = (await rest("companion_profiles", `?user_id=eq.${encodeURIComponent(entry.user_id)}&select=id,nickname&limit=1`))?.[0];
  if (cp && entry.nickname && String(cp.nickname) !== entry.nickname) {
    throw new Error(`nickname mismatch for ${entry.email}: db=${cp.nickname} expected=${entry.nickname}`);
  }
  // Refuse if any linked order counterpart is non-meow.test
  const orders = await rest(
    "orders",
    `?companion_id=eq.${encodeURIComponent(entry.user_id)}&select=id,boss_id,companion_id&limit=200`
  );
  for (const o of orders || []) {
    if (!o.boss_id) continue;
    const boss = (await rest("profiles", `?id=eq.${encodeURIComponent(o.boss_id)}&select=email&limit=1`))?.[0];
    if (boss && !String(boss.email || "").toLowerCase().endsWith("@meow.test")) {
      throw new Error(`ABORT: order ${o.id} links real boss ${boss.email}`);
    }
  }
  return { prof, cp, orderCount: (orders || []).length };
}

async function deleteAuthUser(userId) {
  const r = await fetch(`${URL}/auth/v1/admin/users/${userId}`, {
    method: "DELETE",
    headers: headers(),
  });
  if (!r.ok && r.status !== 404) {
    const t = await r.text();
    throw new Error(`auth delete ${userId}: ${r.status} ${t.slice(0, 200)}`);
  }
  return r.status === 404 ? 0 : 1;
}

async function cleanupOne(entry, counts) {
  const uid = entry.user_id;
  const cpId = entry.companion_profile_id;
  const verified = await verifyWhitelistIdentity(entry);
  console.log(`[clean] ${entry.email} orders=${verified.orderCount} nick=${verified.cp?.nickname || "-"}`);

  const orderIds = (
    await rest("orders", `?companion_id=eq.${encodeURIComponent(uid)}&select=id&limit=500`)
  ).map((o) => o.id);

  // FK-safe order
  if (orderIds.length) {
    const inOrders = `in.(${orderIds.map(encodeURIComponent).join(",")})`;
    counts.messages_by_order = (counts.messages_by_order || 0) + (await del("messages", `?order_id=${inOrders}`));
    const convs = await rest("conversations", `?order_id=${inOrders}&select=id&limit=500`).catch(() => []);
    const convIds = (convs || []).map((c) => c.id);
    if (convIds.length) {
      const inConv = `in.(${convIds.map(encodeURIComponent).join(",")})`;
      counts.messages_by_conv = (counts.messages_by_conv || 0) + (await del("messages", `?conversation_id=${inConv}`));
      counts.conversations = (counts.conversations || 0) + (await del("conversations", `?id=${inConv}`));
    }
    counts.order_grabs = (counts.order_grabs || 0) + (await del("order_grabs", `?order_id=${inOrders}`));
    counts.order_status_logs = (counts.order_status_logs || 0) + (await del("order_status_logs", `?order_id=${inOrders}`));
    counts.transactions = (counts.transactions || 0) + (await del("transactions", `?order_id=${inOrders}`));
    counts.companion_earnings = (counts.companion_earnings || 0) + (await del("companion_earnings", `?order_id=${inOrders}`));
    counts.cs_dock_rewards = (counts.cs_dock_rewards || 0) + (await del("cs_dock_rewards", `?order_id=${inOrders}`));
    counts.orders = (counts.orders || 0) + (await del("orders", `?id=${inOrders}`));
  }

  counts.messages_sender = (counts.messages_sender || 0) + (await del("messages", `?sender_id=eq.${encodeURIComponent(uid)}`));
  counts.order_grabs_comp = (counts.order_grabs_comp || 0) + (await del("order_grabs", `?companion_id=eq.${encodeURIComponent(uid)}`));
  counts.companion_notifications =
    (counts.companion_notifications || 0) + (await del("companion_notifications", `?companion_id=eq.${encodeURIComponent(uid)}`));
  counts.companion_reviews =
    (counts.companion_reviews || 0) + (await del("companion_reviews", `?companion_id=eq.${encodeURIComponent(uid)}`));
  counts.companion_withdrawals =
    (counts.companion_withdrawals || 0) + (await del("companion_withdrawals", `?companion_id=eq.${encodeURIComponent(uid)}`));
  counts.companion_penalties =
    (counts.companion_penalties || 0) + (await del("companion_penalties", `?companion_id=eq.${encodeURIComponent(uid)}`));
  if (cpId) {
    counts.companion_media =
      (counts.companion_media || 0) + (await del("companion_media", `?companion_profile_id=eq.${encodeURIComponent(cpId)}`));
    counts.companion_identity =
      (counts.companion_identity || 0) +
      (await del("companion_identity_verifications", `?companion_profile_id=eq.${encodeURIComponent(cpId)}`));
  }
  counts.companion_identity_user =
    (counts.companion_identity_user || 0) +
    (await del("companion_identity_verifications", `?user_id=eq.${encodeURIComponent(uid)}`));
  counts.companion_media_user =
    (counts.companion_media_user || 0) + (await del("companion_media", `?user_id=eq.${encodeURIComponent(uid)}`));
  counts.companion_profiles =
    (counts.companion_profiles || 0) + (await del("companion_profiles", `?user_id=eq.${encodeURIComponent(uid)}`));
  counts.profiles = (counts.profiles || 0) + (await del("profiles", `?id=eq.${encodeURIComponent(uid)}`));
  counts.auth_users = (counts.auth_users || 0) + (await deleteAuthUser(uid));
}

async function main() {
  console.log("project", URL, "ref", supabaseProjectRef(URL));
  console.log("retain", RETAIN);

  // This DB is the production project — require explicit dual confirmation.
  if (process.env.CONFIRM_DELETE_WHITELIST !== "DELETE_P0_AND_IDCARD") {
    throw new Error('Refusing cleanup: set CONFIRM_DELETE_WHITELIST=DELETE_P0_AND_IDCARD');
  }
  // Allow this one script against prod when dual flags set (prod-guard still requires override).
  assertNonProductionSupabase("prod-whitelist-test-companion-cleanup.mjs");

  const counts = {};
  for (const entry of WHITELIST) {
    await cleanupOne(entry, counts);
  }

  // Verify
  const left = [];
  for (const entry of WHITELIST) {
    const cp = await rest("companion_profiles", `?user_id=eq.${encodeURIComponent(entry.user_id)}&select=id,nickname`).catch(() => []);
    const prof = await rest("profiles", `?id=eq.${encodeURIComponent(entry.user_id)}&select=id,email`).catch(() => []);
    if ((cp && cp.length) || (prof && prof.length)) left.push(entry.email);
  }
  const remainingCompanions = await rest("companion_profiles", "?select=user_id,nickname&order=created_at.desc&limit=50");
  const result = {
    ok: left.length === 0,
    deletedWhitelist: WHITELIST.map((w) => w.email),
    retained: RETAIN,
    counts,
    remainingCompanions,
    leftovers: left,
  };
  fs.mkdirSync(path.join(root, "artifacts"), { recursive: true });
  fs.writeFileSync(path.join(root, "artifacts/prod-whitelist-cleanup-result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  if (left.length) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
