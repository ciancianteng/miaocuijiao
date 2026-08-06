/**
 * Production-prep content cleanup (idempotent): hide TEST / meeting-demo content.
 * Does not delete admin or platform structure — only disables demo-looking rows.
 * Hard-guarded: will not run against Production without ALLOW_PROD_MUTATION + confirm.
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { guardAfterEnvLoad } from "./lib/prod-guard.mjs";

const ROOT = process.cwd();
guardAfterEnvLoad("prod-content-cleanup.mjs");

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();
const report = { at: new Date().toISOString(), actions: [] };

async function safe(label, fn) {
  try {
    const r = await fn();
    report.actions.push({ ok: true, label, detail: r });
  } catch (e) {
    report.actions.push({ ok: false, label, error: e.message });
  }
}

await safe("deactivate_test_banners", async () => {
  const r = await c.query(`
    update public.banners
    set is_active = false, updated_at = now()
    where is_active = true
      and (
        title ilike '%[TEST]%'
        or coalesce(subtitle,'') ilike '%__team_lobby__%'
        or coalesce(subtitle,'') ilike '%验收%'
        or title ilike '%会议演示%'
      )
    returning id, title
  `);
  return r.rows;
});

await safe("disable_demo_campaigns", async () => {
  const r = await c.query(`
    update public.recharge_campaigns
    set enabled = false, updated_at = now()
    where enabled = true
      and (name ilike '%会议演示%' or name ilike '%[TEST]%' or description ilike '%会议演示%')
    returning id, name
  `);
  return r.rows;
});

await safe("counts", async () => {
  const profiles = await c.query(`select role, status, count(*)::int as n from public.profiles group by 1,2 order by 1,2`);
  const banners = await c.query(`select count(*)::int as n from public.banners where is_active=true`);
  return { profiles: profiles.rows, activeBanners: banners.rows[0]?.n };
});

fs.writeFileSync(path.join(ROOT, "scripts/prod-content-cleanup-results.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
await c.end();
