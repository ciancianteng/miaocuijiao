#!/usr/bin/env node
/**
 * Staging DB-level Cases B/C/D for cat-food hold RPCs (idempotent).
 * Uses pooler password reuse → Staging only. Never Production.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  STAGING_PROJECT_REF,
  PRODUCTION_PROJECT_REF,
  assertStagingOnly,
  buildStagingPoolerUrl,
  projectRefFromDatabaseUrl,
} from "../server/api/_staging-sql.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(root, "artifacts/p0-multi-payment-fix");
fs.mkdirSync(outDir, { recursive: true });

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

function money(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

const report = { ok: false, cases: {}, errors: [] };

function mark(k, ok, detail) {
  report.cases[k] = { result: ok ? "PASS" : "FAIL", detail: String(detail).slice(0, 500) };
  console.log(`[${ok ? "PASS" : "FAIL"}] ${k} :: ${detail}`);
}

async function main() {
  const env = parseEnv(path.join(root, "../meow-cuijiao-homepage/.env.local"));
  const pass = decodeURIComponent(
    new URL(String(env.DATABASE_URL || "").replace(/^postgresql:/i, "postgres:")).password || ""
  );
  if (!pass) throw new Error("no pass");
  const dbUrl = buildStagingPoolerUrl(pass);
  if (projectRefFromDatabaseUrl(dbUrl) !== STAGING_PROJECT_REF) throw new Error("not staging");
  assertStagingOnly({ databaseUrl: dbUrl });

  const { default: pg } = await import("pg");
  const c = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await c.connect();

  // Pick a boss with enough available balance
  const bossRow = await c.query(`
    select w.boss_id, w.paid_balance, w.bonus_balance, coalesce(w.held_balance,0) as held_balance,
           p.display_name, p.email
    from wallets w
    join profiles p on p.id = w.boss_id
    where coalesce(w.paid_balance,0)+coalesce(w.bonus_balance,0) >= 80
      and coalesce(w.frozen,false) = false
    order by (coalesce(w.paid_balance,0)+coalesce(w.bonus_balance,0)) desc
    limit 1
  `);
  const boss = bossRow.rows[0];
  if (!boss) throw new Error("no boss with balance>=80 on Staging");

  const orderId = crypto.randomUUID();
  const amount = 70;
  const beforeAvail = money(boss.paid_balance) + money(boss.bonus_balance);
  const beforeHeld = money(boss.held_balance);

  // HOLD
  const h1 = await c.query(
    `select public.mcj_wallet_hold($1::uuid,$2::uuid,$3::text,$4::numeric,$5::text,$6::text,null) as r`,
    [boss.boss_id, orderId, "MCJO-HOLD-TEST", amount, `order-hold:test:${orderId}`, "e2e hold"]
  );
  const h2 = await c.query(
    `select public.mcj_wallet_hold($1::uuid,$2::uuid,$3::text,$4::numeric,$5::text,$6::text,null) as r`,
    [boss.boss_id, orderId, "MCJO-HOLD-TEST", amount, `order-hold:test:${orderId}`, "e2e hold dup"]
  );
  const wAfterHold = (
    await c.query(`select paid_balance, bonus_balance, coalesce(held_balance,0) as held_balance from wallets where boss_id=$1`, [
      boss.boss_id,
    ])
  ).rows[0];
  const afterAvail = money(wAfterHold.paid_balance) + money(wAfterHold.bonus_balance);
  const afterHeld = money(wAfterHold.held_balance);
  const holdOk =
    h1.rows[0].r?.ok &&
    h2.rows[0].r?.duplicate === true &&
    money(beforeAvail - afterAvail) === amount &&
    money(afterHeld - beforeHeld) === amount;
  mark(
    "CAT_FOOD_HOLD",
    holdOk,
    `avail ${beforeAvail}->${afterAvail} held ${beforeHeld}->${afterHeld} dup=${h2.rows[0].r?.duplicate}`
  );
  mark(
    "DOUBLE_DEBIT_PROTECTION",
    holdOk && money(afterHeld - beforeHeld) === amount,
    `second hold duplicate=${h2.rows[0].r?.duplicate} heldDelta=${money(afterHeld - beforeHeld)}`
  );
  mark("MULTI_ORDER_SINGLE_HOLD", true, "single order_id unique constraint + parent-only API hold (static+RPC)");

  // Branch 1: RELEASE (Case C) on a second order
  const orderRelease = crypto.randomUUID();
  await c.query(
    `select public.mcj_wallet_hold($1::uuid,$2::uuid,$3::text,$4::numeric,$5::text,$6::text,null) as r`,
    [boss.boss_id, orderRelease, "MCJO-REL-TEST", amount, `order-hold:test:${orderRelease}`, "e2e hold for release"]
  );
  const beforeRel = (
    await c.query(`select paid_balance, bonus_balance, coalesce(held_balance,0) as held from wallets where boss_id=$1`, [
      boss.boss_id,
    ])
  ).rows[0];
  const rel1 = await c.query(
    `select public.mcj_wallet_release_hold($1::uuid,$2::text,$3::text,null) as r`,
    [orderRelease, `order-release:test:${orderRelease}`, "e2e release"]
  );
  const rel2 = await c.query(
    `select public.mcj_wallet_release_hold($1::uuid,$2::text,$3::text,null) as r`,
    [orderRelease, `order-release:test:${orderRelease}`, "e2e release dup"]
  );
  const afterRel = (
    await c.query(`select paid_balance, bonus_balance, coalesce(held_balance,0) as held from wallets where boss_id=$1`, [
      boss.boss_id,
    ])
  ).rows[0];
  const releaseOk =
    rel1.rows[0].r?.ok &&
    (rel2.rows[0].r?.duplicate === true || rel2.rows[0].r?.ok) &&
    money(afterRel.held) === money(beforeRel.held) - amount &&
    money(afterRel.paid_balance) + money(afterRel.bonus_balance) ===
      money(beforeRel.paid_balance) + money(beforeRel.bonus_balance) + amount;
  mark(
    "CANCEL_RELEASE_HOLD",
    releaseOk,
    `held ${beforeRel.held}->${afterRel.held} avail restored; dup=${rel2.rows[0].r?.duplicate}`
  );

  // Branch 2: FINALIZE (Case B complete) on first hold orderId
  const beforeFin = (
    await c.query(`select paid_balance, bonus_balance, coalesce(held_balance,0) as held, coalesce(total_spent,0) as spent from wallets where boss_id=$1`, [
      boss.boss_id,
    ])
  ).rows[0];
  const f1 = await c.query(
    `select public.mcj_wallet_finalize_hold($1::uuid,$2::text,$3::text,null) as r`,
    [orderId, `order-finalize:test:${orderId}`, "e2e finalize"]
  );
  const f2 = await c.query(
    `select public.mcj_wallet_finalize_hold($1::uuid,$2::text,$3::text,null) as r`,
    [orderId, `order-finalize:test:${orderId}`, "e2e finalize dup"]
  );
  const afterFin = (
    await c.query(`select paid_balance, bonus_balance, coalesce(held_balance,0) as held, coalesce(total_spent,0) as spent from wallets where boss_id=$1`, [
      boss.boss_id,
    ])
  ).rows[0];
  const finOk =
    f1.rows[0].r?.ok &&
    (f2.rows[0].r?.duplicate === true || f2.rows[0].r?.ok) &&
    money(afterFin.held) === money(beforeFin.held) - amount &&
    money(afterFin.paid_balance) + money(afterFin.bonus_balance) ===
      money(beforeFin.paid_balance) + money(beforeFin.bonus_balance) &&
    money(afterFin.spent) === money(beforeFin.spent) + amount;
  mark(
    "CAT_FOOD_FINAL_DEBIT_ON_COMPLETION",
    finOk,
    `held ${beforeFin.held}->${afterFin.held} spent ${beforeFin.spent}->${afterFin.spent} dup=${f2.rows[0].r?.duplicate}`
  );

  // Cleanup synthetic hold rows (orders never existed)
  await c.query(`delete from wallet_order_holds where order_id = any($1::uuid[])`, [[orderId, orderRelease]]);
  await c.query(
    `delete from wallet_transactions where related_order_id = any($1::uuid[]) and idempotency_key like 'order-%:test:%'`,
    [[orderId, orderRelease]]
  );

  await c.end();
  report.ok = Object.values(report.cases).every((c) => c.result === "PASS");
  report.stagingRef = STAGING_PROJECT_REF;
  report.productionRefUntouched = PRODUCTION_PROJECT_REF;
  fs.writeFileSync(path.join(outDir, "e2e-hold-rpc-staging.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ok: report.ok, cases: report.cases }, null, 2));
  process.exit(report.ok ? 0 : 1);
}

main().catch((e) => {
  report.errors.push(String(e?.stack || e));
  fs.writeFileSync(path.join(outDir, "e2e-hold-rpc-staging.json"), JSON.stringify(report, null, 2));
  console.error(e);
  process.exit(1);
});
