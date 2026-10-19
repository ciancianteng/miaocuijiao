/**
 * Credit settled CS dock rewards that have no wallet ledger row.
 * One credit per order. Does not change orders or existing transactions.
 *
 * ALLOW_PROD_SUPABASE_WRITE=1
 * CONFIRM_PROD_WRITE=I_UNDERSTAND_PROD_RISK
 */
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { loadEnvFiles, PRODUCTION_SUPABASE_REF } from "./lib/prod-guard.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnvFiles(root);
loadEnvFiles("C:/Users/cianc/Desktop/meow-cuijiao-homepage/meow-cuijiao-homepage");

function refOf(dbUrl) {
  const user = decodeURIComponent(new URL(String(dbUrl || "")).username || "");
  const match = user.match(/^postgres\.([a-z0-9]+)$/i);
  return match ? match[1].toLowerCase() : "";
}

async function main() {
  if (process.env.ALLOW_PROD_SUPABASE_WRITE !== "1" || process.env.CONFIRM_PROD_WRITE !== "I_UNDERSTAND_PROD_RISK") {
    throw new Error("Refusing: production write confirmation is missing");
  }
  const dbUrl = String(process.env.DATABASE_URL || "").trim();
  if (refOf(dbUrl) !== PRODUCTION_SUPABASE_REF) throw new Error("Refusing: not Production");
  const pg = createRequire(path.resolve(root, "..", "meow-cuijiao-homepage", "package.json"))("pg");
  const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 25000 });
  await client.connect();
  try {
    const missing = await client.query(`
      select r.id, r.service_id, r.order_id, r.order_no, r.amount_cat_food, p.display_name
      from public.cs_dock_rewards r
      join public.profiles p on p.id = r.service_id
      where r.status = 'settled'
        and r.amount_cat_food > 0
        and not exists (
          select 1 from public.wallet_transactions t
          where t.idempotency_key = 'cs-dock-reward:' || r.order_id::text
        )
      order by p.display_name, r.order_no
    `);
    const credited = [];
    for (const row of missing.rows) {
      const key = `cs-dock-reward:${row.order_id}`;
      const result = await client.query(
        `select public.mcj_wallet_credit($1,$2,$3,$4,$5,$6,$7,$8,$9,null,null,null,null,0) as result`,
        [
          row.service_id,
          "cs_dock_reward",
          row.amount_cat_food,
          "bonus",
          key,
          `客服订单对接奖励 ${row.order_no}`,
          `cs_dock_reward:${row.id}`,
          null,
          row.order_id,
        ]
      );
      const body = result.rows[0].result;
      credited.push({
        name: row.display_name,
        orderNo: row.order_no,
        amount: row.amount_cat_food,
        duplicate: !!body.duplicate,
        transactionId: body.transaction?.id || "",
      });
    }
    const balances = await client.query(`
      select p.display_name, w.bonus_balance, w.total_balance,
             (select count(*)::int from public.wallet_transactions t where t.boss_id = p.id and t.idempotency_key like 'cs-dock-reward:%') as credits,
             (select coalesce(sum(t.amount),0) from public.wallet_transactions t where t.boss_id = p.id and t.transaction_type = 'cs_dock_reward' and t.direction = 'credit') as credited_sum
      from public.profiles p
      join public.wallets w on w.boss_id = p.id
      where p.display_name in ('MCJ客服-Fish', 'MCJ客服-小喵')
    `);
    const stillMissing = await client.query(`
      select count(*)::int as n from public.cs_dock_rewards r
      where r.status = 'settled' and r.amount_cat_food > 0
        and not exists (
          select 1 from public.wallet_transactions t
          where t.idempotency_key = 'cs-dock-reward:' || r.order_id::text
        )
    `);
    console.log(JSON.stringify({
      creditedCount: credited.length,
      credited,
      balances: balances.rows,
      stillMissing: stillMissing.rows[0].n,
    }, null, 2));
    if (stillMissing.rows[0].n !== 0) throw new Error("some settled rewards still have no ledger");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
