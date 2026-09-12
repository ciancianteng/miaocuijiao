/**
 * Apply public document code migration (MCJO / WD / CSW) + report.
 * Usage: node scripts/apply-public-document-codes.mjs
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const ROOT = process.cwd();
function loadEnv() {
  for (const f of [".env.local", ".env"]) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, "utf8").split(/\r?\n/)) {
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (!m || process.env[m[1]]) continue;
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
}
loadEnv();

async function main() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL || "";
  if (!url) {
    console.error("DATABASE_URL missing");
    process.exit(1);
  }
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const files = [
    "supabase/migrations/20260803_account_codes_mcj_pw.sql",
    "supabase/migrations/20260804_public_document_codes.sql",
  ];
  const applied = [];
  for (const rel of files) {
    const sqlPath = path.join(ROOT, rel);
    if (!fs.existsSync(sqlPath)) {
      console.warn("SKIP missing", rel);
      continue;
    }
    const sql = fs.readFileSync(sqlPath, "utf8");
    try {
      await client.query(sql);
      applied.push(rel);
      console.log("OK applied", rel);
    } catch (e) {
      console.error("FAIL apply", rel, e.message);
      await client.end();
      process.exit(1);
    }
  }

  const orders = await client.query(
    `select order_no, created_at from public.orders where order_no ~* '^MCJO' order by order_no desc limit 5`
  ).catch(() => ({ rows: [] }));
  const withdraws = await client.query(
    `select withdrawal_no, status from public.companion_withdrawals where withdrawal_no ~* '^WD' order by withdrawal_no desc limit 5`
  ).catch(() => ({ rows: [] }));
  const payrolls = await client.query(
    `select payroll_no, status from public.staff_payrolls where payroll_no ~* '^CSW' order by payroll_no desc limit 5`
  ).catch(() => ({ rows: [] }));
  const bosses = await client.query(
    `select count(*)::int as n from public.profiles where role='boss' and boss_uid ~* '^MCJ'`
  ).catch(() => ({ rows: [{ n: 0 }] }));
  const companions = await client.query(
    `select count(*)::int as n from public.companion_profiles where companion_code ~* '^PW' and application_status in ('approved','verified','passed')`
  ).catch(() => ({ rows: [{ n: 0 }] }));
  const draftCodes = await client.query(
    `select count(*)::int as n from public.companion_profiles where companion_code is not null and (application_status in ('draft','archived','deleted') or nickname ~* '^草稿保留')`
  ).catch(() => ({ rows: [{ n: 0 }] }));

  const report = {
    appliedAt: new Date().toISOString(),
    applied,
    formats: {
      boss: "MCJ00001",
      companion: "PW00001",
      order: "MCJO000001",
      withdraw: "WD000001",
      csPayroll: "CSW000001",
      cs: "display_name only (no public code)",
    },
    sequences: {
      boss: "public.boss_uid_seq",
      companion: "public.companion_code_seq",
      order: "public.order_public_no_seq",
      withdraw: "public.companion_withdrawal_no_seq",
      csPayroll: "public.cs_payroll_no_seq",
    },
    operationLogs: ["public.admin_operation_logs", "public.finance_payout_logs", "public.order_operation_logs"],
    counts: {
      bossesWithMcj: bosses.rows[0]?.n || 0,
      approvedCompanionsWithPw: companions.rows[0]?.n || 0,
      draftStillHoldingPw: draftCodes.rows[0]?.n || 0,
    },
    samples: {
      latestOrders: orders.rows,
      latestWithdrawals: withdraws.rows,
      latestPayrolls: payrolls.rows,
    },
  };
  fs.writeFileSync(path.join(ROOT, "scripts/public-document-codes-report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await client.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
