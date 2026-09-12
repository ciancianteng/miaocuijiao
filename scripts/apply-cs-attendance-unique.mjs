/**
 * Apply CS attendance unique day index + dedupe duplicate punch rows.
 * Usage: node scripts/apply-cs-attendance-unique.mjs
 * Hard-guarded against Production (contains DELETE dedupe).
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { guardAfterEnvLoad } from "./lib/prod-guard.mjs";

const ROOT = process.cwd();
guardAfterEnvLoad("apply-cs-attendance-unique.mjs");

const DEDUPE_SQL = `
-- Keep one attendance row per (service, date): prefer row with shift_start, then newest created_at.
WITH ranked AS (
  SELECT id,
    row_number() OVER (
      PARTITION BY customer_service_id, report_date
      ORDER BY
        CASE WHEN shift_start IS NOT NULL THEN 0 ELSE 1 END,
        CASE WHEN admin_note = 'attendance' THEN 0 ELSE 1 END,
        created_at DESC NULLS LAST
    ) AS rn
  FROM public.customer_service_reports
  WHERE report_date IS NOT NULL
    AND report_date <> '1970-01-01'
    AND coalesce(admin_note, '') <> 'service_config'
)
DELETE FROM public.customer_service_reports r
USING ranked
WHERE r.id = ranked.id AND ranked.rn > 1;
`;

async function main() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.SUPABASE_DB_URL || "";
  if (!url) {
    console.error("DATABASE_URL missing");
    process.exit(1);
  }
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  const out = { ok: true, steps: [] };
  try {
    const del = await client.query(DEDUPE_SQL);
    out.steps.push({ step: "dedupe", rowCount: del.rowCount });
    console.log("dedupe removed", del.rowCount);
  } catch (e) {
    out.ok = false;
    out.steps.push({ step: "dedupe", error: e.message });
    console.error("dedupe fail", e.message);
  }
  const sqlPath = path.join(ROOT, "supabase/migrations/20260801_cs_attendance_unique_index.sql");
  try {
    await client.query(fs.readFileSync(sqlPath, "utf8"));
    out.steps.push({ step: "unique_index", ok: true });
    console.log("OK unique index");
  } catch (e) {
    out.ok = false;
    out.steps.push({ step: "unique_index", error: e.message });
    console.error("index fail", e.message);
  }
  try {
    const r = await client.query(`
      SELECT indexname FROM pg_indexes
      WHERE tablename = 'customer_service_reports'
        AND indexname = 'idx_cs_reports_service_date_unique'
    `);
    out.steps.push({ step: "verify", found: r.rows.length > 0 });
    console.log("unique index present:", r.rows.length > 0);
  } catch (e) {
    out.steps.push({ step: "verify", error: e.message });
  }
  await client.end();
  fs.writeFileSync(path.join(ROOT, "scripts/apply-cs-attendance-unique-results.json"), JSON.stringify(out, null, 2));
  if (!out.ok) process.exit(1);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
