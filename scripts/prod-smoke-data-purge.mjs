/**
 * Production smoke/test data PURGE (destructive).
 *
 * Default: dry-run only (prints plan from inventory file or live inventory).
 * Apply requires dual write override + explicit confirm phrase.
 *
 * Inventory first:
 *   ALLOW_PROD_SUPABASE_READ=1 CONFIRM_PROD_READ=I_UNDERSTAND_PROD_READ \
 *   PROD_SUPABASE_URL=... PROD_SUPABASE_SERVICE_ROLE_KEY=... \
 *   node scripts/prod-smoke-data-inventory.mjs
 *
 * Dry-run purge plan:
 *   ... same read flags ... \
 *   INVENTORY_FILE=artifacts/prod-smoke-inventory-....json \
 *   node scripts/prod-smoke-data-purge.mjs
 *
 * Apply:
 *   ALLOW_PROD_SUPABASE_WRITE=1 CONFIRM_PROD_WRITE=I_UNDERSTAND_PROD_RISK \
 *   CONFIRM_DELETE_SMOKE=DELETE_PRODUCTION_SMOKE_DATA \
 *   INVENTORY_FILE=artifacts/prod-smoke-inventory-....json \
 *   node scripts/prod-smoke-data-purge.mjs --apply
 *
 * Retains admin@meow.test unless INCLUDE_BOOTSTRAP_ADMIN=1.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PRODUCTION_SUPABASE_REF,
  assertNonProductionSupabase,
  assertProductionSupabaseReadAllowed,
  loadEnvFiles,
  supabaseProjectRef,
} from "./lib/prod-guard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnvFiles(root);

const URL = (
  process.env.PROD_SUPABASE_URL ||
  process.env.SUPABASE_URL ||
  process.env.VITE_SUPABASE_URL ||
  ""
).replace(/\/$/, "");
const SERVICE = process.env.PROD_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const APPLY = process.argv.includes("--apply") || process.env.APPLY === "1";
const INCLUDE_ADMIN = process.env.INCLUDE_BOOTSTRAP_ADMIN === "1";
const CONFIRM = process.env.CONFIRM_DELETE_SMOKE === "DELETE_PRODUCTION_SMOKE_DATA";

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
    const err = new Error(`${method} ${table} ${r.status}: ${String(text).slice(0, 300)}`);
    err.status = r.status;
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

async function deleteStoragePrefix(bucket, prefix) {
  try {
    const listed = await fetch(`${URL}/storage/v1/object/list/${bucket}`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ prefix, limit: 100 }),
    });
    const files = await listed.json().catch(() => []);
    if (!Array.isArray(files) || !files.length) return 0;
    const paths = files.map((f) => `${prefix}${f.name}`.replace(/\/+/g, "/"));
    const r = await fetch(`${URL}/storage/v1/object/${bucket}`, {
      method: "DELETE",
      headers: headers(),
      body: JSON.stringify({ prefixes: paths }),
    });
    if (!r.ok) return 0;
    return paths.length;
  } catch {
    return 0;
  }
}

function loadInventory() {
  const file = process.env.INVENTORY_FILE || "";
  if (!file) throw new Error("Set INVENTORY_FILE=artifacts/prod-smoke-inventory-....json");
  const abs = path.isAbsolute(file) ? file : path.join(root, file);
  const data = JSON.parse(fs.readFileSync(abs, "utf8"));
  if (!data?.accounts) throw new Error("inventory missing accounts[]");
  return { abs, data };
}

async function purgeOne(account, counts) {
  const uid = account.userId;
  const cpId = account.companionProfileId;

  // Collect order ids for both roles
  const bossOrders = await rest("orders", `?boss_id=eq.${encodeURIComponent(uid)}&select=id&limit=500`).catch(() => []);
  const compOrders = await rest("orders", `?companion_id=eq.${encodeURIComponent(uid)}&select=id&limit=500`).catch(() => []);
  const orderIds = [...new Set([...(bossOrders || []), ...(compOrders || [])].map((o) => o.id).filter(Boolean))];

  if (orderIds.length) {
    const inOrders = `in.(${orderIds.map(encodeURIComponent).join(",")})`;
    counts.messages_by_order = (counts.messages_by_order || 0) + (await del("messages", `?order_id=${inOrders}`));
    const convs = await rest("conversations", `?order_id=${inOrders}&select=id&limit=500`).catch(() => []);
    const convIds = (convs || []).map((c) => c.id).filter(Boolean);
    if (convIds.length) {
      const inConv = `in.(${convIds.map(encodeURIComponent).join(",")})`;
      counts.messages_by_conv = (counts.messages_by_conv || 0) + (await del("messages", `?conversation_id=${inConv}`));
      counts.conversations = (counts.conversations || 0) + (await del("conversations", `?id=${inConv}`));
    }
    for (const table of [
      "order_grabs",
      "order_status_logs",
      "transactions",
      "companion_earnings",
      "boss_commission_earnings",
      "cs_dock_rewards",
    ]) {
      counts[table] = (counts[table] || 0) + (await del(table, `?order_id=${inOrders}`));
    }
    counts.orders = (counts.orders || 0) + (await del("orders", `?id=${inOrders}`));
  }

  for (const [table, qs] of [
    ["messages", `?sender_id=eq.${encodeURIComponent(uid)}`],
    ["order_grabs", `?companion_id=eq.${encodeURIComponent(uid)}`],
    ["companion_notifications", `?companion_id=eq.${encodeURIComponent(uid)}`],
    ["companion_reviews", `?companion_id=eq.${encodeURIComponent(uid)}`],
    ["companion_withdrawals", `?companion_id=eq.${encodeURIComponent(uid)}`],
    ["companion_earnings", `?companion_id=eq.${encodeURIComponent(uid)}`],
    ["companion_penalties", `?companion_id=eq.${encodeURIComponent(uid)}`],
    ["companion_payment_accounts", `?user_id=eq.${encodeURIComponent(uid)}`],
    ["companion_applications", `?user_id=eq.${encodeURIComponent(uid)}`],
    ["boss_companion_relations", `?or=(boss_id.eq.${encodeURIComponent(uid)},companion_id.eq.${encodeURIComponent(uid)})`],
    ["boss_companion_relation_events", `?or=(boss_id.eq.${encodeURIComponent(uid)},companion_id.eq.${encodeURIComponent(uid)})`],
    ["boss_commission_earnings", `?boss_id=eq.${encodeURIComponent(uid)}`],
    ["invitations", `?or=(inviter_id.eq.${encodeURIComponent(uid)},invitee_id.eq.${encodeURIComponent(uid)})`],
    ["companion_referral_relations", `?or=(inviter_id.eq.${encodeURIComponent(uid)},invitee_id.eq.${encodeURIComponent(uid)})`],
    ["wallets", `?user_id=eq.${encodeURIComponent(uid)}`],
    ["transactions", `?user_id=eq.${encodeURIComponent(uid)}`],
  ]) {
    counts[table] = (counts[table] || 0) + (await del(table, qs));
  }

  if (cpId) {
    counts.companion_media =
      (counts.companion_media || 0) + (await del("companion_media", `?companion_profile_id=eq.${encodeURIComponent(cpId)}`));
    counts.companion_identity =
      (counts.companion_identity || 0) +
      (await del("companion_identity_verifications", `?companion_profile_id=eq.${encodeURIComponent(cpId)}`));
    counts.companion_profiles =
      (counts.companion_profiles || 0) + (await del("companion_profiles", `?id=eq.${encodeURIComponent(cpId)}`));
  }
  counts.companion_profiles_user =
    (counts.companion_profiles_user || 0) + (await del("companion_profiles", `?user_id=eq.${encodeURIComponent(uid)}`));

  for (const bucket of ["companion-public", "companion-gallery", "companion-identities", "avatars", "companion-audio", "companion-video"]) {
    counts[`storage_${bucket}`] = (counts[`storage_${bucket}`] || 0) + (await deleteStoragePrefix(bucket, `${uid}/`));
  }

  counts.profiles = (counts.profiles || 0) + (await del("profiles", `?id=eq.${encodeURIComponent(uid)}`));
  counts.auth_users = (counts.auth_users || 0) + (await deleteAuthUser(uid));
}

async function main() {
  if (!URL || !SERVICE) throw new Error("Missing PROD_SUPABASE_URL / PROD_SUPABASE_SERVICE_ROLE_KEY");
  if (supabaseProjectRef(URL) !== PRODUCTION_SUPABASE_REF) {
    throw new Error(`Expected Production ref ${PRODUCTION_SUPABASE_REF}, got ${supabaseProjectRef(URL)}`);
  }

  const { abs, data } = loadInventory();
  let targets = (data.accounts || []).filter((a) => a && a.userId);
  if (!INCLUDE_ADMIN) {
    targets = targets.filter((a) => String(a.email || "").toLowerCase() !== "admin@meow.test");
  }

  const plan = {
    ok: true,
    apply: APPLY,
    inventoryFile: abs,
    supabaseRef: supabaseProjectRef(URL),
    targetCount: targets.length,
    retainedAdmin: !INCLUDE_ADMIN,
    targets: targets.map((t) => ({
      userId: t.userId,
      email: t.email,
      role: t.role,
      companionProfileId: t.companionProfileId,
      relatedTotal: t.relatedTotal,
      knownContamination: !!t.knownContamination,
    })),
  };

  if (!APPLY) {
    assertProductionSupabaseReadAllowed("prod-smoke-data-purge.mjs(dry-run)", URL);
    console.log(JSON.stringify({ ...plan, message: "Dry-run only. Re-run with --apply and CONFIRM_DELETE_SMOKE=DELETE_PRODUCTION_SMOKE_DATA" }, null, 2));
    return;
  }

  if (!CONFIRM) {
    throw new Error("Refusing apply: set CONFIRM_DELETE_SMOKE=DELETE_PRODUCTION_SMOKE_DATA");
  }
  // Write override gate (throws unless dual flags set).
  assertNonProductionSupabase("prod-smoke-data-purge.mjs", URL);

  const counts = {};
  for (const account of targets) {
    console.log(`[purge] ${account.email} ${account.userId}`);
    await purgeOne(account, counts);
  }

  const result = {
    ...plan,
    deletedCounts: counts,
    finishedAt: new Date().toISOString(),
    message: "Production smoke/test purge applied",
  };
  const out = path.join(root, "artifacts", `prod-smoke-purge-${Date.now()}.json`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error(String(err?.message || err));
  process.exit(1);
});
