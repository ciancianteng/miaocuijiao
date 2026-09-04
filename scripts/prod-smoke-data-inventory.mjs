/**
 * READ-ONLY Production inventory for ProdSmoke / smoke-test data.
 * Does NOT delete anything.
 *
 * Scope (default prodsmoke):
 *   - display_name / nickname matching ProdSmoke|Smoke
 *   - email matching smoke / @mcj-prod-smoke.invalid / known fixture patterns
 *   - known contamination user ids from 2026-09-02 incident
 *   - is_test_account=true
 * NEVER includes admin@meow.test in deleteCandidates.
 *
 * Usage:
 *   ALLOW_PROD_SUPABASE_READ=1 CONFIRM_PROD_READ=I_UNDERSTAND_PROD_READ \
 *   PROD_SUPABASE_URL=https://jqfaknpmcnqwqvatrwgo.supabase.co \
 *   PROD_SUPABASE_SERVICE_ROLE_KEY=... \
 *   node scripts/prod-smoke-data-inventory.mjs
 *
 * Optional: SCOPE=broad  (also match other @meow.test fixtures — still retains admin@meow.test)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  PRODUCTION_SUPABASE_REF,
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
const SCOPE = String(process.env.SCOPE || "prodsmoke").toLowerCase(); // prodsmoke | broad

const KNOWN_CONTAMINATION_USER_IDS = Object.freeze([
  "6d368f4b-7f33-4923-9441-c63cecef2070", // ProdSmokeInviter2
  "9f7fb39a-bec8-47cc-974a-e314ac2f5cd5", // ProdSmokeService2
  "0664ef55-de58-48e3-8dbb-ca8111318e91", // ProdSmokeBoss2
]);

const RETAIN_EMAILS = new Set(["admin@meow.test"]);

const PRODSMOKE_NAME_RE = /prodsmoke|\bsmoke\b/i;
const PRODSMOKE_EMAIL_RE =
  /@mcj-prod-smoke\.invalid\b|smoke\.|prodsmoke|cs\.smoke\.|ui\.accept\./i;
const BROAD_EMAIL_RE = /@meow\.test\b|@mcj-prod-smoke\.invalid\b|fixture|demo|mock/i;
const BROAD_NAME_RE = /smoke|fixture|demo|mock|prodsmoke|测试账号|假陪玩/i;

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
    err.body = data;
    throw err;
  }
  return data;
}

async function countExact(table, qs) {
  try {
    const sep = qs.includes("?") ? "&" : "?";
    const r = await fetch(`${URL}/rest/v1/${table}${qs || ""}${sep}select=id`, {
      method: "GET",
      headers: {
        ...headers(),
        Prefer: "count=exact",
        Range: "0-0",
      },
    });
    const range = r.headers.get("content-range") || "";
    const m = range.match(/\/(\d+)\s*$/);
    if (m) return Number(m[1]);
    if (!r.ok) {
      if (r.status === 404) return null;
      const t = await r.text();
      if (/PGRST205|does not exist|schema cache/i.test(t)) return null;
      return { error: `${r.status} ${t.slice(0, 120)}` };
    }
    return 0;
  } catch (e) {
    if (/PGRST205|does not exist|schema cache|404/i.test(String(e.message || e))) return null;
    return { error: String(e.message || e).slice(0, 160) };
  }
}

function isSmokeCandidate(p) {
  if (!p) return false;
  const email = String(p.email || "").toLowerCase();
  if (RETAIN_EMAILS.has(email)) return false; // never inventory admin as delete candidate here
  if (KNOWN_CONTAMINATION_USER_IDS.includes(p.id)) return true;
  if (p.is_test_account === true || p.is_test === true) return true;
  const name = String(p.display_name || "");
  if (PRODSMOKE_NAME_RE.test(name) || PRODSMOKE_EMAIL_RE.test(email)) return true;
  if (SCOPE === "broad") {
    if (BROAD_EMAIL_RE.test(email) || BROAD_NAME_RE.test(name)) return true;
  }
  return false;
}

async function loadAllProfiles() {
  const out = [];
  let offset = 0;
  const page = 1000;
  for (;;) {
    const rows = await rest(
      "profiles",
      `?select=id,email,role,status,display_name,avatar_url,is_test_account,created_at&order=created_at.asc&limit=${page}&offset=${offset}`
    );
    if (!Array.isArray(rows) || !rows.length) break;
    out.push(...rows);
    if (rows.length < page) break;
    offset += page;
  }
  return out;
}

async function fetchRows(table, qs, limit = 200) {
  try {
    const sep = qs.includes("?") ? "&" : "?";
    const rows = await rest(table, `${qs}${sep}limit=${limit}`);
    return Array.isArray(rows) ? rows : [];
  } catch (e) {
    if (/PGRST205|does not exist|schema cache|404|PGRST204/i.test(String(e.message || e))) return [];
    return [{ _error: String(e.message || e).slice(0, 160) }];
  }
}

async function collectForUser(p) {
  const uid = p.id;
  const email = String(p.email || "").toLowerCase();
  const cpRows = await fetchRows(
    "companion_profiles",
    `?user_id=eq.${encodeURIComponent(uid)}&select=id,nickname,status,is_test_account,card_image_url,avatar_url`
  );
  const cp = cpRows[0] && !cpRows[0]._error ? cpRows[0] : null;
  const cpId = cp?.id || null;

  const ordersAsBoss = await fetchRows(
    "orders",
    `?boss_id=eq.${encodeURIComponent(uid)}&select=id,order_no,status,total_amount,boss_id,companion_id,created_at`
  );
  const ordersAsCompanion = await fetchRows(
    "orders",
    `?companion_id=eq.${encodeURIComponent(uid)}&select=id,order_no,status,total_amount,boss_id,companion_id,created_at`
  );
  const orderMap = new Map();
  for (const o of [...ordersAsBoss, ...ordersAsCompanion]) {
    if (o?.id) orderMap.set(o.id, o);
  }
  const orders = [...orderMap.values()];
  const orderIds = orders.map((o) => o.id);

  const withdrawals = await fetchRows(
    "companion_withdrawals",
    `?companion_id=eq.${encodeURIComponent(uid)}&select=id,status,amount,cat_food_amount,created_at,updated_at`
  );
  const companionEarnings = await fetchRows(
    "companion_earnings",
    `?companion_id=eq.${encodeURIComponent(uid)}&select=id,order_id,amount,status,created_at`
  );
  const bossCommission = await fetchRows(
    "boss_commission_earnings",
    `?boss_id=eq.${encodeURIComponent(uid)}&select=id,order_id,boss_commission_amount,platform_fee_amount,created_at`
  );
  const relations = await fetchRows(
    "boss_companion_relations",
    `?or=(boss_id.eq.${encodeURIComponent(uid)},companion_id.eq.${encodeURIComponent(uid)})&select=id,boss_id,companion_id,status,bound_at`
  );
  const referrals = await fetchRows(
    "companion_referral_relations",
    `?or=(inviter_id.eq.${encodeURIComponent(uid)},invitee_id.eq.${encodeURIComponent(uid)})&select=id,inviter_id,invitee_id,status,created_at`
  );
  const transactions = await fetchRows(
    "transactions",
    `?or=(user_id.eq.${encodeURIComponent(uid)},boss_id.eq.${encodeURIComponent(uid)},companion_id.eq.${encodeURIComponent(uid)})&select=id,order_id,amount,transaction_type,created_at`
  );

  const tableCounts = {
    profiles: 1,
    companion_profiles: cpId ? 1 : await countExact("companion_profiles", `?user_id=eq.${encodeURIComponent(uid)}`),
    companion_applications: await countExact("companion_applications", `?user_id=eq.${encodeURIComponent(uid)}`),
    companion_media: cpId
      ? await countExact("companion_media", `?companion_profile_id=eq.${encodeURIComponent(cpId)}`)
      : await countExact("companion_media", `?user_id=eq.${encodeURIComponent(uid)}`),
    companion_identity_verifications: cpId
      ? await countExact("companion_identity_verifications", `?companion_profile_id=eq.${encodeURIComponent(cpId)}`)
      : await countExact("companion_identity_verifications", `?user_id=eq.${encodeURIComponent(uid)}`),
    companion_payment_accounts: await countExact("companion_payment_accounts", `?user_id=eq.${encodeURIComponent(uid)}`),
    companion_withdrawals: withdrawals.length,
    companion_earnings: companionEarnings.length,
    companion_reviews: await countExact("companion_reviews", `?companion_id=eq.${encodeURIComponent(uid)}`),
    companion_notifications: await countExact("companion_notifications", `?companion_id=eq.${encodeURIComponent(uid)}`),
    orders: orders.length,
    transactions: transactions.length,
    boss_companion_relations: relations.length,
    boss_commission_earnings: bossCommission.length,
    companion_referral_relations: referrals.length,
    invitations: await countExact(
      "invitations",
      `?or=(inviter_id.eq.${encodeURIComponent(uid)},invitee_id.eq.${encodeURIComponent(uid)})`
    ),
    wallets: await countExact("wallets", `?user_id=eq.${encodeURIComponent(uid)}`),
    messages: await countExact("messages", `?sender_id=eq.${encodeURIComponent(uid)}`),
    auth_users: 1,
  };

  if (orderIds.length) {
    const inOrders = `in.(${orderIds.map(encodeURIComponent).join(",")})`;
    tableCounts.order_grabs = await countExact("order_grabs", `?order_id=${inOrders}`);
    tableCounts.order_status_logs = await countExact("order_status_logs", `?order_id=${inOrders}`);
    tableCounts.conversations = await countExact("conversations", `?order_id=${inOrders}`);
    tableCounts.messages_by_order = await countExact("messages", `?order_id=${inOrders}`);
  }

  return {
    userId: uid,
    email,
    role: p.role || "",
    status: p.status || "",
    displayName: p.display_name || "",
    isTestAccount: p.is_test_account === true,
    companionProfileId: cpId,
    companionNickname: cp?.nickname || null,
    knownContamination: KNOWN_CONTAMINATION_USER_IDS.includes(uid),
    retain: false,
    orders,
    withdrawals,
    companionEarnings,
    bossCommissionEarnings: bossCommission,
    relations,
    referrals,
    transactions,
    tableCounts,
    createdAt: p.created_at || null,
  };
}

function aggregatePurgePlan(accounts) {
  const tables = {};
  for (const a of accounts) {
    for (const [table, n] of Object.entries(a.tableCounts || {})) {
      if (typeof n !== "number") continue;
      tables[table] = (tables[table] || 0) + n;
    }
  }
  return {
    willDeleteUserCount: accounts.length,
    willDeleteOrderCount: accounts.reduce((n, a) => n + (a.orders?.length || 0), 0),
    willDeleteWithdrawalCount: accounts.reduce((n, a) => n + (a.withdrawals?.length || 0), 0),
    willDeleteCompanionEarningsCount: accounts.reduce((n, a) => n + (a.companionEarnings?.length || 0), 0),
    willDeleteBossCommissionCount: accounts.reduce((n, a) => n + (a.bossCommissionEarnings?.length || 0), 0),
    tables,
  };
}

async function main() {
  if (!URL || !SERVICE) {
    throw new Error("Missing PROD_SUPABASE_URL / PROD_SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_*)");
  }
  assertProductionSupabaseReadAllowed("prod-smoke-data-inventory.mjs", URL);
  if (supabaseProjectRef(URL) !== PRODUCTION_SUPABASE_REF) {
    throw new Error(`Refusing inventory: expected Production ref ${PRODUCTION_SUPABASE_REF}, got ${supabaseProjectRef(URL)}`);
  }

  const profiles = await loadAllProfiles();
  const adminProfile = profiles.find((p) => String(p.email || "").toLowerCase() === "admin@meow.test") || null;
  const candidates = profiles.filter(isSmokeCandidate);

  const accounts = [];
  for (const p of candidates) {
    accounts.push(await collectForUser(p));
  }
  accounts.sort((a, b) => Number(b.knownContamination) - Number(a.knownContamination));

  const purgePlan = aggregatePurgePlan(accounts);
  const summary = {
    ok: true,
    mode: "inventory_readonly",
    purge: false,
    scope: SCOPE,
    supabaseRef: supabaseProjectRef(URL),
    scannedProfiles: profiles.length,
    retain: {
      emails: [...RETAIN_EMAILS],
      adminFound: !!adminProfile,
      adminUserId: adminProfile?.id || null,
      policy: "admin@meow.test and all non-smoke real users/orders are NOT in deleteCandidates",
    },
    prodSmokeAccountCount: accounts.length,
    deleteCandidates: accounts,
    purgePlan,
    safety: {
      onlySmokeTestData: true,
      retainAdmin: true,
      retainRealUsers: true,
      retainRealOrders: true,
      note: "Purge must use scripts/prod-smoke-data-purge.mjs against this inventory after human confirm. Do not run purge yet.",
    },
    generatedAt: new Date().toISOString(),
  };

  const outDir = path.join(root, "artifacts");
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = Date.now();
  const outFile = path.join(outDir, `prod-smoke-inventory-${stamp}.json`);
  fs.writeFileSync(outFile, JSON.stringify(summary, null, 2));
  try {
    fs.mkdirSync("/opt/cursor/artifacts", { recursive: true });
    fs.writeFileSync(path.join("/opt/cursor/artifacts", path.basename(outFile)), JSON.stringify(summary, null, 2));
  } catch {
    /* ignore */
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        outFile,
        scope: SCOPE,
        scannedProfiles: summary.scannedProfiles,
        prodSmokeAccountCount: summary.prodSmokeAccountCount,
        retain: summary.retain,
        purgePlan: summary.purgePlan,
        accountsPreview: accounts.map((a) => ({
          email: a.email,
          role: a.role,
          userId: a.userId,
          displayName: a.displayName,
          orders: a.orders.length,
          withdrawals: a.withdrawals.length,
          companionEarnings: a.companionEarnings.length,
          bossCommission: a.bossCommissionEarnings.length,
        })),
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(String(err?.message || err));
  process.exit(1);
});
