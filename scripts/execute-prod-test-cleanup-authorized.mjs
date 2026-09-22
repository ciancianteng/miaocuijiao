#!/usr/bin/env node
/**
 * AUTHORIZED Production cleanup of CONFIRMED test-only rows from PROD_TEST_CLEANUP_MANIFEST.json.
 *
 * Requires BOTH:
 *   ALLOW_PROD_SUPABASE_WRITE=1
 *   CONFIRM_PROD_WRITE=I_UNDERSTAND_PROD_RISK
 *
 * Gates before mutate:
 *   REAL_USER_MATCH === 0
 *   UNPROVEN_ROW treated as non-delete (suspected never touched)
 *   every row delete_eligible === true
 *
 * Uses Postgres transaction when DATABASE_URL (Production) available; else REST best-effort
 * with pre/post invariant checks (still refuse without dual flags).
 *
 * NEVER patches opening ledger / fake balances (§23).
 * NEVER auto-fixes real-user wallet DIFF (§24).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PRODUCTION_SUPABASE_REF } from "./lib/prod-guard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "artifacts/prod-test-cleanup");
const manifestPath = path.join(outDir, "PROD_TEST_CLEANUP_MANIFEST.json");
const DRY = process.env.DRY_RUN === "1";

function parseEnv(p) {
  const o = {};
  if (!fs.existsSync(p)) return o;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    o[m[1]] = v;
  }
  return o;
}

function prodWriteOverrideAllowed() {
  return (
    process.env.ALLOW_PROD_SUPABASE_WRITE === "1" &&
    process.env.CONFIRM_PROD_WRITE === "I_UNDERSTAND_PROD_RISK"
  );
}

if (!prodWriteOverrideAllowed()) {
  console.error("REFUSE: set ALLOW_PROD_SUPABASE_WRITE=1 and CONFIRM_PROD_WRITE=I_UNDERSTAND_PROD_RISK");
  process.exit(2);
}

if (!fs.existsSync(manifestPath)) {
  console.error("REFUSE: missing manifest. Run scripts/build-prod-test-cleanup-manifest.mjs first.");
  process.exit(2);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
if (manifest.gates?.REAL_USER_MATCH !== 0) {
  console.error("REFUSE: REAL_USER_MATCH != 0");
  process.exit(2);
}
if (manifest.gates?.DELETE_ALLOWED !== "READY_FOR_AUTHORIZED_EXECUTE") {
  console.error("REFUSE: DELETE_ALLOWED gate not ready:", manifest.gates?.DELETE_ALLOWED);
  process.exit(2);
}

const rows = (manifest.confirmed_rows || []).filter((r) => r.delete_eligible === true);
const suspected = manifest.suspected_rows || [];
if (suspected.some((s) => s.delete_eligible)) {
  console.error("REFUSE: suspected row marked delete_eligible");
  process.exit(2);
}

const env = parseEnv(path.join(root, "../meow-cuijiao-homepage/.env.local"));
const url = String(env.SUPABASE_URL || "").replace(/\/$/, "");
const key = env.SUPABASE_SERVICE_ROLE_KEY || "";
const dbUrl = String(env.DATABASE_URL || process.env.DATABASE_URL || "").trim();
if (!url || !key || new URL(url).hostname.split(".")[0] !== PRODUCTION_SUPABASE_REF) {
  console.error("REFUSE: credentials are not Production");
  process.exit(2);
}

const DELETE_ORDER = [
  "gift_transactions",
  "companion_withdrawals",
  "wallet_transactions",
  "transactions",
  "orders",
  "wallets",
  "companion_profiles",
  "profiles",
];

/** Order-scoped dependents (safe: only rows whose order_id is a confirmed test order). */
const ORDER_DEPENDENT_DELETES = [
  ["messages", "order_id"],
  ["companion_reviews", "order_id"],
  ["companion_penalties", "order_id"],
  ["order_grabs", "order_id"],
  ["payment_receipts", "order_id"],
  ["payment_transactions", "order_id"],
  ["service_receptions", "order_id"],
  ["cs_commission_settlements", "order_id"],
  ["cs_dock_rewards", "order_id"],
  ["user_points_ledger", "related_order_id"],
  ["conversations", "order_id"],
  ["transactions", "order_id"],
];

