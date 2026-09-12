/**
 * Apply tonight's SQL migrations via DATABASE_URL (from .env.local).
 * Usage: node scripts/apply-tonight-migrations.mjs
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

const files = [
  "supabase/companion-levels.sql",
  "supabase/migrations/20260802_cs_dock_rewards.sql",
  "supabase/migrations/20260802_rules_hub_acks.sql",
  "supabase/migrations/20260802_ensure_payment_orders.sql",
  "supabase/migrations/20260802_security_hardening.sql",
  "supabase/migrations/20260802_platform_content_items.sql",
];

async function main() {
  const url = process.env.DATABASE_URL || process.env.POSTGRES_URL || "";
  if (!url) {
    console.error("DATABASE_URL missing");
    process.exit(1);
  }
  const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  const out = [];
  for (const rel of files) {
    const full = path.join(ROOT, rel);
    if (!fs.existsSync(full)) {
      out.push({ file: rel, ok: false, detail: "missing file" });
      console.error("MISS", rel);
      continue;
    }
    const sql = fs.readFileSync(full, "utf8");
    try {
      await client.query(sql);
      out.push({ file: rel, ok: true, detail: "applied" });
      console.log("OK", rel);
    } catch (e) {
      out.push({ file: rel, ok: false, detail: e.message });
      console.error("FAIL", rel, e.message);
    }
  }
  for (const t of ["cs_dock_rewards", "content_ack_records", "payment_orders", "companion_levels"]) {
    try {
      const r = await client.query(`select count(*)::int as n from public.${t}`);
      console.log("table", t, "rows", r.rows[0].n);
    } catch (e) {
      console.error("verify fail", t, e.message);
    }
  }
  await client.end();
  fs.writeFileSync(path.join(ROOT, "scripts/apply-tonight-migrations-results.json"), JSON.stringify(out, null, 2));
  if (out.some((x) => !x.ok)) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
