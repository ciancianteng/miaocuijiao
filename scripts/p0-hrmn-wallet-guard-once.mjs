#!/usr/bin/env node
/**
 * Production-only guard for boss hrmn.
 * Does not credit, debit, or touch any other boss.
 * - Installs a refund cap when a system-anomaly reversal already exists.
 * - Relabels the existing compensation row so the boss sees 系统异常补偿.
 * - Leaves balances unchanged. Aborts if they move.
 */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { PRODUCTION_SUPABASE_REF } from "./lib/prod-guard.mjs";

const require = createRequire("C:/Users/cianc/Desktop/meow-cuijiao-homepage/meow-cuijiao-homepage/package.json");
const { Client } = require("pg");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseEnv(p) {
  const o = {};
  if (!fs.existsSync(p)) return o;
  for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Za-z0-9_]+)=(.*)$/);
    if (!m) continue;
    let v = m[2];
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (v && !/\[SENSITIVE\]/i.test(v)) o[m[1]] = v;
  }
  return o;
}

const env = parseEnv("C:/Users/cianc/Desktop/meow-cuijiao-homepage/meow-cuijiao-homepage/.env.local");
const dbUrl = env.DATABASE_URL || env.PRODUCTION_DATABASE_URL || "";
if (!dbUrl || !dbUrl.includes(PRODUCTION_SUPABASE_REF)) {
  console.error("REFUSE: DATABASE_URL is not the production project");
  process.exit(2);
}

const BOSS = "f89e7fc8-f424-4ab4-9a1b-cbfec45bd872";
const TX = "ce99b431-e64d-433b-8674-07bfe8f9fd8a";
const ORDER = "4f08aee7-01c6-4437-816f-ccaeed1de82f";

const sql = `
create or replace function public.mcj_block_anomaly_double_refund()
returns trigger
language plpgsql
as $$
declare
  debited numeric := 0;
  returned numeric := 0;
begin
  if new.direction is distinct from 'credit' then
    return new;
  end if;
  if new.transaction_type not in ('refund', 'order_refund') then
    return new;
  end if;
  if new.related_order_id is null then
    return new;
  end if;
  if not exists (
    select 1 from public.wallet_transactions t
    where t.related_order_id = new.related_order_id
      and t.direction = 'credit'
      and t.transaction_type in ('system_anomaly_compensation', '系统异常补偿')
  ) then
    return new;
  end if;
  -- Anomaly credits offset the voided premature debit, not a later real charge.
  select coalesce(sum(amount), 0) into debited
  from public.wallet_transactions
  where related_order_id = new.related_order_id
    and direction = 'debit'
    and transaction_type = 'order_payment';
  select coalesce(sum(amount), 0) into returned
  from public.wallet_transactions
  where related_order_id = new.related_order_id
    and direction = 'credit'
    and transaction_type in ('refund', 'order_refund');
  if returned + new.amount > debited + 0.001 then
    raise exception 'refund exceeds unreimbursed order debit';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_mcj_block_anomaly_double_refund on public.wallet_transactions;
create trigger trg_mcj_block_anomaly_double_refund
before insert on public.wallet_transactions
for each row execute function public.mcj_block_anomaly_double_refund();
`;

const client = new Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  await client.query("begin");
  const before = await client.query(
    "select paid_balance, bonus_balance, held_balance, total_balance from public.wallets where boss_id = $1",
    [BOSS]
  );
  const w0 = before.rows[0];
  if (!w0 || Number(w0.paid_balance) !== 100 || Number(w0.bonus_balance) !== 5 || Number(w0.held_balance) !== 0) {
    throw new Error("REFUSE: wallet is not 100 paid / 5 bonus / 0 held, will not continue");
  }
  const grabs = await client.query(
    "select id, companion_id, status from public.order_grabs where order_id = $1",
    [ORDER]
  ).catch((err) => ({ rows: [], error: err.message }));
  await client.query(sql);
  const DEBIT = "5617df08-1d0e-4110-96fb-3c9603f1f650";
  const voidDebit = await client.query(
    `update public.wallet_transactions
        set transaction_type = '订单消费',
            internal_note = coalesce(internal_note, '') || ' | machine_type=order_payment premature hall debit; reversed by 系统异常补偿; a later confirm may charge once'
      where id = $1
        and boss_id = $2
        and related_order_id = $3
        and idempotency_key = 'order-pay:MCJO000435'
        and amount = 40
        and direction = 'debit'
        and transaction_type = 'order_payment'
      returning id, transaction_type, amount`,
    [DEBIT, BOSS, ORDER]
  );
  const relabel = await client.query(
    `update public.wallet_transactions
        set transaction_type = '系统异常补偿',
            internal_note = case
              when internal_note like '%machine_type=system_anomaly_compensation%' then internal_note
              else internal_note || ' | machine_type=system_anomaly_compensation'
            end
      where id = $1
        and boss_id = $2
        and idempotency_key = 'system-anomaly:MCJO000435:hrmn:v1'
        and amount = 40
        and direction = 'credit'
        and transaction_type in ('system_anomaly_compensation', '系统异常补偿')
      returning id, transaction_type, amount, paid_balance_after, bonus_balance_after`,
    [TX, BOSS]
  );
  const after = await client.query(
    "select paid_balance, bonus_balance, held_balance, total_balance from public.wallets where boss_id = $1",
    [BOSS]
  );
  const w1 = after.rows[0];
  if (Number(w1.paid_balance) !== 100 || Number(w1.bonus_balance) !== 5 || Number(w1.held_balance) !== 0) {
    throw new Error("REFUSE: balance changed, rolling back");
  }
  const others = await client.query(
    "select count(*)::int as n from public.wallets where boss_id <> $1 and updated_at > now() - interval '2 minutes'",
    [BOSS]
  );
  await client.query("commit");
  console.log(JSON.stringify({
    ok: true,
    before: w0,
    after: w1,
    voidedPrematureDebit: voidDebit.rowCount,
    relabelled: relabel.rowCount,
    type: relabel.rows[0]?.transaction_type || "unchanged",
    grabs: grabs.rows || [],
    grabError: grabs.error || null,
    otherWalletsTouched: others.rows[0].n,
  }, null, 2));
} catch (err) {
  await client.query("rollback").catch(() => {});
  console.error("FAILED", err.message);
  process.exit(1);
} finally {
  await client.end();
}
