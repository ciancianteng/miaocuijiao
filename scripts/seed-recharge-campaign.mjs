import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { guardAfterEnvLoad } from "./lib/prod-guard.mjs";

const ROOT = process.cwd();
guardAfterEnvLoad("seed-recharge-campaign.mjs");

const c = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await c.connect();

const existing = await c.query("select id, name from public.recharge_campaigns where enabled = true limit 5");
if (existing.rowCount) {
  console.log(JSON.stringify({ ok: true, action: "ok_existing", rows: existing.rows }, null, 2));
  await c.end();
  process.exit(0);
}

const r = await c.query(`
  insert into public.recharge_campaigns
    (name, pay_amount_rm, base_cat_food, bonus_cat_food, total_cat_food, enabled, sort_order, description)
  values
    ('会议演示入门包', 10, 100, 10, 110, true, 1, '会议演示用充值档位')
  returning id, name, pay_amount_rm, base_cat_food, bonus_cat_food, enabled
`);
console.log(JSON.stringify({ ok: true, action: "inserted", rows: r.rows }, null, 2));
fs.writeFileSync(path.join(ROOT, "scripts/seed-recharge-campaign-results.json"), JSON.stringify(r.rows, null, 2));
await c.end();