/** Profile-owned dependents (ownership cols only — never delete by reviewed_by/operator). */
const PROFILE_OWNED_DELETES = [
  ["messages", "sender_id"],
  ["boss_notifications", "boss_id"],
  ["boss_refund_requests", "boss_id"],
  ["boss_vip_history", "boss_id"],
  ["boss_vip_status", "boss_id"],
  ["boss_companion_relation_events", "companion_id"],
  ["boss_companion_relation_events", "from_boss_id"],
  ["boss_companion_relation_events", "to_boss_id"],
  ["boss_companion_relations", "boss_id"],
  ["boss_companion_relations", "companion_id"],
  ["companion_deposits", "user_id"],
  ["companion_identity_verifications", "user_id"],
  ["companion_media", "user_id"],
  ["companion_notification_reads", "companion_id"],
  ["companion_notifications", "companion_id"],
  ["companion_withdrawals", "companion_id"],
  ["companion_payment_accounts", "user_id"],
  ["companion_penalties", "companion_id"],
  ["companion_reviews", "boss_id"],
  ["companion_reviews", "companion_id"],
  ["companion_services", "companion_id"],
  ["compensation_requests", "applicant_id"],
  ["compensation_requests", "boss_id"],
  ["content_ack_records", "user_id"],
  ["conversations", "boss_id"],
  ["conversations", "companion_id"],
  ["conversations", "customer_service_id"],
  ["cs_attendance_sessions", "service_id"],
  ["cs_commission_settlements", "boss_id"],
  ["cs_commission_settlements", "service_id"],
  ["cs_dock_rewards", "boss_id"],
  ["cs_dock_rewards", "service_id"],
  ["customer_service_reports", "customer_service_id"],
  ["order_grabs", "companion_id"],
  ["payment_orders", "boss_id"],
  ["payment_receipts", "boss_id"],
  ["payment_transactions", "boss_id"],
  ["payout_requests", "applicant_id"],
  ["payout_source_locks", "applicant_id"],
  ["referral_commission_records", "invited_user_id"],
  ["referral_commission_records", "inviter_user_id"],
  ["referral_commission_rules", "invited_user_id"],
  ["referral_commission_rules", "inviter_user_id"],
  ["referral_relations", "invited_user_id"],
  ["referral_relations", "inviter_user_id"],
  ["referral_wallets", "user_id"],
  ["service_receptions", "boss_id"],
  ["service_receptions", "customer_service_id"],
  ["staff_notifications", "staff_id"],
  ["staff_payrolls", "staff_id"],
  ["user_points_accounts", "user_id"],
  ["user_points_ledger", "user_id"],
  ["wallet_order_holds", "boss_id"],
  ["wallet_transactions", "boss_id"],
  ["gift_transactions", "sender_boss_id"],
  ["gift_transactions", "receiver_companion_id"],
  ["finance_payments", "payee_user_id"],
  ["invite_attributions", "inviter_id"],
  ["invite_attributions", "invitee_id"],
  ["invite_reward_ledger", "inviter_id"],
  ["invite_reward_ledger", "invitee_id"],
  ["invite_cash_wallets", "user_id"],
  ["companion_income", "companion_id"],
];

/** Soft refs on other rows pointing AT test users — null only, never delete those rows. */
const SOFT_NULL_REFS = [
  ["boss_companion_relation_events", "operator_id"],
  ["boss_companion_relations", "bound_by"],
  ["companion_deposits", "reviewed_by"],
  ["companion_identity_verifications", "reviewed_by"],
  ["companion_media", "reviewed_by"],
  ["companion_payment_accounts", "reviewed_by"],
  ["companion_penalties", "operator_id"],
  ["companion_withdrawals", "approved_by"],
  ["companion_withdrawals", "confirmed_by"],
  ["companion_withdrawals", "paid_by"],
  ["companion_withdrawals", "reviewed_by"],
  ["compensation_requests", "reviewer_id"],
  ["conversations", "closed_by"],
  ["finance_payments", "confirmed_by"],
  ["finance_payments", "created_by"],
  ["finance_receipts", "uploaded_by"],
  ["orders", "customer_service_id"],
  ["payment_receipts", "confirmed_by"],
  ["payment_receipts", "reviewed_by"],
  ["payment_transactions", "confirmed_by"],
  ["payout_requests", "paid_by"],
  ["payout_requests", "reviewed_by"],
  ["referral_commission_rules", "created_by"],
  ["referral_commission_rules", "updated_by"],
  ["staff_payrolls", "approved_by"],
  ["staff_payrolls", "confirmed_by"],
  ["staff_payrolls", "reviewed_by"],
  ["wallet_transactions", "operator_id"],
];

const PROTECTED_IDS = new Set([
  "6f31b706-11e7-42df-8db1-d2caccd796de",
  "458ce9ad-3425-42b1-ab66-24bca342f971",
]);

function groupByTable(list) {
  const m = new Map();
  for (const r of list) {
    if (!m.has(r.table)) m.set(r.table, []);
    m.get(r.table).push(r);
  }
  return m;
}

