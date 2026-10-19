/**
 * Apply the additive order-renewal columns to Production only.
 *
 * Human gates, both required:
 *   ALLOW_PROD_SUPABASE_WRITE=1
 *   CONFIRM_PROD_WRITE=I_UNDERSTAND_PROD_RISK
 *
 * Adds columns and indexes. Does not update, delete, or rebuild orders or wallet rows.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { loadEnvFiles, PRODUCTION_SUPABASE_REF } from "./lib/prod-guard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnvFiles(root);
loadEnvFiles(process.cwd());
loadEnvFiles(path.resolve(root, "..", "meow-cuijiao-homepage"));

const SQL_PATH = path.join(root, "supabase", "migrations", "20261008_order_renewal.sql");

function projectRefFromDatabaseUrl(dbUrl) {
  const u = new URL(String(dbUrl || ""));
  const host = (u.hostname || "").toLowerCase();
  const direct = host.match(/^db\.([a-z0-9]+)\.supabase\.co$/i);
  if (direct) return direct[1].toLowerCase();
  const user = decodeURIComponent(u.username || "");
  const fromUser = user.match(/^postgres\.([a-z0-9]+)$/i);
  if (fromUser) return fromUser[1].toLowerCase();
  if (host.includes(PRODUCTION_SUPABASE_REF)) return PRODUCTION_SUPABASE_REF;
  return "";
}

function assertSqlAdditive(sql) {
  const stripped = sql.replace(/--.*$/gm, "");
  if (/\bdrop\s+table\b|\btruncate\b|\bdelete\s+from\b|\bupdate\s+[a-z0-9_.]+\s+set\b|\balter\s+table\b[^;]*\bdrop\b/i.test(stripped)) {
    throw new Error("Refusing SQL that drops, truncates, deletes, or updates rows");
  }
}

async function snapshot(client) {
  const cols = await client.query(`
    select column_name
    from information_schema.columns
    where table_schema = 'public' and table_name = 'orders'
      and column_name in ('is_renewal', 'renewal_of_order_id', 'renewal_source_order_no')
    order by column_name
  `);
  const indexes = await client.query(`
    select indexname
    from pg_indexes
    where schemaname = 'public'
      and indexname in ('idx_orders_renewal_of', 'idx_orders_one_open_renewal')
    order by indexname
  `);
  const counts = await client.query(`
    select
      (select count(*)::int from public.orders) as orders,
      (select count(*)::int from public.wallet_transactions) as wallet_transactions,
      (select md5(coalesce(string_agg(
        id::text || '|' || coalesce(status::text, '') || '|' || coalesce(total_amount::text, '') || '|' || coalesce(order_no, ''),
        ',' order by id
      ), '')) from public.orders) as orders_fingerprint
  `);
  const wallet = await client.query(`
    select md5(coalesce(string_agg(id::text || '|' || coalesce(amount::text, ''), ',' order by id), '')) as wallet_fingerprint
    from public.wallet_transactions
  `);
  return {
    columns: cols.rows.map((row) => row.column_name),
    indexes: indexes.rows.map((row) => row.indexname),
    orders: counts.rows[0].orders,
    walletTransactions: counts.rows[0].wallet_transactions,
    ordersFingerprint: counts.rows[0].orders_fingerprint,
    walletFingerprint: wallet.rows[0].wallet_fingerprint,
  };
}

async function main() {
  if (process.env.ALLOW_PROD_SUPABASE_WRITE !== "1" || process.env.CONFIRM_PROD_WRITE !== "I_UNDERSTAND_PROD_RISK") {
    throw new Error("Refusing: production write confirmation is missing");
  }
  const dbUrl = String(process.env.DATABASE_URL || process.env.PRODUCTION_DATABASE_URL || "").trim();
  const ref = projectRefFromDatabaseUrl(dbUrl);
  if (ref !== PRODUCTION_SUPABASE_REF) {
    throw new Error(`Refusing: database ref ${ref || "missing"} is not Production`);
  }
  const sql = fs.readFileSync(SQL_PATH, "utf8");
  assertSqlAdditive(sql);

  const require = createRequire(path.resolve(root, "..", "meow-cuijiao-homepage", "package.json"));
  const pg = require("pg");
  const client = new pg.Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 25000,
  });
  await client.connect();
  try {
    const before = await snapshot(client);
    await client.query("begin");
    await client.query(sql);
    const after = await snapshot(client);
    if (after.orders !== before.orders || after.walletTransactions !== before.walletTransactions) {
      throw new Error("Row counts changed; rolling back");
    }
    if (after.ordersFingerprint !== before.ordersFingerprint || after.walletFingerprint !== before.walletFingerprint) {
      throw new Error("Existing order or wallet rows changed; rolling back");
    }
    const expectedCols = ["is_renewal", "renewal_of_order_id", "renewal_source_order_no"];
    const expectedIdx = ["idx_orders_one_open_renewal", "idx_orders_renewal_of"];
    for (const name of expectedCols) {
      if (!after.columns.includes(name)) throw new Error("Missing column " + name);
    }
    for (const name of expectedIdx) {
      if (!after.indexes.includes(name)) throw new Error("Missing index " + name);
    }
    await client.query("commit");
    console.log(JSON.stringify({
      ok: true,
      ref,
      beforeColumns: before.columns,
      afterColumns: after.columns,
      afterIndexes: after.indexes,
      orders: after.orders,
      walletTransactions: after.walletTransactions,
      ordersUnchanged: true,
      walletUnchanged: true,
    }, null, 2));
  } catch (err) {
    try { await client.query("rollback"); } catch { /* ignore */ }
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