const byTable = groupByTable(rows);
const profileIds = [...new Set((byTable.get("profiles") || []).map((r) => r.row_id).filter(Boolean))];
const orderIds = [...new Set((byTable.get("orders") || []).map((r) => r.row_id).filter(Boolean))];

if (profileIds.some((id) => PROTECTED_IDS.has(id))) {
  console.error("REFUSE: protected real user in delete set");
  process.exit(2);
}

async function restDelete(table, ids) {
  if (!ids.length) return { ok: true, deleted: 0 };
  const chunk = ids.slice(0, 80);
  const inList = `(${chunk.map((id) => `"${id}"`).join(",")})`;
  const idCol = table === "wallets" ? "boss_id" : "id";
  const res = await fetch(`${url}/rest/v1/${table}?${idCol}=in.${inList}`, {
    method: "DELETE",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: "return=representation",
    },
  });
  const text = await res.text();
  let body = [];
  try {
    body = text ? JSON.parse(text) : [];
  } catch {
    body = [];
  }
  if (!res.ok) {
    throw new Error(`${table} delete failed ${res.status} ${text.slice(0, 300)}`);
  }
  return { ok: true, deleted: Array.isArray(body) ? body.length : chunk.length };
}

async function tableExists(client, table) {
  const r = await client.query(`SELECT to_regclass($1) AS reg`, [`public.${table}`]);
  return Boolean(r.rows[0]?.reg);
}

async function delWhere(client, table, col, ids, bucket) {
  if (!ids.length) return 0;
  if (!(await tableExists(client, table))) return 0;
  try {
    const r = await client.query(
      `DELETE FROM public.${table} WHERE ${col} = ANY($1::uuid[]) RETURNING 1`,
      [ids]
    );
    const key = `${table}.${col}`;
    bucket[key] = (bucket[key] || 0) + r.rowCount;
    return r.rowCount;
  } catch (e) {
    const msg = String(e?.message || e);
    if (/does not exist|42703|42P01/i.test(msg)) {
      bucket[`${table}.${col}`] = `skipped:${msg.slice(0, 80)}`;
      return 0;
    }
    throw e;
  }
}

async function nullWhere(client, table, col, ids, bucket) {
  if (!ids.length) return 0;
  if (!(await tableExists(client, table))) return 0;
  try {
    const r = await client.query(
      `UPDATE public.${table} SET ${col} = NULL WHERE ${col} = ANY($1::uuid[]) RETURNING 1`,
      [ids]
    );
    const key = `null:${table}.${col}`;
    bucket[key] = (bucket[key] || 0) + r.rowCount;
    return r.rowCount;
  } catch (e) {
    const msg = String(e?.message || e);
    if (/does not exist|42703|42P01/i.test(msg)) {
      bucket[`null:${table}.${col}`] = `skipped:${msg.slice(0, 80)}`;
      return 0;
    }
    throw e;
  }
}

async function runViaPostgres() {
  const { default: pg } = await import("pg");
  const client = new pg.Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  const dbRef = (() => {
    try {
      const u = new URL(dbUrl);
      const host = u.hostname || "";
      const m = host.match(/^db\.([a-z0-9]+)\.supabase\.co$/i);
      if (m) return m[1];
      if (host.includes(PRODUCTION_SUPABASE_REF)) return PRODUCTION_SUPABASE_REF;
      const user = decodeURIComponent(u.username || "");
      const um = user.match(/^postgres\.([a-z0-9]+)$/i);
      return um ? um[1] : "";
    } catch {
      return "";
    }
  })();
  if (dbRef !== PRODUCTION_SUPABASE_REF) {
    await client.end();
    throw new Error(`DATABASE_URL ref ${dbRef} is not Production`);
  }

  const result = { via: "postgres", deleted: {}, dependents: {}, soft_nulls: {}, dry: DRY };
  try {
    await client.query("BEGIN");

    // Invariant: never touch protected profiles
    const hit = await client.query(
      `SELECT id FROM public.profiles WHERE id = ANY($1::uuid[])`,
      [[...PROTECTED_IDS]]
    );
    if (hit.rowCount !== PROTECTED_IDS.size) {
      // protected may exist; just ensure none of them are in our delete set (already checked)
    }

    if (DRY) {
      for (const table of DELETE_ORDER) {
        const list = byTable.get(table) || [];
        if (!list.length) continue;
        result.deleted[table] = { planned: [...new Set(list.map((r) => r.row_id))].length };
      }
      result.dependents.planned_order_ids = orderIds.length;
      result.dependents.planned_profile_ids = profileIds.length;
      await client.query("ROLLBACK");
      result.rolled_back = true;
      return result;
    }

    // 1) Soft-null reviewer/operator refs pointing at test users (metadata only)
    for (const [table, col] of SOFT_NULL_REFS) {
      await nullWhere(client, table, col, profileIds, result.soft_nulls);
    }

    // 2) Order dependents for confirmed test orders
    for (const [table, col] of ORDER_DEPENDENT_DELETES) {
      await delWhere(client, table, col, orderIds, result.dependents);
    }

    // 3) Detach child orders that parent onto test orders (children of test parents only)
    if (orderIds.length && (await tableExists(client, "orders"))) {
      await client.query(
        `UPDATE public.orders SET parent_order_id = NULL WHERE parent_order_id = ANY($1::uuid[])`,
        [orderIds]
      );
    }

    // 4) Profile-owned dependents
    // finance_receipts must go before finance_payments (payment_id FK)
    if (profileIds.length && (await tableExists(client, "finance_payments"))) {
      try {
        const pay = await client.query(
          `SELECT id FROM public.finance_payments WHERE payee_user_id = ANY($1::uuid[])`,
          [profileIds]
        );
        const payIds = pay.rows.map((r) => r.id).filter(Boolean);
        if (payIds.length && (await tableExists(client, "finance_receipts"))) {
          const rr = await client.query(
            `DELETE FROM public.finance_receipts WHERE payment_id = ANY($1::uuid[]) RETURNING 1`,
            [payIds]
          );
          result.dependents["finance_receipts.payment_id"] = rr.rowCount;
        }
      } catch (e) {
        const msg = String(e?.message || e);
        if (!/does not exist|42703|42P01/i.test(msg)) throw e;
      }
    }
    for (const [table, col] of PROFILE_OWNED_DELETES) {
      await delWhere(client, table, col, profileIds, result.dependents);
    }

    // 5) Manifest core tables
    for (const table of DELETE_ORDER) {
      const list = byTable.get(table) || [];
      if (!list.length) continue;
      const ids = [...new Set(list.map((r) => r.row_id).filter(Boolean))];
      const idCol = table === "wallets" ? "boss_id" : "id";
      if (!(await tableExists(client, table))) {
        result.deleted[table] = { skipped: "missing_table" };
        continue;
      }
      // Child orders first when deleting orders
      if (table === "orders") {
        const child = await client.query(
          `DELETE FROM public.orders WHERE parent_order_id = ANY($1::uuid[]) RETURNING id`,
          [ids]
        );
        result.deleted["orders.children"] = { deleted: child.rowCount };
      }
      const q = `DELETE FROM public.${table} WHERE ${idCol} = ANY($1::uuid[]) RETURNING ${idCol}`;
      const r = await client.query(q, [ids]);
      result.deleted[table] = { deleted: r.rowCount };
    }

    // 6) Real-user invariant: protected profiles still present
    const still = await client.query(`SELECT id FROM public.profiles WHERE id = ANY($1::uuid[])`, [
      [...PROTECTED_IDS],
    ]);
    if (still.rowCount < PROTECTED_IDS.size) {
      throw new Error(`REAL_DATA_TOUCHED: protected profiles missing after delete (${still.rowCount})`);
    }

    // Auth users: best-effort only when no remaining profile FKs
    try {
      const authDel = await client.query(
        `DELETE FROM auth.users WHERE id = ANY($1::uuid[])
         AND NOT EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.users.id)
         RETURNING id`,
        [profileIds]
      );
      result.deleted["auth.users"] = { deleted: authDel.rowCount };
    } catch (authErr) {
      result.deleted["auth.users"] = { skipped: String(authErr.message || authErr).slice(0, 200) };
    }

    await client.query("COMMIT");
    result.committed = true;
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    throw e;
  } finally {
    await client.end();
  }
  return result;
}

async function runViaRest() {
  throw new Error("REFUSE: REST path disabled for §22 — require Production DATABASE_URL transaction");
}

const out = {
  started_at: new Date().toISOString(),
  dry_run: DRY,
  manifest_gates: manifest.gates,
  suspected_untouched: suspected.length,
};
try {
  if (dbUrl && dbUrl.includes(PRODUCTION_SUPABASE_REF)) {
    out.result = await runViaPostgres();
  } else {
    console.warn("No Production DATABASE_URL — using REST deletes (no single SQL transaction).");
    out.result = await runViaRest();
  }
  out.ok = true;
} catch (e) {
  out.ok = false;
  out.error = String(e?.message || e);
}

fs.writeFileSync(path.join(outDir, "EXECUTE_RESULT.json"), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 2));
process.exit(out.ok ? 0 : 1);
